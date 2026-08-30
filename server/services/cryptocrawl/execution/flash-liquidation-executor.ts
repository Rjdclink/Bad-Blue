import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import type { ChainId } from '../bridge/types.js';
import { getCryptocrawlGovernance } from '../governance/index.js';

export interface ExactLiquidationExecutionPlan {
  opportunityId: string;
  chain: ChainId;
  borrower: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: string;
  expectedLiquidationBonusUsd: number;
  expectedFlashFeeUsd: number;
  expectedUnwindCostUsd: number;
  expectedGasUsd: number;
  deterministicNetProfitUsd: number;
  signedAtomicTransaction: string;
  expiresAt: number;
  provenance: string[];
}

export interface LiquidationExecutionResult {
  success: boolean;
  status: 'rejected' | 'submitted' | 'confirmed' | 'failed' | 'settlement_unknown';
  settlementConfirmed: boolean;
  transactionHash?: string;
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  error?: string;
}

function address(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function validate(plan: ExactLiquidationExecutionPlan): string | null {
  if (!plan.opportunityId.trim()) return 'REJECT_LIQUIDATION_ID';
  if (!address(plan.borrower) || !address(plan.debtAsset) || !address(plan.collateralAsset)) return 'REJECT_LIQUIDATION_ADDRESSES';
  try { if (BigInt(plan.debtToCover) <= 0n) return 'REJECT_LIQUIDATION_DEBT_AMOUNT'; } catch { return 'REJECT_LIQUIDATION_DEBT_AMOUNT'; }
  const costs = [plan.expectedLiquidationBonusUsd, plan.expectedFlashFeeUsd, plan.expectedUnwindCostUsd, plan.expectedGasUsd, plan.deterministicNetProfitUsd];
  if (!costs.every(Number.isFinite)) return 'REJECT_LIQUIDATION_ECONOMICS_INCOMPLETE';
  if (plan.expectedFlashFeeUsd < 0 || plan.expectedUnwindCostUsd < 0 || plan.expectedGasUsd < 0) return 'REJECT_LIQUIDATION_NEGATIVE_COST';
  if (!(plan.deterministicNetProfitUsd > 0)) return 'REJECT_LIQUIDATION_NONPOSITIVE_NET';
  if (!plan.signedAtomicTransaction.startsWith('0x')) return 'REJECT_LIQUIDATION_UNSIGNED';
  if (!Number.isFinite(plan.expiresAt) || plan.expiresAt <= Date.now()) return 'REJECT_LIQUIDATION_EXPIRED';
  return null;
}

/**
 * Executes only a pre-built atomic liquidation transaction. Before broadcast the
 * exact signed payload is decoded, simulated with eth_call, and gas-estimated on
 * the target chain. No partial multi-transaction liquidation is accepted.
 */
export async function executeExactFlashLiquidation(plan: ExactLiquidationExecutionPlan): Promise<LiquidationExecutionResult> {
  const rejection = validate(plan);
  if (rejection) return { success: false, status: 'rejected', settlementConfirmed: false, error: rejection };

  let parsed: ethers.utils.Transaction;
  try { parsed = ethers.utils.parseTransaction(plan.signedAtomicTransaction); }
  catch { return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_LIQUIDATION_TRANSACTION_PARSE' }; }
  if (!parsed.hash || !parsed.to || !parsed.from || !parsed.data) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_LIQUIDATION_TRANSACTION_FIELDS' };
  }

  await multiProviderRpcManager.initialize([plan.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(plan.chain, 'json_rpc');
  const network = await provider.getNetwork();
  if (parsed.chainId && parsed.chainId !== network.chainId) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_LIQUIDATION_CHAIN_MISMATCH' };
  }

  const request = {
    from: parsed.from,
    to: parsed.to,
    data: parsed.data,
    value: parsed.value,
    gasPrice: parsed.gasPrice ?? undefined,
    maxFeePerGas: parsed.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? undefined,
  };
  try {
    await provider.call(request, 'latest');
    const estimatedGas = await provider.estimateGas(request);
    if (parsed.gasLimit && parsed.gasLimit.lt(estimatedGas)) {
      return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_LIQUIDATION_GAS_LIMIT_BELOW_ESTIMATE' };
    }
  } catch (error) {
    return {
      success: false,
      status: 'rejected',
      settlementConfirmed: false,
      error: `REJECT_LIQUIDATION_EXACT_SIMULATION:${error instanceof Error ? error.message : String(error)}`,
    };
  }

  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: plan.chain });
  let tx: ethers.providers.TransactionResponse;
  try { tx = await provider.sendTransaction(plan.signedAtomicTransaction); }
  catch (error) {
    return { success: false, status: 'failed', settlementConfirmed: false, transactionHash: parsed.hash, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const receipt = await tx.wait(1);
    const confirmed = receipt.status === 1 && receipt.transactionHash.toLowerCase() === parsed.hash.toLowerCase();
    logger.info('[LiquidationExecution] Exact atomic liquidation terminal receipt', {
      component: 'FlashLiquidationExecutor',
      opportunityId: plan.opportunityId,
      chain: plan.chain,
      transactionHash: receipt.transactionHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      settlementConfirmed: confirmed,
      expectedNetProfitUsd: plan.deterministicNetProfitUsd,
      realizedProfitAuthority: 'downstream_balance_and_receipt_reconciliation_required',
    });
    return {
      success: confirmed,
      status: confirmed ? 'confirmed' : 'failed',
      settlementConfirmed: confirmed,
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: receipt.effectiveGasPrice?.toString(),
      error: confirmed ? undefined : 'LIQUIDATION_RECEIPT_FAILED',
    };
  } catch (error) {
    return { success: false, status: 'settlement_unknown', settlementConfirmed: false, transactionHash: parsed.hash, error: error instanceof Error ? error.message : String(error) };
  }
}
