import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { discoverGraphlessDexTokens } from '../discovery/graphless-dex-scout.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { buildMissingReceiverPermissionCalls } from '../execution/adapters/flash-loan-receiver-capability.js';
import { zeroCapitalDiscoveryFloorBps } from '../execution/adapters/onchain-route-quoter.js';
import type { ReceiverFundingMode } from '../execution/adapters/sponsored-receiver-manager.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';

const installed = new WeakSet<object>();
const cursors = new Map<string, number>();
const SUPPORTED_ZEROX_CHAINS = new Set<ChainId>(['polygon', 'arbitrum', 'avalanche', 'bsc']);

type Runtime = {
  scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
  executionEnabled: boolean;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  getGasFundingDecision: (chain: SupportedChain) => Promise<GasFundingDecision>;
  executeSetupCalls: (
    chain: any,
    provider: providers.JsonRpcProvider,
    wallet: Wallet,
    fundingMode: ReceiverFundingMode,
    calls: any[],
  ) => Promise<void>;
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function notionalsUsd(): number[] {
  const raw = process.env.ZEROX_ATOMIC_DISCOVERY_NOTIONAL_USD?.trim();
  const values = raw
    ? raw.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0)
    : [25, 50, 100, 250, 500, 1000];
  return [...new Set(values)].sort((a, b) => a - b).slice(0, 12);
}

function selectedTokens<T>(chain: SupportedChain, candidates: readonly T[]): T[] {
  if (candidates.length === 0) return [];
  const budget = Math.floor(bounded(process.env.ZEROX_ATOMIC_TOKEN_BUDGET_PER_CHAIN, 8, 2, 32));
  const exploitation = Math.max(1, Math.floor(budget / 2));
  const selected = candidates.slice(0, Math.min(exploitation, candidates.length));
  const key = String(chain);
  const cursor = cursors.get(key) || 0;
  for (let offset = 0; selected.length < Math.min(budget, candidates.length) && offset < candidates.length; offset += 1) {
    const candidate = candidates[(cursor + offset) % candidates.length];
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  cursors.set(key, (cursor + Math.max(1, budget - exploitation)) % candidates.length);
  return selected;
}

function stableUnits(usd: number): string {
  return BigInt(Math.max(1, Math.floor(usd * 1_000_000))).toString();
}

function bigintOrNull(raw: string | undefined): bigint | null {
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

async function gasCostBaseUnits(chain: ChainId, quotes: DexQuoteObservation[]): Promise<bigint | null> {
  const quotedGas = quotes.map(quote => bigintOrNull(quote.estimatedGas));
  if (quotedGas.some(value => value === null)) return null;
  const gas = await gasOracle.getGasPrice(chain).catch(() => null);
  if (!gas || !Number.isFinite(gas.usdCost) || gas.usdCost < 0) return null;
  const overhead = BigInt(Math.floor(bounded(process.env.ZEROX_ATOMIC_FLASHLOAN_OVERHEAD_GAS_UNITS, 350_000, 100_000, 2_000_000)));
  const totalUnits = quotedGas.reduce<bigint>((sum, value) => sum + (value || 0n), overhead);
  const gasUsd = gas.usdCost * Number(totalUnits) / DEFAULT_GAS_LIMIT;
  if (!Number.isFinite(gasUsd) || gasUsd < 0) return null;
  return BigInt(Math.ceil(gasUsd * 1_000_000));
}

function quoteEvidence(quote: DexQuoteObservation, chain: SupportedChain) {
  return {
    source: '0x',
    venue: '0x',
    chain,
    observedAt: quote.observedAt,
    amountIn: quote.sellAmount,
    amountOut: quote.buyAmount ?? null,
    price: quote.price ?? null,
    executable: false,
    provenance: ['0x:allowance_holder:price', quote.quoteKind],
  };
}

async function discoverZeroXChain(
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
): Promise<ZeroCapitalOpportunity[]> {
  if (!SUPPORTED_ZEROX_CHAINS.has(chain as ChainId)) return [];
  const config = SUPPORTED_CHAINS[chain as ChainId];
  if (!config?.usdc || !config?.usdt) return [];
  const scout = await discoverGraphlessDexTokens(chain as any, provider, [config.usdc, config.usdt]);
  const tokens = selectedTokens(chain, scout.candidates);
  const notionals = notionalsUsd();
  if (tokens.length === 0 || notionals.length === 0) return [];

  const cursor = cursors.get(`${chain}:notional`) || 0;
  const notionalUsd = notionals[cursor % notionals.length];
  cursors.set(`${chain}:notional`, (cursor + 1) % notionals.length);
  const ttlMs = Math.floor(bounded(process.env.ZEROX_ATOMIC_DISCOVERY_TTL_MS, 2_000, 500, 5_000));
  const floorBps = zeroCapitalDiscoveryFloorBps();
  const opportunities: ZeroCapitalOpportunity[] = [];

  const inputs = [
    { symbol: 'USDC' as const, token: config.usdc },
    { symbol: 'USDT' as const, token: config.usdt },
  ];
  const jobs = tokens.flatMap(candidate => inputs.map(input => ({ candidate, input })));
  const results = await Promise.allSettled(jobs.map(async ({ candidate, input }) => {
    if (candidate.token.toLowerCase() === input.token.toLowerCase()) return null;
    const observedAt = Date.now();
    const sellAmount = stableUnits(notionalUsd);
    const first = await marketDataProviders.getDexQuote({
      chainId: config.chainId,
      sellToken: input.token,
      buyToken: candidate.token,
      sellAmount,
      purpose: 'discovery',
    });
    if (!first || first.quoteKind !== 'price' || !first.liquidityAvailable || !first.buyAmount) return null;
    const second = await marketDataProviders.getDexQuote({
      chainId: config.chainId,
      sellToken: candidate.token,
      buyToken: input.token,
      sellAmount: first.buyAmount,
      purpose: 'discovery',
    });
    if (!second || second.quoteKind !== 'price' || !second.liquidityAvailable || !second.buyAmount) return null;

    const finalAmount = bigintOrNull(second.buyAmount);
    const principal = BigInt(sellAmount);
    if (finalAmount === null) return null;
    const gasCost = await gasCostBaseUnits(chain as ChainId, [first, second]);
    if (gasCost === null) return null;
    const grossProfit = finalAmount - principal;
    const preliminaryNet = grossProfit - gasCost;
    const netBps = principal > 0n ? Number((preliminaryNet * 10_000n) / principal) : Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(netBps) || netBps < floorBps) return null;

    const opportunity: ZeroCapitalOpportunity = {
      id: `zerox-atomic:${chain}:${input.symbol}:${candidate.token.toLowerCase()}:${notionalUsd}:${observedAt}`,
      type: 'arbitrage',
      chain,
      inputToken: input.token,
      outputToken: input.token,
      inputAssetSymbol: input.symbol,
      inputTokenDecimals: 6,
      flashLoanAmount: principal,
      expectedProfit: preliminaryNet,
      grossProfit,
      gasEstimate: 0n,
      estimatedExecutionCostInInputToken: gasCost,
      estimatedGasCostInInputToken: gasCost,
      flashLoanFeeInInputToken: 0n,
      relayFeeInInputToken: 0n,
      expectedSlippageBps: 0,
      quoteLatencyMs: Date.now() - observedAt,
      netProfitBps: netBps,
      route: [
        {
          protocol: 'zeroxAllowanceHolder',
          tokenIn: input.token,
          tokenOut: candidate.token,
          amountIn: principal,
          expectedAmountOut: BigInt(first.buyAmount),
          fee: 0,
        },
        {
          protocol: 'zeroxAllowanceHolder',
          tokenIn: candidate.token,
          tokenOut: input.token,
          amountIn: BigInt(first.buyAmount),
          expectedAmountOut: finalAmount,
          fee: 0,
        },
      ],
      confidence: candidate.liquidityUsd === null ? 0.55 : Math.max(0.55, Math.min(0.95, 0.55 + Math.log10(Math.max(1, candidate.liquidityUsd)) / 20)),
      timestamp: observedAt,
      expiresAt: observedAt + ttlMs,
    };

    measuredCandidateRegistry.record({
      opportunityId: opportunity.id,
      topology: 'ZERO_CAPITAL_ATOMIC',
      observedAt,
      expiresAt: opportunity.expiresAt,
      status: preliminaryNet > 0n ? 'deterministic_positive' : 'enriched',
      assets: [input.symbol, candidate.token],
      venues: ['0x'],
      chains: [chain],
      rawQuotes: [quoteEvidence(first, chain), quoteEvidence(second, chain)],
      depth: {
        status: 'measured',
        detail: `0x price route retained from graphless token scout; scout liquidityUsd=${candidate.liquidityUsd ?? 'unknown'}`,
      },
      economics: {
        grossProfitUsd: Number(grossProfit) / 1_000_000,
        deterministicNetProfitUsd: Number(preliminaryNet) / 1_000_000,
        feeUsd: 0,
        gasUsd: Number(gasCost) / 1_000_000,
        bridgeUsd: 0,
        expectedSlippageBps: null,
        expectedPriceImpactBps: [first.priceImpact, second.priceImpact]
          .filter((value): value is number => Number.isFinite(value))
          .reduce((sum, value) => sum + Math.abs(value) * 10_000, 0),
        notionalUsd,
        grossProfitBps: principal > 0n ? Number((grossProfit * 10_000n) / principal) : null,
        flashLoanFeeBps: null,
        gasCostBps: principal > 0n ? Number((gasCost * 10_000n) / principal) : null,
        relayCostBps: 0,
        allInCostBps: null,
        breakEvenBps: null,
        netProfitBps: netBps,
        discoveryFloorBps: floorBps,
        bpsToBreakEven: netBps >= 0 ? 0 : Math.abs(netBps),
        realizedNetProfitBps: null,
      },
      quoteAgeMs: opportunity.quoteLatencyMs,
      executableCapability: true,
      executionCapabilityReason: '0x AllowanceHolder atomic adapter exists; provider-bound firm quotes and exact flash-loan simulation are still required before queue admission',
      missingInformation: [],
      provenance: [
        'graphless_dynamic_token_surface',
        '0x:aggregated_liquidity:price_only_preselection',
        'measured_preliminary_gas',
        'provider_bound_firm_quote_required',
        'exact_receiver_simulation_required',
        'synthetic_evidence:false',
      ],
    });
    return opportunity;
  }));

  for (const result of results) if (result.status === 'fulfilled' && result.value) opportunities.push(result.value);
  return opportunities;
}

async function ensureBalancerPermissions(
  target: Runtime,
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
  opportunities: ZeroCapitalOpportunity[],
): Promise<boolean> {
  if (!target.executionEnabled || opportunities.length === 0) return true;
  const receiver = target.receiverManager.getReceiver(chain);
  const wallet = target.executionWallets.get(chain);
  if (!receiver || !wallet) return false;
  const route = opportunities[0].route;
  const calls = await buildMissingReceiverPermissionCalls({ chain: chain as any, provider, receiver, route });
  if (calls.length === 0) return true;
  const funding = await target.getGasFundingDecision(chain);
  if (funding.mode === 'unavailable') return false;
  await target.executeSetupCalls(chain as any, provider, wallet, funding.mode as ReceiverFundingMode, calls);
  logger.info('[ZeroXAtomic] Receiver permissions updated; current market quotes invalidated', {
    component: 'ZeroXAtomicDiscoveryWiring',
    chain,
    permissionCalls: calls.length,
    freshQuoteRequired: true,
  });
  return false;
}

export function ensureZeroXAtomicDiscoveryWiring(): void {
  const target = zeroCapitalEngine as unknown as Runtime;
  if (installed.has(target)) return;
  installed.add(target);
  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const existing = await originalScanChain(chain, provider);
    if (!SUPPORTED_ZEROX_CHAINS.has(chain as ChainId)) return existing;
    try {
      const zeroX = await discoverZeroXChain(chain, provider);
      if (zeroX.length === 0) return existing;
      const permissionReady = await ensureBalancerPermissions(target, chain, provider, zeroX);
      if (!permissionReady) return existing;
      return [...existing, ...zeroX];
    } catch (error) {
      logger.warn('[ZeroXAtomic] Dynamic 0x discovery degraded without blocking existing routes', {
        component: 'ZeroXAtomicDiscoveryWiring',
        chain,
        error: error instanceof Error ? error.message : String(error),
      });
      return existing;
    }
  };

  logger.info('[ZeroXAtomic] Dynamic 0x zero-capital discovery installed', {
    component: 'ZeroXAtomicDiscoveryWiring',
    chains: [...SUPPORTED_ZEROX_CHAINS],
    tokenSurface: 'graphless_dynamic_liquidity_ranked_plus_rotating_exploration',
    liquidityAggregation: '0x_price_preselection',
    fixedPairList: false,
    bpsExecutionFloor: null,
    executionRule: 'strict_all_in_net_profit_greater_than_zero_after_firm_quote_provider_fee_and_exact_gas',
    executionAuthorityChanged: false,
  });
}
