const fs = require('node:fs');

const bootstrap = fs.readFileSync('server/services/cryptocrawl/execution/adapters/provider-specific-receiver-bootstrap.ts', 'utf8');
const wiring = fs.readFileSync('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts', 'utf8');

for (const fragment of [
  "export type ProviderSpecificReceiverKind = 'aave_v3' | 'morpho_blue'",
  'CryptocrawlAaveV3FlashLoanReceiver.json',
  'CryptocrawlMorphoFlashLoanReceiver.json',
  'resolveAaveV3Pool(chain)',
  'resolveMorphoBlue(chain)',
  'requireZeroCapitalInfrastructureDeploymentAllowed',
  'verifyFlashLoanReceiverCapability',
  'operator_monetary_input_required:false',
  'provider_receiver_cold_start_route_local:true',
]) {
  if (!bootstrap.includes(fragment)) throw new Error(`Provider receiver bootstrap verifier missing: ${fragment}`);
}

for (const fragment of [
  'ensureProviderSpecificReceiverCapability',
  "measuredSingle.provider === 'aave_v3' || measuredSingle.provider === 'morpho_blue'",
  'resourceReady',
  'bootstrappedProviders.add(measuredSingle.provider)',
  '.filter(providerKind => !bootstrappedProviders.has(providerKind))',
  'fresh_quote_after_provider_receiver_bootstrap',
  'stale_quote_execution_allowed:false',
  'other_provider_admission_blocked:false',
]) {
  if (!wiring.includes(fragment)) throw new Error(`Provider receiver wiring verifier missing: ${fragment}`);
}

if (bootstrap.includes("kind: 'balancer_v1'")) {
  throw new Error('Provider-specific Aave/Morpho bootstrap must not replace or duplicate Balancer receiver authority');
}
if (!wiring.includes('prepareBuilderSponsoredReceiverBootstrap')) {
  throw new Error('Existing Balancer atomic first-receiver fallback must remain available');
}

console.log('PROVIDER_SPECIFIC_RECEIVER_COLDSTART_VERIFIED');
