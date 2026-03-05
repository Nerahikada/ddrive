const crypto = require('crypto')
const { verifySignature } = require('./auth')
const { sendS3Error } = require('./errors')
const headBucket = require('./handlers/headBucket')
const putObject = require('./handlers/putObject')
const getObject = require('./handlers/getObject')
const headObject = require('./handlers/headObject')
const deleteObject = require('./handlers/deleteObject')
const listObjectsV2 = require('./handlers/listObjectsV2')
const {
    createMultipartUpload,
    uploadPart,
    completeMultipartUpload,
    abortMultipartUpload,
} = require('./handlers/multipart')

module.exports = function s3Routes(fastify, opts, done) {
    const { bucket, accessKeyId, secretAccessKey } = opts

    // Disable body parsing for S3 routes - we need raw streams for PUT
    // Set a generous bodyLimit so large PutObject / UploadPart requests are not rejected
    fastify.removeAllContentTypeParsers()
    fastify.addContentTypeParser('*', { bodyLimit: 500 * 1024 * 1024 }, (req, payload, done2) => {
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
            return sendS3Error(reply, 'SignatureDoesNotMatch')
        }
    })

    // HEAD /{bucket} — bucket existence check
    fastify.head('/', (req, reply) => headBucket(req, reply))

    // GET /{bucket} — ListObjectsV2 (when list-type=2 or no key)
    fastify.get('/', (req, reply) => listObjectsV2(req, reply, bucket))

    // PUT /{bucket}/{key+} — PutObject or UploadPart
    fastify.put('/*', (req, reply) => {
        if (req.query.partNumber !== undefined && req.query.uploadId) {
            return uploadPart(req, reply)
        }
        return putObject(req, reply)
    })

    // POST /{bucket}/{key+} — CreateMultipartUpload or CompleteMultipartUpload
    fastify.post('/*', (req, reply) => {
        if (req.query.uploads !== undefined) {
            return createMultipartUpload(req, reply, bucket)
        }
        if (req.query.uploadId) {
            return completeMultipartUpload(req, reply, bucket)
        }
        sendS3Error(reply, 'InvalidArgument', 'Unsupported POST operation.')
    })

    // GET /{bucket}/{key+} — GetObject
    fastify.get('/*', { exposeHeadRoute: false }, (req, reply) => getObject(req, reply))

    // HEAD /{bucket}/{key+} — HeadObject
    fastify.head('/*', (req, reply) => headObject(req, reply))

    // DELETE /{bucket}/{key+} — DeleteObject or AbortMultipartUpload
    fastify.delete('/*', (req, reply) => {
        if (req.query.uploadId) {
            return abortMultipartUpload(req, reply)
        }
        return deleteObject(req, reply)
    })

    done()
}
