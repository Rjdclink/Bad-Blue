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
const analysis = read('server/services/cryptocrawl/capital-free/provider-mesh-mempool-analysis.ts');
const compatibility = read('server/services/cryptocrawl/capital-free/alchemy-integration.ts');
const namespace = read('server/services/cryptocrawl/capital-free/index.ts');
const generator = read('server/services/cryptocrawl/discovery/mempool-opportunity-generator.ts');
const capability = read('server/services/cryptocrawl/discovery/mempool-capability-registry.ts');
const observability = read('server/services/cryptocrawl/integration/filtered-mempool-observability.ts');
const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const coreRuntime = read('server/services/cryptocrawl/runtime/core-runtime.ts');
const providerMesh = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');
const zeroCapital = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const telemetry = read('server/services/cryptocrawl/integration/telemetry-bootstrap.ts');
const runtimeObservability = read('server/services/cryptocrawl/integration/runtime-observability.ts');

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

requireText(analysis, "method: 'txpool_content'", 'mempool pressure uses measured txpool content rather than a swap-count proxy');
requireText(analysis, "ethereum: 'https://eth.drpc.org/'", 'Ethereum pressure uses the documented public dRPC endpoint');
requireText(analysis, "polygon: 'https://polygon.drpc.org/'", 'Polygon pressure uses the documented public dRPC endpoint');
requireText(analysis, 'PRESSURE_SAMPLE_TTL_MS', 'txpool pressure is bounded and cached');
requireText(analysis, 'PRESSURE_REQUEST_TIMEOUT_MS', 'txpool pressure request time is bounded');
requireText(analysis, 'mempool_pressure:measured_not_inferred', 'analysis explicitly distinguishes measured from inferred pressure');
requireText(analysis, 'available: freshPressure.length > 0', 'pressure availability requires a current measured txpool sample');
requireText(analysis, 'operator_billing_liability:false', 'pressure evidence creates no operator billing liability');
requireText(analysis, 'alchemy_dependency:false', 'pressure evidence declares Alchemy independence');
forbidText(analysis, 'ALCHEMY_API_KEY', 'pressure analysis must not consume Alchemy credentials');
forbidText(analysis, 'g.alchemy.com', 'pressure analysis must not call Alchemy');
forbidText(analysis, 'estimatedProfit', 'pressure analysis cannot synthesize profitability');

requireText(compatibility, 'Legacy compatibility facade for the former Alchemy integration', 'legacy import surface is explicitly a compatibility facade');
requireText(compatibility, 'No request in this module is sent to Alchemy', 'compatibility boundary states the transport invariant');
requireText(compatibility, 'ensureDynamicRpcProviderWiring()', 'legacy token/readiness callers resolve through provider mesh');
requireText(compatibility, 'getProviderMeshMempoolAnalysis()', 'legacy mempool callers resolve through provider-neutral analysis');
requireText(compatibility, "apiKey: 'retired'", 'legacy statistics cannot report a live Alchemy credential');
requireText(compatibility, 'alchemyNetworkRequestsAllowed: false', 'compatibility telemetry records Alchemy network retirement');
requireText(compatibility, 'alchemyCredentialRead: false', 'compatibility telemetry records no Alchemy credential consumption');
forbidText(compatibility, 'process.env.ALCHEMY_API_KEY', 'compatibility facade must not read Alchemy credentials');
forbidText(compatibility, 'g.alchemy.com', 'compatibility facade must not contain Alchemy endpoints');
forbidText(compatibility, 'alchemy_pendingTransactions', 'compatibility facade must not call Alchemy enhanced APIs');
forbidText(compatibility, 'fetch(`${ALCHEMY', 'compatibility facade must not retain hidden Alchemy HTTP calls');

requireText(namespace, 'Free/configured multi-provider RPC telemetry', 'capital-free namespace advertises the replacement provider authority');
requireText(namespace, 'Alchemy-free measured pending-transaction and txpool pressure evidence', 'capital-free namespace advertises measured replacement evidence');

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

requireText(zeroCapital, 'await ensureDynamicRpcProviderWiring()', 'zero-capital provider selection initializes replacement mesh first');
requireText(zeroCapital, "providerAuthority: 'multiProviderRpcManager_free_and_configured_mesh'", 'zero-capital runtime records provider-mesh authority');
requireText(zeroCapital, 'alchemyOperationalAuthority: false', 'zero-capital runtime records no Alchemy authority');
forbidText(zeroCapital, 'alchemyIntegration.start', 'zero-capital runtime must not start Alchemy');

requireText(telemetry, 'startFreeProviderTelemetry()', 'telemetry bootstrap activates replacement provider telemetry');
requireText(telemetry, 'alchemyOperationalAuthority: false', 'telemetry records no Alchemy authority');
forbidText(telemetry, 'alchemyIntegration', 'telemetry bootstrap must not call Alchemy compatibility or network APIs');
forbidText(telemetry, "canonical: 'ALCHEMY_API_KEY'", 'telemetry must not revive an Alchemy environment alias');

requireText(runtimeObservability, "authority: 'multiProviderRpcManager'", 'runtime heartbeat reports provider-mesh authority');
requireText(runtimeObservability, 'alchemyOperationalAuthority: false', 'runtime heartbeat records no Alchemy authority');
forbidText(runtimeObservability, 'alchemyIntegration', 'runtime heartbeat must not probe Alchemy');

if (failures.length > 0) {
  console.error('[alchemy-free-mempool-replacement] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[alchemy-free-mempool-replacement] PASS — free/configured provider mesh replaces Alchemy network, token, mempool and telemetry authority while measured pressure, exact-chain evidence, bounded fallback, and execution isolation remain intact');
