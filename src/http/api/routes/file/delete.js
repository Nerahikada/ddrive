const HTTP_CODE = require('../../constants/httpCode')
const db = require('../../services/database')

module.exports.opts = {
    schema: {
        params: {
            type: 'object',
            required: ['fileId'],
            properties: {
                directoryId: { type: 'string', format: 'uuid' },
            },
        },
        response: {
            [HTTP_CODE.BAD_REQUEST]: { $ref: 'CommonError#' },
            [HTTP_CODE.UNAUTHORIZED]: { $ref: 'CommonError#' },
        },
    },
}

module.exports.handler = async (req, reply) => {
    const { fileId } = req.params
    try {
        const parts = await db.getFileParts(fileId)
        await req.dfs.deleteParts(parts)
    } catch (err) {
        req.log.warn(err, 'Discord cleanup failed for file %s', fileId)
    }
    await db.deleteDirectory(fileId, 'file')
    reply.code(HTTP_CODE.NO_CONTENT)
}
