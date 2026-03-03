const crypto = require('crypto')
const { Transform } = require('stream')
const db = require('../../api/services/database')
const { resolveOrCreateParentPath, resolveKey } = require('../pathResolver')
const { sendS3Error } = require('../errors')

module.exports = async (req, reply) => {
    const key = req.params['*']
    if (!key) {
        sendS3Error(reply, 'InvalidArgument', 'Object key is required.')
        return
    }

    try {
        // Resolve parent path, creating intermediate directories
        const resolved = await resolveOrCreateParentPath(key)
        if (!resolved) {
            sendS3Error(reply, 'InternalError', 'Could not resolve path.')
            return
        }

        const { parentDirectory, fileName } = resolved

        // Check if file already exists - delete it for overwrite semantics
        const existing = await resolveKey(key)
        if (existing && existing.type === 'file') {
            const existingParts = await db.getFileParts(existing.id)
            try { await req.dfs.deleteParts(existingParts) } catch {}
            await db.deleteDirectory(existing.id, 'file')
        }

        // If Content-MD5 is provided, wrap stream to compute hash while uploading
        const contentMd5 = req.headers['content-md5']
        let bodyStream = req.body
        let md5Transform = null

        if (contentMd5) {
            md5Transform = new Transform({
                transform(chunk, encoding, cb) {
                    this.hash.update(chunk)
                    this.push(chunk)
                    cb()
                },
            })
            md5Transform.hash = crypto.createHash('md5')
            bodyStream = req.body.pipe(md5Transform)
        }

        // Upload stream to Discord
        const parts = await req.dfs.write(bodyStream)

        // Verify Content-MD5 if provided
        if (md5Transform) {
            const computed = md5Transform.hash.digest('base64')
            if (computed !== contentMd5) {
                await req.dfs.deleteParts(parts)
                sendS3Error(reply, 'BadDigest')
                return
            }
        }

        // Create file record in DB
        const fileData = { name: fileName, parentId: parentDirectory.id, type: 'file' }
        const file = await db.createFileWithParts(fileData, parts)

        reply
            .code(200)
            .header('ETag', `"${file.id}"`)
            .send('')
    } catch (err) {
        req.log.error(err)
        sendS3Error(reply, 'InternalError')
    }
}
