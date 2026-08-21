import { ethers } from 'ethers';

export type SupportedExecutionChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche';
export type SupportedSwapProtocol = 'uniswapV3' | 'sushiswap';

export interface OnchainSwapLeg {
  protocol: SupportedSwapProtocol;
  chain: SupportedExecutionChain;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  feeTier?: 500 | 3000 | 10000;
  recipient?: string;
  deadlineBufferSeconds?: number;
}

export interface OnchainExecutionPlan {
  chain: SupportedExecutionChain;
  recipient: string;
  value?: string;
  gasLimit?: number;
  legs: OnchainSwapLeg[];
}

export interface BuiltOnchainPayload {
  to: string;
  data: string;
  value: string;
  gasLimit: number;
}

export interface BuiltSwapCall {
  target: string;
  data: string;
  value: string;
  gasLimit: number;
  approvalToken: string;
  approvalAmount: string;
}

const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
];

const SUSHISWAP_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)',
];

const DEX_ROUTERS: Record<SupportedSwapProtocol, Partial<Record<SupportedExecutionChain, string>>> = {
  uniswapV3: {
    ethereum: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    polygon: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    arbitrum: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    optimism: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  },
  sushiswap: {
    ethereum: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    polygon: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    bsc: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    avalanche: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  },
};

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseAmount(label: string, raw: string): ethers.BigNumber {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} must be an integer string denominated in base units`);
  }

  return ethers.BigNumber.from(raw);
}

function resolveRouter(protocol: SupportedSwapProtocol, chain: SupportedExecutionChain): string {
  const router = DEX_ROUTERS[protocol][chain];
  if (!router || !isAddress(router)) {
    throw new Error(`No ${protocol} router configured for ${chain}`);
  }
  return router;
}

function defaultGasLimit(protocol: SupportedSwapProtocol): number {
  return protocol === 'uniswapV3' ? 250000 : 300000;
}

export function buildSwapCallFromLeg(
  chain: SupportedExecutionChain,
  defaultRecipient: string,
  leg: OnchainSwapLeg,
): BuiltSwapCall {
  if (leg.chain !== chain) {
    throw new Error(`Leg chain ${leg.chain} does not match plan chain ${chain}`);
  }

  if (!isAddress(leg.tokenIn) || !isAddress(leg.tokenOut)) {
    throw new Error('tokenIn and tokenOut must be valid EVM token addresses');
  }

  const recipient = leg.recipient || defaultRecipient;
  if (!isAddress(recipient)) {
    throw new Error('Swap recipient must be a valid EVM address');
  }

  const amountIn = parseAmount('amountIn', leg.amountIn);
  const minAmountOut = parseAmount('minAmountOut', leg.minAmountOut);
  const router = resolveRouter(leg.protocol, chain);
  const deadline = Math.floor(Date.now() / 1000) + Math.max(30, leg.deadlineBufferSeconds || 120);

  if (leg.protocol === 'uniswapV3') {
    const iface = new ethers.utils.Interface(UNISWAP_V3_ROUTER_ABI);
    return {
      target: router,
      data: iface.encodeFunctionData('exactInputSingle', [{
        tokenIn: leg.tokenIn,
        tokenOut: leg.tokenOut,
        fee: leg.feeTier || 3000,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0,
      }]),
      value: '0',
      gasLimit: defaultGasLimit(leg.protocol),
      approvalToken: leg.tokenIn,
      approvalAmount: amountIn.toString(),
    };
  }

  const iface = new ethers.utils.Interface(SUSHISWAP_ROUTER_ABI);
  return {
    target: router,
    data: iface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      minAmountOut,
      [leg.tokenIn, leg.tokenOut],
      recipient,
      deadline,
    ]),
    value: '0',
    gasLimit: defaultGasLimit(leg.protocol),
    approvalToken: leg.tokenIn,
    approvalAmount: amountIn.toString(),
  };
}

export function buildOnchainPayloadFromPlan(plan: OnchainExecutionPlan): BuiltOnchainPayload {
  if (!isAddress(plan.recipient)) {
    throw new Error('On-chain execution plan recipient must be a valid EVM address');
  }

  if (!Array.isArray(plan.legs) || plan.legs.length !== 1) {
    throw new Error('Structured on-chain payload builder currently supports exactly one swap leg per payload');
  }

  const [leg] = plan.legs;
  const swapCall = buildSwapCallFromLeg(plan.chain, plan.recipient, leg);
  return {
    to: swapCall.target,
    data: swapCall.data,
    value: plan.value || swapCall.value,
    gasLimit: plan.gasLimit || swapCall.gasLimit,
  };
}