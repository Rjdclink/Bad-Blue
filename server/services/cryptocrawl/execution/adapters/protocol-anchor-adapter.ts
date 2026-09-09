import { BigNumber, Contract, ethers, providers } from 'ethers';

export type ProtocolAnchorProtocol = 'aaveGhoGsm' | 'fluidDexT1';

export const ETHEREUM_PROTOCOL_ANCHORS = {
  gho: '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  gsmUsdc: '0xFeeb6FE430B7523fEF2a38327241eE7153779535',
  gsmUsdt: '0x535b2f7C20B9C83d70e519cf9991578eF9816B7B',
  fluidGhoUsdc: '0xdE632C3a214D5f14C1d8ddF0b92F8BCd188fee45',
} as const;

const DEAD = '0x000000000000000000000000000000000000dEaD';
const FLUID_SWAP_RESULT_SELECTOR = ethers.utils.id('FluidDexSwapResult(uint256)').slice(0, 10).toLowerCase();

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
  const other = sameAddress(tokenIn, A.gho) ? tokenOut : sameAddress(tokenOut, A.gho) ? tokenIn : '';
  if (sameAddress(other, A.usdc)) return A.gsmUsdc;
  if (sameAddress(other, A.usdt)) return A.gsmUsdt;
  throw new Error('Aave GHO GSM target inference supports only reviewed USDC/USDT modules');
}

function requireEthereumAnchorLeg(leg: ProtocolAnchorLeg): void {
  requireAddress('protocol anchor pool', leg.pool);
  requireAddress('protocol anchor tokenIn', leg.tokenIn);
  requireAddress('protocol anchor tokenOut', leg.tokenOut);
  if (sameAddress(leg.tokenIn, leg.tokenOut)) throw new Error('Protocol anchor leg cannot swap a token into itself');
}

function knownGsmUnderlying(pool: string): string | null {
  if (sameAddress(pool, ETHEREUM_PROTOCOL_ANCHORS.gsmUsdc)) return ETHEREUM_PROTOCOL_ANCHORS.usdc;
  if (sameAddress(pool, ETHEREUM_PROTOCOL_ANCHORS.gsmUsdt)) return ETHEREUM_PROTOCOL_ANCHORS.usdt;
  return null;
}

function validateKnownGsmLeg(leg: ProtocolAnchorLeg): { ghoIn: boolean; underlying: string } {
  const underlying = knownGsmUnderlying(leg.pool);
  if (!underlying) throw new Error('Unreviewed Aave GHO GSM address');
  const ghoIn = sameAddress(leg.tokenIn, ETHEREUM_PROTOCOL_ANCHORS.gho);
  const ghoOut = sameAddress(leg.tokenOut, ETHEREUM_PROTOCOL_ANCHORS.gho);
  if (ghoIn === ghoOut) throw new Error('Aave GHO GSM leg must contain exactly one GHO side');
  const other = ghoIn ? leg.tokenOut : leg.tokenIn;
  if (!sameAddress(other, underlying)) throw new Error('Aave GHO GSM underlying does not match reviewed module');
  return { ghoIn, underlying };
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

async function quoteGsm(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
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

async function quoteFluid(provider: providers.Provider, leg: ProtocolAnchorLeg, amountIn: BigNumber): Promise<BigNumber> {
  const swap0to1 = validateFluidGhoUsdcLeg(leg);
  const iface = new ethers.utils.Interface(FLUID_DEX_ABI);
  const data = iface.encodeFunctionData('swapIn', [swap0to1, amountIn, 0, DEAD]);
  try {
    const returned = await provider.call({ to: leg.pool, data });
    const result = decodeFluidSwapResult(returned);
    if (result) return result;
    throw new Error('Fluid simulation unexpectedly returned without FluidDexSwapResult');
  } catch (error) {
    const result = decodeFluidSwapResult(extractRevertData(error));
    if (result) return result;
    throw error;
  }
}

export async function quoteProtocolAnchorLeg(
  provider: providers.Provider,
  leg: ProtocolAnchorLeg,
  amountIn: BigNumber,
): Promise<BigNumber> {
  requireEthereumAnchorLeg(leg);
  if (amountIn.lte(0)) throw new Error('Protocol anchor quote amount must be positive');
  if (leg.protocol === 'aaveGhoGsm') return quoteGsm(provider, leg, amountIn);
  return quoteFluid(provider, leg, amountIn);
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
  const gsmUsdcToGho = { protocol: 'aaveGhoGsm', tokenIn: A.usdc, tokenOut: A.gho, pool: A.gsmUsdc, fee: 0 };
  const gsmGhoToUsdc = { protocol: 'aaveGhoGsm', tokenIn: A.gho, tokenOut: A.usdc, pool: A.gsmUsdc, fee: 0 };
  const gsmUsdtToGho = { protocol: 'aaveGhoGsm', tokenIn: A.usdt, tokenOut: A.gho, pool: A.gsmUsdt, fee: 0 };
  const gsmGhoToUsdt = { protocol: 'aaveGhoGsm', tokenIn: A.gho, tokenOut: A.usdt, pool: A.gsmUsdt, fee: 0 };
  const usdcToUsdt = { protocol: 'uniswapV3', tokenIn: A.usdc, tokenOut: A.usdt, feeTier: 100, fee: 0.0001 };
  const usdtToUsdc = { protocol: 'uniswapV3', tokenIn: A.usdt, tokenOut: A.usdc, feeTier: 100, fee: 0.0001 };

  return [
    usdc('anchor-ethereum-usdc-fluid-gho-gsm-usdc', [fluidUsdcToGho, gsmGhoToUsdc]),
    usdc('anchor-ethereum-usdc-gsm-gho-fluid-usdc', [gsmUsdcToGho, fluidGhoToUsdc]),
    usdc('anchor-ethereum-usdc-fluid-gho-gsm-usdt-usdc', [fluidUsdcToGho, gsmGhoToUsdt, usdtToUsdc]),
    usdc('anchor-ethereum-usdc-usdt-gsm-gho-fluid-usdc', [usdcToUsdt, gsmUsdtToGho, fluidGhoToUsdc]),
    usdt('anchor-ethereum-usdt-gsm-gho-fluid-usdc-usdt', [gsmUsdtToGho, fluidGhoToUsdc, usdcToUsdt]),
    usdt('anchor-ethereum-usdt-usdc-fluid-gho-gsm-usdt', [usdtToUsdc, fluidUsdcToGho, gsmGhoToUsdt]),
  ];
}
