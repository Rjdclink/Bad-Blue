import { ethers } from 'ethers';
import {
  buildSwapCallFromLeg,
  type BuiltOnchainPayload,
  type OnchainSwapLeg,
  type SupportedExecutionChain,
} from './onchain-payload-builder.js';

export interface DualFlashLoanExecutionPlan {
  chain: SupportedExecutionChain;
  receiver: string;
  loanToken: string;
  balancerAmount: string;
  aaveAmount: string;
  minProfit: string;
  profitRecipient: string;
  steps: OnchainSwapLeg[];
  gasLimit?: number;
}

const DUAL_FLASHLOAN_RECEIVER_ABI = [
  'function executeDualFlashLoan(address loanToken,uint256 balancerAmount,uint256 aaveAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
];
const MAX_ATOMIC_SWAP_STEPS = 16;

function parseInteger(label: string, value: string): ethers.BigNumber {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer string denominated in base units`);
  return ethers.BigNumber.from(value);
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function buildDualFlashLoanReceiverPayload(plan: DualFlashLoanExecutionPlan): BuiltOnchainPayload {
  const receiver = requireAddress('dual receiver', plan.receiver);
  const loanToken = requireAddress('dual loan token', plan.loanToken);
  const profitRecipient = requireAddress('dual profit recipient', plan.profitRecipient);
  const balancerAmount = parseInteger('balancerAmount', plan.balancerAmount);
  const aaveAmount = parseInteger('aaveAmount', plan.aaveAmount);
  const minProfit = parseInteger('minProfit', plan.minProfit);
  if (balancerAmount.lte(0) || aaveAmount.lte(0)) throw new Error('Dual flash-loan execution requires positive amounts from both providers');
  if (!Array.isArray(plan.steps) || plan.steps.length < 2 || plan.steps.length > MAX_ATOMIC_SWAP_STEPS) {
    throw new Error(`Dual flash-loan execution requires 2-${MAX_ATOMIC_SWAP_STEPS} swap steps`);
  }
  if (!sameAddress(plan.steps[0].tokenIn, loanToken) || !sameAddress(plan.steps[plan.steps.length - 1].tokenOut, loanToken)) {
    throw new Error('Dual flash-loan route must begin and end with the borrowed token');
  }
  for (let index = 1; index < plan.steps.length; index++) {
    if (!sameAddress(plan.steps[index - 1].tokenOut, plan.steps[index].tokenIn)) {
      throw new Error(`Dual flash-loan route is not token-contiguous at step ${index}`);
    }
  }
  const combinedPrincipal = balancerAmount.add(aaveAmount);
  const firstAmount = parseInteger('steps[0].amountIn', plan.steps[0].amountIn);
  if (!firstAmount.eq(combinedPrincipal)) {
    throw new Error('Dual flash-loan combined principal must equal the first exact route input');
  }

  const encodedSteps = plan.steps.map((step, index) => {
    const swapCall = buildSwapCallFromLeg(plan.chain, receiver, step);
    const value = parseInteger(`steps[${index}].value`, swapCall.value);
    const approvalAmount = parseInteger(`steps[${index}].approvalAmount`, swapCall.approvalAmount);
    const amountIn = parseInteger(`steps[${index}].amountIn`, step.amountIn);
    if (!value.isZero()) throw new Error(`Dual flash-loan step ${index} attempted an unsupported native-value transfer`);
    if (!sameAddress(swapCall.approvalToken, step.tokenIn)) throw new Error(`Dual flash-loan step ${index} approval token mismatch`);
    if (!approvalAmount.eq(amountIn)) throw new Error(`Dual flash-loan step ${index} approval amount must equal exact input`);
    return {
      target: swapCall.target,
      value,
      callData: swapCall.data,
      approvalToken: swapCall.approvalToken,
      approvalAmount,
    };
  });

  const iface = new ethers.utils.Interface(DUAL_FLASHLOAN_RECEIVER_ABI);
  return {
    to: receiver,
    data: iface.encodeFunctionData('executeDualFlashLoan', [
      loanToken,
      balancerAmount,
      aaveAmount,
      encodedSteps,
      minProfit,
      profitRecipient,
    ]),
    value: '0',
    gasLimit: plan.gasLimit || 1_800_000,
  };
}
