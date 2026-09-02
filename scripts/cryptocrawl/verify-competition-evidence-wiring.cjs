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
const requireOrder = (source, first, second, message) => {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) fail(message);
};

const policy = read('server/services/cryptocrawl/faucet/competition-evidence-policy.ts');
const compatibility = read('server/services/cryptocrawl/faucet/concurrent-execution-wiring.ts');
const cryptaraCex = read('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

requireText(policy, "'measured' | 'not_applicable' | 'unavailable'", 'competition evidence must preserve explicit measured/not-applicable/unavailable states');
requireText(policy, "topology: 'CEX_CEX' | 'ONCHAIN'", 'competition evidence must be topology-aware');
requireText(policy, "input.topology === 'CEX_CEX'", 'CEX_CEX applicability policy is missing');
requireText(policy, "status: 'not_applicable'", 'CEX_CEX competition must not be fabricated as a numeric value');
requireText(policy, "status: 'unavailable'", 'missing on-chain evidence must remain unavailable');
requireText(policy, "typeof value === 'number' && Number.isFinite(value)", 'non-finite evidence guard must not coerce null/string values into numbers');
requireText(policy, 'Competition: N/A for CEX_CEX', 'CEX competition diagnostics must remain explicitly not applicable');
requireText(policy, 'Competition: unknown', 'missing on-chain competition must remain explicit unknown evidence');
forbidText(policy, 'Number(evidence.level)', 'competition evidence cannot coerce missing values into synthetic numbers');

// The historical faucet monkey-patch bridge is retired. It may expose scheduler
// statistics for compatibility diagnostics, but it cannot patch decisions or own
// scheduler startup/execution lifecycle.
requireText(compatibility, 'Legacy faucet concurrency patch retired', 'legacy faucet compatibility layer must remain inert');
requireText(compatibility, "executionAuthority: 'canonical_execution_scheduler'", 'compatibility diagnostics must point to canonical execution authority');
requireText(compatibility, "lifecycleOwner: 'CryptoCoreRuntime'", 'scheduler lifecycle must remain owned by CryptoCoreRuntime');
forbidText(compatibility, 'target.makeOpenDecision', 'retired compatibility layer cannot patch opening decisions');
forbidText(compatibility, 'performDimensionalReasoning', 'legacy Cain reasoning cannot gate CEX execution');
forbidText(compatibility, 'canonicalExecutionScheduler.start()', 'compatibility layer cannot reintroduce duplicate scheduler startup authority');

// CEX topology applicability is installed directly by canonical runtime before
// measured discovery starts. It must first install the canonical bootstrap-aware
// Cryptara assessment stack, then remove only the inapplicable mempool completeness
// penalty without altering economics, Monte Carlo, or execution authority.
requireText(cryptaraCex, "CEX_EXECUTION_VENUES = new Set(['coinbase', 'kraken', 'okx'])", 'Cryptara CEX applicability must cover every implemented executable CEX venue');
requireText(cryptaraCex, "import { ensureCryptaraAssessmentWiring } from './cryptara-assessment-wiring.js';", 'CEX topology adapter must depend on the canonical bootstrap-aware assessment stack');
requireText(cryptaraCex, 'const instance = ensureCryptaraAssessmentWiring();', 'CEX topology adapter must install canonical assessment before wrapping it');
forbidText(cryptaraCex, 'const instance = getCryptara();', 'CEX topology adapter cannot wrap an un-wired base Cryptara singleton');
requireText(cryptaraCex, ".filter(item => item !== 'mempool_evidence')", 'Cryptara must remove only the CEX-inapplicable mempool completeness penalty');
requireText(cryptaraCex, "'not_applicable:mempool_evidence'", 'Cryptara correction must preserve explicit topology provenance');
requireText(cryptaraCex, 'canonicalOpportunityState.get(context.opportunityId)', 'canonical Monte Carlo state must be read before corrected snapshot overwrite');
requireText(cryptaraCex, 'monteCarlo: priorCanonicalMonteCarlo', 'canonical Monte Carlo state must be preserved');
requireText(cryptaraCex, 'syntheticMempoolEvidenceCreated: false', 'Cryptara CEX correction must never invent mempool evidence');
requireText(cryptaraCex, 'monteCarloChanged: false', 'Cryptara CEX correction must not alter Monte Carlo authority');
requireText(cryptaraCex, 'economicsChanged: false', 'Cryptara topology correction must not alter deterministic economics');

requireText(runtime, "import { ensureCryptaraCexEvidenceWiring } from './cryptara-cex-evidence-wiring.js';", 'canonical runtime must import CEX topology correction');
requireText(runtime, 'ensureCryptaraCexEvidenceWiring();', 'canonical runtime must install CEX topology correction');
requireOrder(runtime, 'ensureCryptaraCexEvidenceWiring();', 'multiTopologyDiscoveryController.start();', 'CEX topology correction must install before the canonical discovery controller can assess candidates');
requireText(runtime, "historicalProofRequiredBeforeFirstExecution: false", 'runtime must preserve no-history bootstrap authority');
requireText(runtime, "stageOneBootstrapAuthority: 'fresh_current_evidence_without_prior_profit_history'", 'runtime must preserve fresh-current-evidence Stage-1 bootstrap semantics');
requireText(runtime, "executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero'", 'runtime must preserve strict positive all-in economics');
requireText(runtime, 'cryptaraCortexExecutionAuthority: false', 'Cryptara advisory intelligence cannot become execution authority');
requireText(runtime, 'executionAuthorityGranted: false', 'canonical runtime wiring itself cannot grant execution authority');

console.log('[competition-evidence-wiring] PASS — CEX assessment is bootstrap-aware before topology correction, competition/mempool evidence is topology-aware, first-trade history is non-blocking, missing evidence is never fabricated, and execution authority remains singular');
