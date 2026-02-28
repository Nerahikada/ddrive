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
- **S3-compatible API** — use `aws s3 cp/ls/rm` or any S3 client to manage files directly.
- Tested with storing 4000 GB of data on single discord channel (With max file size of 16GB).
- Supports basic auth with read only public access to panel.
- Optional AES-256 encryption for files uploaded to Discord
- Dark/light mode on panel

### Note on bandwidth
All uploads and downloads are proxied through the ddrive server. This means your server's bandwidth usage is roughly **twice** the actual file size (once for the transfer between the server and Discord, and once between the server and the user). Keep this in mind if your VPS has a monthly bandwidth cap.

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

# S3 Compatible API (set both keys to enable)
S3_ACCESS_KEY_ID=myaccesskey       # AWS-style access key for S3 authentication
S3_SECRET_ACCESS_KEY=mysecretkey   # AWS-style secret key for S3 authentication
S3_BUCKET=ddrive                   # Bucket name (used as URL path prefix, default: ddrive)
```

### S3-Compatible API

When `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set, ddrive exposes an S3-compatible API at `/{bucket}` alongside the existing REST API and web UI. This lets you use standard S3 tools like `aws-cli`, Cyberduck, or any S3-compatible client.

**Supported operations:** PutObject, GetObject, HeadObject, DeleteObject, ListObjectsV2, HeadBucket

```shell
# Configure aws-cli
aws configure set aws_access_key_id myaccesskey
aws configure set aws_secret_access_key mysecretkey
aws configure set default.region us-east-1

# Upload, list, download, delete
aws --endpoint-url http://localhost:3000 s3 cp myfile.txt s3://ddrive/myfile.txt
aws --endpoint-url http://localhost:3000 s3 ls s3://ddrive/
aws --endpoint-url http://localhost:3000 s3 cp s3://ddrive/myfile.txt downloaded.txt
aws --endpoint-url http://localhost:3000 s3 rm s3://ddrive/myfile.txt
```

Feel free to create [new issue](https://github.com/forscht/ddrive/issues/new) if it's not working for you or need any help.
