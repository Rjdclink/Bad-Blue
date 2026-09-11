import { BigNumber, Contract, ethers, providers } from 'ethers';
import logger from '../../../logger.js';

export type ProtocolAnchorProtocol = 'aaveGhoGsm' | 'fluidDexT1';

/**
 * Current Ethereum GHO protocol-anchor surfaces.
 *
 * Aave's current mainnet GSMs are Gsm4626 deployments: their UNDERLYING_ASSET is
 * the Aave ERC4626 StataToken share, not raw USDC/USDT. Raw stablecoins must
 * therefore be wrapped/unwrapped through the reviewed StataToken vault around
 * the GSM leg. Addresses are current Aave address-book values; live contract
 * identity/state remains authoritative at quote time.
 */
export const ETHEREUM_PROTOCOL_ANCHORS = {
  gho: '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  gsmUsdc: '0x3A3868898305f04beC7FEa77BecFf04C13444112',
  gsmUsdt: '0x882285E62656b9623AF136Ce3078c6BdCc33F5E3',
  stataUsdc: '0xD4fa2D31b7968E448877f69A96DE69f5de8cD23E',
  stataUsdt: '0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8',
  fluidGhoUsdc: '0xdE632C3a214D5f14C1d8ddF0b92F8BCd188fee45',
} as const;

const DEAD = '0x000000000000000000000000000000000000dEaD';
const FLUID_SWAP_RESULT_SELECTOR = ethers.utils.id('FluidDexSwapResult(uint256)').slice(0, 10).toLowerCase();
const GSM_NEGATIVE_CAPACITY_TTL_MS = Math.max(
  500,
  Math.min(5000, Number(process.env.AAVE_GHO_GSM_NEGATIVE_CAPACITY_TTL_MS || 2500)),
);

type GsmNegativeCapacityObservation = { untilMs: number; error: Error };
const gsmQuoteInFlight = new Map<string, Promise<BigNumber>>();
const gsmNegativeCapacity = new Map<string, GsmNegativeCapacityObservation>();

const GSM_ABI = [
  'function GHO_TOKEN() view returns (address)',
  'function UNDERLYING_ASSET() view returns (address)',
  'function canSwap() view returns (bool)',
  'function getIsFrozen() view returns (bool)',
  'function getIsSeized() view returns (bool)',
  'function getAvailableUnderlyingExposure() view returns (uint256)',
  'function getAvailableLiquidity() view returns (uint256)',
  'function getAssetAmountForBuyAsset(uint256 maxGhoAmount) view returns (uint256 assetAmount, uint256 ghoAmount, uint256 grossAmount, uint256 fee)',
  'function getGhoAmountForSellAsset(uint256 maxAssetAmount) view returns (uint256 assetAmount, uint256 ghoAmount, uint256 grossAmount, uint256 fee)',
  'function buyAsset(uint256 minAmount, address receiver) returns (uint256 assetAmount, uint256 ghoAmount)',
  'function sellAsset(uint256 maxAmount, address receiver) returns (uint256 assetAmount, uint256 ghoAmount)',
];

const STATA_ABI = [
  'function asset() view returns (address)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function previewRedeem(uint256 shares) view returns (uint256 assets)',
  'function maxDeposit(address receiver) view returns (uint256 assets)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
];

const FLUID_DEX_ABI = [
  'function swapIn(bool swap0to1, uint256 amountIn, uint256 amountOutMin, address to) payable returns (uint256 amountOut)',
];

export interface ProtocolAnchorLeg {
  protocol: ProtocolAnchorProtocol;
  tokenIn: string;
  tokenOut: string;
  pool: string;
}

export interface BuiltProtocolAnchorCall {
  target: string;
  data: string;
  value: string;
  gasLimit: number;
  approvalToken: string;
  approvalAmount: string;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function reviewedStataForRaw(raw: string): string | null {
  if (sameAddress(raw, ETHEREUM_PROTOCOL_ANCHORS.usdc)) return ETHEREUM_PROTOCOL_ANCHORS.stataUsdc;
  if (sameAddress(raw, ETHEREUM_PROTOCOL_ANCHORS.usdt)) return ETHEREUM_PROTOCOL_ANCHORS.stataUsdt;
  return null;
}

function reviewedRawForStata(stata: string): string | null {
  if (sameAddress(stata, ETHEREUM_PROTOCOL_ANCHORS.stataUsdc)) return ETHEREUM_PROTOCOL_ANCHORS.usdc;
  if (sameAddress(stata, ETHEREUM_PROTOCOL_ANCHORS.stataUsdt)) return ETHEREUM_PROTOCOL_ANCHORS.usdt;
  return null;
}

export function resolveProtocolAnchorPool(
  protocol: ProtocolAnchorProtocol,
  tokenIn: string,
  tokenOut: string,
  configuredPool?: string,
): string {
  if (configuredPool) return requireAddress('protocol anchor pool', configuredPool);
  const A = ETHEREUM_PROTOCOL_ANCHORS;
  if (protocol === 'fluidDexT1') {
    const isPair = (sameAddress(tokenIn, A.gho) && sameAddress(tokenOut, A.usdc))
      || (sameAddress(tokenIn, A.usdc) && sameAddress(tokenOut, A.gho));
    if (!isPair) throw new Error('Fluid anchor target inference supports only the reviewed GHO/USDC pool');
    return A.fluidGhoUsdc;
  }

  if ((sameAddress(tokenIn, A.gho) && sameAddress(tokenOut, A.stataUsdc))
    || (sameAddress(tokenOut, A.gho) && sameAddress(tokenIn, A.stataUsdc))) return A.gsmUsdc;
  if ((sameAddress(tokenIn, A.gho) && sameAddress(tokenOut, A.stataUsdt))
    || (sameAddress(tokenOut, A.gho) && sameAddress(tokenIn, A.stataUsdt))) return A.gsmUsdt;

  if ((sameAddress(tokenIn, A.usdc) && sameAddress(tokenOut, A.stataUsdc))
    || (sameAddress(tokenOut, A.usdc) && sameAddress(tokenIn, A.stataUsdc))) return A.stataUsdc;
  if ((sameAddress(tokenIn, A.usdt) && sameAddress(tokenOut, A.stataUsdt))
    || (sameAddress(tokenOut, A.usdt) && sameAddress(tokenIn, A.stataUsdt))) return A.stataUsdt;

  throw new Error('Aave GHO GSM target inference supports only reviewed GHO/StataToken and raw/StataToken pairs');
}

function requireEthereumAnchorLeg(leg: ProtocolAnchorLeg): void {
  requireAddress('protocol anchor pool', leg.pool);
  requireAddress('protocol anchor tokenIn', leg.tokenIn);
  requireAddress('protocol anchor tokenOut', leg.tokenOut);
  if (sameAddress(leg.tokenIn, leg.tokenOut)) throw new Error('Protocol anchor leg cannot swap a token into itself');
}

function knownGsmUnderlying(pool: string): string | null {
  if (sameAddress(pool, ETHEREUM_PROTOCOL_ANCHORS.gsmUsdc)) return ETHEREUM_PROTOCOL_ANCHORS.stataUsdc;
  if (sameAddress(pool, ETHEREUM_PROTOCOL_ANCHORS.gsmUsdt)) return ETHEREUM_PROTOCOL_ANCHORS.stataUsdt;
  return null;
}

function validateKnownGsmLeg(leg: ProtocolAnchorLeg): { ghoIn: boolean; underlying: string } {
  const underlying = knownGsmUnderlying(leg.pool);
  if (!underlying) throw new Error('Unreviewed Aave GHO GSM address');
  const ghoIn = sameAddress(leg.tokenIn, ETHEREUM_PROTOCOL_ANCHORS.gho);
  const ghoOut = sameAddress(leg.tokenOut, ETHEREUM_PROTOCOL_ANCHORS.gho);
  if (ghoIn === ghoOut) throw new Error('Aave GHO GSM leg must contain exactly one GHO side');
  const other = ghoIn ? leg.tokenOut : leg.tokenIn;
  if (!sameAddress(other, underlying)) throw new Error('Aave GHO GSM underlying does not match reviewed StataToken module');
  return { ghoIn, underlying };
}

function validateStataLeg(leg: ProtocolAnchorLeg): { rawIn: boolean; raw: string; stata: string } {
  const pool = requireAddress('Aave StataToken vault', leg.pool);
  const rawFromPool = reviewedRawForStata(pool);
  if (!rawFromPool) throw new Error('Unreviewed Aave StataToken vault address');
  const stata = reviewedStataForRaw(rawFromPool);
  if (!stata || !sameAddress(stata, pool)) throw new Error('Aave StataToken registry mismatch');

  const rawIn = sameAddress(leg.tokenIn, rawFromPool) && sameAddress(leg.tokenOut, stata);
  const sharesIn = sameAddress(leg.tokenIn, stata) && sameAddress(leg.tokenOut, rawFromPool);
  if (!rawIn && !sharesIn) throw new Error('Aave StataToken wrapper leg does not match reviewed raw/share pair');
  return { rawIn, raw: rawFromPool, stata };
}

function isReviewedStataPool(pool: string): boolean {
  return sameAddress(pool, ETHEREUM_PROTOCOL_ANCHORS.stataUsdc)
    || sameAddress(pool, ETHEREUM_PROTOCOL_ANCHORS.stataUsdt);
}

function validateFluidGhoUsdcLeg(leg: ProtocolAnchorLeg): boolean {
  if (!sameAddress(leg.pool, ETHEREUM_PROTOCOL_ANCHORS.fluidGhoUsdc)) throw new Error('Unreviewed Fluid GHO/USDC pool address');
  const token0to1 = sameAddress(leg.tokenIn, ETHEREUM_PROTOCOL_ANCHORS.gho) && sameAddress(leg.tokenOut, ETHEREUM_PROTOCOL_ANCHORS.usdc);
  const token1to0 = sameAddress(leg.tokenIn, ETHEREUM_PROTOCOL_ANCHORS.usdc) && sameAddress(leg.tokenOut, ETHEREUM_PROTOCOL_ANCHORS.gho);
  if (!token0to1 && !token1to0) throw new Error('Fluid anchor leg must be GHO/USDC on the reviewed pool');
  return token0to1;
}

function extractRevertData(error: unknown): string | null {
  const candidate = error as any;
  const values = [candidate?.data, candidate?.error?.data, candidate?.error?.error?.data, candidate?.receipt?.revertReason];
  for (const value of values) {
    if (typeof value === 'string' && ethers.utils.isHexString(value)) return value;
  }
  return null;
}

function decodeFluidSwapResult(raw: string | null): BigNumber | null {
  if (!raw || raw.length < 74 || raw.slice(0, 10).toLowerCase() !== FLUID_SWAP_RESULT_SELECTOR) return null;
  const [amountOut] = ethers.utils.defaultAbiCoder.decode(['uint256'], `0x${raw.slice(10)}`);
  const result = BigNumber.from(amountOut);
  return result.gt(0) ? result : null;
}

function decodeFluidSuccessfulSwapResult(iface: ethers.utils.Interface, raw: string | null): BigNumber | null {
  if (!raw || raw === '0x') return null;
  try {
    const [amountOutRaw] = iface.decodeFunctionResult('swapIn', raw);
    const amountOut = BigNumber.from(amountOutRaw);
    return amountOut.gt(0) ? amountOut : null;
  } catch {
    return null;
  }
}

function assertGsmIdentityAndState(input: {
  ghoToken: string;
  underlyingAsset: string;
  expectedUnderlying: string;
  canSwap: boolean;
  frozen: boolean;
  seized: boolean;
}): void {
  if (!sameAddress(input.ghoToken, ETHEREUM_PROTOCOL_ANCHORS.gho) || !sameAddress(input.underlyingAsset, input.expectedUnderlying)) {
    throw new Error('Aave GHO GSM live identity does not match reviewed anchor');
  }
  if (!input.canSwap || input.frozen || input.seized) throw new Error('Aave GHO GSM is not currently swappable');
}

function gsmQuoteKey(leg: ProtocolAnchorLeg, amountIn: BigNumber): string {
  return `${leg.pool.toLowerCase()}:${leg.tokenIn.toLowerCase()}:${leg.tokenOut.toLowerCase()}:${amountIn.toString()}`;
}

async function quoteGsmLive(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
  const { ghoIn, underlying } = validateKnownGsmLeg(leg);
  const gsm = new Contract(leg.pool, GSM_ABI, provider);

  if (ghoIn) {
    const [ghoToken, underlyingAsset, canSwap, frozen, seized, quoted, liquidityRaw] = await Promise.all([
      gsm.GHO_TOKEN() as Promise<string>,
      gsm.UNDERLYING_ASSET() as Promise<string>,
      gsm.canSwap() as Promise<boolean>,
      gsm.getIsFrozen() as Promise<boolean>,
      gsm.getIsSeized() as Promise<boolean>,
      gsm.getAssetAmountForBuyAsset(amountIn),
      gsm.getAvailableLiquidity(),
    ]);
    assertGsmIdentityAndState({ ghoToken, underlyingAsset, expectedUnderlying: underlying, canSwap, frozen, seized });
    const assetAmount = BigNumber.from(quoted.assetAmount ?? quoted[0]);
    const exactGhoAmount = BigNumber.from(quoted.ghoAmount ?? quoted[1]);
    const liquidity = BigNumber.from(liquidityRaw);
    if (assetAmount.lte(0) || exactGhoAmount.lte(0) || exactGhoAmount.gt(amountIn) || liquidity.lt(assetAmount)) {
      throw new Error('Aave GHO GSM buy-side capacity is insufficient');
    }
    return assetAmount;
  }

  const [ghoToken, underlyingAsset, canSwap, frozen, seized, quoted, exposureRaw] = await Promise.all([
    gsm.GHO_TOKEN() as Promise<string>,
    gsm.UNDERLYING_ASSET() as Promise<string>,
    gsm.canSwap() as Promise<boolean>,
    gsm.getIsFrozen() as Promise<boolean>,
    gsm.getIsSeized() as Promise<boolean>,
    gsm.getGhoAmountForSellAsset(amountIn),
    gsm.getAvailableUnderlyingExposure(),
  ]);
  assertGsmIdentityAndState({ ghoToken, underlyingAsset, expectedUnderlying: underlying, canSwap, frozen, seized });
  const assetAmount = BigNumber.from(quoted.assetAmount ?? quoted[0]);
  const ghoAmount = BigNumber.from(quoted.ghoAmount ?? quoted[1]);
  const exposure = BigNumber.from(exposureRaw);
  if (assetAmount.lte(0) || ghoAmount.lte(0) || assetAmount.gt(amountIn) || exposure.lt(assetAmount)) {
    throw new Error('Aave GHO GSM sell-side capacity is insufficient');
  }
  return ghoAmount;
}

async function quoteGsm(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
  const key = gsmQuoteKey(leg, amountIn);
  const cachedFailure = gsmNegativeCapacity.get(key);
  if (cachedFailure) {
    if (cachedFailure.untilMs > Date.now()) throw cachedFailure.error;
    gsmNegativeCapacity.delete(key);
  }

  const active = gsmQuoteInFlight.get(key);
  if (active) return active;

  const pending = quoteGsmLive(provider, leg, amountIn)
    .catch(error => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (normalized.message.includes('capacity is insufficient')) {
        gsmNegativeCapacity.set(key, {
          untilMs: Date.now() + GSM_NEGATIVE_CAPACITY_TTL_MS,
          error: normalized,
        });
      }
      throw error;
    })
    .finally(() => {
      gsmQuoteInFlight.delete(key);
    });
  gsmQuoteInFlight.set(key, pending);
  return pending;
}

async function quoteStata(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
  const { rawIn, raw } = validateStataLeg(leg);
  const vault = new Contract(leg.pool, STATA_ABI, provider);
  if (rawIn) {
    const [asset, sharesRaw, maxDepositRaw] = await Promise.all([
      vault.asset() as Promise<string>,
      vault.previewDeposit(amountIn),
      vault.maxDeposit(DEAD),
    ]);
    if (!sameAddress(asset, raw)) throw new Error('Aave StataToken live asset identity does not match reviewed raw stablecoin');
    const shares = BigNumber.from(sharesRaw);
    const maxDeposit = BigNumber.from(maxDepositRaw);
    if (shares.lte(0) || maxDeposit.lt(amountIn)) throw new Error('Aave StataToken deposit capacity is insufficient');
    return shares;
  }

  const [asset, assetsRaw] = await Promise.all([
    vault.asset() as Promise<string>,
    vault.previewRedeem(amountIn),
  ]);
  if (!sameAddress(asset, raw)) throw new Error('Aave StataToken live asset identity does not match reviewed raw stablecoin');
  const assets = BigNumber.from(assetsRaw);
  if (assets.lte(0)) throw new Error('Aave StataToken redeem preview returned no assets');
  return assets;
}

async function quoteFluid(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
  const swap0to1 = validateFluidGhoUsdcLeg(leg);
  const iface = new ethers.utils.Interface(FLUID_DEX_ABI);
  const data = iface.encodeFunctionData('swapIn', [swap0to1, amountIn, 0, DEAD]);
  try {
    const returned = await provider.call({ to: leg.pool, data });
    const successfulResult = decodeFluidSuccessfulSwapResult(iface, returned);
    if (successfulResult) return successfulResult;
    const customResult = decodeFluidSwapResult(returned);
    if (customResult) return customResult;
    throw new Error('Fluid simulation returned neither a standard swapIn result nor FluidDexSwapResult');
  } catch (error) {
    const result = decodeFluidSwapResult(extractRevertData(error));
    if (result) return result;
    throw error;
  }
}

async function quoteAaveAnchor(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
  return isReviewedStataPool(leg.pool)
    ? quoteStata(provider, leg, amountIn)
    : quoteGsm(provider, leg, amountIn);
}

export async function quoteProtocolAnchorLeg(
  provider: providers.Provider,
  leg: ProtocolAnchorLeg,
  amountIn: BigNumber,
): Promise<BigNumber> {
  const startedAt = Date.now();
  try {
    requireEthereumAnchorLeg(leg);
    if (amountIn.lte(0)) throw new Error('Protocol anchor quote amount must be positive');
    const amountOut = leg.protocol === 'aaveGhoGsm'
      ? await quoteAaveAnchor(provider, leg, amountIn)
      : await quoteFluid(provider, leg, amountIn);
    logger.info('[ProtocolAnchor] Exact live anchor leg quoted', {
      component: 'ProtocolAnchorAdapter',
      protocol: leg.protocol,
      pool: leg.pool,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      latencyMs: Date.now() - startedAt,
      quoteAuthority: 'direct_live_contract_state',
      executionAuthority: false,
      syntheticEconomicsAllowed: false,
    });
    return amountOut;
  } catch (error) {
    logger.warn('[ProtocolAnchor] Exact live anchor leg failed closed', {
      component: 'ProtocolAnchorAdapter',
      protocol: leg.protocol,
      pool: leg.pool,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountIn: amountIn.toString(),
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      quoteProduced: false,
      executionAuthority: false,
      syntheticEconomicsAllowed: false,
    });
    throw error;
  }
}

export function buildProtocolAnchorCall(input: {
  leg: ProtocolAnchorLeg;
  amountIn: string;
  minAmountOut: string;
  recipient: string;
}): BuiltProtocolAnchorCall {
  requireEthereumAnchorLeg(input.leg);
  const recipient = requireAddress('protocol anchor recipient', input.recipient);
  const amountIn = BigNumber.from(input.amountIn);
  const minAmountOut = BigNumber.from(input.minAmountOut);
  if (amountIn.lte(0) || minAmountOut.lte(0)) throw new Error('Protocol anchor execution amounts must be positive');

  if (input.leg.protocol === 'aaveGhoGsm') {
    if (isReviewedStataPool(input.leg.pool)) {
      const { rawIn } = validateStataLeg(input.leg);
      const iface = new ethers.utils.Interface(STATA_ABI);
      return {
        target: ethers.utils.getAddress(input.leg.pool),
        data: rawIn
          ? iface.encodeFunctionData('deposit', [amountIn, recipient])
          : iface.encodeFunctionData('redeem', [amountIn, recipient, recipient]),
        value: '0',
        gasLimit: 400000,
        approvalToken: ethers.utils.getAddress(input.leg.tokenIn),
        approvalAmount: amountIn.toString(),
      };
    }

    const { ghoIn } = validateKnownGsmLeg(input.leg);
    const iface = new ethers.utils.Interface(GSM_ABI);
    return {
      target: ethers.utils.getAddress(input.leg.pool),
      data: ghoIn
        ? iface.encodeFunctionData('buyAsset', [minAmountOut, recipient])
        : iface.encodeFunctionData('sellAsset', [amountIn, recipient]),
      value: '0',
      gasLimit: 300000,
      approvalToken: ethers.utils.getAddress(input.leg.tokenIn),
      approvalAmount: amountIn.toString(),
    };
  }

  const swap0to1 = validateFluidGhoUsdcLeg(input.leg);
  const iface = new ethers.utils.Interface(FLUID_DEX_ABI);
  return {
    target: ethers.utils.getAddress(input.leg.pool),
    data: iface.encodeFunctionData('swapIn', [swap0to1, amountIn, minAmountOut, recipient]),
    value: '0',
    gasLimit: 450000,
    approvalToken: ethers.utils.getAddress(input.leg.tokenIn),
    approvalAmount: amountIn.toString(),
  };
}

export function defaultEthereumProtocolAnchorRoutes() {
  const A = ETHEREUM_PROTOCOL_ANCHORS;
  const usdc = (id: string, legs: Array<Record<string, unknown>>) => ({
    id,
    chain: 'ethereum' as const,
    inputAssetSymbol: 'USDC' as const,
    inputToken: A.usdc,
    inputTokenDecimals: 6,
    amountIn: '100000000',
    estimatedGasCostInInputToken: '0',
    relayFeeInInputToken: '0',
    flashLoanFeeBps: 0,
    minNetProfitBps: 0,
    legs,
  });
  const usdt = (id: string, legs: Array<Record<string, unknown>>) => ({
    id,
    chain: 'ethereum' as const,
    inputAssetSymbol: 'USDT' as const,
    inputToken: A.usdt,
    inputTokenDecimals: 6,
    amountIn: '100000000',
    estimatedGasCostInInputToken: '0',
    relayFeeInInputToken: '0',
    flashLoanFeeBps: 0,
    minNetProfitBps: 0,
    legs,
  });

  const fluidUsdcToGho = { protocol: 'fluidDexT1', tokenIn: A.usdc, tokenOut: A.gho, pool: A.fluidGhoUsdc, fee: 0 };
  const fluidGhoToUsdc = { protocol: 'fluidDexT1', tokenIn: A.gho, tokenOut: A.usdc, pool: A.fluidGhoUsdc, fee: 0 };
  const wrapUsdc = { protocol: 'aaveGhoGsm', tokenIn: A.usdc, tokenOut: A.stataUsdc, pool: A.stataUsdc, fee: 0 };
  const unwrapUsdc = { protocol: 'aaveGhoGsm', tokenIn: A.stataUsdc, tokenOut: A.usdc, pool: A.stataUsdc, fee: 0 };
  const wrapUsdt = { protocol: 'aaveGhoGsm', tokenIn: A.usdt, tokenOut: A.stataUsdt, pool: A.stataUsdt, fee: 0 };
  const unwrapUsdt = { protocol: 'aaveGhoGsm', tokenIn: A.stataUsdt, tokenOut: A.usdt, pool: A.stataUsdt, fee: 0 };
  const gsmStataUsdcToGho = { protocol: 'aaveGhoGsm', tokenIn: A.stataUsdc, tokenOut: A.gho, pool: A.gsmUsdc, fee: 0 };
  const gsmGhoToStataUsdc = { protocol: 'aaveGhoGsm', tokenIn: A.gho, tokenOut: A.stataUsdc, pool: A.gsmUsdc, fee: 0 };
  const gsmStataUsdtToGho = { protocol: 'aaveGhoGsm', tokenIn: A.stataUsdt, tokenOut: A.gho, pool: A.gsmUsdt, fee: 0 };
  const gsmGhoToStataUsdt = { protocol: 'aaveGhoGsm', tokenIn: A.gho, tokenOut: A.stataUsdt, pool: A.gsmUsdt, fee: 0 };
  const usdcToUsdt = { protocol: 'uniswapV3', tokenIn: A.usdc, tokenOut: A.usdt, feeTier: 100, fee: 0.0001 };
  const usdtToUsdc = { protocol: 'uniswapV3', tokenIn: A.usdt, tokenOut: A.usdc, feeTier: 100, fee: 0.0001 };

  return [
    usdc('anchor-ethereum-usdc-fluid-gho-gsm-usdc', [fluidUsdcToGho, gsmGhoToStataUsdc, unwrapUsdc]),
    usdc('anchor-ethereum-usdc-gsm-gho-fluid-usdc', [wrapUsdc, gsmStataUsdcToGho, fluidGhoToUsdc]),
    usdc('anchor-ethereum-usdc-fluid-gho-gsm-usdt-usdc', [fluidUsdcToGho, gsmGhoToStataUsdt, unwrapUsdt, usdtToUsdc]),
    usdc('anchor-ethereum-usdc-usdt-gsm-gho-fluid-usdc', [usdcToUsdt, wrapUsdt, gsmStataUsdtToGho, fluidGhoToUsdc]),
    usdt('anchor-ethereum-usdt-gsm-gho-fluid-usdc-usdt', [wrapUsdt, gsmStataUsdtToGho, fluidGhoToUsdc, usdcToUsdt]),
    usdt('anchor-ethereum-usdt-usdc-fluid-gho-gsm-usdt', [usdtToUsdc, fluidUsdcToGho, gsmGhoToStataUsdt, unwrapUsdt]),
  ];
}
