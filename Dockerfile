# Production-grade Playwright/Puppeteer Dockerfile with multi-stage build
# Build stage - for compiling the application and installing browsers
FROM node:20-bookworm AS builder

# Railway provides Git metadata to Docker builds through build arguments. Keep
# this build-only so the immutable source SHA is compiled into the artifact and
# is never sourced from a mutable runtime variable.
ARG RAILWAY_GIT_COMMIT_SHA
# Build-only debconf frontend: unattended package installation must not probe
# terminal/dialog frontends inside Railway's non-interactive builder.
ARG DEBIAN_FRONTEND=noninteractive

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

COPY package*.json ./
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN rm -rf node_modules || true && \
    npm ci --legacy-peer-deps

COPY . .

RUN node scripts/cryptocrawl/verify-payout-recipient-truth.cjs && \
    node scripts/cryptocrawl/verify-operator-treasury-strategy.cjs && \
    node scripts/cryptocrawl/verify-controlled-loss-learning.cjs && \
    node scripts/cryptocrawl/verify-system-native-gas-spend-authority.cjs && \
    node scripts/cryptocrawl/verify-kalshi-coinbase-funding-integration.cjs && \
    for script in scripts/cryptocrawl/verify-nix-gen-*.cjs; do node "$script" || exit 1; done && \
    for script in scripts/cryptocrawl/verify-nix-gen-*.ts; do npx --no-install tsx "$script" || exit 1; done && \
    npm run build && \
    node scripts/cryptocrawl/build-server-overflow-authority.mjs server/cryptara-bootstrap-entry.ts dist/index.js && \
    node scripts/copy-static-assets.cjs && \
    node scripts/verify-build.cjs

FROM node:20-bookworm-slim AS production
ENV NPM_CONFIG_OPTIONAL=false
ENV NPM_CONFIG_LEGACY_PEER_DEPS=true
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN apt-get update && apt-get install -y \
    ca-certificates \
    chromium \
    libimage-exiftool-perl \
    poppler-utils \
    tesseract-ocr \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN rm -rf node_modules || true && \
    npm ci --omit=dev --legacy-peer-deps --ignore-optional && \
    npm install --no-save --legacy-peer-deps --ignore-optional drizzle-kit@0.31.8
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle.neon.config.ts ./drizzle.neon.config.ts
COPY --from=builder /app/shared/schema.ts ./shared/schema.ts

# CryptoCrawler Overflow runtime authority migrations. 016 is intentionally
# omitted because it owns an external scheduler and must not be duplicated.
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
COPY --from=builder /app/server/migrations/026_cryptocrawler_system_capital_allocations.sql ./dist/migrations/026_cryptocrawler_system_capital_allocations.sql
COPY --from=builder /app/server/migrations/027_cryptocrawler_cex_system_owned_lots.sql ./dist/migrations/027_cryptocrawler_cex_system_owned_lots.sql
COPY --from=builder /app/server/migrations/028_cryptocrawler_payout_recipient_confirmation.sql ./dist/migrations/028_cryptocrawler_payout_recipient_confirmation.sql
COPY --from=builder /app/server/migrations/029_cryptocrawler_terminal_sweep_recipient_confirmation.sql ./dist/migrations/029_cryptocrawler_terminal_sweep_recipient_confirmation.sql
COPY --from=builder /app/server/migrations/030_cryptocrawler_payout_confirmation_truth_guard.sql ./dist/migrations/030_cryptocrawler_payout_confirmation_truth_guard.sql
COPY --from=builder /app/server/migrations/031_cryptocrawler_payout_confirmation_wait.sql ./dist/migrations/031_cryptocrawler_payout_confirmation_wait.sql
COPY --from=builder /app/server/migrations/032_cryptocrawler_operator_trading_strategy.sql ./dist/migrations/032_cryptocrawler_operator_trading_strategy.sql
COPY --from=builder /app/server/migrations/033_cryptocrawler_operator_strategy_sequential_submission.sql ./dist/migrations/033_cryptocrawler_operator_strategy_sequential_submission.sql
COPY --from=builder /app/server/migrations/034_cryptocrawler_system_capital_treasury_strategy.sql ./dist/migrations/034_cryptocrawler_system_capital_treasury_strategy.sql
COPY --from=builder /app/server/migrations/035_cryptocrawler_payout_funding_and_exact_transfer.sql ./dist/migrations/035_cryptocrawler_payout_funding_and_exact_transfer.sql
COPY --from=builder /app/server/migrations/036_cryptocrawler_system_capital_wallet_sweep.sql ./dist/migrations/036_cryptocrawler_system_capital_wallet_sweep.sql
COPY --from=builder /app/server/migrations/037_cryptocrawler_treasury_reservation_unification.sql ./dist/migrations/037_cryptocrawler_treasury_reservation_unification.sql
COPY --from=builder /app/server/migrations/038_cryptocrawler_system_capital_sweep_idempotency.sql ./dist/migrations/038_cryptocrawler_system_capital_sweep_idempotency.sql
COPY --from=builder /app/server/migrations/039_cryptocrawler_system_capital_transfer_truth_hardening.sql ./dist/migrations/039_cryptocrawler_system_capital_transfer_truth_hardening.sql
COPY --from=builder /app/server/migrations/040_cryptocrawler_treasury_reservation_lifecycle_guard.sql ./dist/migrations/040_cryptocrawler_treasury_reservation_lifecycle_guard.sql
COPY --from=builder /app/server/migrations/041_cryptocrawler_controlled_loss_learning.sql ./dist/migrations/041_cryptocrawler_controlled_loss_learning.sql
COPY --from=builder /app/server/migrations/042_cryptocrawler_onchain_system_capital.sql ./dist/migrations/042_cryptocrawler_onchain_system_capital.sql
COPY --from=builder /app/server/migrations/043_cryptocrawler_cross_chain_lifecycle.sql ./dist/migrations/043_cryptocrawler_cross_chain_lifecycle.sql
COPY --from=builder /app/server/migrations/044_cryptocrawler_funding_feedback_recovery.sql ./dist/migrations/044_cryptocrawler_funding_feedback_recovery.sql
COPY --from=builder /app/server/migrations/045_cryptocrawler_system_native_gas_spend_authority.sql ./dist/migrations/045_cryptocrawler_system_native_gas_spend_authority.sql
COPY --from=builder /app/server/migrations/046_cryptocrawler_kalshi_system_owned_margin_capital.sql ./dist/migrations/046_cryptocrawler_kalshi_system_owned_margin_capital.sql
COPY --from=builder /app/server/migrations/047_cryptocrawler_kalshi_event_system_owned_cash.sql ./dist/migrations/047_cryptocrawler_kalshi_event_system_owned_cash.sql
COPY --from=builder /app/server/migrations/048_cryptocrawler_kalshi_event_lifecycle.sql ./dist/migrations/048_cryptocrawler_kalshi_event_lifecycle.sql
COPY --from=builder /app/server/migrations/049_cryptocrawler_kalshi_probability_calibration.sql ./dist/migrations/049_cryptocrawler_kalshi_probability_calibration.sql
COPY --from=builder /app/server/migrations/050_cryptocrawler_kalshi_event_market_maker.sql ./dist/migrations/050_cryptocrawler_kalshi_event_market_maker.sql
COPY --from=builder /app/server/migrations/051_cryptocrawler_polymarket_event_order_recovery.sql ./dist/migrations/051_cryptocrawler_polymarket_event_order_recovery.sql
COPY --from=builder /app/server/migrations/052_cryptocrawler_polymarket_system_owned_cash.sql ./dist/migrations/052_cryptocrawler_polymarket_system_owned_cash.sql
COPY --from=builder /app/server/migrations/053_cryptocrawler_cross_venue_event_lifecycle.sql ./dist/migrations/053_cryptocrawler_cross_venue_event_lifecycle.sql
COPY --from=builder /app/server/migrations/054_cryptocrawler_polymarket_redemption_recovery.sql ./dist/migrations/054_cryptocrawler_polymarket_redemption_recovery.sql
COPY --from=builder /app/server/migrations/055_cryptocrawler_coinbase_system_owned_capital.sql ./dist/migrations/055_cryptocrawler_coinbase_system_owned_capital.sql
COPY --from=builder /app/server/migrations/056_subagent_runtime_prerequisites.sql ./dist/migrations/056_subagent_runtime_prerequisites.sql
COPY --from=builder /app/server/migrations/057_cryptocrawler_ghost_wallet_runtime.sql ./dist/migrations/057_cryptocrawler_ghost_wallet_runtime.sql
COPY --from=builder /app/server/migrations/058_cryptocrawler_ghost_wallet_gas_reserve.sql ./dist/migrations/058_cryptocrawler_ghost_wallet_gas_reserve.sql
COPY --from=builder /app/server/migrations/059_cryptocrawler_zero_capital_rescue_fairness.sql ./dist/migrations/059_cryptocrawler_zero_capital_rescue_fairness.sql
COPY --from=builder /app/server/migrations/060_lexara_overflow_conversation_history.sql ./dist/migrations/060_lexara_overflow_conversation_history.sql
COPY --from=builder /app/server/migrations/061_pantheon_durable_frontier.sql ./dist/migrations/061_pantheon_durable_frontier.sql
COPY --from=builder /app/server/migrations/overflow/001_cryptara_comp_cache.sql ./dist/migrations/overflow/001_cryptara_comp_cache.sql
COPY --from=builder /app/server/migrations/overflow/002_cryptara_parallel_proxy.sql ./dist/migrations/overflow/002_cryptara_parallel_proxy.sql
COPY --from=builder /app/server/migrations/overflow/003_cryptocrawler_runtime_prerequisites.sql ./dist/migrations/overflow/003_cryptocrawler_runtime_prerequisites.sql
COPY --from=builder /app/server/migrations/overflow/004_cryptocrawler_terminal_support.sql ./dist/migrations/overflow/004_cryptocrawler_terminal_support.sql

COPY --from=builder /app/scripts ./scripts
# Pantheon production preflight reads these source manifests directly. Keep the
# verification inputs in the runtime image so deployment validation cannot fail
# solely because the multi-stage image omitted source-only files.
COPY --from=builder /app/server/services/pantheon ./server/services/pantheon
COPY --from=builder /app/server/peopleSearch.ts ./server/peopleSearch.ts
COPY --from=builder /app/client/src/pages/pantheon.tsx ./client/src/pages/pantheon.tsx
COPY --from=builder /app/client/src/components/PantheonProgressTracker.tsx ./client/src/components/PantheonProgressTracker.tsx
COPY --from=builder /app/contracts/cryptocrawl ./contracts/cryptocrawl
COPY --from=builder /app/artifacts/cryptocrawl ./artifacts/cryptocrawl
COPY --from=builder /app/server/services/cryptocrawl/config/chains.json ./config/chains.json
EXPOSE 5000
# Runtime dependencies are immutable/read-only. Avoid recursively changing the
# very large node_modules tree; only application-owned paths need writable owner.
RUN useradd -m appuser && \
    chown appuser:appuser /app && \
    chown -R appuser:appuser /app/dist /app/public /app/scripts /app/contracts /app/artifacts /app/config
USER appuser
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const port = process.env.PORT || 5000; require('http').get('http://localhost:' + port + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => {process.exit(1)})"
CMD ["npm", "start"]
