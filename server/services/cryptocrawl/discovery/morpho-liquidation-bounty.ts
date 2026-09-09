import { BigNumber, Contract, ethers, type providers } from 'ethers';
import logger from '../../../logger.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
const MORPHO_API_GRAPHQL = 'https://api.morpho.org/graphql';
const UNISWAP_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const SUSHISWAP_V2_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WAD = 10n ** 18n;
const ORACLE_PRICE_SCALE = 10n ** 36n;
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;
const LIQUIDATION_CURSOR = 300_000_000_000_000_000n;
const MAX_LIQUIDATION_INCENTIVE_FACTOR = 1_150_000_000_000_000_000n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const MORPHO_ABI = [
  'function idToMarketParams(bytes32 id) view returns (address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)',
  'function position(bytes32 id,address user) view returns (uint256 supplyShares,uint128 borrowShares,uint128 collateral)',
];

const IRM_ABI = [
  'function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee) market) view returns (uint256)',
];

const ORACLE_ABI = ['function price() view returns (uint256)'];
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];
const SUSHISWAP_V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
];

interface ApiPosition {
  healthFactor?: number | string | null;
  user?: { address?: string | null } | null;
  market?: {
    marketId?: string | null;
    listed?: boolean | null;
    lltv?: string | number | null;
    irmAddress?: string | null;
    oracle?: { address?: string | null } | null;
    loanAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
    collateralAsset?: { address?: string | null; symbol?: string | null; decimals?: number | null } | null;
  } | null;
  state?: { borrowShares?: string | null; collateral?: string | null } | null;
}

interface MarketParamsSnapshot {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
}

interface MarketSnapshot {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

interface ConversionQuote {
  protocol: 'uniswapV3' | 'sushiswap';
  fee: number;
  amountOut: bigint;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ethers.utils.isAddress(value);
}

function asBigInt(value: any): bigint {
  return BigInt(BigNumber.from(value).toString());
}

function mulDivDown(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('division by zero');
  return (x * y) / denominator;
}

function mulDivUp(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('division by zero');
  const product = x * y;
  return product === 0n ? 0n : ((product - 1n) / denominator) + 1n;
}

function toAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivDown(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
}

function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
}

function toSharesUp(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
}

function wTaylorCompounded(ratePerSecond: bigint, elapsedSeconds: bigint): bigint {
  const first = ratePerSecond * elapsedSeconds;
  const second = mulDivDown(first, first, 2n * WAD);
  const third = mulDivDown(second, first, 3n * WAD);
  return first + second + third;
}

function liquidationIncentiveFactor(lltv: bigint): bigint {
  if (lltv <= 0n || lltv >= WAD) throw new Error('invalid LLTV');
  const denominator = WAD - mulDivDown(LIQUIDATION_CURSOR, WAD - lltv, WAD);
  const dynamic = mulDivDown(WAD, WAD, denominator);
  return dynamic < MAX_LIQUIDATION_INCENTIVE_FACTOR ? dynamic : MAX_LIQUIDATION_INCENTIVE_FACTOR;
}

function bps(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NEGATIVE_INFINITY;
  const scale = 1_000_000n;
  return Number((value * 10_000n * scale) / notional) / Number(scale);
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function candidateFractionBps(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_MORPHO_LIQUIDATION_FRACTION_BPS, 1000, 100, 5000);
}

function repaymentBufferBps(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_MORPHO_REPAY_BUFFER_BPS, 50, 5, 250);
}

function outputFloorBps(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS, 9990, 9500, 10000);
}

function maxPositionsPerPass(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_MORPHO_MAX_POSITIONS_PER_PASS, 8, 1, 20);
}

function apiTimeoutMs(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_MORPHO_API_TIMEOUT_MS, 2500, 500, 8000);
}

async function fetchLiquidatablePositions(): Promise<ApiPosition[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs());
  timeout.unref?.();
  try {
    const query = `query MorphoLiquidationBounty {\n  marketPositions(\n    first: 100\n    orderBy: BorrowShares\n    orderDirection: Desc\n    where: { chainId_in: [1], marketListed: true, healthFactor_lte: 1 }\n  ) {\n    items {\n      healthFactor\n      user { address }\n      market {\n        marketId\n        listed\n        lltv\n        irmAddress\n        oracle { address }\n        loanAsset { address symbol decimals }\n        collateralAsset { address symbol decimals }\n      }\n      state { borrowShares collateral }\n    }\n  }\n}`;
    const response = await fetch(MORPHO_API_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Morpho public API HTTP ${response.status}`);
    const payload = await response.json() as any;
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      throw new Error(`Morpho public API GraphQL error: ${String(payload.errors[0]?.message || 'unknown')}`);
    }
    const items = payload?.data?.marketPositions?.items;
    return Array.isArray(items) ? items : [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMarketParams(raw: any): MarketParamsSnapshot {
  return {
    loanToken: String(raw.loanToken ?? raw[0]),
    collateralToken: String(raw.collateralToken ?? raw[1]),
    oracle: String(raw.oracle ?? raw[2]),
    irm: String(raw.irm ?? raw[3]),
    lltv: asBigInt(raw.lltv ?? raw[4]),
  };
}

function normalizeMarket(raw: any): MarketSnapshot {
  return {
    totalSupplyAssets: asBigInt(raw.totalSupplyAssets ?? raw[0]),
    totalSupplyShares: asBigInt(raw.totalSupplyShares ?? raw[1]),
    totalBorrowAssets: asBigInt(raw.totalBorrowAssets ?? raw[2]),
    totalBorrowShares: asBigInt(raw.totalBorrowShares ?? raw[3]),
    lastUpdate: asBigInt(raw.lastUpdate ?? raw[4]),
    fee: asBigInt(raw.fee ?? raw[5]),
  };
}

async function quoteCollateralToLoan(input: {
  provider: providers.Provider;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  blockTag: number;
}): Promise<ConversionQuote | null> {
  const { provider, tokenIn, tokenOut, amountIn, blockTag } = input;
  const quotes: ConversionQuote[] = [];
  const quoter = new Contract(UNISWAP_V3_QUOTER, UNISWAP_V3_QUOTER_ABI, provider);
  const tiers = [100, 500, 3000, 10000] as const;
  const v3 = await Promise.allSettled(tiers.map(async feeTier => {
    const amountOut = await quoter.callStatic.quoteExactInputSingle(
      tokenIn,
      tokenOut,
      feeTier,
      amountIn.toString(),
      0,
      { blockTag },
    );
    return { protocol: 'uniswapV3' as const, fee: feeTier / 1_000_000, amountOut: asBigInt(amountOut) };
  }));
  for (const result of v3) {
    if (result.status === 'fulfilled' && result.value.amountOut > 0n) quotes.push(result.value);
  }

  try {
    const sushi = new Contract(SUSHISWAP_V2_ROUTER, SUSHISWAP_V2_ROUTER_ABI, provider);
    const amounts = await sushi.getAmountsOut(amountIn.toString(), [tokenIn, tokenOut], { blockTag });
    const amountOut = asBigInt(amounts[amounts.length - 1]);
    if (amountOut > 0n) quotes.push({ protocol: 'sushiswap', fee: 0.003, amountOut });
  } catch {
    // Route-local absence is normal; Uniswap V3 remains independently usable.
  }

  quotes.sort((left, right) => left.amountOut === right.amountOut ? 0 : left.amountOut > right.amountOut ? -1 : 1);
  return quotes[0] ?? null;
}

async function evaluatePosition(input: {
  provider: providers.JsonRpcProvider;
  morpho: Contract;
  apiPosition: ApiPosition;
  blockNumber: number;
  blockTimestamp: number;
}): Promise<ZeroCapitalOpportunity | null> {
  const startedAt = Date.now();
  const { provider, morpho, apiPosition, blockNumber, blockTimestamp } = input;
  const market = apiPosition.market;
  const borrower = apiPosition.user?.address;
  const marketId = market?.marketId;
  const apiLoan = market?.loanAsset?.address;
  const apiCollateral = market?.collateralAsset?.address;
  const apiOracle = market?.oracle?.address;
  const apiIrm = market?.irmAddress;
  if (market?.listed !== true || !isAddress(borrower) || typeof marketId !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(marketId)) return null;
  if (!isAddress(apiLoan) || !isAddress(apiCollateral) || !isAddress(apiOracle) || !isAddress(apiIrm)) return null;
  const stable = sameAddress(apiLoan, USDC) ? { symbol: 'USDC' as const, address: USDC } : sameAddress(apiLoan, USDT) ? { symbol: 'USDT' as const, address: USDT } : null;
  if (!stable || sameAddress(apiLoan, apiCollateral)) return null;
  if (Number(market?.loanAsset?.decimals) !== 6) return null;

  const [paramsRaw, marketRaw, positionRaw] = await Promise.all([
    morpho.idToMarketParams(marketId, { blockTag: blockNumber }),
    morpho.market(marketId, { blockTag: blockNumber }),
    morpho.position(marketId, borrower, { blockTag: blockNumber }),
  ]);
  const params = normalizeMarketParams(paramsRaw);
  const state = normalizeMarket(marketRaw);
  const borrowShares = asBigInt(positionRaw.borrowShares ?? positionRaw[1]);
  const collateral = asBigInt(positionRaw.collateral ?? positionRaw[2]);
  if (
    !sameAddress(params.loanToken, apiLoan)
    || !sameAddress(params.collateralToken, apiCollateral)
    || !sameAddress(params.oracle, apiOracle)
    || !sameAddress(params.irm, apiIrm)
    || params.lltv !== BigInt(String(market?.lltv ?? '0'))
  ) throw new Error('Morpho listed-market API identity did not match exact on-chain market parameters');
  if (borrowShares <= 0n || collateral <= 0n || state.totalBorrowShares <= 0n || state.totalBorrowAssets <= 0n) return null;

  const oracle = new Contract(params.oracle, ORACLE_ABI, provider);
  const marketTuple = [
    state.totalSupplyAssets.toString(),
    state.totalSupplyShares.toString(),
    state.totalBorrowAssets.toString(),
    state.totalBorrowShares.toString(),
    state.lastUpdate.toString(),
    state.fee.toString(),
  ];
  const paramsTuple = [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv.toString()];
  const [priceRaw, borrowRateRaw] = await Promise.all([
    oracle.price({ blockTag: blockNumber }),
    sameAddress(params.irm, ZERO_ADDRESS)
      ? Promise.resolve(BigNumber.from(0))
      : new Contract(params.irm, IRM_ABI, provider).borrowRateView(paramsTuple, marketTuple, { blockTag: blockNumber }),
  ]);
  const price = asBigInt(priceRaw);
  const borrowRate = asBigInt(borrowRateRaw);
  if (price <= 0n) return null;

  const elapsed = BigInt(Math.max(0, blockTimestamp - Number(state.lastUpdate)));
  const accruedInterest = mulDivDown(state.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed), WAD);
  const accruedBorrowAssets = state.totalBorrowAssets + accruedInterest;
  const borrowedAssets = toAssetsUp(borrowShares, accruedBorrowAssets, state.totalBorrowShares);
  const collateralQuoted = mulDivDown(collateral, price, ORACLE_PRICE_SCALE);
  const maxHealthyBorrow = mulDivDown(collateralQuoted, params.lltv, WAD);
  if (borrowedAssets <= maxHealthyBorrow) return null;

  const lif = liquidationIncentiveFactor(params.lltv);
  const allDebtDown = toAssetsDown(borrowShares, accruedBorrowAssets, state.totalBorrowShares);
  const maxSeizedByDebt = mulDivDown(mulDivDown(allDebtDown, lif, WAD), ORACLE_PRICE_SCALE, price);
  const maxSeizable = collateral < maxSeizedByDebt ? collateral : maxSeizedByDebt;
  const seizedAssets = mulDivDown(maxSeizable, BigInt(candidateFractionBps()), 10_000n);
  if (seizedAssets <= 0n) return null;

  const seizedAssetsQuoted = mulDivUp(seizedAssets, price, ORACLE_PRICE_SCALE);
  const repayAssetsBeforeShares = mulDivUp(seizedAssetsQuoted, WAD, lif);
  const repaidShares = toSharesUp(repayAssetsBeforeShares, accruedBorrowAssets, state.totalBorrowShares);
  if (repaidShares <= 0n || repaidShares > borrowShares) return null;
  const exactCurrentRepayAssets = toAssetsUp(repaidShares, accruedBorrowAssets, state.totalBorrowShares);
  const flashLoanAmount = mulDivUp(exactCurrentRepayAssets, BigInt(10_000 + repaymentBufferBps()), 10_000n) + 1n;

  const conversion = await quoteCollateralToLoan({
    provider,
    tokenIn: params.collateralToken,
    tokenOut: params.loanToken,
    amountIn: seizedAssets,
    blockTag: blockNumber,
  });
  if (!conversion) return null;
  const conservativeSwapOut = mulDivDown(conversion.amountOut, BigInt(outputFloorBps()), 10_000n);
  const grossProfit = conservativeSwapOut - flashLoanAmount;
  if (grossProfit <= 0n) return null;

  const opportunity: ZeroCapitalOpportunity = {
    id: `morpho-liquidation-${marketId.slice(2, 14)}-${borrower.slice(2, 10)}-${blockNumber}`,
    type: 'liquidation',
    chain: 'ethereum',
    inputToken: params.loanToken,
    outputToken: params.loanToken,
    inputAssetSymbol: stable.symbol,
    inputTokenDecimals: 6,
    flashLoanAmount,
    expectedProfit: grossProfit,
    grossProfit,
    gasEstimate: 0n,
    estimatedExecutionCostInInputToken: 0n,
    estimatedGasCostInInputToken: 0n,
    flashLoanFeeInInputToken: 0n,
    relayFeeInInputToken: 0n,
    expectedSlippageBps: 10_000 - outputFloorBps(),
    quoteLatencyMs: Date.now() - startedAt,
    netProfitBps: bps(grossProfit, flashLoanAmount),
    route: [
      {
        protocol: 'morphoLiquidation',
        tokenIn: params.loanToken,
        tokenOut: params.collateralToken,
        amountIn: flashLoanAmount,
        expectedAmountOut: seizedAssets,
        fee: 0,
        pool: MORPHO_BLUE,
        morphoMarketId: marketId,
        morphoBorrower: borrower,
        morphoSeizedAssets: seizedAssets,
        morphoMarketParams: {
          loanToken: params.loanToken,
          collateralToken: params.collateralToken,
          oracle: params.oracle,
          irm: params.irm,
          lltv: params.lltv.toString(),
        },
      } as any,
      {
        protocol: conversion.protocol,
        tokenIn: params.collateralToken,
        tokenOut: params.loanToken,
        amountIn: seizedAssets,
        expectedAmountOut: conversion.amountOut,
        fee: conversion.fee,
      },
    ],
    confidence: 0.84,
    timestamp: Date.now(),
    expiresAt: Date.now() + 1500,
  };

  logger.info('[MorphoLiquidationBounty] Exact structural liquidation bounty measured', {
    component: 'MorphoLiquidationBounty',
    marketId,
    borrower,
    inputAssetSymbol: stable.symbol,
    liquidationIncentiveBps: bps(lif - WAD, WAD),
    grossProfitBps: opportunity.netProfitBps,
    flashLoanAmount: flashLoanAmount.toString(),
    seizedAssets: seizedAssets.toString(),
    conversionVenue: conversion.protocol,
    conversionFee: conversion.fee,
    blockNumber,
    source: 'morpho_public_listed_positions_plus_exact_onchain_state',
    apiKeyRequired: false,
    userCapitalRequired: false,
    preliminaryGasCostAuthority: false,
    finalEligibilityAuthority: 'canonical_provider_repricing_and_prebroadcast_simulation',
    executionAuthority: false,
    syntheticProfitAllowed: false,
  });
  return opportunity;
}

export async function discoverMorphoLiquidationBounties(
  provider: providers.JsonRpcProvider,
): Promise<ZeroCapitalOpportunity[]> {
  if (process.env.ZERO_CAPITAL_MORPHO_LIQUIDATION === 'false') return [];
  const startedAt = Date.now();
  try {
    const [apiPositions, block] = await Promise.all([
      fetchLiquidatablePositions(),
      provider.getBlock('latest'),
    ]);
    if (!block) return [];
    const filtered = apiPositions.filter(position => {
      const loan = position.market?.loanAsset?.address;
      return position.market?.listed === true && isAddress(loan) && (sameAddress(loan, USDC) || sameAddress(loan, USDT));
    }).slice(0, maxPositionsPerPass());
    if (filtered.length === 0) return [];

    const morpho = new Contract(MORPHO_BLUE, MORPHO_ABI, provider);
    const settled = await Promise.allSettled(filtered.map(apiPosition => evaluatePosition({
      provider,
      morpho,
      apiPosition,
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
    })));
    const opportunities: ZeroCapitalOpportunity[] = [];
    let rejected = 0;
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        if (result.value) opportunities.push(result.value);
      } else {
        rejected += 1;
        logger.debug('[MorphoLiquidationBounty] Candidate failed closed during exact validation', {
          component: 'MorphoLiquidationBounty',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          executionAuthority: false,
          syntheticProfitAllowed: false,
        });
      }
    }
    opportunities.sort((left, right) => right.netProfitBps - left.netProfitBps);
    logger.info('[MorphoLiquidationBounty] Structural liquidation frontier refreshed', {
      component: 'MorphoLiquidationBounty',
      apiPositions: apiPositions.length,
      listedStablecoinPositionsEvaluated: filtered.length,
      positiveStructuralCandidates: opportunities.length,
      rejected,
      bestGrossBps: opportunities[0]?.netProfitBps ?? null,
      latencyMs: Date.now() - startedAt,
      apiKeyRequired: false,
      userCapitalRequired: false,
      canonicalCandidateRowsCreated: 0,
      finalEligibilityAuthority: 'canonical_provider_repricing_and_prebroadcast_simulation',
      executionAuthority: false,
      syntheticProfitAllowed: false,
    });
    return opportunities;
  } catch (error) {
    logger.warn('[MorphoLiquidationBounty] Public liquidation frontier unavailable; lane failed closed', {
      component: 'MorphoLiquidationBounty',
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
      apiKeyRequired: false,
      executionAuthority: false,
      syntheticProfitAllowed: false,
    });
    return [];
  }
}
