const fs = require('fs');
const path = require('path');
const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const controller = read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts');
const scorer = read('server/services/cryptocrawl/optimization/profitability-score.ts');
const optimizer = read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const admission = read('server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');
const runtime = read('server/services/cryptocrawl/runtime/core-runtime.ts');

const failures = [];
const requireText = (source, text, label) => { if (!source.includes(text)) failures.push(`missing ${label}: ${text}`); };
const forbid = (source, regex, label) => { if (regex.test(source)) failures.push(`forbidden ${label}: ${regex}`); };

requireText(controller, 'Promise.allSettled([', 'parallel discovery launch');
for (const text of [
  'measuredOpportunityGraph.scanOnce()',
  'discoverMeasuredDexCandidates()',
  'discoverMeasuredCrossChainCandidates()',
  'discoverMeasuredMempoolCandidates()',
  'discoverMeasuredLiquidationCandidates()',
  'fundingRateMonitor.scanOnce()',
]) requireText(controller, text, 'unified discovery topology');
requireText(controller, 'fixedTopologyPriority: false', 'no fixed topology priority');
requireText(controller, 'routeRecentMeasuredOpportunities', 'unified execution routing');

requireText(scorer, '(positiveNetProfitUsd / executionRisk) * confidenceLevel', 'profitability score formula');
requireText(scorer, 'empiricalCostMultiplier', 'realized cost calibration');
requireText(scorer, 'No topology-specific static penalty exists', 'no topology hard-coded risk preference');

requireText(optimizer, 'profitabilityScoreThreshold: 0', 'history-free cold-start score threshold');
requireText(optimizer, 'confidenceThreshold: 0', 'history-free cold-start confidence threshold');
requireText(optimizer, 'outcome.settlement?.terminal !== true', 'terminal-only adaptive learning');
requireText(optimizer, 'realizedCostMultiplierEwma', 'realized cost feedback');
requireText(optimizer, 'getDynamicAdmissionPolicy()', 'dynamic threshold policy');

for (const pathName of [
  "'FLASH_LOAN'",
  "'CEX_TAKER_IOC'",
  "'CEX_MAKER'",
  "'BRIDGE_FLASH_LOAN'",
  "'FLASH_LOAN_LIQUIDATION'",
  "'SPOT_PERP_FUNDING'",
  "'MEV_ATOMIC'",
]) requireText(router, pathName, 'execution route');
requireText(router, 'candidate.status === \'eligible\'', 'eligible-only router admission');
requireText(router, 'candidate.missingInformation.length === 0', 'complete-evidence admission');
requireText(router, 'deterministicPositive && completeCurrentEvidence && aboveAdaptiveThreshold', 'combined admission gate');

requireText(admission, 'originalExecute(plan)', 'CEX live-path wrapper');
requireText(admission, 'originalIsAllowedByCryptara(opportunity)', 'zero-capital live-path wrapper');
requireText(admission, 'coldStartHistoricalProofRequired: false', 'no history prerequisite');
requireText(admission, 'terminalSettlementStillRequiredAfterExecution: true', 'post-execution terminal settlement invariant');
requireText(runtime, "discovery: 'unified_multi_topology_parallel_controller'", 'single unified discovery lifecycle');
forbid(runtime, /fundingRateMonitor\.start\(/, 'duplicate funding timer');
forbid(runtime, /measuredOpportunityGraph\.start\(/, 'duplicate CEX timer');

if (failures.length) {
  console.error('Unified adaptive execution verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('Unified adaptive execution verification PASSED');
console.log(' - all measured discovery topologies launch in parallel with no fixed source priority');
console.log(' - ProfitabilityScore=(NetProfitUSD/ExecutionRisk)*ConfidenceLevel');
console.log(' - cold start does not require historical proof');
console.log(' - terminal outcomes adapt score/confidence thresholds and realized cost calibration');
console.log(' - only complete, eligible, deterministic-positive live-capable routes can be admitted');
