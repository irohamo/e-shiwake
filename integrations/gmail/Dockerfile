FROM node:24.22.1-bookworm-slim
WORKDIR /ingest
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY *.mjs ./
USER node
ENV GMAIL_STATE_DIR=/state
CMD ["node", "fetch.mjs"]
