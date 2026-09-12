import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import {
  measureFlashLoanProviders,
  selectMeasuredFlashLoanProvider,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import { prepareZeroXAtomicRoundTrip } from '../execution/dex-zerox-atomic-executor.js';
import { getMeasuredErc20Decimals } from '../intelligence/erc20-decimals-authority.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import { inspectZeroXFeeEconomics } from '../intelligence/zerox-fee-economics.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

type IndicativeDexQuote = Omit<DexQuoteObservation, 'source'> & {
  source: '0x' | 'openocean';
};

function marketDataDiscoveryChains(): ChainId[] {
  return (Object.keys(SUPPORTED_CHAINS) as ChainId[]).filter(chain => {
    const config = SUPPORTED_CHAINS[chain];
    return Boolean(config?.usdc && config?.usdt);
  });
}

function boundedPositiveList(raw: string | undefined): number[] {
  const values = raw?.trim()
    ? raw.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0)
    : [25, 50, 100, 250, 500, 1000];
  return [...new Set(values)].sort((a, b) => a - b).slice(0, 10);
}

function stableUnits(usd: number, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Stablecoin decimals are unavailable');
  const micros = BigInt(Math.max(1, Math.round(usd * 1_000_000)));
  return (micros * (10n ** BigInt(decimals)) / 1_000_000n).toString();
}

function unitsToUsd(raw: string | undefined, decimals: number): number | null {
  if (!raw || !/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const value = Number(raw) / (10 ** decimals);
  return Number.isFinite(value) ? value : null;
}

function quoteEvidence(quote: IndicativeDexQuote, chain: ChainId) {
  if (quote.source === 'openocean') {
    return {
      source: 'openocean',
      venue: 'openocean',
      chain,
      observedAt: quote.observedAt,
      amountIn: quote.sellAmount,
      amountOut: quote.buyAmount ?? null,
      price: quote.price ?? null,
      executable: false,
      provenance: [
        'openocean:v4_quote',
        'openocean:quote_only_discovery',
        'openocean:estimated_gas_reference_only',
        'openocean:execution_authority:false',
        'synthetic_evidence:false',
      ],
    };
  }
  const fees = inspectZeroXFeeEconomics(quote as DexQuoteObservation);
  return {
    source: '0x',
    venue: '0x',
    chain,
    observedAt: quote.observedAt,
    amountIn: quote.sellAmount,
    amountOut: quote.buyAmount ?? null,
    price: quote.price ?? null,
    executable: quote.executable,
    provenance: [
      '0x',
      quote.quoteKind,
      `0x_explicit_fee_components:${fees.components.length}`,
      `0x_embedded_fee_components:${fees.embedded.length}`,
      `0x_external_native_fee_components:${fees.externalNative.length}`,
      `0x_unknown_fee_components:${fees.unknown.length}`,
      '0x_embedded_fee_double_count:false',
    ],
  };
}

function isDiscoveryPriceEvidence(quote: IndicativeDexQuote | null): quote is IndicativeDexQuote {
  return !!quote
    && quote.quoteKind === 'price'
    && quote.executable === false
    && quote.transaction === undefined;
}

function openOceanChainCode(chain: ChainId): string {
  if (chain === 'avalanche') return 'avax';
  return chain;
}

function percentToFraction(value: unknown): number | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const percent = Number(raw.replace(/%$/, ''));
  return Number.isFinite(percent) ? percent / 100 : undefined;
}

async function openOceanDiscoveryQuote(input: {
  chain: ChainId;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
}): Promise<IndicativeDexQuote | null> {
  try {
    const gas = await gasOracle.getGasPrice(input.chain);
    const gasPriceDecimals = BigInt(Math.max(1, Math.ceil(gas.gweiPrice * 1_000_000_000))).toString();
    const query = new URLSearchParams({
      inTokenAddress: input.sellToken,
      outTokenAddress: input.buyToken,
      amountDecimals: input.sellAmount,
      gasPriceDecimals,
    });
    const payload = await fetchJsonWithRetry<any>(
      `https://open-api.openocean.finance/v4/${openOceanChainCode(input.chain)}/quote?${query.toString()}`,
      { maxRetries: 1, baseDelayMs: 150, maxDelayMs: 500, timeoutMs: 2_500 },
    );
    const data = payload?.code === 200 ? payload?.data : null;
    const outAmount = typeof data?.outAmount === 'string' && /^\d+$/.test(data.outAmount) && BigInt(data.outAmount) > 0n
      ? data.outAmount
      : null;
    if (!outAmount) return null;
    const sellNumber = Number(input.sellAmount);
    const buyNumber = Number(outAmount);
    const estimatedGas = String(data?.estimatedGas ?? '').trim();
    return {
      chainId: input.chainId,
      sellToken: input.sellToken,
      buyToken: input.buyToken,
      sellAmount: input.sellAmount,
      buyAmount: outAmount,
      amountMode: 'exact_in',
      tradeSurplusRequested: false,
      price: Number.isFinite(sellNumber) && sellNumber > 0 && Number.isFinite(buyNumber) ? buyNumber / sellNumber : undefined,
      liquidityAvailable: true,
      priceImpact: percentToFraction(data?.price_impact),
      estimatedGas: /^\d+$/.test(estimatedGas) ? estimatedGas : undefined,
      gasPrice: gasPriceDecimals,
      quoteKind: 'price',
      executable: false,
      observedAt: Date.now(),
      source: 'openocean',
    };
  } catch {
    return null;
  }
}

async function firstPassDexQuote(input: {
  chain: ChainId;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
}): Promise<IndicativeDexQuote | null> {
  const zeroX = await marketDataProviders.getDexQuote({
    chainId: input.chainId,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: input.sellAmount,
    purpose: 'discovery',
  }).catch(() => null);
  if (isDiscoveryPriceEvidence(zeroX)) return zeroX;
  return openOceanDiscoveryQuote(input);
}

async function measuredGasUsd(chain: ChainId, quotes: IndicativeDexQuote[]): Promise<number | null> {
  if (quotes.some(quote => !quote.estimatedGas || !/^\d+$/.test(quote.estimatedGas))) return null;
  const gas = await gasOracle.getGasPrice(chain).catch(() => null);
  if (!gas || !Number.isFinite(gas.usdCost) || gas.usdCost < 0) return null;
  const totalGasUnits = quotes.reduce((sum, quote) => sum + Number(quote.estimatedGas), 0);
  if (!Number.isFinite(totalGasUnits) || totalGasUnits <= 0) return null;
  return gas.usdCost * totalGasUnits / DEFAULT_GAS_LIMIT;
}

function missingDexCandidate(input: {
  chain: ChainId;
  notionalUsd: number;
  observedAt: number;
  ttlMs: number;
  opportunityId: string;
  first: IndicativeDexQuote | null;
  second: IndicativeDexQuote | null;
  missing: string[];
}): MeasuredCandidate {
  const rawQuotes = [input.first, input.second].filter((value): value is IndicativeDexQuote => !!value);
  return measuredCandidateRegistry.record({
    opportunityId: input.opportunityId,
    topology: 'DEX_ATOMIC',
    observedAt: input.observedAt,
    expiresAt: input.observedAt + input.ttlMs,
    status: 'observed',
    assets: ['USDC', 'USDT'],
    venues: [...new Set(rawQuotes.map(quote => quote.source))],
    chains: [input.chain],
    rawQuotes: rawQuotes.map(quote => quoteEvidence(quote, input.chain)),
    depth: { status: 'unavailable', detail: 'All configured first-pass evidence acquisition paths were attempted in this cycle; this observation remains explicit and cannot silently disappear' },
    economics: {
      grossProfitUsd: null,
      deterministicNetProfitUsd: null,
      feeUsd: null,
      gasUsd: null,
      bridgeUsd: 0,
      expectedSlippageBps: null,
      expectedPriceImpactBps: null,
      notionalUsd: input.notionalUsd,
      grossProfitBps: null,
      flashLoanFeeBps: null,
      gasCostBps: null,
      allInCostBps: null,
      breakEvenBps: null,
      netProfitBps: null,
      bpsToBreakEven: null,
    },
    quoteAgeMs: rawQuotes.length > 0 ? Math.max(0, Date.now() - Math.min(...rawQuotes.map(quote => quote.observedAt))) : null,
    executableCapability: false,
    executionCapabilityReason: 'DEX atomic first-pass evidence acquisition exhausted its configured authoritative paths without enough route facts for safe deterministic execution; the observation stays visible and never gains synthetic authority',
    missingInformation: [...new Set(input.missing.map(item => `required:${item}`))],
    provenance: [
      '0x:first_pass_redundant_credential_and_http_retry_acquisition',
      'openocean:v4_quote_route_local_fallback_attempted',
      'dex_missing_evidence:explicit_observation_retained',
      'missing_evidence_execution_authority:false',
      'synthetic_evidence:false',
    ],
  });
}

type IndicativeRoundTrip = {
  notionalUsd: number;
  observedAt: number;
  opportunityId: string;
  first: IndicativeDexQuote;
  second: IndicativeDexQuote;
  grossProfitUsd: number | null;
  discoveryGasUsd: number | null;
  grossAfterIndicativeGasBps: number | null;
  priceImpactBps: number;
};

async function measureChainFlashProviders(
  chain: ChainId,
  asset: string,
): Promise<FlashLoanProviderEconomics[]> {
  try {
    await multiProviderRpcManager.initialize([chain]);
    const { http: provider } = await multiProviderRpcManager.getProvider(chain, 'json_rpc');
    return await measureFlashLoanProviders({ chain: chain as any, provider, asset });
  } catch {
    return [];
  }
}

async function discoverChainCandidates(
  chain: ChainId,
  notionals: readonly number[],
  ttlMs: number,
): Promise<MeasuredCandidate[]> {
  const config = SUPPORTED_CHAINS[chain];
  if (!config?.usdc || !config?.usdt) return [];
  const observed: MeasuredCandidate[] = [];

  let usdcDecimals: number;
  let usdtDecimals: number;
  try {
    [usdcDecimals, usdtDecimals] = await Promise.all([
      getMeasuredErc20Decimals(chain, config.usdc),
      getMeasuredErc20Decimals(chain, config.usdt),
    ]);
  } catch {
    const now = Date.now();
    return notionals.map(notionalUsd => missingDexCandidate({
      chain,
      notionalUsd,
      observedAt: now,
      ttlMs,
      opportunityId: `dex-0x-roundtrip:${chain}:USDC-USDT:${notionalUsd}:${now}`,
      first: null,
      second: null,
      missing: ['measured_usdc_decimals', 'measured_usdt_decimals'],
    }));
  }

  const flashProviderEvidence = await measureChainFlashProviders(chain, config.usdc);

  const indicative: IndicativeRoundTrip[] = [];
  for (const notionalUsd of notionals) {
    const observedAt = Date.now();
    const opportunityId = `dex-0x-roundtrip:${chain}:USDC-USDT:${notionalUsd}:${observedAt}`;
    const first = await firstPassDexQuote({
      chain,
      chainId: config.chainId,
      sellToken: config.usdc,
      buyToken: config.usdt,
      sellAmount: stableUnits(notionalUsd, usdcDecimals),
    });
    if (!isDiscoveryPriceEvidence(first) || !first.liquidityAvailable || !first.buyAmount) {
      observed.push(missingDexCandidate({
        chain, notionalUsd, observedAt, ttlMs, opportunityId,
        first, second: null,
        missing: ['indicative_dex_first_leg_quote', 'measured_first_leg_liquidity'],
      }));
      continue;
    }

    const second = await firstPassDexQuote({
      chain,
      chainId: config.chainId,
      sellToken: config.usdt,
      buyToken: config.usdc,
      sellAmount: first.buyAmount,
    });
    if (!isDiscoveryPriceEvidence(second) || !second.liquidityAvailable || !second.buyAmount) {
      observed.push(missingDexCandidate({
        chain, notionalUsd, observedAt, ttlMs, opportunityId,
        first, second,
        missing: ['indicative_dex_second_leg_quote', 'measured_second_leg_liquidity'],
      }));
      continue;
    }

    const finalUsd = unitsToUsd(second.buyAmount, usdcDecimals);
    const grossProfitUsd = finalUsd === null ? null : finalUsd - notionalUsd;
    const discoveryGasUsd = await measuredGasUsd(chain, [first, second]);
    const grossAfterIndicativeGasUsd = grossProfitUsd !== null && discoveryGasUsd !== null
      ? grossProfitUsd - discoveryGasUsd
      : null;
    const grossAfterIndicativeGasBps = grossAfterIndicativeGasUsd !== null
      ? grossAfterIndicativeGasUsd / notionalUsd * 10_000
      : null;
    const priceImpactBps = [first.priceImpact, second.priceImpact]
      .filter((value): value is number => Number.isFinite(value))
      .reduce((sum, value) => sum + Math.abs(value) * 10_000, 0);
    indicative.push({
      notionalUsd, observedAt, opportunityId, first, second, grossProfitUsd,
      discoveryGasUsd, grossAfterIndicativeGasBps, priceImpactBps,
    });
  }

  const hydrationTargets = new Set(indicative.map(item => item.opportunityId));

  for (const item of indicative) {
    const requestedAmount = BigInt(stableUnits(item.notionalUsd, usdcDecimals));
    const observationProvider = selectMeasuredFlashLoanProvider(flashProviderEvidence, requestedAmount);
    const observedFlashFeeBps = observationProvider?.feeBps ?? null;
    let prepared: Awaited<ReturnType<typeof prepareZeroXAtomicRoundTrip>> | null = null;
    let preparationUnavailable = false;
    try {
      prepared = await prepareZeroXAtomicRoundTrip({ opportunityId: item.opportunityId, chain, notionalUsd: item.notionalUsd });
    } catch {
      preparationUnavailable = true;
    }

    const preparedFeeEvidence = prepared
      ? [inspectZeroXFeeEconomics(prepared.firstQuote), inspectZeroXFeeEconomics(prepared.secondQuote)]
      : [];
    const explicitFeeTreatmentComplete = prepared
      ? preparedFeeEvidence.every(evidence => evidence.completeForSameChainAllowanceHolder)
      : false;
    const quoteAgeMs = prepared
      ? Date.now() - Math.min(prepared.firstQuote.observedAt, prepared.secondQuote.observedAt)
      : Date.now() - Math.min(item.first.observedAt, item.second.observedAt);

    const observationGrossBps = item.grossProfitUsd !== null
      ? item.grossProfitUsd / item.notionalUsd * 10_000
      : null;
    const observationGasBps = item.discoveryGasUsd !== null
      ? item.discoveryGasUsd / item.notionalUsd * 10_000
      : null;
    const observationAllInCostBps = observedFlashFeeBps !== null && observationGasBps !== null
      ? observedFlashFeeBps + observationGasBps
      : null;
    const observationNetBps = observationGrossBps !== null && observationAllInCostBps !== null
      ? observationGrossBps - observationAllInCostBps
      : null;
    const observationNetProfitUsd = observationNetBps !== null
      ? observationNetBps / 10_000 * item.notionalUsd
      : null;

    const missingInformation = prepared ? [
      ...(!explicitFeeTreatmentComplete ? ['required:complete_0x_explicit_fee_economic_treatment'] : []),
    ] : [
      'required:firm_0x_atomic_quote',
      ...(!observationProvider ? ['required:measured_compatible_flash_loan_fee', 'required:measured_compatible_flash_loan_liquidity'] : []),
      'required:exact_receiver_gas_cost',
      'required:receiver_permission_readiness',
      ...(preparationUnavailable ? ['required:atomic_execution_preparation_currently_unavailable'] : []),
    ];
    const status = prepared && prepared.deterministicNetProfitUsd > 0 && explicitFeeTreatmentComplete
      ? 'eligible' as const
      : 'enriched' as const;
    const discoveryVenues = [...new Set([
      item.first.source,
      item.second.source,
      ...(observationProvider ? [observationProvider.provider] : []),
    ])];

    observed.push(measuredCandidateRegistry.record({
      opportunityId: item.opportunityId,
      topology: 'DEX_ATOMIC',
      observedAt: item.observedAt,
      expiresAt: prepared ? Math.min(item.observedAt + ttlMs, prepared.expiresAt) : item.observedAt + ttlMs,
      status,
      assets: ['USDC', 'USDT'],
      venues: discoveryVenues,
      chains: [chain],
      rawQuotes: prepared
        ? [quoteEvidence(item.first, chain), quoteEvidence(item.second, chain), quoteEvidence(prepared.firstQuote, chain), quoteEvidence(prepared.secondQuote, chain)]
        : [quoteEvidence(item.first, chain), quoteEvidence(item.second, chain)],
      depth: {
        status: 'measured',
        detail: prepared
          ? `Indicative DEX route plus two firm 0x allowance-holder quotes, explicit fee treatment, verified ${prepared.flashLoanProvider} receiver permissions, and exact gas estimation`
          : observationProvider
            ? `Independent quote-only DEX round-trip plus exact-liquidity ${observationProvider.provider} fee evidence measured without granting execution authority; firm atomic hydration remains required`
            : 'Independent quote-only DEX round-trip measured without a compatible complete flash-provider funding proof; discovery remains visible while provider evidence is reacquired',
      },
      economics: prepared ? {
        grossProfitUsd: prepared.grossProfitUsd,
        deterministicNetProfitUsd: prepared.deterministicNetProfitUsd,
        feeUsd: null,
        gasUsd: prepared.gasUsd,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: Number.isFinite(item.priceImpactBps) ? item.priceImpactBps : null,
        notionalUsd: item.notionalUsd,
        grossProfitBps: prepared.grossProfitBps,
        flashLoanFeeBps: prepared.flashLoanFeeBps,
        gasCostBps: prepared.gasCostBps,
        allInCostBps: prepared.allInCostBps,
        breakEvenBps: prepared.allInCostBps,
        netProfitBps: prepared.netProfitBps,
        bpsToBreakEven: Math.max(0, -prepared.netProfitBps),
      } : {
        grossProfitUsd: item.grossProfitUsd,
        deterministicNetProfitUsd: observationNetProfitUsd,
        feeUsd: null,
        gasUsd: item.discoveryGasUsd,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: Number.isFinite(item.priceImpactBps) ? item.priceImpactBps : null,
        notionalUsd: item.notionalUsd,
        grossProfitBps: observationGrossBps,
        flashLoanFeeBps: observedFlashFeeBps,
        gasCostBps: observationGasBps,
        allInCostBps: observationAllInCostBps,
        breakEvenBps: observationAllInCostBps,
        netProfitBps: observationNetBps,
        bpsToBreakEven: observationNetBps !== null && observationNetBps < 0 ? Math.abs(observationNetBps) : 0,
      },
      quoteAgeMs,
      executableCapability: prepared !== null && explicitFeeTreatmentComplete,
      executionCapabilityReason: prepared && explicitFeeTreatmentComplete
        ? `Two fresh 0x v2 firm quotes are atomically compiled into a verified ${prepared.flashLoanProvider} receiver; explicit fee effects, current flash fee, exact receiver gas, permissions, and exact provider liquidity are measured without double subtraction`
        : prepared
          ? 'Firm 0x atomic preparation exists, but an explicit 0x fee component lacks a complete same-chain economic treatment and therefore cannot be promoted'
          : observationProvider
            ? `Numeric observation BPS is preserved from live DEX route outputs plus measured ${observationProvider.provider} fee/current gas while firm provider-bound execution hydration remains temporarily unavailable`
            : 'DEX market discovery remains active and visible while compatible flash-provider fee/liquidity evidence is reacquired; no unknown fee is treated as zero',
      missingInformation,
      provenance: [
        `${item.first.source}:price_only_discovery`,
        `${item.second.source}:price_only_discovery`,
        `token_decimals:usdc:${usdcDecimals}`,
        `token_decimals:usdt:${usdtDecimals}`,
        'token_decimals:measured_onchain',
        ...(prepared ? prepared.provenance : ['0x:firm_execution_not_promoted']),
        ...(prepared ? ['0x:explicit_fee_object_inspected', '0x:embedded_fee_effect_already_in_quote_output', '0x:embedded_fee_double_count:false'] : []),
        hydrationTargets.has(item.opportunityId) ? 'firm_hydration:all_measured_routes_same_cycle' : 'firm_hydration:invariant_violation',
        'firm_hydration:fixed_negative_bps_gate_removed',
        'firm_hydration:budget_defer_removed',
        ...(observationProvider
          ? [`flash_loan_provider:${observationProvider.provider}`, 'flash_loan_provider:exact_liquidity_and_fee_measured_for_observation_bps']
          : ['flash_loan_provider:no_complete_compatible_evidence_unknown_fee_not_zero']),
        'dex_observation_bps:indicative_not_execution_authority',
        'gas_oracle:measured_when_available',
        item.first.source === 'openocean' || item.second.source === 'openocean'
          ? 'dex_discovery_fallback:openocean_v4_current_quote'
          : 'dex_discovery_primary:0x_v2_price',
        'dex_discovery_provider_failure:route_local',
        prepared ? 'provider_receiver_capability:verified' : 'provider_receiver_capability:hydration_pending_discovery_continues',
        'discovery_infrastructure_mutation:false',
        'unknown_flash_fee_is_not_zero',
        'synthetic_evidence:false',
      ],
    }));
  }

  return observed;
}

export async function discoverMeasuredDexCandidates(): Promise<MeasuredCandidate[]> {
  const ttlMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
  const notionals = boundedPositiveList(process.env.CRYPTOCRAWL_DEX_NOTIONAL_USD);
  const chains = marketDataDiscoveryChains();
  if (chains.length === 0) return [];

  const byChain = await Promise.all(
    chains.map(chain => discoverChainCandidates(chain, notionals, ttlMs)),
  );
  return byChain.flat();
}