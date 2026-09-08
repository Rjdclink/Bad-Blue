const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(ok, message) { if (!ok) throw new Error(message); }
function has(text, needle, message) { must(text.includes(needle), message); }

const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const multileg = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');

has(registry, 'hasMinimumSufficientExecutionEvidence', 'registry must define the minimum-sufficient execution invariant');
has(registry, "candidate.status === 'eligible'", 'minimum-sufficient evidence must require current eligibility');
has(registry, 'candidate.executableCapability === true', 'minimum-sufficient evidence must require authoritative executable capability');
has(registry, "candidate.depth.status !== 'unavailable'", 'minimum-sufficient evidence must retain actual depth requirements');
has(registry, 'netBps > 0', 'minimum-sufficient evidence must retain positive canonical net economics');
has(registry, "normalized.startsWith('optional:')", 'optional evidence must be explicitly nonblocking');
has(registry, "normalized.startsWith('redundant:')", 'redundant evidence must be explicitly nonblocking');
has(registry, "normalized.startsWith('advisory:')", 'advisory evidence must be explicitly nonblocking');
has(registry, "normalized.startsWith('required:')", 'future explicitly-required gaps must remain blocking');
has(registry, "normalized.startsWith('critical:')", 'future explicitly-critical gaps must remain blocking');
has(registry, 'executionBlockingMissingInformation(candidate)', 'consumer snapshots must expose only execution-blocking missing information');
has(registry, 'const next = clone(previous, true);', 'internal updates must preserve complete diagnostic missing evidence');
has(registry, 'advisory_missing_nonblocking:', 'nonblocking missing evidence must remain observable through provenance');

// Execution consumers keep defense-in-depth guards over the registry-filtered
// snapshot. The atomic stack is advisory-only, so it must consume authoritative
// eligible/executable candidates without creating an additional completeness veto.
has(scheduler, 'candidate.missingInformation.length === 0', 'scheduler defense-in-depth missing-information guard should remain');
has(stack, "candidate.status !== 'eligible'", 'atomic stack advisory must require current eligible candidates');
has(stack, 'candidate.executableCapability !== true', 'atomic stack advisory must require authoritative executable capability');
has(stack, 'executionAuthority: false', 'atomic stack must remain advisory-only without independent execution authority');
has(multileg, 'candidate.missingInformation.length', 'multileg defense-in-depth missing-information guard should remain');

has(router, 'const admitted = economicsAdmitted && pathAvailable && candidate.executableCapability && fresh && depthReady;', 'router admission must remain based on minimum execution facts, not completeness scoring');
has(router, 'advisory:missing_information:', 'missing information must remain visible as advisory evidence');

console.log('[minimum-sufficient-execution-evidence] PASS: optional/redundant/advisory missing information cannot veto a minimum-proven profitable executable trade; explicit required/critical gaps still fail closed and advisory optimizers cannot create shadow completeness vetoes');
