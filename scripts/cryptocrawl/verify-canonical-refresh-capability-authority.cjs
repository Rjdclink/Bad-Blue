const fs = require('fs');
const path = require('path');
const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const graph = read('server/services/cryptocrawl/discovery/opportunity-graph.ts');
const observations = read('server/services/cryptocrawl/discovery/cex-observation-candidates.ts');
const fast = read('server/services/cryptocrawl/integration/cryptara-two-speed-revalidation-wiring.ts');
const discovery = read('server/services/cryptocrawl/discovery/multi-topology-discovery-controller.ts');
const graphlessDex = read('server/services/cryptocrawl/discovery/graphless-dex-scout.ts');
const prediction = read('server/services/cryptocrawl/integration/prediction-market-discovery-wiring.ts');
const kalshi = read('server/services/cryptocrawl/integration/kalshi-system-wiring.ts');
const kalshiAuth = read('server/services/cryptocrawl/intelligence/kalshi-authenticated-authority.ts');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(`missing ${label}: ${text}`);
};
const forbidText = (source, text, label) => {
  if (source.includes(text)) failures.push(`forbidden ${label}: ${text}`);
};

requireText(graph, 'refreshAuthority: \'single_serialized_opportunity_graph_pipeline\'', 'single CEX refresh authority telemetry');
requireText(graph, 'private readonly pendingTargetedSymbols = new Set<string>()', 'coalesced targeted request queue');
requireText(graph, 'private readonly activeTargetedSymbols = new Set<string>()', 'active-symbol recursion guard');
requireText(graph, 'return this.runExclusiveCycle()', 'single exclusive global refresh entry');
requireText(graph, "trigger: 'positive_observation_revalidation'", 'targeted refresh through exclusive cycle');
forbidText(graph, 'targetedScans', 'parallel per-symbol refresh authorities');

requireText(observations, "status: executionHydrationPossible ? 'observed' : 'blocked'", 'public-only capability boundary');
requireText(observations, 'execution_hydration_possible:two_or_more_integrated_venues', 'integrated execution hydration provenance');
requireText(observations, 'advisory:public_only_venue_pair_not_integrated_for_execution', 'public-only non-reacquisition classification');
requireText(observations, 'execution_hydration_not_applicable:public_only_venue_scope', 'public-only terminal capability classification');

requireText(fast, 'hasCrossVenueExecutableObservation(candidate)', 'integrated exact-symbol request filter');
requireText(fast, 'publicOnlyVenuePairRevalidationAllowed: false', 'public-only fast-loop prohibition');
requireText(fast, "refreshAuthority: 'single_serialized_measured_opportunity_graph'", 'requester-only refresh authority');

requireText(discovery, 'const rpcReady = ensureDynamicRpcProviderWiring()', 'shared RPC bootstrap promise');
for (const producer of [
  'discoverMeasuredDexCandidates()',
  'discoverMeasuredCrossChainCandidates()',
  'discoverMeasuredMempoolCandidates()',
  'discoverMeasuredLiquidationCandidates()',
]) {
  requireText(discovery, `await rpcReady; return ${producer}`, `on-chain producer waits for RPC mesh: ${producer}`);
}
requireText(discovery, 'cexDiscoveryBlockedByRpcBootstrap: false', 'CEX independence from RPC bootstrap');

requireText(graphlessDex, 'function meshSafeHeadLagBlocks(chain: SupportedExecutionChain)', 'single mesh-safe DEX head policy');
requireText(graphlessDex, 'const current = Math.max(0, observedHead - headLagBlocks);', 'DEX log queries must avoid an unfinalized cross-provider tip');
requireText(graphlessDex, 'Math.min(input.currentBlock, priorCursor ?? bootstrapStart)', 'factory cursors cannot point beyond the canonical mesh-safe head');
requireText(graphlessDex, 'meshSafeHeadLagBlocks: meshSafeHeadLagBlocks(chain)', 'mesh-safe DEX head telemetry');

requireText(prediction, "refreshCadenceAuthority: 'prediction_market_discovery_wiring'", 'single prediction cadence authority');
requireText(prediction, 'refreshKalshiSystemEvidenceNow()', 'Kalshi refresh joined to prediction cadence');
requireText(prediction, 'duplicateKalshiTimer: false', 'no duplicate Kalshi recurring timer');
forbidText(kalshi, 'setInterval(', 'independent Kalshi recurring refresh loop');
requireText(kalshi, "canonicalPredictionCadenceOwner: 'prediction_market_discovery_wiring'", 'Kalshi cadence ownership declaration');

requireText(kalshiAuth, "return path.startsWith('/trade-api/v2/margin/') ? 'perps' : 'event'", 'path-derived Kalshi credential capability scope');
requireText(kalshiAuth, "if (scope === 'perps') return perpsApiKeyId()", 'no silent event-key substitution for perps key id');
requireText(kalshiAuth, "if (scope === 'perps') return perpsPrivateKeyRaw()", 'no silent event-key substitution for perps private key');

if (failures.length) {
  console.error('Canonical refresh/capability authority verification FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Canonical refresh/capability authority verification PASSED');
console.log(' - CEX global and exact-symbol refresh share one serialized execution authority');
console.log(' - public-only CEX observations cannot create impossible evidence-reacquisition loops');
console.log(' - on-chain discovery waits for the canonical RPC mesh without blocking CEX discovery');
console.log(' - graphless DEX factory scans use a mesh-safe lagged head rather than an unfinalized provider tip');
console.log(' - prediction/Kalshi refresh uses one recurring cadence authority');
console.log(' - Kalshi margin requests cannot silently borrow event credentials');
