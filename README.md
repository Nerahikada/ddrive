<h1 align="center" style="font-size: 60px"> DDRIVE </h1>

<p align="center"><strong> Turn Discord into a datastore that can manage and store your files. </strong></p>
<p align="center">
    <a href="https://github.com/forscht/ddrive/blob/v2/LICENSE">
        <img src="https://img.shields.io/badge/License-MIT-yellow.svg">
    </a>

</p>
<br>

##### **DDrive** A lightweight cloud storage system using discord as storage device written in nodejs. Supports an unlimited file size and unlimited storage, Implemented using node js streams with multi-part up & download.

https://user-images.githubusercontent.com/59018146/167635903-48cdace0-c383-4e7d-a037-4a32eaa4ab69.mp4

### Features
- Theoretically unlimited file size, thanks to splitting the file in 10MB chunks using nodejs streams API.
- Simple yet robust HTTP front end
- Rest API with OpenAPI 3.1 specifications.
- Tested with storing 4000 GB of data on single discord channel (With max file size of 16GB).
- Supports basic auth with read only public access to panel.
- Optional AES-256 encryption for files uploaded to Discord
- Dark/light mode on panel

### Requirements
- Docker / Podman (recommended), or Node.js v22+
- PostgreSQL
- Discord Webhook URLs

## Setup Guide (Docker / Podman)

1. Clone this project
2. Create webhook URLs on Discord. For better performance, create at least 5 text channels with 1 webhook each. ([How to create webhook URL](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks))
3. Copy `config/.env_sample` to `config/.env` and set your webhook URLs and other options
4. Start with Docker or Podman:
   ```shell
   docker compose up --build
   # or
   podman compose up --build
   ```
5. Navigate to `http://localhost:3000` in your browser.

### Config variables explanation
```shell
# config/.env

# Required params
DATABASE_URL= # Database URL of postgres with valid postgres uri

WEBHOOKS={url1},{url2} # Webhook urls separated by ","

# Optional params
PORT=3000 # HTTP Port where ddrive panel will start running

REQUEST_TIMEOUT=60000 # Time in ms after which ddrive will abort request to discord api server. Set it high if you have very slow internet

CHUNK_SIZE=10165824 # ~10MB max. Discord webhooks limit uploads to 10MB per request

SECRET=someverysecuresecret # If you set this every files on discord will be stored using strong encryption, but it will cause significantly high cpu usage, so don't use it unless you're storing important stuff

AUTH=admin:admin # Username password separated by ":". If you set this panel will ask for username password before access

PUBLIC_ACCESS=READ_ONLY_FILE # If you want to give read only access to panel or file use this option. Check below for valid options.
                             # READ_ONLY_FILE - User will be only access download links of file and not panel
                             # READ_ONLY_PANEL - User will be able to browse the panel for files/directories but won't be able to upload/delete/rename any file/folder.

UPLOAD_CONCURRENCY=3 # ddrive will upload this many chunks in parallel to discord. If you have fast internet increasing it will significantly increase performance at cost of cpu/disk usage

```

## API Usage
```javascript
const { DFs, HttpServer } = require('@forscht/ddrive')

const DFsConfig = {
  chunkSize: 10165824,
  webhooks: 'webhookURL1,webhookURL2',
  secret: 'somerandomsecret',
  maxConcurrency: 3, // UPLOAD_CONCURRENCY
  restOpts: {
    timeout: '60000',
  },
}

const httpConfig = {
  authOpts: {
    auth: { user: 'admin', pass: 'admin' },
    publicAccess: 'READ_ONLY_FILE', // or 'READ_ONLY_PANEL'
  },
  port: 8080,
}

const run = async () => {
  // Create DFs Instance
  const dfs = new DFs(DFsConfig)
  // Create HTTP Server instance
  const httpServer = HttpServer(dfs, httpConfig)

  return httpServer.listen({ host: '0.0.0.0', port: httpConfig.port })
}

run().then()

```

Feel free to create [new issue](https://github.com/forscht/ddrive/issues/new) if it's not working for you or need any help.
