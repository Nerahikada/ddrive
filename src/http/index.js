const path = require('path')
const Fastify = require('fastify')
const FastifyStatic = require('@fastify/static')
const FastifyMultipart = require('@fastify/multipart')
const FastifyAuth = require('@fastify/auth')

const knex = require('./api/utils/knex')
const commonSchemas = require('./api/constants/commonSchemas')
const directoryRoutes = require('./api/routes/directory/routes')
const fileRoutes = require('./api/routes/file/routes')
const Auth = require('./api/services/auth')
const s3Routes = require('./s3/routes')

module.exports = (dfs, opts) => {
    // Create fastify instance
    const fastify = Fastify({ logger: { base: undefined } })

    // Load common schemas
    commonSchemas.forEach((schema) => fastify.addSchema(schema))

    // Health check (unauthenticated, verifies DB connectivity)
    fastify.get('/healthz', { logLevel: 'silent' }, async () => {
        await knex.raw('SELECT 1')
        return { status: 'ok' }
    })

    // Enable Multipart upload
    fastify.register(FastifyMultipart, { limits: { fileSize: Number.MAX_SAFE_INTEGER } })

    // Load Auth and then register the routes
    fastify.decorate('basicAuth', Auth(opts.authOpts))
    fastify.register(FastifyAuth)
        .after(() => {
            fastify.register(FastifyStatic, { root: path.join(__dirname, 'html') })
            fastify.register(directoryRoutes, { prefix: '/api' })
            fastify.register(fileRoutes, { prefix: '/api' })
        })

    // Register S3 routes if credentials are configured
    if (opts.s3) {
        fastify.register(s3Routes, {
            prefix: `/${opts.s3.bucket}`,
            bucket: opts.s3.bucket,
            accessKeyId: opts.s3.accessKeyId,
            secretAccessKey: opts.s3.secretAccessKey,
        })
    }

    // Attach dfs to every req
    fastify.addHook('onRequest', async (req) => { req.dfs = dfs })

    // Setup Error handler
    fastify.setErrorHandler(function handler(error, request, reply) {
        if (error.statusCode > 500 || !error.statusCode) {
            const errorToLog = error.rawError || error
            errorToLog.reqId = request.id
            this.log.error(errorToLog)
            error.statusCode = 500
            error.message = 'Internal server error'
        }
        reply.status(error.statusCode).send({ id: request.id, message: error.message })
    })

    // Handle Not found handler
    fastify.setNotFoundHandler((request, reply) => {
        reply.status(404).send({ message: 'Not found' })
    })

    return fastify
}
