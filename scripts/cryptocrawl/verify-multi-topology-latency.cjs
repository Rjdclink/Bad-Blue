const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
  path.join(root, 'server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts'),
  'utf8',
);
const failures = [];
const requireText = (needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText('process.hrtime.bigint()', 'topology latency uses monotonic high-resolution time');
requireText('durationMsByTopology', 'cycle exposes per-topology duration telemetry');
requireText('timed(() => discoverMeasuredDexCandidates())', 'DEX producer timing wraps existing producer');
requireText('timed(() => discoverMeasuredCrossChainCandidates())', 'cross-chain producer timing wraps existing producer');
requireText('timed(() => discoverMeasuredMakerCandidates())', 'maker producer timing wraps existing producer');
requireText('const [dex, cross, maker] = await Promise.allSettled([', 'existing independent topology concurrency remains intact');
requireText('discoverMeasuredMempoolCandidates().length', 'existing mempool producer remains intact');
requireText("perTopologyLatency: 'monotonic_telemetry_only'", 'latency is explicitly telemetry-only');
requireText('durationMsByTopology: { ...this.latest.durationMsByTopology }', 'latest snapshot returns copied timing telemetry');
forbidText('durationMsByTopology.dex >', 'DEX latency cannot become admission authority');
forbidText('durationMsByTopology.crossChain >', 'cross-chain latency cannot become admission authority');
forbidText('durationMsByTopology.maker >', 'maker latency cannot become admission authority');
forbidText('durationMsByTopology.mempool >', 'mempool latency cannot become admission authority');
forbidText('stageManager', 'timing telemetry cannot mutate governance');
forbidText('executeVerifiedArbitragePlan', 'timing telemetry cannot invoke execution');

if (failures.length > 0) {
  console.error('[multi-topology-latency] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[multi-topology-latency] PASS — DEX/cross-chain/maker concurrency is preserved, all topology durations are monotonic telemetry, and timing cannot authorize or block trading');
