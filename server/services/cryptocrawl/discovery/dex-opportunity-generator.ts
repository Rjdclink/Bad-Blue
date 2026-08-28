import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

const DISCOVERY_CHAINS: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];

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

async function measuredGasUsd(chain: ChainId, quotes: DexQuoteObservation[]): Promise<number | null> {
  if (quotes.some(quote => !quote.estimatedGas || !/^\d+$/.test(quote.estimatedGas))) return null;
  const gas = await gasOracle.getGasPrice(chain).catch(() => null);
  if (!gas || !Number.isFinite(gas.usdCost) || gas.usdCost < 0) return null;
  const totalGasUnits = quotes.reduce((sum, quote) => sum + Number(quote.estimatedGas), 0);
  if (!Number.isFinite(totalGasUnits) || totalGasUnits <= 0) return null;
  return gas.usdCost * totalGasUnits / DEFAULT_GAS_LIMIT;
}

export async function discoverMeasuredDexCandidates(): Promise<MeasuredCandidate[]> {
  const observed: MeasuredCandidate[] = [];
  const taker = process.env.ZEROX_TAKER_ADDRESS?.trim();
  const ttlMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));

  for (const chain of DISCOVERY_CHAINS) {
    const config = SUPPORTED_CHAINS[chain];
    if (!config?.usdc || !config?.usdt) continue;
    for (const notionalUsd of boundedPositiveList(process.env.CRYPTOCRAWL_DEX_NOTIONAL_USD)) {
      const observedAt = Date.now();
      const first = await marketDataProviders.getDexQuote({
        chainId: config.chainId,
        sellToken: config.usdc,
        buyToken: config.usdt,
        sellAmount: stableUnits(notionalUsd),
        takerAddress: taker,
      });
      if (!first?.liquidityAvailable || !first.buyAmount) continue;
      const second = await marketDataProviders.getDexQuote({
        chainId: config.chainId,
        sellToken: config.usdt,
        buyToken: config.usdc,
        sellAmount: first.buyAmount,
        takerAddress: taker,
      });
      if (!second?.liquidityAvailable || !second.buyAmount) continue;

      const finalUsd = unitsToUsd(second.buyAmount);
      const grossProfitUsd = finalUsd === null ? null : finalUsd - notionalUsd;
      const gasUsd = await measuredGasUsd(chain, [first, second]);
      const deterministicNetProfitUsd = grossProfitUsd !== null && gasUsd !== null
        ? grossProfitUsd - gasUsd
        : null;
      const priceImpactBps = [first.priceImpact, second.priceImpact]
        .filter((value): value is number => Number.isFinite(value))
        .reduce((sum, value) => sum + Math.abs(value) * 10_000, 0);
      const quoteAgeMs = Date.now() - Math.min(first.observedAt, second.observedAt);
      const opportunityId = `dex-0x-roundtrip:${chain}:USDC-USDT:${notionalUsd}:${observedAt}`;
      const missingInformation = [
        ...(gasUsd === null ? ['measured_gas_cost'] : []),
        // Current receiver/payload builders cannot atomically compose two 0x
        // allowance-holder transactions. Discovery remains useful, execution does
        // not become authorized merely because 0x returned transaction payloads.
        'atomic_0x_roundtrip_execution_adapter',
      ];
      const status = deterministicNetProfitUsd !== null && deterministicNetProfitUsd > 0
        ? 'deterministic_positive' as const
        : deterministicNetProfitUsd !== null
          ? 'blocked' as const
          : 'enriched' as const;
      observed.push(measuredCandidateRegistry.record({
        opportunityId,
        topology: 'DEX_ATOMIC',
        observedAt,
        expiresAt: observedAt + ttlMs,
        status,
        assets: ['USDC', 'USDT'],
        venues: ['0x'],
        chains: [chain],
        rawQuotes: [quoteEvidence(first, chain), quoteEvidence(second, chain)],
        depth: {
          status: first.liquidityAvailable && second.liquidityAvailable ? 'measured' : 'unavailable',
          detail: '0x liquidityAvailable/route response; pool-level depth is not inferred',
        },
        economics: {
          grossProfitUsd,
          deterministicNetProfitUsd,
          feeUsd: null,
          gasUsd,
          bridgeUsd: 0,
          expectedSlippageBps: null,
          expectedPriceImpactBps: Number.isFinite(priceImpactBps) ? priceImpactBps : null,
        },
        quoteAgeMs,
        executableCapability: false,
        executionCapabilityReason: 'Measured 0x round-trip discovery exists, but the flash-loan receiver/payload authority does not atomically compose 0x allowance-holder calls',
        missingInformation,
        provenance: ['0x:measured_roundtrip', 'gas_oracle:measured_when_available', 'synthetic_evidence:false'],
      }));
    }
  }

  return observed;
}
