const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };
const requireMatch = (source, expression, label) => { if (!expression.test(source)) failures.push(`${label}: pattern ${expression} not found`); };

// ---------------------------------------------------------------------------
// Build gate itself
// ---------------------------------------------------------------------------
const packageJson = read('package.json');
requireText(packageJson, '"prebuild": "node scripts/cryptocrawl/verify-deployment-preflight.cjs"', 'production build invokes CryptoCrawler preflight');
const deployment = read('scripts/cryptocrawl/verify-deployment-preflight.cjs');
requireText(deployment, 'verify-no-regression-opportunity-pipeline-v2.cjs', 'deployment preflight invokes current invariant suite');
requireText(deployment, "NO_EXECUTION: 'true'", 'preflight is execution-safe');

// ---------------------------------------------------------------------------
// Strict profitability: positive means all-in net > 0, never rank/threshold-only
// ---------------------------------------------------------------------------
const profitCapture = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
requireText(profitCapture, 'plan.netProfitUsd > 0', 'positive-profit capture requires strict positive deterministic net');
requireText(profitCapture, 'minimumNetProfitUsd: 0', 'arbitrary autonomous minimum is neutralized');
requireText(profitCapture, 'rank_non_authoritative_for_execution', 'rank cannot reject a profitable route by itself');
requireText(profitCapture, 'mc_risk_gate_retained', 'Monte Carlo execution-risk gate remains');
requireText(profitCapture, 'risk_circuit_breakers', 'circuit breakers remain');
requireText(profitCapture, 'inventory_resource_leases', 'inventory/resource authority remains');
requireText(profitCapture, 'settlement', 'settlement authority remains');

const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
requireText(verifier, 'getActiveExecutableQuoteVenues()', 'verifier consumes venue capability authority');
requireText(verifier, 'hasPositiveRawCrossVenueEdge', 'raw cross-venue positive-edge screen remains');
requireText(verifier, 'primeCexFeeEvidence([...rawEdgeSurvivors])', 'authenticated fees are enriched only for raw-edge survivors');
requireText(verifier, 'topSpreadBps <= breakEvenBps', 'fee/fixed-cost break-even screen remains');
requireText(verifier, 'netProfitUsd = grossProfitUsd - totalCostsUsd', 'all-in net calculation remains explicit');
requireText(verifier, 'candidate.netProfitUsd > bestPlan.netProfitUsd', 'depth-aware sizing chooses the highest measured net profit');
requireText(verifier, 'plan.netProfitUsd < req.minNetProfitUsd', 'legacy verify API still enforces caller threshold when explicitly requested');
requireText(verifier, 'canonicalOpportunityState.recordSearchObservation', 'search activity is measured before profitability result');
forbidText(verifier, "const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx']", 'no hard-coded executable venue bypass');

// ---------------------------------------------------------------------------
// Venue capability: Coinbase is incorporated, but credentials never auto-promote
// ---------------------------------------------------------------------------
const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const coinbase = capability.match(/coinbase:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/);
if (!coinbase) failures.push('Coinbase capability declaration missing');
else {
  requireText(coinbase[0], 'enabled: true', 'Coinbase integration is visible');
  requireText(coinbase[0], 'publicDiscovery: true', 'Coinbase contributes measured public discovery');
  requireText(coinbase[0], 'measuredOrderBook: true', 'Coinbase measured book capability is represented');
  requireText(coinbase[0], 'liveExecution: false', 'Coinbase remains fail-closed before canonical promotion');
  requireText(coinbase[0], 'settlementVerification: false', 'Coinbase settlement is not falsely promoted');
}
requireText(capability, "return (['kraken', 'okx'] as const)", 'current canonical executable venue set remains Kraken/OKX until Coinbase promotion is complete');

// ---------------------------------------------------------------------------
// Private account authority / real fee evidence
// ---------------------------------------------------------------------------
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const privateCex = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
requireText(feeResolver, "from './cex-private-authority.js'", 'fee resolver uses shared private authority');
requireText(privateCex, 'serializeKrakenPrivate', 'Kraken private calls are serialized');
requireText(privateCex, 'nextKrakenNonce()', 'Kraken nonce is monotonic within the serialized lane');
requireText(privateCex, 'scheduleOkxLane', 'OKX uses endpoint-specific private lanes');
requireText(privateCex, 'Math.max(425', 'OKX fee lane retains conservative minimum cadence');
requireText(feeResolver, "source: 'kraken_account_trade_volume'", 'Kraken fees are account measured');
requireText(feeResolver, "source: 'okx_account_trade_fee'", 'OKX fees are account measured');
requireText(feeResolver, 'getOkxInstrumentDirectory', 'OKX live regional instrument directory remains authoritative');
forbidText(feeResolver, 'let krakenPrivateTail', 'fee resolver cannot own a second Kraken nonce queue');
forbidText(feeResolver, 'const OKX_FEE_MIN_INTERVAL_MS', 'fee resolver cannot own a second OKX throttle');

// ---------------------------------------------------------------------------
// Broad but bounded market search / adaptive compute
// ---------------------------------------------------------------------------
const scan = read('server/services/cryptocrawl/discovery/scan-capacity-policy.ts');
requireText(scan, 'configuredMaximum = boundedInt', 'scan breadth has a configured maximum');
requireMatch(scan, /CRYPTO_ARBITRAGE_MAX_SYMBOLS[^\n]*96[^\n]*128/, 'scan breadth defaults broad but remains hard bounded');
requireText(scan, 'CRYPTO_ARBITRAGE_SCAN_CONCURRENCY', 'private worker concurrency remains configurable');
requireText(scan, '6, 1, 8', 'private worker concurrency remains hard capped at eight');
requireText(scan, 'recommendedIntervalMs', 'scan cadence adapts to measured activity');
requireText(scan, 'feeBlockedWithCoverage', 'measured fee barrier can reduce wasted polling');
requireText(scan, 'positiveDensity === 0', 'zero-positive market does not starve discovery');

const universe = read('server/services/cryptocrawl/discovery/market-universe-controller.ts');
requireText(universe, 'MarketUniversePerformanceHint', 'terminal pair performance can guide search ordering');
requireText(universe, 'bounded priority hint', 'pair performance cannot become execution authority');
requireText(universe, 'rotationCursor', 'market exploration remains rotating');
requireText(universe, 'getLastOrderedMarketUniverseSymbols', 'downstream scanners share one consumed order');
const symbols = read('server/services/cryptocrawl/discovery/symbol-registry.ts');
requireText(symbols, 'if (canonical.base === canonical.quote) return false', 'self pairs remain rejected');
requireText(symbols, 'No peg assumption is made', 'stable/stable markets are admitted without treating pegs as guaranteed');

// ---------------------------------------------------------------------------
// Canonical discovery -> assessment -> scheduler -> settlement authority
// ---------------------------------------------------------------------------
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
requireText(graph, "status: 'deterministic_positive'", 'only deterministic-positive CEX plans are promoted');
requireText(graph, 'plan.netProfitUsd > 0', 'graph positive plans require positive net');
requireText(graph, "assessment.recommendation === 'consider'", 'Cryptara assessment remains required for eligibility');
requireText(graph, "measuredCandidateRegistry.updateStatus(id, 'eligible'", 'eligibility has one measured registry transition');

const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
requireText(scheduler, "snapshot.status === 'eligible'", 'scheduler consumes only eligible canonical candidates');
requireText(scheduler, "snapshot.assessment?.recommendation === 'consider'", 'scheduler retains Cryptara recommendation requirement');
requireText(scheduler, 'snapshot.plan.netProfitUsd > 0', 'scheduler retains strict positive-net requirement');
requireText(scheduler, 'stageManager.canExecuteTrades()', 'scheduler retains governance-stage authority');
requireText(scheduler, 'executionResourceScheduler.acquireCexPlan', 'scheduler requires resource lease admission');
requireText(scheduler, 'settlementConfirmed', 'scheduler distinguishes confirmed settlement');

const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
requireText(executor, 'plan.netProfitUsd <= 0', 'live CEX executor rejects non-positive deterministic economics');
requireText(executor, "CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK'", 'explicit live confirmation remains');
requireText(executor, 'acquireMeasuredInventory', 'CEX execution requires reconciled inventory');
requireText(executor, "topology: 'CEX_CEX'", 'execution Monte Carlo is topology-specific');
requireText(executor, 'if (!monteCarlo.approved)', 'execution MC remains a live admission gate');

const settlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
requireText(settlement, "timeinforce: 'IOC'", 'Kraken taker execution stays IOC');
requireText(settlement, "ordType: 'ioc'", 'OKX taker execution stays IOC');
requireText(settlement, 'calculateRealizedEconomics', 'terminal economics are derived from actual fills/fees');
requireText(settlement, 'settlementConfirmed', 'pair settlement confirmation remains explicit');
requireText(settlement, 'authenticated_final_balances', 'terminal balances remain settlement evidence');

// ---------------------------------------------------------------------------
// Monte Carlo / terminal learning / governance progression
// ---------------------------------------------------------------------------
const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
requireText(progression, 'recentSignals.verifiedPositiveOpportunities > 0', 'Stage 1 requires a fresh verified-positive signal');
requireText(progression, 'opportunity_rejection_preserved:', 'Stage 1 readiness cannot convert a negative opportunity into execution eligibility');
requireText(progression, "throw new Error('Execution evidence requires a terminal normalized settlement')", 'learning requires terminal settlement');
const ladder = read('server/services/cryptocrawl/governance/profit-ladder.ts');
requireText(ladder, 'terminal', 'ProfitLadder consumes terminal evidence');
requireText(ladder, 'realized', 'ProfitLadder consumes realized evidence');
const learning = read('server/services/cryptocrawl/evolution/measured-execution-feedback.ts');
requireText(learning, 'feedback.settlement.terminal !== true', 'evolution ignores non-terminal execution feedback');
requireText(learning, 'bootstrap_no_terminal_samples', 'zero samples remain explicit bootstrap state');

// ---------------------------------------------------------------------------
// Mempool/provider cost + topology semantics
// ---------------------------------------------------------------------------
const alchemy = read('server/services/cryptocrawl/capital-free/alchemy-integration.ts');
requireText(alchemy, 'ALCHEMY_MEMPOOL_MONITORING_ENABLED', 'paid mempool monitoring requires explicit enablement');
requireText(alchemy, 'ALCHEMY_DAILY_CU_BUDGET', 'Alchemy compute usage remains budget governed');
const competition = read('server/services/cryptocrawl/faucet/competition-evidence-policy.ts');
requireText(competition, "topology === 'CEX_CEX'", 'CEX competition semantics are topology aware');
requireText(competition, "status: 'not_applicable'", 'CEX mempool competition is N/A rather than synthetic zero/NaN');
const faucet = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
forbidText(faucet, 'NaN%', 'competition display cannot regress to NaN percent');
requireText(faucet, 'canonicalExecutionScheduler.dispatchOnce()', 'legacy faucet delegates execution to canonical scheduler');

// ---------------------------------------------------------------------------
// Core lifecycle / readiness / optional provider isolation
// ---------------------------------------------------------------------------
const core = read('server/services/cryptocrawl/runtime/core-runtime.ts');
requireText(core, "import('../execution/canonical-execution-scheduler.js')", 'scheduler is lazily imported to avoid bootstrap cycle');
requireText(core, 'createCryptoCrawlerCoreLifecycle', 'one core lifecycle authority owns discovery/scheduler');
requireText(core, 'scheduleCoinbaseReadinessProbe', 'Coinbase readiness is topology-local');
const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
requireText(telemetry, 'await coreStart', 'canonical core starts before optional blockchain-provider probes');
requireText(telemetry, 'CRYPTOCRAWL_ALLOW_PUBLIC_ANKR_FALLBACK', 'anonymous Ankr fallback requires explicit admission');
requireText(telemetry, 'resolveCoinStatsEnvironment', 'CoinStats key aliases are resolved at runtime');
const readiness = read('server/services/cryptocrawl/runtime/readiness-policy.ts');
requireText(readiness, 'EXECUTION_CAPABILITY_READY', 'capability readiness remains distinct');
requireText(readiness, 'TRADING_READY', 'strict trading readiness remains distinct');

// ---------------------------------------------------------------------------
// Zero-capital / on-chain economics stay truthful
// ---------------------------------------------------------------------------
const routeQuoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');
requireText(routeQuoter, 'if (netProfit <= 0n) return null', 'zero-capital route requires strict positive all-in net');
requireText(routeQuoter, 'selectHighestNetProfit', 'atomic sizing selects highest measured net quote');
requireText(routeQuoter, 'estimatedGasCostInInputToken', 'gas cost remains part of atomic route economics');
requireText(routeQuoter, 'flashLoanFeeInInputToken', 'flash-loan fee remains part of atomic route economics');
requireText(routeQuoter, 'relayFeeInInputToken', 'relay fee remains part of atomic route economics');

if (failures.length) {
  console.error('[no-regression-v2] FAIL');
  failures.forEach(failure => console.error(` - ${failure}`));
  process.exit(1);
}
console.log('[no-regression-v2] PASS — current CryptoCrawler architecture preserves profitability, evidence, governance, provider-cost, execution-resource and terminal-settlement invariants');
