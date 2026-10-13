# 코스모스 릴레이 — the relay plus the phone web app it serves.
# Build context: apps/relay, after `npm run stage:web` filled ./renderer
# (deploy/cosmos/deploy.sh does both). TLS is Caddy's job (compose.yml).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9800 \
    DATA_DIR=/data \
    RENDERER_DIR=/app/renderer \
    TRUST_PROXY=1 \
    NODE_OPTIONS=--max-old-space-size=512
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.mjs ./
COPY lib ./lib
COPY renderer ./renderer
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 9800
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9800/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
