const fs = require('fs');
const path = require('path');

const root = process.cwd();
const cortexPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-sovereign-cortex-wiring.ts');
const assessmentPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-assessment-wiring.ts');
const prefetchPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-predictive-prefetch-wiring.ts');
const parallelPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-parallel-cognition.ts');
const adaptivePath = path.join(root, 'server/services/cryptocrawl/optimization/cryptara-adaptive-strategy-state.ts');
const priorityPath = path.join(root, 'server/services/cryptocrawl/optimization/cryptara-decision-priority.ts');
const profitOpsPath = path.join(root, 'server/services/cryptocrawl/runtime/adaptive-profit-operations-wiring.ts');
const runtimePath = path.join(root, 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const deadAdvisoryPath = path.join(root, 'server/services/cryptocrawl/optimization/computational-profit-advisory-state.ts');

for (const file of [cortexPath, assessmentPath, prefetchPath, parallelPath, adaptivePath, priorityPath, profitOpsPath, runtimePath]) {
  if (!fs.existsSync(file)) throw new Error(`[cryptara-sovereign-cortex] missing ${path.relative(root, file)}`);
}
if (fs.existsSync(deadAdvisoryPath)) {
  throw new Error('[cryptara-sovereign-cortex] dead duplicate computational profit advisory state must remain removed');
}

const cortex = fs.readFileSync(cortexPath, 'utf8');
const assessment = fs.readFileSync(assessmentPath, 'utf8');
const prefetch = fs.readFileSync(prefetchPath, 'utf8');
const parallel = fs.readFileSync(parallelPath, 'utf8');
const adaptive = fs.readFileSync(adaptivePath, 'utf8');
const priority = fs.readFileSync(priorityPath, 'utf8');
const profitOps = fs.readFileSync(profitOpsPath, 'utf8');
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

const requiredAssessment = [
  'prewarmCryptaraParallelCognition(context);',
  'context.plan.netProfitUsd > 0',
  "recommendation: 'reject'",
  "if (context.plan && recommendation === 'consider' && !frame.marketTruth.ready) recommendation = 'observe';",
  'frame.optimization.boundedTargetNotionalUsd.toFixed(8)',
  'read_only_deadline_bound_nonblocking_same_observation_only',
  'staleEvidenceIsolation: true',
];
for (const token of requiredAssessment) {
  if (!assessment.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing assessment invariant: ${token}`);
}

const requiredAdaptive = [
  'version: 4',
  "export type CryptaraEditableStrategyParameter = 'prefetchAggression'",
  "if (outcome.rank !== 'strategist' && outcome.rank !== 'sovereign') return null",
  'const failed = objectivelyFailed(outcome);',
  'outcome.success !== true || outcome.realizedProfitUsd <= 0',
  'finiteOrDefault(raw.prefetchAggression, DEFAULT_STATE.prefetchAggression)',
  "status: 'probation'",
  'validationSamples < 3',
  'requiredImprovementMargin = 0.01',
  'average >= edit.baselineQualityScore + requiredImprovementMargin && average > 0',
  'if (!improved)',
  "edit.status = 'rolled_back'",
  "edit.status = 'accepted'",
  "sharedEditMinimumRank: 'strategist'",
  'executionStrategyMutation: false',
  'sourceCodeWriteAuthority: false',
  'executionAuthority: false',
  'terminal_confirmed_external_settlement_only',
];
for (const token of requiredAdaptive) {
  if (!adaptive.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing adaptive-edit invariant: ${token}`);
}
for (const forbidden of ['refinementDensity', 'notionalBias', 'evidenceRefreshFactor']) {
  if (adaptive.includes(forbidden)) throw new Error(`[cryptara-sovereign-cortex] inert adaptive knob must remain removed: ${forbidden}`);
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
if (priority.includes('compareCryptaraDecisionVectors')) {
  throw new Error('[cryptara-sovereign-cortex] unused duplicate priority comparator must remain removed');
}

const requiredParallel = [
  "marketTruth: 'cryptara_market_truth_helper'",
  "optimization: 'cryptara_profit_efficiency_helper'",
  'Promise.allSettled([',
  'quantiDeadlineAt: deadlineAt',
  'TaskIntensity.MODERATE',
  'priority: TaskPriority.HIGH',
  'priority: TaskPriority.MEDIUM',
  'helperEventBridgeInstalled',
  'currentQuoteAgeMs(context',
  "plan.liquidity.status === 'measured'",
  '!!plan.feeEvidence?.buy && !!plan.feeEvidence?.sell',
  'context.plan.netProfitUsd <= 0) return',
  'staleFrameSubstitutionAllowed: false',
  'hotPathNetworkRequestsAdded: false',
  'writeAuthority: false',
  'executionAuthority: false',
];
for (const token of requiredParallel) {
  if (!parallel.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing parallel cognition invariant: ${token}`);
}
for (const forbidden of ['TaskPriority.CRITICAL', 'computational-profit-advisory-state', 'CryptaraPriorityDecisionVector']) {
  if (parallel.includes(forbidden)) throw new Error(`[cryptara-sovereign-cortex] parallel cognition cleanup regression: ${forbidden}`);
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

if (profitOps.includes('getCryptaraAdaptiveStrategySnapshot') || profitOps.includes('notionalBias')) {
  throw new Error('[cryptara-sovereign-cortex] profit-ladder sizing must not retain dead Cryptara notional-bias authority');
}
if (!profitOps.includes("discoveryNotionalPolicy: 'stage1_shadow_measurement_ceiling_then_full_current_profit_ladder_ceiling'")) {
  throw new Error('[cryptara-sovereign-cortex] cleaned profit-ladder discovery ceiling invariant missing');
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

console.log('[cryptara-sovereign-cortex] PASS: terminal-only rank evidence, Strategist-minimum proven prefetch edits, ordered market/profit priorities, cleaned parallel cognition, and bounded predictive prefetch invariants preserved');
