const config = require('./config')()
const { DFs, HttpServer } = require('../src')
const knex = require('../src/http/api/utils/knex')

const startApp = async () => {
    const { DFsConfig, httpConfig } = config
    // Create DFs Instance
    const dfs = new DFs(DFsConfig)
    // Create http Server instance
    const httpServer = HttpServer(dfs, httpConfig)

    await httpServer.listen({ host: '::', port: httpConfig.port })

    const shutdown = async () => {
        await httpServer.close()
        await knex.destroy()
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
}

startApp().then()
