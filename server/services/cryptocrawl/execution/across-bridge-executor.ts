import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import {
  getAcrossBridgeQuote,
  getAcrossDepositSettlementEvidence,
  type AcrossBridgeQuote,
  type AcrossSettlementEvidence,
} from '../bridge/across-bridge-provider.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { walletFromPrivateKey } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  armPreparedAcrossOriginTransaction,
  markPreparedAcrossOriginSubmitted,
} from './across-prebroadcast-durability.js';

export interface AcrossBridgeExecutionResult {
  success: boolean;
  status: 'rejected' | 'submitted' | 'settlement_unknown' | 'filled' | 'refunded' | 'failed';
  settlementConfirmed: boolean;
  depositTxnRef?: string;
  settlement?: AcrossSettlementEvidence;
  /** Exact signer-paid origin gas across approval(s) plus the Across swap/deposit when its receipt is known. */
  originNativeFeeWei?: string;
  error?: string;
}

export interface AcrossBridgeExecutionOptions {
  /**
   * Backward-compatible callback name. It is now invoked after the exact origin
   * transaction hash is signed but BEFORE broadcast. The production caller must
   * durably create the lifecycle/reservation row here; the executor then arms
   * that row with the exact signed transaction before any principal can move.
   */
  onSubmitted?: (input: {
    depositTxnRef: string;
    originNativeFeeWei: string;
    submittedAt: number;
  }) => Promise<void> | void;
  /** Return after durable origin submission instead of blocking a scheduler lane for the bridge fill window. */
  returnAfterSubmission?: boolean;
}

type TxPayload = {
  to: string;
  data: string;
  value?: string;
  chainId?: number;
};

function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function validData(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);
}

function parseTx(value: any): TxPayload | null {
  if (!value || !validAddress(value.to) || !validData(value.data)) return null;
  const chainId = value.chainId === undefined ? undefined : Number(value.chainId);
  if (chainId !== undefined && !Number.isInteger(chainId)) return null;
  return {
    to: value.to,
    data: value.data,
    value: value.value === undefined || value.value === null ? '0' : String(value.value),
    chainId,
  };
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function receiptFeeWei(receipt: ethers.providers.TransactionReceipt): ethers.BigNumber {
  const price = receipt.effectiveGasPrice;
  return price ? receipt.gasUsed.mul(price) : ethers.BigNumber.from(0);
}

async function freshExecutionPayload(quote: AcrossBridgeQuote): Promise<{ approvals: TxPayload[]; swap: TxPayload } | null> {
  const apiKey = process.env.ACROSS_API_KEY?.trim();
  const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
  const depositor = (process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || '').trim();
  if (!apiKey || !integratorId || !/^0x[0-9a-fA-F]{4}$/.test(integratorId) || !validAddress(depositor)) return null;

  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount: quote.inputAmount,
    inputToken: quote.inputToken,
    outputToken: quote.outputToken,
    originChainId: String(SUPPORTED_CHAINS[quote.originChain].chainId),
    destinationChainId: String(SUPPORTED_CHAINS[quote.destinationChain].chainId),
    depositor,
    recipient: depositor,
    refundAddress: depositor,
    integratorId,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), bounded(process.env.ACROSS_EXECUTION_REFRESH_TIMEOUT_MS, 8_000, 3_000, 20_000));
  try {
    const response = await fetch(`https://app.across.to/api/swap/approval?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { return null; }
    if (!response.ok || !payload) return null;
    const expiry = Number(payload.quoteExpiryTimestamp) * 1000;
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
    if (payload?.swapTx?.simulationSuccess !== true) return null;
    const swap = parseTx(payload.swapTx);
    if (!swap) return null;
    const approvals = (Array.isArray(payload.approvalTxns) ? payload.approvalTxns : [])
      .map(parseTx)
      .filter((tx): tx is TxPayload => tx !== null);
    if (approvals.length !== (Array.isArray(payload.approvalTxns) ? payload.approvalTxns.length : 0)) return null;

    const freshMinimum = typeof payload.minOutputAmount === 'string' ? BigInt(payload.minOutputAmount) : null;
    const oldMinimum = quote.minOutputAmount ? BigInt(quote.minOutputAmount) : null;
    if (freshMinimum === null || oldMinimum === null || freshMinimum < oldMinimum) return null;
    return { approvals, swap };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeAcrossBridgeQuote(
  quote: AcrossBridgeQuote,
  options: AcrossBridgeExecutionOptions = {},
): Promise<AcrossBridgeExecutionResult> {
  if (quote.provider !== 'across' || quote.originChain === quote.destinationChain) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_ROUTE' };
  }
  if (quote.expiresAt <= Date.now() || quote.simulationSuccess !== true || quote.swapTransactionPresent !== true || !quote.minOutputAmount) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_STALE_UNSIMULATED_OR_UNBOUNDED' };
  }
  const privateKey = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_SIGNER_UNAVAILABLE' };
  }
  if (!options.onSubmitted) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_DURABILITY_CALLBACK_REQUIRED' };
  }

  const refreshedQuote = await getAcrossBridgeQuote({
    originChain: quote.originChain,
    destinationChain: quote.destinationChain,
    token: quote.token,
    amountHuman: Number(ethers.utils.formatUnits(quote.inputAmount, quote.inputTokenDecimals)),
  }).catch(() => null);
  if (!refreshedQuote || refreshedQuote.expiresAt <= Date.now() || refreshedQuote.simulationSuccess !== true || !refreshedQuote.minOutputAmount) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_REFRESHED_QUOTE' };
  }
  if (BigInt(refreshedQuote.minOutputAmount) < BigInt(quote.minOutputAmount)) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_MINIMUM_OUTPUT_WORSENED' };
  }
  const payload = await freshExecutionPayload(refreshedQuote).catch(() => null);
  if (!payload) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_EXECUTION_PAYLOAD' };
  }

  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: quote.originChain });
  await multiProviderRpcManager.initialize([quote.originChain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(quote.originChain, 'json_rpc');
  const wallet = walletFromPrivateKey(privateKey).connect(provider);
  const expectedChainId = SUPPORTED_CHAINS[quote.originChain].chainId;
  let nativeFeeWei = ethers.BigNumber.from(0);

  for (const approval of payload.approvals) {
    if (approval.chainId !== undefined && approval.chainId !== expectedChainId) {
      return { success: false, status: 'rejected', settlementConfirmed: false, originNativeFeeWei: nativeFeeWei.toString(), error: 'REJECT_ACROSS_APPROVAL_CHAIN' };
    }
    try {
      const tx = await wallet.sendTransaction({ to: approval.to, data: approval.data, value: ethers.BigNumber.from(approval.value || '0') });
      const receipt = await tx.wait();
      if (receipt) nativeFeeWei = nativeFeeWei.add(receiptFeeWei(receipt));
      if (!receipt || receipt.status !== 1) {
        return { success: false, status: 'failed', settlementConfirmed: true, originNativeFeeWei: nativeFeeWei.toString(), error: 'ACROSS_APPROVAL_FAILED' };
      }
    } catch (error) {
      // Approval ambiguity cannot move the reserved bridge principal. The caller
      // may safely release the principal reservation; only approval gas/allowance
      // state is uncertain and no cross-chain lifecycle is created.
      return {
        success: false,
        status: 'failed',
        settlementConfirmed: false,
        originNativeFeeWei: nativeFeeWei.toString(),
        error: `ACROSS_APPROVAL_STATE_UNCERTAIN:${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (payload.swap.chainId !== undefined && payload.swap.chainId !== expectedChainId) {
    return { success: false, status: 'rejected', settlementConfirmed: false, originNativeFeeWei: nativeFeeWei.toString(), error: 'REJECT_ACROSS_SWAP_CHAIN' };
  }

  let signedOriginTx: string;
  let depositTxnRef: string;
  try {
    const populated = await wallet.populateTransaction({
      to: payload.swap.to,
      data: payload.swap.data,
      value: ethers.BigNumber.from(payload.swap.value || '0'),
    });
    if (populated.chainId !== expectedChainId) {
      return { success: false, status: 'rejected', settlementConfirmed: false, originNativeFeeWei: nativeFeeWei.toString(), error: 'REJECT_ACROSS_POPULATED_CHAIN' };
    }
    if (populated.from && populated.from.toLowerCase() !== wallet.address.toLowerCase()) {
      return { success: false, status: 'rejected', settlementConfirmed: false, originNativeFeeWei: nativeFeeWei.toString(), error: 'REJECT_ACROSS_POPULATED_SIGNER' };
    }
    signedOriginTx = await wallet.signTransaction(populated);
    depositTxnRef = ethers.utils.keccak256(signedOriginTx).toLowerCase();
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      settlementConfirmed: false,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: `ACROSS_ORIGIN_SIGNING_FAILED:${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const preparedAt = Date.now();
  try {
    await options.onSubmitted({
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      submittedAt: preparedAt,
    });
  } catch (error) {
    // No principal broadcast has occurred yet. If lifecycle insertion fails,
    // return without the hash so the caller can release the principal reservation.
    logger.error('[AcrossBridgeExecution] Pre-broadcast lifecycle insertion failed; origin principal was not broadcast', {
      component: 'AcrossBridgeExecutor',
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      principalBroadcast: false,
      capitalReleaseAllowed: true,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      status: 'failed',
      settlementConfirmed: true,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: 'ACROSS_PREBROADCAST_LIFECYCLE_INSERT_FAILED',
    };
  }

  try {
    await armPreparedAcrossOriginTransaction({ depositTxnRef, signedOriginTx, preparedAt });
  } catch (error) {
    // The lifecycle row exists and therefore owns the reservation/parent slot.
    // Do not broadcast. Recovery can prove this pre-broadcast state and close it.
    logger.error('[AcrossBridgeExecution] Signed origin transaction could not be durably armed; principal remains unbroadcast and reserved', {
      component: 'AcrossBridgeExecutor',
      depositTxnRef,
      principalBroadcast: false,
      capitalReleaseAllowed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      status: 'settlement_unknown',
      settlementConfirmed: false,
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: 'ACROSS_PREBROADCAST_ARMING_RECOVERY_REQUIRED',
    };
  }

  let submitted: ethers.providers.TransactionResponse;
  try {
    submitted = await provider.sendTransaction(signedOriginTx);
    if (submitted.hash.toLowerCase() !== depositTxnRef) throw new Error('ACROSS_BROADCAST_HASH_MISMATCH');
  } catch (error) {
    // This is the key ambiguous-broadcast case. The exact signed bytes are
    // durable already, so the recovery worker can query/rebroadcast only this
    // same nonce/hash. A second principal transaction is impossible by design.
    logger.warn('[AcrossBridgeExecution] Origin broadcast acknowledgement is uncertain; exact signed transaction remains durable', {
      component: 'AcrossBridgeExecutor',
      depositTxnRef,
      capitalReleaseAllowed: false,
      duplicateSubmissionAllowed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      status: 'settlement_unknown',
      settlementConfirmed: false,
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: 'ACROSS_ORIGIN_BROADCAST_RECOVERY_REQUIRED',
    };
  }

  let originReceipt: ethers.providers.TransactionReceipt | null = null;
  try {
    originReceipt = await submitted.wait();
  } catch (error) {
    logger.warn('[AcrossBridgeExecution] Origin receipt wait is uncertain; exact hash remains durable for recovery', {
      component: 'AcrossBridgeExecutor', depositTxnRef, capitalReleaseAllowed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      status: 'settlement_unknown',
      settlementConfirmed: false,
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: 'ACROSS_ORIGIN_RECEIPT_RECOVERY_REQUIRED',
    };
  }

  if (originReceipt) nativeFeeWei = nativeFeeWei.add(receiptFeeWei(originReceipt));
  if (!originReceipt || originReceipt.status !== 1) {
    // Keep PREPARED durable state. Recovery reads the authoritative receipt,
    // releases untouched principal, and records the exact realized gas loss.
    return {
      success: false,
      status: 'failed',
      settlementConfirmed: true,
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: 'ACROSS_ORIGIN_DEPOSIT_FAILED',
    };
  }

  const broadcastAt = Date.now();
  try {
    await markPreparedAcrossOriginSubmitted({
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      broadcastAt,
    });
  } catch (error) {
    logger.error('[AcrossBridgeExecution] Origin deposit succeeded but PREPARED->SUBMITTED transition failed; recovery retains authority', {
      component: 'AcrossBridgeExecutor', depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(),
      originDepositSucceeded: true, capitalReleaseAllowed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      status: 'settlement_unknown',
      settlementConfirmed: false,
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
      error: 'ACROSS_SUBMISSION_DURABILITY_TRANSITION_FAILED',
    };
  }

  if (options.returnAfterSubmission) {
    return {
      success: false,
      status: 'submitted',
      settlementConfirmed: false,
      depositTxnRef,
      originNativeFeeWei: nativeFeeWei.toString(),
    };
  }

  const timeoutMs = bounded(process.env.ACROSS_TERMINAL_SETTLEMENT_TIMEOUT_MS, 20 * 60_000, 30_000, 2 * 60 * 60_000);
  const pollMs = bounded(process.env.ACROSS_TERMINAL_SETTLEMENT_POLL_MS, 8_000, 2_000, 60_000);
  const deadline = Date.now() + timeoutMs;
  let last: AcrossSettlementEvidence | undefined;
  while (Date.now() <= deadline) {
    last = await getAcrossDepositSettlementEvidence({
      depositTxnRef,
      originChain: quote.originChain,
      destinationChain: quote.destinationChain,
    }).catch(() => null) || undefined;
    if (last?.financiallyTerminal) {
      const confirmed = last.successful && last.destinationReceiptVerified;
      logger.info('[AcrossBridgeExecution] Terminal bridge settlement observed', {
        component: 'AcrossBridgeExecutor',
        depositTxnRef,
        providerStatus: last.providerStatus,
        financiallyTerminal: last.financiallyTerminal,
        destinationReceiptVerified: last.destinationReceiptVerified,
        refundReceiptVerified: last.refundReceiptVerified,
        originNativeFeeWei: nativeFeeWei.toString(),
      });
      return {
        success: confirmed,
        status: confirmed ? 'filled' : last.providerStatus === 'refunded' ? 'refunded' : 'failed',
        settlementConfirmed: confirmed || (last.providerStatus === 'refunded' && last.refundReceiptVerified),
        depositTxnRef,
        settlement: last,
        originNativeFeeWei: nativeFeeWei.toString(),
        error: confirmed ? undefined : `ACROSS_TERMINAL_${last.providerStatus || 'FAILED'}`,
      };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return {
    success: false,
    status: 'settlement_unknown',
    settlementConfirmed: false,
    depositTxnRef,
    settlement: last,
    originNativeFeeWei: nativeFeeWei.toString(),
    error: 'ACROSS_TERMINAL_SETTLEMENT_TIMEOUT',
  };
}
