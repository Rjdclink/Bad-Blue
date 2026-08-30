const fs = require('fs');
const path = require('path');

const root = process.cwd();
const cortexPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-sovereign-cortex-wiring.ts');
const prefetchPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-predictive-prefetch-wiring.ts');
const parallelPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-parallel-cognition.ts');
const adaptivePath = path.join(root, 'server/services/cryptocrawl/optimization/cryptara-adaptive-strategy-state.ts');
const priorityPath = path.join(root, 'server/services/cryptocrawl/optimization/cryptara-decision-priority.ts');
const runtimePath = path.join(root, 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

for (const file of [cortexPath, prefetchPath, parallelPath, adaptivePath, priorityPath, runtimePath]) {
  if (!fs.existsSync(file)) throw new Error(`[cryptara-sovereign-cortex] missing ${path.relative(root, file)}`);
}

const cortex = fs.readFileSync(cortexPath, 'utf8');
const prefetch = fs.readFileSync(prefetchPath, 'utf8');
const parallel = fs.readFileSync(parallelPath, 'utf8');
const adaptive = fs.readFileSync(adaptivePath, 'utf8');
const priority = fs.readFileSync(priorityPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');

const requiredCortex = [
  'alphaGeneration',
  'executionPrecision',
  'patternRecognition',
  'riskControl',
  'strategicDepth',
  'adaptationSpeed',
  'systemEfficiency',
  'sovereignty',
  'feedback.settlementConfirmed === true',
  'feedback.settlement?.terminal === true',
  'feedback.settlement.settlementConfirmed === true',
  'terminal_confirmed_external_settlement_only',
  'terminalRankScore()',
  'rankFromTerminal(rankScore, stats.samples)',
  "providerState === 'stale' || providerState === 'missing'",
  "providerState === 'single_source_fresh'",
  "assessment.monteCarlo?.confidence ?? 0) < 0.80",
  'MIN_PROMOTION_SAMPLES',
  "requestPriority: 'critical' | 'high' | 'normal' | 'low'",
  'simulationsCanRaiseRank: false',
  'shadowTradesCanRaiseRank: false',
  'strategyProjectionCanRaiseRank: false',
  'executionAuthority: false',
  'syntheticEvidenceAllowed: false',
];
for (const token of requiredCortex) {
  if (!cortex.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing cortex invariant: ${token}`);
}

const requiredAdaptive = [
  "if (outcome.rank === 'observer') return null",
  "if (objectivelyFailed(outcome)) return failureRepair(outcome)",
  "outcome.rank !== 'strategist' && outcome.rank !== 'sovereign'",
  "outcome.success !== true || outcome.realizedProfitUsd <= 0",
  "status: 'probation'",
  'validationSamples < 3',
  "edit.status = 'rolled_back'",
  "edit.status = 'accepted'",
  'sourceCodeWriteAuthority: false',
  'executionAuthority: false',
  'terminal_confirmed_external_settlement_only',
];
for (const token of requiredAdaptive) {
  if (!adaptive.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing adaptive-edit invariant: ${token}`);
}

const requiredPriorityOrder = [
  "id: 'market_truth'",
  "id: 'profitability_bps'",
  "id: 'latency_slippage'",
  "id: 'notional'",
  "id: 'exploration'",
];
let previousIndex = -1;
for (const token of requiredPriorityOrder) {
  const index = priority.indexOf(token);
  if (index < 0) throw new Error(`[cryptara-sovereign-cortex] missing priority invariant: ${token}`);
  if (index <= previousIndex) throw new Error(`[cryptara-sovereign-cortex] priority order regression at: ${token}`);
  previousIndex = index;
}
if (!priority.includes('Lexicographic priority comparison')) {
  throw new Error('[cryptara-sovereign-cortex] lower-priority gains must not override market truth/profitability');
}

const requiredParallel = [
  "marketTruth: 'cryptara_market_truth_helper'",
  "optimization: 'cryptara_profit_efficiency_helper'",
  'Promise.allSettled([',
  'quantiDeadlineAt: deadlineAt',
  'hotPathNetworkRequestsAdded: false',
  'writeAuthority: false',
  'executionAuthority: false',
  "plan?.liquidity.status === 'measured'",
  '!!plan?.feeEvidence?.buy && !!plan?.feeEvidence?.sell',
];
for (const token of requiredParallel) {
  if (!parallel.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing parallel cognition invariant: ${token}`);
}

const requiredPrefetch = [
  "assessment.netProfitUsd === null || !(assessment.netProfitUsd > 0)",
  "assessment.recommendation === 'reject'",
  'marketDataProviders.discoverUniverse()',
  'inFlight.has(normalized)',
  'boundedAdaptiveLearningAware: true',
  'backgroundIntervalCreated: false',
  'executionAuthority: false',
];
for (const token of requiredPrefetch) {
  if (!prefetch.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing prefetch invariant: ${token}`);
}

const rankedImplementedCex = prefetch.includes("const fallback: CexStreamVenue[] = ['coinbase', 'kraken', 'okx']")
  && prefetch.includes("bid.venue === 'coinbase' || bid.venue === 'kraken' || bid.venue === 'okx'")
  && prefetch.includes('cexOrderBookStreams.getQuote(venue');
if (!rankedImplementedCex) {
  throw new Error('[cryptara-sovereign-cortex] missing bounded Coinbase/Kraken/OKX predictive-prefetch invariant');
}

if (!runtime.includes('ensureCryptaraSovereignCortexWiring();')) throw new Error('[cryptara-sovereign-cortex] canonical cortex wiring missing');
if (!runtime.includes('ensureCryptaraPredictivePrefetchWiring();')) throw new Error('[cryptara-sovereign-cortex] canonical predictive prefetch wiring missing');
if (!runtime.includes('cryptaraCortexExecutionAuthority: false')) throw new Error('[cryptara-sovereign-cortex] runtime execution-authority boundary missing');

console.log('[cryptara-sovereign-cortex] PASS: terminal-only rank evidence, rank-gated micro-edits, lexicographic market/profit priority, parallel read-only cognition, and bounded predictive prefetch invariants preserved');
