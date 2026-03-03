const db = require('../../services/database')

module.exports.opts = {
    schema: {
        params: {
            type: 'object',
            required: ['directoryId'],
            properties: {
                directoryId: { type: 'string', format: 'uuid' },
            },
        },
    },
}

module.exports.handler = async (req, reply) => {
    const { directoryId } = req.params
    try {
        const parts = await db.getDirectoryParts(directoryId)
        await req.dfs.deleteParts(parts)
    } catch {}
    await db.deleteDirectory(directoryId)
    reply.code(204)
}
