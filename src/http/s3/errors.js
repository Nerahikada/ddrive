const crypto = require('crypto')

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

const S3_ERRORS = {
    NoSuchBucket: { status: 404, message: 'The specified bucket does not exist.' },
    NoSuchKey: { status: 404, message: 'The specified key does not exist.' },
    AccessDenied: { status: 403, message: 'Access Denied.' },
    SignatureDoesNotMatch: { status: 403, message: 'The request signature we calculated does not match the signature you provided.' },
    InvalidArgument: { status: 400, message: 'Invalid Argument.' },
    NoSuchUpload: { status: 404, message: 'The specified multipart upload does not exist.' },
    BadDigest: { status: 400, message: 'The Content-MD5 you specified did not match what we received.' },
    InternalError: { status: 500, message: 'We encountered an internal error. Please try again.' },
}

const escapeXml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const errorXml = (code, message, requestId, resource) => `${XML_HEADER}
<Error>
  <Code>${code}</Code>
  <Message>${escapeXml(message || S3_ERRORS[code]?.message || 'Unknown error')}</Message>
  ${resource ? `<Resource>${escapeXml(resource)}</Resource>` : ''}
  <RequestId>${requestId}</RequestId>
</Error>`

const sendS3Error = (reply, code, message, resource) => {
    const def = S3_ERRORS[code] || { status: 500 }
    const requestId = crypto.randomUUID()
    reply
        .code(def.status)
        .header('Content-Type', 'application/xml')
        .header('x-amz-request-id', requestId)
        .send(errorXml(code, message || def.message, requestId, resource))
}

module.exports = { S3_ERRORS, errorXml, sendS3Error }
