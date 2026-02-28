const crypto = require('crypto')

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

const S3_ERRORS = {
    NoSuchBucket: { status: 404, message: 'The specified bucket does not exist.' },
    NoSuchKey: { status: 404, message: 'The specified key does not exist.' },
    AccessDenied: { status: 403, message: 'Access Denied.' },
    SignatureDoesNotMatch: { status: 403, message: 'The request signature we calculated does not match the signature you provided.' },
    InvalidArgument: { status: 400, message: 'Invalid Argument.' },
    InternalError: { status: 500, message: 'We encountered an internal error. Please try again.' },
}

const errorXml = (code, message, requestId) => `${XML_HEADER}
<Error>
  <Code>${code}</Code>
  <Message>${message || S3_ERRORS[code]?.message || 'Unknown error'}</Message>
  <RequestId>${requestId}</RequestId>
</Error>`

const sendS3Error = (reply, code, message) => {
    const def = S3_ERRORS[code] || { status: 500 }
    const requestId = crypto.randomUUID()
    reply
        .code(def.status)
        .header('Content-Type', 'application/xml')
        .header('x-amz-request-id', requestId)
        .send(errorXml(code, message || def.message, requestId))
}

module.exports = { S3_ERRORS, errorXml, sendS3Error }
