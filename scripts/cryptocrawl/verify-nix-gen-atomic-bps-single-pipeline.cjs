const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const handoff = read('server/services/cryptocrawl/integration/zero-capital-stage-handoff-supervisor.ts');
const anytimeRace = read('server/services/cryptocrawl/integration/atomic-bps-anytime-race.ts');
const engine = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const workers = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-workers.ts');
const atomicStack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const alternativeCapital = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const builderColdStart = read('server/services/cryptocrawl/execution/builder-sponsored-zero-capital-coldstart.ts');
const builderGasSimulator = read('server/services/cryptocrawl/execution/adapters/builder-sequential-gas-simulator.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const flashExecutor = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');

// Stage 1 is sacred and remains exactly the production-proven -10 BPS classification lock.
assert.match(discovery, /STAGE_ONE_LOCKED_INVARIANT/);
assert.match(discovery, /const STAGE_ONE_ZERO_CAPITAL_ENTRY_FLOOR_BPS = -10;/);
assert.match(discovery, /stageOneLock: 'explicit_operator_authorization_required'/);
assert.doesNotMatch(discovery, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);

// One runtime transformation gateway, one engine. Retired serial Stage-2/V2/fairness DB work
// cannot re-enter the live Atomic BPS path.
assert.match(gateway, /handoffStageOneToAtomicBps/);
assert.match(gateway, /runZeroCapitalAtomicBpsEngine/);
assert.match(gateway, /runZeroCapitalAtomicStackTactic/);
assert.match(gateway, /oneTransformationAuthority: true/);
assert.match(gateway, /oneTransformationPipeline: true/);
assert.match(gateway, /stageOneDirectInMemoryHandoff: true/);
assert.match(gateway, /stageTwoExplicitAcknowledgement: true/);
assert.match(gateway, /handoff\.acknowledge\(\)/);
assert.match(gateway, /boundedRecursiveHandoffSupervision: true/);
assert.match(gateway, /concurrentDuplicateStageTwoRuns: false/);
assert.match(gateway, /staleHandoffReplayAllowed: false/);
assert.match(gateway, /compositeTacticInsideSamePipeline: true/);
assert.match(gateway, /compositeTacticBlocksSingleRouteReturn: false/);
assert.match(gateway, /independentCompositePromotionLoop: false/);
assert.match(gateway, /persistedFairnessOnHotPath: false/);
assert.match(gateway, /stageTwoSerialPass: false/);
assert.doesNotMatch(gateway, /runStageTwoZeroCapitalBpsReduction/);
assert.doesNotMatch(gateway, /runZeroCapitalProfitabilityRescueV2/);
assert.doesNotMatch(gateway, /selectFairZeroCapitalRescueCandidates/);

// Handoff redundancy is layered around delivery only. Healthy flow stays direct and
// in-memory; Stage 2 must explicitly ACK, failed deliveries replay serially under one
// authority, duplicate deliveries share one promise, and stale candidates are never
// blindly replayed.
assert.match(handoff, /directInMemoryHandoff: true/);
assert.match(handoff, /explicitStageTwoAcknowledgement: true/);
assert.match(handoff, /externalQueueOnHotPath: false/);
assert.match(handoff, /databaseOnHotPath: false/);
assert.match(handoff, /boundedRecursiveSupervision: true/);
assert.match(handoff, /const inFlight = new Map/);
assert.match(handoff, /const completed = new Map/);
assert.match(handoff, /input\.consume\(control\)/);
assert.match(handoff, /if \(!attemptAcknowledged\)/);
assert.match(handoff, /supervisor never self-acknowledges/);
assert.match(handoff, /if \(attempt >= maxAttempts\(\)/);
assert.match(handoff, /return recursivelyDeliver\(input, state, attempt \+ 1\)/);
assert.match(handoff, /anyCandidateStillFresh/);
assert.match(handoff, /economicAuthority: false/);
assert.match(handoff, /executionAuthority: false/);
assert.doesNotMatch(handoff, /from ['"][^'"]*supabase/i);
assert.doesNotMatch(handoff, /from ['"][^'"]*(redis|kafka|rabbit|bull)/i);

// Momentum: all probes may start concurrently, but the hot path consumes them in
// completion order and does not wait for size-level OR route-level stragglers once a
// protected strict-positive incumbent can continue. A worse positive result cannot
// prematurely stop search. Freshness reserve remains protected for execution.
assert.match(anytimeRace, /Promise\.race/);
assert.match(anytimeRace, /stoppedOnAcceptable/);
assert.match(anytimeRace, /ignoredStragglers/);
assert.match(anytimeRace, /await Promise\.resolve\(\)/);
assert.match(anytimeRace, /late results cannot delay or overwrite/);
assert.doesNotMatch(anytimeRace, /Promise\.allSettled/);
assert.match(engine, /runAtomicBpsAnytimeRace/);
assert.match(engine, /quoteDecisionDeadlineAt = opportunity\.expiresAt - minimumRemainingLifetimeMs/);
assert.match(engine, /acceptable: probe => probe\.candidate !== null[\s\S]{0,160}clearsStrictProfitability\(probe\.candidate\)[\s\S]{0,160}strictImprovement\(opportunity, probe\.candidate\)/);
assert.match(engine, /const settledPairs = new Map/);
assert.match(engine, /const firstPositive = new Promise/);
assert.match(engine, /const decision = await Promise\.race/);
assert.match(engine, /hasProtectedPositiveIncumbent/);
assert.match(engine, /waitsForAllQuoteStragglers: false/);
assert.match(engine, /waitsForAllRouteStragglers: false/);
assert.match(engine, /firstStrictPositiveImprovementStopsWaiting: true/);
assert.match(engine, /existingStrictPositiveIncumbentStopsWaiting: true/);
assert.match(engine, /worsePositiveCannotStopSearch: true/);
assert.match(engine, /freshnessReserveProtectedForExecution: true/);
assert.match(engine, /lateProbeOverwriteAllowed: false/);
assert.doesNotMatch(engine, /Promise\.allSettled\(sizes\.map/);
assert.doesNotMatch(engine, /const refinedPairs = await Promise\.all\(selected\.map/);

// Exact all-in positive base units are the only post-Stage-1 profitability boundary.
assert.match(engine, /candidate\.netProfit > 0n && candidate\.executablePositive === true/);
assert.match(engine, /profitabilityFinishLine: 'strict_positive_all_in_base_units'/);
assert.match(engine, /strictImprovement\(opportunity, best\)/);
assert.match(engine, /currentMeasuredFixedCostsBound: true/);
assert.match(engine, /providerFreshnessRequired: true/);
assert.match(engine, /providerLiquidityHeadroomRequired: true/);
assert.match(engine, /providerUtilizationBounded: true/);
assert.match(engine, /freshExactRequoteRequired: true/);
assert.match(engine, /existingPositiveNeverReplacedByNegative: true/);
assert.match(engine, /principalRepaymentAndFlashFeeIncludedInNetEconomics: true/);
assert.match(engine, /serialStageTwoThenAtomic: false/);
assert.match(engine, /oneSharedQuoteBudget: true/);
assert.match(engine, /parallelEvidencePrewarm: true/);
assert.match(engine, /parallelRouteOptimization: true/);
assert.match(engine, /supabaseSchedulingOnHotPath: false/);
assert.match(engine, /executionAuthority: false/);
assert.match(engine, /syntheticEconomics: false/);
assert.doesNotMatch(engine, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
assert.doesNotMatch(engine, /atomicSurplusTargetBps/);
assert.doesNotMatch(engine, /from ['"][^'"]*quant/i);
assert.doesNotMatch(engine, /from ['"][^'"]*supabase/i);

// Shared-principal composition is now a tactic owned by the same pipeline. Runtime
// startup may register capability metadata, but no registry listener can autonomously
// promote a candidate and no duplicate configurable Stage-1 threshold remains here.
assert.match(atomicStack, /runZeroCapitalAtomicStackTactic/);
assert.match(atomicStack, /independentMeasuredCandidateListener: false/);
assert.match(atomicStack, /independentPromotionAuthority: false/);
assert.match(atomicStack, /stageOneThresholdAuthority: false/);
assert.match(atomicStack, /stageOneEnvironmentThresholdRead: false/);
assert.match(atomicStack, /parallelVariantMeasurement: true/);
assert.match(atomicStack, /tacticInFlight/);
assert.doesNotMatch(atomicStack, /measuredCandidateRegistry\.onUpdate/);
assert.doesNotMatch(atomicStack, /ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS/);

// Alternative-capital and builder-funded paths cannot secretly revive the retired
// +10 BPS target after the single engine has admitted a strictly-positive route.
for (const source of [alternativeCapital, builderColdStart]) {
  assert.match(source, /minimumPositiveProfitBaseUnits/);
  assert.doesNotMatch(source, /ATOMIC_MINIMUM_TARGET_BPS/);
  assert.doesNotMatch(source, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
  assert.doesNotMatch(source, /ZERO_CAPITAL_RESCUE_TARGET_NET_BPS/);
  assert.doesNotMatch(source, /atomicTargetBps/);
  assert.doesNotMatch(source, /minimumAtomicTargetProfitBaseUnits/);
  assert.doesNotMatch(source, /target_bound_10_bps_or_higher/);
}
assert.match(alternativeCapital, /const requiredNetProfit = minimumPositiveProfitBaseUnits\(\);/);
assert.match(alternativeCapital, /strict_positive_all_in_net_after_source_fee_and_execution_cost/);
assert.match(builderColdStart, /const minimumRetained = minimumPositiveProfitBaseUnits\(\);/);
assert.match(builderColdStart, /minimum_residual:canonical_strict_positive_base_units/);

// Standard builder cold-start now measures the whole dependent sequence against
// evolving EVM state. Fixed estimates survive only as a capability-preserving
// fallback when RPCs lack eth_simulateV1, never after a real simulated EVM failure.
assert.match(builderGasSimulator, /eth_simulateV1/);
assert.match(builderGasSimulator, /blockStateCalls/);
assert.match(builderGasSimulator, /simulateBuilderSequentialGas/);
assert.match(builderGasSimulator, /BuilderSequentialSimulationExecutionError/);
assert.match(builderGasSimulator, /multiProviderRpcManager\.execute/);
assert.match(builderColdStart, /simulateBuilderSequentialGas/);
assert.match(builderColdStart, /maxBuilderGasVectors/);
assert.match(builderColdStart, /builder_gas_measurement:eth_simulateV1_sequential_stateful/);
assert.match(builderColdStart, /fixed_gas_ceiling_admission:false/);
assert.match(builderColdStart, /legacy_conservative_capability_fallback/);
assert.match(builderColdStart, /error instanceof BuilderSequentialSimulationExecutionError/);
assert.match(builderColdStart, /fixedGasPreferred: false/);

// Workers reduce waiting only. They never decide economics or execute money. Cache
// freshness tightens automatically for short-lived opportunities rather than using a
// single stale-friendly TTL for every route.
assert.match(workers, /prewarmAtomicBpsEvidence/);
assert.match(workers, /priceInFlight/);
assert.match(workers, /providerInFlight/);
assert.match(workers, /freshnessBudgetMs/);
assert.match(workers, /Math\.floor\(remaining \/ 4\)/);
assert.match(workers, /opportunityLifetimeBoundedFreshness: true/);
assert.match(workers, /queueMicrotask/);
assert.match(workers, /executionAuthority: false/);
assert.match(workers, /economicAuthority: false/);
assert.match(workers, /supabaseHotPathReads: 0/);
assert.match(workers, /supabaseHotPathWrites: 0/);
assert.doesNotMatch(workers, /from ['"][^'"]*supabase/i);
assert.doesNotMatch(workers, /from ['"][^'"]*quant/i);

// Canonical money boundary stays singular and also uses strict-positive base units,
// never a revived +10 BPS execution gate.
assert.match(executor, /Sole ZERO_CAPITAL_ATOMIC execution entrypoint/);
assert.match(executor, /opportunity\.expectedProfit <= 0n/);
assert.match(executor, /executeFlashCanonicalZeroCapitalOpportunity\(opportunity\)/);
assert.match(executor, /executeCanonicalComposite/);
assert.match(executor, /executeCanonicalAlternative/);
assert.doesNotMatch(executor, /ATOMIC_MINIMUM_TARGET_BPS/);
assert.doesNotMatch(executor, /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/);
assert.doesNotMatch(executor, /atomicSurplusTargetBps/);
assert.doesNotMatch(executor, /required \$\{targetBps\} BPS surplus target/);
assert.match(flashExecutor, /expectedProfit <= 0n/);

// Existing provider mesh stays measured and diverse; no provider becomes mandatory.
assert.match(providerEconomics, /balancer_v2/);
assert.match(providerEconomics, /aave_v3/);
assert.match(providerEconomics, /morpho_blue/);
assert.match(providerEconomics, /calculateMeasuredFlashLoanFee/);

console.log('[atomic-bps-single-pipeline] PASS: Stage 1 remains locked at -10 BPS; post-Stage-1 transformation is one direct in-memory Atomic BPS pipeline with explicit ACK, bounded recursive replay, in-flight deduplication, anytime profitable-improvement selection across size and route probes, protected existing-positive incumbents, freshness-reserved execution, straggler avoidance, lifetime-bounded prewarming, engine-owned composite tactics, exact strict-positive economics across all capital paths, stateful builder gas measurement, non-authority workers, measured provider alternatives, and one unchanged canonical execution boundary');
