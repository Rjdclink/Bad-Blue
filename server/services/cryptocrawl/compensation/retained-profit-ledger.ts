import { createHash, randomInt } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';

const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();
const PAYOUT_FRACTION = 0.90;
const RETAINED_FRACTION = 0.10;
const RETAINED_TARGET_VENUES = ['kraken', 'okx'] as const;
const retryAttemptsRaw = Number(process.env.CRYPTOCRAWL_RETAINED_PROFIT_RETRIES || 4);
const retryBaseMsRaw = Number(process.env.CRYPTOCRAWL_RETAINED_PROFIT_RETRY_BASE_MS || 250);
const RETRY_ATTEMPTS = Number.isFinite(retryAttemptsRaw) ? Math.max(1, Math.min(8, Math.trunc(retryAttemptsRaw))) : 4;
const RETRY_BASE_MS = Number.isFinite(retryBaseMsRaw) ? Math.max(50, Math.min(5_000, Math.trunc(retryBaseMsRaw))) : 250;

export interface ProfitSplitAllocation {
  eventId: string;
  realizedProfitUsd: number;
  payoutTargetUsd: number;
  retainedTargetUsd: number;
  payoutFraction: number;
  retainedFraction: number;
  payoutSequence: number;
  scheduledNotBefore: number;
  payoutSourceVenue: string | null;
  payoutSourceAsset: string | null;
  retainedTargetVenue?: 'kraken' | 'okx' | null;
  retainedPlacementStatus?: 'IN_PLACE' | 'TRANSFER_REQUIRED' | null;
  recorded: boolean;
}

interface PayoutInventorySource {
  venue: 'coinbase' | 'kraken' | 'okx';
  asset: 'USD' | 'USDC' | 'USDT';
  reservedAssetAmount: number;
}

interface StrategyDecision {
  sequence: number;
  payoutFraction: typeof PAYOUT_FRACTION;
  retainedFraction: typeof RETAINED_FRACTION;
  scheduledNotBefore: number;
}

function destinationFingerprint(): string {
  return DESTINATION
    ? createHash('sha256').update(DESTINATION.toLowerCase()).digest('hex').slice(0, 16)
    : 'unconfigured';
}

function realizedProfit(feedback: CryptaraExecutionFeedback): number | null {
  const value = Number(feedback.realizedProfitUsd ?? feedback.settlement?.realized.netProfitUsd);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeRealized(realized: number): number {
  const normalized = Number(realized.toFixed(12));
  if (!(normalized > 0) || !Number.isFinite(normalized)) throw new Error('Invalid realized profit');
  return normalized;
}

function splitProfit(realized: number): { realized: number; payout: number; retained: number } {
  const normalized = normalizeRealized(realized);
  const payout = Number((normalized * PAYOUT_FRACTION).toFixed(12));
  const retained = Number((normalized - payout).toFixed(12));
  if (!(payout > 0) || retained < 0 || Math.abs((payout + retained) - normalized) > 1e-9) {
    throw new Error('Invalid 90/10 realized-profit allocation');
  }
  return { realized: normalized, payout, retained };
}

function splitSpotSymbol(symbol: string): { base: string; quote: 'USD' | 'USDC' | 'USDT' } | null {
  const normalized = symbol.trim().toUpperCase().replace(/[-_/]/g, '');
  for (const quote of ['USDT', 'USDC', 'USD'] as const) {
    if (!normalized.endsWith(quote) || normalized.length <= quote.length) continue;
    return { base: normalized.slice(0, -quote.length), quote };
  }
  return null;
}

function payoutInventorySource(feedback: CryptaraExecutionFeedback, payoutUsd: number): PayoutInventorySource | null {
  const candidates = (feedback.settlement?.orders || [])
    .filter(order => order.side === 'sell' && order.terminal === true && Number(order.filledQuantity || 0) > 0)
    .flatMap(order => {
      const pair = splitSpotSymbol(order.symbol);
      const venue = String(order.venue || '').trim().toLowerCase();
      if (!pair || !['coinbase', 'kraken', 'okx'].includes(venue)) return [];
      return [{ venue: venue as PayoutInventorySource['venue'], asset: pair.quote }];
    });
  const unique = [...new Map(candidates.map(item => [`${item.venue}:${item.asset}`, item])).values()];
  if (unique.length !== 1) return null;
  return { ...unique[0], reservedAssetAmount: payoutUsd };
}

function sourceVenue(feedback: CryptaraExecutionFeedback): string | null {
  const sells = (feedback.settlement?.orders || [])
    .filter(order => order.side === 'sell' && order.terminal === true && Number(order.filledQuantity || 0) > 0)
    .map(order => String(order.venue || '').trim().toLowerCase())
    .filter(Boolean);
  const uniqueSells = [...new Set(sells)];
  if (uniqueSells.length === 1) return uniqueSells[0];
  const venues = [...new Set((feedback.settlement?.orders || [])
    .map(order => String(order.venue || '').trim().toLowerCase())
    .filter(Boolean))];
  if (venues.length === 1) return venues[0];
  const route = String(feedback.settlement?.venueOrRoute || '').trim().toLowerCase();
  return route || null;
}

function retainedTargetVenue(): 'kraken' | 'okx' {
  return RETAINED_TARGET_VENUES[randomInt(0, RETAINED_TARGET_VENUES.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persistenceRetryDelayMs(attempt: number): number {
  const capMs = Math.min(10_000, RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)));
  const floorMs = Math.max(50, Math.floor(capMs * 0.75));
  const ceilingMs = Math.max(floorMs, Math.floor(capMs * 1.25));
  return floorMs + Math.floor(Math.random() * Math.max(1, ceilingMs - floorMs + 1));
}

async function allocateStrategyDecision(client: { query: (text: string, values?: unknown[]) => Promise<any> }): Promise<StrategyDecision> {
  const state = await client.query(
    `SELECT profitable_payout_sequence
     FROM public.cryptocrawler_terminal_sweep_control
     WHERE system_key='cryptocrawler'
     FOR UPDATE`,
  );
  if (state.rowCount !== 1) throw new Error('Treasury control state unavailable for fixed 90/10 allocation');
  const sequence = Number(state.rows[0]?.profitable_payout_sequence || 0) + 1;
  const scheduledNotBefore = Date.now();
  await client.query(
    `UPDATE public.cryptocrawler_terminal_sweep_control
     SET profitable_payout_sequence=$1,
         last_profit_payout_scheduled_at=to_timestamp($2/1000.0),
         updated_at=now()
     WHERE system_key='cryptocrawler'`,
    [sequence, scheduledNotBefore],
  );
  return {
    sequence,
    payoutFraction: PAYOUT_FRACTION,
    retainedFraction: RETAINED_FRACTION,
    scheduledNotBefore,
  };
}

function existingAllocation(eventId: string, row: any): ProfitSplitAllocation {
  return {
    eventId,
    realizedProfitUsd: Number(row.realized_profit_usd),
    payoutTargetUsd: Number(row.payout_target_usd || 0),
    retainedTargetUsd: Number(row.retained_target_usd ?? row.realized_profit_usd),
    payoutFraction: Number(row.payout_fraction ?? 0),
    retainedFraction: Number(row.retained_fraction ?? 1),
    payoutSequence: Number(row.payout_sequence || 0),
    scheduledNotBefore: row.scheduled_not_before ? new Date(row.scheduled_not_before).getTime() : 0,
    payoutSourceVenue: row.source_venue ? String(row.source_venue) : null,
    payoutSourceAsset: row.source_asset ? String(row.source_asset) : null,
    retainedTargetVenue: row.target_venue ? String(row.target_venue) as 'kraken' | 'okx' : null,
    retainedPlacementStatus: row.retained_status ? String(row.retained_status) as 'IN_PLACE' | 'TRANSFER_REQUIRED' : null,
    recorded: false,
  };
}

/**
 * Persists each terminal-confirmed profitable settlement exactly once.
 * New settlements always allocate 90% to the durable ETH payout obligation and
 * 10% to retained system capital. Historical payout/retention rows are preserved
 * exactly as recorded; retries never re-roll either money split or target venue.
 */
class RetainedProfitLedger {
  private ready: Promise<void> | null = null;

  async recordTerminalSettlement(feedback: CryptaraExecutionFeedback): Promise<ProfitSplitAllocation | null> {
    if (!feedback.settlement || feedback.settlement.terminal !== true || feedback.settlement.settlementConfirmed !== true) return null;
    if (feedback.success !== true) return null;
    const realized = realizedProfit(feedback);
    if (realized === null || !isDatabaseConfigured) return null;

    await this.ensureStore();
    const eventId = terminalFeedbackIdentity(feedback);
    const destinationHash = destinationFingerprint();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      const client = await withCryptaraSupabasePriority('critical', () => pool.connect());
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          `SELECT * FROM (
             SELECT 0 AS precedence, 'payout'::text AS source,
                    j.event_id, j.realized_profit_usd, j.payout_target_usd, j.retained_target_usd,
                    j.payout_fraction, j.retained_fraction, j.payout_sequence, j.scheduled_not_before,
                    j.source_venue, j.source_asset,
                    r.target_venue, r.status AS retained_status
             FROM public.cryptocrawler_profit_payout_jobs j
             LEFT JOIN public.cryptocrawler_retained_exchange_allocations r USING (event_id)
             WHERE j.event_id=$1
             UNION ALL
             SELECT 1 AS precedence, 'retained'::text AS source,
                    e.event_id, e.realized_profit_usd, e.payout_target_usd, e.retained_target_usd,
                    0::numeric AS payout_fraction, 1::numeric AS retained_fraction,
                    0::bigint AS payout_sequence, NULL::timestamptz AS scheduled_not_before,
                    NULL::text AS source_venue, NULL::text AS source_asset,
                    r.target_venue, r.status AS retained_status
             FROM private.cryptocrawler_rainbow_profit_events e
             LEFT JOIN public.cryptocrawler_retained_exchange_allocations r USING (event_id)
             WHERE e.event_id=$1
           ) existing
           ORDER BY precedence
           LIMIT 1`,
          [eventId],
        );
        if (existing.rowCount === 1) {
          await client.query('COMMIT');
          return existingAllocation(eventId, existing.rows[0]);
        }

        const decision = await allocateStrategyDecision(client);
        const allocation = splitProfit(realized);
        const payoutSource = payoutInventorySource(feedback, allocation.payout);
        const observedSourceVenue = payoutSource?.venue || sourceVenue(feedback);
        const targetVenue = retainedTargetVenue();
        const retainedStatus: 'IN_PLACE' | 'TRANSFER_REQUIRED' = observedSourceVenue === targetVenue
          ? 'IN_PLACE'
          : 'TRANSFER_REQUIRED';

        const inserted = await client.query(
          `INSERT INTO private.cryptocrawler_rainbow_profit_events
            (event_id, opportunity_id, realized_profit_usd, payout_target_usd, retained_target_usd,
             payout_operating_cost_usd, status, destination_hash, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,0,'queued',$6,now(),now())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [eventId, feedback.opportunityId || null, allocation.realized, allocation.payout, allocation.retained, destinationHash],
        );
        if (inserted.rowCount !== 1) throw new Error('Profit event appeared concurrently while 90/10 treasury state was locked');

        await client.query(
          `INSERT INTO public.cryptocrawler_profit_payout_jobs
            (event_id, opportunity_id, realized_profit_usd, payout_target_usd, retained_target_usd,
             payout_fraction, retained_fraction, payout_sequence, scheduled_not_before,
             payout_asset, payout_network, status, source_venue, source_asset, destination_hash, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),'ETH','ethereum','QUEUED',$10,$11,$12,now(),now())`,
          [
            eventId,
            feedback.opportunityId || null,
            allocation.realized,
            allocation.payout,
            allocation.retained,
            decision.payoutFraction,
            decision.retainedFraction,
            decision.sequence,
            decision.scheduledNotBefore,
            observedSourceVenue,
            payoutSource?.asset || null,
            destinationHash,
          ],
        );

        if (payoutSource) {
          await client.query(
            `INSERT INTO public.cryptocrawler_payout_asset_reservations
              (event_id, venue, asset, reserved_asset_amount, remaining_asset_amount, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$4,'HELD',now(),now())
             ON CONFLICT (event_id) DO NOTHING`,
            [eventId, payoutSource.venue, payoutSource.asset, payoutSource.reservedAssetAmount],
          );
        }

        await client.query(
          `INSERT INTO public.cryptocrawler_retained_exchange_allocations
            (event_id, retained_usd, target_venue, source_venue, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,now(),now())`,
          [eventId, allocation.retained, targetVenue, observedSourceVenue, retainedStatus],
        );

        const dailyRecorded = await client.query(
          `SELECT public.cryptocrawler_operator_strategy_record_profit($1,$2,$3) AS recorded`,
          [eventId, feedback.opportunityId || '', allocation.realized],
        );
        if (dailyRecorded.rows[0]?.recorded !== true) {
          throw new Error('Terminal profit was not accepted by the durable operator strategy ledger');
        }

        await client.query(
          `UPDATE public.cryptocrawler_terminal_sweep_control
           SET retained_profit_usd = retained_profit_usd + $1,
               destination_address = COALESCE(NULLIF($2, ''), destination_address),
               updated_at = now()
           WHERE system_key='cryptocrawler'`,
          [allocation.retained, DESTINATION],
        );

        await client.query('COMMIT');
        logger.info('[Treasury] Terminal profit allocated under fixed 90/10 operator strategy', {
          component: 'RetainedProfitLedger',
          eventId,
          realizedProfitUsd: allocation.realized,
          payoutTargetUsd: allocation.payout,
          retainedTargetUsd: allocation.retained,
          payoutFraction: PAYOUT_FRACTION,
          retainedFraction: RETAINED_FRACTION,
          payoutSequence: decision.sequence,
          payoutScheduledImmediately: true,
          payoutSourceVenue: observedSourceVenue,
          payoutSourceAsset: payoutSource?.asset || null,
          retainedTargetVenue: targetVenue,
          retainedPlacementStatus: retainedStatus,
          targetSelectionPersisted: true,
          operatorBalancePromotedToSystemCapital: false,
        });
        return {
          eventId,
          realizedProfitUsd: allocation.realized,
          payoutTargetUsd: allocation.payout,
          retainedTargetUsd: allocation.retained,
          payoutFraction: PAYOUT_FRACTION,
          retainedFraction: RETAINED_FRACTION,
          payoutSequence: decision.sequence,
          scheduledNotBefore: decision.scheduledNotBefore,
          payoutSourceVenue: observedSourceVenue,
          payoutSourceAsset: payoutSource?.asset || null,
          retainedTargetVenue: targetVenue,
          retainedPlacementStatus: retainedStatus,
          recorded: true,
        };
      } catch (error) {
        lastError = error;
        try { await client.query('ROLLBACK'); } catch { /* transaction may already be gone */ }
        if (attempt < RETRY_ATTEMPTS) {
          const delayMs = persistenceRetryDelayMs(attempt);
          logger.warn('[Treasury] Fixed 90/10 profit persistence retry scheduled', {
            component: 'RetainedProfitLedger',
            eventId,
            attempt,
            maxAttempts: RETRY_ATTEMPTS,
            delayMs,
            idempotentEvent: true,
          });
          await sleep(delayMs);
        }
      } finally {
        client.release();
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'retained-profit persistence failed'));
  }

  private async ensureStore(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = withCryptaraSupabasePriority('high', async () => {
      const requirements = await pool.query(
        `SELECT
           to_regclass('private.cryptocrawler_rainbow_profit_events') IS NOT NULL AS event_table,
           to_regclass('public.cryptocrawler_terminal_sweep_control') IS NOT NULL AS control_table,
           to_regclass('public.cryptocrawler_profit_payout_jobs') IS NOT NULL AS payout_table,
           to_regclass('public.cryptocrawler_payout_asset_reservations') IS NOT NULL AS payout_reserve_table,
           to_regclass('public.cryptocrawler_operator_strategy_days') IS NOT NULL AS strategy_day_table,
           to_regclass('public.cryptocrawler_retained_exchange_allocations') IS NOT NULL AS retained_allocation_table,
           to_regprocedure('public.cryptocrawler_operator_strategy_record_profit(text,text,numeric)') IS NOT NULL AS strategy_profit_function`,
      );
      const row = requirements.rows[0] || {};
      if (
        row.event_table !== true || row.control_table !== true || row.payout_table !== true ||
        row.payout_reserve_table !== true || row.strategy_day_table !== true ||
        row.retained_allocation_table !== true || row.strategy_profit_function !== true
      ) {
        throw new Error('profit payout migrations 018-032 are required before fixed 90/10 terminal-profit capture');
      }
    }).catch(error => {
      this.ready = null;
      logger.warn('[Treasury] Fixed 90/10 profit persistence unavailable', {
        component: 'RetainedProfitLedger',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    return this.ready;
  }
}

export const retainedProfitLedger = new RetainedProfitLedger();
