import { getAcrossBridgeQuote, getAcrossBridgeReadiness, type AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { ChainId } from '../bridge/types.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { evaluateAcrossSameAssetProfit, type CrossChainRouteEconomics } from './cross-chain-route-economics.js';

const CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
const ASSETS = ['USDC', 'USDT'] as const;
let routeCursor = 0;
const preparedCrossChainQuotes = new Map<string, { quote: AcrossBridgeQuote; economics: CrossChainRouteEconomics }>();

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
  liveAssetUsdPrice: number | null,
): MeasuredCandidate {
  const hasFreshQuote = freshQuote(quote, now);
  const readiness = getAcrossBridgeReadiness();
  const hasSigner = signerConfigured();
  const expiresAt = hasFreshQuote
    ? Math.min(now + ttlMs, quote.expiresAt, quote.observedAt + Math.max(1_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_ACROSS_MAX_QUOTE_AGE_MS || 10_000))))
    : now + ttlMs;
  const economics = hasFreshQuote && liveAssetUsdPrice !== null
    ? evaluateAcrossSameAssetProfit({ quote, liveAssetUsdPrice })
    : null;
  const deterministicPositive = economics?.executablePositive === true;
  const routeExecutable = deterministicPositive
    && readiness.configured
    && hasSigner
    && quote!.simulationSuccess === true
    && quote!.swapTransactionPresent === true
    && quote!.minOutputAmount !== null;
  const opportunityId = `cross-chain:${route.from}:${route.to}:${route.asset}:${now}`;

  if (routeExecutable && quote && economics) {
    preparedCrossChainQuotes.set(opportunityId, { quote, economics });
  }

  const missingInformation = [
    ...(!readiness.configured ? ['across_production_credentials'] : []),
    ...(!hasFreshQuote ? ['measured_bridge_quote', 'measured_bridge_liquidity', 'measured_bridge_transfer_time'] : []),
    ...(hasFreshQuote && quote.totalFeeUsd === null ? ['measured_bridge_total_fee'] : []),
    ...(hasFreshQuote && quote.originGasUsd === null ? ['measured_origin_gas_usd'] : []),
    ...(hasFreshQuote && quote.minOutputAmount === null ? ['guaranteed_minimum_output'] : []),
    ...(hasFreshQuote && !quote.simulationSuccess ? ['bridge_provider_simulation_success'] : []),
    ...(hasFreshQuote && !quote.swapTransactionPresent ? ['across_swap_transaction_payload'] : []),
    ...(!hasSigner ? ['cross_chain_signer'] : []),
    ...(liveAssetUsdPrice === null ? ['live_same_asset_usd_price'] : []),
    ...(economics && !deterministicPositive ? ['positive_guaranteed_cross_chain_net_after_origin_gas'] : []),
  ];

  return measuredCandidateRegistry.record({
    opportunityId,
    topology: 'CROSS_CHAIN',
    observedAt: now,
    expiresAt,
    status: routeExecutable ? 'eligible' : deterministicPositive ? 'deterministic_positive' : hasFreshQuote ? 'enriched' : 'observed',
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
      amountOut: quote.minOutputAmount ?? quote.expectedOutputAmount,
      executable: routeExecutable,
      provenance: [
        ...bridgeQuoteProvenance(quote),
        'cross_chain_profit_output_authority:minimum_guaranteed_output',
      ],
    }] : [],
    depth: hasFreshQuote
      ? {
          status: 'measured',
          detail: `Across returned a fresh exact-input simulated route for the sampled ${discoveryNotionalUsd()} ${route.asset}; measured depth applies only to this exact quoted amount`,
        }
      : { status: 'unavailable', detail: 'No fresh measured bridge liquidity quote has been admitted for this route in the current rotation' },
    economics: {
      // Across expected/minimum output already includes route swap/bridge/destination
      // fees. Do not subtract totalFeeUsd a second time. Origin gas is signer-paid
      // outside output amount and is subtracted exactly once by the economics helper.
      grossProfitUsd: economics?.routeGainUsdBeforeOriginGas ?? null,
      deterministicNetProfitUsd: economics?.deterministicNetProfitUsd ?? null,
      feeUsd: hasFreshQuote ? quote.totalFeeUsd : null,
      gasUsd: economics?.originGasUsd ?? (hasFreshQuote ? quote.originGasUsd : null),
      bridgeUsd: hasFreshQuote ? quote.bridgeFeeUsd : null,
      expectedSlippageBps: null,
      expectedPriceImpactBps: null,
      notionalUsd: economics?.notionalUsd ?? null,
      netProfitBps: economics?.netProfitBps ?? null,
    },
    quoteAgeMs: hasFreshQuote ? Math.max(0, now - quote.observedAt) : null,
    executableCapability: routeExecutable,
    executionCapabilityReason: routeExecutable
      ? 'Across has a fresh simulated exact-input route whose guaranteed same-asset minimum output remains positive after separately paid origin gas; canonical measured-topology execution may revalidate immediately before signing'
      : deterministicPositive
        ? 'Cross-chain economics are deterministically positive, but a required execution capability fact is unavailable'
        : hasFreshQuote
          ? 'Across transport is measured and executable, but this exact same-asset route is not deterministically positive after guaranteed minimum output and origin gas'
          : readiness.reason,
    missingInformation: [...new Set(missingInformation)],
    provenance: [
      `rpc:${route.from}:healthy`,
      `rpc:${route.to}:healthy`,
      ...(hasFreshQuote ? bridgeQuoteProvenance(quote) : ['across_quote:not_sampled_or_unavailable_this_cycle']),
      `across_production_configured:${readiness.configured}`,
      `cross_chain_signer_configured:${hasSigner}`,
      'across_terminal_executor:refresh_quote_and_payload_before_signing',
      'across_terminal_executor:minimum_output_drift_bound',
      'across_terminal_executor:destination_receipt_or_verified_refund',
      'cross_chain_profit_model:same_asset_closed_value',
      'cross_chain_profit_model:minimum_output_not_expected_output',
      'cross_chain_profit_model:origin_gas_subtracted_once',
      'synthetic_evidence:false',
    ],
  });
}

export function getPreparedCrossChainRoute(opportunityId: string): { quote: AcrossBridgeQuote; economics: CrossChainRouteEconomics } | null {
  const prepared = preparedCrossChainQuotes.get(opportunityId) ?? null;
  if (!prepared) return null;
  if (prepared.quote.expiresAt <= Date.now()) {
    preparedCrossChainQuotes.delete(opportunityId);
    return null;
  }
  return prepared;
}

/**
 * Structural coverage is complete for every currently healthy chain pair and
 * stablecoin. Fresh Across approval quotes are sampled on a bounded rotating
 * subset. A route becomes executable only when its guaranteed same-asset output
 * is strictly positive after separately paid origin gas; transport alone remains
 * observation-only.
 */
export async function discoverMeasuredCrossChainCandidates(): Promise<MeasuredCandidate[]> {
  await multiProviderRpcManager.initialize(CHAINS);
  const now = Date.now();
  const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_CANDIDATE_TTL_MS || 30_000));
  const routes = structuralRoutes();
  const selected = rotatingQuoteRoutes(routes);
  const notionalUsd = discoveryNotionalUsd();

  const [quoteResults, prices] = await Promise.all([
    Promise.allSettled(selected.map(route => getAcrossBridgeQuote({
      originChain: route.from,
      destinationChain: route.to,
      token: route.asset,
      amountHuman: notionalUsd,
    }))),
    coinGeckoPriceClient.getLiveSymbolPrices([...ASSETS]).catch(() => new Map<string, number>()),
  ]);
  const quotes = new Map<string, AcrossBridgeQuote | null>();
  selected.forEach((route, index) => {
    const result = quoteResults[index];
    quotes.set(routeKey(route), result.status === 'fulfilled' ? result.value : null);
  });

  for (const [id, prepared] of preparedCrossChainQuotes.entries()) {
    if (prepared.quote.expiresAt <= now) preparedCrossChainQuotes.delete(id);
  }

  return routes.map(route => recordRoute(
    route,
    now,
    ttlMs,
    quotes.get(routeKey(route)) ?? null,
    prices.get(route.asset) ?? null,
  ));
}
