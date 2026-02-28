/* eslint-disable no-restricted-syntax,no-await-in-loop */
const https = require('https')
const crypto = require('crypto')
const { REST } = require('@discordjs/rest')
const uuid = require('uuid').v4
const AsyncStreamProcessorWithConcurrency = require('./lib/AsyncStreamProcessorWithConcurrency')
const AsyncStreamProcessor = require('./lib/AsyncStreamProcessor')
const StreamChunker = require('./lib/StreamChunker')

const DEFAULT_CHUNK_SIZE = 10165824 // ~10MB
const DEFAULT_ENCRYPTION = 'aes-256-ctr'
const DEFAULT_REST_OPTS = { version: 10, timeout: 60000 }
const DEFAULT_MAX_UPLOAD_CONCURRENCY = 3

class DiscordFileSystem {
    constructor(opts) {
        this.webhooks = opts.webhooks
        this.maxUploadConc = opts.maxUploadConc || DEFAULT_MAX_UPLOAD_CONCURRENCY
        this.chunkSize = opts.chunkSize || DEFAULT_CHUNK_SIZE
        this.encAlg = opts.encAlg || DEFAULT_ENCRYPTION
        this.secret = opts.secret
        this.rest = new REST({ ...DEFAULT_REST_OPTS, ...opts.restOpts })
        this.lastWbIdx = 0

        //
        // Validate parameters
        //
        if (!this.webhooks) throw new Error('webhooks parameter is missing')
        if (!this.webhooks.length) throw new Error('At least 1 valid webhookURL required')

        if (!Number.isFinite(this.chunkSize)
            || this.chunkSize < 1
            || this.chunkSize > 10485760) {
            throw new Error('Invalid chunkSize - chunkSize should be valid number and > 1 and < 10485760')
        }

        const { timeout } = opts.restOpts
        if (!Number.isFinite(timeout) || timeout < 1) {
            throw new Error('Invalid timeout - timeout should be valid number and > 0')
        }
    }

    static parseWebhookURL(url) {
        const match = url.match(/webhooks\/(\d+)\/([A-Za-z0-9_-]+)/)
        if (!match) throw new Error(`Invalid webhook URL: ${url}`)

        return { id: match[1], token: match[2] }
    }

    static isURLExpired(url) {
        try {
            const parsed = new URL(url)
            const ex = parsed.searchParams.get('ex')
            if (!ex) return false
            const expiresAt = parseInt(ex, 16)
            const now = Math.floor(Date.now() / 1000)

            return now >= expiresAt - 300
        } catch {
            return false
        }
    }

    /**
     * @description Encrypt the given buffer
     * @param secret
     * @param data
     * @returns {{encrypted: Buffer, iv: string}}
     * @private
     */
    _encrypt(secret, data) {
        // Create hash for given secret
        const key = crypto.createHash('sha256').update(secret).digest()
        // Create iv
        const iv = crypto.randomBytes(16)
        // Create cipher and encrypt the data
        const cipher = crypto.createCipheriv(this.encAlg, key, iv)
        let encrypted = cipher.update(data)
        encrypted = Buffer.concat([encrypted, cipher.final()])
        // Return iv and encrypted data

        return {
            iv: iv.toString('hex'),
            encrypted,
        }
    }

    /**
     * @description Returns the decryption cipher
     * @param secret
     * @param iv
     * @private
     */
    _decrypt(secret, iv) {
        // Create key hash
        const key = crypto.createHash('sha256').update(secret).digest()
        // Return decipher transform stream

        return crypto.createDecipheriv(this.encAlg, key, Buffer.from(iv, 'hex'))
    }

    /**
     * @description Upload single file to discord
     * @param file {Object}
     * @returns {Promise<{response: Object, webhookId: string, webhookToken: string}>}
     * @private
     */
    async _uploadFile(file) {
        const rawURL = this.webhooks[this.lastWbIdx]
        this.lastWbIdx = (this.lastWbIdx + 1) % this.webhooks.length
        const apiPath = rawURL.replace('https://discord.com/api', '')
        const { id: webhookId, token: webhookToken } = DiscordFileSystem.parseWebhookURL(rawURL)
        const response = await this.rest.post(apiPath, { files: [file], auth: false })

        return { response, webhookId, webhookToken }
    }

    /**
     * @description Refresh an expired attachment URL via webhook message API
     * @param webhookId {string}
     * @param webhookToken {string}
     * @param messageId {string}
     * @returns {Promise<string>}
     */
    async refreshURL(webhookId, webhookToken, messageId) {
        const path = `/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`
        const message = await this.rest.get(path, { auth: false })
        if (!message.attachments || !message.attachments.length) {
            throw new Error(`No attachments found in message ${messageId}`)
        }

        return message.attachments[0].url
    }

    /**
     * @description Read files from discord and write it to stream
     * @param stream
     * @param parts {Array}
     * @returns {Promise<void>}
     */
    async read(stream, parts) {
        for (const part of parts) {
            let { url } = part
            if (DiscordFileSystem.isURLExpired(url) && part.messageId && part.webhookId && part.webhookToken) {
                try {
                    url = await this.refreshURL(part.webhookId, part.webhookToken, part.messageId)
                } catch (err) {
                    throw new Error(`Failed to refresh expired URL for message ${part.messageId}: ${err.message}`)
                }
            }
            let headers = {}
            if (part.start || part.end) headers = { Range: `bytes=${part.start || 0}-${part.end || ''}` }
            await new Promise((resolve, reject) => {
                https.get(url, { headers }, (res) => {
                    // Handle incoming data chunks from discord server
                    const handleData = async (data) => {
                        // https://nodejs.org/docs/latest-v16.x/api/stream.html#writablewritechunk-encoding-callback
                        if (!stream.write(data)) {
                            await new Promise((r) => stream.once('drain', r))
                        }
                    }
                    // Handle Decryption if file is encrypted
                    if (part.iv) {
                        if (!this.secret) throw new Error('secret not provided')
                        // Create decipher
                        const decipher = this._decrypt(this.secret, part.iv)
                        decipher.on('end', () => resolve())
                        decipher.on('error', (err) => reject(err))
                        res.pipe(decipher).pipe(new AsyncStreamProcessor(handleData))
                    } else {
                        res.pipe(new AsyncStreamProcessor(handleData))
                        res.on('end', () => resolve())
                    }

                    res.on('error', (err) => reject(err))
                })
            })
        }
        stream.end()
    }

    /**
     * @description Read from readable stream and upload file on discord in chunks
     * @param stream
     * @returns {Promise<unknown>}
     */
    async write(stream) {
        const parts = []
        // This function will be executed to process each chunk for file
        const processChunk = async (data, chunkCount) => {
            // Encrypt the data if secret is provided
            let iv
            let encrypted
            if (this.secret)({ iv, encrypted } = this._encrypt(this.secret, data))
            // Upload file to discord
            const part = { name: uuid(), data: encrypted || data }
            const { response, webhookId, webhookToken } = await this._uploadFile(part)
            const { attachments: [attachment] } = response
            // Push part object into array and return later
            parts[chunkCount] = {
                url: attachment.url,
                size: attachment.size,
                iv,
                messageId: response.id,
                webhookId,
                webhookToken,
            }
        }

        return new Promise((resolve, reject) => {
            stream
                .on('aborted', () => reject(new Error('file upload aborted'))) // On HTTP request abort delete all the messages and reject promise
                .pipe(new StreamChunker(this.chunkSize))
                .pipe(new AsyncStreamProcessorWithConcurrency(processChunk, this.maxUploadConc))
                .on('finish', () => resolve(parts))
                .on('error', (err) => reject(err))
        })
    }
}

module.exports = DiscordFileSystem
