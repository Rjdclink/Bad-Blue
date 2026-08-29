import { ethers } from 'ethers';
import {
  buildSwapCallFromLeg,
  type BuiltOnchainPayload,
  type OnchainSwapLeg,
  type SupportedExecutionChain,
} from './onchain-payload-builder.js';

export interface CompositeFlashLoanExecutionPlan {
  chain: SupportedExecutionChain;
  receiver: string;
  loanToken: string;
  loanAmount: string;
  minProfit: string;
  profitRecipient: string;
  steps: OnchainSwapLeg[];
  cycleEndStepIndexes: number[];
  gasLimit?: number;
}

const COMPOSITE_RECEIVER_ABI = [
  'function executeBalancerCompositeFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint16[] cycleEndStepIndexes,uint256 minProfit,address profitRecipient) external',
];
const MAX_ATOMIC_SWAP_STEPS = 16;
const MAX_COMPOSITE_CYCLES = 8;

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function parseIntegerString(label: string, raw: string): ethers.BigNumber {
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be an integer string denominated in base units`);
  return ethers.BigNumber.from(raw);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function validateCycleBoundaries(plan: CompositeFlashLoanExecutionPlan): void {
  if (plan.cycleEndStepIndexes.length < 2) throw new Error('Composite execution requires at least two closed cycles');
  if (plan.cycleEndStepIndexes.length > MAX_COMPOSITE_CYCLES) throw new Error(`Composite execution exceeds the ${MAX_COMPOSITE_CYCLES}-cycle bound`);
  if (plan.cycleEndStepIndexes[plan.cycleEndStepIndexes.length - 1] !== plan.steps.length - 1) {
    throw new Error('Composite final cycle must end at the final swap step');
  }
  let prior = -1;
  for (let cycle = 0; cycle < plan.cycleEndStepIndexes.length; cycle++) {
    const end = plan.cycleEndStepIndexes[cycle];
    if (!Number.isInteger(end) || end < 0 || end >= plan.steps.length || end <= prior || end > 65535) {
      throw new Error(`Composite cycle boundary ${cycle} is invalid`);
    }
    if (!sameAddress(plan.steps[end].tokenOut, plan.loanToken)) {
      throw new Error(`Composite cycle ${cycle} does not close back into the borrowed token`);
    }
    const start = prior + 1;
    if (!sameAddress(plan.steps[start].tokenIn, plan.loanToken)) {
      throw new Error(`Composite cycle ${cycle} does not begin with the borrowed token`);
    }
    prior = end;
  }
}

export function buildCompositeFlashLoanReceiverPayload(
  plan: CompositeFlashLoanExecutionPlan,
): BuiltOnchainPayload {
  const receiver = requireAddress('composite receiver', plan.receiver);
  const loanToken = requireAddress('composite loan token', plan.loanToken);
  const profitRecipient = requireAddress('composite profit recipient', plan.profitRecipient);
  if (!Array.isArray(plan.steps) || plan.steps.length < 4) throw new Error('Composite execution requires at least four swap steps');
  if (plan.steps.length > MAX_ATOMIC_SWAP_STEPS) throw new Error(`Composite execution exceeds the ${MAX_ATOMIC_SWAP_STEPS}-step bound`);
  validateCycleBoundaries(plan);

  const loanAmount = parseIntegerString('loanAmount', plan.loanAmount);
  const minProfit = parseIntegerString('minProfit', plan.minProfit);
  if (loanAmount.lte(0)) throw new Error('Composite loan amount must be positive');
  if (minProfit.lte(0)) throw new Error('Composite minimum profit must be positive');

  const encodedSteps = plan.steps.map((step, index) => {
    if (step.recipient && !sameAddress(step.recipient, receiver)) {
      throw new Error(`Composite step ${index} must keep swap proceeds inside the receiver`);
    }
    const swapCall = buildSwapCallFromLeg(plan.chain, receiver, step);
    const value = parseIntegerString(`steps[${index}].value`, swapCall.value);
    const approvalAmount = parseIntegerString(`steps[${index}].approvalAmount`, swapCall.approvalAmount);
    const amountIn = parseIntegerString(`steps[${index}].amountIn`, step.amountIn);
    if (!value.isZero()) throw new Error(`Composite step ${index} attempted unsupported native value`);
    if (!sameAddress(swapCall.approvalToken, step.tokenIn)) throw new Error(`Composite step ${index} approval token mismatch`);
    if (!approvalAmount.eq(amountIn)) throw new Error(`Composite step ${index} approval amount must equal exact input amount`);
    return {
      target: swapCall.target,
      value,
      callData: swapCall.data,
      approvalToken: swapCall.approvalToken,
      approvalAmount,
    };
  });

  const iface = new ethers.utils.Interface(COMPOSITE_RECEIVER_ABI);
  return {
    to: receiver,
    data: iface.encodeFunctionData('executeBalancerCompositeFlashLoan', [
      loanToken,
      loanAmount,
      encodedSteps,
      plan.cycleEndStepIndexes,
      minProfit,
      profitRecipient,
    ]),
    value: '0',
    gasLimit: plan.gasLimit || 5_000_000,
  };
}
