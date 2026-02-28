const db = require('../../api/services/database')
const { resolveOrCreateParentPath, resolveKey } = require('../pathResolver')
const { sendS3Error } = require('../errors')

module.exports = async (req, reply) => {
    const key = req.params['*']
    if (!key) {
        sendS3Error(reply, 'InvalidArgument', 'Object key is required.')

        return undefined
    }

    try {
        // Resolve parent path, creating intermediate directories
        const resolved = await resolveOrCreateParentPath(key)
        if (!resolved) {
            sendS3Error(reply, 'InternalError', 'Could not resolve path.')

            return undefined
        }

        const { parentDirectory, fileName } = resolved

        // Check if file already exists - delete it for overwrite semantics
        const existing = await resolveKey(key)
        if (existing && existing.type === 'file') {
            await db.deleteDirectory(existing.id, 'file')
        }

        // Upload stream to Discord (req.body is the passthrough stream from content parser)
        const parts = await req.dfs.write(req.body)

        // Create file record in DB
        const fileData = { name: fileName, parentId: parentDirectory.id, type: 'file' }
        const file = await db.createFileWithParts(fileData, parts)

        reply
            .code(200)
            .header('ETag', `"${file.id}"`)
            .send('')

        return undefined
    } catch (err) {
        req.log.error(err)
        sendS3Error(reply, 'InternalError')

        return undefined
    }
}
