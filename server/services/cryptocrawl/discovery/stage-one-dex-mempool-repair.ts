import logger from '../../../logger.js';
import {
  ensureProviderMeshPendingStream,
  providerMeshPendingStream,
  type ProviderMeshPendingTransaction,
} from '../capital-free/provider-mesh-pending-stream.js';
import { decodePendingSwapRoute, type DecodedPendingSwapRoute } from '../capital-free/pending-swap-route-decoder.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { ChainId } from '../bridge/types.js';
import { getMeasuredErc20Decimals } from '../intelligence/erc20-decimals-authority.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

const DEX_CHAINS: readonly ChainId[] = ['bsc', 'polygon', 'arbitrum', 'avalanche'];
const DEX_NOTIONAL_USD = 25;
const TTL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let cycles = 0;
let dexBps: number | null = null;
let mempoolBps: number | null = null;
let lastCompletedAt: number | null = null;
let lastError: string | null = null;

function intervalMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_STAGE_ONE_DEX_MEMPOOL_INTERVAL_MS || 10_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(60_000, Math.trunc(configured))) : 10_000;
}

function openOceanChainCode(chain: ChainId | 'ethereum'): string {
  if (chain === 'avalanche') return 'avax';
  if (chain === 'ethereum') return 'eth';
  return chain;
}

function integerString(value: unknown): string | null {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value).toString();
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) && BigInt(trimmed) > 0n ? trimmed : null;
}

async function openOceanGasPriceDecimals(chain: ChainId | 'ethereum'): Promise<string | null> {
  const payload = await fetchJsonWithRetry<any>(
    `https://open-api.openocean.finance/v4/${openOceanChainCode(chain)}/gasPrice`,
    { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 350, timeoutMs: 2_500 },
  ).catch(() => null);
  if (!payload || payload.code !== 200) return null;
  const standard = payload?.data?.standard;
  const candidates = [
    standard?.legacyGasPrice,
    standard?.maxFeePerGas,
    standard,
    payload?.data?.fast?.legacyGasPrice,
    payload?.data?.fast?.maxFeePerGas,
    payload?.data?.fast,
  ];
  for (const candidate of candidates) {
    const parsed = integerString(candidate);
    if (parsed) return parsed;
  }
  return null;
}

async function openOceanQuote(input: {
  chain: ChainId | 'ethereum';
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  gasPriceDecimals?: string | null;
}): Promise<{ outAmount: string; observedAt: number; gasPriceDecimals: string } | null> {
  const gasPriceDecimals = input.gasPriceDecimals || await openOceanGasPriceDecimals(input.chain);
  if (!gasPriceDecimals) return null;
  const query = new URLSearchParams({
    inTokenAddress: input.sellToken,
    outTokenAddress: input.buyToken,
    amountDecimals: input.sellAmount,
    gasPriceDecimals,
  });
  const payload = await fetchJsonWithRetry<any>(
    `https://open-api.openocean.finance/v4/${openOceanChainCode(input.chain)}/quote?${query.toString()}`,
    { maxRetries: 1, baseDelayMs: 125, maxDelayMs: 400, timeoutMs: 3_000 },
  ).catch(() => null);
  const outAmount = payload?.code === 200 ? integerString(payload?.data?.outAmount) : null;
  return outAmount ? { outAmount, observedAt: Date.now(), gasPriceDecimals } : null;
}

function stableUnits(usd: number, decimals: number): string {
  const micros = BigInt(Math.max(1, Math.round(usd * 1_000_000)));
  return (micros * (10n ** BigInt(decimals)) / 1_000_000n).toString();
}

function unitsToHuman(raw: string, decimals: number): number | null {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const value = Number(raw) / (10 ** decimals);
  return Number.isFinite(value) ? value : null;
}

function signedRatioBps(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const precision = 1_000_000n;
  const scaled = (numerator * 10_000n * precision) / denominator;
  const value = Number(scaled) / Number(precision);
  return Number.isFinite(value) ? value : null;
}

function recordMeasurement(input: {
  topology: 'DEX_ATOMIC' | 'MEMPOOL_BACKRUN';
  opportunityId: string;
  spreadBps: number;
  observedAt: number;
  assets: string[];
  venues: string[];
  chains: string[];
  rawQuotes?: MeasuredCandidate['rawQuotes'];
  notionalUsd?: number | null;
  grossProfitUsd?: number | null;
  detail: string;
  provenance: string[];
}): void {
  if (!Number.isFinite(input.spreadBps)) return;
  measuredCandidateRegistry.record({
    opportunityId: input.opportunityId,
    topology: input.topology,
    observedAt: input.observedAt,
    expiresAt: input.observedAt + TTL_MS,
    status: 'enriched',
    assets: input.assets,
    venues: input.venues,
    chains: input.chains,
    rawQuotes: input.rawQuotes ?? [],
    depth: { status: 'measured', detail: input.detail },
    economics: {
      grossProfitUsd: input.grossProfitUsd ?? null,
      deterministicNetProfitUsd: null,
      feeUsd: null,
      gasUsd: null,
      bridgeUsd: null,
      expectedSlippageBps: null,
      expectedPriceImpactBps: null,
      notionalUsd: input.notionalUsd ?? null,
      grossProfitBps: input.spreadBps,
      netProfitBps: null,
    },
    quoteAgeMs: Math.max(0, Date.now() - input.observedAt),
    executableCapability: false,
    executionCapabilityReason: 'Stage-1 DEX/mempool repair publishes measured spread only; canonical strategy execution must independently rehydrate current all-in economics and execution evidence',
    missingInformation: ['required:strategy_specific_all_in_execution_evidence'],
    provenance: [
      ...input.provenance,
      'stage_one_dex_mempool_repair:true',
      'measurement_before_execution_readiness:true',
      'execution_authority:false',
      'economic_mutation_authority:false',
      'synthetic_evidence:false',
    ],
  });
}

async function measureDexChain(chain: ChainId): Promise<number | null> {
  const config = SUPPORTED_CHAINS[chain];
  if (!config?.usdc || !config?.usdt) return null;
  const [usdcDecimals, usdtDecimals, gasPriceDecimals] = await Promise.all([
    getMeasuredErc20Decimals(chain, config.usdc),
    getMeasuredErc20Decimals(chain, config.usdt),
    openOceanGasPriceDecimals(chain),
  ]);
  if (!gasPriceDecimals) return null;
  const amountIn = stableUnits(DEX_NOTIONAL_USD, usdcDecimals);
  const first = await openOceanQuote({
    chain,
    sellToken: config.usdc,
    buyToken: config.usdt,
    sellAmount: amountIn,
    gasPriceDecimals,
  });
  if (!first) return null;
  const second = await openOceanQuote({
    chain,
    sellToken: config.usdt,
    buyToken: config.usdc,
    sellAmount: first.outAmount,
    gasPriceDecimals,
  });
  if (!second) return null;
  const finalUsd = unitsToHuman(second.outAmount, usdcDecimals);
  if (finalUsd === null || finalUsd <= 0) return null;
  const grossProfitUsd = finalUsd - DEX_NOTIONAL_USD;
  const spreadBps = grossProfitUsd / DEX_NOTIONAL_USD * 10_000;
  if (!Number.isFinite(spreadBps)) return null;
  recordMeasurement({
    topology: 'DEX_ATOMIC',
    opportunityId: `stage1-final:dex:${chain}:${second.observedAt}`,
    spreadBps,
    observedAt: second.observedAt,
    assets: ['USDC', 'USDT'],
    venues: ['openocean'],
    chains: [chain],
    rawQuotes: [
      { source: 'openocean', venue: 'openocean', chain, symbol: 'USDC/USDT', observedAt: first.observedAt, amountIn, amountOut: first.outAmount, executable: false },
      { source: 'openocean', venue: 'openocean', chain, symbol: 'USDT/USDC', observedAt: second.observedAt, amountIn: first.outAmount, amountOut: second.outAmount, executable: false },
    ],
    notionalUsd: DEX_NOTIONAL_USD,
    grossProfitUsd,
    detail: 'Two live OpenOcean V4 quote-only legs measured the signed USDC→USDT→USDC round-trip spread; OpenOcean live gasPrice is quote input only and is not treated as execution cost evidence',
    provenance: [
      'openocean_v4:live_quote_only_round_trip',
      'openocean_v4:live_gas_price_endpoint',
      `openocean_gas_price_decimals:${gasPriceDecimals}`,
      `measured_usdc_decimals:${usdcDecimals}`,
      `measured_usdt_decimals:${usdtDecimals}`,
      'stage_one_spread:gross_round_trip_before_execution_cost_hydration',
    ],
  });
  return spreadBps;
}

async function recoverDex(): Promise<void> {
  const settled = await Promise.allSettled(DEX_CHAINS.map(chain => measureDexChain(chain)));
  const measured = settled.flatMap(result => result.status === 'fulfilled' && result.value !== null ? [result.value] : []);
  if (measured.length) dexBps = measured.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
}

function exactInputMeasurement(decoded: DecodedPendingSwapRoute): { sellAmount: string; targetOutput: string; mode: string } | null {
  const amountIn = integerString(decoded.amountIn);
  const minimumOut = integerString(decoded.amountOutMinimum);
  if (amountIn && minimumOut) return { sellAmount: amountIn, targetOutput: minimumOut, mode: 'exact_input_min_output' };
  const maximumIn = integerString(decoded.amountInMaximum);
  const amountOut = integerString(decoded.amountOut);
  if (maximumIn && amountOut) return { sellAmount: maximumIn, targetOutput: amountOut, mode: 'exact_output_max_input_bound' };
  return null;
}

async function measureMempoolTransaction(transaction: ProviderMeshPendingTransaction): Promise<number | null> {
  if (transaction.chain !== 'ethereum' && transaction.chain !== 'polygon') return null;
  const decoded = decodePendingSwapRoute(transaction.input);
  if (!decoded?.routeComplete || decoded.tokenPath.length < 2) return null;
  const bounded = exactInputMeasurement(decoded);
  if (!bounded) return null;
  const sellToken = decoded.tokenPath[0];
  const buyToken = decoded.tokenPath[decoded.tokenPath.length - 1];
  if (!/^0x[a-fA-F0-9]{40}$/.test(sellToken) || !/^0x[a-fA-F0-9]{40}$/.test(buyToken)) return null;
  const gasPriceDecimals = await openOceanGasPriceDecimals(transaction.chain);
  if (!gasPriceDecimals) return null;
  const quote = await openOceanQuote({
    chain: transaction.chain,
    sellToken,
    buyToken,
    sellAmount: bounded.sellAmount,
    gasPriceDecimals,
  });
  if (!quote) return null;
  const quotedOut = BigInt(quote.outAmount);
  const targetOut = BigInt(bounded.targetOutput);
  const spreadBps = signedRatioBps(quotedOut - targetOut, targetOut);
  if (spreadBps === null) return null;
  const observedAt = Math.max(transaction.timestamp, quote.observedAt);
  recordMeasurement({
    topology: 'MEMPOOL_BACKRUN',
    opportunityId: `stage1-final:mempool:${transaction.chain}:${transaction.hash}:${quote.observedAt}`,
    spreadBps,
    observedAt,
    assets: decoded.tokenPath,
    venues: [transaction.to, 'openocean'].filter(Boolean),
    chains: [transaction.chain],
    rawQuotes: [{
      source: 'openocean',
      venue: 'openocean',
      chain: transaction.chain,
      symbol: `${sellToken}/${buyToken}`,
      observedAt: quote.observedAt,
      amountIn: bounded.sellAmount,
      amountOut: quote.outAmount,
      executable: false,
      provenance: [
        `pending_tx:${transaction.hash}`,
        `pending_bound_mode:${bounded.mode}`,
        `pending_target_output:${bounded.targetOutput}`,
      ],
    }],
    detail: 'Fresh pending swap calldata was compared with a contemporaneous live quote for the same endpoint token route and bounded amount, exposing signed BPS headroom before victim-first bundle compilation; this is not post-victim profit',
    provenance: [
      ...transaction.provenance,
      ...decoded.provenance,
      `pending_tx:${transaction.hash}`,
      `pending_bound_mode:${bounded.mode}`,
      `pending_target_output:${bounded.targetOutput}`,
      `live_route_output:${quote.outAmount}`,
      'stage_one_spread:mempool_live_route_headroom_bps',
      'post_victim_pool_state:not_assumed',
      'post_victim_bundle_profitability:not_assumed',
      'sandwich_or_frontrun:false',
    ],
  });
  return spreadBps;
}

async function recoverMempool(): Promise<void> {
  ensureProviderMeshPendingStream();
  const pending = providerMeshPendingStream.getRecentObservations(30_000)
    .filter(transaction => transaction.potentialArbitrage)
    .slice(0, 12);
  if (!pending.length) return;
  let cursor = 0;
  const measured: number[] = [];
  const workers = Math.min(3, pending.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= pending.length) return;
      try {
        const value = await measureMempoolTransaction(pending[index]);
        if (value !== null) measured.push(value);
      } catch {
        // Pending transaction failure is local; another observation can still measure Stage 1.
      }
    }
  }));
  if (measured.length) mempoolBps = measured.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
}

async function cycle(): Promise<void> {
  if (inFlight) return inFlight;
  const work = (async () => {
    const settled = await Promise.allSettled([recoverDex(), recoverMempool()]);
    cycles += 1;
    lastCompletedAt = Date.now();
    const rejected = settled.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
    lastError = rejected.length
      ? rejected.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('; ').slice(0, 2_000)
      : null;
    logger.info('[StageOneDexMempool] Isolated Stage-1 DEX/mempool measurement cycle completed', {
      component: 'StageOneDexMempoolRepair',
      cycles,
      dexBps,
      mempoolBps,
      lastCompletedAt,
      rejectedTasks: rejected.length,
      executionAuthority: false,
      economicMutationAuthority: false,
      syntheticEconomicsAllowed: false,
    });
  })().finally(() => { inFlight = null; });
  inFlight = work;
  return work;
}

export function getStageOneDexMempoolRepairSnapshot() {
  return {
    cycles,
    dexBps,
    mempoolBps,
    lastCompletedAt,
    lastError,
    executionAuthority: false as const,
    economicMutationAuthority: false as const,
    syntheticEconomicsAllowed: false as const,
  };
}

export function ensureStageOneDexMempoolRepair(): void {
  if (timer) return;
  void cycle();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void cycle(), intervalMs());
    timer.unref?.();
  }
  logger.info('[StageOneDexMempool] Isolated Stage-1 DEX/mempool repair installed', {
    component: 'StageOneDexMempoolRepair',
    intervalMs: intervalMs(),
    topologies: ['DEX_ATOMIC', 'MEMPOOL_BACKRUN'],
    executionAuthority: false,
    economicMutationAuthority: false,
    syntheticEconomicsAllowed: false,
  });
}
export function stopStageOneDexMempoolRepair(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
