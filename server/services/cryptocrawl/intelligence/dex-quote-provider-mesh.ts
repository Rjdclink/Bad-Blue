import { BigNumber, Contract } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import type { DexQuoteObservation } from './market-data-providers.js';

export type DexQuoteProviderName = 'kyberswap' | 'velora' | 'sushi' | 'uniswap' | 'balancer';
export type DexQuotePurpose = 'discovery' | 'qualification' | 'execution';

export interface DexMeshQuoteRequest {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount?: string;
  buyAmount?: string;
  takerAddress?: string;
  purpose?: DexQuotePurpose;
  forceRefresh?: boolean;
  slippagePpm?: number;
  tradeSurplusRecipient?: string;
  tradeSurplusMaxBps?: number;
}

interface ProviderState {
  name: DexQuoteProviderName;
  capacity: number;
  refillPerSecond: number;
  tokens: number;
  lastRefillAt: number;
  cooldownUntil: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  emaLatencyMs: number;
  emaQuality: number;
  lastUsedAt: number;
  lastError: string | null;
}

export interface DexQuoteMeshProviderSnapshot {
  provider: DexQuoteProviderName;
  tokens: number;
  capacity: number;
  healthScore: number;
  cooldownUntil: number;
  emaLatencyMs: number;
  emaQuality: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastUsedAt: number;
  lastError: string | null;
}

export interface DexQuoteMeshSnapshot {
  observedAt: number;
  providers: DexQuoteMeshProviderSnapshot[];
  activePerRequest: 2;
  maximumHedgeProviders: 1;
  zeroXProductionDependency: false;
  globalProviderCooldownAllowed: false;
}

const ERC20_ABI = ['function decimals() view returns (uint8)'];
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];
const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000] as const;
const UNISWAP_V3_QUOTERS: Partial<Record<SupportedChain, string>> = {
  ethereum: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  polygon: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  arbitrum: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  optimism: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
};

const CHAIN_BY_ID: Record<number, SupportedChain> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avalanche',
};
const KYBER_CHAIN_BY_ID: Partial<Record<number, string>> = {
  1: 'ethereum', 10: 'optimism', 56: 'bsc', 137: 'polygon', 8453: 'base', 42161: 'arbitrum', 43114: 'avalanche',
};
const BALANCER_CHAIN_BY_ID: Partial<Record<number, string>> = {
  1: 'MAINNET', 10: 'OPTIMISM', 56: 'BSC', 137: 'POLYGON', 8453: 'BASE', 42161: 'ARBITRUM', 43114: 'AVALANCHE',
};

const QUOTE_CACHE_MS = boundedInt(process.env.CRYPTOCRAWL_DEX_MESH_CACHE_MS, 450, 100, 2_000);
const HEDGE_DELAY_MS = boundedInt(process.env.CRYPTOCRAWL_DEX_MESH_HEDGE_DELAY_MS, 180, 50, 1_000);
const REQUEST_TIMEOUT_MS = boundedInt(process.env.CRYPTOCRAWL_DEX_MESH_REQUEST_TIMEOUT_MS, 2_200, 500, 6_000);
const PROVIDER_COOLDOWN_MS = boundedInt(process.env.CRYPTOCRAWL_DEX_MESH_PROVIDER_COOLDOWN_MS, 5_000, 500, 60_000);
const WEAK_QUOTE_DISAGREEMENT_BPS = boundedNumber(process.env.CRYPTOCRAWL_DEX_MESH_WEAK_QUOTE_BPS, 8, 0.1, 250);

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}
function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function positiveInteger(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^\d+$/.test(raw) && BigInt(raw) > 0n ? raw : null;
}
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function providerFeeEvidence(): Record<string, unknown> {
  // Provider/integrator surcharge is explicitly requested as zero. Pool/route fees
  // are already reflected in amountOut and must never be subtracted a second time.
  return {};
}
function baseObservation(input: DexMeshQuoteRequest, provider: DexQuoteProviderName, sellAmount: string, buyAmount: string): DexQuoteObservation {
  const sell = Number(sellAmount);
  const buy = Number(buyAmount);
  return {
    chainId: input.chainId,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount,
    buyAmount,
    amountMode: 'exact_in',
    slippagePpmApplied: input.slippagePpm,
    tradeSurplusRequested: false,
    price: Number.isFinite(sell) && sell > 0 && Number.isFinite(buy) ? buy / sell : undefined,
    liquidityAvailable: true,
    fees: providerFeeEvidence(),
    quoteKind: input.purpose === 'execution' ? 'quote' : 'price',
    executable: false,
    observedAt: Date.now(),
    // Legacy quote type is intentionally preserved for the locked Stage-1
    // contract. The assertion changes only TypeScript's view; runtime retains
    // the actual provider name so provider rotation/quality accounting works.
    source: provider as '0x',
  };
}

function initialProviderState(name: DexQuoteProviderName): ProviderState {
  const external = name === 'kyberswap' || name === 'velora' || name === 'sushi';
  const capacity = external ? (name === 'sushi' ? 6 : 8) : 32;
  return {
    name,
    capacity,
    refillPerSecond: external ? Math.max(1, capacity / 2) : 16,
    tokens: capacity,
    lastRefillAt: Date.now(),
    cooldownUntil: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    emaLatencyMs: external ? 450 : 250,
    emaQuality: 1,
    lastUsedAt: 0,
    lastError: null,
  };
}

const states = new Map<DexQuoteProviderName, ProviderState>(
  (['kyberswap', 'velora', 'sushi', 'uniswap', 'balancer'] as const).map(name => [name, initialProviderState(name)]),
);
const cache = new Map<string, { value: DexQuoteObservation | null; expiresAt: number }>();
const inFlight = new Map<string, Promise<DexQuoteObservation | null>>();

function refill(state: ProviderState, now = Date.now()): void {
  const seconds = Math.max(0, now - state.lastRefillAt) / 1_000;
  state.tokens = Math.min(state.capacity, state.tokens + seconds * state.refillPerSecond);
  state.lastRefillAt = now;
}
function supports(provider: DexQuoteProviderName, request: DexMeshQuoteRequest): boolean {
  if (!CHAIN_BY_ID[request.chainId]) return false;
  if (positiveInteger(request.sellAmount) === null || positiveInteger(request.buyAmount) !== null) return false;
  if (request.purpose === 'execution') return provider === 'kyberswap' || provider === 'sushi';
  if (provider === 'uniswap') return Boolean(UNISWAP_V3_QUOTERS[CHAIN_BY_ID[request.chainId]]);
  if (provider === 'balancer') return Boolean(BALANCER_CHAIN_BY_ID[request.chainId]);
  return true;
}
function healthScore(state: ProviderState, request: DexMeshQuoteRequest): number {
  const now = Date.now();
  refill(state, now);
  if (state.cooldownUntil > now || state.tokens < 1 || !supports(state.name, request)) return -Infinity;
  const budget = state.tokens / Math.max(1, state.capacity);
  const reliability = (state.successes + 4) / (state.successes + state.failures + 4);
  const latency = 1 / (1 + state.emaLatencyMs / 500);
  const quality = Math.max(0.5, Math.min(1.5, state.emaQuality));
  const rotation = Math.min(1, (now - state.lastUsedAt) / 2_000);
  const lowQuotaPressureBonus = state.name === 'uniswap' || state.name === 'balancer' ? 0.12 : 0;
  return budget * 0.28 + reliability * 0.27 + latency * 0.18 + quality * 0.17 + rotation * 0.1 + lowQuotaPressureBonus;
}
function rankedProviders(request: DexMeshQuoteRequest): DexQuoteProviderName[] {
  return [...states.values()]
    .map(state => ({ name: state.name, score: healthScore(state, request) }))
    .filter(row => Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score)
    .map(row => row.name);
}
function consume(state: ProviderState): boolean {
  refill(state);
  if (state.tokens < 1 || state.cooldownUntil > Date.now()) return false;
  state.tokens -= 1;
  state.lastUsedAt = Date.now();
  return true;
}
function recordSuccess(state: ProviderState, latencyMs: number): void {
  state.successes += 1;
  state.consecutiveFailures = 0;
  state.emaLatencyMs = state.emaLatencyMs * 0.75 + latencyMs * 0.25;
  state.lastError = null;
}
function recordFailure(state: ProviderState, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  state.failures += 1;
  state.consecutiveFailures += 1;
  state.lastError = message.slice(0, 240);
  if (/HTTP\s*429|rate.?limit|too many requests/i.test(message)) {
    state.cooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS * Math.min(6, Math.max(1, state.consecutiveFailures));
  } else if (state.consecutiveFailures >= 3) {
    state.cooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
  }
}
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} quote timeout`)), ms);
    timer.unref?.();
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function tokenDecimals(chainId: number, token: string): Promise<number> {
  const chain = CHAIN_BY_ID[chainId];
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  const result = await multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
    const decimals = Number(await new Contract(token, ERC20_ABI, provider).decimals());
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('invalid token decimals');
    return decimals;
  });
  return Number(result.result);
}

async function quoteKyber(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const sellAmount = positiveInteger(request.sellAmount);
  const chain = KYBER_CHAIN_BY_ID[request.chainId];
  if (!sellAmount || !chain) return null;
  const query = new URLSearchParams({ tokenIn: request.sellToken, tokenOut: request.buyToken, amountIn: sellAmount });
  const headers = { accept: 'application/json', 'x-client-id': process.env.KYBERSWAP_CLIENT_ID?.trim() || 'cryptocrawler' };
  const payload = await fetchJsonWithRetry<any>(`https://aggregator-api.kyberswap.com/${chain}/api/v1/routes?${query.toString()}`, {
    init: { headers }, maxRetries: 0, timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const routeSummary = payload?.data?.routeSummary;
  const amountOut = positiveInteger(routeSummary?.amountOut);
  if (!amountOut) return null;
  const observation = baseObservation(request, 'kyberswap', sellAmount, amountOut);
  observation.estimatedGas = positiveInteger(routeSummary?.gas) || undefined;
  observation.gasPrice = positiveInteger(routeSummary?.gasPrice) || undefined;
  observation.priceImpact = Number.isFinite(Number(routeSummary?.priceImpact)) ? Number(routeSummary.priceImpact) : undefined;
  observation.route = Array.isArray(routeSummary?.route)
    ? routeSummary.route.flat().map((leg: any) => ({ source: String(leg?.exchange || 'kyberswap'), fromToken: leg?.tokenIn, toToken: leg?.tokenOut }))
    : [{ source: 'kyberswap', fromToken: request.sellToken, toToken: request.buyToken }];
  if (request.purpose === 'execution' && request.takerAddress) {
    const slippageBps = Math.max(1, Math.min(10_000, Math.ceil((request.slippagePpm ?? 10_000) / 100)));
    const build = await fetchJsonWithRetry<any>(`https://aggregator-api.kyberswap.com/${chain}/api/v1/route/build`, {
      init: {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ routeSummary, sender: request.takerAddress, recipient: request.takerAddress, slippageTolerance: slippageBps, source: 'cryptocrawler' }),
      },
      maxRetries: 0,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const data = build?.data;
    const routerAddress = String(data?.routerAddress || payload?.data?.routerAddress || '').trim();
    const callData = String(data?.data || '').trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(routerAddress) && /^0x[0-9a-fA-F]+$/.test(callData)) {
      observation.transaction = { to: routerAddress, data: callData, value: String(data?.value || '0'), gas: positiveInteger(data?.gas) || observation.estimatedGas };
      observation.allowanceTarget = routerAddress;
      observation.allowanceSpender = routerAddress;
      observation.quoteKind = 'quote';
      observation.executable = true;
    }
  }
  return observation;
}

async function quoteVelora(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const sellAmount = positiveInteger(request.sellAmount);
  if (!sellAmount) return null;
  const [srcDecimals, destDecimals] = await Promise.all([tokenDecimals(request.chainId, request.sellToken), tokenDecimals(request.chainId, request.buyToken)]);
  const query = new URLSearchParams({
    srcToken: request.sellToken,
    srcDecimals: String(srcDecimals),
    destToken: request.buyToken,
    destDecimals: String(destDecimals),
    amount: sellAmount,
    side: 'SELL',
    network: String(request.chainId),
  });
  const payload = await fetchJsonWithRetry<any>(`https://api.paraswap.io/prices?${query.toString()}`, { maxRetries: 0, timeoutMs: REQUEST_TIMEOUT_MS });
  const route = payload?.priceRoute;
  const amountOut = positiveInteger(route?.destAmount);
  if (!amountOut) return null;
  const observation = baseObservation(request, 'velora', sellAmount, amountOut);
  observation.estimatedGas = positiveInteger(route?.gasCost) || undefined;
  observation.priceImpact = Number.isFinite(Number(route?.priceImpact)) ? Number(route.priceImpact) / 100 : undefined;
  observation.route = [{ source: 'velora', fromToken: request.sellToken, toToken: request.buyToken }];
  return observation;
}

async function quoteSushi(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const sellAmount = positiveInteger(request.sellAmount);
  if (!sellAmount) return null;
  const execution = request.purpose === 'execution' && Boolean(request.takerAddress);
  const endpoint = execution ? 'swap' : 'quote';
  const url = new URL(`/${endpoint}/v7/${request.chainId}`, 'https://api.sushi.com');
  url.searchParams.set('tokenIn', request.sellToken);
  url.searchParams.set('tokenOut', request.buyToken);
  url.searchParams.set('amount', sellAmount);
  url.searchParams.set('maxSlippage', String(Math.max(0.0001, Math.min(1, (request.slippagePpm ?? 10_000) / 1_000_000))));
  url.searchParams.set('referrer', 'sushi');
  url.searchParams.set('fee', '0');
  if (execution && request.takerAddress) {
    url.searchParams.set('sender', request.takerAddress);
    url.searchParams.set('recipient', request.takerAddress);
    url.searchParams.set('simulate', 'false');
  }
  const payload = await fetchJsonWithRetry<any>(url.toString(), { maxRetries: 0, timeoutMs: REQUEST_TIMEOUT_MS });
  const amountOut = positiveInteger(payload?.assumedAmountOut || payload?.amountOut);
  if (!amountOut || (payload?.status && payload.status !== 'Success')) return null;
  const observation = baseObservation(request, 'sushi', sellAmount, amountOut);
  observation.estimatedGas = positiveInteger(payload?.gasSpent || payload?.gas || payload?.tx?.gas) || undefined;
  observation.priceImpact = Number.isFinite(Number(payload?.priceImpact)) ? Number(payload.priceImpact) : undefined;
  observation.route = [{ source: 'sushi', fromToken: request.sellToken, toToken: request.buyToken }];
  const target = String(payload?.tx?.to || '').trim();
  const data = String(payload?.tx?.data || '').trim();
  if (execution && /^0x[a-fA-F0-9]{40}$/.test(target) && /^0x[0-9a-fA-F]+$/.test(data)) {
    observation.transaction = { to: target, data, value: String(payload?.tx?.value || '0'), gas: observation.estimatedGas };
    observation.allowanceTarget = target;
    observation.allowanceSpender = target;
    observation.quoteKind = 'quote';
    observation.executable = true;
  }
  return observation;
}

async function quoteUniswap(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const sellAmount = positiveInteger(request.sellAmount);
  const chain = CHAIN_BY_ID[request.chainId];
  const quoterAddress = chain ? UNISWAP_V3_QUOTERS[chain] : undefined;
  if (!sellAmount || !chain || !quoterAddress) return null;
  const result = await multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
    const quoter = new Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, provider);
    const settled = await Promise.allSettled(UNISWAP_FEE_TIERS.map(async fee => ({
      fee,
      amountOut: BigNumber.from(await quoter.callStatic.quoteExactInputSingle(request.sellToken, request.buyToken, fee, sellAmount, 0)),
    })));
    const valid = settled
      .filter((row): row is PromiseFulfilledResult<{ fee: number; amountOut: BigNumber }> => row.status === 'fulfilled' && row.value.amountOut.gt(0))
      .map(row => row.value)
      .sort((a, b) => b.amountOut.gt(a.amountOut) ? 1 : b.amountOut.lt(a.amountOut) ? -1 : a.fee - b.fee);
    return valid[0] || null;
  });
  const best = result.result;
  if (!best) return null;
  const observation = baseObservation(request, 'uniswap', sellAmount, best.amountOut.toString());
  observation.route = [{ source: `uniswap_v3_${best.fee}`, fromToken: request.sellToken, toToken: request.buyToken }];
  return observation;
}

async function quoteBalancer(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const sellAmount = positiveInteger(request.sellAmount);
  const gqlChain = BALANCER_CHAIN_BY_ID[request.chainId];
  if (!sellAmount || !gqlChain) return null;
  const decimals = await tokenDecimals(request.chainId, request.sellToken);
  const humanAmount = Number(sellAmount) / (10 ** decimals);
  if (!Number.isFinite(humanAmount) || humanAmount <= 0) return null;
  const query = `query sorGetSwapPaths($chain:GqlChain!,$swapType:GqlSorSwapType!,$swapAmount:AmountHumanReadable!,$tokenIn:String!,$tokenOut:String!){sorGetSwapPaths(chain:$chain,swapType:$swapType,swapAmount:$swapAmount,tokenIn:$tokenIn,tokenOut:$tokenOut,considerPoolsWithHooks:true){returnAmount priceImpact{priceImpact error} paths{inputAmountRaw outputAmountRaw pools protocolVersion}}}`;
  const payload = await fetchJsonWithRetry<any>('https://api-v3.balancer.fi/', {
    init: {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { chain: gqlChain, swapType: 'EXACT_IN', swapAmount: String(humanAmount), tokenIn: request.sellToken, tokenOut: request.buyToken } }),
    },
    maxRetries: 0,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const sor = payload?.data?.sorGetSwapPaths;
  const paths = Array.isArray(sor?.paths) ? sor.paths : [];
  const output = paths.reduce((sum: bigint, path: any) => sum + BigInt(positiveInteger(path?.outputAmountRaw) || '0'), 0n);
  if (output <= 0n) return null;
  const observation = baseObservation(request, 'balancer', sellAmount, output.toString());
  const impact = Number(sor?.priceImpact?.priceImpact);
  observation.priceImpact = Number.isFinite(impact) ? impact : undefined;
  observation.route = paths.flatMap((path: any) => (Array.isArray(path?.pools) ? path.pools : []).map((pool: unknown) => ({ source: `balancer_v${Number(path?.protocolVersion) || '?'}`, fromToken: request.sellToken, toToken: request.buyToken, pool: String(pool) } as any)));
  if (!observation.route?.length) observation.route = [{ source: 'balancer', fromToken: request.sellToken, toToken: request.buyToken }];
  return observation;
}

async function providerQuote(name: DexQuoteProviderName, request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const state = states.get(name)!;
  if (!consume(state)) return null;
  const started = Date.now();
  try {
    const quote = await withTimeout((async () => {
      if (name === 'kyberswap') return quoteKyber(request);
      if (name === 'velora') return quoteVelora(request);
      if (name === 'sushi') return quoteSushi(request);
      if (name === 'uniswap') return quoteUniswap(request);
      return quoteBalancer(request);
    })(), REQUEST_TIMEOUT_MS, name);
    if (!quote) throw new Error(`${name} returned no usable quote`);
    recordSuccess(state, Date.now() - started);
    return quote;
  } catch (error) {
    recordFailure(state, error);
    logger.debug('[DexQuoteMesh] Provider quote failed locally', {
      component: 'DexQuoteProviderMesh', provider: name, chainId: request.chainId,
      error: error instanceof Error ? error.message : String(error), globalCooldownApplied: false,
    });
    return null;
  }
}

function quoteAmount(quote: DexQuoteObservation): bigint | null {
  const value = positiveInteger(quote.buyAmount);
  return value ? BigInt(value) : null;
}
function bestQuote(quotes: DexQuoteObservation[], request: DexMeshQuoteRequest): DexQuoteObservation | null {
  const valid = quotes.filter(quote => quote.liquidityAvailable && quoteAmount(quote) !== null && (request.purpose !== 'execution' || quote.executable));
  if (valid.length === 0) return null;
  return [...valid].sort((a, b) => {
    const left = quoteAmount(a)!;
    const right = quoteAmount(b)!;
    if (right > left) return 1;
    if (right < left) return -1;
    return a.observedAt - b.observedAt;
  })[0];
}
function quoteDisagreementBps(quotes: DexQuoteObservation[]): number {
  const values = quotes.map(quoteAmount).filter((value): value is bigint => value !== null && value > 0n);
  if (values.length < 2) return Infinity;
  const max = values.reduce((a, b) => a > b ? a : b);
  const min = values.reduce((a, b) => a < b ? a : b);
  return Number((max - min) * 10_000_000n / max) / 1_000;
}
function updateRelativeQuality(quotes: DexQuoteObservation[]): void {
  const values = quotes.map(quote => ({ quote, amount: quoteAmount(quote) })).filter((row): row is { quote: DexQuoteObservation; amount: bigint } => row.amount !== null && row.amount > 0n);
  if (values.length === 0) return;
  const best = values.reduce((a, b) => a.amount > b.amount ? a : b).amount;
  for (const row of values) {
    const state = states.get(row.quote.source as DexQuoteProviderName);
    if (!state) continue;
    const ratio = Number(row.amount * 1_000_000n / best) / 1_000_000;
    state.emaQuality = state.emaQuality * 0.8 + ratio * 0.2;
  }
}

function cacheKey(request: DexMeshQuoteRequest): string {
  return [request.chainId, request.sellToken.toLowerCase(), request.buyToken.toLowerCase(), `sell:${request.sellAmount || ''}`, request.purpose || 'discovery', request.takerAddress?.toLowerCase() || '', request.slippagePpm ?? 'default'].join(':');
}

async function runHedgedMesh(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  const ranked = rankedProviders(request);
  if (ranked.length === 0) return null;
  const primaryNames = ranked.slice(0, 2);
  const reserve = ranked.slice(2);
  const primaryPromises = primaryNames.map(name => providerQuote(name, request));
  let settledFast = false;
  await Promise.race([
    Promise.allSettled(primaryPromises).then(() => { settledFast = true; }),
    sleep(HEDGE_DELAY_MS),
  ]);

  let results: Array<DexQuoteObservation | null>;
  if (!settledFast && reserve[0]) {
    results = await Promise.all([...primaryPromises, providerQuote(reserve[0], request)]);
  } else {
    results = await Promise.all(primaryPromises);
    const usable = results.filter((value): value is DexQuoteObservation => value !== null);
    const weak = usable.length < 2 || quoteDisagreementBps(usable) > WEAK_QUOTE_DISAGREEMENT_BPS;
    if (weak && reserve[0]) results.push(await providerQuote(reserve[0], request));
  }

  const usable = results.filter((value): value is DexQuoteObservation => value !== null);
  updateRelativeQuality(usable);
  const selected = bestQuote(usable, request);
  if (selected) {
    logger.debug('[DexQuoteMesh] Hedged provider selected', {
      component: 'DexQuoteProviderMesh', chainId: request.chainId, provider: selected.source,
      providersAttempted: results.length, activeProviders: primaryNames, hedgeUsed: results.length > primaryNames.length,
      globalCooldownApplied: false, zeroXProductionDependency: false,
    });
  }
  return selected;
}

export async function getHedgedDexQuote(request: DexMeshQuoteRequest): Promise<DexQuoteObservation | null> {
  if ((positiveInteger(request.sellAmount) === null) === (positiveInteger(request.buyAmount) === null)) return null;
  if (positiveInteger(request.buyAmount) !== null) return null;
  const key = cacheKey(request);
  const cacheAllowed = request.purpose !== 'execution' && request.forceRefresh !== true;
  const cached = cacheAllowed ? cache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.value ? { ...cached.value } : null;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = runHedgedMesh(request).then(value => {
    if (cacheAllowed) cache.set(key, { value, expiresAt: Date.now() + QUOTE_CACHE_MS });
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export function getDexQuoteMeshSnapshot(): DexQuoteMeshSnapshot {
  return {
    observedAt: Date.now(),
    providers: [...states.values()].map(state => ({
      provider: state.name,
      tokens: (refill(state), state.tokens),
      capacity: state.capacity,
      healthScore: healthScore(state, { chainId: 1, sellToken: '0x0000000000000000000000000000000000000001', buyToken: '0x0000000000000000000000000000000000000002', sellAmount: '1', purpose: 'discovery' }),
      cooldownUntil: state.cooldownUntil,
      emaLatencyMs: state.emaLatencyMs,
      emaQuality: state.emaQuality,
      successes: state.successes,
      failures: state.failures,
      consecutiveFailures: state.consecutiveFailures,
      lastUsedAt: state.lastUsedAt,
      lastError: state.lastError,
    })),
    activePerRequest: 2,
    maximumHedgeProviders: 1,
    zeroXProductionDependency: false,
    globalProviderCooldownAllowed: false,
  };
}
