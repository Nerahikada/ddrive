FROM docker.io/library/node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY docker/entrypoint /entrypoint
RUN chmod +x /entrypoint
HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
    CMD wget -q --spider http://localhost:3000/healthz || exit 1
USER node
ENTRYPOINT ["/entrypoint"]
