import { ethers } from 'ethers';
import type { BuiltOnchainPayload } from './onchain-payload-builder.js';
import { EUROPA_SUSHI } from './europa-sushi-registry.js';

const SUSHI_API = 'https://api.sushi.com';
const SUSHI_V3_FLASH_RECEIVER_ABI = [
  'function executeSushiV3Flash(address pool,uint256 amount0,uint256 amount1,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,address profitToken,uint256 minProfit,address profitRecipient) external',
];

export interface EuropaSushiFlashLeg {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  pool?: string;
}

export interface EuropaSushiFlashPlan {
  receiver: string;
  flashPool: string;
  flashToken: string;
  flashAmount: string;
  legs: EuropaSushiFlashLeg[];
  minProfit: string;
  profitRecipient: string;
  gasLimit?: number;
}

interface SushiSwapResponse {
  status?: string;
  assumedAmountOut?: string;
  tx?: { to?: string; data?: string; value?: string };
}

function requireAddress(label: string, address: string): string {
  if (!ethers.utils.isAddress(address)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(address);
}

function requireAmount(label: string, value: string): string {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer base-unit amount`);
  return value;
}

function addressEquals(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function poolForLeg(tokenIn: string, tokenOut: string): string {
  const usdc = EUROPA_SUSHI.tokens.usdc;
  const skl = EUROPA_SUSHI.tokens.skl;
  const eth = EUROPA_SUSHI.tokens.eth;
  if ((addressEquals(tokenIn, usdc) && addressEquals(tokenOut, skl)) || (addressEquals(tokenIn, skl) && addressEquals(tokenOut, usdc))) return EUROPA_SUSHI.pools.usdcSkl;
  if ((addressEquals(tokenIn, skl) && addressEquals(tokenOut, eth)) || (addressEquals(tokenIn, eth) && addressEquals(tokenOut, skl))) return EUROPA_SUSHI.pools.sklEth;
  if ((addressEquals(tokenIn, eth) && addressEquals(tokenOut, usdc)) || (addressEquals(tokenIn, usdc) && addressEquals(tokenOut, eth))) return EUROPA_SUSHI.pools.ethUsdc;
  throw new Error(`No validated Sushi Europa pool exists for ${tokenIn} -> ${tokenOut}`);
}

async function quoteProcessorCall(input: {
  sender: string;
  recipient: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  pool: string;
}): Promise<{ amountOut: string; target: string; data: string; value: string }> {
  const url = new URL('/swap/v7/2046399126', SUSHI_API);
  url.searchParams.set('referrer', 'sushi');
  url.searchParams.set('tokenIn', input.tokenIn);
  url.searchParams.set('tokenOut', input.tokenOut);
  url.searchParams.set('amount', input.amountIn);
  url.searchParams.set('maxSlippage', '0.005');
  url.searchParams.set('sender', input.sender);
  url.searchParams.set('recipient', input.recipient);
  url.searchParams.set('simulate', 'false');
  url.searchParams.append('onlyPools', input.pool);
  const response = await fetch(url, { headers: { Origin: 'https://sushi.com' } });
  if (!response.ok) throw new Error(`Sushi Europa quote failed with HTTP ${response.status}`);
  const quote = await response.json() as SushiSwapResponse;
  if (quote.status !== 'Success' || !quote.assumedAmountOut || !quote.tx?.to || !quote.tx.data) {
    throw new Error('Sushi Europa quote did not return executable route-processor calldata');
  }
  if (!addressEquals(quote.tx.to, EUROPA_SUSHI.routeProcessor)) {
    throw new Error(`Sushi quote target ${quote.tx.to} does not match verified Europa Route Processor`);
  }
  return {
    amountOut: requireAmount('Sushi amountOut', quote.assumedAmountOut),
    target: requireAddress('Sushi Route Processor', quote.tx.to),
    data: quote.tx.data,
    value: quote.tx.value || '0',
  };
}

export async function buildEuropaSushiV3FlashPayload(plan: EuropaSushiFlashPlan): Promise<BuiltOnchainPayload> {
  const receiver = requireAddress('receiver', plan.receiver);
  const flashPool = requireAddress('flashPool', plan.flashPool);
  const flashToken = requireAddress('flashToken', plan.flashToken);
  const profitRecipient = requireAddress('profitRecipient', plan.profitRecipient);
  const flashAmount = requireAmount('flashAmount', plan.flashAmount);
  const minProfit = requireAmount('minProfit', plan.minProfit);
  if (plan.legs.length < 2) throw new Error('Europa Sushi flash execution requires at least two cyclic swap legs');
  if (!addressEquals(plan.flashPool, EUROPA_SUSHI.pools.usdcSkl) || !addressEquals(flashToken, EUROPA_SUSHI.tokens.usdc)) {
    throw new Error('Current validated Europa Sushi flash topology supports USDC borrowed from the USDC/SKL pool only');
  }

  let currentAmount = flashAmount;
  const steps: Array<{ target: string; value: string; callData: string; approvalToken: string; approvalAmount: string }> = [];
  for (const leg of plan.legs) {
    const expectedPool = poolForLeg(leg.tokenIn, leg.tokenOut);
    if (leg.pool && !addressEquals(expectedPool, leg.pool)) throw new Error(`Leg pool ${leg.pool} is not the validated pool for its tokens`);
    if (leg.amountIn !== currentAmount) throw new Error('Europa Sushi flash legs must consume the preceding exact quoted amount');
    const quote = await quoteProcessorCall({
      sender: receiver,
      recipient: receiver,
      tokenIn: requireAddress('leg tokenIn', leg.tokenIn),
      tokenOut: requireAddress('leg tokenOut', leg.tokenOut),
      amountIn: currentAmount,
      pool: expectedPool,
    });
    steps.push({
      target: quote.target,
      value: requireAmount('Sushi tx value', quote.value),
      callData: quote.data,
      approvalToken: leg.tokenIn,
      approvalAmount: currentAmount,
    });
    currentAmount = quote.amountOut;
  }
  if (!addressEquals(plan.legs[0].tokenIn, flashToken) || !addressEquals(plan.legs[plan.legs.length - 1].tokenOut, flashToken)) {
    throw new Error('Europa Sushi flash route must return to the borrowed flash token');
  }

  const iface = new ethers.utils.Interface(SUSHI_V3_FLASH_RECEIVER_ABI);
  return {
    to: receiver,
    data: iface.encodeFunctionData('executeSushiV3Flash', [
      flashPool,
      flashAmount,
      '0',
      steps,
      flashToken,
      minProfit,
      profitRecipient,
    ]),
    value: '0',
    gasLimit: plan.gasLimit || 1_500_000,
  };
}