# Production-grade Puppeteer Dockerfile with multi-stage build
# Build stage - for compiling the application
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (needed for build stage)
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    g++ \
    make \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Clean any existing node_modules and install ALL dependencies (needed for build)
# Use --ignore-scripts to skip problematic native module build scripts in builder
RUN rm -rf node_modules || true && \
    npm ci --legacy-peer-deps

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

# Install Chromium and all required runtime dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    xdg-utils \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox"

WORKDIR /app

# Copy package files and install only production dependencies
# Skip optional deps to avoid native module build failures
COPY package*.json ./
RUN rm -rf node_modules || true && \
    npm ci --omit=dev --legacy-peer-deps --ignore-optional

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Copy necessary runtime files
COPY --from=builder /app/scripts ./scripts

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
