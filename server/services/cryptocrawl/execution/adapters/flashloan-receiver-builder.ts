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

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseIntegerString(label: string, raw: string): ethers.BigNumber {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} must be an integer string denominated in base units`);
  }
  return ethers.BigNumber.from(raw);
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

  const iface = new ethers.utils.Interface(FLASHLOAN_RECEIVER_ABI);
  const loanAmount = parseIntegerString('loanAmount', plan.loanAmount);
  const minProfit = parseIntegerString('minProfit', plan.minProfit);

  const encodedSteps = plan.steps.map(step => {
    const swapCall = buildSwapCallFromLeg(plan.chain, plan.receiver, step);
    return {
      target: swapCall.target,
      value: parseIntegerString('step.value', swapCall.value),
      callData: swapCall.data,
      approvalToken: swapCall.approvalToken,
      approvalAmount: parseIntegerString('step.approvalAmount', swapCall.approvalAmount),
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