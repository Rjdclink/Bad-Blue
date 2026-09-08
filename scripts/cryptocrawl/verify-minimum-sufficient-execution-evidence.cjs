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

// Canonical execution requires the concrete facts needed to submit this route:
// positive all-in economics for its domain, an available execution path,
// authoritative capability, freshness and executable depth.
has(router, 'const admitted = economicsAdmitted && pathAvailable && candidate.executableCapability && fresh && depthReady && hardVetoReasons.length === 0;', 'router must require all concrete execution evidence and no hard veto');
has(router, 'advisory:missing_information:', 'non-required missing information must remain advisory');
has(scheduler, 'candidate.missingInformation.length === 0', 'scheduler must retain defense-in-depth over registry-filtered required gaps');

// Advisory optimizers may consume already-qualified candidates but cannot invent
// new execution evidence requirements or simulation vetoes.
has(stack, "candidate.status !== 'eligible'", 'atomic stack advisory must consume current eligible candidates');
has(stack, 'candidate.executableCapability !== true', 'atomic stack advisory must require authoritative executable capability');
has(stack, 'candidate.expiresAt <= Date.now()', 'atomic stack advisory must require fresh evidence');
has(stack, 'executionAuthority: false', 'atomic stack must remain advisory-only');

has(multileg, "candidate.expiresAt <= now || candidate.status !== 'eligible' || !candidate.executableCapability", 'multileg selection must require fresh eligible executable candidates');
has(multileg, "candidate.depth.status === 'unavailable'", 'multileg selection must require executable depth');
has(multileg, 'netProfitUsd <= 0', 'multileg selection must require positive deterministic all-in economics');
has(multileg, 'if (!pathDecision?.executableNow) return null;', 'multileg selection must require an executable path');
has(multileg, 'requiresIndependentFinalAdmission: true', 'multileg optimization cannot bypass final execution admission');

console.log('[required-execution-evidence] PASS: execution is guarded by the evidence actually required for profitable live submission; optional/advisory completeness and simulations cannot become shadow vetoes');
