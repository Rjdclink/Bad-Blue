import { BigNumber, ethers } from 'ethers';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import type { AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { CrossChainLifecycleResult } from './cross-chain-durable-lifecycle.js';

const TABLE = 'public.cryptocrawler_cross_chain_lifecycles';
const RESERVATION_TABLE = 'public.cryptocrawler_onchain_inventory_reservations';
const workerId = `across-prebroadcast:${process.pid}:${Math.random().toString(16).slice(2)}`;

type PreparedRow = {
  lifecycleId: string;
  opportunityId: string;
  reservationId: string;
  depositTxnRef: string;
  signedOriginTx: string | null;
  originFeeComplete: boolean;
  quote: AcrossBridgeQuote;
  expectedProfitUsd: number;
  notionalUsd: number;
  originNativeFeeWei: string;
  preparedAt: number;
  broadcastAt: number | null;
};

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function validHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function validSignedTransaction(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value.trim()) && value.length > 4;
}

function asQuote(value: unknown): AcrossBridgeQuote | null {
  if (!value) return null;
  if (typeof value === 'object') return value as AcrossBridgeQuote;
  try { return JSON.parse(String(value)) as AcrossBridgeQuote; } catch { return null; }
}

function receiptFeeWei(receipt: ethers.providers.TransactionReceipt): BigNumber {
  return receipt.effectiveGasPrice ? receipt.gasUsed.mul(receipt.effectiveGasPrice) : BigNumber.from(0);
}

async function liveUsd(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([upper]).catch(() => new Map<string, number>());
  const value = prices.get(upper);
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

async function actualGasUsd(quote: AcrossBridgeQuote, feeWei: string): Promise<number | null> {
  if (!/^\d+$/.test(feeWei)) return null;
  const nativeUsd = await liveUsd(SUPPORTED_CHAINS[quote.originChain].currency);
  if (nativeUsd === null) return null;
  const native = Number(ethers.utils.formatEther(BigNumber.from(feeWei)));
  return Number.isFinite(native) ? native * nativeUsd : null;
}

async function extendReservation(reservationId: string): Promise<boolean> {
  const holdMs = bounded(process.env.CRYPTOCRAWL_CROSS_CHAIN_RESERVATION_HOLD_MS, 6 * 60 * 60_000, 30 * 60_000, 7 * 24 * 60 * 60_000);
  const result = await pool.query(
    `UPDATE ${RESERVATION_TABLE}
     SET expires_at=GREATEST(expires_at,to_timestamp($2/1000.0))
     WHERE reservation_id=$1::uuid`,
    [reservationId, Date.now() + holdMs],
  );
  return result.rowCount > 0;
}

function pending(row: PreparedRow, error: string): CrossChainLifecycleResult {
  return {
    lifecycleId: row.lifecycleId,
    opportunityId: row.opportunityId,
    reservationId: row.reservationId,
    depositTxnRef: row.depositTxnRef,
    status: 'RECOVERY_REQUIRED',
    terminal: false,
    settlementConfirmed: false,
    success: false,
    quote: row.quote,
    expectedProfitUsd: row.expectedProfitUsd,
    notionalUsd: row.notionalUsd,
    submittedAt: row.broadcastAt ?? row.preparedAt,
    settledAt: null,
    originNativeFeeWei: row.originNativeFeeWei,
    settlement: null,
    terminalAmountEvidence: null,
    realizedNetProfitUsd: null,
    gasUsd: null,
    assetUsd: null,
    error,
  };
}

function originFailedResult(row: PreparedRow, feeWei: string, gasUsd: number | null, error: string): CrossChainLifecycleResult {
  return {
    lifecycleId: row.lifecycleId,
    opportunityId: row.opportunityId,
    reservationId: row.reservationId,
    depositTxnRef: row.depositTxnRef,
    status: 'FAILED',
    terminal: true,
    settlementConfirmed: true,
    success: false,
    quote: row.quote,
    expectedProfitUsd: row.expectedProfitUsd,
    notionalUsd: row.notionalUsd,
    submittedAt: row.broadcastAt ?? row.preparedAt,
    settledAt: Date.now(),
    originNativeFeeWei: feeWei,
    settlement: null,
    terminalAmountEvidence: null,
    realizedNetProfitUsd: gasUsd === null ? null : -gasUsd,
    gasUsd,
    assetUsd: null,
    error,
  };
}

/**
 * Arms a lifecycle row that the canonical adapter already inserted. The signed
 * transaction is the exact immutable recovery artifact: rebroadcasting it can
 * only reproduce the same nonce/hash and can never create a second principal move.
 */
export async function armPreparedAcrossOriginTransaction(input: {
  depositTxnRef: string;
  signedOriginTx: string;
  preparedAt: number;
}): Promise<void> {
  const hash = input.depositTxnRef.trim().toLowerCase();
  const raw = input.signedOriginTx.trim();
  if (!validHash(hash) || !validSignedTransaction(raw)) throw new Error('ACROSS_PREPARED_SIGNED_TX_INVALID');
  if (ethers.utils.keccak256(raw).toLowerCase() !== hash) throw new Error('ACROSS_PREPARED_SIGNED_TX_HASH_MISMATCH');
  const parsed = ethers.utils.parseTransaction(raw);
  if (!parsed.chainId || !Object.values(SUPPORTED_CHAINS).some(chain => chain.chainId === parsed.chainId)) {
    throw new Error('ACROSS_PREPARED_SIGNED_TX_CHAIN_INVALID');
  }
  const result = await pool.query(
    `UPDATE ${TABLE}
     SET signed_origin_tx=$2,status='PREPARED',origin_fee_complete=false,broadcast_at=NULL,last_error=NULL,updated_at=now()
     WHERE deposit_txn_ref=$1 AND status='SUBMITTED' AND origin_fee_complete=false
     RETURNING lifecycle_id`,
    [hash, raw],
  );
  if (result.rowCount !== 1) {
    const prior = await pool.query(
      `SELECT signed_origin_tx,status FROM ${TABLE} WHERE deposit_txn_ref=$1 LIMIT 1`,
      [hash],
    );
    const row = prior.rows?.[0];
    if (String(row?.status || '') === 'PREPARED' && String(row?.signed_origin_tx || '') === raw) return;
    throw new Error('ACROSS_PREPARED_LIFECYCLE_ROW_UNAVAILABLE');
  }
}

/** Origin receipt success hands authority back to the existing durable settlement lifecycle. */
export async function markPreparedAcrossOriginSubmitted(input: {
  depositTxnRef: string;
  originNativeFeeWei: string;
  broadcastAt: number;
}): Promise<void> {
  if (!validHash(input.depositTxnRef) || !/^\d+$/.test(input.originNativeFeeWei)) {
    throw new Error('ACROSS_PREPARED_SUBMISSION_EVIDENCE_INVALID');
  }
  const result = await pool.query(
    `UPDATE ${TABLE}
     SET status='SUBMITTED',origin_native_fee_wei=$2::numeric,origin_fee_complete=true,
         broadcast_at=COALESCE(broadcast_at,to_timestamp($3/1000.0)),signed_origin_tx=NULL,last_error=NULL,updated_at=now()
     WHERE deposit_txn_ref=$1 AND status IN ('PREPARED','SUBMITTED')
     RETURNING lifecycle_id`,
    [input.depositTxnRef.toLowerCase(), input.originNativeFeeWei, input.broadcastAt],
  );
  if (result.rowCount !== 1) throw new Error('ACROSS_PREPARED_SUBMISSION_TRANSITION_FAILED');
}

async function claimPrepared(limit: number): Promise<PreparedRow[]> {
  const now = Date.now();
  const leaseMs = bounded(process.env.CRYPTOCRAWL_CROSS_CHAIN_RECONCILE_LEASE_MS, 45_000, 10_000, 5 * 60_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT lifecycle_id FROM ${TABLE}
       WHERE (status='PREPARED' OR (status='SUBMITTED' AND origin_fee_complete=false))
         AND (reconcile_lease_expires_at IS NULL OR reconcile_lease_expires_at <= now())
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE ${TABLE} lifecycle
     SET reconcile_lease_owner=$2,reconcile_lease_expires_at=to_timestamp($3/1000.0),updated_at=now()
     FROM candidates
     WHERE lifecycle.lifecycle_id=candidates.lifecycle_id
     RETURNING lifecycle.lifecycle_id::text,lifecycle.opportunity_id,lifecycle.reservation_id::text,
               lifecycle.deposit_txn_ref,lifecycle.signed_origin_tx,lifecycle.origin_fee_complete,lifecycle.quote,
               lifecycle.expected_profit_usd,lifecycle.notional_usd,lifecycle.origin_native_fee_wei::text,
               lifecycle.submitted_at,lifecycle.broadcast_at`,
    [bounded(limit, 4, 1, 32), workerId, now + leaseMs],
  );
  return result.rows.flatMap(row => {
    const quote = asQuote(row.quote);
    if (!quote) return [];
    return [{
      lifecycleId: String(row.lifecycle_id),
      opportunityId: String(row.opportunity_id),
      reservationId: String(row.reservation_id),
      depositTxnRef: String(row.deposit_txn_ref),
      signedOriginTx: row.signed_origin_tx ? String(row.signed_origin_tx) : null,
      originFeeComplete: row.origin_fee_complete === true,
      quote,
      expectedProfitUsd: Number(row.expected_profit_usd),
      notionalUsd: Number(row.notional_usd),
      originNativeFeeWei: String(row.origin_native_fee_wei || '0'),
      preparedAt: new Date(row.submitted_at).getTime(),
      broadcastAt: row.broadcast_at ? new Date(row.broadcast_at).getTime() : null,
    }];
  });
}

async function releaseLease(lifecycleId: string, error?: string): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE}
     SET reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,last_error=COALESCE($3,last_error),updated_at=now()
     WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$2`,
    [lifecycleId, workerId, error || null],
  );
}

async function finalizeOriginFailure(row: PreparedRow, feeWei: string, error: string): Promise<CrossChainLifecycleResult> {
  const gasUsd = await actualGasUsd(row.quote, feeWei);
  await pool.query('BEGIN');
  try {
    await pool.query(`DELETE FROM ${RESERVATION_TABLE} WHERE reservation_id=$1::uuid`, [row.reservationId]);
    await pool.query(
      `UPDATE ${TABLE}
       SET status='FAILED',origin_native_fee_wei=$2::numeric,origin_fee_complete=true,signed_origin_tx=NULL,
           realized_net_profit_usd=$3,gas_usd=$4,last_error=$5,last_checked_at=now(),terminal_at=COALESCE(terminal_at,now()),
           reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,updated_at=now()
       WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$6`,
      [row.lifecycleId, feeWei, gasUsd === null ? null : -gasUsd, gasUsd, error, workerId],
    );
    await pool.query('COMMIT');
  } catch (failure) {
    await pool.query('ROLLBACK').catch(() => undefined);
    throw failure;
  }
  return originFailedResult(row, feeWei, gasUsd, error);
}

async function reconcilePrepared(row: PreparedRow): Promise<CrossChainLifecycleResult> {
  if (!await extendReservation(row.reservationId)) {
    await releaseLease(row.lifecycleId, 'CROSS_CHAIN_DURABLE_RESERVATION_MISSING');
    return pending(row, 'CROSS_CHAIN_DURABLE_RESERVATION_MISSING');
  }

  // A row inserted by the pre-broadcast callback but never armed cannot have
  // been broadcast by the new executor. After a short grace, exact state-machine
  // ordering therefore proves principal never left and only approval gas may exist.
  if (!row.signedOriginTx) {
    const graceMs = bounded(process.env.CRYPTOCRAWL_ACROSS_PREBROADCAST_GRACE_MS, 30_000, 5_000, 5 * 60_000);
    if (Date.now() - row.preparedAt < graceMs) {
      await releaseLease(row.lifecycleId, 'ACROSS_PREBROADCAST_ARMING_PENDING');
      return pending(row, 'ACROSS_PREBROADCAST_ARMING_PENDING');
    }
    return finalizeOriginFailure(row, row.originNativeFeeWei, 'ACROSS_PREBROADCAST_NOT_BROADCAST');
  }

  const raw = row.signedOriginTx;
  if (!validSignedTransaction(raw) || ethers.utils.keccak256(raw).toLowerCase() !== row.depositTxnRef.toLowerCase()) {
    await releaseLease(row.lifecycleId, 'ACROSS_PREPARED_SIGNED_TX_CORRUPT');
    return pending(row, 'ACROSS_PREPARED_SIGNED_TX_CORRUPT');
  }
  const parsed = ethers.utils.parseTransaction(raw);
  const expectedChainId = SUPPORTED_CHAINS[row.quote.originChain].chainId;
  if (parsed.chainId !== expectedChainId) {
    await releaseLease(row.lifecycleId, 'ACROSS_PREPARED_SIGNED_TX_CHAIN_MISMATCH');
    return pending(row, 'ACROSS_PREPARED_SIGNED_TX_CHAIN_MISMATCH');
  }

  await multiProviderRpcManager.initialize([row.quote.originChain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(row.quote.originChain, 'json_rpc');
  let receipt = await provider.getTransactionReceipt(row.depositTxnRef).catch(() => null);
  let observed = receipt ? true : Boolean(await provider.getTransaction(row.depositTxnRef).catch(() => null));
  if (!receipt && !observed) {
    try {
      const rebroadcast = await provider.sendTransaction(raw);
      if (rebroadcast.hash.toLowerCase() !== row.depositTxnRef.toLowerCase()) throw new Error('ACROSS_REBROADCAST_HASH_MISMATCH');
      observed = true;
    } catch (error) {
      receipt = await provider.getTransactionReceipt(row.depositTxnRef).catch(() => null);
      observed = receipt ? true : Boolean(await provider.getTransaction(row.depositTxnRef).catch(() => null));
      if (!observed) {
        const message = `ACROSS_EXACT_REBROADCAST_PENDING:${error instanceof Error ? error.message : String(error)}`;
        await releaseLease(row.lifecycleId, message);
        return pending(row, message);
      }
    }
  }

  if (!receipt) receipt = await provider.getTransactionReceipt(row.depositTxnRef).catch(() => null);
  if (!receipt) {
    await pool.query(
      `UPDATE ${TABLE}
       SET broadcast_at=COALESCE(broadcast_at,now()),last_checked_at=now(),reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,updated_at=now()
       WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$2`,
      [row.lifecycleId, workerId],
    );
    return pending({ ...row, broadcastAt: row.broadcastAt ?? Date.now() }, 'ACROSS_ORIGIN_RECEIPT_PENDING');
  }

  const totalFeeWei = row.originFeeComplete
    ? BigNumber.from(row.originNativeFeeWei)
    : BigNumber.from(row.originNativeFeeWei).add(receiptFeeWei(receipt));
  const feeWei = totalFeeWei.toString();
  if (receipt.status !== 1) return finalizeOriginFailure(row, feeWei, 'ACROSS_ORIGIN_DEPOSIT_REVERTED');

  await pool.query(
    `UPDATE ${TABLE}
     SET status='SUBMITTED',origin_native_fee_wei=$2::numeric,origin_fee_complete=true,
         broadcast_at=COALESCE(broadcast_at,now()),signed_origin_tx=NULL,last_error=NULL,last_checked_at=now(),
         reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,updated_at=now()
     WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$3`,
    [row.lifecycleId, feeWei, workerId],
  );
  return {
    ...pending({ ...row, originNativeFeeWei: feeWei, broadcastAt: row.broadcastAt ?? Date.now() }, 'ACROSS_ORIGIN_SUBMISSION_RECOVERED'),
    status: 'SUBMITTED',
    error: 'ACROSS_ORIGIN_SUBMISSION_RECOVERED',
  };
}

export async function advancePreparedAcrossOriginTransactions(limit = 4): Promise<CrossChainLifecycleResult[]> {
  const rows = await claimPrepared(limit);
  const results: CrossChainLifecycleResult[] = [];
  for (const row of rows) {
    try {
      results.push(await reconcilePrepared(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await releaseLease(row.lifecycleId, message).catch(() => undefined);
      results.push(pending(row, message));
      logger.error('[AcrossPrebroadcast] Recovery failed closed; exact signed transaction and reservation remain authoritative', {
        component: 'AcrossPrebroadcastDurability', lifecycleId: row.lifecycleId, opportunityId: row.opportunityId,
        depositTxnRef: row.depositTxnRef, capitalReleased: false, duplicateSubmissionAllowed: false, error: message,
      });
    }
  }
  return results;
}

export async function claimPendingAcrossOriginFailureFeedback(limit = 8): Promise<CrossChainLifecycleResult[]> {
  const now = Date.now();
  const leaseMs = bounded(process.env.CRYPTOCRAWL_CROSS_CHAIN_FEEDBACK_LEASE_MS, 45_000, 10_000, 5 * 60_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT lifecycle_id FROM ${TABLE}
       WHERE status='FAILED' AND feedback_applied_at IS NULL
         AND (reconcile_lease_expires_at IS NULL OR reconcile_lease_expires_at <= now())
       ORDER BY terminal_at ASC NULLS LAST,updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE ${TABLE} lifecycle
     SET reconcile_lease_owner=$2,reconcile_lease_expires_at=to_timestamp($3/1000.0),updated_at=now()
     FROM candidates
     WHERE lifecycle.lifecycle_id=candidates.lifecycle_id
     RETURNING lifecycle.*`,
    [bounded(limit, 8, 1, 32), workerId, now + leaseMs],
  );

  const feedback: CrossChainLifecycleResult[] = [];
  for (const row of result.rows) {
    const quote = asQuote(row.quote);
    if (!quote) {
      await releaseLease(String(row.lifecycle_id), 'CROSS_CHAIN_FAILED_FEEDBACK_QUOTE_INVALID');
      continue;
    }
    let gasUsd = row.gas_usd === null ? null : Number(row.gas_usd);
    if (gasUsd === null || !Number.isFinite(gasUsd)) {
      gasUsd = await actualGasUsd(quote, String(row.origin_native_fee_wei || '0'));
      if (gasUsd === null) {
        await releaseLease(String(row.lifecycle_id), 'CROSS_CHAIN_FAILED_GAS_USD_PENDING');
        continue;
      }
      await pool.query(
        `UPDATE ${TABLE} SET gas_usd=$2,realized_net_profit_usd=$3,updated_at=now() WHERE lifecycle_id=$1::uuid`,
        [String(row.lifecycle_id), gasUsd, -gasUsd],
      );
    }
    feedback.push({
      lifecycleId: String(row.lifecycle_id), opportunityId: String(row.opportunity_id), reservationId: String(row.reservation_id),
      depositTxnRef: String(row.deposit_txn_ref), status: 'FAILED', terminal: true, settlementConfirmed: true, success: false,
      quote, expectedProfitUsd: Number(row.expected_profit_usd), notionalUsd: Number(row.notional_usd),
      submittedAt: row.broadcast_at ? new Date(row.broadcast_at).getTime() : new Date(row.submitted_at).getTime(),
      settledAt: row.terminal_at ? new Date(row.terminal_at).getTime() : Date.now(), originNativeFeeWei: String(row.origin_native_fee_wei || '0'),
      settlement: null, terminalAmountEvidence: null, realizedNetProfitUsd: -gasUsd, gasUsd, assetUsd: null,
      error: row.last_error ? String(row.last_error) : 'ACROSS_ORIGIN_DEPOSIT_FAILED',
    });
  }
  return feedback;
}

export async function markAcrossOriginFailureFeedbackApplied(lifecycleId: string): Promise<void> {
  await pool.query(
    `UPDATE ${TABLE}
     SET feedback_applied_at=COALESCE(feedback_applied_at,now()),reconcile_lease_owner=NULL,reconcile_lease_expires_at=NULL,updated_at=now()
     WHERE lifecycle_id=$1::uuid AND reconcile_lease_owner=$2`,
    [lifecycleId, workerId],
  );
}

export async function releaseAcrossOriginFailureFeedbackLease(lifecycleId: string, error: unknown): Promise<void> {
  await releaseLease(lifecycleId, error instanceof Error ? error.message : String(error));
}
