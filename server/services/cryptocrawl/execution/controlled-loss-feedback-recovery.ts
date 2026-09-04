import logger from '../../../logger.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { createProductionCexSettlementAdapters } from './cex-settlement.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';

type Venue = 'kraken' | 'okx';

type TerminalControlledLossRow = {
  event_id: string;
  local_date: string;
  status: 'TERMINAL_LOSS' | 'TERMINAL_NONLOSS';
  venue: Venue;
  symbol: string;
  requested_base_quantity: string | number;
  exit_base_quantity: string | number;
  entry_order_id: string;
  exit_order_id: string;
  expected_loss_usd: string | number | null;
  realized_profit_usd: string | number;
  unlocked_at: string;
  completed_at: string | null;
};

function finite(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function terminalRowsMissingFeedback(): Promise<TerminalControlledLossRow[]> {
  if (!isDatabaseConfigured) return [];
  const result = await pool.query(
    `SELECT event_id::text, local_date::text, status, venue, symbol,
            requested_base_quantity::text, exit_base_quantity::text,
            entry_order_id, exit_order_id, expected_loss_usd::text,
            realized_profit_usd::text, unlocked_at::text, completed_at::text
     FROM public.cryptocrawler_controlled_loss_learning_events
     WHERE status IN ('TERMINAL_LOSS','TERMINAL_NONLOSS')
       AND feedback_recorded_at IS NULL
     ORDER BY completed_at ASC NULLS FIRST, created_at ASC
     LIMIT 16`,
  );
  return result.rows as TerminalControlledLossRow[];
}

async function replayOne(row: TerminalControlledLossRow): Promise<boolean> {
  if ((row.venue !== 'kraken' && row.venue !== 'okx') || !row.symbol || !row.entry_order_id || !row.exit_order_id) {
    throw new Error(`terminal controlled-loss ${row.event_id} lacks durable exchange identity`);
  }
  const requestedEntry = finite(row.requested_base_quantity);
  const requestedExit = finite(row.exit_base_quantity);
  const realizedProfitUsd = finite(row.realized_profit_usd);
  if (!(requestedEntry && requestedEntry > 0) || !(requestedExit && requestedExit > 0) || realizedProfitUsd === null) {
    throw new Error(`terminal controlled-loss ${row.event_id} lacks durable quantities/economics`);
  }

  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const fallbackSubmittedAt = new Date(row.unlocked_at).getTime();
  const [entry, exit] = await Promise.all([
    adapter.query({
      venue: row.venue,
      orderId: row.entry_order_id,
      symbol: row.symbol,
      side: 'buy',
      requestedQuantity: requestedEntry,
      submittedAt: Number.isFinite(fallbackSubmittedAt) ? fallbackSubmittedAt : Date.now(),
    }),
    adapter.query({
      venue: row.venue,
      orderId: row.exit_order_id,
      symbol: row.symbol,
      side: 'sell',
      requestedQuantity: requestedExit,
      submittedAt: Number.isFinite(fallbackSubmittedAt) ? fallbackSubmittedAt : Date.now(),
    }),
  ]);

  if (!entry.terminal || !exit.terminal || !(Number(entry.filledQuantity || 0) > 0) || !(Number(exit.filledQuantity || 0) > 0)) {
    throw new Error(`terminal controlled-loss ${row.event_id} cannot replay without two authenticated terminal-filled orders`);
  }

  const submittedAt = Math.min(entry.submittedAt, exit.submittedAt);
  const settledAt = Math.max(entry.terminalAt || submittedAt, exit.terminalAt || submittedAt);
  const expectedLossUsd = Math.max(0, finite(row.expected_loss_usd) || 0);
  const normalized: NormalizedRealizedExecution = {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt,
    settledAt,
    venueOrRoute: `controlled-loss:${row.venue}`,
    chain: 'cex',
    predicted: {
      profitUsd: expectedLossUsd > 0 ? -expectedLossUsd : null,
      feeUsd: null,
      slippageBps: null,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: 0,
      gasUsed: null,
      effectiveGasPriceWei: null,
      slippageBps: null,
      netProfitUsd: realizedProfitUsd,
    },
    provenance: [
      'intentional_controlled_loss_learning',
      'unlocked_after_first_terminal_profit',
      'randomized_post_win_schedule',
      'max_daily_loss_fraction:0.05',
      'normal_parent_trade_quota_consumed:false',
      'unlevered_spot_only',
      'fok_entry_exit',
      'authenticated_terminal_feedback_replay',
      `durable_terminal_status:${row.status.toLowerCase()}`,
    ],
    orders: [entry, exit],
  };

  await recordCryptaraExecutionEvidence({
    source: 'manual',
    opportunityId: `controlled-loss:${row.event_id}`,
    chain: 'cex',
    symbol: row.symbol,
    strategy: 'controlled_loss_learning',
    success: realizedProfitUsd > 0,
    expectedProfitUsd: expectedLossUsd > 0 ? -expectedLossUsd : 0,
    realizedProfitUsd,
    feeUsd: null,
    slippageBps: null,
    latencyMs: Math.max(0, settledAt - submittedAt),
    usedZeroCapital: false,
    timestamp: settledAt,
    notes: row.status === 'TERMINAL_LOSS'
      ? 'Intentional controlled negative-edge learning settlement (durable replay safe)'
      : 'Controlled negative-edge learning round-trip settled non-negative; terminal truth preserved (durable replay safe)',
    settlementStatus: normalized.status,
    settlementConfirmed: true,
    provenance: normalized.provenance,
    settlement: normalized,
  });

  const marked = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET feedback_recorded_at=now(), updated_at=now()
     WHERE event_id=$1::uuid
       AND status IN ('TERMINAL_LOSS','TERMINAL_NONLOSS')
       AND feedback_recorded_at IS NULL
     RETURNING event_id::text`,
    [row.event_id],
  );
  return marked.rowCount === 1;
}

export async function replayControlledLossLearningFeedbackOnce(): Promise<void> {
  const rows = await terminalRowsMissingFeedback();
  for (const row of rows) {
    try {
      const marked = await replayOne(row);
      if (marked) {
        logger.info('[ControlledLossLearning] Durable terminal settlement replayed into canonical Cryptara learning', {
          component: 'ControlledLossFeedbackRecovery',
          eventId: row.event_id,
          localDate: row.local_date,
          status: row.status,
          venue: row.venue,
          symbol: row.symbol,
          terminalFeedbackIdempotent: true,
        });
      }
    } catch (error) {
      logger.warn('[ControlledLossLearning] Terminal learning feedback replay deferred', {
        component: 'ControlledLossFeedbackRecovery',
        eventId: row.event_id,
        error: error instanceof Error ? error.message : String(error),
        terminalEventRetainedForRetry: true,
      });
    }
  }
}
