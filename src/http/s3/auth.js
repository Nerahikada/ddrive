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
 * Parse presigned URL query parameters
 * Format: X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=key/date/region/s3/aws4_request&...
 */
const parsePresignedAuth = (query) => {
    if (!query) return null

    const params = typeof query === 'string' ? new URLSearchParams(query) : query
    const algorithm = params.get('X-Amz-Algorithm')
    if (algorithm !== 'AWS4-HMAC-SHA256') return null

    const credential = params.get('X-Amz-Credential')
    const date = params.get('X-Amz-Date')
    const expires = params.get('X-Amz-Expires')
    const signedHeaders = params.get('X-Amz-SignedHeaders')
    const signature = params.get('X-Amz-Signature')

    if (!credential || !date || !expires || !signedHeaders || !signature) return null

    const credParts = credential.split('/')
    if (credParts.length !== 5) return null

    return {
        accessKeyId: credParts[0],
        date: credParts[1],
        region: credParts[2],
        service: credParts[3],
        signedHeaders: signedHeaders.split(';'),
        signature,
        amzDate: date,
        expires: parseInt(expires, 10),
    }
}

/**
 * Parse ISO 8601 basic format date (e.g. 20260301T120000Z) into epoch ms
 */
const parseAmzDate = (amzDate) => {
    const year = amzDate.slice(0, 4)
    const month = amzDate.slice(4, 6)
    const day = amzDate.slice(6, 8)
    const hour = amzDate.slice(9, 11)
    const min = amzDate.slice(11, 13)
    const sec = amzDate.slice(13, 15)

    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).getTime()
}

/**
 * Verify AWS Signature V4
 * Supports both Authorization header and presigned URL (query parameter) authentication.
 * Returns true if signature is valid, false otherwise
 */
const verifySignature = ({
    method, path, query, headers, accessKeyId, secretAccessKey,
}) => {
    const headerAuth = parseAuthHeader(headers.authorization)
    const presignedAuth = headerAuth ? null : parsePresignedAuth(query)
    const auth = headerAuth || presignedAuth
    if (!auth) return false

    const isPresigned = !headerAuth

    // Verify access key
    if (auth.accessKeyId !== accessKeyId) return false

    // Determine X-Amz-Date
    const amzDate = isPresigned ? auth.amzDate : headers['x-amz-date']

    if (amzDate) {
        const requestTime = parseAmzDate(amzDate)
        if (Number.isNaN(requestTime)) return false

        if (isPresigned) {
            // Presigned: no clock-skew check (AWS docs: time skew validation
            // "applies only to authenticated requests that do not use query
            // string authentication"). Only check expiration + max 7 days.
            if (auth.expires > 604800) return false // max 7 days
            const expiresAt = requestTime + auth.expires * 1000
            if (Date.now() > expiresAt) return false
        } else {
            // Header auth: validate time skew (±15 minutes)
            const skew = Math.abs(Date.now() - requestTime)
            if (skew > 900000) return false
        }
    }

    // Presigned URLs always use UNSIGNED-PAYLOAD
    const payloadHash = isPresigned
        ? 'UNSIGNED-PAYLOAD'
        : (headers['x-amz-content-sha256'] || 'UNSIGNED-PAYLOAD')

    // Build canonical request
    const canonicalRequest = buildCanonicalRequest(
        method, path, query, headers, auth.signedHeaders, payloadHash,
    )

    // Build string to sign
    const scope = `${auth.date}/${auth.region}/${auth.service}/aws4_request`
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate || '',
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
