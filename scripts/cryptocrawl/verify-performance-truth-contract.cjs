const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (source, needle, label) => { if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

const contract = read('server/services/cryptocrawl/runtime/performance-truth-contract.ts');
const frontier = read('server/services/cryptocrawl/evolution/frontier-research-integration.ts');
const quarantine = read('server/services/cryptocrawl/integration/legacy-intelligence-quarantine.ts');
const canonicalIndex = read('server/services/cryptocrawl/index.ts');
const evolutionIndex = read('server/services/cryptocrawl/evolution/index.ts');
const latency = read('server/services/cryptocrawl/runtime/end-to-end-latency-harness.ts');

for (const invariant of [
  'guaranteedZeroLatency: false',
  'guaranteedZeroSlippage: false',
  'guaranteedUnlimitedThroughput: false',
  'guaranteedNearZeroFeesOrGas: false',
  'fastestResponseAlwaysWins: false',
  'flashLoansMakeGasFree: false',
  'directResearchMetricTransferAllowed: false',
  'syntheticLatencyMayProveProductionLatency: false',
  'gpuScalingMayProveNodeScaling: false',
  'neuromorphicPercentagesMayProveRuntimePerformance: false',
  'fabricatedFallbackEvidenceAllowed: false',
  'requiresMeasuredPromotionEvidence: true',
]) requireText(contract, invariant, `S-94 truth contract requires ${invariant}`);

for (const objective of [
  'minimize_measured_p99_latency_subject_to_freshness_safety_and_cost',
  'minimize_measured_expected_slippage_and_price_impact_under_bounded_order_semantics',
  'maximize_measured_throughput_within_provider_venue_cpu_memory_and_risk_limits',
  'minimize_measured_all_in_cost_never_nominal_fee_alone',
]) requireText(contract, objective, `S-94 measured objective ${objective}`);

requireText(quarantine, 'evolution/frontier-research-integration.ts (research-only', 'frontier research must be explicitly quarantined');
requireText(frontier, "FRONTIER_RESEARCH_AUTHORITY = 'research_only'", 'frontier research declares research-only authority');
requireText(frontier, 'FRONTIER_RESEARCH_EXECUTION_AUTHORITY = false', 'frontier research cannot execute');
requireText(frontier, 'FRONTIER_RESEARCH_PROFITABILITY_AUTHORITY = false', 'frontier research cannot establish profitability');
forbidText(frontier, 'TARGET: $100,000/day verified profitability', 'fabricated frontier profit target cannot remain');
forbidText(frontier, "implementationStatus: 'production'", 'research analogy cannot be labeled production');
forbidText(frontier, 'profitContribution: 15000', 'fabricated dollar contribution cannot remain');
forbidText(frontier, 'profitContribution: 25000', 'fabricated dollar contribution cannot remain');
requireText(frontier, 'getTotalProfitPotential(): number {\n    return 0;', 'legacy profit-potential API must fail closed to zero');
requireText(frontier, 'getProductionCapabilities(): FrontierCapability[] {\n    return [];', 'research catalog cannot claim production capabilities');

forbidText(canonicalIndex, 'frontierResearch', 'canonical public surface cannot export frontier research');
forbidText(evolutionIndex, 'frontierResearch', 'canonical evolution surface cannot export frontier research');
requireText(latency, 'syntheticBenchmarkAuthority: false', 'production latency proof must exclude synthetic benchmark authority');
requireText(latency, "status: enough ? 'measured_baseline' : 'insufficient_samples'", 'production SLO candidates require measured sample history');

if (failures.length) {
  console.error('[performance-truth-contract] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('[performance-truth-contract] PASS — S-94 production claims are measured, bounded, and research-only metrics are quarantined');
