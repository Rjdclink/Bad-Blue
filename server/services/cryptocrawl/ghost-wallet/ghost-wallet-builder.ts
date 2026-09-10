import { ethers } from 'ethers';
import type { GhostWalletMatchedIntentPair } from './intent-book.js';

export interface GhostWalletStep {
  target: string;
  value: string;
  callData: string;
  approvalToken: string;
  approvalAmount: string;
}

export interface GhostWalletPreparedTransaction {
  to: string;
  data: string;
  value: string;
  executionSurface:
    | 'direct_atomic_credit'
    | 'atomic_liability_cycle'
    | 'matched_intent_pair'
    | 'vault_atomic_credit'
    | 'vault_brokered_flash_credit';
  profitLadderAuthority: false;
}

const INTERMEDIARY_ABI = [
  'function executeDirectAtomicCredit(address asset,address capitalSource,uint256 principal,uint256 sourceFee,uint256 minProfit,address profitRecipient,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps)',
  'function executeAtomicLiabilityCycle(address liabilityOracle,bytes liabilityQueryData,address profitAsset,uint256 minProfit,address profitRecipient,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps)',
  'function settleMatchedIntentPair((address owner,address sellToken,address buyToken,uint256 sellAmount,uint256 minBuyAmount,uint16 maxFeeBps,uint256 nonce,uint256 deadline) intentA,bytes signatureA,uint16 feeBpsA,(address owner,address sellToken,address buyToken,uint256 sellAmount,uint256 minBuyAmount,uint16 maxFeeBps,uint256 nonce,uint256 deadline) intentB,bytes signatureB,uint16 feeBpsB,address profitRecipient)',
  'function executeVaultAtomicCredit(address vault,uint256 principal,uint256 sourceFee,uint256 minProfit,address profitRecipient,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps)',
  'function brokerVaultFlashLoan(address vault,address borrower,address token,uint256 amount,uint256 maxBorrowerFee,bytes data) returns (bool)',
];

const iface = new ethers.utils.Interface(INTERMEDIARY_ABI);

function stepTuple(step: GhostWalletStep) {
  return {
    target: ethers.utils.getAddress(step.target),
    value: step.value,
    callData: step.callData,
    approvalToken: step.approvalToken === ethers.constants.AddressZero
      ? ethers.constants.AddressZero
      : ethers.utils.getAddress(step.approvalToken),
    approvalAmount: step.approvalAmount,
  };
}

function prepared(to: string, data: string, executionSurface: GhostWalletPreparedTransaction['executionSurface']): GhostWalletPreparedTransaction {
  return {
    to: ethers.utils.getAddress(to),
    data,
    value: '0',
    executionSurface,
    profitLadderAuthority: false,
  };
}

export function buildDirectAtomicCreditTransaction(input: {
  intermediary: string;
  asset: string;
  capitalSource: string;
  principal: bigint;
  sourceFee: bigint;
  minProfit: bigint;
  profitRecipient: string;
  steps: GhostWalletStep[];
}): GhostWalletPreparedTransaction {
  if (input.principal <= 0n) throw new Error('Ghost Wallet direct principal must be positive');
  if (input.minProfit <= 0n) throw new Error('Ghost Wallet direct minProfit must be positive');
  if (input.steps.length === 0) throw new Error('Ghost Wallet direct route requires at least one step');
  return prepared(
    input.intermediary,
    iface.encodeFunctionData('executeDirectAtomicCredit', [
      ethers.utils.getAddress(input.asset),
      ethers.utils.getAddress(input.capitalSource),
      input.principal.toString(),
      input.sourceFee.toString(),
      input.minProfit.toString(),
      ethers.utils.getAddress(input.profitRecipient),
      input.steps.map(stepTuple),
    ]),
    'direct_atomic_credit',
  );
}

export function buildAtomicLiabilityCycleTransaction(input: {
  intermediary: string;
  liabilityOracle: string;
  liabilityQueryData: string;
  profitAsset: string;
  minProfit: bigint;
  profitRecipient: string;
  steps: GhostWalletStep[];
}): GhostWalletPreparedTransaction {
  if (!ethers.utils.isHexString(input.liabilityQueryData) || ethers.utils.hexDataLength(input.liabilityQueryData) < 4) {
    throw new Error('Ghost Wallet liability query must be ABI-encoded call data');
  }
  if (input.minProfit <= 0n) throw new Error('Ghost Wallet liability-cycle minProfit must be positive');
  if (input.steps.length === 0) throw new Error('Ghost Wallet liability cycle requires at least one step');
  return prepared(
    input.intermediary,
    iface.encodeFunctionData('executeAtomicLiabilityCycle', [
      ethers.utils.getAddress(input.liabilityOracle),
      input.liabilityQueryData,
      ethers.utils.getAddress(input.profitAsset),
      input.minProfit.toString(),
      ethers.utils.getAddress(input.profitRecipient),
      input.steps.map(stepTuple),
    ]),
    'atomic_liability_cycle',
  );
}

export function buildMatchedIntentPairTransaction(input: {
  intermediary: string;
  pair: GhostWalletMatchedIntentPair;
  profitRecipient: string;
}): GhostWalletPreparedTransaction {
  const tuple = (intent: GhostWalletMatchedIntentPair['intentA']) => ({
    owner: ethers.utils.getAddress(intent.owner),
    sellToken: ethers.utils.getAddress(intent.sellToken),
    buyToken: ethers.utils.getAddress(intent.buyToken),
    sellAmount: intent.sellAmount.toString(),
    minBuyAmount: intent.minBuyAmount.toString(),
    maxFeeBps: intent.maxFeeBps,
    nonce: intent.nonce.toString(),
    deadline: intent.deadline,
  });
  return prepared(
    input.intermediary,
    iface.encodeFunctionData('settleMatchedIntentPair', [
      tuple(input.pair.intentA),
      input.pair.intentA.signature,
      input.pair.feeBpsA,
      tuple(input.pair.intentB),
      input.pair.intentB.signature,
      input.pair.feeBpsB,
      ethers.utils.getAddress(input.profitRecipient),
    ]),
    'matched_intent_pair',
  );
}

export function buildVaultAtomicCreditTransaction(input: {
  intermediary: string;
  vault: string;
  principal: bigint;
  sourceFee: bigint;
  minProfit: bigint;
  profitRecipient: string;
  steps: GhostWalletStep[];
}): GhostWalletPreparedTransaction {
  if (input.principal <= 0n) throw new Error('Ghost Wallet vault principal must be positive');
  if (input.minProfit <= 0n) throw new Error('Ghost Wallet vault minProfit must be positive');
  if (input.steps.length === 0) throw new Error('Ghost Wallet vault route requires at least one step');
  return prepared(
    input.intermediary,
    iface.encodeFunctionData('executeVaultAtomicCredit', [
      ethers.utils.getAddress(input.vault),
      input.principal.toString(),
      input.sourceFee.toString(),
      input.minProfit.toString(),
      ethers.utils.getAddress(input.profitRecipient),
      input.steps.map(stepTuple),
    ]),
    'vault_atomic_credit',
  );
}

export function buildVaultBrokeredFlashCreditTransaction(input: {
  intermediary: string;
  vault: string;
  borrower: string;
  token: string;
  amount: bigint;
  maxBorrowerFee: bigint;
  data?: string;
}): GhostWalletPreparedTransaction {
  if (input.amount <= 0n) throw new Error('Ghost Wallet brokered amount must be positive');
  if (input.maxBorrowerFee <= 0n) throw new Error('Ghost Wallet borrower max fee must be positive');
  const data = input.data || '0x';
  if (!ethers.utils.isHexString(data)) throw new Error('Ghost Wallet brokered borrower data must be hex bytes');
  return prepared(
    input.intermediary,
    iface.encodeFunctionData('brokerVaultFlashLoan', [
      ethers.utils.getAddress(input.vault),
      ethers.utils.getAddress(input.borrower),
      ethers.utils.getAddress(input.token),
      input.amount.toString(),
      input.maxBorrowerFee.toString(),
      data,
    ]),
    'vault_brokered_flash_credit',
  );
}

export function ghostWalletIntermediaryInterface(): ethers.utils.Interface {
  return iface;
}