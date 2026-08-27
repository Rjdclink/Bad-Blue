import { BigNumber, Contract, providers } from 'ethers';
import type { RoutePlanningSwapStep } from './autonomous-route-planner.js';
import type { SupportedExecutionChain, SupportedSwapProtocol } from './onchain-payload-builder.js';
import { EUROPA_SUSHI } from './europa-sushi-registry.js';

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];

const SUSHISWAP_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
];

const UNISWAP_V3_QUOTERS: Partial<Record<SupportedExecutionChain, string>> = {
  ethereum: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  polygon: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  arbitrum: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  optimism: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
};

const SUSHISWAP_ROUTERS: Partial<Record<SupportedExecutionChain, string>> = {
  ethereum: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
  polygon: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  bsc: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  avalanche: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
};

export interface ConfiguredRouteLeg {
  protocol: SupportedSwapProtocol;
  tokenIn: string;
  tokenOut: string;
  pool?: string;
  feeTier?: 500 | 3000 | 10000;
  fee?: number;
}

export interface ConfiguredZeroCapitalRoute {
  id: string;
  chain: SupportedExecutionChain;
  inputAssetSymbol: 'USDC' | 'USDT';
  inputToken: string;
  inputTokenDecimals: number;
  amountIn: string;
  estimatedGasCostInInputToken: string;
  relayFeeInInputToken: string;
  flashLoanFeeBps?: number;
  // Deprecated compatibility field. It is retained for configuration parsing and
  // telemetry only; executable eligibility is strict all-in netProfit > 0.
  minNetProfitBps?: number;
  legs: ConfiguredRouteLeg[];
}

export interface QuotedZeroCapitalRoute {
  id: string;
  chain: SupportedExecutionChain;
  inputAssetSymbol: 'USDC' | 'USDT';
  inputToken: string;
  inputTokenDecimals: number;
  amountIn: bigint;
  grossProfit: bigint;
  netProfit: bigint;
  netProfitBps: number;
  estimatedGasCostInInputToken: bigint;
  flashLoanFeeInInputToken: bigint;
  relayFeeInInputToken: bigint;
  quoteLatencyMs: number;
  route: RoutePlanningSwapStep[];
}

const inFlightLegQuotes = new WeakMap<providers.Provider, Map<string, Promise<BigNumber>>>();

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function toBigInt(label: string, value: unknown): bigint {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer string denominated in token base units`);
  }
  return BigInt(normalized);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function normalizeProtocol(value: unknown): SupportedSwapProtocol {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3') return 'uniswapV3';
  if (normalized === 'sushiswap' || normalized === 'sushi') return 'sushiswap';
  if (normalized === 'sushiswapv3' || normalized === 'sushi_v3' || normalized === 'sushi-v3') return 'sushiswapV3';
  throw new Error(`Unsupported route protocol: ${String(value)}`);
}

function asSupportedChain(value: unknown): SupportedExecutionChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'polygon' || normalized === 'arbitrum' || normalized === 'optimism' || normalized === 'bsc' || normalized === 'avalanche' || normalized === 'europa') return normalized;
  throw new Error(`Unsupported route chain: ${String(value)}`);
}

function maxQuoteLatencyMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_MAX_QUOTE_LATENCY_MS || 2500);
  if (!Number.isFinite(configured)) return 2500;
  return Math.max(250, Math.min(15000, Math.trunc(configured)));
}

function parseConfiguredRoute(raw: unknown, index: number): ConfiguredZeroCapitalRoute {
  if (!raw || typeof raw !== 'object') throw new Error(`Route ${index} must be an object`);

  const candidate = raw as Record<string, unknown>;
  const chain = asSupportedChain(candidate.chain);
  const inputAssetSymbol = String(candidate.inputAssetSymbol || '').trim().toUpperCase();
  if (inputAssetSymbol !== 'USDC' && inputAssetSymbol !== 'USDT') throw new Error(`Route ${index} must use USDC or USDT as its input asset`);

  const inputToken = String(candidate.inputToken || '').trim();
  if (!isAddress(inputToken)) throw new Error(`Route ${index} inputToken must be a valid EVM address`);

  const inputTokenDecimals = Number(candidate.inputTokenDecimals);
  if (!Number.isInteger(inputTokenDecimals) || inputTokenDecimals < 0 || inputTokenDecimals > 36) throw new Error(`Route ${index} inputTokenDecimals must be an integer from 0 to 36`);
  if (inputTokenDecimals !== 6) throw new Error(`Route ${index} must use six-decimal USDC or USDT accounting`);

  const rawLegs = candidate.legs;
  if (!Array.isArray(rawLegs) || rawLegs.length < 2) throw new Error(`Route ${index} must contain at least two legs`);

  const legs = rawLegs.map((rawLeg, legIndex) => {
    if (!rawLeg || typeof rawLeg !== 'object') throw new Error(`Route ${index} leg ${legIndex} must be an object`);
    const leg = rawLeg as Record<string, unknown>;
    const tokenIn = String(leg.tokenIn || '').trim();
    const tokenOut = String(leg.tokenOut || '').trim();
    if (!isAddress(tokenIn) || !isAddress(tokenOut)) throw new Error(`Route ${index} leg ${legIndex} requires valid tokenIn and tokenOut addresses`);
    if (normalizeAddress(tokenIn) === normalizeAddress(tokenOut)) throw new Error(`Route ${index} leg ${legIndex} cannot swap a token into itself`);

    const pool = leg.pool === undefined ? undefined : String(leg.pool).trim();
    if (pool !== undefined && !isAddress(pool)) throw new Error(`Route ${index} leg ${legIndex} pool must be a valid EVM address`);

    const feeTier = leg.feeTier === undefined ? undefined : Number(leg.feeTier);
    if (feeTier !== undefined && feeTier !== 500 && feeTier !== 3000 && feeTier !== 10000) throw new Error(`Route ${index} leg ${legIndex} feeTier must be 500, 3000, or 10000`);

    const fee = leg.fee === undefined ? undefined : Number(leg.fee);
    if (fee !== undefined && (!Number.isFinite(fee) || fee < 0 || fee > 0.1)) throw new Error(`Route ${index} leg ${legIndex} fee must be a decimal fraction between 0 and 0.1`);

    return {
      protocol: normalizeProtocol(leg.protocol),
      tokenIn,
      tokenOut,
      ...(pool !== undefined ? { pool } : {}),
      ...(feeTier !== undefined ? { feeTier: feeTier as 500 | 3000 | 10000 } : {}),
      ...(fee !== undefined ? { fee } : {}),
    };
  });

  if (normalizeAddress(legs[0].tokenIn) !== normalizeAddress(inputToken)) throw new Error(`Route ${index} must start with inputToken`);
  for (let legIndex = 1; legIndex < legs.length; legIndex++) {
    if (normalizeAddress(legs[legIndex - 1].tokenOut) !== normalizeAddress(legs[legIndex].tokenIn)) throw new Error(`Route ${index} leg ${legIndex} is not contiguous with the preceding leg`);
  }
  if (normalizeAddress(legs[legs.length - 1].tokenOut) !== normalizeAddress(inputToken)) throw new Error(`Route ${index} must return to inputToken to repay the flash loan atomically`);

  const amountIn = String(candidate.amountIn || '').trim();
  const estimatedGasCostInInputToken = String(candidate.estimatedGasCostInInputToken || '').trim();
  const relayFeeInInputToken = String(candidate.relayFeeInInputToken || '').trim();
  toBigInt(`Route ${index} amountIn`, amountIn);
  toBigInt(`Route ${index} estimatedGasCostInInputToken`, estimatedGasCostInInputToken);
  toBigInt(`Route ${index} relayFeeInInputToken`, relayFeeInInputToken);

  const flashLoanFeeBps = candidate.flashLoanFeeBps === undefined ? 0 : Number(candidate.flashLoanFeeBps);
  const minNetProfitBps = candidate.minNetProfitBps === undefined ? 0 : Number(candidate.minNetProfitBps);
  if (!Number.isFinite(flashLoanFeeBps) || flashLoanFeeBps < 0 || flashLoanFeeBps > 1000) throw new Error(`Route ${index} flashLoanFeeBps must be between 0 and 1000`);
  if (!Number.isFinite(minNetProfitBps) || minNetProfitBps < 0 || minNetProfitBps > 5000) throw new Error(`Route ${index} minNetProfitBps must be between 0 and 5000`);
  if (chain === 'europa' && (toBigInt(`Route ${index} estimatedGasCostInInputToken`, estimatedGasCostInInputToken) !== 0n || toBigInt(`Route ${index} relayFeeInInputToken`, relayFeeInInputToken) !== 0n)) {
    throw new Error(`Route ${index} for Europa must not include estimated gas or relay fees; native-balance proof is enforced after receipt`);
  }

  return {
    id: String(candidate.id || `${chain}-route-${index}`).trim(),
    chain,
    inputAssetSymbol,
    inputToken,
    inputTokenDecimals,
    amountIn,
    estimatedGasCostInInputToken,
    relayFeeInInputToken,
    flashLoanFeeBps,
    minNetProfitBps,
    legs,
  };
}

export function loadConfiguredZeroCapitalRoutes(raw: string = process.env.ZERO_CAPITAL_ROUTE_CONFIG || ''): ConfiguredZeroCapitalRoute[] {
  if (!raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ZERO_CAPITAL_ROUTE_CONFIG must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('ZERO_CAPITAL_ROUTE_CONFIG must be a JSON array');

  const routes = parsed.map(parseConfiguredRoute);
  const routeIds = new Set<string>();
  for (const route of routes) {
    const normalizedId = route.id.toLowerCase();
    if (routeIds.has(normalizedId)) throw new Error(`ZERO_CAPITAL_ROUTE_CONFIG contains duplicate route id: ${route.id}`);
    routeIds.add(normalizedId);
  }
  return routes;
}

function legQuoteKey(chain: SupportedExecutionChain, leg: ConfiguredRouteLeg, amountIn: BigNumber): string {
  return [chain, leg.protocol, normalizeAddress(leg.tokenIn), normalizeAddress(leg.tokenOut), leg.pool ? normalizeAddress(leg.pool) : '', leg.feeTier || '', leg.fee ?? '', amountIn.toString()].join(':');
}

async function quoteLegUncached(provider: providers.Provider, chain: SupportedExecutionChain, leg: ConfiguredRouteLeg, amountIn: BigNumber): Promise<BigNumber> {
  if (chain === 'europa' && leg.protocol === 'sushiswapV3') {
    const sender = process.env.ZERO_CAPITAL_EUROPA_QUOTE_SENDER?.trim() || '0x0e9878153c1500ec48b51cdd5325c7e374c9cdae';
    const recipient = process.env.ZERO_CAPITAL_EUROPA_QUOTE_RECIPIENT?.trim() || sender;
    const pool = leg.pool?.trim() || process.env.ZERO_CAPITAL_EUROPA_QUOTE_POOL?.trim() ||
      ((leg.tokenIn.toLowerCase() === EUROPA_SUSHI.tokens.usdc && leg.tokenOut.toLowerCase() === EUROPA_SUSHI.tokens.skl) ||
       (leg.tokenIn.toLowerCase() === EUROPA_SUSHI.tokens.skl && leg.tokenOut.toLowerCase() === EUROPA_SUSHI.tokens.usdc)
        ? EUROPA_SUSHI.pools.usdcSkl
        : (leg.tokenIn.toLowerCase() === EUROPA_SUSHI.tokens.skl && leg.tokenOut.toLowerCase() === EUROPA_SUSHI.tokens.eth) ||
          (leg.tokenIn.toLowerCase() === EUROPA_SUSHI.tokens.eth && leg.tokenOut.toLowerCase() === EUROPA_SUSHI.tokens.skl)
          ? EUROPA_SUSHI.pools.sklEth
          : (leg.tokenIn.toLowerCase() === EUROPA_SUSHI.tokens.eth && leg.tokenOut.toLowerCase() === EUROPA_SUSHI.tokens.usdc) ||
            (leg.tokenIn.toLowerCase() === EUROPA_SUSHI.tokens.usdc && leg.tokenOut.toLowerCase() === EUROPA_SUSHI.tokens.eth)
            ? EUROPA_SUSHI.pools.ethUsdc
            : undefined);
    if (!pool || !isAddress(pool)) throw new Error('ZERO_CAPITAL_EUROPA_QUOTE_POOL must be a verified Sushi Europa V3 pool address');
    const url = new URL('/swap/v7/2046399126', 'https://api.sushi.com');
    url.searchParams.set('referrer', 'sushi');
    url.searchParams.set('tokenIn', leg.tokenIn);
    url.searchParams.set('tokenOut', leg.tokenOut);
    url.searchParams.set('amount', amountIn.toString());
    url.searchParams.set('maxSlippage', '0.005');
    url.searchParams.set('sender', sender);
    url.searchParams.set('recipient', recipient);
    url.searchParams.set('simulate', 'false');
    url.searchParams.append('onlyPools', pool);
    const response = await fetch(url, { headers: { Origin: 'https://sushi.com' } });
    if (!response.ok) throw new Error(`Sushi Europa V3 quote failed with HTTP ${response.status}`);
    const quote = await response.json() as { status?: string; assumedAmountOut?: string; tx?: { to?: string } };
    if (quote.status !== 'Success' || !quote.assumedAmountOut) throw new Error('Sushi Europa V3 quote returned no usable amount');
    if (quote.tx?.to?.toLowerCase() !== '0xac4c6e212a361c968f1725b4d055b47e63f80b75') throw new Error('Sushi Europa V3 quote returned an unexpected Route Processor');
    return BigNumber.from(quote.assumedAmountOut);
  }

  if (leg.protocol === 'uniswapV3') {
    const quoterAddress = chain === 'europa' ? process.env.EUROPA_UNISWAP_V3_QUOTER?.trim() : UNISWAP_V3_QUOTERS[chain];
    if (!quoterAddress) throw new Error(`No Uniswap V3 quoter configured for ${chain}`);
    const quoter = new Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, provider);
    return BigNumber.from(await quoter.callStatic.quoteExactInputSingle(leg.tokenIn, leg.tokenOut, leg.feeTier || 3000, amountIn, 0));
  }

  const routerAddress = chain === 'europa' ? process.env.EUROPA_SUSHISWAP_ROUTER?.trim() : SUSHISWAP_ROUTERS[chain];
  if (!routerAddress) throw new Error(`No SushiSwap router configured for ${chain}`);
  const router = new Contract(routerAddress, SUSHISWAP_ROUTER_ABI, provider);
  const amounts = await router.getAmountsOut(amountIn, [leg.tokenIn, leg.tokenOut]);
  if (!Array.isArray(amounts) || amounts.length < 2) throw new Error('SushiSwap quote returned no output amount');
  return BigNumber.from(amounts[amounts.length - 1]);
}

async function quoteLeg(provider: providers.Provider, chain: SupportedExecutionChain, leg: ConfiguredRouteLeg, amountIn: BigNumber): Promise<BigNumber> {
  let providerQuotes = inFlightLegQuotes.get(provider);
  if (!providerQuotes) {
    providerQuotes = new Map<string, Promise<BigNumber>>();
    inFlightLegQuotes.set(provider, providerQuotes);
  }

  const key = legQuoteKey(chain, leg, amountIn);
  const existing = providerQuotes.get(key);
  if (existing) return existing;

  const pending = quoteLegUncached(provider, chain, leg, amountIn);
  providerQuotes.set(key, pending);
  try {
    return await pending;
  } finally {
    if (providerQuotes.get(key) === pending) providerQuotes.delete(key);
  }
}

function feeToDecimal(protocol: SupportedSwapProtocol, feeTier?: number, fee?: number): number {
  if (fee !== undefined) return fee;
  if (protocol === 'uniswapV3') return (feeTier || 3000) / 1_000_000;
  return 0.003;
}

export async function quoteConfiguredZeroCapitalRoute(route: ConfiguredZeroCapitalRoute, provider: providers.Provider): Promise<QuotedZeroCapitalRoute | null> {
  const quoteStartedAt = Date.now();
  const quoteDeadlineMs = maxQuoteLatencyMs();
  let currentAmount = BigNumber.from(route.amountIn);
  const initialAmount = currentAmount;
  const steps: RoutePlanningSwapStep[] = [];

  for (const leg of route.legs) {
    if (Date.now() - quoteStartedAt > quoteDeadlineMs) return null;
    const amountOut = await quoteLeg(provider, route.chain, leg, currentAmount);
    if (amountOut.lte(0)) return null;
    if (Date.now() - quoteStartedAt > quoteDeadlineMs) return null;

    steps.push({
      protocol: leg.protocol,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountIn: currentAmount.toString(),
      expectedAmountOut: amountOut.toString(),
      fee: feeToDecimal(leg.protocol, leg.feeTier, leg.fee),
    });
    currentAmount = amountOut;
  }

  const finalAmount = BigInt(currentAmount.toString());
  const initial = BigInt(initialAmount.toString());
  if (finalAmount <= initial) return null;

  const grossProfit = finalAmount - initial;
  const flashLoanFee = (initial * BigInt(Math.round((route.flashLoanFeeBps || 0)))) / 10000n;
  const gasCost = toBigInt('estimatedGasCostInInputToken', route.estimatedGasCostInInputToken);
  const relayFee = toBigInt('relayFeeInInputToken', route.relayFeeInInputToken);
  const netProfit = grossProfit - flashLoanFee - gasCost - relayFee;
  if (netProfit <= 0n) return null;

  const netProfitBps = Number((netProfit * 10000n) / initial);

  return {
    id: route.id,
    chain: route.chain,
    inputAssetSymbol: route.inputAssetSymbol,
    inputToken: route.inputToken,
    inputTokenDecimals: route.inputTokenDecimals,
    amountIn: initial,
    grossProfit,
    netProfit,
    netProfitBps,
    estimatedGasCostInInputToken: gasCost,
    flashLoanFeeInInputToken: flashLoanFee,
    relayFeeInInputToken: relayFee,
    quoteLatencyMs: Date.now() - quoteStartedAt,
    route: steps,
  };
}

export async function quoteConfiguredZeroCapitalRoutesForChain(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  routes: ConfiguredZeroCapitalRoute[] = loadConfiguredZeroCapitalRoutes(),
): Promise<QuotedZeroCapitalRoute[]> {
  const candidates = routes.filter(route => route.chain === chain);
  const settled = await Promise.allSettled(candidates.map(route => quoteConfiguredZeroCapitalRoute(route, provider)));
  const quoted: QuotedZeroCapitalRoute[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) quoted.push(result.value);
  }

  return quoted.sort((left, right) => {
    if (right.netProfit > left.netProfit) return 1;
    if (right.netProfit < left.netProfit) return -1;
    return left.quoteLatencyMs - right.quoteLatencyMs;
  });
}
