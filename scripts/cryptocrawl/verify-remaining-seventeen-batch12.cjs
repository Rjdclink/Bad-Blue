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
const zeroCapitalCore = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const zeroCapitalRescue = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-v2.ts');
const ladderNotional = read('server/services/cryptocrawl/governance/profit-ladder-notional-authority.ts');
const hyperHybrid = read('server/services/cryptocrawl/execution/hyper-hybrid-cex-execution.ts');
const partialProfitAccounting = read('server/services/cryptocrawl/compensation/hyper-hybrid-partial-profit-accounting.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

assert(capability.includes("getActiveExecutableQuoteVenues(): Array<'coinbase' | 'kraken' | 'okx'>"), 'canonical executable CEX type must be Coinbase/Kraken/OKX');
assert(capability.includes("(['coinbase', 'kraken', 'okx'] as const).filter"), 'canonical executable CEX set must be Coinbase/Kraken/OKX');

assert(inventoryResize.includes('capacity.maxFundableNotionalUsd'), 'inventory-constrained CEX sizing must use authenticated fundable capacity');
assert(inventoryResize.includes('arbitrageVerifier.evaluateOnce({'), 'inventory resize must perform a fresh canonical economics evaluation');
assert(inventoryResize.includes('isStrictlyPositiveAllInNetProfit(refreshed.netProfitUsd)'), 'inventory resize must reject nonpositive refreshed economics through canonical profit admission');
assert(sizing.includes('isStrictlyPositiveAllInNetProfit(request.expectedNetProfitUsd)'), 'position sizing must reject nonpositive expected net economics through canonical profit admission');

assert(timingGuard.includes("value === 'coinbase' || value === 'kraken' || value === 'okx'"), 'timing guard must cover all implemented CEX venues');
assert(timingGuard.includes('skewMs > maxCrossVenueSkewMs()'), 'timing guard must bound cross-venue timestamp skew');
assert(timingGuard.includes('sell.bid > buy.ask'), 'timing guard must revalidate a live raw cross-venue edge');
assert(timingGuard.includes('executionAuthority: false'), 'timing guard must not grant execution authority');

assert(expiryGuard.includes("new Set<MeasuredCandidateStatus>(['deterministic_positive', 'eligible'])"), 'expiry guard must protect positive/eligible promotions');
assert(expiryGuard.includes('current.expiresAt <= Date.now()'), 'expiry guard must reject expired evidence');
assert(expiryGuard.includes("originalUpdateStatus(opportunityId, 'expired'"), 'expired evidence must be demoted to expired state');
assert(scheduler.includes('cex:inventory:'), 'resource scheduler must serialize conflicting venue/asset inventory');
assert(scheduler.includes('cex:nonce:kraken-account'), 'Kraken private nonce domain must remain serialized');

assert(calibration.includes('outcome.settlement?.terminal') && calibration.includes('outcome.settlement.settlementConfirmed'), 'profit calibration must require terminal confirmed settlement');
assert(memory.includes('Canonical intelligence memory accepts terminal normalized execution evidence only'), 'durable intelligence memory must accept terminal evidence only');
assert(memory.includes('on conflict (event_id) do nothing'), 'durable terminal memory persistence must remain idempotent');

assert(dynamicRoutes.includes('truePositiveQuotes = quotes.filter(quote => quote.executablePositive === true && quote.netProfit > 0n)'), 'zero-capital positive quote counters must count only strict-positive executable quotes');
assert(dynamicRoutes.includes('state.measuredQuotes += quotes.length'), 'measured quote count must reflect actual measured quotes');
assert(atomicSize.includes('profit > 0n') && atomicSize.includes('bestPositive'), 'atomic size optimizer must prefer strict-positive measured dollar profit');
assert(atomicSize.includes('bpsToBreakEven') && atomicSize.includes('bestNearMiss'), 'all-negative atomic size fallback must preserve the closest measured BPS near miss only');
assert(zeroCapitalCore.includes('runZeroCapitalProfitabilityRescueV2({'), 'canonical zero-capital scan must invoke BPS rescue directly');
assert(zeroCapitalCore.includes('resolveInputAssetUsdPrice(opportunity)'), 'pre-trade zero-capital USD economics must require live token price');
assert(zeroCapitalRescue.includes('getProfitLadderNotionalAuthority().maxNotionalUsd'), 'canonical rescue must consume Profit Ladder notional authority');
assert(!zeroCapitalRescue.includes('ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD'), 'zero-capital rescue must not retain an independent notional ceiling');
assert(zeroCapitalRescue.includes('measureFlashLoanProviders({'), 'canonical rescue must use measured provider evidence');
assert(zeroCapitalRescue.includes('calculateMeasuredFlashLoanFee'), 'canonical rescue must use exact measured provider fees');
assert(zeroCapitalRescue.includes('quoteConfiguredZeroCapitalRoute'), 'canonical rescue must independently requote candidate sizes');
assert(zeroCapitalRescue.includes('strictImprovement'), 'canonical rescue must require measured economic improvement');
assert(!runtime.includes('ensureZeroCapitalSizeRefinementWiring'), 'retired duplicate size-refinement installer must stay absent');
assert(!runtime.includes('ensureZeroCapitalJointProviderSizeWiring'), 'retired duplicate joint provider-size installer must stay absent');

assert(ladderNotional.includes('SYSTEM_MAX_NOTIONAL_USD = 100_000_000'), 'system profit-ladder notional path must support a $100M terminal-evidence rung');
assert(ladderNotional.includes("key: 'institutional_100m'"), 'institutional ladder must contain the explicit $100M rung');
assert(ladderNotional.includes("authority: 'profit_ladder_capital_allowance'"), 'profit ladder must identify itself as the single capital-size authority');
assert(ladderNotional.includes('stagePositionCapAuthoritative: false'), 'legacy stage position cap must remain non-authoritative');

assert(hyperHybrid.includes('const admittedChildren = plannedChildren.slice(0, concurrency);'), 'split executor must admit one bounded parallel child batch');
assert(hyperHybrid.includes('await Promise.all(admittedChildren.map'), 'admitted split children must execute concurrently');
assert(!hyperHybrid.includes('for (let offset = 0; offset < plannedChildren.length; offset += concurrency)'), 'automatic sequential child waves must remain removed');
assert(hyperHybrid.includes('oneBoundedParallelBatch: true'), 'parallel-batch telemetry must remain explicit');
assert(hyperHybrid.includes('sequentialChildWaves: false'), 'sequential-wave behavior must remain disabled');
assert(hyperHybrid.includes('parallel_batch_capacity_residual') && hyperHybrid.includes('require_fresh_replan'), 'unadmitted residual notional must require a fresh replan');
assert(hyperHybrid.includes('persistHyperHybridPartialProfit({'), 'partial successful children must reach durable profit accounting');
assert(hyperHybrid.includes('const singleAdapters = input.useProductionFok ? fokAdapters(input.adapters) : input.adapters;'), 'unsplit production CEX execution must retain venue-native FOK semantics when production FOK is selected');
assert(hyperHybrid.includes('adapters: singleAdapters'), 'single-child production execution must actually consume the FOK adapter set');
assert(!hyperHybrid.includes("match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/"), 'hyper-hybrid OKX child submission must not reintroduce a local stablecoin-only symbol parser');

assert(partialProfitAccounting.includes('if (input.parentSucceeded) return;'), 'full parent success must not be double-counted by partial accounting');
assert(partialProfitAccounting.includes('retainedProfitLedger.recordTerminalSettlement({'), 'completed profitable subset must persist to the durable retained-profit ledger');
assert(partialProfitAccounting.includes('cryptara_rank_authority:false'), 'partial child accounting must explicitly carry no Cryptara rank authority');
assert(partialProfitAccounting.includes('profit_ladder_progression_authority:false'), 'partial child accounting must explicitly carry no profit-ladder progression authority');
assert(!partialProfitAccounting.includes('recordCryptaraExecutionEvidence('), 'partial child accounting must not enter Cryptara/stage learning');

assert(retainedProfit.includes('ON CONFLICT (event_id) DO NOTHING'), 'retained-profit terminal events must be idempotent');
assert(retainedProfit.includes('retained_profit_usd = retained_profit_usd + $1'), 'new terminal profit must increment retained treasury accounting');
assert(retainedProfit.includes('const PAYOUT_FRACTION = 0.90;'), 'new terminal profit must allocate 90 percent to payout');
assert(retainedProfit.includes('const RETAINED_FRACTION = 0.10;'), 'new terminal profit must retain 10 percent as system capital');
assert(retainedProfit.includes("const RETAINED_TARGET_VENUES = ['kraken', 'okx'] as const;"), 'retained capital must target Kraken or OKX');
assert(retainedProfit.includes('randomInt(0, RETAINED_TARGET_VENUES.length)'), 'retained target venue must remain randomized');
assert(retainedProfit.includes("'ETH','ethereum','QUEUED'"), 'automatic payout obligation must remain ETH on Ethereum');
assert(retainedProfit.includes('payoutScheduledImmediately: true'), 'confirmed terminal profit must schedule its payout obligation immediately');

assert(runtime.includes("install('inventory_constrained_cex_execution', () => ensureInventoryConstrainedCexExecutionWiring())"), 'inventory-constrained CEX execution wiring must be isolated and installed');
assert(runtime.includes("install('cross_venue_timing_guard', () => ensureCrossVenueTimingGuardWiring())"), 'cross-venue timing guard must be isolated and installed');
assert(runtime.includes("install('measured_candidate_expiry_guard', () => ensureMeasuredCandidateExpiryGuardWiring())"), 'candidate expiry guard must be isolated and installed');
assert(runtime.includes('runtimeComponentIsolationGlobalShutdownAuthority: false'), 'component wiring failures must not own a global shutdown');
assert(runtime.includes("executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'"), 'strict all-in positive economics must remain canonical');
console.log('[remaining-seventeen-batch12] PASS: executable CEX topology, exact inventory economics, synchronized timing, terminal learning, single Profit Ladder zero-capital notional authority, canonical direct BPS rescue with measured provider fees/liquidity and live token USD pricing, FOK-preserving one-batch CEX execution, anti-rank-gaming partial accounting, fixed 90/10 treasury invariants, and isolated runtime protections preserved');