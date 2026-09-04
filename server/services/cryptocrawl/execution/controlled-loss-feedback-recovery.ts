import { randomInt } from 'node:crypto';
import logger from '../../../logger.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { createProductionCexSettlementAdapters } from './cex-settlement.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';

const STRATEGY_TIMEZONE = 'America/Chicago';
const MIN_NONLOSS_RETRY_DELAY_MS = 15_000;
const MAX_NONLOSS_RETRY_DELAY_MS = 10 * 60_000;
const DAY_END_GUARD_MS = 30_000;

type Venue = 'kraken' | 'okx';
type ReplayDisposition = 'feedback_marked' | 'nonloss_retry_scheduled';

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

function localDateKey(epochMs = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STRATEGY_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextLocalDateBoundary(epochMs: number): number {
  const current = localDateKey(epochMs);
  let low = epochMs;
  let high = epochMs + 36 * 60 * 60_000;
  while (high - low > 1_000) {
    const midpoint = Math.floor((low + high) / 2);
    if (localDateKey(midpoint) === current) low = midpoint;
    else high = midpoint;
  }
  return high;
}

function randomizedNonlossRetry(epochMs = Date.now()): number | null {
  const earliest = epochMs + MIN_NONLOSS_RETRY_DELAY_MS;
  const latest = Math.min(
    epochMs + MAX_NONLOSS_RETRY_DELAY_MS,
    nextLocalDateBoundary(epochMs) - DAY_END_GUARD_MS,
  );
  if (latest <= earliest) return null;
  return randomInt(earliest, latest + 1);
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

async function scheduleAnotherAttemptAfterTruthfulNonloss(row: TerminalControlledLossRow): Promise<boolean> {
  if (row.status !== 'TERMINAL_NONLOSS' || row.local_date !== localDateKey()) return false;
  const retryAt = randomizedNonlossRetry();
  if (retryAt === null) return false;

  const reset = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='RETRYABLE', retry_not_before=to_timestamp($2/1000.0),
         gross_profit_usd_at_claim=NULL, max_loss_usd=NULL, expected_loss_usd=NULL,
         venue=NULL, symbol=NULL, base_asset=NULL, quote_asset=NULL, quote_asset_usd=NULL,
         authenticated_taker_fee_bps=NULL, source_quote_reserve=NULL,
         requested_base_quantity=NULL, entry_limit_price=NULL,
         entry_client_order_id=NULL, entry_order_id=NULL, entry_inventory_reservation_id=NULL,
         entry_applied=false, exit_base_quantity=NULL, exit_limit_price=NULL,
         exit_client_order_id=NULL, exit_order_id=NULL, exit_inventory_reservation_id=NULL,
         exit_applied=false, realized_profit_usd=NULL, terminal_price_observed_at=NULL,
         settlement_evidence=NULL, completed_at=NULL, feedback_recorded_at=NULL,
         last_error='Terminal non-loss was learned truthfully; randomized retry scheduled until the single actual controlled loss is obtained',
         updated_at=now()
     WHERE event_id=$1::uuid
       AND status='TERMINAL_NONLOSS'
       AND feedback_recorded_at IS NULL
     RETURNING event_id::text`,
    [row.event_id, retryAt],
  );
  return reset.rowCount === 1;
}

async function replayOne(row: TerminalControlledLossRow): Promise<ReplayDisposition> {
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
      : 'Controlled negative-edge learning round-trip settled non-negative; truth learned before randomized retry',
    settlementStatus: normalized.status,
    settlementConfirmed: true,
    provenance: normalized.provenance,
    settlement: normalized,
  });

  // A favorable/flat surprise is still valuable learning, but it does not satisfy
  // the operator's requirement for one actual controlled loss. Reuse this day's
  // single durable event with a new randomized attempt. Because only NONLOSS is
  // reset, a first negative terminal outcome permanently ends the lane and a
  // second controlled loss cannot occur.
  if (await scheduleAnotherAttemptAfterTruthfulNonloss(row)) {
    return 'nonloss_retry_scheduled';
  }

  const marked = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET feedback_recorded_at=now(), updated_at=now()
     WHERE event_id=$1::uuid
       AND status IN ('TERMINAL_LOSS','TERMINAL_NONLOSS')
       AND feedback_recorded_at IS NULL
     RETURNING event_id::text`,
    [row.event_id],
  );
  if (marked.rowCount !== 1) throw new Error(`controlled-loss ${row.event_id} feedback marker could not be durably committed`);
  return 'feedback_marked';
}

export async function replayControlledLossLearningFeedbackOnce(): Promise<void> {
  const rows = await terminalRowsMissingFeedback();
  for (const row of rows) {
    try {
      const disposition = await replayOne(row);
      logger.info('[ControlledLossLearning] Durable terminal settlement delivered to canonical Cryptara learning', {
        component: 'ControlledLossFeedbackRecovery',
        eventId: row.event_id,
        localDate: row.local_date,
        status: row.status,
        venue: row.venue,
        symbol: row.symbol,
        disposition,
        terminalFeedbackIdempotent: true,
        secondControlledLossPossible: false,
      });
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
