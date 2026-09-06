const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const fail = message => { throw new Error(`[zero-capital-single-authority] ${message}`); };
const must = (condition, message) => { if (!condition) fail(message); };
const mustNotContain = (source, token, message) => must(!source.includes(token), message);

const schedulerPath = 'server/services/cryptocrawl/execution/canonical-execution-scheduler.ts';
const runtimePath = 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts';
const authorityPath = 'server/services/cryptocrawl/CANONICAL_AUTHORITIES.md';
const scheduler = read(schedulerPath);
const runtime = read(runtimePath);
const authorities = read(authorityPath);

must(authorities.includes('One live parent-trade scheduler owns every topology'), 'authority map must retain the one-parent-scheduler invariant');
must(authorities.includes('including `ZERO_CAPITAL_ATOMIC`'), 'authority map must assign ZERO_CAPITAL_ATOMIC to the canonical scheduler');
must(scheduler.includes("decision.topology === 'ZERO_CAPITAL_ATOMIC'"), 'canonical scheduler must explicitly dispatch ZERO_CAPITAL_ATOMIC');
must(scheduler.includes('executeCanonicalZeroCapitalOpportunity'), 'canonical scheduler must call the single canonical zero-capital executor');

for (const token of [
  'ensureProviderSpecificZeroCapitalExecutionWiring',
  'ensureDualProviderZeroCapitalExecutionWiring',
  'ensureZeroCapitalDynamicAttemptBarrierWiring',
  'ensureZeroCapitalRealizedProfitWiring',
]) {
  mustNotContain(runtime, token, `canonical runtime must not install execution wrapper ${token}`);
}

const productionAuthorityFiles = [
  'server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts',
  'server/services/cryptocrawl/integration/provider-specific-zero-capital-execution-wiring.ts',
  'server/services/cryptocrawl/integration/dual-provider-zero-capital-execution-wiring.ts',
  'server/services/cryptocrawl/integration/zero-capital-dynamic-attempt-barrier-wiring.ts',
  'server/services/cryptocrawl/runtime/zero-capital-realized-profit-wiring.ts',
];
const forbiddenAssignments = [
  /target\.scanChain\s*=/,
  /target\.dispatchExecutableOpportunities\s*=/,
  /target\.executeFunded\s*=/,
  /runtime\.executeAndRecord\s*=/,
  /prototype\.executeAndRecord\s*=/,
];
for (const file of productionAuthorityFiles) {
  const source = read(file);
  for (const pattern of forbiddenAssignments) {
    must(!pattern.test(source), `${file} retains forbidden runtime method reassignment ${pattern}`);
  }
}

const registry = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-selection-registry.ts');
const dualFacade = read('server/services/cryptocrawl/execution/adapters/dual-flash-loan-provider-selection-registry.ts');
must(registry.includes('SingleFlashLoanProviderSelection') && registry.includes('DualFlashLoanProviderSelection'), 'single provider-selection authority must own both single and dual selections');
mustNotContain(dualFacade, 'new Map<', 'dual-provider compatibility facade must not own independent selection state');

const measured = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
mustNotContain(measured, "previous.status === 'eligible'", 'candidate registry must not preserve stale eligible status across canonical repricing');

console.log('[zero-capital-single-authority] PASS');
