const crypto = require('crypto')
const db = require('../../api/services/database')
const { resolveOrCreateParentPath, resolveKey } = require('../pathResolver')
const { sendS3Error } = require('../errors')
const { escapeXml, unescapeXml } = require('../xml')

// In-memory store for in-flight multipart uploads
const uploads = new Map()

// Cleanup expired uploads every hour (24h TTL)
const UPLOAD_TTL = 24 * 60 * 60 * 1000
setInterval(() => {
    const now = Date.now()
    for (const [id, upload] of uploads) {
        if (now - upload.createdAt > UPLOAD_TTL) {
            uploads.delete(id)
        }
    }
}, 60 * 60 * 1000).unref()

function readStream(stream) {
    return new Promise((resolve, reject) => {
        const chunks = []
        stream.on('data', (chunk) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
    })
}

// POST /{bucket}/{key}?uploads  —  Initiate Multipart Upload
async function createMultipartUpload(req, reply, bucket) {
    const key = req.params['*']
    if (!key) {
        sendS3Error(reply, 'InvalidArgument', 'Object key is required.')
        return
    }

    const uploadId = crypto.randomUUID()
    uploads.set(uploadId, {
        key,
        parts: new Map(),
        createdAt: Date.now(),
    })

    reply
        .code(200)
        .header('Content-Type', 'application/xml')
        .send([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<InitiateMultipartUploadResult>',
            `  <Bucket>${escapeXml(bucket)}</Bucket>`,
            `  <Key>${escapeXml(key)}</Key>`,
            `  <UploadId>${escapeXml(uploadId)}</UploadId>`,
            '</InitiateMultipartUploadResult>',
        ].join('\n'))
}

// PUT /{bucket}/{key}?partNumber=N&uploadId=X  —  Upload Part
async function uploadPart(req, reply) {
    const { partNumber, uploadId } = req.query

    const upload = uploads.get(uploadId)
    if (!upload) {
        sendS3Error(reply, 'NoSuchUpload', 'The specified multipart upload does not exist.')
        return
    }

    const partNum = parseInt(partNumber, 10)
    if (!Number.isFinite(partNum) || partNum < 1 || partNum > 10000) {
        sendS3Error(reply, 'InvalidArgument', 'Part number must be between 1 and 10,000.')
        return
    }

    try {
        const discordParts = await req.dfs.write(req.body)
        const etag = crypto.randomUUID()

        upload.parts.set(partNum, { etag, discordParts })

        reply
            .code(200)
            .header('ETag', `"${etag}"`)
            .send('')
    } catch (err) {
        req.log.error(err)
        sendS3Error(reply, 'InternalError')
    }
}

// POST /{bucket}/{key}?uploadId=X  —  Complete Multipart Upload
async function completeMultipartUpload(req, reply, bucket) {
    const { uploadId } = req.query

    const upload = uploads.get(uploadId)
    if (!upload) {
        sendS3Error(reply, 'NoSuchUpload', 'The specified multipart upload does not exist.')
        return
    }

    try {
        // Read the XML body listing parts
        const body = await readStream(req.body)
        const xml = body.toString()

        // Extract part numbers and ETags from XML (order-independent)
        const requestedParts = []
        const partRegex = /<Part>([\s\S]*?)<\/Part>/g
        let match
        while ((match = partRegex.exec(xml)) !== null) {
            const inner = match[1]
            const numMatch = inner.match(/<PartNumber>(\d+)<\/PartNumber>/)
            const etagMatch = inner.match(/<ETag>([^<]+)<\/ETag>/)
            if (numMatch && etagMatch) {
                // Decode XML entities (&#34; → ") then strip surrounding quotes
                const rawEtag = unescapeXml(etagMatch[1]).replace(/^"|"$/g, '')
                requestedParts.push({ num: parseInt(numMatch[1], 10), etag: rawEtag })
            }
        }

        if (!requestedParts.length) {
            sendS3Error(reply, 'InvalidArgument', 'No valid parts specified.')
            return
        }
        requestedParts.sort((a, b) => a.num - b.num)

        // Collect all discord parts in order, validating ETags
        const allDiscordParts = []
        for (const { num, etag } of requestedParts) {
            const part = upload.parts.get(num)
            if (!part || part.etag !== etag) {
                sendS3Error(reply, 'InvalidArgument',
                    `Part ${num} not found or ETag mismatch.`)
                return
            }
            allDiscordParts.push(...part.discordParts)
        }

        const { key } = upload

        // Resolve parent path, creating intermediate directories
        const resolved = await resolveOrCreateParentPath(key)
        if (!resolved) {
            sendS3Error(reply, 'InternalError', 'Could not resolve path.')
            return
        }

        const { parentDirectory, fileName } = resolved

        // Overwrite semantics — delete existing file if present
        const existing = await resolveKey(key)
        if (existing && existing.type === 'file') {
            const existingParts = await db.getFileParts(existing.id)
            try { await req.dfs.deleteParts(existingParts) } catch {}
            await db.deleteDirectory(existing.id, 'file')
        }

        // Create file record in DB
        const fileData = { name: fileName, parentId: parentDirectory.id, type: 'file' }
        const file = await db.createFileWithParts(fileData, allDiscordParts)

        // Cleanup
        uploads.delete(uploadId)

        reply
            .code(200)
            .header('Content-Type', 'application/xml')
            .send([
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<CompleteMultipartUploadResult>',
                `  <Location>/${escapeXml(bucket)}/${escapeXml(key)}</Location>`,
                `  <Bucket>${escapeXml(bucket)}</Bucket>`,
                `  <Key>${escapeXml(key)}</Key>`,
                `  <ETag>"${escapeXml(file.id)}"</ETag>`,
                '</CompleteMultipartUploadResult>',
            ].join('\n'))
    } catch (err) {
        req.log.error(err)
        sendS3Error(reply, 'InternalError')
    }
}

// DELETE /{bucket}/{key}?uploadId=X  —  Abort Multipart Upload
async function abortMultipartUpload(req, reply) {
    const { uploadId } = req.query

    // Clean up Discord attachments for uploaded parts (best-effort)
    const upload = uploads.get(uploadId)
    if (upload) {
        try {
            const allParts = []
            for (const part of upload.parts.values()) {
                allParts.push(...part.discordParts)
            }
            await req.dfs.deleteParts(allParts)
        } catch {
            // Best-effort cleanup — always proceed to delete the upload record
        }
    }

    uploads.delete(uploadId)
    reply.code(204).send('')
}

module.exports = {
    createMultipartUpload,
    uploadPart,
    completeMultipartUpload,
    abortMultipartUpload,
}
