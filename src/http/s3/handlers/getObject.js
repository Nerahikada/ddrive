const path = require('path')
const mime = require('mime-types')
const db = require('../../api/services/database')
const { resolveKey } = require('../pathResolver')
const { sendS3Error } = require('../errors')
const { rangeParser } = require('../../api/utils/Util')

/**
 * Returns ranged parts for partial content requests
 */
const rangedParts = (parts, start, end) => {
    const chunkSize = parts[0].size
    const startPartNumber = Math.ceil(start / chunkSize) ? Math.ceil(start / chunkSize) - 1 : 0
    const endPartNumber = Math.ceil(end / chunkSize)
    const partsToDownload = parts.slice(startPartNumber, endPartNumber)
    partsToDownload[0].start = start % chunkSize
    partsToDownload[partsToDownload.length - 1].end = end % chunkSize

    return partsToDownload
}

module.exports = async (req, reply) => {
    const key = req.params['*']
    if (!key) {
        sendS3Error(reply, 'InvalidArgument', 'Object key is required.')
        return
    }

    try {
        const record = await resolveKey(key)
        if (!record || record.type !== 'file') {
            sendS3Error(reply, 'NoSuchKey')
            return
        }

        const file = await db.getFile(record.id, true, true)
        if (!file || !file.parts || !file.parts.length) {
            sendS3Error(reply, 'NoSuchKey')
            return
        }

        const mimeType = mime.lookup(path.extname(file.name)) || 'application/octet-stream'
        const lastModified = new Date(file.createdAt).toUTCString()

        const resHeaders = {
            'Content-Type': mimeType,
            'Content-Length': file.size,
            ETag: `"${file.id}"`,
            'Last-Modified': lastModified,
            'Accept-Ranges': 'bytes',
        }

        // Handle Range requests
        const { range } = req.headers
        const parsedRange = rangeParser(file.size, range)

        reply.hijack()

        if (range && parsedRange !== -1) {
            const { start, end } = parsedRange
            reply.raw.writeHead(206, {
                ...resHeaders,
                'Content-Length': end - start + 1,
                'Content-Range': `bytes ${start}-${end}/${file.size}`,
            })
            file.parts = rangedParts(file.parts, start, end)
        } else {
            reply.raw.writeHead(200, resHeaders)
        }

        await req.dfs.read(reply.raw, file.parts)
    } catch (err) {
        req.log.error(err)
        // If headers already sent (hijacked), just close the socket
        if (reply.raw.headersSent) {
            reply.raw.destroy()
        } else {
            sendS3Error(reply, 'InternalError')
        }
    }
}
