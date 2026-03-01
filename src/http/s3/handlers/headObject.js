const path = require('path')
const mime = require('mime-types')
const db = require('../../api/services/database')
const { resolveKey } = require('../pathResolver')
const { sendS3Error } = require('../errors')

module.exports = async (req, reply) => {
    const key = req.params['*']
    if (!key) {
        sendS3Error(reply, 'InvalidArgument', 'Object key is required.')
        return
    }

    try {
        const record = await resolveKey(key)
        if (!record || record.type !== 'file') {
            sendS3Error(reply, 'NoSuchKey', undefined, `/${key}`)
            return
        }

        const file = await db.getFile(record.id, true, false)
        if (!file) {
            sendS3Error(reply, 'NoSuchKey', undefined, `/${key}`)
            return
        }

        const mimeType = mime.lookup(path.extname(file.name)) || 'application/octet-stream'
        const lastModified = new Date(file.createdAt).toUTCString()

        reply
            .code(200)
            .header('Content-Type', mimeType)
            .header('Content-Length', file.size || 0)
            .header('ETag', `"${file.id}"`)
            .header('Last-Modified', lastModified)
            .header('Accept-Ranges', 'bytes')
            .send('')
    } catch (err) {
        req.log.error(err)
        sendS3Error(reply, 'InternalError')
    }
}
