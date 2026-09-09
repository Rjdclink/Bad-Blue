import { ETHEREUM_PRIMARY_MARKET_ANCHORS as A } from './primary-market-anchor-adapter.js';

/**
 * Primary-market routes are deliberately narrow: only the reviewed Sky USDC/DAI
 * LitePSM is paired with the existing canonical Uniswap V3 1 bp market leg.
 * The DAI/USDS converter is wired for future exact USDS market surfaces but is
 * not placed in a default route until a reviewed executable USDS market leg is
 * available.
 */
export function defaultEthereumPrimaryMarketAnchorRoutes() {
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

  const skyUsdcToDai = {
    protocol: 'skyLitePsm',
    tokenIn: A.usdc,
    tokenOut: A.dai,
    pool: A.skyLitePsmUsdc,
    fee: 0,
  };
  const skyDaiToUsdc = {
    protocol: 'skyLitePsm',
    tokenIn: A.dai,
    tokenOut: A.usdc,
    pool: A.skyLitePsmUsdc,
    fee: 0,
  };
  const usdcToDai = {
    protocol: 'uniswapV3',
    tokenIn: A.usdc,
    tokenOut: A.dai,
    feeTier: 100,
    fee: 0.0001,
  };
  const daiToUsdc = {
    protocol: 'uniswapV3',
    tokenIn: A.dai,
    tokenOut: A.usdc,
    feeTier: 100,
    fee: 0.0001,
  };

  return [
    usdc('anchor-ethereum-usdc-sky-psm-dai-univ3-100', [skyUsdcToDai, daiToUsdc]),
    usdc('anchor-ethereum-usdc-univ3-100-dai-sky-psm', [usdcToDai, skyDaiToUsdc]),
  ];
}
