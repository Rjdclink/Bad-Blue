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
const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');

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
requireText(wiring, 'profitPasses\n      && confidence', 'positive all-in profitability must remain a mandatory opening condition');
requireText(wiring, 'canonicalExecutionScheduler.dispatchOnce()', 'canonical scheduler must remain execution authority');
requireText(wiring, "lifecycleOwner: 'CryptoCoreRuntime'", 'scheduler lifecycle must remain owned by CryptoCoreRuntime');
requireText(wiring, "competitionEvidenceAuthority: 'topology_aware_no_nan'", 'runtime must attest the new competition authority');
requireText(wiring, "nonFiniteReasoningPolicy: 'skip_optional_reasoning_no_synthetic_fallback'", 'runtime must attest fail-safe non-finite reasoning policy');
forbidText(wiring, 'canonicalExecutionScheduler.start()', 'compatibility bridge must not reintroduce duplicate scheduler startup authority');
forbidText(wiring, 'Competition: NaN', 'NaN competition diagnostics are forbidden');

requireText(progression, "import('../faucet/concurrent-execution-wiring.js')", 'competition/execution compatibility bridge must be installed by governed startup');
requireText(progression, 'module.ensureConcurrentExecutionWiring()', 'governed startup must invoke the compatibility bridge');

// Root-cause sentinel remains inside the large legacy class for compatibility;
// every active numeric consumer is intercepted by this bridge. If that sentinel
// moves, fail so the migration is re-audited instead of silently weakening the guard.
requireText(faucet, 'competitionLevel: Number.NaN', 'legacy competition sentinel moved; re-audit all consumers before changing this guard');
requireText(faucet, 'threat += this.marketConditions.competitionLevel * 0.3', 'legacy threat consumer moved; re-audit finite reasoning protection');

console.log('[competition-evidence-wiring] PASS — CEX competition is topology-aware, NaN is excluded from active decisions/reasoning, and scheduler authority remains singular');
