const db = require('../../api/services/database')
const { resolveKey } = require('../pathResolver')

module.exports = async (req, reply) => {
    const key = req.params['*']
    if (!key) {
        reply.code(204).send('')
        return
    }

    try {
        const record = await resolveKey(key)
        if (record && record.type === 'file') {
            await db.deleteDirectory(record.id, 'file')
        }
        // S3 always returns 204, even if key doesn't exist (idempotent)
        reply.code(204).send('')
    } catch (err) {
        req.log.error(err)
        reply.code(204).send('')
    }
}
