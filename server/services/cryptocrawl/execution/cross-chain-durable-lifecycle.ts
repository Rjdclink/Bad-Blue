import { randomUUID } from 'node:crypto';
import { BigNumber, ethers } from 'ethers';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import {
  getAcrossDepositSettlementEvidence,
  type AcrossBridgeQuote,
  type AcrossSettlementEvidence,
  type AcrossStableSymbol,
} from '../bridge/across-bridge-provider.js';
import { getAcrossTerminalAmountEvidence, type AcrossTerminalAmountEvidence } from '../bridge/across-terminal-amount-evidence.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { applyCrossChainSystemCapitalSettlement } from './onchain-system-capital-ledger.js';

const TABLE = 'public.cryptocrawler_cross_chain_lifecycles';
const RESERVATION_TABLE = 'public.cryptocrawler_onchain_inventory_reservations';
const OPEN_STATUSES = ['SUBMITTED', 'SETTLEMENT_UNKNOWN', 'ACCOUNTING_PENDING', 'RECOVERY_REQUIRED'] as const;
const TERMINAL_STATUSES = ['FILLED', 'REFUNDED'] as const;
const workerId = `cross-chain-reconciler:${randomUUID()}`;
const transferInterface = new ethers.utils.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

export type CrossChainLifecycleStatus =
  | 'SUBMITTED' | 'SETTLEMENT_UNKNOWN' | 'ACCOUNTING_PENDING' | 'RECOVERY_REQUIRED' | 'FILLED' | 'REFUNDED' | 'FAILED';

export interface CrossChainSubmissionRecord {
  lifecycleId: string;
  opportunityId: string;
  reservationId: string;
  depositTxnRef: string;
  submittedAt: number;
}

export interface CrossChainLifecycleResult {
  lifecycleId: string;
  opportunityId: string;
  reservationId: string;
  depositTxnRef: string;
  status: CrossChainLifecycleStatus;
  terminal: boolean;
  settlementConfirmed: boolean;
  success: boolean;
  quote: AcrossBridgeQuote;
  expectedProfitUsd: number;
  notionalUsd: number;
  submittedAt: number;
  settledAt: number | null;
  originNativeFeeWei: string;
  settlement: AcrossSettlementEvidence | null;
  terminalAmountEvidence: AcrossTerminalAmountEvidence | null;
  realizedNetProfitUsd: number | null;
  gasUsd: number | null;
  /** Same-asset compatibility price only; cross-asset terminal accounting uses separately measured input/output prices. */
  assetUsd: number | null;
  error?: string;
}

type StoredLifecycle = {
  lifecycleId: string;
  opportunityId: string;
  reservationId: string;
  depositTxnRef: string;
  status: CrossChainLifecycleStatus;
  quote: AcrossBridgeQuote;
  expectedProfitUsd: number;
  notionalUsd: number;
  originNativeFeeWei: string;
  submittedAt: number;
};

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}
function validTxHash(value: string): boolean { return /^0x[0-9a-fA-F]{64}$/.test(value.trim()); }
function asJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return null; }
}
function inputAsset(quote: AcrossBridgeQuote): AcrossStableSymbol {
  return quote.inputSymbol || quote.token;
}
function outputAsset(quote: AcrossBridgeQuote): AcrossStableSymbol {
  return quote.outputSymbol || quote.token;
}
function sameAssetCompatibilityPrice(quote: AcrossBridgeQuote, outputPrice: number | null): number | null {
  return inputAsset(quote) === outputAsset(quote) ? outputPrice : null;
}
function quoteIdentityMatches(left: AcrossBridgeQuote, right: AcrossBridgeQuote): boolean {
  return left.provider === right.provider
    && left.originChain === right.originChain
    && left.destinationChain === right.destinationChain
    && inputAsset(left) === inputAsset(right)
    && outputAsset(left) === outputAsset(right)
    && left.inputToken.toLowerCase() === right.inputToken.toLowerCase()
    && left.outputToken.toLowerCase() === right.outputToken.toLowerCase()
    && left.inputAmount === right.inputAmount
    && left.inputTokenDecimals === right.inputTokenDecimals
    && left.outputTokenDecimals === right.outputTokenDecimals;
}

async function storeReady(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ready', [TABLE]);
    return result.rows?.[0]?.ready === true;
  } catch { return false; }
}

export async function ensureCrossChainLifecycleStoreReady(): Promise<boolean> {
  const ready = await storeReady();
  if (!ready) {
    logger.error('[CrossChainLifecycle] Migration-owned lifecycle store is unavailable; new cross-chain submission fails closed', {
      component: 'CrossChainDurableLifecycle', table: TABLE, runtimeDdlAllowed: false,
    });
  }
  return ready;
}

export async function persistSubmittedAcrossLifecycle(input: {
  opportunityId: string;
  reservationId: string;
  quote: AcrossBridgeQuote;
  depositTxnRef: string;
  originNativeFeeWei: string;
  expectedProfitUsd: number;
  notionalUsd: number;
  submittedAt?: number;
}): Promise<CrossChainSubmissionRecord> {
  if (!await ensureCrossChainLifecycleStoreReady()) throw new Error('CROSS_CHAIN_LIFECYCLE_STORE_UNAVAILABLE');
  if (!input.opportunityId.trim() || !input.reservationId.trim()) throw new Error('CROSS_CHAIN_LIFECYCLE_IDENTITY_INVALID');
  if (!validTxHash(input.depositTxnRef)) throw new Error('CROSS_CHAIN_DEPOSIT_REFERENCE_INVALID');
  if (!/^\d+$/.test(input.originNativeFeeWei)) throw new Error('CROSS_CHAIN_ORIGIN_GAS_INVALID');
  if (!Number.isFinite(input.expectedProfitUsd) || !Number.isFinite(input.notionalUsd) || input.notionalUsd <= 0) throw new Error('CROSS_CHAIN_SUBMISSION_ECONOMICS_INVALID');
  if (input.quote.provider !== 'across' || input.quote.originChain === input.quote.destinationChain) throw new Error('CROSS_CHAIN_QUOTE_IDENTITY_INVALID');
  const submittedAt = Number.isFinite(input.submittedAt) ? Number(input.submittedAt) : Date.now();
  const prior = await pool.query(
    `SELECT lifecycle_id::text, opportunity_id, reservation_id::text, quote, expected_profit_usd, notional_usd, submitted_at
     FROM ${TABLE} WHERE deposit_txn_ref=$1 LIMIT 1`, [input.depositTxnRef.toLowerCase()],
  );
  if (prior.rowCount === 1) {
    const row = prior.rows[0];
    const priorQuote = asJson<AcrossBridgeQuote>(row.quote);
    if (String(row.opportunity_id) !== input.opportunityId
      || String(row.reservation_id) !== input.reservationId
      || !priorQuote || !quoteIdentityMatches(priorQuote, input.quote)
      || Math.abs(Number(row.expected_profit_usd) - input.expectedProfitUsd) > 1e-9
      || Math.abs(Number(row.notional_usd) - input.notionalUsd) > 1e-9) {
      throw new Error('CROSS_CHAIN_LIFECYCLE_IDEMPOTENCY_COLLISION');
    }
    return {
      lifecycleId: String(row.lifecycle_id), opportunityId: input.opportunityId, reservationId: input.reservationId,
      depositTxnRef: input.depositTxnRef.toLowerCase(), submittedAt: new Date(row.submitted_at).getTime(),
    };
  }

  const lifecycleId = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO ${TABLE} (
       lifecycle_id,opportunity_id,reservation_id,provider,deposit_txn_ref,origin_chain,destination_chain,asset,
       input_token_address,output_token_address,input_decimals,output_decimals,input_amount_base_units,
       expected_profit_usd,notional_usd,quote,origin_native_fee_wei,status,submitted_at,updated_at
     ) VALUES ($1,$2,$3::uuid,'across',$4,$5,$6,$7,$8,$9,$10,$11,$12::numeric,$13,$14,$15::jsonb,$16::numeric,'SUBMITTED',to_timestamp($17/1000.0),now())
     ON CONFLICT (deposit_txn_ref) DO NOTHING RETURNING lifecycle_id::text`,
    [
      lifecycleId, input.opportunityId, input.reservationId, input.depositTxnRef.toLowerCase(),
      input.quote.originChain, input.quote.destinationChain, inputAsset(input.quote),
      input.quote.inputToken.toLowerCase(), input.quote.outputToken.toLowerCase(),
      input.quote.inputTokenDecimals, input.quote.outputTokenDecimals, input.quote.inputAmount,
      input.expectedProfitUsd, input.notionalUsd, JSON.stringify(input.quote), input.originNativeFeeWei, submittedAt,
    ],
  );
  if (inserted.rowCount !== 1) return persistSubmittedAcrossLifecycle(input);
  return { lifecycleId, opportunityId: input.opportunityId, reservationId: input.reservationId, depositTxnRef: input.depositTxnRef.toLowerCase(), submittedAt };
}

async function claimOpen(limit: number): Promise<StoredLifecycle[]> {
  if (!await storeReady()) return [];
  const now = Date.now();
  const leaseMs = bounded(process.env.CRYPTOCRAWL_CROSS_CHAIN_RECONCILE_LEASE_MS, 45_000, 10_000, 5 * 60_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT lifecycle_id FROM ${TABLE}
       WHERE status = ANY($1::text[]) AND (reconcile_lease_expires_at IS NULL OR reconcile_lease_expires_at <= now())
       ORDER BY updated_at ASC FOR UPDATE SKIP LOCKED LIMIT $2
     )
     UPDATE ${TABLE} lifecycle
     SET reconcile_lease_owner=$3,reconcile_lease_expires_at=to_timestamp($4/1000.0),updated_at=now()
     FROM candidates WHERE lifecycle.lifecycle_id=candidates.lifecycle_id
     RETURNING lifecycle.lifecycle_id::text,lifecycle.opportunity_id,lifecycle.reservation_id::text,
               lifecycle.deposit_txn_ref,lifecycle.status,lifecycle.quote,lifecycle.expected_profit_usd,
               lifecycle.notional_usd,lifecycle.origin_native_fee_wei::text,lifecycle.submitted_at`,
    [[...OPEN_STATUSES], bounded(limit, 4, 1, 32), workerId, now + leaseMs],
  );
  return result.rows.flatMap(row => {
    const quote = asJson<AcrossBridgeQuote>(row.quote);
    if (!quote) return [];
    return [{
      lifecycleId: String(row.lifecycle_id), opportunityId: String(row.opportunity_id), reservationId: String(row.reservation_id),
      depositTxnRef: String(row.deposit_txn_ref), status: String(row.status) as CrossChainLifecycleStatus, quote,
      expectedProfitUsd: Number(row.expected_profit_usd), notionalUsd: Number(row.notional_usd),
      originNativeFeeWei: String(row.origin_native_fee_wei || '0'), submittedAt: new Date(row.submitted_at).getTime(),
    }];
  });
}

async function extendReservation(reservationId: string): Promise<boolean> {
  const holdMs = bounded(process.env.CRYPTOCRAWL_CROSS_CHAIN_RESERVATION_HOLD_MS, 6 * 60 * 60_000, 30 * 60_000, 7 * 24 * 60 * 60_000);
  const result = await pool.query(
    `UPDATE ${RESERVATION_TABLE} SET expires_at=GREATEST(expires_at,to_timestamp($2/1000.0)) WHERE reservation_id=$1::uuid`,
    [reservationId, Date.now() + holdMs],
  );
  return result.rowCount > 0;
}

async function updateLifecycle(input: {
  lifecycleId: string;
  status: CrossChainLifecycleStatus;
  settlement?: AcrossSettlementEvidence | null;
  terminalAmount?: AcrossTerminalAmountEvidence | null;
  realizedNetProfitUsd?: number | null;
  gasUsd?: number | null;
  assetUsd?: number | null;
  error?: string | null;
  terminal?: boolean;
}): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE}
     SET status=$2,settlement_evidence=COALESCE($3::jsonb,settlement_evidence),terminal_amount_evidence=COALESCE($4::jsonb,terminal_amount_evidence),
         realized_net_profit_usd=$5,gas_usd=$6,asset_usd=$7,last_error=$8,last_checked_at=now(),
         terminal_at=CASE WHEN $9 THEN COALESCE(terminal_at,now()) ELSE terminal_at END,
         reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,updated_at=now()
     WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$10`,
    [
      input.lifecycleId, input.status, input.settlement ? JSON.stringify(input.settlement) : null,
      input.terminalAmount ? JSON.stringify(input.terminalAmount) : null,
      input.realizedNetProfitUsd ?? null, input.gasUsd ?? null, input.assetUsd ?? null, input.error ?? null,
      input.terminal === true, workerId,
    ],
  );
}

async function liveUsd(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([upper]).catch(() => new Map<string, number>());
  const value = prices.get(upper);
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

async function gasUsd(quote: AcrossBridgeQuote, originNativeFeeWei: string): Promise<number | null> {
  if (!/^\d+$/.test(originNativeFeeWei)) return null;
  const nativePrice = await liveUsd(SUPPORTED_CHAINS[quote.originChain].currency);
  if (nativePrice === null) return null;
  const native = Number(ethers.utils.formatEther(BigNumber.from(originNativeFeeWei)));
  return Number.isFinite(native) ? native * nativePrice : null;
}

async function exactRefundAmount(quote: AcrossBridgeQuote, settlement: AcrossSettlementEvidence): Promise<string | null> {
  if (!settlement.refundReceiptVerified || !settlement.refundTxnRef) return null;
  const depositor = (process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || '').trim();
  if (!ethers.utils.isAddress(depositor)) return null;
  await multiProviderRpcManager.initialize([quote.originChain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(quote.originChain, 'json_rpc');
  const receipt = await provider.getTransactionReceipt(settlement.refundTxnRef);
  if (!receipt || receipt.status !== 1) return null;
  let total = BigNumber.from(0);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== quote.inputToken.toLowerCase()) continue;
    try {
      const parsed = transferInterface.parseLog(log);
      if (parsed.name !== 'Transfer' || String(parsed.args.to).toLowerCase() !== depositor.toLowerCase()) continue;
      total = total.add(BigNumber.from(parsed.args.value));
    } catch { /* unrelated token log */ }
  }
  return total.gt(0) ? total.toString() : null;
}

function pendingResult(stored: StoredLifecycle, status: CrossChainLifecycleStatus, settlement: AcrossSettlementEvidence | null, error?: string): CrossChainLifecycleResult {
  return {
    ...stored, status, terminal: false, settlementConfirmed: settlement?.financiallyTerminal === true, success: false,
    settledAt: null, settlement, terminalAmountEvidence: null, realizedNetProfitUsd: null, gasUsd: null, assetUsd: null, error,
  };
}

async function reconcileOne(stored: StoredLifecycle): Promise<CrossChainLifecycleResult> {
  if (!await extendReservation(stored.reservationId)) {
    const error = 'CROSS_CHAIN_DURABLE_RESERVATION_MISSING';
    await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'RECOVERY_REQUIRED', error });
    return pendingResult(stored, 'RECOVERY_REQUIRED', null, error);
  }

  let settlement: AcrossSettlementEvidence | null = null;
  try {
    settlement = await getAcrossDepositSettlementEvidence({
      depositTxnRef: stored.depositTxnRef, originChain: stored.quote.originChain, destinationChain: stored.quote.destinationChain,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'SETTLEMENT_UNKNOWN', error: message });
    return pendingResult(stored, 'SETTLEMENT_UNKNOWN', null, message);
  }
  if (!settlement) {
    const error = 'ACROSS_SETTLEMENT_EVIDENCE_UNAVAILABLE';
    await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'SETTLEMENT_UNKNOWN', error });
    return pendingResult(stored, 'SETTLEMENT_UNKNOWN', null, error);
  }
  if (!settlement.financiallyTerminal) {
    const status: CrossChainLifecycleStatus = settlement.requiresRecovery ? 'RECOVERY_REQUIRED' : 'SETTLEMENT_UNKNOWN';
    const error = settlement.requiresRecovery ? `ACROSS_RECOVERY_REQUIRED:${settlement.providerStatus}` : undefined;
    await updateLifecycle({ lifecycleId: stored.lifecycleId, status, settlement, error });
    return pendingResult(stored, status, settlement, error);
  }

  if (settlement.successful && settlement.destinationReceiptVerified) {
    const terminalAmount = await getAcrossTerminalAmountEvidence({ quote: stored.quote, settlement }).catch(() => null);
    if (!terminalAmount) {
      const error = 'CROSS_CHAIN_TERMINAL_AMOUNT_EVIDENCE_UNAVAILABLE';
      await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'ACCOUNTING_PENDING', settlement, error });
      return pendingResult(stored, 'ACCOUNTING_PENDING', settlement, error);
    }
    const [inputPrice, outputPrice, actualGasUsd] = await Promise.all([
      liveUsd(inputAsset(stored.quote)), liveUsd(outputAsset(stored.quote)), gasUsd(stored.quote, stored.originNativeFeeWei),
    ]);
    const compatibilityPrice = sameAssetCompatibilityPrice(stored.quote, outputPrice);
    if (inputPrice === null || outputPrice === null || actualGasUsd === null) {
      const error = 'CROSS_CHAIN_TERMINAL_USD_ECONOMICS_INCOMPLETE';
      await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'ACCOUNTING_PENDING', settlement, terminalAmount, gasUsd: actualGasUsd, assetUsd: compatibilityPrice, error });
      return { ...pendingResult(stored, 'ACCOUNTING_PENDING', settlement, error), terminalAmountEvidence: terminalAmount, gasUsd: actualGasUsd, assetUsd: compatibilityPrice };
    }
    const inputHuman = Number(ethers.utils.formatUnits(terminalAmount.inputAmount, stored.quote.inputTokenDecimals));
    const outputHuman = Number(ethers.utils.formatUnits(terminalAmount.outputAmount, stored.quote.outputTokenDecimals));
    if (!Number.isFinite(inputHuman) || !Number.isFinite(outputHuman) || inputHuman <= 0 || outputHuman < 0) {
      const error = 'CROSS_CHAIN_TERMINAL_AMOUNTS_INVALID';
      await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'ACCOUNTING_PENDING', settlement, terminalAmount, gasUsd: actualGasUsd, assetUsd: compatibilityPrice, error });
      return { ...pendingResult(stored, 'ACCOUNTING_PENDING', settlement, error), terminalAmountEvidence: terminalAmount, gasUsd: actualGasUsd, assetUsd: compatibilityPrice };
    }
    const inputValueUsd = inputHuman * inputPrice;
    const outputValueUsd = outputHuman * outputPrice;
    const realizedNetProfitUsd = outputValueUsd - inputValueUsd - actualGasUsd;
    await applyCrossChainSystemCapitalSettlement({
      reservationId: stored.reservationId,
      opportunityId: stored.opportunityId,
      originChain: stored.quote.originChain,
      destinationChain: stored.quote.destinationChain,
      inputAsset: inputAsset(stored.quote),
      outputAsset: outputAsset(stored.quote),
      inputTokenAddress: stored.quote.inputToken,
      outputTokenAddress: stored.quote.outputToken,
      inputDecimals: stored.quote.inputTokenDecimals,
      outputDecimals: stored.quote.outputTokenDecimals,
      inputAmountBaseUnits: terminalAmount.inputAmount,
      outputAmountBaseUnits: terminalAmount.outputAmount,
      settlementReference: stored.depositTxnRef,
      settlementEvidence: {
        provider: 'across', depositTxnRef: stored.depositTxnRef,
        destinationReceiptVerified: settlement.destinationReceiptVerified,
        authenticatedAmountEvidence: terminalAmount.authority,
        originNativeFeeWei: stored.originNativeFeeWei,
        inputAsset: inputAsset(stored.quote), outputAsset: outputAsset(stored.quote), inputPriceUsd: inputPrice, outputPriceUsd: outputPrice,
        closedUsdAccounting: true,
      },
    });
    await updateLifecycle({
      lifecycleId: stored.lifecycleId, status: 'FILLED', settlement, terminalAmount, realizedNetProfitUsd,
      gasUsd: actualGasUsd, assetUsd: compatibilityPrice,
      error: realizedNetProfitUsd > 0 ? null : 'CROSS_CHAIN_TERMINAL_NONPOSITIVE_NET', terminal: true,
    });
    return {
      ...stored, status: 'FILLED', terminal: true, settlementConfirmed: true, success: realizedNetProfitUsd > 0,
      settledAt: Date.now(), settlement, terminalAmountEvidence: terminalAmount, realizedNetProfitUsd,
      gasUsd: actualGasUsd, assetUsd: compatibilityPrice,
      error: realizedNetProfitUsd > 0 ? undefined : 'CROSS_CHAIN_TERMINAL_NONPOSITIVE_NET',
    };
  }

  if (settlement.providerStatus === 'refunded' && settlement.refundReceiptVerified) {
    const refundAmount = await exactRefundAmount(stored.quote, settlement).catch(() => null);
    if (refundAmount !== stored.quote.inputAmount) {
      const error = refundAmount === null ? 'CROSS_CHAIN_EXACT_REFUND_AMOUNT_UNAVAILABLE' : 'CROSS_CHAIN_REFUND_AMOUNT_MISMATCH';
      await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'RECOVERY_REQUIRED', settlement, error });
      return pendingResult(stored, 'RECOVERY_REQUIRED', settlement, error);
    }
    await pool.query(`DELETE FROM ${RESERVATION_TABLE} WHERE reservation_id=$1::uuid`, [stored.reservationId]);
    const actualGasUsd = await gasUsd(stored.quote, stored.originNativeFeeWei);
    const realizedNetProfitUsd = actualGasUsd === null ? null : -actualGasUsd;
    await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'REFUNDED', settlement, realizedNetProfitUsd, gasUsd: actualGasUsd, error: 'CROSS_CHAIN_EXACT_PRINCIPAL_REFUNDED', terminal: true });
    return {
      ...stored, status: 'REFUNDED', terminal: true, settlementConfirmed: true, success: false, settledAt: Date.now(),
      settlement, terminalAmountEvidence: null, realizedNetProfitUsd, gasUsd: actualGasUsd, assetUsd: null,
      error: 'CROSS_CHAIN_EXACT_PRINCIPAL_REFUNDED',
    };
  }

  const error = `ACROSS_RECOVERY_REQUIRED:${settlement.providerStatus || 'unknown_terminal_state'}`;
  await updateLifecycle({ lifecycleId: stored.lifecycleId, status: 'RECOVERY_REQUIRED', settlement, error });
  return pendingResult(stored, 'RECOVERY_REQUIRED', settlement, error);
}

export async function advanceOpenCrossChainLifecycles(limit = 4): Promise<CrossChainLifecycleResult[]> {
  const rows = await claimOpen(limit);
  const results: CrossChainLifecycleResult[] = [];
  for (const row of rows) {
    try { results.push(await reconcileOne(row)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateLifecycle({ lifecycleId: row.lifecycleId, status: 'ACCOUNTING_PENDING', error: message }).catch(() => undefined);
      results.push({ ...pendingResult(row, 'ACCOUNTING_PENDING', null, message) });
      logger.error('[CrossChainLifecycle] Reconciliation failed closed while durable reservation remains authoritative', {
        component: 'CrossChainDurableLifecycle', lifecycleId: row.lifecycleId, opportunityId: row.opportunityId,
        depositTxnRef: row.depositTxnRef, error: message, capitalReleased: false,
      });
    }
  }
  return results;
}

export async function claimPendingCrossChainTerminalFeedback(limit = 8): Promise<CrossChainLifecycleResult[]> {
  if (!await storeReady()) return [];
  const leaseMs = bounded(process.env.CRYPTOCRAWL_CROSS_CHAIN_FEEDBACK_LEASE_MS, 45_000, 10_000, 5 * 60_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT lifecycle_id FROM ${TABLE}
       WHERE status = ANY($1::text[]) AND feedback_applied_at IS NULL
         AND (reconcile_lease_expires_at IS NULL OR reconcile_lease_expires_at <= now())
       ORDER BY terminal_at ASC NULLS LAST, updated_at ASC FOR UPDATE SKIP LOCKED LIMIT $2
     )
     UPDATE ${TABLE} lifecycle
     SET reconcile_lease_owner=$3,reconcile_lease_expires_at=to_timestamp($4/1000.0),updated_at=now()
     FROM candidates WHERE lifecycle.lifecycle_id=candidates.lifecycle_id RETURNING lifecycle.*`,
    [[...TERMINAL_STATUSES], bounded(limit, 8, 1, 32), workerId, Date.now() + leaseMs],
  );
  return result.rows.flatMap(row => {
    const quote = asJson<AcrossBridgeQuote>(row.quote);
    const settlement = asJson<AcrossSettlementEvidence>(row.settlement_evidence);
    const terminalAmount = asJson<AcrossTerminalAmountEvidence>(row.terminal_amount_evidence);
    if (!quote) return [];
    const status = String(row.status) as CrossChainLifecycleStatus;
    const realized = row.realized_net_profit_usd === null ? null : Number(row.realized_net_profit_usd);
    return [{
      lifecycleId: String(row.lifecycle_id), opportunityId: String(row.opportunity_id), reservationId: String(row.reservation_id),
      depositTxnRef: String(row.deposit_txn_ref), status, terminal: true,
      settlementConfirmed: status === 'FILLED'
        ? settlement?.successful === true && settlement.destinationReceiptVerified === true
        : settlement?.refundReceiptVerified === true,
      success: status === 'FILLED' && realized !== null && realized > 0,
      quote, expectedProfitUsd: Number(row.expected_profit_usd), notionalUsd: Number(row.notional_usd),
      submittedAt: new Date(row.submitted_at).getTime(), settledAt: row.terminal_at ? new Date(row.terminal_at).getTime() : null,
      originNativeFeeWei: String(row.origin_native_fee_wei || '0'), settlement, terminalAmountEvidence: terminalAmount,
      realizedNetProfitUsd: realized, gasUsd: row.gas_usd === null ? null : Number(row.gas_usd),
      assetUsd: row.asset_usd === null ? null : Number(row.asset_usd), error: row.last_error ? String(row.last_error) : undefined,
    }];
  });
}

export async function markCrossChainTerminalFeedbackApplied(lifecycleId: string): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE} SET feedback_applied_at=COALESCE(feedback_applied_at,now()),reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,updated_at=now()
     WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$2`, [lifecycleId, workerId],
  );
}

export async function releaseCrossChainTerminalFeedbackLease(lifecycleId: string, error: unknown): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE} SET reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,last_error=COALESCE($3,last_error),updated_at=now()
     WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$2`,
    [lifecycleId, workerId, error instanceof Error ? error.message : String(error)],
  );
}
