module.exports = async (req, reply) => {
    reply
        .code(200)
        .header('x-amz-bucket-region', 'us-east-1')
        .send('')
}
