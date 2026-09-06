import {
  getAcrossBridgeReadiness,
  getAcrossCrossSwapQuote,
  type AcrossBridgeQuote,
  type AcrossStableSymbol,
} from '../bridge/across-bridge-provider.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { ChainId } from '../bridge/types.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';
import { evaluateAcrossClosedUsdProfit, type CrossChainRouteEconomics } from './cross-chain-route-economics.js';

const CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
const ASSETS: readonly AcrossStableSymbol[] = ['USDC', 'USDT'] as const;
const preparedCrossChainQuotes = new Map<string, { quote: AcrossBridgeQuote; economics: CrossChainRouteEconomics }>();

interface CrossChainRoute {
  from: ChainId;
  to: ChainId;
  inputAsset: AcrossStableSymbol;
  outputAsset: AcrossStableSymbol;
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
      for (const inputAsset of ASSETS) {
        for (const outputAsset of ASSETS) routes.push({ from, to, inputAsset, outputAsset });
      }
    }
  }
  return routes;
}

function routeKey(route: CrossChainRoute): string {
  return `${route.from}:${route.to}:${route.inputAsset}:${route.outputAsset}`;
}

function acrossQuoteConcurrency(): number {
  return boundedInteger(process.env.CRYPTOCRAWL_ACROSS_QUOTE_CONCURRENCY, 4, 1, 8);
}

/**
 * Every structural same-asset and USDC<->USDT Across cross-swap is refreshed in
 * every discovery cycle. Across itself composes any origin/destination swaps with
 * the bridge; CryptoCrawler only consumes the provider's guaranteed minimum
 * output and never fabricates a cross-chain price leg.
 */
async function acquireRouteQuotes(
  routes: readonly CrossChainRoute[],
  notionalUsd: number,
): Promise<Map<string, AcrossBridgeQuote | null>> {
  const quotes = new Map<string, AcrossBridgeQuote | null>();
  if (routes.length === 0) return quotes;
  let cursor = 0;
  const workers = Math.min(acrossQuoteConcurrency(), routes.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      const route = routes[index];
      try {
        quotes.set(routeKey(route), await getAcrossCrossSwapQuote({
          originChain: route.from,
          destinationChain: route.to,
          inputSymbol: route.inputAsset,
          outputSymbol: route.outputAsset,
          amountHuman: notionalUsd,
        }));
      } catch {
        quotes.set(routeKey(route), null);
      }
    }
  }));
  return quotes;
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
  return [...new Set([
    ...quote.provenance,
    `across_quote_id:${quote.quoteId || 'none'}`,
    `across_expected_fill_seconds:${quote.expectedFillTimeSec}`,
    `across_simulation_success:${quote.simulationSuccess}`,
    `across_total_fee_usd:${quote.totalFeeUsd ?? 'unknown'}`,
    `across_total_max_fee_usd:${quote.totalMaxFeeUsd ?? 'unknown'}`,
    `across_bridge_fee_usd:${quote.bridgeFeeUsd ?? 'unknown'}`,
    `across_origin_gas_usd:${quote.originGasUsd ?? 'unknown'}`,
    `across_approval_transactions:${quote.approvalTransactions}`,
    `across_destination_gas_usd:${quote.destinationGasUsd ?? 'unknown'}`,
    `across_lp_fee_usd:${quote.lpFeeUsd ?? 'unknown'}`,
    `across_relayer_capital_fee_usd:${quote.relayerCapitalFeeUsd ?? 'unknown'}`,
    `across_cross_swap_type:${quote.crossSwapType ?? 'unreported'}`,
  ])];
}

function signerConfigured(): boolean {
  return Boolean(process.env.WALLET_PRIVATE_KEY?.trim());
}

function recordRoute(
  route: CrossChainRoute,
  now: number,
  ttlMs: number,
  quote: AcrossBridgeQuote | null,
  prices: ReadonlyMap<string, number>,
): MeasuredCandidate {
  const hasFreshQuote = freshQuote(quote, now);
  const readiness = getAcrossBridgeReadiness();
  const hasSigner = signerConfigured();
  const inputPrice = prices.get(route.inputAsset) ?? null;
  const outputPrice = prices.get(route.outputAsset) ?? null;
  const maxAgeMs = Math.max(1_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_ACROSS_MAX_QUOTE_AGE_MS || 10_000)));
  const expiresAt = hasFreshQuote ? Math.min(now + ttlMs, quote.expiresAt, quote.observedAt + maxAgeMs) : now + ttlMs;
  const economics = hasFreshQuote && inputPrice !== null && outputPrice !== null
    ? evaluateAcrossClosedUsdProfit({ quote, liveInputAssetUsdPrice: inputPrice, liveOutputAssetUsdPrice: outputPrice })
    : null;
  const deterministicPositive = economics?.executablePositive === true;

  // Approval transaction gas is deliberately not inferred from swapTx originGas.
  // Approval-required routes remain visible and automatically refreshed, but only
  // zero-approval quotes can currently satisfy complete pre-trade all-in cost
  // proof. The executor can still pay system-owned approval gas for lifecycle
  // recovery, but that cost cannot be omitted from deterministic admission.
  const approvalGasCanonical = hasFreshQuote && quote.approvalTransactions === 0;
  const routeExecutable = deterministicPositive
    && readiness.configured
    && hasSigner
    && approvalGasCanonical
    && quote!.simulationSuccess === true
    && quote!.swapTransactionPresent === true
    && quote!.minOutputAmount !== null;
  const opportunityId = `cross-chain:${route.from}:${route.to}:${route.inputAsset}-${route.outputAsset}:${now}`;

  if (routeExecutable && quote && economics) preparedCrossChainQuotes.set(opportunityId, { quote, economics });

  const missingInformation = [
    ...(!readiness.configured ? ['across_production_credentials'] : []),
    ...(!hasFreshQuote ? ['measured_bridge_quote', 'measured_bridge_liquidity', 'measured_bridge_transfer_time'] : []),
    ...(hasFreshQuote && quote.totalFeeUsd === null ? ['measured_bridge_total_fee'] : []),
    ...(hasFreshQuote && quote.originGasUsd === null ? ['measured_origin_gas_usd'] : []),
    ...(hasFreshQuote && quote.approvalTransactions > 0 ? ['measured_approval_gas_usd'] : []),
    ...(hasFreshQuote && quote.minOutputAmount === null ? ['guaranteed_minimum_output'] : []),
    ...(hasFreshQuote && !quote.simulationSuccess ? ['bridge_provider_simulation_success'] : []),
    ...(hasFreshQuote && !quote.swapTransactionPresent ? ['across_swap_transaction_payload'] : []),
    ...(!hasSigner ? ['cross_chain_signer'] : []),
    ...(inputPrice === null ? [`live_${route.inputAsset.toLowerCase()}_usd_price`] : []),
    ...(outputPrice === null ? [`live_${route.outputAsset.toLowerCase()}_usd_price`] : []),
    ...(economics && !deterministicPositive ? ['positive_guaranteed_cross_chain_net_after_origin_gas'] : []),
  ];

  return measuredCandidateRegistry.record({
    opportunityId,
    topology: 'CROSS_CHAIN',
    observedAt: now,
    expiresAt,
    status: routeExecutable ? 'eligible' : deterministicPositive ? 'deterministic_positive' : hasFreshQuote ? 'enriched' : 'observed',
    assets: [...new Set([route.inputAsset, route.outputAsset])],
    venues: hasFreshQuote ? ['across'] : [],
    chains: [route.from, route.to],
    rawQuotes: hasFreshQuote ? [{
      source: 'across', venue: 'across', chain: `${route.from}->${route.to}`,
      symbol: `${route.inputAsset}/${route.outputAsset}`, observedAt: quote.observedAt,
      amountIn: quote.inputAmount, amountOut: quote.minOutputAmount ?? quote.expectedOutputAmount,
      executable: routeExecutable,
      provenance: [
        ...bridgeQuoteProvenance(quote),
        'cross_chain_profit_output_authority:minimum_guaranteed_output',
        'cross_chain_input_output_prices:separately_live',
        approvalGasCanonical ? 'cross_chain_approval_gas:no_approval_transaction_required' : 'cross_chain_approval_gas:missing_from_canonical_pretrade_economics',
      ],
    }] : [],
    depth: hasFreshQuote
      ? { status: 'measured', detail: `Across returned a fresh simulated exact-input ${route.inputAsset}->${route.outputAsset} route for ${discoveryNotionalUsd()} source units; depth applies only to this exact quoted amount` }
      : { status: 'unavailable', detail: 'Across evidence acquisition was actively attempted for this route in the current cycle but no fresh authoritative quote was returned' },
    economics: {
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
      ? 'Across fresh simulated cross-swap has guaranteed minimum output whose independently marked USD value remains positive after separately paid origin gas, with no unpriced approval transaction; durable system-owned capital execution may revalidate immediately before signing'
      : deterministicPositive && hasFreshQuote && quote.approvalTransactions > 0
        ? 'Cross-chain economics are positive before approval gas, but Across requires approval transaction gas that is not yet included in canonical pre-trade economics'
        : deterministicPositive
          ? 'Cross-chain economics are deterministically positive, but a required execution capability fact is unavailable'
          : hasFreshQuote
            ? 'Across transport and any source/destination swap composition are measured, but this exact route is not deterministically positive after guaranteed output and origin gas'
            : readiness.configured
              ? 'Across evidence acquisition was attempted in the current cycle and returned no fresh authoritative executable quote; route remains in automatic reacquisition'
              : readiness.reason,
    missingInformation: [...new Set(missingInformation)],
    provenance: [
      `rpc:${route.from}:healthy`, `rpc:${route.to}:healthy`,
      ...(hasFreshQuote ? bridgeQuoteProvenance(quote) : ['across_quote:active_reacquisition_attempted_current_cycle']),
      `across_production_configured:${readiness.configured}`,
      `cross_chain_signer_configured:${hasSigner}`,
      `cross_chain_approval_gas_canonical:${approvalGasCanonical}`,
      `cross_chain_route:${route.inputAsset}->${route.outputAsset}`,
      'across_terminal_executor:refresh_exact_cross_swap_before_signing',
      'across_terminal_executor:minimum_output_drift_bound',
      'across_terminal_executor:destination_receipt_or_verified_refund',
      'cross_chain_profit_model:closed_usd_value',
      'cross_chain_profit_model:minimum_output_not_expected_output',
      'cross_chain_profit_model:separate_live_input_output_prices',
      'cross_chain_profit_model:origin_gas_subtracted_once',
      'cross_chain_profit_model:unpriced_approval_gas_blocks_execution',
      'cross_chain_route_formation:across_any_to_any_stablecoin_composition',
      'evidence_reacquisition:all_structural_routes_each_cycle_bounded_concurrency',
      'synthetic_evidence:false',
    ],
  });
}

export function getPreparedCrossChainRoute(opportunityId: string): { quote: AcrossBridgeQuote; economics: CrossChainRouteEconomics } | null {
  const prepared = preparedCrossChainQuotes.get(opportunityId) ?? null;
  if (!prepared) return null;
  if (prepared.quote.expiresAt <= Date.now() || prepared.quote.approvalTransactions > 0) {
    preparedCrossChainQuotes.delete(opportunityId);
    return null;
  }
  return prepared;
}

export async function discoverMeasuredCrossChainCandidates(): Promise<MeasuredCandidate[]> {
  await multiProviderRpcManager.initialize(CHAINS);
  const now = Date.now();
  const ttlMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_CANDIDATE_TTL_MS || 30_000));
  const routes = structuralRoutes();
  const notionalUsd = discoveryNotionalUsd();

  const [quotes, prices] = await Promise.all([
    acquireRouteQuotes(routes, notionalUsd),
    coinGeckoPriceClient.getLiveSymbolPrices([...ASSETS]).catch(() => new Map<string, number>()),
  ]);

  for (const [id, prepared] of preparedCrossChainQuotes.entries()) {
    if (prepared.quote.expiresAt <= now || prepared.quote.approvalTransactions > 0) preparedCrossChainQuotes.delete(id);
  }

  return routes.map(route => recordRoute(route, now, ttlMs, quotes.get(routeKey(route)) ?? null, prices));
}
