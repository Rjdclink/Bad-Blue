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
import { getCryptocrawlGovernance } from '../governance/index.js';
import { walletFromPrivateKey } from '../core/wallet-identity.js';

export interface AcrossBridgeExecutionResult {
  success: boolean;
  status: 'rejected' | 'submitted' | 'settlement_unknown' | 'filled' | 'refunded' | 'failed';
  settlementConfirmed: boolean;
  depositTxnRef?: string;
  settlement?: AcrossSettlementEvidence;
  error?: string;
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

    const freshExpected = typeof payload.expectedOutputAmount === 'string' ? BigInt(payload.expectedOutputAmount) : null;
    const oldMinimum = quote.minOutputAmount ? BigInt(quote.minOutputAmount) : BigInt(quote.expectedOutputAmount);
    if (freshExpected === null || freshExpected < oldMinimum) return null;
    return { approvals, swap };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeAcrossBridgeQuote(quote: AcrossBridgeQuote): Promise<AcrossBridgeExecutionResult> {
  if (quote.provider !== 'across' || quote.originChain === quote.destinationChain) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_ROUTE' };
  }
  if (quote.expiresAt <= Date.now() || quote.simulationSuccess !== true || quote.swapTransactionPresent !== true) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_STALE_OR_UNSIMULATED' };
  }
  const privateKey = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_SIGNER_UNAVAILABLE' };
  }

  // Re-fetch immediately before signing. The original discovery quote is never
  // trusted as a transaction payload after time has passed.
  const refreshedQuote = await getAcrossBridgeQuote({
    originChain: quote.originChain,
    destinationChain: quote.destinationChain,
    token: quote.token,
    amountHuman: Number(ethers.utils.formatUnits(quote.inputAmount, quote.inputTokenDecimals)),
  }).catch(() => null);
  if (!refreshedQuote || refreshedQuote.expiresAt <= Date.now() || refreshedQuote.simulationSuccess !== true) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_REFRESHED_QUOTE' };
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

  for (const approval of payload.approvals) {
    if (approval.chainId !== undefined && approval.chainId !== expectedChainId) {
      return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_APPROVAL_CHAIN' };
    }
    const tx = await wallet.sendTransaction({ to: approval.to, data: approval.data, value: ethers.BigNumber.from(approval.value || '0') });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return { success: false, status: 'failed', settlementConfirmed: false, error: 'ACROSS_APPROVAL_FAILED' };
    }
  }

  if (payload.swap.chainId !== undefined && payload.swap.chainId !== expectedChainId) {
    return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_ACROSS_SWAP_CHAIN' };
  }
  const submitted = await wallet.sendTransaction({
    to: payload.swap.to,
    data: payload.swap.data,
    value: ethers.BigNumber.from(payload.swap.value || '0'),
  });
  const originReceipt = await submitted.wait();
  if (!originReceipt || originReceipt.status !== 1) {
    return { success: false, status: 'failed', settlementConfirmed: false, depositTxnRef: submitted.hash, error: 'ACROSS_ORIGIN_DEPOSIT_FAILED' };
  }

  const timeoutMs = bounded(process.env.ACROSS_TERMINAL_SETTLEMENT_TIMEOUT_MS, 20 * 60_000, 30_000, 2 * 60 * 60_000);
  const pollMs = bounded(process.env.ACROSS_TERMINAL_SETTLEMENT_POLL_MS, 8_000, 2_000, 60_000);
  const deadline = Date.now() + timeoutMs;
  let last: AcrossSettlementEvidence | undefined;
  while (Date.now() <= deadline) {
    last = await getAcrossDepositSettlementEvidence({
      depositTxnRef: submitted.hash,
      originChain: quote.originChain,
      destinationChain: quote.destinationChain,
    }).catch(() => null) || undefined;
    if (last?.financiallyTerminal) {
      const confirmed = last.successful && last.destinationReceiptVerified;
      logger.info('[AcrossBridgeExecution] Terminal bridge settlement observed', {
        component: 'AcrossBridgeExecutor',
        depositTxnRef: submitted.hash,
        providerStatus: last.providerStatus,
        financiallyTerminal: last.financiallyTerminal,
        destinationReceiptVerified: last.destinationReceiptVerified,
        refundReceiptVerified: last.refundReceiptVerified,
      });
      return {
        success: confirmed,
        status: confirmed ? 'filled' : last.providerStatus === 'refunded' ? 'refunded' : 'failed',
        settlementConfirmed: confirmed || (last.providerStatus === 'refunded' && last.refundReceiptVerified),
        depositTxnRef: submitted.hash,
        settlement: last,
        error: confirmed ? undefined : `ACROSS_TERMINAL_${last.providerStatus || 'FAILED'}`,
      };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return {
    success: false,
    status: 'settlement_unknown',
    settlementConfirmed: false,
    depositTxnRef: submitted.hash,
    settlement: last,
    error: 'ACROSS_TERMINAL_SETTLEMENT_TIMEOUT',
  };
}
