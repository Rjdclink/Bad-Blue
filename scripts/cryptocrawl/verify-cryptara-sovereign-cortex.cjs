const fs = require('fs');
const path = require('path');

const root = process.cwd();
const cortexPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-sovereign-cortex-wiring.ts');
const prefetchPath = path.join(root, 'server/services/cryptocrawl/integration/cryptara-predictive-prefetch-wiring.ts');
const runtimePath = path.join(root, 'server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

for (const file of [cortexPath, prefetchPath, runtimePath]) {
  if (!fs.existsSync(file)) throw new Error(`[cryptara-sovereign-cortex] missing ${path.relative(root, file)}`);
}

const cortex = fs.readFileSync(cortexPath, 'utf8');
const prefetch = fs.readFileSync(prefetchPath, 'utf8');
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
  "feedback.settlementConfirmed !== true",
  "providerState === 'stale' || providerState === 'missing'",
  "providerState === 'single_source_fresh'",
  "assessment.monteCarlo?.confidence ?? 0) < 0.80",
  'MIN_PROMOTION_SAMPLES',
  "requestPriority: 'critical' | 'high' | 'normal' | 'low'",
  'executionAuthority: false',
  'syntheticEvidenceAllowed: false',
];
for (const token of requiredCortex) {
  if (!cortex.includes(token)) throw new Error(`[cryptara-sovereign-cortex] missing cortex invariant: ${token}`);
}

const requiredPrefetch = [
  "assessment.netProfitUsd === null || !(assessment.netProfitUsd > 0)",
  "assessment.recommendation === 'reject'",
  'marketDataProviders.discoverUniverse()',
  'inFlight.has(normalized)',
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

console.log('[cryptara-sovereign-cortex] PASS: measured evidence quality, eight-dimensional capability evolution, terminal-only adaptation, and bounded Coinbase/Kraken/OKX predictive prefetch invariants preserved');
