const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = message => {
  console.error(`[profit-blocker-wiring] FAIL: ${message}`);
  process.exit(1);
};
const requireText = (source, text, message) => {
  if (!source.includes(text)) fail(message);
};
const forbidText = (source, text, message) => {
  if (source.includes(text)) fail(message);
};

const barrierPolicy = read('server/services/cryptocrawl/discovery/cex-economic-barrier-policy.ts');
const barrier = read('server/services/cryptocrawl/discovery/cex-economic-barrier.ts');
const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const scan = read('server/services/cryptocrawl/discovery/scan-capacity-policy.ts');
const readiness = read('server/services/cryptocrawl/runtime/readiness-policy.ts');
const runtime = read('server/services/cryptocrawl/integration/runtime-observability.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const learning = read('server/services/cryptocrawl/evolution/measured-execution-feedback.ts');
const env = read('server/services/cryptocrawl/runtime/environment-contract.ts');
const cryptaraWiring = read('server/services/cryptocrawl/integration/cryptara-assessment-wiring.ts');
const cexEvidenceWiring = read('server/services/cryptocrawl/integration/cryptara-cex-evidence-wiring.ts');

requireText(barrierPolicy, "executionFeeMode: 'taker_ioc'", 'CEX economic barrier must identify the actual IOC/taker execution mode');
requireText(barrierPolicy, 'feeReductionNeededBps', 'CEX economic barrier must expose the measured fee reduction needed to reach fee-only break-even');
requireText(barrierPolicy, 'maxCombinedTakerFeeForFeeOnlyBreakEvenBps', 'CEX economic barrier must expose the fee-only ceiling without pretending other costs disappear');
requireText(barrierPolicy, 'makerObservation', 'maker economics must remain separately observed');
requireText(barrierPolicy, 'executable: false', 'maker observation must not be promoted to executable evidence');
requireText(barrier, 'computeCexEconomicBarrier({', 'live fee barrier adapter must delegate arithmetic to the pure policy');
requireText(barrier, 'getCachedCexFeeEvidence', 'maker observation must come from cached authenticated fee evidence');
requireText(graph, 'recordCexEconomicBarrier(', 'measured CEX scan must record the authenticated economic barrier');
requireText(graph, 'arbitrageVerifier.getBestCrossVenueFeeContext(selected)', 'economic barrier must derive from the verifier fee/spread authority');

requireText(scan, "feeBarrier?.status === 'fee_blocked'", 'scan policy must understand a measured fee-blocked market');
requireText(scan, 'desired = configuredBase', 'fee-blocked market must retain bounded base discovery instead of maximum waste');
requireText(scan, 'maximize bounded discovery breadth while verified-positive density is zero and no sufficiently covered fee barrier has been established', 'scanner must still expand before a fee barrier is sufficiently established');
requireText(scan, 'recommendedIntervalMs', 'scanner must adapt cadence without stopping discovery');
forbidText(scan, 'desired = 0', 'fee barrier must never stop discovery entirely');

requireText(readiness, 'eligibleCexCandidates', 'strict readiness must distinguish eligible CEX candidates');
requireText(readiness, 'eligibleZeroCapitalCandidates', 'strict readiness must distinguish zero-capital candidates');
requireText(readiness, 'const cexResourceReady = inventoryReady', 'CEX readiness must require reconciled CEX inventory');
requireText(readiness, 'Zero-capital resources never substitute for CEX inventory', 'zero-capital resources must never satisfy CEX inventory readiness');
requireText(readiness, 'ready: input.coreMarketDataReady', 'optional blockchain RPC degradation must not globally block core CEX data readiness');

requireText(scheduler, 'lastIdleReason', 'zero-attempt scheduler state must expose its cause');
requireText(scheduler, "'no_eligible_candidates'", 'scheduler must distinguish no eligible candidates');
requireText(scheduler, "'no_resource_qualified_candidates'", 'scheduler must distinguish resource qualification failure');
requireText(scheduler, "'governance_stage_blocked'", 'scheduler must distinguish governance blocking');
requireText(scheduler, "'live_execution_posture_disabled'", 'scheduler must distinguish disabled live posture');

requireText(learning, "'bootstrap_no_terminal_samples'", 'zero-sample learning must be labeled bootstrap, not calibrated');
requireText(learning, 'terminalEvidenceRequired: true', 'learning must attest terminal evidence requirement');
requireText(learning, 'syntheticSamplesAllowed: false', 'learning must never invent samples');
requireText(learning, 'feedback.settlement.terminal !== true', 'learning must remain terminal-settlement gated');

for (const alias of [
  'COINSTATS_API_KEY_PROD',
  'COINSTATS_API_KEY_PRODUCTION',
  'COINSTATS_PRODUCTION_API_KEY',
  'COINSTATS_API_KEY_RAILWAY',
  'COIN_STATS_API_KEY',
  'COINSTAT_API_KEY',
  'COINSTATS_API_TOKEN',
  'COIN_STATS_API_TOKEN',
  'COINSTATS_TOKEN',
]) {
  requireText(env, `'${alias}'`, `CoinStats environment contract is missing supported alias ${alias}`);
}
requireText(runtime, 'coinStatsRequiredForCoreCexAdvancement: false', 'runtime must state that optional CoinStats enrichment is not a core CEX advancement requirement');
requireText(cryptaraWiring, "item.startsWith('provider_coinstats_')", 'CoinStats provider degradation must remain optional in Cryptara assessment completeness');
requireText(cexEvidenceWiring, "'not_applicable:mempool_evidence'", 'CEX Cryptara assessment must not be penalized for topology-inapplicable mempool evidence');

requireText(runtime, 'authenticatedCexFeeBarrier: economicBarrier', 'heartbeat must expose authenticated fee barrier cause');
requireText(runtime, 'stageOneBlockedByFeeEconomics', 'heartbeat must distinguish Stage 1 economic blocking');
requireText(runtime, 'eligibleCexCandidates: candidateMetrics.byTopology.CEX_CEX.eligible', 'heartbeat must bind readiness to CEX candidate topology');
requireText(runtime, 'eligibleZeroCapitalCandidates: candidateMetrics.byTopology.ZERO_CAPITAL_ATOMIC.eligible', 'heartbeat must report zero-capital candidates separately');

console.log('[profit-blocker-wiring] PASS — fee economics, CoinStats, Stage 1 causality, scheduler idle truth, topology resources, adaptive search, and learning bootstrap semantics are wired without weakening execution gates');
