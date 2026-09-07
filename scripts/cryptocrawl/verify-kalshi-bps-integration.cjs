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
const eventFees = read('server/services/cryptocrawl/intelligence/kalshi-event-fee-authority.ts');
const marginFees = read('server/services/cryptocrawl/intelligence/kalshi-margin-fee-authority.ts');
const perpsMarket = read('server/services/cryptocrawl/intelligence/kalshi-perps-market-authority.ts');
const eventOrders = read('server/services/cryptocrawl/execution/kalshi-event-order-authority.ts');
const eventMaker = read('server/services/cryptocrawl/execution/kalshi-event-market-maker.ts');
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

must(eventFees.includes('/trade-api/v2/events/fee_changes?'), 'event fee authority must load event-level fee overrides');
must(eventFees.includes('eventFeeOverrideActive'), 'event fee authority must track whether an event override is effective');
must(eventFees.includes('kalshi_event_fee_override:applied'), 'event fee provenance must identify applied event overrides');
must(eventFees.includes('actual_fill_fee:terminal_authority'), 'terminal fill fees must remain the realized fee authority');
must(eventFees.includes('zeroFeeCreditedFromWaiverMetadata: false'), 'event waiver metadata must never manufacture zero fees');
must(eventFees.includes('unknown_fee_structure:fails_closed'), 'unsupported event fee structures must fail closed');

must(marginFees.includes("'/trade-api/v2/margin/fee_tiers'"), 'funding execution must use authenticated effective per-market margin fee tiers');
must(marginFees.includes("source: 'kalshi_authenticated_effective_margin_fee_tiers'"), 'margin fee evidence must be explicitly authenticated and effective');
must(marginFees.includes('synthetic: false'), 'margin fee evidence must never be synthetic');
must(perpsMarket.includes('getKalshiMarginEnabled'), 'perps execution evidence must prove authenticated margin entitlement');
must(perpsMarket.includes('if (!marginEnabled || !fees'), 'perps execution must fail closed without entitlement or fee evidence');

must(eventOrders.includes('getKalshiEventExchangeIndex'), 'event order authority must resolve the current market exchange shard');
must(eventOrders.includes('market_ticker: state.ticker'), 'event cancel must auto-route using the exact market ticker');
must(eventOrders.includes('exchange_index: exchangeIndex'), 'event order groups must bind to the resolved market shard');
must(eventMaker.includes('createKalshiEventOrderGroup(Math.max(contracts, contracts * 2), plan.ticker)'), 'maker order groups must be created on the candidate market shard');
mustNot(eventOrders.includes('exchange_index: 0'), 'event order submission/cancel must never hardcode exchange shard zero');

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
