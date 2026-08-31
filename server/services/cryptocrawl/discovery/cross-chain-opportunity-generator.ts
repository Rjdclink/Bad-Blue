import { getAcrossBridgeQuote, getAcrossBridgeReadiness, type AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';
import type { ChainId } from '../bridge/types.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

const CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
const ASSETS = ['USDC', 'USDT'] as const;
let routeCursor = 0;

interface CrossChainRoute {
  from: ChainId;
  to: ChainId;
  asset: typeof ASSETS[number];
}

function rpcHealthy(chain: ChainId): boolean {
  return multiProviderRpcManager.getHealth(chain).some(observation => observation.http.success);
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function discoveryNotionalUsd(): number {
  const value = Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_NOTIONAL_USD || 100);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1_000_000) : 100;
}

function structuralRoutes(): CrossChainRoute[] {
  const routes: CrossChainRoute[] = [];
  for (const from of CHAINS) {
    if (!rpcHealthy(from)) continue;
    for (const to of CHAINS) {
      if (from === to || !rpcHealthy(to)) continue;
      for (const asset of ASSETS) routes.push({ from, to, asset });
    }
  }
  return routes;
}

function routeKey(route: CrossChainRoute): string {
  return `${route.from}:${route.to}:${route.asset}`;
}

function rotatingQuoteRoutes(routes: CrossChainRoute[]): CrossChainRoute[] {
  if (routes.length === 0) return [];
  const requested = boundedInteger(process.env.CRYPTOCRAWL_ACROSS_QUOTES_PER_CYCLE, 4, 1, 12);
  const count = Math.min(requested, routes.length);
  const selected = Array.from({ length: count }, (_, offset) => routes[(routeCursor + offset) % routes.length]);
  routeCursor = (routeCursor + count) % routes.length;
  return selected;
}

function freshQuote(quote: AcrossBridgeQuote | null, now: number): quote is AcrossBridgeQuote {
  if (!quote) return false;
  const maxAgeMs = Math.max(1_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_ACROSS_MAX_QUOTE_AGE_MS || 10_000)));
  return quote.observedAt <= now
    && now - quote.observedAt <= maxAgeMs
    && quote.expiresAt > now
    && quote.expectedFillTimeSec >= 0
    && Number.isFinite(quote.expectedFillTimeSec);
}

function bridgeQuoteProvenance(quote: AcrossBridgeQuote): string[] {
  const values = [
    ...quote.provenance,
    `across_quote_id:${quote.quoteId || 'none'}`,
    `across_expected_fill_seconds:${quote.expectedFillTimeSec}`,
    `across_simulation_success:${quote.simulationSuccess}`,
    `across_total_fee_usd:${quote.totalFeeUsd ?? 'unknown'}`,
    `across_total_max_fee_usd:${quote.totalMaxFeeUsd ?? 'unknown'}`,
    `across_bridge_fee_usd:${quote.bridgeFeeUsd ?? 'unknown'}`,
    `across_origin_gas_usd:${quote.originGasUsd ?? 'unknown'}`,
    `across_destination_gas_usd:${quote.destinationGasUsd ?? 'unknown'}`,
    `across_lp_fee_usd:${quote.lpFeeUsd ?? 'unknown'}`,
    `across_relayer_capital_fee_usd:${quote.relayerCapitalFeeUsd ?? 'unknown'}`,
  ];
  return [...new Set(values)];
}

function signerConfigured(): boolean {
  return Boolean(process.env.WALLET_PRIVATE_KEY?.trim());
}

function recordRoute(
  route: CrossChainRoute,
  now: number,
  ttlMs: number,
  quote: AcrossBridgeQuote | null,
): MeasuredCandidate {
  const hasFreshQuote = freshQuote(quote, now);
  const readiness = getAcrossBridgeReadiness();
  const hasSigner = signerConfigured();
  const expiresAt = hasFreshQuote
    ? Math.min(now + ttlMs, quote.expiresAt, quote.observedAt + Math.max(1_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_ACROSS_MAX_QUOTE_AGE_MS || 10_000))))
    : now + ttlMs;
  const bridgeCostUsd = hasFreshQuote ? quote.totalFeeUsd : null;

  // Across transport is no longer misreported as missing transaction-builder,
  // status-monitor, drift, recovery, or terminal-receipt machinery: the existing
  // Across executor refreshes the quote/payload before signing, applies the
  // original minimum-output bound, submits under governance, and waits for a
  // destination fill or verified refund. What this discovery object still lacks
  // is an ARBITRAGE REVENUE LEG. A bridge transfer by itself cannot have invented
  // gross/net profit, so CROSS_CHAIN remains fail-closed until source/destination
  // economic legs are composed around this measured transport.
  const missingInformation = [
    ...(!readiness.configured ? ['across_production_credentials'] : []),
    ...(!hasFreshQuote ? ['measured_bridge_quote', 'measured_bridge_liquidity', 'measured_bridge_transfer_time'] : []),
    ...(hasFreshQuote && quote.totalFeeUsd === null ? ['measured_bridge_total_fee'] : []),
    ...(hasFreshQuote && !quote.simulationSuccess ? ['bridge_provider_simulation_success'] : []),
    ...(hasFreshQuote && !quote.swapTransactionPresent ? ['across_swap_transaction_payload'] : []),
    ...(!hasSigner ? ['cross_chain_signer'] : []),
    'cross_chain_source_destination_profit_leg',
    'cross_chain_destination_price_and_revenue',
    'cross_chain_deterministic_all_in_profit_composition',
  ];

  return measuredCandidateRegistry.record({
    opportunityId: `cross-chain:${route.from}:${route.to}:${route.asset}:${now}`,
    topology: 'CROSS_CHAIN',
    observedAt: now,
    expiresAt,
    status: hasFreshQuote ? 'enriched' : 'observed',
    assets: [route.asset],
    venues: hasFreshQuote ? ['across'] : [],
    chains: [route.from, route.to],
    rawQuotes: hasFreshQuote ? [{
      source: 'across',
      venue: 'across',
      chain: `${route.from}->${route.to}`,
      symbol: route.asset,
      observedAt: quote.observedAt,
      amountIn: quote.inputAmount,
      amountOut: quote.expectedOutputAmount,
      executable: false,
      provenance: bridgeQuoteProvenance(quote),
    }] : [],
    depth: hasFreshQuote
      ? {
          status: 'measured',
          detail: `Across returned a fresh exact-input route for the sampled ${discoveryNotionalUsd()} ${route.asset}; this proves executable transport for the quoted amount, not a profitable cross-chain trade or global bridge depth`,
        }
      : { status: 'unavailable', detail: 'No fresh measured bridge liquidity quote has been admitted for this route in the current rotation' },
    economics: {
      // A bridge quote proves current transport cost, not arbitrage revenue.
      // Never manufacture a spread by treating same-asset movement as profit.
      grossProfitUsd: null,
      deterministicNetProfitUsd: null,
      feeUsd: null,
      gasUsd: null,
      bridgeUsd: bridgeCostUsd,
      expectedSlippageBps: null,
      expectedPriceImpactBps: null,
    },
    quoteAgeMs: hasFreshQuote ? Math.max(0, now - quote.observedAt) : null,
    executableCapability: false,
    executionCapabilityReason: hasFreshQuote
      ? 'Across transport has fresh measured cost/simulation and an existing refresh-sign-submit-terminal-settlement executor; this object is intentionally non-executable because no source/destination arbitrage revenue leg has yet been composed around the transport'
      : readiness.reason,
    missingInformation,
    provenance: [
      `rpc:${route.from}:healthy`,
      `rpc:${route.to}:healthy`,
      ...(hasFreshQuote ? bridgeQuoteProvenance(quote) : ['across_quote:not_sampled_or_unavailable_this_cycle']),
      `across_production_configured:${readiness.configured}`,
      `cross_chain_signer_configured:${hasSigner}`,
      'across_terminal_executor:refresh_quote_and_payload_before_signing',
      'across_terminal_executor:minimum_output_drift_bound',
      'across_terminal_executor:destination_receipt_or_verified_refund',
      'bridge_static_average_costs:non_authoritative',
      'cross_chain_transport_only:not_profit_opportunity',
      'cross_chain_profitability:not_authorized_without_revenue_leg',
      'synthetic_evidence:false',
    ],
  });
}

/**
 * Structural coverage is complete for every currently healthy chain pair and
 * stablecoin. Fresh Across approval quotes are sampled on a bounded rotating
 * subset so current transport costs are learned without shrinking the route
 * universe or pretending that transport alone is an arbitrage opportunity.
 */
export async function discoverMeasuredCrossChainCandidates(): Promise<MeasuredCandidate[]> {
  await multiProviderRpcManager.initialize(CHAINS);
  const now = Date.now();
  const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_CANDIDATE_TTL_MS || 30_000));
  const routes = structuralRoutes();
  const selected = rotatingQuoteRoutes(routes);
  const notionalUsd = discoveryNotionalUsd();

  const quoteResults = await Promise.allSettled(selected.map(route => getAcrossBridgeQuote({
    originChain: route.from,
    destinationChain: route.to,
    token: route.asset,
    amountHuman: notionalUsd,
  })));
  const quotes = new Map<string, AcrossBridgeQuote | null>();
  selected.forEach((route, index) => {
    const result = quoteResults[index];
    quotes.set(routeKey(route), result.status === 'fulfilled' ? result.value : null);
  });

  return routes.map(route => recordRoute(route, now, ttlMs, quotes.get(routeKey(route)) ?? null));
}
