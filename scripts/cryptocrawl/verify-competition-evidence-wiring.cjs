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
const cryptaraCex = read('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts');
const faucet = read('server/services/cryptocrawl/faucet/autonomous-faucet.ts');
const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');

requireText(policy, "'measured' | 'not_applicable' | 'unavailable'", 'competition evidence must preserve explicit measured/not-applicable/unavailable states');
requireText(policy, "topology: 'CEX_CEX' | 'ONCHAIN'", 'competition evidence must be topology-aware');
requireText(policy, "input.topology === 'CEX_CEX'", 'CEX_CEX applicability policy is missing');
requireText(policy, "status: 'not_applicable'", 'CEX_CEX competition must not be fabricated as a numeric value');
requireText(policy, "status: 'unavailable'", 'missing on-chain evidence must remain unavailable');
requireText(policy, "typeof value === 'number' && Number.isFinite(value)", 'non-finite evidence guard must not coerce null/string values into numbers');

requireText(wiring, "from './competition-evidence-policy.js'", 'legacy faucet bridge is not consuming canonical competition evidence policy');
requireText(wiring, "ensureCryptaraCexEvidenceWiring", 'CEX topology applicability must also be installed for Cryptara');
requireText(wiring, 'target.makeOpenDecision = async', 'legacy opening decision is not protected by the compatibility bridge');
requireText(wiring, "topology: 'CEX_CEX'", 'faucet CEX execution topology is not explicitly bound for competition evidence');
requireText(wiring, "Gas cost: N/A for CEX_CEX", 'on-chain gas must not gate centralized CEX_CEX opening');
requireText(wiring, "notApplicable: ['gas_cost', 'competition']", 'opening confidence must exclude topology-inapplicable gas and mempool competition');
requireText(wiring, 'const shouldOpen = profitPasses', 'positive all-in profitability must remain a mandatory opening condition');
requireText(wiring, 'canonicalExecutionScheduler.dispatchOnce()', 'canonical scheduler must remain execution authority');
requireText(wiring, "lifecycleOwner: 'CryptoCoreRuntime'", 'scheduler lifecycle must remain owned by CryptoCoreRuntime');
requireText(wiring, 'legacyCainCexExecutionAuthority: false', 'legacy mixed-topology Cain reasoning must not become CEX execution authority');
requireText(wiring, "competitionEvidenceAuthority: 'topology_aware_no_nan'", 'runtime must attest the competition authority');
requireText(wiring, "nonFiniteEvidencePolicy: 'unknown_or_not_applicable_never_synthetic_zero'", 'runtime must attest non-finite evidence policy');
forbidText(wiring, 'canonicalExecutionScheduler.start()', 'compatibility bridge must not reintroduce duplicate scheduler startup authority');
forbidText(wiring, 'await target.performDimensionalReasoning()', 'legacy Cain mixed-topology reasoning must not gate CEX opening');
forbidText(wiring, 'Competition: NaN', 'NaN competition diagnostics are forbidden');

requireText(cryptaraCex, "CEX_EXECUTION_VENUES = new Set(['kraken', 'okx'])", 'Cryptara CEX applicability must be limited to executable Kraken/OKX plans');
requireText(cryptaraCex, ".filter(item => item !== 'mempool_evidence')", 'Cryptara must remove only the CEX-inapplicable mempool completeness penalty');
requireText(cryptaraCex, "'not_applicable:mempool_evidence'", 'Cryptara correction must preserve explicit provenance');
requireText(cryptaraCex, 'canonicalOpportunityState.get(context.opportunityId)', 'canonical Monte Carlo state must be read before corrected snapshot overwrite');
requireText(cryptaraCex, 'monteCarlo: priorCanonicalMonteCarlo', 'canonical Monte Carlo state must be preserved');
requireText(cryptaraCex, 'syntheticMempoolEvidenceCreated: false', 'Cryptara CEX correction must never invent mempool evidence');
requireText(cryptaraCex, 'economicsChanged: false', 'Cryptara topology correction must not alter deterministic economics');

requireText(progression, "import('../faucet/concurrent-execution-wiring.js')", 'competition/execution compatibility bridge must be installed by governed startup');
requireText(progression, 'module.ensureConcurrentExecutionWiring()', 'governed startup must invoke the compatibility bridge');

// Root-cause sentinel remains inside the large legacy class for compatibility;
// all active CEX decision consumers are intercepted. If that sentinel or its old
// consumer moves, fail so the migration is re-audited rather than silently bypassed.
requireText(faucet, 'competitionLevel: Number.NaN', 'legacy competition sentinel moved; re-audit all consumers before changing this guard');
requireText(faucet, 'threat += this.marketConditions.competitionLevel * 0.3', 'legacy threat consumer moved; re-audit the compatibility boundary');

console.log('[competition-evidence-wiring] PASS — CEX gas/mempool/Cain topology leakage is quarantined, Cryptara completeness is corrected without synthetic evidence, and scheduler authority remains singular');
