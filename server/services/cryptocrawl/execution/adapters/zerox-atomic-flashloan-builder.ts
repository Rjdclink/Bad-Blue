import { BigNumber, ethers } from 'ethers';
import type { BuiltOnchainPayload, SupportedExecutionChain } from './onchain-payload-builder.js';
import type { FlashLoanProviderKind } from './flash-loan-provider-economics.js';
import { resolveZeroXAllowanceHolder } from './zerox-allowance-holder.js';

const BALANCER_RECEIVER_ABI = [
  'function executeBalancerFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
];
const AAVE_RECEIVER_ABI = [
  'function executeAaveFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
];

export interface ZeroXAtomicReceiverStep {
  tokenIn: string;
  target: string;
  callData: string;
  approvalAmount: string;
}

function address(label: string, raw: string): string {
  if (!ethers.utils.isAddress(raw)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(raw);
}

function amount(label: string, raw: string): BigNumber {
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be an integer string`);
  return BigNumber.from(raw);
}

export function buildZeroXAtomicFlashLoanPayload(input: {
  chain: SupportedExecutionChain;
  provider: FlashLoanProviderKind;
  receiver: string;
  loanToken: string;
  loanAmount: string;
  minProfit: string;
  profitRecipient: string;
  steps: ZeroXAtomicReceiverStep[];
  gasLimit?: number;
}): BuiltOnchainPayload {
  const receiver = address('0x atomic receiver', input.receiver);
  const loanToken = address('0x atomic loan token', input.loanToken);
  const profitRecipient = address('0x atomic profit recipient', input.profitRecipient);
  const holder = resolveZeroXAllowanceHolder(input.chain);
  if (!holder) throw new Error(`0x AllowanceHolder is not approved on ${input.chain}`);
  if (input.steps.length < 2 || input.steps.length > 16) throw new Error('0x atomic route requires 2-16 receiver steps');
  const loanAmount = amount('0x atomic loanAmount', input.loanAmount);
  const minProfit = amount('0x atomic minProfit', input.minProfit);
  if (loanAmount.lte(0)) throw new Error('0x atomic loanAmount must be positive');
  if (minProfit.lte(0)) throw new Error('0x atomic minProfit must be positive');

  const encodedSteps = input.steps.map((step, index) => {
    const target = address(`0x step ${index} target`, step.target);
    if (target.toLowerCase() !== holder.toLowerCase()) throw new Error(`0x step ${index} target is not the documented AllowanceHolder`);
    const tokenIn = address(`0x step ${index} tokenIn`, step.tokenIn);
    const approvalAmount = amount(`0x step ${index} approvalAmount`, step.approvalAmount);
    if (approvalAmount.lte(0)) throw new Error(`0x step ${index} approval amount must be positive`);
    if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(step.callData)) throw new Error(`0x step ${index} calldata is invalid`);
    return {
      target,
      value: BigNumber.from(0),
      callData: step.callData,
      approvalToken: tokenIn,
      approvalAmount,
    };
  });

  const isAave = input.provider === 'aave_v3';
  const iface = new ethers.utils.Interface(isAave ? AAVE_RECEIVER_ABI : BALANCER_RECEIVER_ABI);
  const functionName = isAave ? 'executeAaveFlashLoan' : 'executeBalancerFlashLoan';
  return {
    to: receiver,
    data: iface.encodeFunctionData(functionName, [
      loanToken,
      loanAmount,
      encodedSteps,
      minProfit,
      profitRecipient,
    ]),
    value: '0',
    gasLimit: Math.max(500_000, Math.min(5_000_000, Math.trunc(input.gasLimit || 1_800_000))),
  };
}
