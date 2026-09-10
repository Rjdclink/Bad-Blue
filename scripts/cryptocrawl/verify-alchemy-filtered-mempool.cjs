const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const stream = read('server/services/cryptocrawl/capital-free/provider-mesh-pending-stream.ts');
const generator = read('server/services/cryptocrawl/discovery/mempool-opportunity-generator.ts');
const capability = read('server/services/cryptocrawl/discovery/mempool-capability-registry.ts');
const observability = read('server/services/cryptocrawl/integration/filtered-mempool-observability.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const coreRuntime = read('server/services/cryptocrawl/runtime/core-runtime.ts');
const providerMesh = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');

requireText(stream, "export type ProviderMeshPendingNetwork = 'ethereum' | 'polygon'", 'replacement pending support preserves the exact bounded network scope');
requireText(stream, "params: ['drpc_pendingTransactions']", 'free full-transaction pending subscription is used');
requireText(stream, 'applicationSideRouterFilter: true', 'router relevance filtering is explicit and truthful');
requireText(stream, 'providerSideAddressFilter: false', 'replacement must not claim provider-side address filtering');
requireText(stream, 'exactChainBinding: true', 'replacement declares exact chain binding');
requireText(stream, "authority: 'mempool_evidence_only'", 'mempool evidence remains evidence-only');
requireText(stream, 'executionAuthority: false', 'mempool stream cannot authorize execution');
requireText(stream, 'MAX_FALLBACK_DETAILS_PER_MINUTE', 'fallback detail fetches remain bounded');
requireText(stream, 'fallbackDetailFetchesBlockedByBudget', 'fallback detail budget pressure is observable');
requireText(stream, 'operatorBillingLiability: false', 'replacement declares no operator billing liability');
requireText(stream, 'alchemyDependency: false', 'replacement declares no Alchemy dependency');
forbidText(stream, 'ALCHEMY_API_KEY', 'replacement must not consume the Alchemy API key');
forbidText(stream, 'alchemy_pendingTransactions', 'replacement must not use paid Alchemy filtered pending subscriptions');
forbidText(stream, 'estimatedProfit', 'pending stream cannot fabricate profitability');
forbidText(stream, 'executeVerifiedArbitragePlan', 'pending stream cannot invoke execution');
forbidText(stream, 'stageManager', 'pending stream cannot mutate governance');

requireText(generator, 'ensureProviderMeshPendingStream()', 'mempool discovery starts the replacement stream on demand');
requireText(generator, 'providerMeshPendingStream.getRecentObservations()', 'mempool discovery consumes replacement observations');
requireText(generator, 'chains: [transaction.chain]', 'pending candidate preserves exact chain identity');
requireText(generator, 'application_filter_after_full_pending_push:true', 'candidate provenance records truthful application-side filtering');
requireText(generator, 'alchemy_dependency:false', 'candidate provenance records Alchemy independence');
requireText(generator, 'executableCapability: false', 'pending evidence remains non-executable before compiler proof');
requireText(generator, 'deterministicNetProfitUsd: null', 'pending trigger cannot fabricate deterministic economics');
forbidText(generator, 'alchemyIntegration', 'mempool discovery must not use legacy Alchemy aggregate evidence');
forbidText(generator, 'filteredAlchemyPendingStream', 'mempool discovery must not use Alchemy filtered stream');

requireText(capability, 'providerMeshPendingStream.getStatistics()', 'capability registry reads replacement stream state');
requireText(capability, "provider: configured ? 'provider_mesh' : 'none'", 'capability provenance names the provider mesh rather than Alchemy');
forbidText(capability, 'alchemyIntegration', 'capability registry must not depend on legacy Alchemy telemetry');
forbidText(capability, 'filteredAlchemyPendingStream', 'capability registry must not depend on Alchemy filtered stream');

requireText(observability, 'providerMeshPendingStream.getStatistics()', 'mempool heartbeat reports replacement stream state');
requireText(observability, 'fallbackDetailEfficiency', 'fallback hash-to-detail efficiency remains observable');
requireText(observability, 'detailFetchBudgetPressure', 'fallback detail budget pressure remains observable');
requireText(observability, 'alchemyDependency: false', 'observability explicitly reports Alchemy independence');
forbidText(observability, 'filteredAlchemyPendingStream', 'observability must not read Alchemy stream state');
forbidText(observability, 'executeVerifiedArbitragePlan', 'mempool observability cannot execute trades');

requireText(runtime, 'ensureProviderMeshPendingStream()', 'canonical runtime activates the replacement mempool path');
requireText(runtime, "filteredMempoolEvidence: 'alchemy_free_provider_mesh_full_pending_exact_chain'", 'runtime advertises Alchemy-free mempool evidence');
requireText(runtime, "paidAlchemyRpcRole: 'disabled_no_runtime_authority'", 'runtime disables paid Alchemy RPC authority');
requireText(runtime, 'alchemyGasSponsorshipAuthority: false', 'runtime disables Alchemy gas sponsorship authority');
forbidText(runtime, 'ensureFilteredAlchemyPendingStream', 'canonical runtime must not activate paid Alchemy pending stream');
forbidText(runtime, 'ensureAlchemyStandardRpcFirstWiring', 'canonical runtime must not install Alchemy token/RPC fallback wiring');

requireText(coreRuntime, "import('../capital-free/provider-mesh-pending-stream.js')", 'core runtime loads replacement mempool policy');
requireText(coreRuntime, 'ensureProviderMeshPendingStream()', 'core runtime activates replacement mempool policy');
requireText(coreRuntime, 'alchemyMempoolAuthority: false', 'core runtime records no Alchemy mempool authority');
forbidText(coreRuntime, 'alchemy-filtered-mempool-wiring', 'core runtime must not dynamically install Alchemy mempool compatibility wiring');

requireText(providerMesh, "provider: 'dRPCPublicStreaming'", 'free dRPC streaming replacement is registered');
requireText(providerMesh, "websocketUrl: `wss://${slug}.drpc.org`", 'free dRPC WebSocket replacement is registered');
requireText(providerMesh, 'pendingTransactions: true', 'free streaming lane declares standard pending capability');
requireText(providerMesh, 'alchemyOperationalAuthority: false', 'provider mesh records no Alchemy operational authority');
requireText(providerMesh, 'alchemyPaidMempoolAuthority: false', 'provider mesh records no paid Alchemy mempool authority');
requireText(providerMesh, 'alchemyGasSponsorshipAuthority: false', 'provider mesh records no Alchemy sponsorship authority');

if (failures.length > 0) {
  console.error('[alchemy-free-mempool-replacement] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[alchemy-free-mempool-replacement] PASS — free provider mesh replaces paid Alchemy mempool/RPC authority while exact-chain evidence, bounded fallback, and execution isolation remain intact');
