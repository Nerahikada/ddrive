const crypto = require('crypto')
const { verifySignature } = require('./auth')
const { sendS3Error } = require('./errors')
const headBucket = require('./handlers/headBucket')
const putObject = require('./handlers/putObject')
const getObject = require('./handlers/getObject')
const headObject = require('./handlers/headObject')
const deleteObject = require('./handlers/deleteObject')
const listObjectsV2 = require('./handlers/listObjectsV2')

module.exports = function s3Routes(fastify, opts, done) {
    const { bucket, accessKeyId, secretAccessKey } = opts

    // Disable body parsing for S3 routes - we need raw streams for PUT
    fastify.removeAllContentTypeParsers()
    fastify.addContentTypeParser('*', (req, payload, done2) => {
        done2(null, payload)
    })

    // Add x-amz-request-id to all responses
    fastify.addHook('onSend', async (req, reply) => {
        if (!reply.hasHeader('x-amz-request-id')) {
            reply.header('x-amz-request-id', crypto.randomUUID())
        }
    })

    // Auth hook - verify SigV4
    fastify.addHook('onRequest', async (req, reply) => {
        const valid = verifySignature({
            method: req.method,
            path: req.raw.url.split('?')[0],
            query: req.raw.url.includes('?') ? req.raw.url.split('?')[1] : '',
            headers: req.headers,
            accessKeyId,
            secretAccessKey,
        })

        if (!valid) {
            sendS3Error(reply, 'SignatureDoesNotMatch')

            return undefined
        }

        return undefined
    })

    // HEAD /{bucket} — bucket existence check
    fastify.head('/', (req, reply) => headBucket(req, reply))

    // GET /{bucket} — ListObjectsV2 (when list-type=2 or no key)
    fastify.get('/', (req, reply) => listObjectsV2(req, reply, bucket))

    // PUT /{bucket}/{key+} — PutObject
    fastify.put('/*', (req, reply) => putObject(req, reply))

    // GET /{bucket}/{key+} — GetObject
    fastify.get('/*', (req, reply) => getObject(req, reply))

    // HEAD /{bucket}/{key+} — HeadObject
    fastify.head('/*', (req, reply) => headObject(req, reply))

    // DELETE /{bucket}/{key+} — DeleteObject
    fastify.delete('/*', (req, reply) => deleteObject(req, reply))

    done()
}
