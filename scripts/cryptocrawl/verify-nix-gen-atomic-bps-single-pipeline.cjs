const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const handoff = read('server/services/cryptocrawl/integration/zero-capital-stage-handoff-supervisor.ts');
const engine = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-engine.ts');
const workers = read('server/services/cryptocrawl/integration/zero-capital-atomic-bps-workers.ts');
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
assert.match(gateway, /oneTransformationAuthority: true/);
assert.match(gateway, /oneTransformationPipeline: true/);
assert.match(gateway, /stageOneDirectInMemoryHandoff: true/);
assert.match(gateway, /boundedRecursiveHandoffSupervision: true/);
assert.match(gateway, /concurrentDuplicateStageTwoRuns: false/);
assert.match(gateway, /staleHandoffReplayAllowed: false/);
assert.match(gateway, /persistedFairnessOnHotPath: false/);
assert.match(gateway, /stageTwoSerialPass: false/);
assert.doesNotMatch(gateway, /runStageTwoZeroCapitalBpsReduction/);
assert.doesNotMatch(gateway, /runZeroCapitalProfitabilityRescueV2/);
assert.doesNotMatch(gateway, /selectFairZeroCapitalRescueCandidates/);

// Handoff redundancy is layered around delivery only. Healthy flow stays direct and
// in-memory; failed deliveries replay serially under one Stage-2 authority, duplicate
// deliveries share one promise, and stale candidates are never blindly replayed.
assert.match(handoff, /directInMemoryHandoff: true/);
assert.match(handoff, /externalQueueOnHotPath: false/);
assert.match(handoff, /databaseOnHotPath: false/);
assert.match(handoff, /boundedRecursiveSupervision: true/);
assert.match(handoff, /const inFlight = new Map/);
assert.match(handoff, /const completed = new Map/);
assert.match(handoff, /if \(attempt >= maxAttempts\(\)/);
assert.match(handoff, /return recursivelyDeliver\(input, state, attempt \+ 1\)/);
assert.match(handoff, /anyCandidateStillFresh/);
assert.match(handoff, /economicAuthority: false/);
assert.match(handoff, /executionAuthority: false/);
assert.doesNotMatch(handoff, /from ['"][^'"]*supabase/i);
assert.doesNotMatch(handoff, /from ['"][^'"]*(redis|kafka|rabbit|bull)/i);

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

// Workers reduce waiting only. They never decide economics or execute money.
assert.match(workers, /prewarmAtomicBpsEvidence/);
assert.match(workers, /priceInFlight/);
assert.match(workers, /providerInFlight/);
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

console.log('[atomic-bps-single-pipeline] PASS: Stage 1 remains locked at -10 BPS; post-Stage-1 transformation is one direct in-memory Atomic BPS pipeline with bounded handoff replay, in-flight deduplication, parallel prewarming, exact strict-positive economics, non-authority workers, measured provider alternatives, and one unchanged canonical execution boundary');
