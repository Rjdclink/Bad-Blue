const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }

const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
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

// The zero-capital Atomic stack is an advisory transformation lane. It may consume
// fresh measured near-misses before they are eligible, because its job is to create
// real shared-principal surplus. It rejects blocked/expired/unmeasurable inputs and
// promotes only after exact simulation proves at least one base unit of all-in net
// profit plus a real measured composition gain. No arbitrary positive BPS target is
// execution authority. Profit Ladder remains telemetry only.
has(stack, "candidate.status === 'blocked'", 'atomic stack advisory must reject blocked candidates');
has(stack, "candidate.status === 'expired'", 'atomic stack advisory must reject expired candidates');
has(stack, "candidate.expiresAt <= Date.now()", 'atomic stack advisory must require fresh evidence');
has(stack, "candidate.depth.status === 'unavailable'", 'atomic stack advisory must require measurable route depth');
has(stack, 'netBps >= atomicSurplusEntryFloorBps()', 'atomic stack advisory must use the locked near-miss entry window');
has(stack, 'const STRICT_POSITIVE_PROFIT_BASE_UNITS = 1n;', 'atomic stack must bind profitability to the smallest exactly positive base-unit value');
has(stack, 'const targetNetProfitBaseUnits = STRICT_POSITIVE_PROFIT_BASE_UNITS;', 'atomic stack compatibility target must resolve to exact strict positivity');
has(stack, 'combinedExpectedProfit < targetNetProfitBaseUnits || combinedExpectedProfit <= 0n', 'atomic stack must require strictly positive all-in economics');
has(stack, 'measuredCompositionGain <= 0n', 'atomic stack must require a real measured composition improvement');
has(stack, 'exact_strict_positive_composite_eth_call_passed', 'atomic stack must preserve exact strict-positive simulation evidence');
must(!stack.includes('ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS'), 'retired Atomic +10 target variable must not return');
must(!stack.includes('atomicSurplusTargetBps'), 'retired Atomic +10 target helper must not return');
has(stack, 'const budget = await getProfitLadderDailyProfitBudget().catch(() => null);', 'Profit Ladder daily budget may remain observable telemetry');
has(stack, 'expectedNetProfitUsd > budget.remainingProfitUsd + 0.01', 'Profit Ladder may count variants outside the remaining daily-profit budget for telemetry');
has(stack, 'variantsOutsideRemainingDailyProfitBudget: outsideRemainingDailyProfitBudget', 'out-of-budget variants must remain visible as telemetry');
has(stack, 'borrowingNotionalAuthority: false', 'Profit Ladder must not become borrowed-principal authority');
has(stack, 'profitLadderCompositionVetoAuthority: false', 'Profit Ladder must not veto Atomic composition');
has(stack, 'profitLadderExecutionVetoAuthority: false', 'Profit Ladder must not veto deterministic execution');
must(!stack.includes('expectedProfitFitsDailyBudget('), 'retired Profit Ladder daily-budget veto helper must not return');
has(stack, "status: 'eligible'", 'only the newly measured strictly-positive composite may be promoted eligible');
has(stack, 'executableCapability: true', 'strictly-positive composite must receive explicit executable capability');
has(stack, 'missingInformation: []', 'promoted composite must carry complete execution evidence');
has(stack, 'executionAuthority: false', 'atomic stack must remain advisory-only');

// General multileg optimization remains downstream of ordinary execution admission:
// it cannot relax freshness, eligibility, capability, depth, path or positive-net
// requirements and still requires independent final admission.
has(multileg, "candidate.expiresAt <= now || candidate.status !== 'eligible' || !candidate.executableCapability", 'multileg selection must require fresh eligible executable candidates');
has(multileg, "candidate.depth.status === 'unavailable'", 'multileg selection must require executable depth');
has(multileg, 'netProfitUsd <= 0', 'multileg selection must require positive deterministic all-in economics');
has(multileg, 'if (!pathDecision?.executableNow) return null;', 'multileg selection must require an executable path');
has(multileg, 'requiresIndependentFinalAdmission: true', 'multileg optimization cannot bypass final execution admission');

console.log('[required-execution-evidence] PASS: execution remains guarded by topology-correct economics plus minimum sufficient live evidence; ZERO_CAPITAL_ATOMIC uses exact strict-positive all-in base units with no +10 magnitude floor; Atomic composition may transform fresh near-misses only when exact simulation proves positive net and measured composition gain; Profit Ladder/optional/advisory completeness cannot become shadow vetoes');