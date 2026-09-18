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
let dexAttempts = 0;
let dexMeasurements = 0;
let mempoolAttempts = 0;
let mempoolMeasurements = 0;
let lastError: string | null = null;

interface VeloraQuote {
  srcAmount: string;
  destAmount: string;
  srcDecimals: number;
  destDecimals: number;
  observedAt: number;
  network: number;
  gasCostUsd: number | null;
}

function intervalMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_STAGE_ONE_VELORA_RECOVERY_INTERVAL_MS || 12_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(60_000, Math.trunc(configured))) : 12_000;
}

function integerString(value: unknown): string | null {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isInteger(value)) return value.toString();
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed) > 0n ? trimmed : null;
  if (/^0x[a-fA-F0-9]+$/.test(trimmed)) {
    const parsed = BigInt(trimmed);
    return parsed > 0n ? parsed.toString() : null;
  }
  return null;
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

async function veloraQuote(input: {
  network: number;
  srcToken: string;
  destToken: string;
  srcAmount: string;
  srcDecimals: number;
  destDecimals: number;
}): Promise<VeloraQuote | null> {
  const query = new URLSearchParams({
    srcToken: input.srcToken,
    destToken: input.destToken,
    amount: input.srcAmount,
    srcDecimals: String(input.srcDecimals),
    destDecimals: String(input.destDecimals),
    side: 'SELL',
    network: String(input.network),
    version: '6.2',
    excludeRFQ: 'true',
    ignoreBadUsdPrice: 'true',
  });
  const payload = await fetchJsonWithRetry<any>(
    `https://api.paraswap.io/prices?${query.toString()}`,
    { maxRetries: 1, baseDelayMs: 125, maxDelayMs: 400, timeoutMs: 3_000 },
  ).catch(() => null);
  const route = payload?.priceRoute;
  const srcAmount = integerString(route?.srcAmount);
  const destAmount = integerString(route?.destAmount);
  if (!srcAmount || !destAmount || Number(route?.network) !== input.network) return null;
  const srcDecimals = Number(route?.srcDecimals);
  const destDecimals = Number(route?.destDecimals);
  if (!Number.isInteger(srcDecimals) || !Number.isInteger(destDecimals)) return null;
  const gasCostUsd = Number(route?.gasCostUSD);
  return {
    srcAmount,
    destAmount,
    srcDecimals,
    destDecimals,
    observedAt: Date.now(),
    network: input.network,
    gasCostUsd: Number.isFinite(gasCostUsd) && gasCostUsd >= 0 ? gasCostUsd : null,
  };
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
    executionCapabilityReason: 'Stage-1 fallback publishes measured spread only; canonical execution must independently rehydrate current all-in economics and execution evidence',
    missingInformation: ['required:strategy_specific_all_in_execution_evidence'],
    provenance: [
      ...input.provenance,
      'stage_one_velora_recovery:true',
      'measurement_before_execution_readiness:true',
      'execution_authority:false',
      'economic_mutation_authority:false',
      'synthetic_evidence:false',
    ],
  });
}

async function measureDexChain(chain: ChainId): Promise<number | null> {
  dexAttempts += 1;
  const config = SUPPORTED_CHAINS[chain];
  if (!config?.usdc || !config?.usdt) return null;
  const [usdcDecimals, usdtDecimals] = await Promise.all([
    getMeasuredErc20Decimals(chain, config.usdc),
    getMeasuredErc20Decimals(chain, config.usdt),
  ]);
  const amountIn = stableUnits(DEX_NOTIONAL_USD, usdcDecimals);
  const first = await veloraQuote({
    network: config.chainId,
    srcToken: config.usdc,
    destToken: config.usdt,
    srcAmount: amountIn,
    srcDecimals: usdcDecimals,
    destDecimals: usdtDecimals,
  });
  if (!first) return null;
  const second = await veloraQuote({
    network: config.chainId,
    srcToken: config.usdt,
    destToken: config.usdc,
    srcAmount: first.destAmount,
    srcDecimals: usdtDecimals,
    destDecimals: usdcDecimals,
  });
  if (!second) return null;
  const finalUsd = unitsToHuman(second.destAmount, usdcDecimals);
  if (finalUsd === null || finalUsd <= 0) return null;
  const grossProfitUsd = finalUsd - DEX_NOTIONAL_USD;
  const spreadBps = grossProfitUsd / DEX_NOTIONAL_USD * 10_000;
  if (!Number.isFinite(spreadBps)) return null;
  const observedAt = second.observedAt;
  recordMeasurement({
    topology: 'DEX_ATOMIC',
    opportunityId: `stage1-velora:dex:${chain}:${observedAt}`,
    spreadBps,
    observedAt,
    assets: ['USDC', 'USDT'],
    venues: ['velora'],
    chains: [chain],
    rawQuotes: [
      { source: 'velora', venue: 'velora', chain, symbol: 'USDC/USDT', observedAt: first.observedAt, amountIn, amountOut: first.destAmount, executable: false },
      { source: 'velora', venue: 'velora', chain, symbol: 'USDT/USDC', observedAt: second.observedAt, amountIn: first.destAmount, amountOut: second.destAmount, executable: false },
    ],
    notionalUsd: DEX_NOTIONAL_USD,
    grossProfitUsd,
    detail: 'Two live Velora Market API price routes measured the signed USDC→USDT→USDC round-trip spread before execution-cost hydration',
    provenance: [
      'velora_market_api:v6.2_live_price_route_round_trip',
      `measured_usdc_decimals:${usdcDecimals}`,
      `measured_usdt_decimals:${usdtDecimals}`,
      'stage_one_spread:gross_round_trip_before_execution_cost_hydration',
    ],
  });
  dexMeasurements += 1;
  return spreadBps;
}

async function recoverDex(): Promise<void> {
  const settled = await Promise.allSettled(DEX_CHAINS.map(chain => measureDexChain(chain)));
  const measured = settled.flatMap(result => result.status === 'fulfilled' && result.value !== null ? [result.value] : []);
  if (measured.length) dexBps = measured.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
}

function boundedMempoolMeasurement(
  decoded: DecodedPendingSwapRoute,
  transaction: ProviderMeshPendingTransaction,
): { sellAmount: string; targetOutput: string; mode: string } | null {
  const amountIn = integerString(decoded.amountIn);
  const minimumOut = integerString(decoded.amountOutMinimum);
  if (amountIn && minimumOut) return { sellAmount: amountIn, targetOutput: minimumOut, mode: 'exact_input_min_output' };
  if (decoded.method === 'swapExactETHForTokens' && minimumOut) {
    const nativeValue = integerString(transaction.value);
    if (nativeValue) return { sellAmount: nativeValue, targetOutput: minimumOut, mode: 'native_exact_input_min_output' };
  }
  const maximumIn = integerString(decoded.amountInMaximum);
  const amountOut = integerString(decoded.amountOut);
  if (maximumIn && amountOut) return { sellAmount: maximumIn, targetOutput: amountOut, mode: 'exact_output_max_input_bound' };
  if (decoded.method === 'swapETHForExactTokens' && amountOut) {
    const nativeValue = integerString(transaction.value);
    if (nativeValue) return { sellAmount: nativeValue, targetOutput: amountOut, mode: 'native_exact_output_value_bound' };
  }
  return null;
}

async function measureMempoolTransaction(transaction: ProviderMeshPendingTransaction): Promise<number | null> {
  mempoolAttempts += 1;
  if (transaction.chain !== 'ethereum' && transaction.chain !== 'polygon') return null;
  const decoded = decodePendingSwapRoute(transaction.input);
  if (!decoded?.routeComplete || decoded.tokenPath.length < 2) return null;
  const bounded = boundedMempoolMeasurement(decoded, transaction);
  if (!bounded) return null;
  const sellToken = decoded.tokenPath[0];
  const buyToken = decoded.tokenPath[decoded.tokenPath.length - 1];
  if (!/^0x[a-fA-F0-9]{40}$/.test(sellToken) || !/^0x[a-fA-F0-9]{40}$/.test(buyToken)) return null;
  const [srcDecimals, destDecimals] = await Promise.all([
    getMeasuredErc20Decimals(transaction.chain, sellToken),
    getMeasuredErc20Decimals(transaction.chain, buyToken),
  ]);
  const network = transaction.chain === 'ethereum' ? 1 : 137;
  const quote = await veloraQuote({
    network,
    srcToken: sellToken,
    destToken: buyToken,
    srcAmount: bounded.sellAmount,
    srcDecimals,
    destDecimals,
  });
  if (!quote) return null;
  const quotedOut = BigInt(quote.destAmount);
  const targetOut = BigInt(bounded.targetOutput);
  const spreadBps = signedRatioBps(quotedOut - targetOut, targetOut);
  if (spreadBps === null) return null;
  const observedAt = Math.max(transaction.timestamp, quote.observedAt);
  recordMeasurement({
    topology: 'MEMPOOL_BACKRUN',
    opportunityId: `stage1-velora:mempool:${transaction.chain}:${transaction.hash}:${quote.observedAt}`,
    spreadBps,
    observedAt,
    assets: decoded.tokenPath,
    venues: [transaction.to, 'velora'].filter(value => value.length > 0),
    chains: [transaction.chain],
    rawQuotes: [{
      source: 'velora',
      venue: 'velora',
      chain: transaction.chain,
      symbol: `${sellToken}/${buyToken}`,
      observedAt: quote.observedAt,
      amountIn: bounded.sellAmount,
      amountOut: quote.destAmount,
      executable: false,
      provenance: [
        `pending_tx:${transaction.hash}`,
        `pending_bound_mode:${bounded.mode}`,
        `pending_target_output:${bounded.targetOutput}`,
      ],
    }],
    detail: 'Fresh pending swap calldata was compared with a contemporaneous live Velora price route for the same endpoint token route and bounded amount, exposing signed BPS headroom before victim-first bundle compilation; this is not post-victim profit',
    provenance: [
      ...transaction.provenance,
      ...decoded.provenance,
      `pending_tx:${transaction.hash}`,
      `pending_bound_mode:${bounded.mode}`,
      `pending_target_output:${bounded.targetOutput}`,
      `live_route_output:${quote.destAmount}`,
      'velora_market_api:v6.2_live_price_route',
      'stage_one_spread:mempool_live_route_headroom_bps',
      'post_victim_pool_state:not_assumed',
      'post_victim_bundle_profitability:not_assumed',
      'sandwich_or_frontrun:false',
    ],
  });
  mempoolMeasurements += 1;
  return spreadBps;
}

async function recoverMempool(): Promise<void> {
  ensureProviderMeshPendingStream();
  const pending = providerMeshPendingStream.getRecentObservations(30_000)
    .filter(transaction => transaction.potentialArbitrage)
    .slice(0, 20);
  if (!pending.length) return;
  let cursor = 0;
  const measured: number[] = [];
  const workers = Math.min(4, pending.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= pending.length) return;
      try {
        const value = await measureMempoolTransaction(pending[index]);
        if (value !== null) measured.push(value);
      } catch {
        // Transaction/provider failure is route-local; sibling observations continue.
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
      ? rejected.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('; ')
      : null;
    logger.info('[StageOneVeloraRecovery] Route-local Stage-1 fallback cycle completed', {
      cycles,
      dexBps,
      mempoolBps,
      dexAttempts,
      dexMeasurements,
      mempoolAttempts,
      mempoolMeasurements,
      rejectedTasks: rejected.length,
      lastError,
      executionAuthority: false,
      economicMutationAuthority: false,
      syntheticEconomicsAllowed: false,
    });
  })().finally(() => {
    inFlight = null;
  });
  inFlight = work;
  return work;
}

export function getStageOneVeloraRecoverySnapshot() {
  return {
    cycles,
    dexBps,
    mempoolBps,
    dexAttempts,
    dexMeasurements,
    mempoolAttempts,
    mempoolMeasurements,
    lastCompletedAt,
    lastError,
    executionAuthority: false as const,
    economicMutationAuthority: false as const,
    syntheticEconomicsAllowed: false as const,
  };
}

export function ensureStageOneVeloraRecovery(): void {
  if (timer) return;
  ensureProviderMeshPendingStream();
  void cycle();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void cycle(), intervalMs());
    timer.unref?.();
  }
  logger.info('[StageOneVeloraRecovery] Route-local Stage-1 fallback installed', {
    intervalMs: intervalMs(),
    topologies: ['DEX_ATOMIC', 'MEMPOOL_BACKRUN'],
    provider: 'velora_market_api_v6.2',
    executionAuthority: false,
    economicMutationAuthority: false,
    syntheticEconomicsAllowed: false,
  });
}
export function stopStageOneVeloraRecovery(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
