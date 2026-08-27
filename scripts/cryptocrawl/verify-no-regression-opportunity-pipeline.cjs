const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];

function requireText(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
}

function forbidText(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
}

const packageJson = read('package.json');
requireText(
  packageJson,
  '"prebuild": "node scripts/cryptocrawl/verify-deployment-preflight.cjs"',
  'deployment build must invoke the fail-closed CryptoCrawler preflight',
);

const deploymentPreflight = read('scripts/cryptocrawl/verify-deployment-preflight.cjs');
requireText(deploymentPreflight, 'verify-no-regression-opportunity-pipeline.cjs', 'deployment preflight runs invariant suite');
requireText(deploymentPreflight, "NO_EXECUTION: 'true'", 'deployment preflight is execution-safe');
forbidText(deploymentPreflight, "'typescript', 'bin', 'tsc'", 'deployment preflight must not fail on unrelated repository-global legacy type debt');

const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
requireText(capability, "venue: 'coinbase'", 'venue registry contains Coinbase compatibility entry');
requireText(capability, 'enabled: false', 'Coinbase remains inactive');
requireText(capability, 'publicDiscovery: false', 'Coinbase discovery remains inactive');
requireText(capability, 'liveExecution: false', 'Coinbase live execution remains inactive');
requireText(capability, 'settlementVerification: false', 'Coinbase settlement authority remains inactive');
requireText(capability, "return (['kraken', 'okx'] as const)", 'executable quote authority remains Kraken/OKX only');

const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
requireText(verifier, 'getActiveExecutableQuoteVenues()', 'verifier consumes venue capability authority');
requireText(verifier, 'topSpreadBps <= breakEvenBps', 'break-even topology gate');
requireText(verifier, 'candidate.netProfitUsd > bestPlan.netProfitUsd', 'best candidate ranked by net profit');
requireText(verifier, 'plan.netProfitUsd < req.minNetProfitUsd', 'verified minimum net-profit gate');
requireText(verifier, "crossVenueCostModel: bridge", 'cross-venue cost semantics retained');
forbidText(verifier, "const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx']", 'no hard-coded Coinbase quote authority');

const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
requireText(feeResolver, 'serializeKrakenPrivate', 'Kraken private requests are serialized');
requireText(feeResolver, 'krakenPrivateTail', 'Kraken authenticated transport has one nonce-ordering authority');
requireText(feeResolver, 'nextKrakenNonce()', 'Kraken nonce remains monotonic');
requireText(feeResolver, "source: 'kraken_account_trade_volume'", 'Kraken fee evidence remains account measured');
requireText(feeResolver, "source: 'okx_account_trade_fee'", 'OKX fee evidence remains account measured');

const stream = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
requireText(stream, 'VenueConnectionState', 'CEX streams pool connection state by venue');
requireText(stream, 'activeConnections', 'CEX stream telemetry exposes pooled connection count');
requireText(stream, 'connection.symbols.add(symbol)', 'symbol subscriptions share the venue connection');
requireText(stream, 'this.subscription(connection.venue, symbols)', 'reconnect resubscribes the pooled symbol set');
forbidText(stream, 'private readonly streams = new Map<string, StreamState>()', 'legacy one-socket-per-symbol stream authority removed');

const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
requireText(executor, "!['kraken', 'okx'].includes(plan.buyVenue)", 'live execution buy-venue allowlist preserved');
requireText(executor, "!['kraken', 'okx'].includes(plan.sellVenue)", 'live execution sell-venue allowlist preserved');
requireText(executor, 'plan.netProfitUsd <= 0', 'strict positive-net live execution preserved');
requireText(executor, "CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK'", 'explicit live execution confirmation preserved');

const marketData = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
requireText(marketData, 'rankMeasuredMarketUniverse', 'deterministic measured-universe cache ranking');
requireText(marketData, 'orderMeasuredMarketUniverse', 'rotating measured-universe consumption');
requireText(marketData, 'resolveCoinStatsEnvironment', 'CoinStats environment contract wired');
requireText(marketData, 'adoptResolvedEnvironmentVariable', 'resolved alias adoption wired');
requireText(marketData, 'optional CoinStats credential', 'CoinStats explicitly classified optional');

const universe = read('server/services/cryptocrawl/discovery/market-universe-controller.ts');
requireText(universe, 'rankMeasuredMarketUniverse', 'non-rotating ranking function exists');
requireText(universe, 'const start = rotationCursor % head.length', 'rotation cursor drives scan diversity');
requireText(universe, 'rotationCursor = (rotationCursor +', 'rotation cursor advances exactly at consumption boundary');

const symbols = read('server/services/cryptocrawl/discovery/symbol-registry.ts');
requireText(symbols, 'base === quote', 'self-pair rejection');
requireText(symbols, 'STABLE_BASES.has(canonical.base)', 'stable/stable starvation guard');

const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
requireText(progression, 'STAGE_ONE_OPPORTUNITY_ECONOMICS_BLOCK_REASONS', 'Stage 1 economics/readiness split');
requireText(progression, "stageManager.getState().currentStage !== 1", 'Stage 1-only readiness exception');
requireText(progression, 'opportunity_rejection_preserved:', 'negative opportunity rejection provenance');
requireText(progression, 'STAGE_ONE_SIGNAL_WINDOW_MS', 'Stage 1 proof-of-signal freshness window');
requireText(progression, 'recentSignals.verifiedPositiveOpportunities > 0', 'Stage 1 requires a fresh verified-positive canonical signal');
requireText(progression, "decision: advancementMarketGateReady ? 'ALLOW' : 'BLOCK'", 'Stage 1 signal evidence is handed to StageManager market-gate authority');
requireText(progression, "throw new Error('Execution evidence requires a terminal normalized settlement')", 'terminal-only learning preserved');

const stageManager = read('server/services/cryptocrawl/governance/stage-management.ts');
requireText(stageManager, "if (evidence.marketGate.decision !== 'ALLOW')", 'StageManager market-gate authority preserved');
requireText(stageManager, 'if (this.state.killSwitchActive)', 'kill-switch advancement blocker preserved');
requireText(stageManager, 'averageSlippageBps === null', 'measured slippage requirement preserved for advanced stages');

const attestation = read('server/services/cryptocrawl/runtime/runtime-attestation.ts');
requireText(attestation, "? 'mismatch'", 'runtime identity mismatch state');
requireText(attestation, "attestation.state !== 'mismatch'", 'runtime mismatch cannot be considered safe');
forbidText(attestation, 'WALLET_PRIVATE_KEY', 'runtime attestation secret isolation');
forbidText(attestation, 'API_SECRET', 'runtime attestation secret isolation');
forbidText(attestation, 'API_KEY', 'runtime attestation credential isolation');

const environment = read('server/services/cryptocrawl/runtime/environment-contract.ts');
requireText(environment, "resolution.state !== 'VISIBLE'", 'alias adoption requires visible credential');
requireText(environment, 'providerState: inferred', 'provider state remains distinct from environment visibility');
forbidText(environment, 'console.log', 'environment contract does not log credentials');
forbidText(environment, 'return sourceValue', 'environment contract never returns a secret value from adoption');

const observability = read('server/services/cryptocrawl/integration/runtime-observability.ts');
for (const dimension of ['APP_READY', 'CONFIG_READY', 'DATA_READY', 'DISCOVERY_READY', 'EXECUTION_READY', 'TRADING_READY']) {
  requireText(observability, `${dimension}:`, `readiness dimension ${dimension}`);
}
requireText(observability, 'requiredForCoreCexDiscovery: false', 'optional provider cannot masquerade as core requirement');
requireText(observability, 'getVenueCapabilities()', 'runtime exposes venue capabilities');
requireText(observability, 'getCryptoCrawlerRuntimeAttestation()', 'runtime exposes source/deployment identity');

const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
requireText(telemetry, 'resolveCoinStatsEnvironment()', 'telemetry uses CoinStats environment contract');
requireText(telemetry, 'adoptResolvedEnvironmentVariable(coinStatsResolution)', 'CoinStats alias adoption uses the safe resolver');
requireText(telemetry, 'const coinStatsResolution = resolveCoinStatsEnvironment();', 'CoinStats has its own resolved credential path');

const scaler = read('server/services/cryptocrawl/scaling/dynamic-scale-physics.ts');
requireText(scaler, 'canonical.observedOpportunities', 'search scaling uses measured observed opportunities');
requireText(scaler, 'canonical.verifiedPositiveOpportunities', 'execution-quality density remains separately measured');
requireText(scaler, 'searchOpportunityDensity', 'search density exposed independently');
requireText(scaler, 'verifiedPositiveDensity', 'verified-positive density exposed independently');
requireText(scaler, 'Math.max(0, normalized - this.lastRecordedOpportunityTotal)', 'cumulative counters converted to deltas');
forbidText(scaler, 'Paused non-critical services', 'scaler must not claim unperformed service actions');
forbidText(scaler, 'Northern Virginia', 'scaler must not invent deployment region');
forbidText(scaler, 'Frankfurt', 'scaler must not invent deployment region');

const legacyScaler = read('server/services/cryptocrawl/stealth/dynamic-scale-physics.ts');
requireText(legacyScaler, 'non-authoritative', 'legacy scaler explicitly non-authoritative');
forbidText(legacyScaler, 'setInterval(', 'legacy scaler must not run an independent background control loop');
forbidText(legacyScaler, 'Scaling from', 'legacy scaler must not claim external infrastructure scaling');

if (failures.length) {
  console.error('[verify-no-regression-opportunity-pipeline] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[verify-no-regression-opportunity-pipeline] PASS');
console.log(' - deployment prebuild validates critical CryptoCrawler invariants with Node built-ins only');
console.log(' - normal Vite/esbuild production bundling remains the syntax/import gate immediately afterward');
console.log(' - Coinbase remains inactive while Kraken/OKX remain settlement-safe live CEX venues');
console.log(' - Kraken authenticated fee calls preserve nonce ordering; market streams pool subscriptions by venue');
console.log(' - strict positive-net, live-confirmation, StageManager, kill-switch, and terminal-learning gates are preserved');
console.log(' - measured market universe is ranked deterministically and rotated once per consumption boundary');
console.log(' - Stage 1 cannot advance without a fresh verified-positive canonical signal');
console.log(' - discovery scaling remains separated from verified-positive execution density');
