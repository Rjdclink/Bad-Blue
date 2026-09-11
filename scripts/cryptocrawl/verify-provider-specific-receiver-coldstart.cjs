const fs = require('node:fs');

const bootstrap = fs.readFileSync('server/services/cryptocrawl/execution/adapters/provider-specific-receiver-bootstrap.ts', 'utf8');
const builderBootstrap = fs.readFileSync('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts', 'utf8');
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
  'prepareBuilderSponsoredProviderReceiverBootstrap',
  "balancer_v2: {",
  "aave_v3: {",
  "morpho_blue: {",
  "provider: providerEvidence.provider",
  'receiver_bootstrap:provider_${providerEvidence.provider}',
  'provider_failure_is_route_local:true',
  'prepareBuilderSponsoredReceiverBootstrap',
]) {
  if (!builderBootstrap.includes(fragment)) throw new Error(`Provider-aware atomic bootstrap verifier missing: ${fragment}`);
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
  'prepareBuilderSponsoredProviderReceiverBootstrap',
  'bootstrapCandidates',
  '.sort((left, right) => left.fee < right.fee ? -1 : left.fee > right.fee ? 1 : 0)',
  'provider_bootstrap_alternatives_exhausted_in_fee_order:true',
]) {
  if (!wiring.includes(fragment)) throw new Error(`Provider receiver wiring verifier missing: ${fragment}`);
}

if (bootstrap.includes("kind: 'balancer_v1'")) {
  throw new Error('Provider-specific funded Aave/Morpho bootstrap must not replace or duplicate Balancer receiver authority');
}
if (!builderBootstrap.includes("if (input.balancerEvidence.provider !== 'balancer_v2') return null;")) {
  throw new Error('Backward-compatible Balancer atomic receiver entrypoint must remain provider-bound');
}

console.log('PROVIDER_SPECIFIC_RECEIVER_COLDSTART_VERIFIED');
