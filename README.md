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

## Configuration

### Webhook URLs via file

Instead of setting the `WEBHOOKS` env var, you can list webhook URLs in a `webhook.txt` file at the project root (one URL per line). If this file exists, it takes priority over the `WEBHOOKS` env var.

```
https://discord.com/api/webhooks/1234567890/abcdef...
https://discord.com/api/webhooks/0987654321/fedcba...
```

### Config variables

See [`config/.env_sample`](config/.env_sample) for all available options with defaults and descriptions.

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
