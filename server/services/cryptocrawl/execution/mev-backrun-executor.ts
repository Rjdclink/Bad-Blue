import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { MultiRelaySubmitter } from './multi-relay-submitter.js';

export interface ExactBackrunPlan {
  chain: 'ethereum';
  victimHash: string;
  signedVictimTransaction: string;
  signedBackrunTransaction: string;
  targetBlock: number;
  deterministicNetProfitUsd: number;
  expectedGasUsd: number;
  expiresAt: number;
  provenance: string[];
}

export interface BackrunExecutionResult {
  success: boolean;
  status: 'rejected' | 'submitted' | 'included' | 'not_included' | 'settlement_unknown';
  settlementConfirmed: boolean;
  backrunTransactionHash?: string;
  error?: string;
}

function validHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function strictBackrunPlan(plan: ExactBackrunPlan): string | null {
  if (plan.chain !== 'ethereum') return 'REJECT_BACKRUN_UNSUPPORTED_CHAIN';
  if (!validHash(plan.victimHash)) return 'REJECT_BACKRUN_VICTIM_HASH';
  if (!plan.signedVictimTransaction.startsWith('0x') || !plan.signedBackrunTransaction.startsWith('0x')) return 'REJECT_BACKRUN_UNSIGNED';
  if (!Number.isSafeInteger(plan.targetBlock) || plan.targetBlock <= 0) return 'REJECT_BACKRUN_TARGET_BLOCK';
  if (!Number.isFinite(plan.deterministicNetProfitUsd) || plan.deterministicNetProfitUsd <= 0) return 'REJECT_BACKRUN_NONPOSITIVE_NET';
  if (!Number.isFinite(plan.expectedGasUsd) || plan.expectedGasUsd < 0) return 'REJECT_BACKRUN_GAS_UNKNOWN';
  if (plan.expiresAt <= Date.now()) return 'REJECT_BACKRUN_EXPIRED';
  return null;
}

/**
 * Backrun-only private bundle execution. There is deliberately no front-run leg
 * and no sandwich construction. The victim transaction remains first, unchanged,
 * and the bot transaction may only follow it. MultiRelaySubmitter performs a real
 * relay eth_callBundle simulation before any submission.
 */
export async function executeExactBackrun(plan: ExactBackrunPlan): Promise<BackrunExecutionResult> {
  const rejection = strictBackrunPlan(plan);
  if (rejection) return { success: false, status: 'rejected', settlementConfirmed: false, error: rejection };

  let victim: ethers.utils.Transaction;
  let backrun: ethers.utils.Transaction;
  try {
    victim = ethers.utils.parseTransaction(plan.signedVictimTransaction);
    backrun = ethers.utils.parseTransaction(plan.signedBackrunTransaction);
  } catch {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_BACKRUN_TRANSACTION_PARSE' };
  }
  if (!victim.hash || victim.hash.toLowerCase() !== plan.victimHash.toLowerCase()) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_BACKRUN_VICTIM_IDENTITY' };
  }
  if (!backrun.hash || !validHash(backrun.hash)) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_BACKRUN_HASH' };
  }
  if (victim.from && backrun.from && victim.from.toLowerCase() === backrun.from.toLowerCase()) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_BACKRUN_SELF_VICTIM' };
  }

  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: plan.chain });
  await multiProviderRpcManager.initialize([plan.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(plan.chain, 'json_rpc');
  const currentBlock = await provider.getBlockNumber();
  if (plan.targetBlock <= currentBlock || plan.targetBlock > currentBlock + 3) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_BACKRUN_TARGET_BLOCK_FRESHNESS' };
  }

  const submitter = new MultiRelaySubmitter();
  const submission = await submitter.submitBundle({
    signedTransactions: [plan.signedVictimTransaction, plan.signedBackrunTransaction],
    targetBlock: plan.targetBlock,
  }, plan.targetBlock);
  if (submission.submitted < 1 || submission.successful.length < 1) {
    return { success: false, status: 'not_included', settlementConfirmed: false, backrunTransactionHash: backrun.hash, error: 'BACKRUN_RELAY_SUBMISSION_UNAVAILABLE' };
  }

  const maxBlocks = 3;
  for (let block = plan.targetBlock; block <= plan.targetBlock + maxBlocks; block += 1) {
    while ((await provider.getBlockNumber()) < block) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (Date.now() >= plan.expiresAt + 30_000) {
        return { success: false, status: 'settlement_unknown', settlementConfirmed: false, backrunTransactionHash: backrun.hash, error: 'BACKRUN_RECEIPT_TIMEOUT' };
      }
    }
    const [victimReceipt, backrunReceipt] = await Promise.all([
      provider.getTransactionReceipt(plan.victimHash),
      provider.getTransactionReceipt(backrun.hash),
    ]);
    if (!backrunReceipt) continue;
    const sameBlock = !!victimReceipt && victimReceipt.blockNumber === backrunReceipt.blockNumber;
    const orderedAfter = sameBlock && victimReceipt!.transactionIndex < backrunReceipt.transactionIndex;
    const confirmed = backrunReceipt.status === 1 && victimReceipt?.status === 1 && orderedAfter;
    logger.info('[MEVBackrun] Terminal bundle inclusion checked', {
      component: 'MevBackrunExecutor',
      victimHash: plan.victimHash,
      backrunHash: backrun.hash,
      sameBlock,
      orderedAfter,
      victimStatus: victimReceipt?.status ?? null,
      backrunStatus: backrunReceipt.status,
      settlementConfirmed: confirmed,
      sandwichOrFrontrun: false,
    });
    return {
      success: confirmed,
      status: confirmed ? 'included' : 'not_included',
      settlementConfirmed: confirmed,
      backrunTransactionHash: backrun.hash,
      error: confirmed ? undefined : 'BACKRUN_TERMINAL_ORDER_OR_RECEIPT_MISMATCH',
    };
  }

  return { success: false, status: 'not_included', settlementConfirmed: false, backrunTransactionHash: backrun.hash, error: 'BACKRUN_NOT_INCLUDED' };
}
