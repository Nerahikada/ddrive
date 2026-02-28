exports.up = async (knex) => {
    await knex.schema.alterTable('block', (table) => {
        table.string('messageId').nullable()
        table.string('webhookId').nullable()
        table.string('webhookToken').nullable()
    })
}

exports.down = async (knex) => {
    await knex.schema.alterTable('block', (table) => {
        table.dropColumn('messageId')
        table.dropColumn('webhookId')
        table.dropColumn('webhookToken')
    })
}
