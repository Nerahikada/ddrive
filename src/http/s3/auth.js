const crypto = require('crypto')

/**
 * Parse AWS Authorization header
 * Format: AWS4-HMAC-SHA256 Credential=key/date/region/s3/aws4_request, SignedHeaders=..., Signature=...
 */
const parseAuthHeader = (header) => {
    if (!header || !header.startsWith('AWS4-HMAC-SHA256 ')) return null

    const parts = header.slice('AWS4-HMAC-SHA256 '.length)
    const map = {}
    parts.split(', ').forEach((part) => {
        const idx = part.indexOf('=')
        if (idx !== -1) {
            map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
        }
    })

    if (!map.Credential || !map.SignedHeaders || !map.Signature) return null

    const credParts = map.Credential.split('/')
    if (credParts.length !== 5) return null

    return {
        accessKeyId: credParts[0],
        date: credParts[1],
        region: credParts[2],
        service: credParts[3],
        signedHeaders: map.SignedHeaders.split(';'),
        signature: map.Signature,
    }
}

const hmacSha256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest()

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')

/**
 * RFC 3986 URI encoding — encodes all characters except unreserved (A-Z a-z 0-9 - _ . ~)
 */
const encodeRfc3986 = (str) => encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * Encode URI path per AWS SigV4 spec — encode each segment individually
 */
const encodeCanonicalUri = (uri) => {
    if (!uri || uri === '/') return '/'

    return uri.split('/').map((segment) => (segment ? encodeRfc3986(segment) : '')).join('/')
}

/**
 * Build canonical request string
 */
const buildCanonicalRequest = (method, uri, query, headers, signedHeaders, payloadHash) => {
    const canonicalUri = encodeCanonicalUri(uri || '/')

    // Canonical query string - sorted by key, RFC 3986 encoded, excluding signature params
    const queryPairs = []
    if (query) {
        const params = typeof query === 'string' ? new URLSearchParams(query) : query
        const sorted = Array.from(params)
            .filter(([k]) => k !== 'X-Amz-Signature')
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        sorted.forEach(([k, v]) => {
            queryPairs.push(`${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
        })
    }
    const canonicalQueryString = queryPairs.join('&')

    // Canonical headers - lowercase, trimmed, internal whitespace compressed, sorted
    const canonicalHeaders = signedHeaders
        .map((h) => `${h.toLowerCase()}:${(headers[h.toLowerCase()] || '').trim().replace(/ +/g, ' ')}`)
        .join('\n')

    return [
        method.toUpperCase(),
        canonicalUri,
        canonicalQueryString,
        `${canonicalHeaders}\n`,
        signedHeaders.join(';'),
        payloadHash,
    ].join('\n')
}

/**
 * Derive signing key using HMAC chain
 */
const deriveSigningKey = (secretKey, date, region, service) => {
    let key = hmacSha256(`AWS4${secretKey}`, date)
    key = hmacSha256(key, region)
    key = hmacSha256(key, service)
    key = hmacSha256(key, 'aws4_request')

    return key
}

/**
 * Verify AWS Signature V4
 * Returns true if signature is valid, false otherwise
 */
const verifySignature = ({
    method, path, query, headers, accessKeyId, secretAccessKey,
}) => {
    const auth = parseAuthHeader(headers.authorization)
    if (!auth) return false

    // Verify access key
    if (auth.accessKeyId !== accessKeyId) return false

    // Validate time skew (±15 minutes)
    const amzDate = headers['x-amz-date']
    if (amzDate) {
        const year = amzDate.slice(0, 4)
        const month = amzDate.slice(4, 6)
        const day = amzDate.slice(6, 8)
        const hour = amzDate.slice(9, 11)
        const min = amzDate.slice(11, 13)
        const sec = amzDate.slice(13, 15)
        const requestTime = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).getTime()
        const skew = Math.abs(Date.now() - requestTime)
        if (Number.isNaN(requestTime) || skew > 900000) return false // 15 minutes
    }

    // Get payload hash - accept UNSIGNED-PAYLOAD for streaming uploads
    const payloadHash = headers['x-amz-content-sha256'] || 'UNSIGNED-PAYLOAD'

    // Build canonical request
    const canonicalRequest = buildCanonicalRequest(
        method, path, query, headers, auth.signedHeaders, payloadHash,
    )

    // Build string to sign
    const scope = `${auth.date}/${auth.region}/${auth.service}/aws4_request`
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        headers['x-amz-date'] || '',
        scope,
        sha256Hex(canonicalRequest),
    ].join('\n')

    // Derive signing key and compute signature
    const signingKey = deriveSigningKey(secretAccessKey, auth.date, auth.region, auth.service)
    const computedSignature = crypto.createHmac('sha256', signingKey)
        .update(stringToSign)
        .digest('hex')

    // Constant-time comparison
    try {
        return crypto.timingSafeEqual(
            Buffer.from(computedSignature, 'hex'),
            Buffer.from(auth.signature, 'hex'),
        )
    } catch {
        return false
    }
}

module.exports = { verifySignature }
