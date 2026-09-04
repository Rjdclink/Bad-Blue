import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { AcrossBridgeQuote } from '../bridge/across-bridge-provider.js';
import { getPreparedCrossChainRoute } from '../discovery/cross-chain-opportunity-generator.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { executeAcrossBridgeQuote, type AcrossBridgeExecutionResult } from './across-bridge-executor.js';
import {
  advancePreparedAcrossOriginTransactions,
  claimPendingAcrossOriginFailureFeedback,
  markAcrossOriginFailureFeedbackApplied,
  releaseAcrossOriginFailureFeedbackLease,
} from './across-prebroadcast-durability.js';
import {
  advanceOpenCrossChainLifecycles,
  claimPendingCrossChainTerminalFeedback,
  ensureCrossChainLifecycleStoreReady,
  markCrossChainTerminalFeedbackApplied,
  persistSubmittedAcrossLifecycle,
  releaseCrossChainTerminalFeedbackLease,
  type CrossChainLifecycleResult,
  type CrossChainSubmissionRecord,
} from './cross-chain-durable-lifecycle.js';
import {
  fundingPositionLifecycle,
  type FundingExecutionPlan,
  type FundingLifecycleResult,
  type FundingTerminalSettlement,
} from './funding-position-lifecycle.js';
import { getPreparedOkxFundingPlan } from './okx-funding-lifecycle-adapter.js';
import {
  reserveOnchainSystemCapital,
  type OnchainSystemCapitalReservation,
} from './onchain-system-capital-ledger.js';
import type { UnifiedExecutionDecision } from './unified-execution-router.js';

export interface FundingCrossChainDispatchResult {
  opportunityId: string;
  topology: 'CROSS_CHAIN' | 'FUNDING_ARBITRAGE';
  path: 'BRIDGE_FLASH_LOAN' | 'SPOT_PERP_FUNDING';
  dispatched: boolean;
  submitted: boolean;
  success: boolean;
  settlementConfirmed: boolean;
  transactionHash?: string;
  lifecycleId?: string;
  submissionReference?: string;
  realizedNetProfitUsd?: number | null;
  error?: string;
}

type FundingLifecycleContext = {
  plan: FundingExecutionPlan;
  openedAt: number | null;
};

const fundingFeedbackWorkerId = `funding-feedback:${randomUUID()}`;
const CROSS_CHAIN_LIFECYCLE_TABLE = 'public.cryptocrawler_cross_chain_lifecycles';
const ONCHAIN_RESERVATION_TABLE = 'public.cryptocrawler_onchain_inventory_reservations';

function liveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function parseJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return null; }
}

function validTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

/**
 * A route can consume receipt-backed approval gas and still fail before principal
 * broadcast. Persist that terminal cost into the existing durable cross-chain
 * failure stream instead of dropping it. The last approval receipt hash is the
 * stable terminal identity; the reserved principal is deleted atomically with the
 * FAILED lifecycle insert because principal is proven never to have moved.
 */
async function persistAcrossPrebroadcastTerminalCost(input: {
  candidate: MeasuredCandidate;
  quote: AcrossBridgeQuote;
  reservationId: string;
  execution: AcrossBridgeExecutionResult;
  submittedAt: number;
}): Promise<CrossChainSubmissionRecord | null> {
  const { execution } = input;
  if (execution.depositTxnRef || execution.prebroadcastTerminalCostComplete !== true) return null;
  const feeWei = String(execution.originNativeFeeWei || '0');
  if (!/^\d+$/.test(feeWei) || BigInt(feeWei) <= 0n) return null;
  const approvalTxnRefs = [...new Set((execution.approvalTxnRefs || []).map(value => value.trim().toLowerCase()).filter(validTxHash))];
  const costReference = approvalTxnRefs.length > 0 ? approvalTxnRefs[approvalTxnRefs.length - 1] : undefined;
  if (!costReference) throw new Error('ACROSS_PREBROADCAST_COST_MISSING_RECEIPT_IDENTITY');
  const expectedProfitUsd = Number(input.candidate.economics.deterministicNetProfitUsd);
  const notionalUsd = Number(input.candidate.economics.notionalUsd);
  if (!Number.isFinite(expectedProfitUsd) || !Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    throw new Error('ACROSS_PREBROADCAST_COST_ECONOMICS_INVALID');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = await client.query(
      `SELECT lifecycle_id::text,opportunity_id,reservation_id::text,submitted_at
       FROM ${CROSS_CHAIN_LIFECYCLE_TABLE}
       WHERE deposit_txn_ref=$1
       FOR UPDATE`,
      [costReference],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0];
      if (String(row.opportunity_id) !== input.candidate.opportunityId || String(row.reservation_id) !== input.reservationId) {
        throw new Error('ACROSS_PREBROADCAST_COST_IDEMPOTENCY_COLLISION');
      }
      await client.query(`DELETE FROM ${ONCHAIN_RESERVATION_TABLE} WHERE reservation_id=$1::uuid`, [input.reservationId]);
      await client.query('COMMIT');
      return {
        lifecycleId: String(row.lifecycle_id),
        opportunityId: input.candidate.opportunityId,
        reservationId: input.reservationId,
        depositTxnRef: costReference,
        submittedAt: new Date(row.submitted_at).getTime(),
      };
    }

    const lifecycleId = randomUUID();
    const terminalEvidence = {
      authority: 'receipt_backed_across_prebroadcast_cost',
      principalBroadcast: false,
      terminalCostComplete: true,
      approvalTxnRefs,
      terminalCostReference: costReference,
      originNativeFeeWei: feeWei,
      error: execution.error || 'ACROSS_PREBROADCAST_TERMINAL_COST',
      syntheticEvidenceAllowed: false,
    };
    await client.query(
      `INSERT INTO ${CROSS_CHAIN_LIFECYCLE_TABLE} (
         lifecycle_id,opportunity_id,reservation_id,provider,deposit_txn_ref,signed_origin_tx,origin_fee_complete,broadcast_at,
         origin_chain,destination_chain,asset,input_token_address,output_token_address,input_decimals,output_decimals,
         input_amount_base_units,expected_profit_usd,notional_usd,quote,origin_native_fee_wei,status,settlement_evidence,
         last_error,submitted_at,last_checked_at,terminal_at,updated_at
       ) VALUES (
         $1,$2,$3::uuid,'across',$4,NULL,true,NULL,$5,$6,$7,$8,$9,$10,$11,$12::numeric,$13,$14,$15::jsonb,$16::numeric,
         'FAILED',$17::jsonb,$18,to_timestamp($19/1000.0),now(),now(),now()
       )`,
      [
        lifecycleId,
        input.candidate.opportunityId,
        input.reservationId,
        costReference,
        input.quote.originChain,
        input.quote.destinationChain,
        input.quote.token,
        input.quote.inputToken.toLowerCase(),
        input.quote.outputToken.toLowerCase(),
        input.quote.inputTokenDecimals,
        input.quote.outputTokenDecimals,
        input.quote.inputAmount,
        expectedProfitUsd,
        notionalUsd,
        JSON.stringify(input.quote),
        feeWei,
        JSON.stringify(terminalEvidence),
        `ACROSS_PREBROADCAST_COST_ONLY:${execution.error || 'terminal_prebroadcast_failure'}`,
        input.submittedAt,
      ],
    );
    await client.query(`DELETE FROM ${ONCHAIN_RESERVATION_TABLE} WHERE reservation_id=$1::uuid`, [input.reservationId]);
    await client.query('COMMIT');
    return {
      lifecycleId,
      opportunityId: input.candidate.opportunityId,
      reservationId: input.reservationId,
      depositTxnRef: costReference,
      submittedAt: input.submittedAt,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

async function fundingContext(lifecycleId: string): Promise<FundingLifecycleContext | null> {
  const result = await pool.query(
    `SELECT plan, open_receipt FROM private.cryptocrawler_funding_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  ).catch(() => null);
  const row = result?.rows?.[0];
  if (!row?.plan) return null;
  const plan = typeof row.plan === 'string' ? JSON.parse(row.plan) as FundingExecutionPlan : row.plan as FundingExecutionPlan;
  const receipt = typeof row.open_receipt === 'string' ? JSON.parse(row.open_receipt) : row.open_receipt;
  return { plan, openedAt: Number.isFinite(Number(receipt?.openedAt)) ? Number(receipt.openedAt) : null };
}

async function markOperatorTerminalByOpportunity(opportunityId: string): Promise<void> {
  const result = await pool.query(
    `SELECT reservation_id::text
     FROM public.cryptocrawler_operator_trade_reservations
     WHERE opportunity_id=$1 AND status='SUBMITTED'
     ORDER BY submitted_at ASC NULLS LAST`,
    [opportunityId],
  );
  for (const row of result.rows) {
    await operatorTradingStrategy.markTerminal(String(row.reservation_id));
  }
}

async function recordFundingTerminal(result: FundingLifecycleResult): Promise<void> {
  if (!result.lifecycleId || !result.settlementConfirmed || !result.settlement?.terminal) return;
  const context = await fundingContext(result.lifecycleId);
  if (!context) throw new Error(`Funding lifecycle context ${result.lifecycleId} is unavailable for terminal feedback`);
  const settlement = result.settlement;
  const realized = settlement.realizedNetProfitUsd;
  const settledAt = settlement.settledAt ?? Date.now();
  const latencyMs = context.openedAt !== null ? Math.max(0, settledAt - context.openedAt) : 0;
  await recordCryptaraExecutionEvidence({
    source: 'master_pipeline',
    opportunityId: context.plan.opportunityId,
    chain: 'cex:okx',
    symbol: context.plan.symbol,
    strategy: 'okx_spot_perp_funding',
    success: realized !== null && Number.isFinite(realized) && realized > 0,
    expectedProfitUsd: context.plan.expectedNetProfitUsd,
    realizedProfitUsd: realized,
    feeUsd: settlement.realizedFeesUsd,
    slippageBps: null,
    latencyMs,
    usedZeroCapital: false,
    timestamp: settledAt,
    notes: realized === null ? 'Funding lifecycle terminal economics incomplete' : undefined,
    settlementStatus: settlement.settlementConfirmed ? 'filled' : 'settlement_unknown',
    settlementConfirmed: settlement.settlementConfirmed,
    provenance: [
      ...context.plan.provenance,
      ...settlement.provenance,
      'funding_projected_entry_vs_realized_terminal_separated',
      'system_owned_capital_provenance_required',
    ],
    settlement: {
      status: settlement.settlementConfirmed ? 'filled' : 'settlement_unknown',
      terminal: settlement.terminal,
      settlementConfirmed: settlement.settlementConfirmed,
      submittedAt: context.openedAt ?? settledAt,
      settledAt,
      venueOrRoute: 'okx_spot_perp_funding',
      chain: 'cex:okx',
      predicted: { profitUsd: context.plan.expectedNetProfitUsd, feeUsd: context.plan.expectedEntryCostUsd + context.plan.expectedExitCostUsd, slippageBps: null },
      realized: {
        acquisitionCostUsd: null,
        proceedsUsd: null,
        exchangeFeeUsd: settlement.realizedFeesUsd,
        gasUsd: 0,
        gasUsed: null,
        effectiveGasPriceWei: null,
        slippageBps: null,
        netProfitUsd: realized,
      },
      provenance: [...settlement.provenance, 'funding_terminal_bill_and_close_authority'],
      error: settlement.error,
    },
  });
}

async function claimFundingTerminalFeedback(limit: number): Promise<FundingLifecycleResult[]> {
  const leaseMs = bounded(process.env.CRYPTOCRAWL_FUNDING_FEEDBACK_LEASE_MS, 45_000, 10_000, 5 * 60_000);
  const result = await pool.query(
    `WITH candidates AS (
       SELECT lifecycle_id
       FROM private.cryptocrawler_funding_lifecycles
       WHERE status='closed'
         AND feedback_applied_at IS NULL
         AND (feedback_lease_expires_at IS NULL OR feedback_lease_expires_at <= now())
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE private.cryptocrawler_funding_lifecycles lifecycle
     SET feedback_lease_owner=$2,feedback_lease_expires_at=to_timestamp($3/1000.0),updated_at=now()
     FROM candidates
     WHERE lifecycle.lifecycle_id=candidates.lifecycle_id
     RETURNING lifecycle.lifecycle_id,lifecycle.terminal_settlement`,
    [bounded(limit, 8, 1, 32), fundingFeedbackWorkerId, Date.now() + leaseMs],
  );
  return result.rows.flatMap(row => {
    const settlement = parseJson<FundingTerminalSettlement>(row.terminal_settlement);
    if (!settlement?.terminal || !settlement.settlementConfirmed) return [];
    return [{
      success: (settlement.realizedNetProfitUsd ?? Number.NEGATIVE_INFINITY) > 0,
      settlementConfirmed: true,
      status: 'closed' as const,
      lifecycleId: String(row.lifecycle_id),
      settlement,
    }];
  });
}

async function markFundingFeedbackApplied(lifecycleId: string): Promise<void> {
  await pool.query(
    `UPDATE private.cryptocrawler_funding_lifecycles
     SET feedback_applied_at=COALESCE(feedback_applied_at,now()),feedback_lease_owner=NULL,feedback_lease_expires_at=NULL,updated_at=now()
     WHERE lifecycle_id=$1 AND feedback_lease_owner=$2`,
    [lifecycleId, fundingFeedbackWorkerId],
  );
}

async function releaseFundingFeedbackLease(lifecycleId: string, error: unknown): Promise<void> {
  await pool.query(
    `UPDATE private.cryptocrawler_funding_lifecycles
     SET feedback_lease_owner=NULL,feedback_lease_expires_at=NULL,last_error=COALESCE($3,last_error),updated_at=now()
     WHERE lifecycle_id=$1 AND feedback_lease_owner=$2`,
    [lifecycleId, fundingFeedbackWorkerId, error instanceof Error ? error.message : String(error)],
  );
}

function crossChainTerminalStatus(result: CrossChainLifecycleResult): 'filled' | 'refunded' | 'failed' {
  if (result.status === 'FILLED') return 'filled';
  if (result.status === 'REFUNDED') return 'refunded';
  return 'failed';
}

async function recordCrossChainTerminal(result: CrossChainLifecycleResult): Promise<void> {
  if (!result.terminal || !result.settlementConfirmed) return;
  const realized = result.realizedNetProfitUsd;
  if (realized === null || !Number.isFinite(realized)) throw new Error('CROSS_CHAIN_TERMINAL_REALIZED_ECONOMICS_INCOMPLETE');
  const settledAt = result.settledAt ?? Date.now();
  const terminal = result.terminalAmountEvidence;
  const inputHuman = terminal ? Number(ethers.utils.formatUnits(terminal.inputAmount, result.quote.inputTokenDecimals)) : null;
  const outputHuman = terminal ? Number(ethers.utils.formatUnits(terminal.outputAmount, result.quote.outputTokenDecimals)) : null;
  const acquisitionCostUsd = inputHuman !== null && result.assetUsd !== null && Number.isFinite(inputHuman) ? inputHuman * result.assetUsd : null;
  const proceedsUsd = outputHuman !== null && result.assetUsd !== null && Number.isFinite(outputHuman) ? outputHuman * result.assetUsd : null;
  const candidate = measuredCandidateRegistry.get(result.opportunityId);
  const prebroadcastCostOnly = result.status === 'FAILED' && String(result.error || '').startsWith('ACROSS_PREBROADCAST_COST_ONLY:');
  if (candidate) {
    const realizedBps = result.notionalUsd > 0 ? realized / result.notionalUsd * 10_000 : null;
    measuredCandidateRegistry.updateStatus(result.opportunityId, realized > 0 ? candidate.status : 'blocked', {
      economics: { ...candidate.economics, realizedNetProfitBps: realizedBps },
      executionCapabilityReason: realized > 0
        ? candidate.executionCapabilityReason
        : result.status === 'REFUNDED'
          ? 'Across route returned exact principal; actual origin gas produced a realized loss'
          : prebroadcastCostOnly
            ? 'Across principal was never broadcast; receipt-backed approval gas produced a realized loss'
            : result.status === 'FAILED'
              ? 'Across origin transaction never transferred principal or reverted; actual origin/approval gas produced a realized loss'
              : 'Terminal Across same-asset result was not profitable after actual origin gas',
      provenance: [...candidate.provenance, 'cross_chain:durable_terminal_reconciliation', 'cross_chain:system_capital_settlement_authority'],
    });
  }
  const terminalStatus = crossChainTerminalStatus(result);
  const terminalProvenance = result.status === 'FILLED'
    ? 'system_owned_origin_consumed_destination_lot_created'
    : result.status === 'REFUNDED'
      ? 'exact_refund_principal_verified'
      : prebroadcastCostOnly
        ? 'receipt_backed_approval_cost_principal_never_broadcast'
        : 'origin_principal_never_moved_or_reverted_exact_hash';
  await recordCryptaraExecutionEvidence({
    source: 'master_pipeline',
    opportunityId: result.opportunityId,
    chain: `${result.quote.originChain}->${result.quote.destinationChain}`,
    symbol: result.quote.token,
    strategy: 'across_same_asset_cross_chain',
    success: result.success,
    expectedProfitUsd: result.expectedProfitUsd,
    realizedProfitUsd: realized,
    feeUsd: result.gasUsd,
    slippageBps: null,
    latencyMs: Math.max(0, settledAt - result.submittedAt),
    usedZeroCapital: false,
    timestamp: settledAt,
    notes: result.error,
    settlementStatus: terminalStatus,
    settlementConfirmed: true,
    provenance: [
      ...(candidate?.provenance ?? []),
      ...(terminal?.provenance ?? []),
      'cross_chain:restart_safe_terminal_feedback',
      'cross_chain:actual_origin_gas',
      prebroadcastCostOnly ? 'cross_chain:receipt_backed_prebroadcast_cost_only' : result.status === 'FAILED' ? 'cross_chain:prebroadcast_or_origin_revert_terminal_truth' : 'cross_chain:bridge_terminal_truth',
      'synthetic_evidence:false',
    ],
    settlement: {
      status: terminalStatus,
      terminal: true,
      settlementConfirmed: true,
      submittedAt: result.submittedAt,
      settledAt,
      venueOrRoute: `across:${result.quote.originChain}->${result.quote.destinationChain}:${result.quote.token}`,
      chain: result.quote.destinationChain,
      predicted: { profitUsd: result.expectedProfitUsd, feeUsd: null, slippageBps: null },
      realized: {
        acquisitionCostUsd,
        proceedsUsd,
        exchangeFeeUsd: null,
        gasUsd: result.gasUsd,
        gasUsed: null,
        effectiveGasPriceWei: null,
        slippageBps: null,
        netProfitUsd: realized,
      },
      provenance: [...(terminal?.provenance ?? []), terminalProvenance],
      transactionHash: result.depositTxnRef,
      error: result.error,
    },
  });
}

async function dispatchCrossChain(decision: UnifiedExecutionDecision): Promise<FundingCrossChainDispatchResult> {
  const candidate = measuredCandidateRegistry.get(decision.opportunityId);
  const prepared = getPreparedCrossChainRoute(decision.opportunityId);
  if (!candidate || !prepared || !decision.admitted || candidate.status !== 'eligible' || !candidate.executableCapability) {
    return { opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'CROSS_CHAIN_PREPARED_ROUTE_UNAVAILABLE' };
  }
  if (!await ensureCrossChainLifecycleStoreReady()) {
    return { opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'CROSS_CHAIN_LIFECYCLE_STORE_UNAVAILABLE' };
  }

  const quote = prepared.quote;
  const reservationExpiry = Date.now() + Math.max(6 * 60 * 60_000, Math.min(7 * 24 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_RESERVATION_HOLD_MS || 6 * 60 * 60_000)));
  const reservation: OnchainSystemCapitalReservation | null = await reserveOnchainSystemCapital({
    opportunityId: candidate.opportunityId,
    chain: quote.originChain,
    asset: quote.token,
    tokenAddress: quote.inputToken,
    amountBaseUnits: quote.inputAmount,
    expiresAt: reservationExpiry,
  });
  if (!reservation) {
    return { opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'CROSS_CHAIN_SYSTEM_OWNED_CAPITAL_UNAVAILABLE' };
  }

  let durableSubmission: CrossChainSubmissionRecord | null = null;
  const persist = async (input: { depositTxnRef: string; originNativeFeeWei: string; submittedAt: number }) => {
    durableSubmission = await persistSubmittedAcrossLifecycle({
      opportunityId: candidate.opportunityId,
      reservationId: reservation.reservationId,
      quote,
      depositTxnRef: input.depositTxnRef,
      originNativeFeeWei: input.originNativeFeeWei,
      expectedProfitUsd: Number(candidate.economics.deterministicNetProfitUsd),
      notionalUsd: Number(candidate.economics.notionalUsd),
      submittedAt: input.submittedAt,
    });
  };

  try {
    const executionStartedAt = Date.now();
    const execution = await executeAcrossBridgeQuote(quote, { onSubmitted: persist, returnAfterSubmission: true });
    const depositTxnRef = execution.depositTxnRef;
    if (depositTxnRef) {
      return {
        opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN',
        dispatched: true, submitted: true, success: false,
        settlementConfirmed: false,
        transactionHash: depositTxnRef, lifecycleId: durableSubmission?.lifecycleId,
        submissionReference: durableSubmission?.lifecycleId ?? depositTxnRef, realizedNetProfitUsd: null,
        error: execution.error,
      };
    }

    let terminalCost: CrossChainSubmissionRecord | null = null;
    if (execution.prebroadcastTerminalCostComplete === true) {
      terminalCost = await persistAcrossPrebroadcastTerminalCost({
        candidate,
        quote,
        reservationId: reservation.reservationId,
        execution,
        submittedAt: executionStartedAt,
      });
    }
    if (!terminalCost) await reservation.release().catch(() => undefined);
    return {
      opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN',
      dispatched: false, submitted: false, success: false,
      settlementConfirmed: terminalCost ? true : execution.settlementConfirmed,
      lifecycleId: terminalCost?.lifecycleId,
      submissionReference: terminalCost?.lifecycleId,
      realizedNetProfitUsd: null,
      error: execution.error || 'CROSS_CHAIN_SUBMISSION_FAILED',
    };
  } catch (error) {
    if (durableSubmission) {
      logger.error('[FundingCrossChainAdapter] Durable cross-chain lifecycle exists but executor raised unexpectedly; capital remains reserved', {
        component: 'FundingCrossChainExecutionAdapter', opportunityId: candidate.opportunityId,
        lifecycleId: durableSubmission.lifecycleId, reservationId: reservation.reservationId,
        capitalReleaseAllowed: false, parentSubmissionAmbiguous: true,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN',
        dispatched: true, submitted: true, success: false, settlementConfirmed: false,
        lifecycleId: durableSubmission.lifecycleId, submissionReference: durableSubmission.lifecycleId,
        realizedNetProfitUsd: null, error: 'CROSS_CHAIN_DURABLE_SUBMISSION_RECOVERY_REQUIRED',
      };
    }
    await reservation.release().catch(() => undefined);
    return {
      opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN',
      dispatched: false, submitted: false, success: false, settlementConfirmed: false,
      realizedNetProfitUsd: null,
      error: `CROSS_CHAIN_PREBROADCAST_FAILURE:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function dispatchFunding(decision: UnifiedExecutionDecision): Promise<FundingCrossChainDispatchResult> {
  const candidate = measuredCandidateRegistry.get(decision.opportunityId);
  const plan = getPreparedOkxFundingPlan(decision.opportunityId);
  if (!candidate || !plan || !decision.admitted || candidate.status !== 'eligible' || !candidate.executableCapability) {
    return { opportunityId: decision.opportunityId, topology: 'FUNDING_ARBITRAGE', path: 'SPOT_PERP_FUNDING', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'FUNDING_PREPARED_PLAN_UNAVAILABLE' };
  }
  const result = await fundingPositionLifecycle.execute(plan);
  const submitted = (result.status === 'opened' || result.status === 'opening') && Boolean(result.lifecycleId);
  return {
    opportunityId: decision.opportunityId, topology: 'FUNDING_ARBITRAGE', path: 'SPOT_PERP_FUNDING',
    dispatched: submitted, submitted, success: result.status === 'opened' && result.success, settlementConfirmed: result.settlementConfirmed,
    lifecycleId: result.lifecycleId, submissionReference: result.lifecycleId,
    realizedNetProfitUsd: result.settlement?.realizedNetProfitUsd, error: result.error,
  };
}

class FundingCrossChainExecutionAdapter {
  private readonly inFlight = new Set<string>();

  async advanceOpenFundingLifecycles(limit = 4): Promise<FundingLifecycleResult[]> {
    const results = await fundingPositionLifecycle.advanceOpenLifecycles(limit);
    for (const result of results) {
      if (!result.lifecycleId || !result.settlementConfirmed || !result.settlement?.terminal) continue;
      const context = await fundingContext(result.lifecycleId);
      if (context) await markOperatorTerminalByOpportunity(context.plan.opportunityId).catch(() => undefined);
    }

    const feedback = await claimFundingTerminalFeedback(Math.max(limit, 8)).catch(error => {
      logger.error('[FundingCrossChainAdapter] Funding terminal feedback claim failed; durable settlement remains authoritative', {
        component: 'FundingCrossChainExecutionAdapter',
        error: error instanceof Error ? error.message : String(error),
        settlementAuthorityChanged: false,
      });
      return [] as FundingLifecycleResult[];
    });
    for (const result of feedback) {
      if (!result.lifecycleId) continue;
      try {
        const context = await fundingContext(result.lifecycleId);
        if (context) await markOperatorTerminalByOpportunity(context.plan.opportunityId);
        await recordFundingTerminal(result);
        await markFundingFeedbackApplied(result.lifecycleId);
      } catch (error) {
        await releaseFundingFeedbackLease(result.lifecycleId, error).catch(() => undefined);
        logger.error('[FundingCrossChainAdapter] Funding terminal feedback failed; durable feedback remains pending', {
          component: 'FundingCrossChainExecutionAdapter', lifecycleId: result.lifecycleId,
          error: error instanceof Error ? error.message : String(error), settlementAuthorityChanged: false, feedbackDropped: false,
        });
      }
    }

    await this.advanceOpenCrossChainLifecycles(limit);
    return results;
  }

  async advanceOpenCrossChainLifecycles(limit = 4): Promise<CrossChainLifecycleResult[]> {
    const preparedResults = await advancePreparedAcrossOriginTransactions(limit);
    for (const result of preparedResults) {
      if (result.terminal && result.settlementConfirmed) {
        await markOperatorTerminalByOpportunity(result.opportunityId).catch(() => undefined);
      }
    }

    const settledResults = await advanceOpenCrossChainLifecycles(limit);
    const standardFeedback = await claimPendingCrossChainTerminalFeedback(Math.max(limit, 8));
    const originFailureFeedback = await claimPendingAcrossOriginFailureFeedback(Math.max(limit, 8));

    for (const result of standardFeedback) {
      try {
        await markOperatorTerminalByOpportunity(result.opportunityId);
        await recordCrossChainTerminal(result);
        await markCrossChainTerminalFeedbackApplied(result.lifecycleId);
      } catch (error) {
        await releaseCrossChainTerminalFeedbackLease(result.lifecycleId, error).catch(() => undefined);
        logger.error('[FundingCrossChainAdapter] Cross-chain terminal feedback failed; durable feedback remains pending', {
          component: 'FundingCrossChainExecutionAdapter', lifecycleId: result.lifecycleId, opportunityId: result.opportunityId,
          error: error instanceof Error ? error.message : String(error), settlementAuthorityChanged: false, feedbackDropped: false,
        });
      }
    }

    for (const result of originFailureFeedback) {
      try {
        await markOperatorTerminalByOpportunity(result.opportunityId);
        await recordCrossChainTerminal(result);
        await markAcrossOriginFailureFeedbackApplied(result.lifecycleId);
      } catch (error) {
        await releaseAcrossOriginFailureFeedbackLease(result.lifecycleId, error).catch(() => undefined);
        logger.error('[FundingCrossChainAdapter] Across origin-failure feedback failed; durable failure remains pending', {
          component: 'FundingCrossChainExecutionAdapter', lifecycleId: result.lifecycleId, opportunityId: result.opportunityId,
          error: error instanceof Error ? error.message : String(error), settlementAuthorityChanged: false, feedbackDropped: false,
        });
      }
    }

    return [...preparedResults, ...settledResults];
  }

  async dispatch(decisions: readonly UnifiedExecutionDecision[]): Promise<FundingCrossChainDispatchResult[]> {
    if (!liveExecutionEnabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) return [];
    const results: FundingCrossChainDispatchResult[] = [];
    for (const decision of decisions) {
      if (!decision.admitted || this.inFlight.has(decision.opportunityId)) continue;
      const supported = (decision.topology === 'CROSS_CHAIN' && decision.path === 'BRIDGE_FLASH_LOAN')
        || (decision.topology === 'FUNDING_ARBITRAGE' && decision.path === 'SPOT_PERP_FUNDING');
      if (!supported) continue;
      this.inFlight.add(decision.opportunityId);
      try {
        results.push(decision.topology === 'CROSS_CHAIN' ? await dispatchCrossChain(decision) : await dispatchFunding(decision));
      } finally {
        this.inFlight.delete(decision.opportunityId);
      }
    }
    return results;
  }
}

export const fundingCrossChainExecutionAdapter = new FundingCrossChainExecutionAdapter();
