import { BigNumber, Contract, providers } from 'ethers';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../../api/blockchain-providers.js';
import type { RoutePlanningSwapStep } from './autonomous-route-planner.js';
import type {
  SupportedExecutionChain,
  SupportedSwapProtocol,
  UniswapV3FeeTier,
} from './onchain-payload-builder.js';
import { EUROPA_SUSHI } from './europa-sushi-registry.js';
import { buildAtomicNotionalCandidates, selectHighestNetProfit } from './atomic-size-optimizer.js';
import { getProfitLadderDiscoveryNotionalAuthority } from '../../governance/profit-ladder-notional-authority.js';
import {
  ETHEREUM_PROTOCOL_ANCHORS,
  defaultEthereumProtocolAnchorRoutes,
  quoteProtocolAnchorLeg,
} from './protocol-anchor-adapter.js';
import {
  quoteFluidSwapInViaOfficialResolver,
  quoteSkyPrimaryMarketLeg,
} from './primary-market-anchor-adapter.js';
import { defaultEthereumPrimaryMarketAnchorRoutes } from './primary-market-anchor-routes.js';

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
];

const UNISWAP_V3_QUOTERS: Partial<Record<SupportedExecutionChain, string>> = {
  ethereum: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  polygon: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  arbitrum: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  optimism: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
};

const V2_ROUTERS: Partial<Record<SupportedSwapProtocol, Partial<Record<SupportedExecutionChain, string>>>> = {
  sushiswap: {
    ethereum: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    polygon: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    bsc: '0x1b02dA8Cb0d097e8D57A175b88c7D8b47997506',
    avalanche: '0x1b02dA8Cb0d097e8D57A175b88c7D8b47997506',
  },
  pancakeswapV2: {
    bsc: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  },
  traderJoeV1: {
    avalanche: '0x60aE616a2155Ee3dA68541Ba4544862310933d4',
  },
};

export interface ConfiguredRouteLeg {
  protocol: SupportedSwapProtocol;
  tokenIn: string;
  tokenOut: string;
  pool?: string;
  feeTier?: UniswapV3FeeTier;
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
  grossProfitBps: number;
  allInCostBps: number;
  breakEvenBps: number;
  bpsToBreakEven: number;
  discoveryFloorBps: number;
  executablePositive: boolean;
  estimatedGasCostInInputToken: bigint;
  flashLoanFeeInInputToken: bigint;
  relayFeeInInputToken: bigint;
  quoteLatencyMs: number;
  route: RoutePlanningSwapStep[];
}

interface ResidentBestBpsQuote {
  quote: QuotedZeroCapitalRoute;
  observedAt: number;
  expiresAt: number;
}

const inFlightLegQuotes = new WeakMap<providers.Provider, Map<string, Promise<BigNumber>>>();
const residentBestBpsQuotes = new Map<string, ResidentBestBpsQuote>();
const BPS_PRECISION = 1_000_000n;

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

function ratioToBps(value: bigint, notional: bigint): number {
  if (notional <= 0n) throw new Error('BPS notional must be positive');
  return Number((value * 10_000n * BPS_PRECISION) / notional) / Number(BPS_PRECISION);
}

function feeFromBps(notional: bigint, bps: number): bigint {
  if (!Number.isFinite(bps) || bps < 0) throw new Error('Flash-loan BPS must be a finite non-negative number');
  const scaledBps = BigInt(Math.round(bps * Number(BPS_PRECISION)));
  return (notional * scaledBps) / (10_000n * BPS_PRECISION);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function normalizeProtocol(value: unknown): SupportedSwapProtocol {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3') return 'uniswapV3';
  if (normalized === 'sushiswap' || normalized === 'sushi') return 'sushiswap';
  if (normalized === 'sushiswapv3' || normalized === 'sushi_v3' || normalized === 'sushi-v3') return 'sushiswapV3';
  if (normalized === 'pancakeswapv2' || normalized === 'pancakeswap_v2' || normalized === 'pancake-v2' || normalized === 'pancakeswap-v2' || normalized === 'pancakev2') return 'pancakeswapV2';
  if (normalized === 'traderjoev1' || normalized === 'traderjoe_v1' || normalized === 'traderjoe-v1' || normalized === 'joev1' || normalized === 'joe-v1') return 'traderJoeV1';
  if (normalized === 'aaveghogsm' || normalized === 'aave_gho_gsm' || normalized === 'aave-gho-gsm') return 'aaveGhoGsm';
  if (normalized === 'fluiddext1' || normalized === 'fluid_dex_t1' || normalized === 'fluid-dex-t1') return 'fluidDexT1';
  if (normalized === 'skylitepsm' || normalized === 'sky_lite_psm' || normalized === 'sky-lite-psm') return 'skyLitePsm';
  if (normalized === 'skydaiusds' || normalized === 'sky_dai_usds' || normalized === 'sky-dai-usds') return 'skyDaiUsds';
  throw new Error(`Unsupported route protocol: ${String(value)}`);
}

function asSupportedChain(value: unknown): SupportedExecutionChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'polygon' || normalized === 'arbitrum' || normalized === 'optimism' || normalized === 'bsc' || normalized === 'avalanche' || normalized === 'europa') return normalized;
  throw new Error(`Unsupported route chain: ${String(value)}`);
}

function routeTtlMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_ROUTE_TTL_MS || 3_000);
  return Number.isFinite(configured) ? Math.max(500, Math.min(60_000, Math.trunc(configured))) : 3_000;
}

function maxQuoteLatencyMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_MAX_QUOTE_LATENCY_MS || 1_000);
  const configuredBound = Number.isFinite(configured)
    ? Math.max(250, Math.min(30_000, Math.trunc(configured)))
    : 1_000;
  const routeTtl = Number(process.env.ZERO_CAPITAL_ROUTE_TTL_MS || 3_000);
  if (!Number.isFinite(routeTtl) || routeTtl <= 500) return configuredBound;
  // A quote that consumes the entire opportunity lifetime is observation, not
  // execution evidence. Reserve at least 250 ms for provider/resource admission.
  return Math.min(configuredBound, Math.max(250, Math.trunc(routeTtl) - 250));
}

function withQuoteTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const boundedTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} exceeded the remaining ${boundedTimeoutMs}ms quote deadline`)),
      boundedTimeoutMs,
    );
    timer.unref?.();
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Historical observation-priority hint retained for ranking/telemetry only.
 * It is never a measurement floor. Every structurally valid route that returns
 * executable quote amounts remains numerically measurable regardless of how far
 * below break-even it is; only positive all-in net economics can execute.
 */
export function zeroCapitalDiscoveryFloorBps(): number {
  const configured = Number(process.env.ZERO_CAPITAL_DISCOVERY_FLOOR_BPS ?? -100);
  if (!Number.isFinite(configured)) return -100;
  return Math.max(-500, Math.min(0, Math.trunc(configured)));
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
    if (pool !== undefined && !isAddress(pool)) throw new Error(`Route ${index} leg ${legIndex} pool must be a valid address`);

    const feeTier = leg.feeTier === undefined ? undefined : Number(leg.feeTier);
    if (feeTier !== undefined && feeTier !== 100 && feeTier !== 500 && feeTier !== 3000 && feeTier !== 10000) {
      throw new Error(`Route ${index} leg ${legIndex} feeTier must be 100, 500, 3000, or 10000`);
    }

    const fee = leg.fee === undefined ? undefined : Number(leg.fee);
    if (fee !== undefined && (!Number.isFinite(fee) || fee < 0 || fee > 0.1)) throw new Error(`Route ${index} leg ${legIndex} fee must be a decimal fraction between 0 and 0.1`);

    return {
      protocol: normalizeProtocol(leg.protocol),
      tokenIn,
      tokenOut,
      ...(pool !== undefined ? { pool } : {}),
      ...(feeTier !== undefined ? { feeTier: feeTier as UniswapV3FeeTier } : {}),
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
  const includeProtocolAnchors = arguments.length === 0 && process.env.ZERO_CAPITAL_PROTOCOL_ANCHORS !== 'false';
  const anchorDefinitions = includeProtocolAnchors
    ? [...defaultEthereumProtocolAnchorRoutes(), ...defaultEthereumPrimaryMarketAnchorRoutes()]
    : [];
  const anchorRoutes = anchorDefinitions.map((route, index) => parseConfiguredRoute(route, index));
  if (!raw.trim()) return anchorRoutes;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ZERO_CAPITAL_ROUTE_CONFIG must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('ZERO_CAPITAL_ROUTE_CONFIG must be a JSON array');

  const routes = parsed.map((route, index) => parseConfiguredRoute(route, anchorRoutes.length + index));
  const merged = [...anchorRoutes, ...routes];
  const routeIds = new Set<string>();
  for (const route of merged) {
    const normalizedId = route.id.toLowerCase();
    if (routeIds.has(normalizedId)) throw new Error(`ZERO_CAPITAL_ROUTE_CONFIG contains duplicate route id: ${route.id}`);
    routeIds.add(normalizedId);
  }
  return merged;
}

function legQuoteKey(chain: SupportedExecutionChain, leg: ConfiguredRouteLeg, amountIn: BigNumber): string {
  return [chain, leg.protocol, normalizeAddress(leg.tokenIn), normalizeAddress(leg.tokenOut), leg.pool ? normalizeAddress(leg.pool) : '', leg.feeTier || '', leg.fee ?? '', amountIn.toString()].join(':');
}

async function quoteLegAgainstProvider(
  rpcProvider: providers.Provider,
  chain: SupportedExecutionChain,
  leg: ConfiguredRouteLeg,
  amountIn: BigNumber,
): Promise<BigNumber> {
  if (leg.protocol === 'skyLitePsm' || leg.protocol === 'skyDaiUsds') {
    if (chain !== 'ethereum') throw new Error(`${leg.protocol} primary-market anchor is currently reviewed only for Ethereum`);
    if (!leg.pool) throw new Error(`${leg.protocol} primary-market anchor requires an exact module address`);
    return quoteSkyPrimaryMarketLeg(rpcProvider, {
      protocol: leg.protocol,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      pool: leg.pool,
    }, amountIn);
  }

  if (leg.protocol === 'fluidDexT1') {
    if (chain !== 'ethereum') throw new Error('fluidDexT1 protocol anchor is currently reviewed only for Ethereum');
    if (!leg.pool) throw new Error('fluidDexT1 protocol anchor requires an exact pool address');
    const tokenIn = normalizeAddress(leg.tokenIn);
    const tokenOut = normalizeAddress(leg.tokenOut);
    const gho = normalizeAddress(ETHEREUM_PROTOCOL_ANCHORS.gho);
    const usdc = normalizeAddress(ETHEREUM_PROTOCOL_ANCHORS.usdc);
    const swap0to1 = tokenIn === gho && tokenOut === usdc;
    const swap1to0 = tokenIn === usdc && tokenOut === gho;
    if (!swap0to1 && !swap1to0) throw new Error('Fluid anchor resolver supports only the reviewed GHO/USDC pair');
    try {
      return await quoteFluidSwapInViaOfficialResolver(rpcProvider, leg.pool, swap0to1, amountIn);
    } catch {
      // Some RPCs normalize custom revert data differently. The official resolver
      // is preferred, while the reviewed direct DEAD-recipient simulation remains
      // an exact-state fallback rather than a synthetic quote.
      return quoteProtocolAnchorLeg(rpcProvider, {
        protocol: leg.protocol,
        tokenIn: leg.tokenIn,
        tokenOut: leg.tokenOut,
        pool: leg.pool,
      }, amountIn);
    }
  }

  if (leg.protocol === 'aaveGhoGsm') {
    if (chain !== 'ethereum') throw new Error('aaveGhoGsm protocol anchor is currently reviewed only for Ethereum');
    if (!leg.pool) throw new Error('aaveGhoGsm protocol anchor requires an exact module/pool address');
    return quoteProtocolAnchorLeg(rpcProvider, {
      protocol: leg.protocol,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      pool: leg.pool,
    }, amountIn);
  }

  if (leg.protocol === 'uniswapV3') {
    const quoterAddress = chain === 'europa' ? process.env.EUROPA_UNISWAP_V3_QUOTER?.trim() : UNISWAP_V3_QUOTERS[chain];
    if (!quoterAddress) throw new Error(`No Uniswap V3 quoter configured for ${chain}`);
    const quoter = new Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, rpcProvider);
    return BigNumber.from(await quoter.callStatic.quoteExactInputSingle(leg.tokenIn, leg.tokenOut, leg.feeTier || 3000, amountIn, 0));
  }

  if (leg.protocol === 'sushiswapV3') {
    throw new Error(`Sushi V3 ${chain} routes require a verified V3 quote authority`);
  }

  const routerAddress = chain === 'europa' && leg.protocol === 'sushiswap'
    ? process.env.EUROPA_SUSHISWAP_ROUTER?.trim()
    : V2_ROUTERS[leg.protocol]?.[chain];
  if (!routerAddress || !isAddress(routerAddress)) throw new Error(`No ${leg.protocol} V2 quote router configured for ${chain}`);
  const router = new Contract(routerAddress, V2_ROUTER_ABI, rpcProvider);
  const amounts = await router.getAmountsOut(amountIn, [leg.tokenIn, leg.tokenOut]);
  if (!Array.isArray(amounts) || amounts.length < 2) throw new Error(`${leg.protocol} quote returned no output amount`);
  return BigNumber.from(amounts[amounts.length - 1]);
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

  // Active EVM route evidence is acquired through the canonical provider mesh.
  // The manager retries independent healthy providers for the same deterministic
  // eth_call before this route is considered temporarily unquoted. The caller's
  // provider is retained only for retired/non-mesh compatibility paths.
  if (chain !== 'europa') {
    const { result } = await multiProviderRpcManager.execute(
      chain as RpcSupportedChain,
      'contract_calls',
      rpcProvider => quoteLegAgainstProvider(rpcProvider, chain, leg, amountIn),
    );
    return BigNumber.from(result);
  }

  return quoteLegAgainstProvider(provider, chain, leg, amountIn);
}

async function quoteLeg(
  provider: providers.Provider,
  chain: SupportedExecutionChain,
  leg: ConfiguredRouteLeg,
  amountIn: BigNumber,
  timeoutMs: number,
): Promise<BigNumber> {
  let providerQuotes = inFlightLegQuotes.get(provider);
  if (!providerQuotes) {
    providerQuotes = new Map<string, Promise<BigNumber>>();
    inFlightLegQuotes.set(provider, providerQuotes);
  }

  const key = legQuoteKey(chain, leg, amountIn);
  const existing = providerQuotes.get(key);
  if (existing) return withQuoteTimeout(existing, timeoutMs, `${chain}:${leg.protocol} shared leg quote`);

  // Cache the bounded promise, never the raw RPC. A provider call that stops
  // answering must not pin this key forever or prevent the recurring scanner from
  // scheduling its next cycle. The underlying RPC may eventually settle, but it
  // has handlers attached here and is no longer an authority after the deadline.
  const pending = withQuoteTimeout(
    quoteLegUncached(provider, chain, leg, amountIn),
    Math.min(maxQuoteLatencyMs(), Math.max(1, timeoutMs)),
    `${chain}:${leg.protocol} leg quote`,
  );
  providerQuotes.set(key, pending);
  try {
    return await pending;
  } finally {
    if (providerQuotes.get(key) === pending) providerQuotes.delete(key);
  }
}

function feeToDecimal(protocol: SupportedSwapProtocol, feeTier?: number, fee?: number): number {
  if (protocol === 'aaveGhoGsm' || protocol === 'fluidDexT1' || protocol === 'skyLitePsm' || protocol === 'skyDaiUsds') return 0;
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
    const elapsedMs = Date.now() - quoteStartedAt;
    const remainingMs = quoteDeadlineMs - elapsedMs;
    if (remainingMs <= 0) return null;
    let amountOut: BigNumber;
    try {
      amountOut = await quoteLeg(provider, route.chain, leg, currentAmount, remainingMs);
    } catch (error) {
      if (error instanceof Error && error.message.includes('quote deadline')) return null;
      throw error;
    }
    if (amountOut.lte(0)) return null;
    if (Date.now() - quoteStartedAt > quoteDeadlineMs) return null;

    steps.push({
      protocol: leg.protocol,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountIn: currentAmount.toString(),
      expectedAmountOut: amountOut.toString(),
      fee: feeToDecimal(leg.protocol, leg.feeTier, leg.fee),
      ...(leg.pool ? { pool: leg.pool } : {}),
    });
    currentAmount = amountOut;
  }

  const finalAmount = BigInt(currentAmount.toString());
  const initial = BigInt(initialAmount.toString());
  if (initial <= 0n) return null;

  const grossProfit = finalAmount - initial;
  const flashLoanFee = feeFromBps(initial, route.flashLoanFeeBps || 0);
  const gasCost = toBigInt('estimatedGasCostInInputToken', route.estimatedGasCostInInputToken);
  const relayFee = toBigInt('relayFeeInInputToken', route.relayFeeInInputToken);
  const allInCost = flashLoanFee + gasCost + relayFee;
  const netProfit = grossProfit - allInCost;
  const grossProfitBps = ratioToBps(grossProfit, initial);
  const allInCostBps = ratioToBps(allInCost, initial);
  const netProfitBps = ratioToBps(netProfit, initial);
  const discoveryFloorBps = zeroCapitalDiscoveryFloorBps();

  // Do not erase a successfully measured route because it is economically bad.
  // A deeply negative quote is still valuable measurement and must remain visible
  // as numeric BPS/distance-to-break-even. Profitability controls execution below.
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
    grossProfitBps,
    allInCostBps,
    breakEvenBps: allInCostBps,
    bpsToBreakEven: netProfitBps >= 0 ? 0 : Math.abs(netProfitBps),
    discoveryFloorBps,
    executablePositive: netProfit > 0n,
    estimatedGasCostInInputToken: gasCost,
    flashLoanFeeInInputToken: flashLoanFee,
    relayFeeInInputToken: relayFee,
    quoteLatencyMs: Date.now() - quoteStartedAt,
    route: steps,
  };
}

function pow10(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Unsupported input token decimals: ${decimals}`);
  }
  return 10n ** BigInt(decimals);
}

function baseUnitsFromUsd(usd: number, decimals: number): string {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`USD notional must be a finite positive number: ${usd}`);
  const precision = Math.min(decimals, 12);
  const fixed = usd.toFixed(precision);
  const [whole, fraction = ''] = fixed.split('.');
  const scale = pow10(decimals);
  const wholeUnits = BigInt(whole) * scale;
  const fractionUnits = decimals === 0
    ? 0n
    : BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0');
  const total = wholeUnits + fractionUnits;
  return (total > 0n ? total : 1n).toString();
}

function usdFromBaseUnits(value: bigint, decimals: number): number {
  const scale = Number(pow10(decimals));
  const usd = Number(value) / scale;
  return Number.isFinite(usd) ? usd : 0;
}

function routeNotionalCandidates(route: ConfiguredZeroCapitalRoute): number[] {
  const seedUsd = Math.max(0.000001, usdFromBaseUnits(BigInt(route.amountIn), route.inputTokenDecimals));
  const discoveryAuthority = getProfitLadderDiscoveryNotionalAuthority();
  const ladderCeiling = Math.max(seedUsd, discoveryAuthority.maxQuoteNotionalUsd || seedUsd);
  const rawConfiguredCeiling = Number(process.env.ZERO_CAPITAL_MAX_DISCOVERY_NOTIONAL_USD || ladderCeiling);
  const configuredCeiling = Number.isFinite(rawConfiguredCeiling) && rawConfiguredCeiling > 0
    ? Math.min(discoveryAuthority.systemMaxNotionalUsd, rawConfiguredCeiling)
    : ladderCeiling;
  const maximumNotionalUsd = Math.max(seedUsd, Math.min(ladderCeiling, configuredCeiling));

  return buildAtomicNotionalCandidates({
    seedNotionalUsd: seedUsd,
    maximumNotionalUsd,
    minimumNotionalUsd: 0.01,
    maxCandidates: Math.max(3, Math.min(12, Number(process.env.ZERO_CAPITAL_SIZE_CANDIDATES || 9))),
  });
}

function bestBpsQuote(observed: readonly QuotedZeroCapitalRoute[]): QuotedZeroCapitalRoute | null {
  let best: QuotedZeroCapitalRoute | null = null;
  for (const quote of observed) {
    if (!Number.isFinite(quote.netProfitBps)) continue;
    if (!best || quote.netProfitBps > best.netProfitBps) {
      best = quote;
      continue;
    }
    if (quote.netProfitBps === best.netProfitBps && quote.netProfit > best.netProfit) best = quote;
  }
  return best;
}

function rememberResidentBestBpsQuote(routeId: string, observed: readonly QuotedZeroCapitalRoute[]): void {
  const best = bestBpsQuote(observed);
  if (!best) return;
  const observedAt = Date.now();
  residentBestBpsQuotes.set(routeId, {
    quote: best,
    observedAt,
    expiresAt: observedAt + routeTtlMs(),
  });
}

/**
 * APE read-only resident view. The quote was already produced by the canonical
 * bounded size sweep before Stage 1; this getter creates no quote/RPC/API work and
 * returns the stored object reference without copying it.
 */
export function peekResidentBestBpsQuote(routeId: string, now = Date.now()): QuotedZeroCapitalRoute | null {
  const entry = residentBestBpsQuotes.get(routeId);
  if (!entry || entry.expiresAt <= now) {
    if (entry) residentBestBpsQuotes.delete(routeId);
    return null;
  }
  return entry.quote;
}

async function quoteBestRouteSize(
  route: ConfiguredZeroCapitalRoute,
  provider: providers.Provider,
): Promise<QuotedZeroCapitalRoute | null> {
  const sizes = routeNotionalCandidates(route);
  const settled = await Promise.allSettled(sizes.map(notionalUsd =>
    quoteConfiguredZeroCapitalRoute({ ...route, amountIn: baseUnitsFromUsd(notionalUsd, route.inputTokenDecimals) }, provider),
  ));
  const observed = settled
    .filter((result): result is PromiseFulfilledResult<QuotedZeroCapitalRoute | null> => result.status === 'fulfilled')
    .map(result => result.value)
    .filter((quote): quote is QuotedZeroCapitalRoute => !!quote);
  if (observed.length === 0) return null;

  // Side evidence only: preserve the best already-measured BPS variant for APE.
  // Stage 1 still receives exactly the same highest-dollar-profit size as before.
  rememberResidentBestBpsQuote(route.id, observed);

  const positive = observed.filter(quote => quote.netProfit > 0n);

  // Exact deterministic all-in economics is the sole profitability authority at
  // quote-size selection. Heuristic slippage/liquidity/volatility scoring may rank
  // or advise elsewhere, but it cannot erase a fresh strictly-positive quote.
  // Provider/resource admission and the canonical pre-broadcast barrier still
  // independently prove executable capability before any transaction is sent.
  const selectionPool = positive.length > 0 ? positive : observed;
  return selectHighestNetProfit(selectionPool, quote => quote.netProfit);
}

/**
 * Each configured atomic route is independently quoted across a bounded notional
 * curve and selected by the largest measured all-in net profit. Profit is never
 * extrapolated linearly from a smaller quote. Every route with executable quote
 * amounts remains measurable; any strictly-positive exact quote remains visible
 * for canonical provider/resource admission and pre-broadcast validation.
 */
export async function quoteConfiguredZeroCapitalRoutesForChain(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  routes: ConfiguredZeroCapitalRoute[] = loadConfiguredZeroCapitalRoutes(),
): Promise<QuotedZeroCapitalRoute[]> {
  const candidates = routes.filter(route => route.chain === chain);
  const settled = await Promise.allSettled(candidates.map(route => quoteBestRouteSize(route, provider)));
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
