'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const officialDiscovery = read('server/services/cryptocrawl/intelligence/universal-bps-opportunity-discovery.ts');
const broadSearch = read('server/services/cryptocrawl/intelligence/universal-bps-search-expansion.ts');
const overcomp = read('server/services/cryptocrawl/optimization/universal-fee-overcompensation-engine.ts');
const wiring = read('server/services/cryptocrawl/integration/authenticated-fee-tier-optimization-wiring.ts');

// Discovery must broaden beyond a frozen program catalog while remaining advisory.
assert.match(officialDiscovery, /recursivelyBroadening:\s*true/);
assert.match(officialDiscovery, /CRYPTOCRAWL_BPS_DISCOVERY_SEEDS/);
assert.match(officialDiscovery, /CRYPTOCRAWL_BPS_DISCOVERY_ALLOWED_HOSTS/);
assert.match(officialDiscovery, /recursively_discovered_link/);
assert.match(officialDiscovery, /publicPromotionCanCreateProfitability:\s*false/);
assert.match(officialDiscovery, /accountEligibilityAuthenticated:\s*false/);
assert.match(officialDiscovery, /preTradeEconomicAuthority:\s*false/);
assert.match(officialDiscovery, /realizedEconomicAuthority:\s*false/);
assert.match(officialDiscovery, /standard_plus_advanced_plus_authenticated_coinbase_one_benefits_only/);
assert.match(officialDiscovery, /kraken:\s*'free_base'/);
assert.match(officialDiscovery, /okx:\s*'free_base'/);
assert.match(officialDiscovery, /kalshi:\s*'standard_free'/);

// Existing optional search intelligence must expand discovery to external/partner surfaces.
assert.match(broadSearch, /SERPAPI_API_KEY/);
assert.match(broadSearch, /recursively_broadening_web_search_discovery/);
assert.match(broadSearch, /followupQueries/);
assert.match(broadSearch, /external_or_partner_result_advisory_only/);
assert.match(broadSearch, /publicPromotionCanCreateProfitability:\s*false/);
assert.match(broadSearch, /preTradeEconomicAuthority:\s*false/);
assert.match(broadSearch, /realizedEconomicAuthority:\s*false/);

// One strategy-neutral sidecar must observe every measured topology and preserve canonical truth.
assert.match(overcomp, /measuredCandidateRegistry\.onUpdate\(observeCandidate\)/);
assert.match(overcomp, /futureMeasuredTopologiesInheritedThroughRegistrySubscription:\s*true/);
assert.match(overcomp, /combinedDiscoveries/);
assert.match(overcomp, /feeOvercompensationSurplusBps/);
assert.match(overcomp, /continue_optimization_beyond_zero_fee_toward_positive_execution_surplus/);
assert.match(overcomp, /preserve_zero_personal_capital_hard_gate_while_maximizing_execution_surplus/);
assert.match(overcomp, /userCapitalContributionRequired:\s*claimedByTopology \? 0 : null/);
assert.match(overcomp, /existing_zero_capital_admission_authority/);
assert.match(overcomp, /discoveredEconomicCreditBps:\s*0/);
assert.match(overcomp, /doubleCountingAllowed:\s*false/);
assert.match(overcomp, /feeOvercompensationCanBlockProfitableTrade:\s*false/);
assert.match(overcomp, /canonicalEconomicsMutation:\s*false/);
assert.doesNotMatch(overcomp, /updateStatus\(/);
assert.doesNotMatch(overcomp, /record\(/);

// Runtime installation must reuse the existing canonical fee lifecycle.
assert.match(wiring, /ensureUniversalFeeOvercompensationEngine/);
assert.match(wiring, /ensureCexFeeRecoveryWiring\(\);\s*\n\s*ensureUniversalFeeOvercompensationEngine\(\);/);
assert.match(wiring, /executionAuthority:\s*false/);

console.log('Universal fee-overcompensation verification passed');
