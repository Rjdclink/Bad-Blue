const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = message => {
  console.error(`[competition-evidence-wiring] FAIL: ${message}`);
  process.exit(1);
};
const requireText = (source, text, message) => {
  if (!source.includes(text)) fail(message);
};
const forbidText = (source, text, message) => {
  if (source.includes(text)) fail(message);
};

const policy = read('server/services/cryptocrawl/faucet/competition-evidence-policy.ts');
const wiring = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');

requireText(policy, "'measured' | 'not_applicable' | 'unavailable'", 'competition evidence must preserve explicit measured/not-applicable/unavailable states');
requireText(policy, "topology: 'CEX_CEX' | 'ONCHAIN'", 'competition evidence must be topology-aware');
requireText(policy, "input.topology === 'CEX_CEX'", 'CEX_CEX applicability policy is missing');
requireText(policy, "status: 'not_applicable'", 'CEX_CEX competition must not be fabricated as a numeric value');
requireText(policy, "status: 'unavailable'", 'missing on-chain evidence must remain unavailable');
requireText(policy, 'Number.isFinite', 'competition authority must reject non-finite evidence');

requireText(wiring, "from './competition-evidence-policy.js'", 'legacy faucet compatibility bridge is not consuming canonical competition evidence policy');
requireText(wiring, 'target.makeOpenDecision = async', 'legacy opening decision is not protected by the compatibility bridge');
requireText(wiring, 'target.performDimensionalReasoning = async', 'non-finite advisory reasoning inputs are not intercepted');
requireText(wiring, "topology: 'CEX_CEX'", 'faucet CEX execution topology is not explicitly bound for competition evidence');
requireText(wiring, "notApplicable: ['competition']", 'opening confidence must explicitly exclude non-applicable CEX mempool competition');
requireText(wiring, 'profitPasses &&', 'positive all-in profitability must remain a mandatory opening condition');
requireText(wiring, 'canonicalExecutionScheduler.dispatchOnce()', 'canonical scheduler must remain execution authority');
requireText(wiring, "competitionEvidenceAuthority: 'topology_aware_no_nan'", 'runtime must attest the new competition authority');
requireText(wiring, "nonFiniteReasoningPolicy: 'skip_optional_reasoning_no_synthetic_fallback'", 'runtime must attest fail-safe non-finite reasoning policy');

forbidText(wiring, 'Competition: ${(target.marketConditions.competitionLevel * 100)', 'compatibility decision authority must never format raw competitionLevel as a percentage');
forbidText(wiring, 'Competition: NaN', 'NaN competition diagnostics are forbidden');

// The legacy class still contains its pre-wiring implementation for compatibility,
// so make sure the runtime bridge is actually installed by startup wiring rather
// than falsely declaring the source dead.
if (!/ensureConcurrentExecutionWiring\s*\(\s*\)/.test(read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts'))
    && !/ensureConcurrentExecutionWiring\s*\(\s*\)/.test(read('server/services/cryptocrawl/faucet/index.ts'))
    && !/ensureConcurrentExecutionWiring\s*\(\s*\)/.test(read('server/services/cryptocrawl/faucet/faucet-integration.ts'))) {
  // Search a bounded set of known CryptoCrawler startup modules before failing.
  const candidates = [
    'server/services/cryptocrawl/integration/master-orchestrator-measured-wiring.ts',
    'server/services/cryptocrawl/governance/automatic-stage-progression.ts',
  ].filter(relative => fs.existsSync(path.join(root, relative)));
  const installed = candidates.some(relative => /ensureConcurrentExecutionWiring\s*\(\s*\)/.test(read(relative)));
  if (!installed) fail('ensureConcurrentExecutionWiring() must be invoked by a CryptoCrawler startup authority');
}

// Preserve the original root-cause evidence as an assertion: the legacy class
// intentionally uses NaN to mean unavailable. The bridge must therefore remain
// installed until that class is fully migrated to typed evidence.
requireText(faucet, 'competitionLevel: Number.NaN', 'expected legacy NaN sentinel moved; re-audit the bridge instead of silently losing the regression guard');

console.log('[competition-evidence-wiring] PASS — topology-aware competition evidence blocks NaN leakage while preserving canonical execution authority');
