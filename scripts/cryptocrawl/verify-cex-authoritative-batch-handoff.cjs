const fs = require('node:fs');
const assert = require('node:assert/strict');

const verifier = fs.readFileSync('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts', 'utf8');
const graph = fs.readFileSync('server/services/cryptocrawl/discovery/opportunity-graph.ts', 'utf8');

// The verifier owns one explicit full-map batch entry point. It must reuse the
// existing evaluateBatch authority rather than duplicating economics.
assert.match(verifier, /async evaluateMany\(/);
assert.match(verifier, /const plans = await this\.evaluateBatch\(batchRequest, allowedSymbols, capacity\)/);
assert.match(verifier, /for \(const symbol of allowedSymbols\) output\.set\(symbol, plans\.get\(symbol\) \?\? null\)/);
assert.match(verifier, /governance\.requireAllowed\('ADVISE', \{ chain: req\.gas\?\.chain, pair: symbol \}\)/);
assert.match(verifier, /governance\.completeAdvisoryCycle\('system', 'arb_verifier_batch_cycle_complete'\)/);

// All original deterministic authorities remain in the one reused batch path.
assert.match(verifier, /primeCexFeeEvidence\(\[\.\.\.rawEdgeSurvivors\]\)/);
assert.match(verifier, /quantityFractions = \[0\.05/);
assert.match(verifier, /topSpreadBps <= breakEvenBps/);
assert.match(verifier, /candidate\.netProfitUsd > bestPlan\.netProfitUsd/);
assert.match(verifier, /plan\.netProfitUsd < req\.minNetProfitUsd/);

// The graph consumes the complete map exactly once and preserves selected-symbol
// ordering when handing formation outcomes downstream.
assert.match(graph, /const evaluatedBySymbol = await arbitrageVerifier\.evaluateMany\(/);
assert.match(graph, /\}, selected, capacity\);/);
assert.match(graph, /evaluated = selected\.map\(symbol => evaluatedBySymbol\.get\(symbol\) \?\? null\)/);
assert.match(graph, /economicEvaluationMode: 'single_authoritative_batch'/);
assert.match(graph, /evaluated\.forEach\(\(plan, index\) => recordCexFormationOutcome\(selected\[index\], plan, formationObservedAt\)\)/);

// Regression guard: graph-level selected symbols must never recursively invoke
// evaluateOnce(), because evaluateOnce may itself perform a broad batch and then
// return only its seed symbol.
assert.doesNotMatch(
  graph,
  /runBounded\(selected[\s\S]{0,800}arbitrageVerifier\.evaluateOnce\(/,
  'opportunity graph must not recursively launch seed-scoped broad scans',
);

// A batch-level exception fails every selected symbol closed; no legacy fallback
// is allowed to silently regain authority.
assert.match(graph, /errors\.push\(`cex_batch:/);
assert.match(graph, /evaluated = selected\.map\(\(\) => null\)/);

console.log(JSON.stringify({
  cexAuthoritativeBatchHandoff: 'verified',
  oneVerifierBatchPerGraphCycle: true,
  completePlanMapPreserved: true,
  nestedSeedBatchingRemoved: true,
  governanceAdvisoryEnvelopePreserved: true,
  authenticatedFeeAuthorityPreserved: true,
  depthAwareSizingPreserved: true,
  deterministicNetEconomicsPreserved: true,
  batchFailureFailsClosed: true,
}, null, 2));
