# Production-grade Playwright/Puppeteer Dockerfile with multi-stage build
# Build stage - for compiling the application and installing browsers
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    g++ \
    make \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN rm -rf node_modules || true && \
    npm ci --legacy-peer-deps

COPY . .

# Diagnostic only: deployment preflight plus the first two trailing package
# prebuild guards. Unified-multileg is intentionally omitted in this pass.
RUN node scripts/cryptocrawl/verify-deployment-preflight.cjs && \
    node scripts/cryptocrawl/verify-zero-capital-bps-propagation.cjs && \
    node scripts/cryptocrawl/verify-bootstrap-execution-history.cjs && \
    npm_config_ignore_scripts=true npm run build && \
    node scripts/copy-static-assets.cjs && \
    node scripts/verify-build.cjs

FROM node:20-bookworm-slim AS production

ENV NPM_CONFIG_OPTIONAL=false
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true

RUN apt-get update && apt-get install -y \
    ca-certificates \
    chromium \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN rm -rf node_modules || true && \
    npm ci --omit=dev --legacy-peer-deps --ignore-optional

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/server/migrations/023_cryptocrawler_hot_path_schema_authority.sql ./dist/migrations/023_cryptocrawler_hot_path_schema_authority.sql
COPY --from=builder /app/server/migrations/024_cryptocrawler_funding_lifecycle.sql ./dist/migrations/024_cryptocrawler_funding_lifecycle.sql
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/contracts/cryptocrawl ./contracts/cryptocrawl
COPY --from=builder /app/artifacts/cryptocrawl ./artifacts/cryptocrawl
COPY --from=builder /app/server/services/cryptocrawl/config/chains.json ./config/chains.json

EXPOSE 5000

RUN useradd -m appuser && \
    chown -R appuser:appuser /app

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const port = process.env.PORT || 5000; require('http').get('http://localhost:' + port + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => {process.exit(1)})"

CMD ["npm", "start"]