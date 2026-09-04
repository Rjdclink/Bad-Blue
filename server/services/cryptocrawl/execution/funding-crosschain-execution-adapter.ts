import { ethers } from 'ethers';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { getPreparedCrossChainRoute } from '../discovery/cross-chain-opportunity-generator.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { stageManager } from '../governance/stage-management.js';
import { executeAcrossBridgeQuote } from './across-bridge-executor.js';
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
import { fundingPositionLifecycle, type FundingExecutionPlan, type FundingLifecycleResult } from './funding-position-lifecycle.js';
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

function liveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
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

async function recordFundingTerminal(result: FundingLifecycleResult): Promise<void> {
  if (!result.lifecycleId || !result.settlementConfirmed || !result.settlement?.terminal) return;
  const context = await fundingContext(result.lifecycleId);
  if (!context) return;
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

async function recordCrossChainTerminal(result: CrossChainLifecycleResult): Promise<void> {
  if (!result.terminal || !result.settlementConfirmed) return;
  const realized = result.realizedNetProfitUsd;
  const settledAt = result.settledAt ?? Date.now();
  const terminal = result.terminalAmountEvidence;
  const inputHuman = terminal
    ? Number(ethers.utils.formatUnits(terminal.inputAmount, result.quote.inputTokenDecimals))
    : null;
  const outputHuman = terminal
    ? Number(ethers.utils.formatUnits(terminal.outputAmount, result.quote.outputTokenDecimals))
    : null;
  const acquisitionCostUsd = inputHuman !== null && result.assetUsd !== null && Number.isFinite(inputHuman)
    ? inputHuman * result.assetUsd
    : null;
  const proceedsUsd = outputHuman !== null && result.assetUsd !== null && Number.isFinite(outputHuman)
    ? outputHuman * result.assetUsd
    : null;
  const candidate = measuredCandidateRegistry.get(result.opportunityId);
  if (candidate && realized !== null && Number.isFinite(realized)) {
    const realizedBps = result.notionalUsd > 0 ? realized / result.notionalUsd * 10_000 : null;
    measuredCandidateRegistry.updateStatus(result.opportunityId, realized > 0 ? candidate.status : 'blocked', {
      economics: { ...candidate.economics, realizedNetProfitBps: realizedBps },
      executionCapabilityReason: realized > 0
        ? candidate.executionCapabilityReason
        : result.status === 'REFUNDED'
          ? 'Across route returned exact principal; actual origin gas produced a realized loss'
          : 'Terminal Across same-asset result was not profitable after actual origin gas',
      provenance: [...candidate.provenance, 'cross_chain:durable_terminal_reconciliation', 'cross_chain:system_capital_settlement_authority'],
    });
  }
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
    settlementStatus: result.status === 'FILLED' ? 'filled' : result.status === 'REFUNDED' ? 'refunded' : 'settlement_unknown',
    settlementConfirmed: true,
    provenance: [
      ...(candidate?.provenance ?? []),
      ...(terminal?.provenance ?? []),
      'cross_chain:restart_safe_terminal_feedback',
      'cross_chain:actual_origin_gas',
      'synthetic_evidence:false',
    ],
    settlement: {
      status: result.status === 'FILLED' ? 'filled' : result.status === 'REFUNDED' ? 'refunded' : 'settlement_unknown',
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
      provenance: [
        ...(terminal?.provenance ?? []),
        result.status === 'FILLED' ? 'system_owned_origin_consumed_destination_lot_created' : 'exact_refund_principal_verified',
      ],
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
  const reservationExpiry = Date.now() + Math.max(
    6 * 60 * 60_000,
    Math.min(7 * 24 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_CROSS_CHAIN_RESERVATION_HOLD_MS || 6 * 60 * 60_000)),
  );
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
    const execution = await executeAcrossBridgeQuote(quote, { onSubmitted: persist, returnAfterSubmission: true });
    const depositTxnRef = execution.depositTxnRef;
    if (depositTxnRef && !durableSubmission && execution.originNativeFeeWei) {
      // One immediate idempotent retry protects against a transient callback error.
      try {
        await persist({ depositTxnRef, originNativeFeeWei: execution.originNativeFeeWei, submittedAt: Date.now() });
      } catch (error) {
        logger.error('[FundingCrossChainAdapter] Across origin deposit exists but durable lifecycle persistence is unavailable; reservation is deliberately retained', {
          component: 'FundingCrossChainExecutionAdapter',
          opportunityId: candidate.opportunityId,
          depositTxnRef,
          reservationId: reservation.reservationId,
          capitalReleaseAllowed: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (depositTxnRef) {
      return {
        opportunityId: decision.opportunityId,
        topology: 'CROSS_CHAIN',
        path: 'BRIDGE_FLASH_LOAN',
        dispatched: true,
        submitted: true,
        success: false,
        settlementConfirmed: false,
        transactionHash: depositTxnRef,
        lifecycleId: durableSubmission?.lifecycleId,
        submissionReference: durableSubmission?.lifecycleId ?? depositTxnRef,
        realizedNetProfitUsd: null,
        error: durableSubmission ? undefined : execution.error || 'CROSS_CHAIN_SUBMITTED_DURABILITY_RECOVERY_REQUIRED',
      };
    }

    await reservation.release().catch(() => undefined);
    return {
      opportunityId: decision.opportunityId,
      topology: 'CROSS_CHAIN',
      path: 'BRIDGE_FLASH_LOAN',
      dispatched: false,
      submitted: false,
      success: false,
      settlementConfirmed: false,
      error: execution.error || 'CROSS_CHAIN_SUBMISSION_FAILED',
    };
  } catch (error) {
    // No transaction hash escaped the executor, so the origin deposit was not
    // proven submitted. Releasing the reservation is safe only in this pre-submit path.
    await reservation.release().catch(() => undefined);
    return {
      opportunityId: decision.opportunityId,
      topology: 'CROSS_CHAIN',
      path: 'BRIDGE_FLASH_LOAN',
      dispatched: false,
      submitted: false,
      success: false,
      settlementConfirmed: false,
      error: error instanceof Error ? error.message : String(error),
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
  const submitted = result.status === 'opened' && Boolean(result.lifecycleId);
  return {
    opportunityId: decision.opportunityId,
    topology: 'FUNDING_ARBITRAGE',
    path: 'SPOT_PERP_FUNDING',
    dispatched: submitted,
    submitted,
    success: result.success,
    settlementConfirmed: result.settlementConfirmed,
    lifecycleId: result.lifecycleId,
    submissionReference: result.lifecycleId,
    realizedNetProfitUsd: result.settlement?.realizedNetProfitUsd,
    error: result.error,
  };
}

class FundingCrossChainExecutionAdapter {
  private readonly inFlight = new Set<string>();

  async advanceOpenFundingLifecycles(limit = 4): Promise<FundingLifecycleResult[]> {
    const results = await fundingPositionLifecycle.advanceOpenLifecycles(limit);
    for (const result of results) {
      try { await recordFundingTerminal(result); }
      catch (error) {
        logger.error('[FundingCrossChainAdapter] Funding terminal feedback failed without changing settlement truth', {
          component: 'FundingCrossChainExecutionAdapter',
          lifecycleId: result.lifecycleId,
          error: error instanceof Error ? error.message : String(error),
          settlementAuthorityChanged: false,
        });
      }
    }
    return results;
  }

  async advanceOpenCrossChainLifecycles(limit = 4): Promise<CrossChainLifecycleResult[]> {
    const results = await advanceOpenCrossChainLifecycles(limit);
    const feedback = await claimPendingCrossChainTerminalFeedback(Math.max(limit, 8));
    for (const result of feedback) {
      try {
        await recordCrossChainTerminal(result);
        await markCrossChainTerminalFeedbackApplied(result.lifecycleId);
      } catch (error) {
        await releaseCrossChainTerminalFeedbackLease(result.lifecycleId, error).catch(() => undefined);
        logger.error('[FundingCrossChainAdapter] Cross-chain terminal feedback failed; durable feedback remains pending', {
          component: 'FundingCrossChainExecutionAdapter',
          lifecycleId: result.lifecycleId,
          opportunityId: result.opportunityId,
          error: error instanceof Error ? error.message : String(error),
          settlementAuthorityChanged: false,
          feedbackDropped: false,
        });
      }
    }
    return results;
  }

  async advanceOpenLifecycles(limit = 4): Promise<void> {
    await Promise.all([
      this.advanceOpenFundingLifecycles(limit),
      this.advanceOpenCrossChainLifecycles(limit),
    ]);
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
        results.push(decision.topology === 'CROSS_CHAIN'
          ? await dispatchCrossChain(decision)
          : await dispatchFunding(decision));
      } finally {
        this.inFlight.delete(decision.opportunityId);
      }
    }
    return results;
  }
}

export const fundingCrossChainExecutionAdapter = new FundingCrossChainExecutionAdapter();