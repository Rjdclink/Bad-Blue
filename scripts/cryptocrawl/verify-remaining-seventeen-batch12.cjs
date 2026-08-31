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
const zeroCapitalSizing = read('server/services/cryptocrawl/integration/zero-capital-size-refinement-wiring.ts');
const ladderNotional = read('server/services/cryptocrawl/governance/profit-ladder-notional-authority.ts');
const hyperHybrid = read('server/services/cryptocrawl/execution/hyper-hybrid-cex-execution.ts');
const partialProfitAccounting = read('server/services/cryptocrawl/compensation/hyper-hybrid-partial-profit-accounting.ts');
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
assert(zeroCapitalSizing.includes("ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD || 1_000"), 'zero-capital Stage-1 discovery must retain a bounded shadow sizing ceiling');
assert(zeroCapitalSizing.includes('const ladderMaxNotionalUsd = getProfitLadderNotionalAuthority().maxNotionalUsd'), 'Stage2+ zero-capital sizing must consume the single profit-ladder notional authority');
assert(zeroCapitalSizing.includes('stageCanExecute') && zeroCapitalSizing.includes('? Math.max(seedUsd, ladderMaxNotionalUsd)') && zeroCapitalSizing.includes(': stageOneDiscoveryCeiling;'), 'Stage-1 shadow measurement must remain separate while executable sizing follows the ladder');
assert(!zeroCapitalSizing.includes('stage.maxPositionSizeUSD'), 'legacy StageManager position caps must not remain a zero-capital notional authority');
assert(zeroCapitalSizing.includes('stage1ShadowDiscoveryExecutionAuthority: false'), 'Stage-1 zero-capital shadow sizing must never grant execution authority');
assert(zeroCapitalSizing.includes('stage2PlusDiscoveryBoundedByProfitLadder: true'), 'Stage2+ discovery must remain bounded by the current profit ladder');
assert(zeroCapitalSizing.includes('legacyStagePositionCapAuthoritative: false'), 'zero-capital telemetry must explicitly retire the legacy stage position cap');
assert(zeroCapitalSizing.includes('negativeObservationExecutionAuthority: false'), 'negative zero-capital observations must remain non-executable');
assert(zeroCapitalSizing.includes('profitInterpolationUsed: false'), 'zero-capital refinement must use independently quoted economics rather than interpolation');

// Profit Ladder is the only notional authority and may progress to $100M from terminal evidence.
assert(ladderNotional.includes('SYSTEM_MAX_NOTIONAL_USD = 100_000_000'), 'system profit-ladder notional path must support a $100M terminal-evidence rung');
assert(ladderNotional.includes("key: 'institutional_100m'"), 'institutional ladder must contain the explicit $100M rung');
assert(ladderNotional.includes("authority: 'profit_ladder_capital_allowance'"), 'profit ladder must identify itself as the single capital-size authority');
assert(ladderNotional.includes('stagePositionCapAuthoritative: false'), 'legacy stage position cap must remain non-authoritative');

// Large CEX parents split into one admitted parallel batch. Good children survive
// sibling failures; residual quantity is replanned from fresh market evidence.
assert(hyperHybrid.includes('const admittedChildren = plannedChildren.slice(0, concurrency);'), 'split executor must admit one bounded parallel child batch');
assert(hyperHybrid.includes('await Promise.all(admittedChildren.map'), 'admitted split children must execute concurrently');
assert(!hyperHybrid.includes('for (let offset = 0; offset < plannedChildren.length; offset += concurrency)'), 'automatic sequential child waves must remain removed');
assert(hyperHybrid.includes('oneBoundedParallelBatch: true'), 'parallel-batch telemetry must remain explicit');
assert(hyperHybrid.includes('sequentialChildWaves: false'), 'sequential-wave behavior must remain disabled');
assert(hyperHybrid.includes('parallel_batch_capacity_residual') && hyperHybrid.includes('require_fresh_replan'), 'unadmitted residual notional must require a fresh replan');
assert(hyperHybrid.includes('persistHyperHybridPartialProfit({'), 'partial successful children must reach durable profit accounting');
assert(!hyperHybrid.includes("match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/"), 'hyper-hybrid OKX child submission must not reintroduce a local stablecoin-only symbol parser');

// Partial child accounting is treasury-only so order splitting cannot manufacture
// Cryptara rank, stage, or profit-ladder promotion samples.
assert(partialProfitAccounting.includes('if (input.parentSucceeded) return;'), 'full parent success must not be double-counted by partial accounting');
assert(partialProfitAccounting.includes('retainedProfitLedger.recordTerminalSettlement({'), 'completed profitable subset must persist to the durable retained-profit ledger');
assert(partialProfitAccounting.includes('cryptara_rank_authority:false'), 'partial child accounting must explicitly carry no Cryptara rank authority');
assert(partialProfitAccounting.includes('profit_ladder_progression_authority:false'), 'partial child accounting must explicitly carry no profit-ladder progression authority');
assert(!partialProfitAccounting.includes('recordCryptaraExecutionEvidence('), 'partial child accounting must not enter Cryptara/stage learning');

// Terminal profit is durable and idempotent. Compounding is the default: no
// per-profit wallet reservation/job exists unless the operator explicitly opts in.
assert(retainedProfit.includes('ON CONFLICT (event_id) DO NOTHING'), 'retained-profit terminal events must be idempotent');
assert(retainedProfit.includes('retained_profit_usd = retained_profit_usd + $1'), 'new terminal profit must increment retained treasury accounting');
assert(retainedProfit.includes('CRYPTOCRAWL_AUTO_PROFIT_PAYOUT_ENABLED'), 'automatic profit payout must require an explicit opt-in control');
assert(retainedProfit.includes('if (!automaticProfitPayoutEnabled())'), 'default terminal-profit path must retain instead of enqueueing payout');
assert(retainedProfit.includes('payoutTargetUsd: 0') && retainedProfit.includes('retainedFraction: 1'), 'default terminal profit must be one hundred percent retained');
assert(retainedProfit.includes('payoutReservationCreated: false'), 'default terminal profit must not reserve strategy inventory for payout');
assert(retainedProfit.includes('profitAvailableForRedeployment: true'), 'default retained profit must remain available to strategies');

// New protections are actually installed in the canonical runtime.
assert(runtime.includes('ensureInventoryConstrainedCexExecutionWiring();'), 'inventory-constrained CEX execution wiring must be installed');
assert(runtime.includes('ensureCrossVenueTimingGuardWiring();'), 'cross-venue timing guard must be installed');
assert(runtime.includes('ensureMeasuredCandidateExpiryGuardWiring();'), 'candidate expiry guard must be installed');
assert(runtime.includes('ensureZeroCapitalSizeRefinementWiring();'), 'zero-capital size refinement wiring must be installed');
assert(runtime.includes("executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'"), 'strict all-in positive economics must remain canonical');

console.log('[remaining-seventeen-batch12] PASS: executable CEX topology, exact inventory economics, synchronized timing, terminal learning, single profit-ladder notional authority through $100M, one-batch parallel CEX splitting with residual replanning, anti-rank-gaming partial profit accounting, compounding-first retained-profit authority, and strict quote truth invariants preserved');