FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY docker/entrypoint /entrypoint
RUN chmod +x /entrypoint
USER node
ENTRYPOINT ["/entrypoint"]
