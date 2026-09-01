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

# Build application (requires dev dependencies). The normal build proves the full
# source tree. The deployed server bundle is then rebuilt through the mandatory
# CryptoCrawler Overflow authority router so every reachable CryptoCrawler import
# of server/db resolves to Overflow and canonical runtime install requires the
# complete Overflow schema proof.
RUN npm run build && \
    node scripts/cryptocrawl/build-server-overflow-authority.mjs server/cryptara-bootstrap-entry.ts dist/index.js && \
    node scripts/copy-static-assets.cjs && \
    node scripts/verify-build.cjs

# Production stage
FROM node:20-bookworm-slim AS production

# Avoid installing optional native dependencies in production
ENV NPM_CONFIG_OPTIONAL=false
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true

# NOTE: Chromium installation removed - using playwright-core for remote browser connection
# Install only minimal dependencies for Node.js runtime
RUN apt-get update && apt-get install -y \
    ca-certificates \
    chromium \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configure Playwright to skip browser downloads (using playwright-core)
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

# CryptoCrawler Overflow is a complete runtime authority plane. Bundle every
# idempotent state/schema migration required by runtime execution, governance,
# learning, settlement and payout state. 016 is intentionally omitted because it
# installs pg_cron/pg_net and an active external payout scheduler; mirroring state
# must never create a second independent transaction scheduler.
COPY --from=builder /app/server/migrations/007_zero_capital_execution_ledger.sql ./dist/migrations/007_zero_capital_execution_ledger.sql
COPY --from=builder /app/server/migrations/008_zero_capital_capital_provenance.sql ./dist/migrations/008_zero_capital_capital_provenance.sql
COPY --from=builder /app/server/migrations/009_railway_bootstrap_budget.sql ./dist/migrations/009_railway_bootstrap_budget.sql
COPY --from=builder /app/server/migrations/010_cryptocrawl_governance_state.sql ./dist/migrations/010_cryptocrawl_governance_state.sql
COPY --from=builder /app/server/migrations/011_zero_capital_native_gas_funding.sql ./dist/migrations/011_zero_capital_native_gas_funding.sql
COPY --from=builder /app/server/migrations/012_zero_capital_profit_recipient_proof.sql ./dist/migrations/012_zero_capital_profit_recipient_proof.sql
COPY --from=builder /app/server/migrations/013_cryptocrawler_private_intelligence_memory.sql ./dist/migrations/013_cryptocrawler_private_intelligence_memory.sql
COPY --from=builder /app/server/migrations/014_cryptocrawler_private_outbox.sql ./dist/migrations/014_cryptocrawler_private_outbox.sql
COPY --from=builder /app/server/migrations/015_cryptocrawler_terminal_treasury_sweep.sql ./dist/migrations/015_cryptocrawler_terminal_treasury_sweep.sql
COPY --from=builder /app/server/migrations/017_cryptocrawler_terminal_sweep_truth_guard.sql ./dist/migrations/017_cryptocrawler_terminal_sweep_truth_guard.sql
COPY --from=builder /app/server/migrations/018_cryptocrawler_profit_split_eth_payout.sql ./dist/migrations/018_cryptocrawler_profit_split_eth_payout.sql
COPY --from=builder /app/server/migrations/019_cryptocrawler_dynamic_payout_strategy.sql ./dist/migrations/019_cryptocrawler_dynamic_payout_strategy.sql
COPY --from=builder /app/server/migrations/020_cryptocrawler_trade_safe_payout_liquidity.sql ./dist/migrations/020_cryptocrawler_trade_safe_payout_liquidity.sql
COPY --from=builder /app/server/migrations/021_cryptocrawler_inventory_access_hardening.sql ./dist/migrations/021_cryptocrawler_inventory_access_hardening.sql
COPY --from=builder /app/server/migrations/022_cryptocrawler_payout_destination_fallback.sql ./dist/migrations/022_cryptocrawler_payout_destination_fallback.sql
COPY --from=builder /app/server/migrations/023_cryptocrawler_hot_path_schema_authority.sql ./dist/migrations/023_cryptocrawler_hot_path_schema_authority.sql
COPY --from=builder /app/server/migrations/024_cryptocrawler_funding_lifecycle.sql ./dist/migrations/024_cryptocrawler_funding_lifecycle.sql
COPY --from=builder /app/server/migrations/025_cryptocrawler_rainbow_source_ledger.sql ./dist/migrations/025_cryptocrawler_rainbow_source_ledger.sql

# Overflow-only prerequisites complete migration gaps found by the repository-wide
# authority audit without enabling duplicate schedulers or browser/API access.
COPY --from=builder /app/server/migrations/overflow/001_cryptara_comp_cache.sql ./dist/migrations/overflow/001_cryptara_comp_cache.sql
COPY --from=builder /app/server/migrations/overflow/002_cryptara_parallel_proxy.sql ./dist/migrations/overflow/002_cryptara_parallel_proxy.sql
COPY --from=builder /app/server/migrations/overflow/003_cryptocrawler_runtime_prerequisites.sql ./dist/migrations/overflow/003_cryptocrawler_runtime_prerequisites.sql
COPY --from=builder /app/server/migrations/overflow/004_cryptocrawler_terminal_support.sql ./dist/migrations/overflow/004_cryptocrawler_terminal_support.sql

# Copy necessary runtime files
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/contracts/cryptocrawl ./contracts/cryptocrawl
COPY --from=builder /app/artifacts/cryptocrawl ./artifacts/cryptocrawl
COPY --from=builder /app/server/services/cryptocrawl/config/chains.json ./config/chains.json

# Expose application port (Railway will use PORT env var)
EXPOSE 5000

# Create non-root user for security
RUN useradd -m appuser && \
    chown -R appuser:appuser /app

USER appuser

# Health check using dynamic port (Railway sets PORT env var)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const port = process.env.PORT || 5000; require('http').get('http://localhost:' + port + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => {process.exit(1)})"

CMD ["npm", "start"]