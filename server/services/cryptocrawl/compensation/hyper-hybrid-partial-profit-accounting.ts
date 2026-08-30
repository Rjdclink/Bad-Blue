import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { queueCexResidualReplan } from '../discovery/cex-residual-replan.js';
import type { HyperHybridChildExecution } from '../execution/hyper-hybrid-cex-execution.js';
import type { NormalizedRealizedExecution, RealizedExecutionEconomics } from '../execution/settlement-types.js';
import { retainedProfitLedger, type ProfitSplitAllocation } from './retained-profit-ledger.js';
import { rainbowProfitBridge } from './rainbow-profit-bridge.js';

function sumKnown(values: Array<number | null | undefined>): number | null {
  if (values.some(value => value === null || value === undefined || !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function aggregateCompletedEconomics(children: readonly HyperHybridChildExecution[]): RealizedExecutionEconomics | null {
  const realized = children.map(child => child.normalized?.realized).filter((value): value is RealizedExecutionEconomics => Boolean(value));
  if (realized.length !== children.length) return null;
  const netProfitUsd = sumKnown(realized.map(value => value.netProfitUsd));
  if (netProfitUsd === null || !(netProfitUsd > 0)) return null;
  return {
    acquisitionCostUsd: sumKnown(realized.map(value => value.acquisitionCostUsd)),
    proceedsUsd: sumKnown(realized.map(value => value.proceedsUsd)),
    exchangeFeeUsd: sumKnown(realized.map(value => value.exchangeFeeUsd)),
    gasUsd: sumKnown(realized.map(value => value.gasUsd === null ? 0 : value.gasUsd)),
    gasUsed: null,
    effectiveGasPriceWei: null,
    slippageBps: realized.every(value => value.slippageBps !== null && Number.isFinite(value.slippageBps))
      ? Math.max(...realized.map(value => value.slippageBps!))
      : null,
    netProfitUsd,
  };
}

function accountingIdentity(children: readonly HyperHybridChildExecution[]): string {
  const orderKeys = children
    .flatMap(child => child.normalized?.orders || [])
    .map(order => `${order.venue}:${order.orderId}`)
    .sort();
  return createHash('sha256').update(orderKeys.join('|')).digest('hex').slice(0, 24);
}

/**
 * Persist profitable terminal children only when their parent did not complete.
 *
 * This is accounting/treasury evidence, not Cryptara/stage/rank evidence. A split
 * parent can therefore keep already-realized profit without manufacturing extra
 * promotion samples simply because one parent required many child orders.
 *
 * Residual reassessment is market/execution discovery, not treasury authority.
 * It is therefore queued in a finally block after the accounting attempt so a
 * transient accounting-store failure cannot suppress fresh residual discovery.
 * The accounting error still propagates so durable profit persistence never
 * silently degrades.
 */
export async function persistHyperHybridPartialProfit(input: {
  parent: VerifiedArbitragePlan;
  children: readonly HyperHybridChildExecution[];
  parentSucceeded: boolean;
}): Promise<void> {
  if (input.parentSucceeded) return;
  const completed = input.children.filter(child =>
    child.success === true
    && child.settlementConfirmed === true
    && child.normalized?.terminal === true
    && child.normalized.settlementConfirmed === true
    && child.normalized.realized.netProfitUsd !== null
    && Number.isFinite(child.normalized.realized.netProfitUsd)
    && child.normalized.realized.netProfitUsd > 0,
  );
  if (completed.length === 0) return;

  const realized = aggregateCompletedEconomics(completed);
  if (!realized || realized.netProfitUsd === null || !(realized.netProfitUsd > 0)) return;
  const orders = completed.flatMap(child => child.normalized?.orders || []);
  const submittedAt = orders.length > 0 ? Math.min(...orders.map(order => order.submittedAt)) : Date.now();
  const terminalAt = orders
    .map(order => order.terminalAt)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const settledAt = terminalAt.length > 0 ? Math.max(...terminalAt) : Date.now();
  const completedNotionalUsd = completed.reduce((sum, child) => sum + Math.max(0, child.plannedNotionalUsd), 0);
  const remainingNotionalUsd = Math.max(0, input.parent.notionalUsd - completedNotionalUsd);
  const settlement: NormalizedRealizedExecution = {
    status: 'partially_filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt,
    settledAt,
    venueOrRoute: `${input.parent.buyVenue}->${input.parent.sellVenue}:hyper_hybrid_completed_subset`,
    chain: 'cex',
    predicted: {
      profitUsd: completed.reduce((sum, child) => sum + child.expectedProfitUsd, 0),
      feeUsd: null,
      slippageBps: input.parent.expectedSlippageBps,
    },
    realized,
    provenance: [
      'hyper_hybrid_completed_subset_accounting_only',
      'cryptara_rank_authority:false',
      'profit_ladder_progression_authority:false',
      `parent_target_notional_usd:${input.parent.notionalUsd}`,
      `completed_notional_usd:${completedNotionalUsd}`,
      `remaining_notional_usd:${remainingNotionalUsd}`,
      `completed_children:${completed.length}`,
    ],
    orders,
  };
  const identity = accountingIdentity(completed);
  let allocation: ProfitSplitAllocation | null = null;
  try {
    allocation = await retainedProfitLedger.recordTerminalSettlement({
      source: 'master_pipeline',
      opportunityId: `hyper-hybrid-partial:${input.parent.symbol}:${identity}`,
      chain: 'cex',
      symbol: input.parent.symbol,
      strategy: 'verified_cex_arbitrage_split_completed_subset_accounting',
      success: true,
      expectedProfitUsd: settlement.predicted.profitUsd ?? 0,
      realizedProfitUsd: realized.netProfitUsd,
      feeUsd: realized.exchangeFeeUsd,
      slippageBps: realized.slippageBps,
      latencyMs: Math.max(...completed.map(child => Math.max(0, child.latencyMs))),
      usedZeroCapital: false,
      timestamp: settledAt,
      settlementStatus: settlement.status,
      settlementConfirmed: true,
      provenance: [...settlement.provenance, `accounting_identity:${identity}`],
      settlement,
      notes: 'Partial parent: profitable terminal child subset persisted directly to treasury; excluded from Cryptara/stage/rank evidence. Remaining parent notional is independently re-assessed from fresh market evidence before any later execution.',
    });
  } finally {
    queueCexResidualReplan({
      symbol: input.parent.symbol,
      remainingNotionalUsd,
      sourceParentNotionalUsd: input.parent.notionalUsd,
    });
  }

  if (allocation?.recorded) {
    logger.info('[CEX HyperHybrid] Partial child profit persisted without rank inflation', {
      component: 'HyperHybridPartialProfitAccounting',
      symbol: input.parent.symbol,
      realizedProfitUsd: allocation.realizedProfitUsd,
      completedChildren: completed.length,
      completedNotionalUsd,
      remainingNotionalUsd,
      accountingIdentity: identity,
      rankAuthority: false,
      profitLadderProgressionAuthority: false,
      residualReplanIndependentOfTreasuryPersistence: true,
    });
    void rainbowProfitBridge.wake('terminal_profit_recorded');
  }
}
