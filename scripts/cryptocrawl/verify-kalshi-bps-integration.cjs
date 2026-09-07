const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const must = (condition, message) => {
  if (!condition) throw new Error(`[verify-kalshi-bps-integration] ${message}`);
};
const mustNot = (condition, message) => {
  if (condition) throw new Error(`[verify-kalshi-bps-integration] ${message}`);
};

const runtime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const bpsWiring = read('server/services/cryptocrawl/integration/kalshi-bps-optimization-wiring.ts');
const superEngine = read('server/services/cryptocrawl/optimization/bps-reduction-super-engine.ts');
const fourMode = read('server/services/cryptocrawl/intelligence/cex-four-mode-matrix.ts');
const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
const fundingDiscovery = read('server/services/cryptocrawl/discovery/funding-rate-discovery.ts');
const registry = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');

must(runtime.includes("ensureKalshiBpsOptimizationWiring"), 'canonical runtime must install the Kalshi BPS observer');
must(runtime.includes("install('kalshi_bps_optimization'"), 'Kalshi BPS observer must use canonical component isolation');
must(runtime.includes('kalshiBpsRealizedAuthority: false'), 'Kalshi BPS observer must not become realized-profit authority');

must(bpsWiring.includes('authenticatedEffectiveFees: true'), 'Kalshi BPS rows must use authenticated effective fee evidence');
must(bpsWiring.includes('makerSavingsCounterfactualUntilFill: true'), 'maker savings must remain counterfactual until fill');
must(bpsWiring.includes('fundingEstimateCreditedAsRealizedBps: false'), 'funding estimates must not be credited as realized BPS');
must(bpsWiring.includes('predictionIncentiveRewardCreditedAsBpsBeforePayment: false'), 'unpaid incentives must not be credited');
must(bpsWiring.includes('feeWaiverMetadataCreditedAsZeroFeeWithoutFeeProof: false'), 'fee-waiver metadata must not manufacture zero fees');
must(bpsWiring.includes('collateralReturnCreditedAsProfit: false'), 'collateral/netting must not be counted as profit');
must(bpsWiring.includes('executionAuthority: false'), 'Kalshi BPS observer must not submit trades');

must(superEngine.includes("candidate.topology === 'FUNDING_ARBITRAGE'"), 'Kalshi perps direct comparison must be funding-topology bounded');
must(superEngine.includes('economicCreditAllowed: false'), 'Kalshi alternative must not directly credit candidate economics');
must(superEngine.includes('kalshiSpotSubstitutionAllowed: false'), 'Kalshi perps must not silently substitute for spot CEX execution');
must(superEngine.includes('kalshi_perps_measured_alternate_route'), 'funding BPS search must expose the Kalshi measured alternative');

must(fundingDiscovery.includes("'kalshi_perps'"), 'funding discovery must include Kalshi perps');
must(fundingDiscovery.includes('funding_rate_moves_until_next_funding_time'), 'Kalshi funding estimate must remain explicitly mutable');
must(fundingDiscovery.includes('separate_kalshi_margin_entitlement_required_for_execution'), 'Kalshi execution entitlement must remain explicit');

// Coinbase/Kraken/OKX spot four-mode economics remain a separate semantic domain.
mustNot(/(?:CexFeeVenue|CexStreamVenue|QuoteVenue)[\s\S]{0,220}kalshi/i.test(feeResolver), 'Kalshi must not be added to the spot fee-venue type');
mustNot(/\['coinbase'\s*,\s*'kraken'\s*,\s*'okx'\s*,\s*'kalshi'/i.test(fourMode), 'Kalshi perps must not become a spot four-mode peer');

must(registry.includes('syntheticEconomicsAllowed: false'), 'canonical measured economics must remain non-synthetic');
must(registry.includes('netBps !== null') && registry.includes('netBps > 0'), 'minimum execution evidence must retain positive canonical net BPS');

console.log('[verify-kalshi-bps-integration] PASS');
