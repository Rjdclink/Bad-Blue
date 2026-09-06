import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { supportsSponsoredReceiverChain } from '../execution/adapters/sponsored-receiver-manager.js';
import { prepareZeroXAtomicRoundTrip } from '../execution/dex-zerox-atomic-executor.js';
import { getMeasuredErc20Decimals } from '../intelligence/erc20-decimals-authority.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import { inspectZeroXFeeEconomics } from '../intelligence/zerox-fee-economics.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

function executableDiscoveryChains(): ChainId[] {
  return (Object.keys(SUPPORTED_CHAINS) as ChainId[]).filter(chain => {
    const config = SUPPORTED_CHAINS[chain];
    return Boolean(config?.usdc && config?.usdt && supportsSponsoredReceiverChain(chain));
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

function quoteEvidence(quote: DexQuoteObservation, chain: ChainId) {
  const fees = inspectZeroXFeeEconomics(quote);
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

function isDiscoveryPriceEvidence(quote: DexQuoteObservation | null): quote is DexQuoteObservation {
  return !!quote
    && quote.quoteKind === 'price'
    && quote.executable === false
    && quote.transaction === undefined;
}

async function measuredGasUsd(chain: ChainId, quotes: DexQuoteObservation[]): Promise<number | null> {
  if (quotes.some(quote => !quote.estimatedGas || !/^\d+$/.test(quote.estimatedGas))) return null;
  const gas = await gasOracle.getGasPrice(chain).catch(() => null);
  if (!gas || !Number.isFinite(gas.usdCost) || gas.usdCost < 0) return null;
  const totalGasUnits = quotes.reduce((sum, quote) => sum + Number(quote.estimatedGas), 0);
  if (!Number.isFinite(totalGasUnits) || totalGasUnits <= 0) return null;
  return gas.usdCost * totalGasUnits / DEFAULT_GAS_LIMIT;
}

function firmHydrationBudget(): number {
  const configured = Number(process.env.CRYPTOCRAWL_DEX_FIRM_HYDRATION_BUDGET || 4);
  return Number.isFinite(configured) ? Math.max(1, Math.min(10, Math.trunc(configured))) : 4;
}

function missingDexCandidate(input: {
  chain: ChainId;
  notionalUsd: number;
  observedAt: number;
  ttlMs: number;
  opportunityId: string;
  first: DexQuoteObservation | null;
  second: DexQuoteObservation | null;
  missing: string[];
}): MeasuredCandidate {
  const rawQuotes = [input.first, input.second].filter((value): value is DexQuoteObservation => !!value);
  return measuredCandidateRegistry.record({
    opportunityId: input.opportunityId,
    topology: 'DEX_ATOMIC',
    observedAt: input.observedAt,
    expiresAt: input.observedAt + input.ttlMs,
    status: 'observed',
    assets: ['USDC', 'USDT'],
    venues: rawQuotes.length > 0 ? ['0x'] : [],
    chains: [input.chain],
    rawQuotes: rawQuotes.map(quote => quoteEvidence(quote, input.chain)),
    depth: { status: 'unavailable', detail: 'Required 0x round-trip evidence was actively requested in this cycle and will be reacquired on the next cycle if unavailable' },
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
    executionCapabilityReason: 'DEX atomic evidence acquisition is active; missing quote/liquidity facts remain retryable evidence and never become synthetic execution authority',
    missingInformation: [...new Set(input.missing)],
    provenance: [
      '0x:active_reacquisition_current_cycle',
      'dex_missing_evidence:retry_next_cycle',
      'missing_evidence_execution_authority:false',
      'synthetic_evidence:false',
    ],
  });
}

type IndicativeRoundTrip = {
  notionalUsd: number;
  observedAt: number;
  opportunityId: string;
  first: DexQuoteObservation;
  second: DexQuoteObservation;
  grossProfitUsd: number | null;
  discoveryGasUsd: number | null;
  grossAfterIndicativeGasBps: number | null;
  priceImpactBps: number;
};

async function discoverChainCandidates(
  chain: ChainId,
  notionals: readonly number[],
  ttlMs: number,
): Promise<MeasuredCandidate[]> {
  const config = SUPPORTED_CHAINS[chain];
  if (!config?.usdc || !config?.usdt || !supportsSponsoredReceiverChain(chain)) return [];
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

  const indicative: IndicativeRoundTrip[] = [];
  // Notionals remain sequential within one chain because each second leg depends
  // on the first leg's measured output. Chains still run in parallel.
  for (const notionalUsd of notionals) {
    const observedAt = Date.now();
    const opportunityId = `dex-0x-roundtrip:${chain}:USDC-USDT:${notionalUsd}:${observedAt}`;
    const first = await marketDataProviders.getDexQuote({
      chainId: config.chainId,
      sellToken: config.usdc,
      buyToken: config.usdt,
      sellAmount: stableUnits(notionalUsd, usdcDecimals),
      purpose: 'discovery',
    }).catch(() => null);
    if (!isDiscoveryPriceEvidence(first) || !first.liquidityAvailable || !first.buyAmount) {
      observed.push(missingDexCandidate({
        chain, notionalUsd, observedAt, ttlMs, opportunityId,
        first, second: null,
        missing: ['indicative_0x_first_leg_quote', 'measured_first_leg_liquidity'],
      }));
      continue;
    }

    const second = await marketDataProviders.getDexQuote({
      chainId: config.chainId,
      sellToken: config.usdt,
      buyToken: config.usdc,
      sellAmount: first.buyAmount,
      purpose: 'discovery',
    }).catch(() => null);
    if (!isDiscoveryPriceEvidence(second) || !second.liquidityAvailable || !second.buyAmount) {
      observed.push(missingDexCandidate({
        chain, notionalUsd, observedAt, ttlMs, opportunityId,
        first, second,
        missing: ['indicative_0x_second_leg_quote', 'measured_second_leg_liquidity'],
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

  // Hydrate the strongest measured indicative routes every cycle regardless of
  // whether they are already close to break-even. This removes the old fixed
  // negative-BPS gate that could leave DEX Atomic at N/A indefinitely while still
  // bounding firm quote/simulation pressure.
  const hydrationTargets = new Set(indicative
    .slice()
    .sort((left, right) => (right.grossAfterIndicativeGasBps ?? Number.NEGATIVE_INFINITY) - (left.grossAfterIndicativeGasBps ?? Number.NEGATIVE_INFINITY))
    .slice(0, firmHydrationBudget())
    .map(item => item.opportunityId));

  for (const item of indicative) {
    let prepared: Awaited<ReturnType<typeof prepareZeroXAtomicRoundTrip>> | null = null;
    let preparationUnavailable = false;
    if (hydrationTargets.has(item.opportunityId)) {
      try {
        prepared = await prepareZeroXAtomicRoundTrip({ opportunityId: item.opportunityId, chain, notionalUsd: item.notionalUsd });
      } catch {
        preparationUnavailable = true;
      }
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
    const missingInformation = prepared ? [
      ...(!explicitFeeTreatmentComplete ? ['complete_0x_explicit_fee_economic_treatment'] : []),
    ] : [
      'firm_0x_atomic_quote',
      'measured_balancer_flash_loan_fee',
      'exact_receiver_gas_cost',
      'receiver_permission_and_simulation_readiness',
      ...(hydrationTargets.has(item.opportunityId) && preparationUnavailable ? ['atomic_execution_preparation_currently_unavailable'] : []),
      ...(!hydrationTargets.has(item.opportunityId) ? ['firm_hydration_budget_deferred_this_cycle'] : []),
    ];
    const status = prepared && prepared.deterministicNetProfitUsd > 0 && explicitFeeTreatmentComplete
      ? 'eligible' as const
      : 'enriched' as const;

    observed.push(measuredCandidateRegistry.record({
      opportunityId: item.opportunityId,
      topology: 'DEX_ATOMIC',
      observedAt: item.observedAt,
      expiresAt: prepared ? Math.min(item.observedAt + ttlMs, prepared.expiresAt) : item.observedAt + ttlMs,
      status,
      assets: ['USDC', 'USDT'],
      venues: ['0x', ...(prepared ? ['balancer_v2'] : [])],
      chains: [chain],
      rawQuotes: prepared
        ? [quoteEvidence(item.first, chain), quoteEvidence(item.second, chain), quoteEvidence(prepared.firstQuote, chain), quoteEvidence(prepared.secondQuote, chain)]
        : [quoteEvidence(item.first, chain), quoteEvidence(item.second, chain)],
      depth: {
        status: 'measured',
        detail: prepared
          ? '0x indicative route plus two firm allowance-holder quotes, explicit fee treatment, existing receiver permissions, exact receiver simulation and exact gas estimation'
          : '0x /price liquidityAvailable round-trip measured; strongest routes are automatically promoted into bounded firm hydration every cycle',
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
        deterministicNetProfitUsd: null,
        feeUsd: null,
        gasUsd: item.discoveryGasUsd,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: Number.isFinite(item.priceImpactBps) ? item.priceImpactBps : null,
        notionalUsd: item.notionalUsd,
        grossProfitBps: item.grossProfitUsd !== null ? item.grossProfitUsd / item.notionalUsd * 10_000 : null,
        flashLoanFeeBps: null,
        gasCostBps: item.discoveryGasUsd !== null ? item.discoveryGasUsd / item.notionalUsd * 10_000 : null,
        allInCostBps: null,
        breakEvenBps: null,
        netProfitBps: null,
        bpsToBreakEven: item.grossAfterIndicativeGasBps !== null && item.grossAfterIndicativeGasBps < 0
          ? Math.abs(item.grossAfterIndicativeGasBps)
          : null,
      },
      quoteAgeMs,
      executableCapability: prepared !== null && explicitFeeTreatmentComplete,
      executionCapabilityReason: prepared && explicitFeeTreatmentComplete
        ? 'Two fresh 0x v2 firm quotes are atomically compiled into an already-verified Balancer receiver; 0x explicit fee effects are classified without double subtraction, current flash fee and exact receiver gas are measured, existing permissions are verified, and eth_call simulation succeeds'
        : prepared
          ? 'Firm 0x atomic preparation exists, but an explicit 0x fee component lacks a complete same-chain economic treatment and therefore cannot be promoted'
          : hydrationTargets.has(item.opportunityId)
            ? 'Firm DEX atomic hydration was actively attempted in this cycle and will be retried with fresh evidence; no fixed negative-BPS gate can permanently suppress measurement'
            : 'Indicative DEX round-trip is measured and remains eligible for adaptive firm-hydration scheduling; deferred budget is not a profitability veto',
      missingInformation,
      provenance: [
        '0x:price_only_discovery',
        `token_decimals:usdc:${usdcDecimals}`,
        `token_decimals:usdt:${usdtDecimals}`,
        'token_decimals:measured_onchain',
        ...(prepared ? prepared.provenance : ['0x:firm_execution_not_promoted']),
        ...(prepared ? ['0x:explicit_fee_object_inspected', '0x:embedded_fee_effect_already_in_quote_output', '0x:embedded_fee_double_count:false'] : []),
        hydrationTargets.has(item.opportunityId) ? 'firm_hydration:active_top_measured_route' : 'firm_hydration:bounded_deferred_retry',
        'firm_hydration:fixed_negative_bps_gate_removed',
        'gas_oracle:measured_when_available',
        'receiver_chain_capability:verified',
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
  const chains = executableDiscoveryChains();
  if (chains.length === 0) return [];

  const byChain = await Promise.all(
    chains.map(chain => discoverChainCandidates(chain, notionals, ttlMs)),
  );
  return byChain.flat();
}
