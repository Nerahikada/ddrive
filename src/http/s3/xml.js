const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

const escapeXml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const unescapeXml = (str) => String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&gt;/g, '>')
    .replace(/&#62;/g, '>')
    .replace(/&#x3e;/gi, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#60;/g, '<')
    .replace(/&#x3c;/gi, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&#x26;/gi, '&')

const listObjectsV2Response = ({
    name, prefix, delimiter, maxKeys, keyCount,
    isTruncated, contents, commonPrefixes, continuationToken, nextContinuationToken,
    encodingType,
}) => `${XML_HEADER}
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(name)}</Name>
  <Prefix>${escapeXml(prefix || '')}</Prefix>
  ${delimiter ? `<Delimiter>${escapeXml(delimiter)}</Delimiter>` : ''}
  ${encodingType ? `<EncodingType>${escapeXml(encodingType)}</EncodingType>` : ''}
  <MaxKeys>${maxKeys}</MaxKeys>
  <KeyCount>${keyCount}</KeyCount>
  <IsTruncated>${isTruncated}</IsTruncated>
  ${continuationToken ? `<ContinuationToken>${escapeXml(continuationToken)}</ContinuationToken>` : ''}
  ${nextContinuationToken ? `<NextContinuationToken>${escapeXml(nextContinuationToken)}</NextContinuationToken>` : ''}
  ${contents.map((c) => `<Contents>
    <Key>${escapeXml(c.key)}</Key>
    <LastModified>${c.lastModified}</LastModified>
    <ETag>"${escapeXml(c.etag)}"</ETag>
    <Size>${c.size}</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>`).join('\n  ')}
  ${commonPrefixes.map((p) => `<CommonPrefixes>
    <Prefix>${escapeXml(p)}</Prefix>
  </CommonPrefixes>`).join('\n  ')}
</ListBucketResult>`

module.exports = { escapeXml, unescapeXml, listObjectsV2Response }
