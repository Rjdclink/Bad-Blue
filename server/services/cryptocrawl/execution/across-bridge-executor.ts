import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import {
  getAcrossCrossSwapQuote,
  getAcrossDepositSettlementEvidence,
  type AcrossBridgeQuote,
  type AcrossSettlementEvidence,
} from '../bridge/across-bridge-provider.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { walletFromPrivateKey } from '../core/wallet-identity.js';
import { evaluateAcrossClosedUsdProfit } from '../discovery/cross-chain-route-economics.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { armPreparedAcrossOriginTransaction, markPreparedAcrossOriginSubmitted } from './across-prebroadcast-durability.js';
import { executePreparedSystemOwnedNativeTransaction, executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';

export interface AcrossBridgeExecutionResult {
  success: boolean;
  status: 'rejected' | 'submitted' | 'settlement_unknown' | 'filled' | 'refunded' | 'failed';
  settlementConfirmed: boolean;
  depositTxnRef?: string;
  settlement?: AcrossSettlementEvidence;
  originNativeFeeWei?: string;
  approvalTxnRefs?: string[];
  prebroadcastTerminalCostComplete?: boolean;
  error?: string;
}

export interface AcrossBridgeExecutionOptions {
  onSubmitted?: (input: { depositTxnRef: string; originNativeFeeWei: string; submittedAt: number }) => Promise<void> | void;
  returnAfterSubmission?: boolean;
}

type TxPayload = { to: string; data: string; value?: string; chainId?: number };

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
  return { to: value.to, data: value.data, value: value.value === undefined || value.value === null ? '0' : String(value.value), chainId };
}
function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}
function gasIntentKey(parts: readonly string[]): string {
  return parts.map(part => part.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '_')).join(':').slice(0, 220);
}
function sameRouteIdentity(left: AcrossBridgeQuote, right: AcrossBridgeQuote): boolean {
  return right.inputToken.toLowerCase() === left.inputToken.toLowerCase()
    && right.outputToken.toLowerCase() === left.outputToken.toLowerCase()
    && right.inputSymbol === left.inputSymbol
    && right.outputSymbol === left.outputSymbol
    && right.inputAmount === left.inputAmount
    && right.originChain === left.originChain
    && right.destinationChain === left.destinationChain;
}

async function liveApprovalGasUsd(quote: AcrossBridgeQuote, approvalWei: ethers.BigNumber): Promise<number | null> {
  if (approvalWei.isZero()) return 0;
  const symbol = SUPPORTED_CHAINS[quote.originChain].currency;
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([symbol]).catch(() => new Map<string, number>());
  const price = prices.get(symbol);
  if (!Number.isFinite(price) || Number(price) <= 0) return null;
  const native = Number(ethers.utils.formatEther(approvalWei));
  return Number.isFinite(native) && native >= 0 ? native * Number(price) : null;
}

async function postApprovalEconomicsPositive(quote: AcrossBridgeQuote, actualApprovalGasUsd: number): Promise<boolean> {
  const prices = await coinGeckoPriceClient
    .getLiveSymbolPrices([...new Set([quote.inputSymbol, quote.outputSymbol])])
    .catch(() => new Map<string, number>());
  const inputPrice = prices.get(quote.inputSymbol);
  const outputPrice = prices.get(quote.outputSymbol);
  if (!Number.isFinite(inputPrice) || Number(inputPrice) <= 0 || !Number.isFinite(outputPrice) || Number(outputPrice) <= 0) return false;
  const economics = evaluateAcrossClosedUsdProfit({
    quote: {
      ...quote,
      approvalTransactions: actualApprovalGasUsd > 0 ? 1 : 0,
      approvalGasUsd: actualApprovalGasUsd,
    },
    liveInputAssetUsdPrice: Number(inputPrice),
    liveOutputAssetUsdPrice: Number(outputPrice),
  });
  return economics?.executablePositive === true;
}

/**
 * Reacquire the exact execution payload from Across. The request is intentionally
 * uncached. Its guaranteed minimum may improve but cannot worsen relative to the
 * quote supplied to this function, and provider simulation must still succeed.
 */
async function freshExecutionPayload(quote: AcrossBridgeQuote): Promise<{ approvals: TxPayload[]; swap: TxPayload } | null> {
  const apiKey = process.env.ACROSS_API_KEY?.trim();
  const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
  const depositor = (process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || '').trim();
  if (!apiKey || !integratorId || !/^0x[0-9a-fA-F]{4}$/.test(integratorId) || !validAddress(depositor)) return null;

  const params = new URLSearchParams({
    tradeType: 'exactInput', amount: quote.inputAmount,
    inputToken: quote.inputToken, outputToken: quote.outputToken,
    originChainId: String(SUPPORTED_CHAINS[quote.originChain].chainId),
    destinationChainId: String(SUPPORTED_CHAINS[quote.destinationChain].chainId),
    depositor, recipient: depositor, refundAddress: depositor, integratorId,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), bounded(process.env.ACROSS_EXECUTION_REFRESH_TIMEOUT_MS, 8_000, 3_000, 20_000));
  try {
    const response = await fetch(`https://app.across.to/api/swap/approval?${params.toString()}`, {
      method: 'GET', headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { return null; }
    if (!response.ok || !payload) return null;
    const expiry = Number(payload.quoteExpiryTimestamp) * 1000;
    if (!Number.isFinite(expiry) || expiry <= Date.now() || payload?.swapTx?.simulationSuccess !== true) return null;
    const swap = parseTx(payload.swapTx);
    if (!swap) return null;
    const rawApprovals = Array.isArray(payload.approvalTxns) ? payload.approvalTxns : [];
    const approvals = rawApprovals.map(parseTx).filter((tx): tx is TxPayload => tx !== null);
    if (approvals.length !== rawApprovals.length) return null;
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
  if (quote.approvalGasUsd === null || !Number.isFinite(quote.approvalGasUsd) || quote.approvalGasUsd < 0) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_APPROVAL_GAS_EVIDENCE' };
  }
  const privateKey = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!privateKey) return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_SIGNER_UNAVAILABLE' };
  if (!options.onSubmitted) return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_DURABILITY_CALLBACK_REQUIRED' };

  const amountHuman = Number(ethers.utils.formatUnits(quote.inputAmount, quote.inputTokenDecimals));
  const refreshedQuote = await getAcrossCrossSwapQuote({
    originChain: quote.originChain,
    destinationChain: quote.destinationChain,
    inputSymbol: quote.inputSymbol,
    outputSymbol: quote.outputSymbol,
    amountHuman,
  }).catch(() => null);
  if (!refreshedQuote || refreshedQuote.expiresAt <= Date.now() || refreshedQuote.simulationSuccess !== true || !refreshedQuote.minOutputAmount) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_REFRESHED_QUOTE' };
  }
  if (!sameRouteIdentity(quote, refreshedQuote)) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_REFRESHED_ROUTE_IDENTITY_DRIFT' };
  }
  if (BigInt(refreshedQuote.minOutputAmount) < BigInt(quote.minOutputAmount)) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_MINIMUM_OUTPUT_WORSENED' };
  }
  let payload = await freshExecutionPayload(refreshedQuote).catch(() => null);
  if (!payload) return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_EXECUTION_PAYLOAD' };

  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: quote.originChain });
  await multiProviderRpcManager.initialize([quote.originChain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(quote.originChain, 'json_rpc');
  const wallet = walletFromPrivateKey(privateKey).connect(provider);
  const expectedChainId = SUPPORTED_CHAINS[quote.originChain].chainId;
  let nativeFeeWei = ethers.BigNumber.from(0);
  const approvalTxnRefs: string[] = [];
  const prebroadcastCost = (complete: boolean) => ({
    originNativeFeeWei: nativeFeeWei.toString(), approvalTxnRefs: [...approvalTxnRefs], prebroadcastTerminalCostComplete: complete,
  });

  for (let approvalIndex = 0; approvalIndex < payload.approvals.length; approvalIndex += 1) {
    const approval = payload.approvals[approvalIndex];
    if (approval.chainId !== undefined && approval.chainId !== expectedChainId) {
      return { success: false, status: 'rejected', settlementConfirmed: false, ...prebroadcastCost(true), error: 'REJECT_ACROSS_APPROVAL_CHAIN' };
    }
    try {
      const result = await executeSystemOwnedNativeTransaction({
        chain: quote.originChain, wallet, provider,
        idempotencyKey: gasIntentKey([
          'across-approval', quote.originChain, quote.destinationChain, quote.inputSymbol, quote.outputSymbol,
          quote.inputToken, quote.inputAmount, String(approvalIndex), approval.to, approval.data.slice(0, 34),
        ]),
        purpose: 'across_origin_approval',
        transaction: { to: approval.to, data: approval.data, value: ethers.BigNumber.from(approval.value || '0') },
        confirmations: 1,
      });
      approvalTxnRefs.push(result.transactionHash);
      nativeFeeWei = nativeFeeWei.add(result.actualSpentWei.toString());
      if (result.receipt.status !== 1) {
        return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_APPROVAL_FAILED' };
      }
    } catch (error) {
      return {
        success: false, status: 'failed', settlementConfirmed: false, ...prebroadcastCost(false),
        error: `ACROSS_SYSTEM_OWNED_APPROVAL_GAS_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Approval receipts change allowance state. Reacquire the canonical quote and
  // payload after those receipts, then prove that the exact current route remains
  // positive after the actual approval gas already spent. Principal is never
  // broadcast when the post-approval economics no longer clear zero.
  if (approvalTxnRefs.length > 0) {
    const actualApprovalGasUsd = await liveApprovalGasUsd(quote, nativeFeeWei);
    if (actualApprovalGasUsd === null) {
      return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_POST_APPROVAL_GAS_USD_UNAVAILABLE' };
    }
    const postApprovalQuote = await getAcrossCrossSwapQuote({
      originChain: quote.originChain,
      destinationChain: quote.destinationChain,
      inputSymbol: quote.inputSymbol,
      outputSymbol: quote.outputSymbol,
      amountHuman,
    }).catch(() => null);
    if (!postApprovalQuote || !postApprovalQuote.minOutputAmount || !sameRouteIdentity(quote, postApprovalQuote)) {
      return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_POST_APPROVAL_QUOTE_UNAVAILABLE' };
    }
    if (BigInt(postApprovalQuote.minOutputAmount) < BigInt(quote.minOutputAmount)) {
      return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_POST_APPROVAL_MINIMUM_OUTPUT_WORSENED' };
    }
    if (!await postApprovalEconomicsPositive(postApprovalQuote, actualApprovalGasUsd)) {
      return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_POST_APPROVAL_NONPOSITIVE_NET' };
    }
    const postPayload = await freshExecutionPayload(postApprovalQuote).catch(() => null);
    if (!postPayload || postPayload.approvals.length > 0) {
      return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_POST_APPROVAL_ALLOWANCE_NOT_SATISFIED' };
    }
    payload = postPayload;
  } else if (!await postApprovalEconomicsPositive(refreshedQuote, 0)) {
    return { success: false, status: 'rejected', settlementConfirmed: false, ...prebroadcastCost(true), error: 'REJECT_ACROSS_REFRESHED_NONPOSITIVE_NET' };
  }

  if (payload.swap.chainId !== undefined && payload.swap.chainId !== expectedChainId) {
    return { success: false, status: 'rejected', settlementConfirmed: false, ...prebroadcastCost(true), error: 'REJECT_ACROSS_SWAP_CHAIN' };
  }

  let signedOriginTx: string;
  let depositTxnRef: string;
  try {
    const populated = await wallet.populateTransaction({
      to: payload.swap.to, data: payload.swap.data, value: ethers.BigNumber.from(payload.swap.value || '0'),
    });
    if (populated.chainId !== expectedChainId) {
      return { success: false, status: 'rejected', settlementConfirmed: false, ...prebroadcastCost(true), error: 'REJECT_ACROSS_POPULATED_CHAIN' };
    }
    if (populated.from && populated.from.toLowerCase() !== wallet.address.toLowerCase()) {
      return { success: false, status: 'rejected', settlementConfirmed: false, ...prebroadcastCost(true), error: 'REJECT_ACROSS_POPULATED_SIGNER' };
    }
    signedOriginTx = await wallet.signTransaction(populated);
    depositTxnRef = ethers.utils.keccak256(signedOriginTx).toLowerCase();
  } catch (error) {
    return { success: false, status: 'failed', settlementConfirmed: false, ...prebroadcastCost(true), error: `ACROSS_ORIGIN_SIGNING_FAILED:${error instanceof Error ? error.message : String(error)}` };
  }

  const preparedAt = Date.now();
  try {
    await options.onSubmitted({ depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), submittedAt: preparedAt });
  } catch (error) {
    logger.error('[AcrossBridgeExecution] Pre-broadcast lifecycle insertion failed; origin principal was not broadcast', {
      component: 'AcrossBridgeExecutor', depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), approvalTxnRefs,
      principalBroadcast: false, capitalReleaseAllowed: true, personalGasFallbackAllowed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, status: 'failed', settlementConfirmed: true, ...prebroadcastCost(true), error: 'ACROSS_PREBROADCAST_LIFECYCLE_INSERT_FAILED' };
  }

  try {
    await armPreparedAcrossOriginTransaction({ depositTxnRef, signedOriginTx, preparedAt });
  } catch (error) {
    logger.error('[AcrossBridgeExecution] Signed origin transaction could not be durably armed; principal remains unbroadcast and reserved', {
      component: 'AcrossBridgeExecutor', depositTxnRef, principalBroadcast: false, capitalReleaseAllowed: false,
      personalGasFallbackAllowed: false, error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, status: 'settlement_unknown', settlementConfirmed: false, depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), error: 'ACROSS_PREBROADCAST_ARMING_RECOVERY_REQUIRED' };
  }

  let originReceipt: ethers.providers.TransactionReceipt;
  try {
    const result = await executePreparedSystemOwnedNativeTransaction({
      chain: quote.originChain, provider,
      idempotencyKey: gasIntentKey(['across-origin', depositTxnRef]),
      purpose: 'across_origin_deposit', signedTransaction: signedOriginTx, confirmations: 1,
    });
    if (result.transactionHash !== depositTxnRef) throw new Error('ACROSS_SYSTEM_GAS_HASH_MISMATCH');
    nativeFeeWei = nativeFeeWei.add(result.actualSpentWei.toString());
    originReceipt = result.receipt;
  } catch (error) {
    logger.warn('[AcrossBridgeExecution] System-owned origin gas unavailable or submission uncertain; exact prepared transaction remains durable', {
      component: 'AcrossBridgeExecutor', depositTxnRef, capitalReleaseAllowed: false, duplicateSubmissionAllowed: false,
      personalGasFallbackAllowed: false, error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, status: 'settlement_unknown', settlementConfirmed: false, depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), error: 'ACROSS_SYSTEM_OWNED_ORIGIN_GAS_RECOVERY_REQUIRED' };
  }

  if (originReceipt.status !== 1) {
    return { success: false, status: 'failed', settlementConfirmed: true, depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), error: 'ACROSS_ORIGIN_DEPOSIT_FAILED' };
  }

  const broadcastAt = Date.now();
  try {
    await markPreparedAcrossOriginSubmitted({ depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), broadcastAt });
  } catch (error) {
    logger.error('[AcrossBridgeExecution] Origin deposit succeeded but PREPARED->SUBMITTED transition failed; recovery retains authority', {
      component: 'AcrossBridgeExecutor', depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(),
      originDepositSucceeded: true, capitalReleaseAllowed: false, error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, status: 'settlement_unknown', settlementConfirmed: false, depositTxnRef, originNativeFeeWei: nativeFeeWei.toString(), error: 'ACROSS_SUBMISSION_DURABILITY_TRANSITION_FAILED' };
  }

  if (options.returnAfterSubmission) {
    return { success: false, status: 'submitted', settlementConfirmed: false, depositTxnRef, originNativeFeeWei: nativeFeeWei.toString() };
  }

  const timeoutMs = bounded(process.env.ACROSS_TERMINAL_SETTLEMENT_TIMEOUT_MS, 20 * 60_000, 30_000, 2 * 60 * 60_000);
  const pollMs = bounded(process.env.ACROSS_TERMINAL_SETTLEMENT_POLL_MS, 8_000, 2_000, 60_000);
  const deadline = Date.now() + timeoutMs;
  let last: AcrossSettlementEvidence | undefined;
  while (Date.now() <= deadline) {
    last = await getAcrossDepositSettlementEvidence({ depositTxnRef, originChain: quote.originChain, destinationChain: quote.destinationChain }).catch(() => null) || undefined;
    if (last?.financiallyTerminal) {
      const confirmed = last.successful && last.destinationReceiptVerified;
      logger.info('[AcrossBridgeExecution] Terminal bridge/cross-swap settlement observed', {
        component: 'AcrossBridgeExecutor', depositTxnRef, inputSymbol: quote.inputSymbol, outputSymbol: quote.outputSymbol,
        providerStatus: last.providerStatus, financiallyTerminal: last.financiallyTerminal,
        destinationReceiptVerified: last.destinationReceiptVerified, refundReceiptVerified: last.refundReceiptVerified,
        originNativeFeeWei: nativeFeeWei.toString(),
      });
      return {
        success: confirmed,
        status: confirmed ? 'filled' : last.providerStatus === 'refunded' ? 'refunded' : 'failed',
        settlementConfirmed: confirmed || (last.providerStatus === 'refunded' && last.refundReceiptVerified),
        depositTxnRef, settlement: last, originNativeFeeWei: nativeFeeWei.toString(),
        error: confirmed ? undefined : `ACROSS_TERMINAL_${last.providerStatus || 'FAILED'}`,
      };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return { success: false, status: 'settlement_unknown', settlementConfirmed: false, depositTxnRef, settlement: last, originNativeFeeWei: nativeFeeWei.toString(), error: 'ACROSS_TERMINAL_SETTLEMENT_TIMEOUT' };
}
