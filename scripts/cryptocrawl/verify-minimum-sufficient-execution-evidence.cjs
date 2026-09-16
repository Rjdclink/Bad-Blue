const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }

const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const gateway = read('server/services/cryptocrawl/integration/zero-capital-profitability-rescue-fair.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const lease = read('server/services/cryptocrawl/integration/ape-profitable-snapshot-lease.ts');
const multileg = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');

// Required execution evidence is authoritative. Optional, redundant, advisory,
// telemetry and learning fields remain observable but cannot become shadow vetoes.
has(registry, "normalized.startsWith('required:')", 'required execution evidence must remain blocking');
has(registry, "normalized.startsWith('critical:')", 'critical execution evidence must remain blocking');
has(registry, "normalized.startsWith('optional:')", 'optional evidence must remain explicitly nonblocking');
has(registry, "normalized.startsWith('redundant:')", 'redundant evidence must remain explicitly nonblocking');
has(registry, "normalized.startsWith('advisory:')", 'advisory evidence must remain explicitly nonblocking');
has(registry, 'executionBlockingMissingInformation(candidate)', 'consumer snapshots must expose execution-blocking evidence gaps');
has(registry, 'const next = clone(previous, true);', 'internal updates must preserve complete diagnostic evidence');
has(registry, 'advisory_missing_nonblocking:', 'nonblocking evidence gaps must remain observable through provenance');

// Canonical execution requires concrete live facts. ZERO_CAPITAL_ATOMIC uses the
// canonical exact strict-positive all-in profit boundary; other topology contracts
// may retain their existing Stage-3 target semantics in this bounded change.
has(router, 'const admitted = economicsAdmitted\n    && stageThreeTargetSatisfied\n    && pathAvailable\n    && candidate.executableCapability\n    && fresh\n    && depthReady\n    && hardVetoReasons.length === 0;', 'router must require topology-correct economics, all concrete execution evidence and no hard veto');
has(router, "const isZeroCapitalAtomic = candidate.topology === 'ZERO_CAPITAL_ATOMIC';", 'router must explicitly identify the Atomic BPS Zero-Capital lane');
has(router, 'const stageThreeTargetSatisfied = isZeroCapitalAtomic\n    ? deterministicPositive', 'Zero Capital must use deterministic strict-positive all-in economics instead of a magnitude target');
has(router, "`stage3_target=${isZeroCapitalAtomic ? 'strict_positive_all_in_base_units'", 'router must expose the Zero-Capital strict-positive finish line');
has(router, 'advisory:missing_information:', 'non-required missing information must remain advisory');
has(scheduler, 'candidate.missingInformation.length === 0', 'scheduler must retain defense-in-depth over registry-filtered required gaps');

// Shared-principal composition is an internal tactic of the single Atomic-BPS
// pipeline. Stale evidence cannot gain economic/execution authority and the exact
// simulation deadline remains bounded by member freshness. Positive acceptance does
// not terminate the bounded variant/group search: the best measured composition is
// retained through the candidate's remaining executable window.
has(gateway, 'runZeroCapitalAtomicStackTactic', 'single Atomic-BPS gateway must own composite tactic triggering');
has(gateway, 'compositeTacticInsideSamePipeline: true', 'composite tactic must remain inside the single transformation pipeline');
has(gateway, 'compositeTacticBlocksSingleRouteReturn: false', 'composite tactic must not delay a profitable single route beyond its execution reserve');
has(stack, "candidate.status !== 'blocked'", 'atomic stack tactic must reject blocked candidates');
has(stack, 'if (input.opportunities.some(opportunity => opportunity.expiresAt <= now)) return null;', 'atomic stack exact simulation must reject stale opportunity evidence');
has(stack, 'const expiresAt = Math.min(...input.opportunities.map(opportunity => opportunity.expiresAt), input.deadlineAt ?? Number.MAX_SAFE_INTEGER);', 'atomic stack exact proof deadline must remain bounded by member evidence expiry');
has(stack, "candidate.depth.status !== 'unavailable'", 'atomic stack tactic must require measurable route depth');
has(stack, 'input_authority:single_atomic_bps_engine_stage1_admitted_candidates', 'atomic stack tactic must inherit its intake authority from the locked Stage-1 stream');
has(stack, 'stageOneThresholdAuthority: false', 'atomic stack tactic must not own Stage-1 threshold authority');
has(stack, 'stageOneEnvironmentThresholdRead: false', 'atomic stack tactic must not read a second Stage-1 threshold');
must(!stack.includes('ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS'), 'duplicate Atomic Stage-1 entry-floor variable must not return');
has(stack, 'const STRICT_POSITIVE_PROFIT_BASE_UNITS = 1n;', 'atomic stack must bind profitability to the smallest exactly positive base-unit value');
has(stack, 'requiredStrictPositiveProfitBaseUnits(first)', 'atomic stack must consume the canonical strict-positive base-unit authority');
has(stack, 'combinedExpectedProfit < targetNetProfitBaseUnits || combinedExpectedProfit <= 0n', 'atomic stack must require strictly positive all-in economics');
has(stack, 'measuredCompositionGain <= 0n', 'atomic stack must require a real measured composition improvement');
has(stack, 'exact_strict_positive_composite_eth_call_passed', 'atomic stack must preserve exact strict-positive simulation evidence');
must(!stack.includes('ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS'), 'retired Atomic +10 target variable must not return');
must(!stack.includes('atomicSurplusTargetBps'), 'retired Atomic +10 target helper must not return');
must(!stack.includes('getProfitLadderDailyProfitBudget'), 'Profit Ladder database reads must stay off Atomic composition measurement path');
has(stack, 'aggregateEconomicsAuthority: true', 'Atomic composition must expose aggregate exact economics as the composition authority');
has(stack, 'adaptiveMinLegsVetoAuthority: false', 'advisory topology policy must not veto Atomic composition');
has(stack, 'completionOrderVariantMeasurement: true', 'atomic stack variants must be consumed in completion order');
has(stack, 'fullVariantBatchBarrier: false', 'atomic stack may not use a full variant barrier');
has(stack, 'firstPositiveStopsVariantSearch: false', 'atomic stack must continue bounded optimization after first positive variant');
has(stack, 'bestMeasuredProfitableVariantSelected: true', 'atomic stack must retain the best measured profitable variant');
has(stack, 'firstPromotionStopsSiblingGroups: false', 'one profitable group must not cancel compatible sibling groups');
must(!stack.includes('if (settled.result.promoted > 0) return aggregate'), 'first promoted group must not terminate sibling search');
has(stack, "status: 'eligible'", 'only the newly measured strictly-positive composite may be promoted eligible');
has(stack, 'executableCapability: true', 'strictly-positive composite must receive explicit executable capability');
has(stack, 'missingInformation: []', 'promoted composite must carry complete execution evidence');
has(stack, "promotion_authority:single_atomic_bps_engine", 'composite promotion must remain attributed to the single Atomic-BPS engine');
has(stack, 'executionAuthority: false', 'atomic stack must remain non-execution authority');

// The profitable fallback itself is resident pointer state. It cannot extend stale
// evidence and its decision path adds no database/network dependency.
has(lease, 'bestProfit: ZeroCapitalOpportunity', 'best profitable fallback pointer missing');
has(lease, 'freshestPositive: ZeroCapitalOpportunity', 'fresh positive shadow pointer missing');
has(lease, 'persistenceOnHotPath: false', 'profitable fallback added persistence to hot path');
has(lease, 'networkIoOnDecisionPath: false', 'profitable fallback added network I/O to decision path');
has(lease, 'staleEvidenceExtended: false', 'profitable fallback may not extend stale evidence');
has(gateway, 'executeBeforeExpiry: true', 'profitable execution reserve escape missing');
has(gateway, 'profitEscapeCanPreemptRemainingOptimization: true', 'optional optimization may still consume execution reserve');

// General multileg optimization remains downstream of ordinary execution admission:
// it cannot relax freshness, eligibility, capability, depth, path or positive-net
// requirements and still requires independent final admission.
has(multileg, "candidate.expiresAt <= now || candidate.status !== 'eligible' || !candidate.executableCapability", 'multileg selection must require fresh eligible executable candidates');
has(multileg, "candidate.depth.status === 'unavailable'", 'multileg selection must require executable depth');
has(multileg, 'netProfitUsd <= 0', 'multileg selection must require positive deterministic all-in economics');
has(multileg, 'if (!pathDecision?.executableNow) return null;', 'multileg selection must require an executable path');
has(multileg, 'requiresIndependentFinalAdmission: true', 'multileg optimization cannot bypass final execution admission');

// This verifier already runs inside deployment-preflight. Pull the dedicated
// Atomic-BPS structural gate into the same mandatory prebuild path so these
// invariants cannot drift without failing the build.
execFileSync(
  process.execPath,
  ['scripts/cryptocrawl/verify-nix-gen-atomic-bps-single-pipeline.cjs'],
  { stdio: 'inherit', env: process.env },
);

console.log('[required-execution-evidence] PASS: execution remains guarded by topology-correct strict-positive economics plus live evidence; Atomic composition searches past first profitability, retains the best bounded measured result, and execute-before-expiry prevents optional optimization from consuming the profitable execution reserve');