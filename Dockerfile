# Production-grade Playwright/Puppeteer Dockerfile with multi-stage build
# Build stage - for compiling the application and installing browsers
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules and Playwright browser installation
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    g++ \
    make \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Clean any existing node_modules and install ALL dependencies (needed for build)
RUN rm -rf node_modules || true && \
    npm ci --legacy-peer-deps

# NOTE: Playwright browser installation removed - using playwright-core for remote browser connection
# No local browsers needed; connect to remote browser via BROWSER_WS_ENDPOINT env var

# Copy application code
COPY . .

# Build application (requires dev dependencies)
RUN npm run build && \
    node scripts/copy-static-assets.cjs && \
    node scripts/verify-build.cjs

# Production stage
FROM node:20-bookworm-slim AS production

# Avoid installing optional native dependencies in production
ENV NPM_CONFIG_OPTIONAL=false
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true

# NOTE: Chromium installation removed - using playwright-core with remote browser connection
# Install only minimal dependencies for Node.js runtime
RUN apt-get update && apt-get install -y \
    ca-certificates \
    chromium \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configure Playwright to skip browser downloads (using playwright-core)
# Browser connection will use BROWSER_WS_ENDPOINT env var at runtime
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files and install only production dependencies
# Skip optional deps to avoid native module build failures
COPY package*.json ./
RUN rm -rf node_modules || true && \
    npm ci --omit=dev --legacy-peer-deps --ignore-optional

# NOTE: Playwright browser installation removed
# Using playwright-core for remote browser connection via BROWSER_WS_ENDPOINT

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Copy necessary runtime files
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/server/services/cryptocrawl/config/chains.json ./config/chains.json

# Expose application port (Railway will use PORT env var at runtime)
EXPOSE 5000

# Create non-root user for security
RUN useradd -m appuser && \
    chown -R appuser:appuser /app

USER appuser

# Health check using dynamic port (Railway sets PORT env var)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const port = process.env.PORT || 5000; require('http').get('http://localhost:' + port + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => {process.exit(1)})"

CMD ["npm", "start"]
