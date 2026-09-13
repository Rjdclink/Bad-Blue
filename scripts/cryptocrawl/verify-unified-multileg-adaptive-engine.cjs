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
  compositeSelection: read('server/services/cryptocrawl/execution/zero-capital-composite-selection-registry.ts'),
};

const failures = [];
const requireText = (key, text, label) => {
  if (!source[key].includes(text)) failures.push(`missing ${label}: ${text}`);
};
const forbid = (key, pattern, label) => {
  if (pattern.test(source[key])) failures.push(`forbidden ${label}: ${pattern}`);
};

// The generic composite assembler remains advisory and operates on already-positive
// executable legs. The dedicated zero-capital Atomic BPS composer is the only place
// where fresh near-misses may be transformed before canonical admission.
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

requireText('optimizer', 'profitabilityScoreThreshold: 0', 'history-free cold-start score threshold');
requireText('optimizer', 'confidenceThreshold: 0', 'history-free cold-start confidence threshold');
requireText('optimizer', "outcome.settlement?.terminal !== true", 'terminal-only optimizer learning');
requireText('scorer', 'No topology-specific static penalty exists', 'no static topology penalty');
requireText('riskGovernor', 'Monte Carlo is advisory', 'Monte Carlo advisory authority');
requireText('riskGovernor', 'monteCarloCheck: true', 'Monte Carlo cannot fail canonical risk approval');
requireText('riskGovernor', 'duplicateRiskScoreVetoAuthority: false', 'aggregate risk score cannot regain veto authority');

// Atomic BPS composition may inspect fresh near-misses down to the configured -10 BPS
// entry floor, but promotion requires measured provider fee/liquidity, exact eth_call
// plus gas measurement, positive composition gain, and strictly positive exact all-in
// base-unit profit. There is no arbitrary +10 BPS post-Stage-1 target.
requireText('stack', 'getCompatibleForAtomicSurplus', 'near-miss measurement view');
requireText('stack', 'ZERO_CAPITAL_ATOMIC_SURPLUS_ENTRY_FLOOR_BPS', 'atomic surplus entry floor');
requireText('stack', 'const STRICT_POSITIVE_PROFIT_BASE_UNITS = 1n;', 'strict-positive base-unit floor');
requireText('stack', 'const targetNetProfitBaseUnits = STRICT_POSITIVE_PROFIT_BASE_UNITS;', 'compatibility target resolves to strict positivity');
forbid('stack', /ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS/, 'retired atomic +10 target variable');
forbid('stack', /atomicSurplusTargetBps/, 'retired atomic +10 target helper');
requireText('stack', 'measureBalancerFlashLoanEconomics', 'measured composite provider economics');
requireText('stack', 'calculateMeasuredFlashLoanFee', 'measured shared-principal flash fee');
requireText('stack', 'input.provider.call', 'exact strict-positive composite call');
requireText('stack', 'input.provider.estimateGas', 'exact composite gas measurement');
requireText('stack', 'measuredCompositionGain <= 0n', 'composition gain must be measured positive');
requireText('stack', 'combinedExpectedProfit < targetNetProfitBaseUnits', 'strict-positive net floor must be cleared');
requireText('stack', 'estimatedGas > allowedGas', 'bounded block-gas feasibility');
requireText('stack', 'zeroCapitalCompositeSelectionRegistry.record(selection)', 'prepared selection registration');
requireText('stack', 'netDollarOptimizationAfterProfitability: true', 'net-dollar optimization after profitability');
requireText('stack', 'exactStrictPositiveSimulationPassed: true', 'exact strict-positive simulation proof');
requireText('stack', 'borrowingNotionalAuthority: false', 'Profit Ladder cannot cap atomic principal');
requireText('compositeRegistry', 'targetNetProfitBaseUnits', 'exact base-unit compatibility binding retained in evidence');
requireText('compositeRegistry', 'combinedExpectedProfit < input.targetNetProfitBaseUnits', 'evidence rejects nonpositive compatibility result');
requireText('compositeSelection', 'expectedNetProfit < selection.targetNetProfitBaseUnits', 'prepared selection rejects nonpositive compatibility result');

requireText('admission', 'missing_hard_execution_evidence', 'active evidence reacquisition trigger');
requireText('admission', 'hotPathExecutionAuthority: false', 'evidence scanner cannot execute independently');

if (failures.length > 0) {
  console.error('[unified-multileg-adaptive-engine] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[unified-multileg-adaptive-engine] PASS: ordinary composite admission remains deterministic-positive; zero-capital near-misses may be transformed only by exact strictly-positive shared-principal evidence before canonical execution, with no arbitrary +10 BPS finish line.');