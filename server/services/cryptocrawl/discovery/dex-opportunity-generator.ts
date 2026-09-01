import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { supportsSponsoredReceiverChain } from '../execution/adapters/sponsored-receiver-manager.js';
import { prepareZeroXAtomicRoundTrip } from '../execution/dex-zerox-atomic-executor.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
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

function stableUnits(usd: number): string {
  return BigInt(Math.max(1, Math.floor(usd * 1_000_000))).toString();
}

function unitsToUsd(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw) / 1_000_000;
  return Number.isFinite(value) ? value : null;
}

function quoteEvidence(quote: DexQuoteObservation, chain: ChainId) {
  return {
    source: '0x',
    venue: '0x',
    chain,
    observedAt: quote.observedAt,
    amountIn: quote.sellAmount,
    amountOut: quote.buyAmount ?? null,
    price: quote.price ?? null,
    executable: quote.executable,
    provenance: ['0x', quote.quoteKind],
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

function firmHydrationFloorBps(): number {
  const configured = Number(process.env.CRYPTOCRAWL_DEX_FIRM_HYDRATION_FLOOR_BPS ?? -15);
  return Number.isFinite(configured) ? Math.max(-100, Math.min(0, configured)) : -15;
}

async function discoverChainCandidates(
  chain: ChainId,
  notionals: readonly number[],
  ttlMs: number,
): Promise<MeasuredCandidate[]> {
  const config = SUPPORTED_CHAINS[chain];
  if (!config?.usdc || !config?.usdt || !supportsSponsoredReceiverChain(chain)) return [];
  const observed: MeasuredCandidate[] = [];

  // Notionals remain sequential within one chain because the two-leg round trip
  // is dependent evidence and because preserving bounded provider pressure is
  // more important than maximizing burst concurrency inside one venue/chain.
  for (const notionalUsd of notionals) {
    const observedAt = Date.now();
    const first = await marketDataProviders.getDexQuote({
      chainId: config.chainId,
      sellToken: config.usdc,
      buyToken: config.usdt,
      sellAmount: stableUnits(notionalUsd),
      purpose: 'discovery',
    });
    if (!isDiscoveryPriceEvidence(first) || !first.liquidityAvailable || !first.buyAmount) continue;

    const second = await marketDataProviders.getDexQuote({
      chainId: config.chainId,
      sellToken: config.usdt,
      buyToken: config.usdc,
      sellAmount: first.buyAmount,
      purpose: 'discovery',
    });
    if (!isDiscoveryPriceEvidence(second) || !second.liquidityAvailable || !second.buyAmount) continue;

    const finalUsd = unitsToUsd(second.buyAmount);
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
    const opportunityId = `dex-0x-roundtrip:${chain}:USDC-USDT:${notionalUsd}:${observedAt}`;

    let prepared: Awaited<ReturnType<typeof prepareZeroXAtomicRoundTrip>> | null = null;
    let preparationUnavailable = false;
    // Near-profit firm hydration remains read-only: the preparation authority may
    // read firm quotes, receiver permissions, flash fee, gas and eth_call results,
    // but it cannot deploy or change permissions. Any missing infrastructure is
    // queued for the canonical scheduler's subordinate execution adapter.
    if (grossAfterIndicativeGasBps !== null && grossAfterIndicativeGasBps >= firmHydrationFloorBps()) {
      try {
        prepared = await prepareZeroXAtomicRoundTrip({ opportunityId, chain, notionalUsd });
      } catch {
        preparationUnavailable = true;
      }
    }

    const quoteAgeMs = prepared
      ? Date.now() - Math.min(prepared.firstQuote.observedAt, prepared.secondQuote.observedAt)
      : Date.now() - Math.min(first.observedAt, second.observedAt);
    const missingInformation = prepared ? [] : [
      'firm_0x_atomic_quote',
      'measured_balancer_flash_loan_fee',
      'exact_receiver_gas_cost',
      'receiver_permission_and_simulation_readiness',
      ...(preparationUnavailable ? ['atomic_execution_preparation_currently_unavailable'] : []),
    ];
    const status = prepared && prepared.deterministicNetProfitUsd > 0
      ? 'eligible' as const
      : 'enriched' as const;

    observed.push(measuredCandidateRegistry.record({
      opportunityId,
      topology: 'DEX_ATOMIC',
      observedAt,
      expiresAt: prepared ? Math.min(observedAt + ttlMs, prepared.expiresAt) : observedAt + ttlMs,
      status,
      assets: ['USDC', 'USDT'],
      venues: ['0x', ...(prepared ? ['balancer_v2'] : [])],
      chains: [chain],
      rawQuotes: prepared
        ? [quoteEvidence(first, chain), quoteEvidence(second, chain), quoteEvidence(prepared.firstQuote, chain), quoteEvidence(prepared.secondQuote, chain)]
        : [quoteEvidence(first, chain), quoteEvidence(second, chain)],
      depth: {
        status: first.liquidityAvailable && second.liquidityAvailable ? 'measured' : 'unavailable',
        detail: prepared
          ? '0x indicative route plus two firm allowance-holder quotes, existing receiver permissions, exact receiver simulation and exact gas estimation'
          : '0x /price liquidityAvailable/route response; pool-level depth and executable atomic settlement are not inferred',
      },
      economics: prepared ? {
        grossProfitUsd: prepared.grossProfitUsd,
        deterministicNetProfitUsd: prepared.deterministicNetProfitUsd,
        feeUsd: prepared.flashLoanFeeUsd,
        gasUsd: prepared.gasUsd,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: Number.isFinite(priceImpactBps) ? priceImpactBps : null,
        notionalUsd,
        grossProfitBps: prepared.grossProfitBps,
        flashLoanFeeBps: prepared.flashLoanFeeBps,
        gasCostBps: prepared.gasCostBps,
        allInCostBps: prepared.allInCostBps,
        breakEvenBps: prepared.allInCostBps,
        netProfitBps: prepared.netProfitBps,
        discoveryFloorBps: firmHydrationFloorBps(),
        bpsToBreakEven: 0,
      } : {
        grossProfitUsd,
        deterministicNetProfitUsd: null,
        feeUsd: null,
        gasUsd: discoveryGasUsd,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: Number.isFinite(priceImpactBps) ? priceImpactBps : null,
        notionalUsd,
        grossProfitBps: grossProfitUsd !== null ? grossProfitUsd / notionalUsd * 10_000 : null,
        flashLoanFeeBps: null,
        gasCostBps: discoveryGasUsd !== null ? discoveryGasUsd / notionalUsd * 10_000 : null,
        allInCostBps: null,
        breakEvenBps: null,
        netProfitBps: null,
        discoveryFloorBps: firmHydrationFloorBps(),
        bpsToBreakEven: grossAfterIndicativeGasBps !== null && grossAfterIndicativeGasBps < 0
          ? Math.abs(grossAfterIndicativeGasBps)
          : null,
      },
      quoteAgeMs,
      executableCapability: prepared !== null,
      executionCapabilityReason: prepared
        ? 'Two fresh 0x v2 firm quotes are atomically compiled into an already-verified Balancer receiver; current flash fee and exact receiver gas are measured, existing permissions are verified, and eth_call simulation succeeds'
        : 'Indicative DEX evidence remains non-executable until firm quotes, flash fee, existing receiver permissions, exact gas and atomic simulation are current',
      missingInformation,
      provenance: [
        '0x:price_only_discovery',
        ...(prepared ? prepared.provenance : ['0x:firm_execution_not_promoted']),
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

  // Only chains with both stablecoin identities and an actual reviewed/configured
  // Balancer receiver surface are scanned. This prevents structural dead lanes
  // such as a chain with no receiver vault from consuming 0x/provider budget.
  const byChain = await Promise.all(
    chains.map(chain => discoverChainCandidates(chain, notionals, ttlMs)),
  );
  return byChain.flat();
}