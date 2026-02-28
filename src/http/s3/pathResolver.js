const knex = require('../api/utils/knex')

/**
 * Get root directory (parentId IS NULL)
 */
const getRoot = async () => knex('directory').whereNull('parentId').first()

/**
 * Resolve an S3 key to a file or directory record by traversing the directory hierarchy.
 * Returns the record or null if not found.
 */
const resolveKey = async (key) => {
    if (!key) return getRoot()

    const segments = key.split('/').filter(Boolean)
    if (!segments.length) return getRoot()

    let current = await getRoot()
    if (!current) return null

    for (const segment of segments) {
        const child = await knex('directory')
            .where({ parentId: current.id, name: segment })
            .first()
        if (!child) return null
        current = child
    }

    return current
}

/**
 * Resolve the parent path of a key, creating intermediate directories as needed.
 * Returns { parentDirectory, fileName }
 */
const resolveOrCreateParentPath = async (key) => {
    const segments = key.split('/').filter(Boolean)
    if (!segments.length) return null

    const fileName = segments.pop()
    let parent = await getRoot()
    if (!parent) return null

    for (const segment of segments) {
        let child = await knex('directory')
            .where({ parentId: parent.id, name: segment, type: 'directory' })
            .first()

        if (!child) {
            const [created] = await knex('directory')
                .insert({ name: segment, parentId: parent.id, type: 'directory' })
                .returning('*')
                .onConflict(['parentId', 'name'])
                .merge()
            child = created
        }
        parent = child
    }

    return { parentDirectory: parent, fileName }
}

/**
 * Build full key path for a record by walking up the tree.
 * Excludes the root directory name.
 */
const buildKeyPath = async (record) => {
    const parts = []
    let current = record
    while (current && current.parentId) {
        parts.unshift(current.name)
        current = await knex('directory').where({ id: current.parentId }).first()
    }

    return parts.join('/')
}

/**
 * List objects under a prefix for ListObjectsV2.
 */
const listByPrefix = async (prefix, delimiter, maxKeys, continuationToken, startAfter) => {
    const prefixPath = prefix || ''
    const dirPath = prefixPath.replace(/\/$/, '')

    let parentDir
    if (!dirPath) {
        parentDir = await getRoot()
    } else {
        parentDir = await resolveKey(dirPath)
    }

    const contents = []
    const commonPrefixes = []

    if (!parentDir || parentDir.type === 'file') {
        if (parentDir && parentDir.type === 'file') {
            const sizeResult = await knex('block')
                .where({ fileId: parentDir.id })
                .sum('size as size')
                .first()
            contents.push({
                key: prefixPath,
                lastModified: new Date(parentDir.createdAt).toISOString(),
                etag: parentDir.id,
                size: parseInt(sizeResult?.size || '0', 10),
            })
        }

        return {
            contents,
            commonPrefixes,
            isTruncated: false,
            nextContinuationToken: null,
        }
    }

    const childQuery = knex('directory')
        .where({ parentId: parentDir.id })
        .leftJoin('block', 'directory.id', 'block.fileId')
        .select('directory.*')
        .select(knex.raw('sum(block.size) as size'))
        .groupBy('directory.id')
        .orderBy('directory.name')

    // Apply start-after filter (only when no continuation token)
    const effectiveStartAfter = !continuationToken && startAfter
        ? startAfter.split('/').filter(Boolean).pop()
        : null
    if (effectiveStartAfter) {
        childQuery.where('directory.name', '>', effectiveStartAfter)
    }

    const children = await childQuery

    let offset = 0
    if (continuationToken) {
        try {
            offset = parseInt(Buffer.from(continuationToken, 'base64').toString(), 10)
        } catch { /* ignore invalid token */ }
    }

    const sliced = children.slice(offset, offset + maxKeys + 1)
    const isTruncated = sliced.length > maxKeys
    const items = sliced.slice(0, maxKeys)

    const basePath = prefixPath.endsWith('/') || !prefixPath ? prefixPath : `${prefixPath}/`
    for (const child of items) {
        if (child.type === 'directory') {
            if (delimiter) {
                commonPrefixes.push(`${basePath}${child.name}/`)
            } else {
                const subResult = await listByPrefix(
                    `${basePath}${child.name}/`, null, maxKeys - contents.length, null,
                )
                contents.push(...subResult.contents)
            }
        } else {
            contents.push({
                key: `${basePath}${child.name}`,
                lastModified: new Date(child.createdAt).toISOString(),
                etag: child.id,
                size: parseInt(child.size || '0', 10),
            })
        }
    }

    return {
        contents,
        commonPrefixes,
        isTruncated,
        nextContinuationToken: isTruncated
            ? Buffer.from(String(offset + maxKeys)).toString('base64')
            : null,
    }
}

module.exports = {
    resolveKey,
    resolveOrCreateParentPath,
    buildKeyPath,
    listByPrefix,
}
