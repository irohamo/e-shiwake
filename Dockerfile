FROM node:24.22.1-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
ENV PUBLIC_ACCOUNTING_MODE=server
RUN npm run build
RUN npm prune --omit=dev --offline --ignore-scripts --no-audit --no-fund

FROM node:24.22.1-bookworm-slim
ENV NODE_ENV=production PUBLIC_ACCOUNTING_MODE=server ACCOUNTING_MODE=server HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "build"]
