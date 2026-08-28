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
requireText(profitCapture, 'verifier.verifyOnce = async', 'runtime verifier authority neutralizes legacy caller profit floors');
requireText(profitCapture, 'verifier.evaluateOnce = async', 'runtime verifier evaluation is normalized before eligibility');
requireText(profitCapture, 'rank_non_authoritative_for_execution', 'rank cannot reject a profitable route by itself');
requireText(profitCapture, 'mc_risk_gate_retained', 'Monte Carlo execution-risk gate remains');
requireText(profitCapture, 'risk_circuit_breakers', 'circuit breakers remain');
requireText(profitCapture, 'inventory_resource_leases', 'inventory/resource authority remains');
requireText(profitCapture, 'settlement', 'settlement authority remains');

const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
requireText(verifier, 'getActiveExecutableQuoteVenues()', 'verifier consumes venue capability authority');
requireText(verifier, 'hasPositiveRawCrossVenueEdge', 'raw cross-venue positive-edge screen remains');
requireText(verifier, 'primeCexFeeEvidence([...rawEdgeSurvivors])', 'authenticated Coinbase/Kraken/OKX fees are enriched only for raw-edge survivors');
requireText(verifier, 'topSpreadBps <= breakEvenBps', 'fee/fixed-cost break-even screen remains');
requireText(verifier, 'netProfitUsd = grossProfitUsd - totalCostsUsd', 'all-in net calculation remains explicit');
requireText(verifier, 'candidate.netProfitUsd > bestPlan.netProfitUsd', 'depth-aware sizing chooses the highest measured net profit');
requireText(verifier, 'canonicalOpportunityState.recordSearchObservation', 'search activity is measured before profitability result');
forbidText(verifier, "const venues: QuoteVenue[] = ['coinbase', 'kraken', 'okx']", 'no hard-coded executable venue bypass');

// ---------------------------------------------------------------------------
// Venue capability: Coinbase is end-to-end implemented, but account evidence
// (permission + authenticated fees + inventory) still fails closed per plan.
// ---------------------------------------------------------------------------
const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const coinbase = capability.match(/coinbase:\s*Object\.freeze\(\{[\s\S]*?\n\s*\}\),/);
if (!coinbase) failures.push('Coinbase capability declaration missing');
else {
  requireText(coinbase[0], 'enabled: true', 'Coinbase integration is visible');
  requireText(coinbase[0], 'publicDiscovery: true', 'Coinbase contributes measured public discovery');
  requireText(coinbase[0], 'executableQuotes: true', 'Coinbase has executable-quality Advanced Trade market data');
  requireText(coinbase[0], 'measuredOrderBook: true', 'Coinbase measured book capability is represented');
  requireText(coinbase[0], 'authenticatedFeeEvidence: true', 'Coinbase authenticated fee authority is represented');
  requireText(coinbase[0], 'liveExecution: true', 'Coinbase settlement-safe IOC execution implementation is represented');
  requireText(coinbase[0], 'settlementVerification: true', 'Coinbase terminal settlement implementation is represented');
}
requireText(capability, "return (['coinbase', 'kraken', 'okx'] as const)", 'canonical executable venue set includes Coinbase/Kraken/OKX');
requireText(verifier, 'getCoinbaseAdvancedProductBook(symbol)', 'Coinbase executable book comes from Advanced Trade v3');
requireText(feeResolver, 'assertCoinbaseSpotTradeReady()', 'canonical fee authority requires authenticated Coinbase trade permission');
requireText(feeResolver, 'getCoinbaseSpotFeeEvidence', 'canonical fee authority requires authenticated Coinbase account fee evidence');
forbidText(verifier, 'assertCoinbaseSpotTradeReady', 'verifier cannot own a duplicate Coinbase permission authority');
forbidText(verifier, 'getCoinbaseSpotFeeEvidence', 'verifier cannot bypass canonical Coinbase fee authority');
requireText(verifier, "(venue === 'okx' || venue === 'coinbase') && !evidence", 'Coinbase/OKX configured fee guesses cannot replace authenticated evidence');
forbidText(verifier, 'api.exchange.coinbase.com', 'canonical verifier cannot use legacy Coinbase Exchange endpoints');

const coinbaseMarketData = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');
const coinbaseProductPolicy = read('server/services/cryptocrawl/execution/coinbase-product-policy.ts');
const coinbasePlanPolicy = read('server/services/cryptocrawl/execution/coinbase-executable-plan-policy.ts');
requireText(coinbaseMarketData, '/api/v3/brokerage/market/products/${encodeURIComponent(productId)}', 'Coinbase constraints come from Advanced Trade public product metadata');
requireText(coinbaseMarketData, 'base_increment', 'Coinbase base increment is measured');
requireText(coinbaseMarketData, 'price_increment', 'Coinbase price increment is measured');
requireText(coinbaseMarketData, 'base_min_size', 'Coinbase base minimum is measured');
requireText(coinbaseMarketData, 'quote_min_size', 'Coinbase quote minimum is measured');
requireText(coinbaseProductPolicy, 'floorToIncrement', 'Coinbase size normalization is deterministic');
requireText(coinbaseProductPolicy, 'isIncrementAligned', 'Coinbase off-increment prices fail closed');
requireText(coinbasePlanPolicy, 'normalizeCoinbaseExecutablePlan', 'Coinbase executable plan has one normalization authority');
requireText(coinbasePlanPolicy, 'const netProfitUsd = grossProfitUsd - totalCostsUsd', 'Coinbase normalized economics are recomputed all-in');
requireText(coinbasePlanPolicy, 'netProfitUsd <= 0', 'Coinbase normalized plan must remain strictly profitable');
requireText(profitCapture, 'normalizeCoinbaseExecutablePlan(plan)', 'Coinbase normalization executes before eligibility');

// ---------------------------------------------------------------------------
// Private account authority / real fee evidence
// ---------------------------------------------------------------------------
const privateCex = read('server/services/cryptocrawl/intelligence/cex-private-authority.ts');
const coinbasePrivate = read('server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.ts');
const coinbaseFees = read('server/services/cryptocrawl/intelligence/coinbase-fee-evidence.ts');
requireText(feeResolver, "from './cex-private-authority.js'", 'fee resolver uses shared private authority');
requireText(privateCex, 'serializeKrakenPrivate', 'Kraken private calls are serialized');
requireText(privateCex, 'nextKrakenNonce()', 'Kraken nonce is monotonic within the serialized lane');
requireText(privateCex, 'scheduleOkxLane', 'OKX uses endpoint-specific private lanes');
requireText(privateCex, 'Math.max(425', 'OKX fee lane retains conservative minimum cadence');
requireText(feeResolver, "source: 'kraken_account_trade_volume'", 'Kraken fees are account measured');
requireText(feeResolver, "source: 'okx_account_trade_fee'", 'OKX fees are account measured');
requireText(feeResolver, "source: 'coinbase_transaction_summary'", 'Coinbase fees are account measured');
requireText(feeResolver, 'getOkxInstrumentDirectory', 'OKX live regional instrument directory remains authoritative');
forbidText(feeResolver, 'let krakenPrivateTail', 'fee resolver cannot own a second Kraken nonce queue');
forbidText(feeResolver, 'const OKX_FEE_MIN_INTERVAL_MS', 'fee resolver cannot own a second OKX throttle');
requireText(coinbasePrivate, '/api/v3/brokerage/key_permissions', 'Coinbase permissions are authenticated');
requireText(coinbaseFees, '/api/v3/brokerage/transaction_summary', 'Coinbase fee tier is authenticated');

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
requireText(executor, "new Set<ExecutableCexVenue>(['coinbase', 'kraken', 'okx'])", 'centralized executor admits only implemented venues');
requireText(executor, "topology: 'CEX_CEX'", 'execution Monte Carlo is topology-specific');
requireText(executor, 'if (!monteCarlo.approved)', 'execution MC remains a live admission gate');

const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
requireText(inventory, "export type InventoryVenue = 'coinbase' | 'kraken' | 'okx'", 'inventory authority covers all executable CEX venues');
const settlement = read('server/services/cryptocrawl/execution/cex-settlement.ts');
const coinbaseSettlement = read('server/services/cryptocrawl/execution/coinbase-spot-settlement-adapter.ts');
requireText(settlement, "timeinforce: 'IOC'", 'Kraken taker execution stays IOC');
requireText(settlement, "ordType: 'ioc'", 'OKX taker execution stays IOC');
requireText(settlement, 'CoinbaseSettlementBridge', 'Coinbase uses canonical settlement orchestration');
requireText(coinbaseSettlement, "sor_limit_ioc", 'Coinbase taker execution stays IOC');
requireText(coinbaseSettlement, 'validateCoinbaseOrderAgainstProduct', 'Coinbase live submission revalidates current product constraints');
requireText(settlement, 'calculateRealizedEconomics', 'terminal economics are derived from actual fills/fees');
requireText(settlement, 'settlementConfirmed', 'pair settlement confirmation remains explicit');
requireText(settlement, 'authenticated_final_balances', 'terminal balances remain settlement evidence');
requireText(settlement, 'USD, USDT and USDC are distinct inventory assets', 'realized accounting cannot silently assume stable quote parity');

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
requireText(core, 'profitPolicy.ensurePositiveProfitCaptureWiring()', 'positive-profit and Coinbase normalization policy installs before graph/scheduler');
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
