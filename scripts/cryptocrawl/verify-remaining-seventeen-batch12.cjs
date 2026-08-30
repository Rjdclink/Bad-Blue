const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
const inventoryResize = read('server/services/cryptocrawl/integration/inventory-constrained-cex-execution-wiring.ts');
const timingGuard = read('server/services/cryptocrawl/integration/cross-venue-timing-guard-wiring.ts');
const expiryGuard = read('server/services/cryptocrawl/integration/measured-candidate-expiry-guard-wiring.ts');
const scheduler = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const sizing = read('server/services/cryptocrawl/risk/progressive-position-sizing.ts');
const calibration = read('server/services/cryptocrawl/learning/settlement-profit-calibrator.ts');
const memory = read('server/services/cryptocrawl/intelligence/canonical-intelligence-repository.ts');
const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const atomicSize = read('server/services/cryptocrawl/execution/adapters/atomic-size-optimizer.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Implemented CEX venue surface only.
assert(capability.includes("getActiveExecutableQuoteVenues(): Array<'coinbase' | 'kraken' | 'okx'>"), 'canonical executable CEX type must be Coinbase/Kraken/OKX');
assert(capability.includes("(['coinbase', 'kraken', 'okx'] as const).filter"), 'canonical executable CEX set must be Coinbase/Kraken/OKX');

// Inventory and sizing may only reduce/resize after fresh exact economics.
assert(inventoryResize.includes('capacity.maxFundableNotionalUsd'), 'inventory-constrained CEX sizing must use authenticated fundable capacity');
assert(inventoryResize.includes('arbitrageVerifier.evaluateOnce({'), 'inventory resize must perform a fresh canonical economics evaluation');
assert(inventoryResize.includes('refreshed.netProfitUsd <= 0'), 'inventory resize must reject nonpositive refreshed economics');
assert(sizing.includes('request.expectedNetProfitUsd <= 0'), 'position sizing must reject nonpositive expected net economics');

// Cross-venue execution requires synchronized fresh books and a still-live raw edge.
assert(timingGuard.includes("value === 'coinbase' || value === 'kraken' || value === 'okx'"), 'timing guard must cover all implemented CEX venues');
assert(timingGuard.includes('skewMs > maxCrossVenueSkewMs()'), 'timing guard must bound cross-venue timestamp skew');
assert(timingGuard.includes('sell.bid > buy.ask'), 'timing guard must revalidate a live raw cross-venue edge');
assert(timingGuard.includes('executionAuthority: false'), 'timing guard must not grant execution authority');

// Expired evidence cannot be promoted and resource conflicts remain serialized.
assert(expiryGuard.includes("new Set<MeasuredCandidateStatus>(['deterministic_positive', 'eligible'])"), 'expiry guard must protect positive/eligible promotions');
assert(expiryGuard.includes('current.expiresAt <= Date.now()'), 'expiry guard must reject expired evidence');
assert(expiryGuard.includes("originalUpdateStatus(opportunityId, 'expired'"), 'expired evidence must be demoted to expired state');
assert(scheduler.includes('cex:inventory:'), 'resource scheduler must serialize conflicting venue/asset inventory');
assert(scheduler.includes('cex:nonce:kraken-account'), 'Kraken private nonce domain must remain serialized');

// Learning/memory authority remains terminal settlement only.
assert(calibration.includes('outcome.settlement?.terminal') && calibration.includes('outcome.settlement.settlementConfirmed'), 'profit calibration must require terminal confirmed settlement');
assert(memory.includes('Canonical intelligence memory accepts terminal normalized execution evidence only'), 'durable intelligence memory must accept terminal evidence only');
assert(memory.includes('on conflict (event_id) do nothing'), 'durable terminal memory persistence must remain idempotent');

// Zero-capital quote truth and atomic sizing must not turn near misses into profit.
assert(dynamicRoutes.includes('truePositiveQuotes = quotes.filter(quote => quote.executablePositive === true && quote.netProfit > 0n)'), 'zero-capital positive quote counters must count only strict-positive executable quotes');
assert(dynamicRoutes.includes('state.measuredQuotes += quotes.length'), 'measured quote count must reflect actual measured quotes');
assert(atomicSize.includes('profit > 0n') && atomicSize.includes('bestPositive'), 'atomic size optimizer must prefer strict-positive measured dollar profit');
assert(atomicSize.includes('bpsToBreakEven') && atomicSize.includes('bestNearMiss'), 'all-negative atomic size fallback must preserve the closest measured BPS near miss only');

// Retained profits stay retained and durable; retry does not authorize payout.
assert(retainedProfit.includes('ON CONFLICT (event_id) DO NOTHING'), 'retained-profit terminal events must be idempotent');
assert(retainedProfit.includes('retained_profit_usd = retained_profit_usd + $1'), 'new terminal profit must increment retained treasury accounting');
assert(retainedProfit.includes('externalPayoutAuthorized: false'), 'retained-profit retries must not authorize payout');

// New protections are actually installed in the canonical runtime.
assert(runtime.includes('ensureInventoryConstrainedCexExecutionWiring();'), 'inventory-constrained CEX execution wiring must be installed');
assert(runtime.includes('ensureCrossVenueTimingGuardWiring();'), 'cross-venue timing guard must be installed');
assert(runtime.includes('ensureMeasuredCandidateExpiryGuardWiring();'), 'candidate expiry guard must be installed');
assert(runtime.includes("executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'"), 'strict all-in positive economics must remain canonical');

console.log('[remaining-seventeen-batch12] PASS: implemented CEX topology, exact inventory economics, synchronized timing, expiry/resource safety, terminal learning, zero-capital truth, atomic sizing, and retained-profit invariants preserved');
