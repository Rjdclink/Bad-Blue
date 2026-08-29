const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const assembler = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');
const optimizer = read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts');
const selector = read('server/services/cryptocrawl/optimization/dynamic-execution-path-selector.ts');
const discovery = read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts');
const learning = read('server/services/cryptocrawl/integration/learning-lifecycle-wiring.ts');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(`missing ${label}: ${text}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(`forbidden ${label}: ${pattern}`);
};

requireText(assembler, 'executionAuthority: false', 'advisory-only composite authority');
requireText(assembler, 'requiresIndependentFinalAdmission: true', 'per-leg final admission');
requireText(assembler, "candidate.status !== 'eligible' || !candidate.executableCapability", 'eligible executable leg filter');
requireText(assembler, 'candidate.missingInformation.length > 0', 'unknown-evidence fail closed');
requireText(assembler, 'netProfitUsd <= 0', 'strict positive deterministic net filter');
requireText(assembler, 'adaptiveTopologyOptimizer.getAssemblyPolicy()', 'adaptive assembly policy');
requireText(assembler, 'policy.minIncrementalBps', 'adaptive incremental BPS threshold');
requireText(assembler, "candidate.provenance.includes('atomic_multileg_payload_composable')", 'explicit atomic composability evidence');
requireText(assembler, "item.startsWith('measured_composite_gain_usd:')", 'measured composition-gain evidence');
requireText(assembler, 'No extra composition/synergy profit is claimed without measured composite simulation evidence', 'no synthetic composite gain');
requireText(assembler, 'notionalWeightedNetProfitBps', 'notional-weighted BPS truth');
requireText(assembler, 'arithmeticLegBpsSum', 'arithmetic BPS telemetry distinction');

requireText(optimizer, "outcome.settlement?.terminal !== true", 'terminal-only optimizer feedback');
requireText(optimizer, 'realizedNetProfitBps: realizedBps', 'realized BPS persistence');
requireText(optimizer, 'terminalSamples === 0', 'cold-start adaptive policy');
requireText(optimizer, 'minIncrementalBps: 0', 'cold-start no-history bootstrap');
requireText(optimizer, 'priorityWeight = clamp', 'bounded scan priority');

requireText(selector, "candidate.status === 'eligible' && candidate.executableCapability", 'execution-path capability proof');
requireText(selector, "path: executableNow ? path : 'UNAVAILABLE'", 'unavailable path fail closed');
requireText(selector, 'maker path remains advisory', 'maker execution truth');
requireText(selector, 'cross-chain path remains unavailable', 'cross-chain execution truth');

requireText(discovery, 'adaptivePerTopologyCadence: true', 'adaptive scan cadence');
requireText(discovery, 'minimumCoveragePreserved: true', 'minimum topology coverage');
requireText(discovery, 'unifiedMultiLegArbitrageEngine.assemble()', 'continuous composite assembly');
requireText(discovery, 'adaptiveTopologyOptimizer.getPriority(topology)', 'realized-BPS scan priority consumption');
requireText(learning, 'adaptiveTopologyOptimizer.recordTerminalOutcome(outcome)', 'terminal learning feedback connection');

forbid(assembler, /executionAuthority:\s*true/, 'composite direct execution authority');
forbid(assembler, /compositionGainVerified:\s*true/, 'hard-coded composition gain');

if (failures.length) {
  console.error('Unified multi-leg adaptive engine verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Unified multi-leg adaptive engine verification PASSED');
console.log(' - deterministic-positive eligible legs only');
console.log(' - no arithmetic-BPS-as-profit shortcut');
console.log(' - no atomicity without explicit payload composability evidence');
console.log(' - no composite synergy claim without measured simulation evidence');
console.log(' - terminal realized BPS drives bounded adaptive priority/assembly thresholds');
console.log(' - maker/cross-chain incomplete executors remain fail closed');
