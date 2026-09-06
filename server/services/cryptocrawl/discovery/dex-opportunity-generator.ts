import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { measureBalancerFlashLoanEconomics } from '../execution/adapters/flash-loan-provider-economics.js';
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

  // Flash-provider fee/liquidity evidence is measured once per chain through the
  // canonical RPC mesh before route economics are formed. This lets every route
  // with two live 0x price legs carry numeric all-in observation BPS even when
  // receiver/execution hydration later proves the route non-executable.
  const balancerEvidence = await multiProviderRpcManager.execute(
    chain,
    'contract_calls',
    provider => measureBalancerFlashLoanEconomics({ chain, provider, asset: config.usdc }),
  ).then(result => result.result).catch(() => null);
  const observedFlashFeeBps = balancerEvidence?.feeBps !== null && balancerEvidence?.feeBps !== undefined && Number.isFinite(balancerEvidence.feeBps)
    ? Number(balancerEvidence.feeBps)
    : null;

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

  // Every route that has a complete indicative round-trip is hydrated into the
  // firm atomic path in the same discovery cycle. There is no budget-based class
  // of indefinitely half-measured routes. The structural candidate set itself is
  // bounded to at most ten notionals per chain, while chains execute in parallel.
  const hydrationTargets = new Set(indicative.map(item => item.opportunityId));

  for (const item of indicative) {
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
      ...((observedFlashFeeBps === null) ? ['required:measured_balancer_flash_loan_fee'] : []),
      ...((balancerEvidence?.availableLiquidity === null || balancerEvidence?.availableLiquidity === undefined) ? ['required:measured_balancer_flash_loan_liquidity'] : []),
      'required:exact_receiver_gas_cost',
      'required:receiver_permission_and_simulation_readiness',
      ...(preparationUnavailable ? ['required:atomic_execution_preparation_currently_unavailable'] : []),
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
      venues: ['0x', 'balancer_v2'],
      chains: [chain],
      rawQuotes: prepared
        ? [quoteEvidence(item.first, chain), quoteEvidence(item.second, chain), quoteEvidence(prepared.firstQuote, chain), quoteEvidence(prepared.secondQuote, chain)]
        : [quoteEvidence(item.first, chain), quoteEvidence(item.second, chain)],
      depth: {
        status: 'measured',
        detail: prepared
          ? '0x indicative route plus two firm allowance-holder quotes, explicit fee treatment, existing receiver permissions, exact receiver simulation and exact gas estimation'
          : '0x /price liquidityAvailable round-trip plus current Balancer fee/liquidity evidence measured; firm atomic hydration was attempted in the same cycle',
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
        ? 'Two fresh 0x v2 firm quotes are atomically compiled into an already-verified Balancer receiver; 0x explicit fee effects are classified without double subtraction, current flash fee and exact receiver gas are measured, existing permissions are verified, and eth_call simulation succeeds'
        : prepared
          ? 'Firm 0x atomic preparation exists, but an explicit 0x fee component lacks a complete same-chain economic treatment and therefore cannot be promoted'
          : 'Numeric observation BPS is preserved from live 0x route outputs plus measured Balancer fee and current gas evidence; every indicative route also receives same-cycle firm hydration, and only that firm minimum-sufficient proof may execute',
      missingInformation,
      provenance: [
        '0x:price_only_discovery',
        `token_decimals:usdc:${usdcDecimals}`,
        `token_decimals:usdt:${usdtDecimals}`,
        'token_decimals:measured_onchain',
        ...(prepared ? prepared.provenance : ['0x:firm_execution_not_promoted']),
        ...(prepared ? ['0x:explicit_fee_object_inspected', '0x:embedded_fee_effect_already_in_quote_output', '0x:embedded_fee_double_count:false'] : []),
        hydrationTargets.has(item.opportunityId) ? 'firm_hydration:all_measured_routes_same_cycle' : 'firm_hydration:invariant_violation',
        'firm_hydration:fixed_negative_bps_gate_removed',
        'firm_hydration:budget_defer_removed',
        ...(observedFlashFeeBps !== null ? ['balancer_v2:flash_fee_measured_onchain_for_observation_bps'] : ['balancer_v2:flash_fee_unavailable']),
        'dex_observation_bps:indicative_not_execution_authority',
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
