'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const source = {
  assembler: read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts'),
  optimizer: read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts'),
  scorer: read('server/services/cryptocrawl/optimization/profitability-score.ts'),
  router: read('server/services/cryptocrawl/execution/unified-execution-router.ts'),
  compatibility: read('server/services/cryptocrawl/optimization/dynamic-execution-path-selector.ts'),
  admission: read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts'),
  riskGovernor: read('server/services/cryptocrawl/governance/risk-governor.ts'),
  stack: read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts'),
  compositeRegistry: read('server/services/cryptocrawl/optimization/zero-capital-composite-evidence-registry.ts'),
};

const failures = [];
const requireText = (key, text, label) => {
  if (!source[key].includes(text)) failures.push(`missing ${label}: ${text}`);
};
const forbid = (key, pattern, label) => {
  if (pattern.test(source[key])) failures.push(`forbidden ${label}: ${pattern}`);
};

// The composite engine is advisory assembly only. Every selected leg must already
// have current canonical execution capability and strictly positive deterministic
// economics; ranking/learning thresholds cannot recreate an execution floor.
requireText('assembler', 'executionAuthority: false', 'advisory-only composite authority');
requireText('assembler', 'requiresIndependentFinalAdmission: true', 'independent final admission');
requireText('assembler', "candidate.status !== 'eligible' || !candidate.executableCapability", 'eligible executable leg requirement');
requireText('assembler', 'netProfitUsd <= 0', 'strict positive deterministic net requirement');
requireText('assembler', "candidate.depth.status === 'unavailable'", 'hard executable-depth requirement');
requireText('assembler', 'zeroCapitalCompositeEvidenceRegistry.get(selectedIds)', 'selected-set composite evidence lookup');
requireText('assembler', 'sharedPrincipalStackedBps', 'shared-principal BPS telemetry');
requireText('assembler', 'notionalWeightedNetProfitBps', 'notional-weighted BPS truth');
requireText('assembler', 'arithmeticLegBpsSum', 'arithmetic BPS telemetry');
forbid('assembler', /candidate\.missingInformation\.length\s*>\s*0/, 'generic missing-information execution veto');
forbid('assembler', /netProfitBps\s*<\s*minIncrementalBps/, 'adaptive minimum-BPS execution veto');

// Unified router owns path admission. Adaptive profitability/confidence scores and
// generic missing-information lists are evidence/ranking signals, while current
// path capability, freshness, depth and verified positive economics remain hard.
requireText('router', 'export interface AdvisoryEvidenceScores', 'advisory evidence surface');
requireText('router', 'advisoryOnly: true', 'advisory evidence marker');
requireText('router', 'const deterministicPositive = Number.isFinite(deterministicNet) && deterministicNet > 0;', 'strict deterministic-positive authority');
requireText('router', 'predictionEventAuthority(candidate)', 'prediction-event canonical authority');
requireText('router', 'const hardVetoReasons: string[] = [];', 'explicit hard-veto channel');
requireText('router', 'advisory:adaptive_profitability_or_confidence_below_ranking_threshold', 'adaptive threshold advisory marker');
requireText('router', 'candidate.missingInformation.length > 0', 'missing information still triggers reacquisition');
requireText('router', 'hardVetoReasons.length === 0', 'hard-veto-free admission requirement');
requireText('compatibility', 'routeMeasuredOpportunity(candidate)', 'compatibility selector delegates to unified router');
requireText('compatibility', 'scoring_authority=UnifiedExecutionRouter:ProfitabilityScore', 'single scoring authority');

// Learning can tune search/ranking, never the current hard-fact execution result.
requireText('optimizer', 'profitabilityScoreThreshold: 0', 'history-free cold-start score threshold');
requireText('optimizer', 'confidenceThreshold: 0', 'history-free cold-start confidence threshold');
requireText('optimizer', "outcome.settlement?.terminal !== true", 'terminal-only optimizer learning');
requireText('scorer', 'No topology-specific static penalty exists', 'no static topology penalty');
requireText('riskGovernor', 'Monte Carlo is advisory', 'Monte Carlo advisory authority');
requireText('riskGovernor', 'monteCarloCheck: true', 'Monte Carlo cannot fail canonical risk approval');
requireText('riskGovernor', 'duplicateRiskScoreVetoAuthority: false', 'aggregate risk score cannot regain veto authority');

// Composite eth_call remains useful telemetry. Exact gas, bounded block capacity,
// measured composition gain and positive individual legs remain the hard facts.
requireText('stack', 'input.provider.estimateGas', 'exact composite gas measurement');
requireText('stack', 'simulationVetoAuthority: false', 'composite simulation advisory marker');
requireText('stack', 'measuredCompositionGain <= 0n', 'composition gain must be measured positive');
requireText('stack', 'estimatedGas > allowedGas', 'bounded block-gas feasibility');
requireText('compositeRegistry', 'simulationAdvisoryError', 'simulation telemetry is retained');

// Missing hard evidence must trigger active acquisition rather than permanent
// rejection, while the hot execution path stays under the unified authority.
requireText('admission', 'missing_hard_execution_evidence', 'active evidence reacquisition trigger');
requireText('admission', 'hotPathExecutionAuthority: false', 'evidence scanner cannot execute independently');

if (failures.length > 0) {
  console.error('[unified-multileg-adaptive-engine] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[unified-multileg-adaptive-engine] PASS: current hard-fact profitability/capability/freshness/depth authority preserved; adaptive scores, missing-information ranking and simulations remain advisory.');
