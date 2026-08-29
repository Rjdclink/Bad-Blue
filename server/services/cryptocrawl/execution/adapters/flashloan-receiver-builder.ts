import { ethers } from 'ethers';
import {
  buildSwapCallFromLeg,
  type BuiltOnchainPayload,
  type OnchainSwapLeg,
  type SupportedExecutionChain,
} from './onchain-payload-builder.js';

export interface FlashLoanReceiverExecutionPlan {
  chain: SupportedExecutionChain;
  receiver: string;
  loanToken: string;
  loanAmount: string;
  minProfit: string;
  profitRecipient: string;
  steps: OnchainSwapLeg[];
  gasLimit?: number;
}

const FLASHLOAN_RECEIVER_ABI = [
  'function executeBalancerFlashLoan(address loanToken, uint256 loanAmount, (address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps, uint256 minProfit, address profitRecipient) external',
];

// Solidity receiver has no static step cap; this application-side envelope keeps
// calldata/gas bounded while allowing five ordinary two-leg cycles plus room for
// route-specific extra hops. Exact simulation and estimateGas still gate execution.
const MAX_ATOMIC_SWAP_STEPS = 16;

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseIntegerString(label: string, raw: string): ethers.BigNumber {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} must be an integer string denominated in base units`);
  }
  return ethers.BigNumber.from(raw);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function validateAtomicRouteBalance(plan: FlashLoanReceiverExecutionPlan): void {
  const firstStep = plan.steps[0];
  const lastStep = plan.steps[plan.steps.length - 1];

  if (!sameAddress(firstStep.tokenIn, plan.loanToken)) {
    throw new Error('Flash-loan route must begin with the borrowed token');
  }

  for (let index = 1; index < plan.steps.length; index++) {
    if (!sameAddress(plan.steps[index - 1].tokenOut, plan.steps[index].tokenIn)) {
      throw new Error(`Flash-loan route is not token-contiguous at step ${index}`);
    }
  }

  if (!sameAddress(lastStep.tokenOut, plan.loanToken)) {
    throw new Error('Flash-loan route must end in the borrowed token so repayment remains atomic');
  }

  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    if (parseIntegerString(`steps[${index}].amountIn`, step.amountIn).lte(0)) {
      throw new Error(`Flash-loan step ${index} amountIn must be greater than zero`);
    }
    if (parseIntegerString(`steps[${index}].minAmountOut`, step.minAmountOut).lte(0)) {
      throw new Error(`Flash-loan step ${index} minAmountOut must be greater than zero`);
    }
    if (step.recipient && !sameAddress(step.recipient, plan.receiver)) {
      throw new Error(`Flash-loan step ${index} must keep swap proceeds inside the receiver`);
    }
  }
}

export function buildFlashLoanReceiverPayloadFromPlan(
  plan: FlashLoanReceiverExecutionPlan,
): BuiltOnchainPayload {
  if (!isAddress(plan.receiver)) {
    throw new Error('Flash-loan receiver address must be a valid EVM address');
  }

  if (!isAddress(plan.loanToken)) {
    throw new Error('Flash-loan loanToken must be a valid EVM token address');
  }

  if (!isAddress(plan.profitRecipient)) {
    throw new Error('Flash-loan profitRecipient must be a valid EVM address');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length < 2) {
    throw new Error('Flash-loan execution requires at least two swap legs');
  }
  if (plan.steps.length > MAX_ATOMIC_SWAP_STEPS) {
    throw new Error(`Flash-loan execution exceeds the ${MAX_ATOMIC_SWAP_STEPS}-step atomic command limit`);
  }

  validateAtomicRouteBalance(plan);

  const iface = new ethers.utils.Interface(FLASHLOAN_RECEIVER_ABI);
  const loanAmount = parseIntegerString('loanAmount', plan.loanAmount);
  const minProfit = parseIntegerString('minProfit', plan.minProfit);

  const encodedSteps = plan.steps.map((step, index) => {
    const swapCall = buildSwapCallFromLeg(plan.chain, plan.receiver, step);
    const value = parseIntegerString(`steps[${index}].value`, swapCall.value);
    const approvalAmount = parseIntegerString(`steps[${index}].approvalAmount`, swapCall.approvalAmount);
    const amountIn = parseIntegerString(`steps[${index}].amountIn`, step.amountIn);

    if (!value.isZero()) {
      throw new Error(`Flash-loan step ${index} attempted an unsupported native-value transfer`);
    }
    if (!sameAddress(swapCall.approvalToken, step.tokenIn)) {
      throw new Error(`Flash-loan step ${index} approval token does not match tokenIn`);
    }
    if (!approvalAmount.eq(amountIn)) {
      throw new Error(`Flash-loan step ${index} approval amount must equal its exact input amount`);
    }

    return {
      target: swapCall.target,
      value,
      callData: swapCall.data,
      approvalToken: swapCall.approvalToken,
      approvalAmount,
    };
  });

  return {
    to: plan.receiver,
    data: iface.encodeFunctionData('executeBalancerFlashLoan', [
      plan.loanToken,
      loanAmount,
      encodedSteps,
      minProfit,
      plan.profitRecipient,
    ]),
    value: '0',
    gasLimit: plan.gasLimit || 1200000,
  };
}
