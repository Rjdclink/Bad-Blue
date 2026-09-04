'use strict';

const fs = require('node:fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}
function must(path, text, needle, message) {
  if (!text.includes(needle)) throw new Error(`${message} (${path})`);
}
function mustNot(path, text, needle, message) {
  if (text.includes(needle)) throw new Error(`${message} (${path})`);
}

const advisoryPath = 'server/services/cryptocrawl/optimization/nix-gen/cex-account-tier-advisory.ts';
const priorityPath = 'server/services/cryptocrawl/optimization/nix-gen/live-priority-registry.ts';
const feeObserverPath = 'server/services/cryptocrawl/integration/authenticated-fee-tier-optimization-wiring.ts';
const feeResolverPath = 'server/services/cryptocrawl/intelligence/cex-fee-resolver.ts';
const productPolicyPath = 'server/services/cryptocrawl/execution/cex-spot-product-policy.ts';

const advisory = read(advisoryPath);
const priority = read(priorityPath);
const feeObserver = read(feeObserverPath);
const feeResolver = read(feeResolverPath);
const productPolicy = read(productPolicyPath);

must(advisoryPath, advisory, 'getAuthenticatedFeeTierSnapshot', 'Account-tier advisory must consume authenticated cached fee evidence');
must(advisoryPath, advisory, 'getAuthenticatedFeeTierTrajectory', 'Account-tier advisory must consume organic authenticated tier history');
must(advisoryPath, advisory, "authority: 'authenticated_account_tier_advisory_only'", 'Account-tier surface must identify itself as advisory only');
must(advisoryPath, advisory, "canonicalFeeAuthority: 'cex_fee_resolver_only'", 'Canonical fee authority must remain the CEX fee resolver');
must(advisoryPath, advisory, "productConstraintAuthority: 'live_cex_product_policy_only'", 'Live product/minimum constraints must remain independently authoritative');
must(advisoryPath, advisory, "rateLimitPressureAuthority: 'existing_exchange_backoff_and_terminal_outcome_learning'", 'Rate-limit pressure must remain with existing backoff and terminal learning');
must(advisoryPath, advisory, 'staticFreeTierAssumption: false', 'No static free-tier assumption may steer venue selection');
must(advisoryPath, advisory, 'publishedTierTableEconomicAuthority: false', 'Published tier tables must never become executable economics');
must(advisoryPath, advisory, 'futureSavingsEconomicAuthority: false', 'Future possible fee savings must not justify a current trade');
must(advisoryPath, advisory, 'planRepricingAuthority: false', 'Account-tier advisory must never reprice a plan');
must(advisoryPath, advisory, 'executionAuthority: false', 'Account-tier advisory must never execute');
must(advisoryPath, advisory, 'capitalMovementAuthority: false', 'Account-tier advisory must never move capital');

for (const forbidden of [
  'fetch(',
  'fetchJsonWithRetry',
  'krakenPrivateRequest',
  'resolveOkxAccountFeeRates',
  'getCoinbaseSpotFeeEvidence',
  'resolveCexFeeEvidence',
  'CRYPTO_ARBITRAGE_COINBASE_TAKER_FEE_BPS',
  'CRYPTO_ARBITRAGE_KRAKEN_TAKER_FEE_BPS',
  'CRYPTO_ARBITRAGE_OKX_TAKER_FEE_BPS',
]) {
  mustNot(advisoryPath, advisory, forbidden, `Account-tier advisory must not create a second fee/network authority: ${forbidden}`);
}

must(priorityPath, priority, 'accountTierAdvisory: CexAccountTierAdvisory', 'Nix-Gen CEX demand must expose current account-tier evidence');
must(priorityPath, priority, 'getCexAccountTierAdvisory(now)', 'Nix-Gen demand must attach account-tier evidence without fetching it itself');
must(priorityPath, priority, 'const netProfitUsd = Number(bid.economics.netProfitUsd);', 'Raw venue demand must remain derived from canonical bid net profit');
must(priorityPath, priority, 'weightedCanonicalProfitUsd: Number(value.profit.toFixed(12))', 'Raw canonical-profit demand must remain separately preserved');
must(priorityPath, priority, '* specialization.confidence', 'Cryptara venue influence must be confidence weighted');
must(priorityPath, priority, 'value.profit * specializationMultiplier', 'Routing advisory may only apply the bounded learning multiplier to canonical demand');
mustNot(priorityPath, priority, 'accountTierAdvisory.takerFeeBps', 'Nix-Gen must not subtract authenticated fees a second time');
mustNot(priorityPath, priority, 'accountTierAdvisory.makerFeeBps', 'Nix-Gen must not recalculate maker economics');
mustNot(priorityPath, priority, 'bestObservedOrganicFeeImprovementBps *', 'Possible future tier improvement must not boost executable profit');

must(feeObserverPath, feeObserver, 'observationGeneratesExchangeTraffic: false', 'Fee-tier observation must remain cache-only');
must(feeObserverPath, feeObserver, "feeAuthority: 'cex_fee_resolver_only'", 'Fee observer must retain one canonical fee authority');
must(feeObserverPath, feeObserver, 'losingTradeForFutureTierSavingsAllowed: false', 'Fee tiers must never justify intentional losing volume');
must(feeObserverPath, feeObserver, 'washOrSelfTradeAllowed: false', 'Fee tiers must never justify wash/self trading');
must(feeResolverPath, feeResolver, "source === 'configured_override'", 'Configured fee overrides must remain excluded from executable authenticated fee cache');
must(feeResolverPath, feeResolver, 'kraken_account_rate_limit_cooldown', 'Kraken account fee pressure must retain bounded cooldown behavior');
must(productPolicyPath, productPolicy, 'baseMinSize', 'Live product policy must retain minimum-size evidence');
must(productPolicyPath, productPolicy, 'quoteMinSize', 'Live product policy must retain minimum-notional evidence where published');

console.log('NIX-GEN ACCOUNT-TIER ADVISORY VERIFIER PASSED');
