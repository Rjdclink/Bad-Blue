import { BigNumber, Contract, ethers, providers } from 'ethers';

export type SkyPrimaryMarketProtocol = 'skyLitePsm' | 'skyDaiUsds';

/**
 * Reviewed Ethereum primary-market anchors. Every quote re-validates live
 * contract identity/state; these addresses are routing identities, never static
 * economic assumptions.
 */
export const ETHEREUM_PRIMARY_MARKET_ANCHORS = {
  dai: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usds: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
  skyLitePsmUsdc: '0xf6e72Db5454dd049d0788e411b06CfAF16853042',
  skyDaiUsds: '0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A',
  fluidDexReservesResolver: '0xF38082d58bF0f1e07C04684FF718d69a70f21e62',
} as const;

const WAD = BigNumber.from('1000000000000000000');
const MAX_UINT256 = ethers.constants.MaxUint256;

const ERC20_READ_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const LITE_PSM_ABI = [
  'function dai() view returns (address)',
  'function gem() view returns (address)',
  'function pocket() view returns (address)',
  'function tin() view returns (uint256)',
  'function tout() view returns (uint256)',
  'function to18ConversionFactor() view returns (uint256)',
  'function sellGem(address usr, uint256 gemAmt) returns (uint256 daiOutWad)',
  'function buyGem(address usr, uint256 gemAmt) returns (uint256 daiInWad)',
];

const DAI_USDS_ABI = [
  'function dai() view returns (address)',
  'function usds() view returns (address)',
  'function daiToUsds(address usr, uint256 wad)',
  'function usdsToDai(address usr, uint256 wad)',
];

const FLUID_RESOLVER_ABI = [
  'function estimateSwapIn(address dex, bool swap0to1, uint256 amountIn, uint256 amountOutMin) payable returns (uint256 amountOut)',
];

export interface SkyPrimaryMarketLeg {
  protocol: SkyPrimaryMarketProtocol;
  tokenIn: string;
  tokenOut: string;
  pool: string;
}

export interface BuiltPrimaryMarketCall {
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

export function resolveSkyPrimaryMarketPool(
  protocol: SkyPrimaryMarketProtocol,
  tokenIn: string,
  tokenOut: string,
  configuredPool?: string,
): string {
  const A = ETHEREUM_PRIMARY_MARKET_ANCHORS;
  const pool = configuredPool ? requireAddress('Sky primary-market pool', configuredPool) : null;
  if (protocol === 'skyLitePsm') {
    const validPair = (sameAddress(tokenIn, A.usdc) && sameAddress(tokenOut, A.dai))
      || (sameAddress(tokenIn, A.dai) && sameAddress(tokenOut, A.usdc));
    if (!validPair) throw new Error('Sky LitePSM routing supports only the reviewed USDC/DAI pair');
    if (pool && !sameAddress(pool, A.skyLitePsmUsdc)) throw new Error('Unreviewed Sky LitePSM address');
    return A.skyLitePsmUsdc;
  }

  const validPair = (sameAddress(tokenIn, A.dai) && sameAddress(tokenOut, A.usds))
    || (sameAddress(tokenIn, A.usds) && sameAddress(tokenOut, A.dai));
  if (!validPair) throw new Error('Sky DaiUsds routing supports only the reviewed DAI/USDS pair');
  if (pool && !sameAddress(pool, A.skyDaiUsds)) throw new Error('Unreviewed Sky DaiUsds address');
  return A.skyDaiUsds;
}

function requiredDaiForGem(gemAmount: BigNumber, conversionFactor: BigNumber, tout: BigNumber): BigNumber {
  const gross = gemAmount.mul(conversionFactor);
  return tout.isZero() ? gross : gross.add(gross.mul(tout).div(WAD));
}

function maximumGemForDai(daiAmount: BigNumber, conversionFactor: BigNumber, tout: BigNumber): BigNumber {
  if (conversionFactor.lte(0)) throw new Error('Sky LitePSM conversion factor must be positive');
  let low = BigNumber.from(0);
  let high = daiAmount.div(conversionFactor).add(1);
  while (high.sub(low).gt(1)) {
    const mid = low.add(high).div(2);
    if (requiredDaiForGem(mid, conversionFactor, tout).lte(daiAmount)) low = mid;
    else high = mid;
  }
  return low;
}

async function quoteSkyLitePsm(
  provider: providers.Provider,
  leg: SkyPrimaryMarketLeg,
  amountIn: BigNumber,
): Promise<BigNumber> {
  const A = ETHEREUM_PRIMARY_MARKET_ANCHORS;
  const pool = resolveSkyPrimaryMarketPool('skyLitePsm', leg.tokenIn, leg.tokenOut, leg.pool);
  const psm = new Contract(pool, LITE_PSM_ABI, provider);
  const [daiAddress, gemAddress, pocketAddress, tinRaw, toutRaw, factorRaw] = await Promise.all([
    psm.dai() as Promise<string>,
    psm.gem() as Promise<string>,
    psm.pocket() as Promise<string>,
    psm.tin(),
    psm.tout(),
    psm.to18ConversionFactor(),
  ]);
  if (!sameAddress(daiAddress, A.dai) || !sameAddress(gemAddress, A.usdc)) {
    throw new Error('Sky LitePSM live token identity does not match the reviewed USDC/DAI anchor');
  }
  const pocket = requireAddress('Sky LitePSM pocket', pocketAddress);
  const tin = BigNumber.from(tinRaw);
  const tout = BigNumber.from(toutRaw);
  const factor = BigNumber.from(factorRaw);
  if (factor.lte(0)) throw new Error('Sky LitePSM live conversion factor is invalid');

  const usdcIn = sameAddress(leg.tokenIn, A.usdc);
  if (usdcIn) {
    if (tin.eq(MAX_UINT256)) throw new Error('Sky LitePSM USDC sell side is halted');
    const gross = amountIn.mul(factor);
    const fee = tin.isZero() ? BigNumber.from(0) : gross.mul(tin).div(WAD);
    const amountOut = gross.sub(fee);
    if (amountOut.lte(0)) throw new Error('Sky LitePSM USDC sell quote returned no DAI');
    const dai = new Contract(A.dai, ERC20_READ_ABI, provider);
    const available = BigNumber.from(await dai.balanceOf(pool));
    if (available.lt(amountOut)) throw new Error('Sky LitePSM DAI buffer is insufficient for the measured sell quote');
    return amountOut;
  }

  if (tout.eq(MAX_UINT256)) throw new Error('Sky LitePSM USDC buy side is halted');
  const gemAmount = maximumGemForDai(amountIn, factor, tout);
  if (gemAmount.lte(0)) throw new Error('Sky LitePSM DAI buy quote returned no USDC');
  const requiredDai = requiredDaiForGem(gemAmount, factor, tout);
  if (requiredDai.gt(amountIn)) throw new Error('Sky LitePSM exact buy quote exceeds available DAI');
  const usdc = new Contract(A.usdc, ERC20_READ_ABI, provider);
  const [availableRaw, allowanceRaw] = await Promise.all([
    usdc.balanceOf(pocket),
    usdc.allowance(pocket, pool),
  ]);
  if (BigNumber.from(availableRaw).lt(gemAmount) || BigNumber.from(allowanceRaw).lt(gemAmount)) {
    throw new Error('Sky LitePSM pocket capacity is insufficient for the measured USDC buy quote');
  }
  return gemAmount;
}

async function quoteSkyDaiUsds(
  provider: providers.Provider,
  leg: SkyPrimaryMarketLeg,
  amountIn: BigNumber,
): Promise<BigNumber> {
  const A = ETHEREUM_PRIMARY_MARKET_ANCHORS;
  const pool = resolveSkyPrimaryMarketPool('skyDaiUsds', leg.tokenIn, leg.tokenOut, leg.pool);
  const converter = new Contract(pool, DAI_USDS_ABI, provider);
  const [daiAddress, usdsAddress] = await Promise.all([
    converter.dai() as Promise<string>,
    converter.usds() as Promise<string>,
  ]);
  if (!sameAddress(daiAddress, A.dai) || !sameAddress(usdsAddress, A.usds)) {
    throw new Error('Sky DaiUsds live identity does not match the reviewed DAI/USDS converter');
  }
  if (amountIn.lte(0)) throw new Error('Sky DaiUsds quote amount must be positive');
  // The reviewed converter exchanges equal 18-decimal wad amounts in either
  // direction. Identity is read live above; execution is still re-simulated by
  // the canonical receiver before broadcast.
  return amountIn;
}

export async function quoteSkyPrimaryMarketLeg(
  provider: providers.Provider,
  leg: SkyPrimaryMarketLeg,
  amountIn: BigNumber,
): Promise<BigNumber> {
  if (amountIn.lte(0)) throw new Error('Sky primary-market quote amount must be positive');
  return leg.protocol === 'skyLitePsm'
    ? quoteSkyLitePsm(provider, leg, amountIn)
    : quoteSkyDaiUsds(provider, leg, amountIn);
}

export function buildSkyPrimaryMarketCall(input: {
  leg: SkyPrimaryMarketLeg;
  amountIn: string;
  minAmountOut: string;
  recipient: string;
}): BuiltPrimaryMarketCall {
  const A = ETHEREUM_PRIMARY_MARKET_ANCHORS;
  const recipient = requireAddress('Sky primary-market recipient', input.recipient);
  const amountIn = BigNumber.from(input.amountIn);
  const minAmountOut = BigNumber.from(input.minAmountOut);
  if (amountIn.lte(0) || minAmountOut.lte(0)) throw new Error('Sky primary-market execution amounts must be positive');
  const pool = resolveSkyPrimaryMarketPool(input.leg.protocol, input.leg.tokenIn, input.leg.tokenOut, input.leg.pool);

  if (input.leg.protocol === 'skyLitePsm') {
    const iface = new ethers.utils.Interface(LITE_PSM_ABI);
    const usdcIn = sameAddress(input.leg.tokenIn, A.usdc);
    return {
      target: ethers.utils.getAddress(pool),
      data: usdcIn
        ? iface.encodeFunctionData('sellGem', [recipient, amountIn])
        : iface.encodeFunctionData('buyGem', [recipient, minAmountOut]),
      value: '0',
      gasLimit: 275000,
      approvalToken: ethers.utils.getAddress(input.leg.tokenIn),
      approvalAmount: amountIn.toString(),
    };
  }

  const iface = new ethers.utils.Interface(DAI_USDS_ABI);
  const daiIn = sameAddress(input.leg.tokenIn, A.dai);
  return {
    target: ethers.utils.getAddress(pool),
    data: daiIn
      ? iface.encodeFunctionData('daiToUsds', [recipient, amountIn])
      : iface.encodeFunctionData('usdsToDai', [recipient, amountIn]),
    value: '0',
    gasLimit: 325000,
    approvalToken: ethers.utils.getAddress(input.leg.tokenIn),
    approvalAmount: amountIn.toString(),
  };
}

/**
 * Fluid publishes a resolver that intentionally performs the same DEAD-recipient
 * swap simulation and decodes FluidDexSwapResult itself. Using it first avoids
 * RPC-specific custom-error normalization while preserving exact live pool state.
 */
export async function quoteFluidSwapInViaOfficialResolver(
  provider: providers.Provider,
  dex: string,
  swap0to1: boolean,
  amountIn: BigNumber,
): Promise<BigNumber> {
  const resolver = requireAddress('Fluid DEX reserves resolver', ETHEREUM_PRIMARY_MARKET_ANCHORS.fluidDexReservesResolver);
  const pool = requireAddress('Fluid DEX pool', dex);
  if (amountIn.lte(0)) throw new Error('Fluid resolver quote amount must be positive');
  const iface = new ethers.utils.Interface(FLUID_RESOLVER_ABI);
  const data = iface.encodeFunctionData('estimateSwapIn', [pool, swap0to1, amountIn, 0]);
  const returned = await provider.call({ to: resolver, data });
  if (!returned || returned === '0x') throw new Error('Fluid official resolver returned no quote data');
  const [amountOutRaw] = iface.decodeFunctionResult('estimateSwapIn', returned);
  const amountOut = BigNumber.from(amountOutRaw);
  if (amountOut.lte(0)) throw new Error('Fluid official resolver returned zero output');
  return amountOut;
}
