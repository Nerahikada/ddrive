const { listByPrefix } = require('../pathResolver')
const { listObjectsV2Response } = require('../xml')
const { sendS3Error } = require('../errors')

// RFC 3986 URI encoding — encodes all characters except unreserved (A-Z a-z 0-9 - _ . ~)
const encodeRfc3986 = (str) => encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

module.exports = async (req, reply, bucket) => {
    try {
        // Only ListObjectsV2 (list-type=2) is supported
        if (req.query['list-type'] && req.query['list-type'] !== '2') {
            sendS3Error(reply, 'InvalidArgument', 'Only list-type=2 (ListObjectsV2) is supported.')
            return
        }

        const prefix = req.query.prefix || ''
        const delimiter = req.query.delimiter || ''
        const maxKeys = Math.min(parseInt(req.query['max-keys'] || '1000', 10), 1000)
        const continuationToken = req.query['continuation-token'] || null
        const startAfter = req.query['start-after'] || ''
        const encodingType = req.query['encoding-type'] || ''

        const result = await listByPrefix(prefix, delimiter, maxKeys, continuationToken, startAfter)

        // URL-encode keys per RFC 3986 if encoding-type=url
        if (encodingType === 'url') {
            result.contents = result.contents.map((c) => ({ ...c, key: encodeRfc3986(c.key) }))
            result.commonPrefixes = result.commonPrefixes.map((p) => encodeRfc3986(p))
        }

        const xml = listObjectsV2Response({
            name: bucket,
            prefix,
            delimiter,
            maxKeys,
            keyCount: result.contents.length + result.commonPrefixes.length,
            isTruncated: result.isTruncated,
            contents: result.contents,
            commonPrefixes: result.commonPrefixes,
            continuationToken,
            nextContinuationToken: result.nextContinuationToken,
            encodingType: encodingType || undefined,
        })

        reply
            .code(200)
            .header('Content-Type', 'application/xml')
            .send(xml)
    } catch (err) {
        req.log.error(err)
        sendS3Error(reply, 'InternalError')
    }
}
