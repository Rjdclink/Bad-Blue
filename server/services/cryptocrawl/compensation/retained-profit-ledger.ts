import { createHash, randomInt } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';

const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();
const FIXED_PAYOUT_FRACTION = 0.60;
const FIRST_FIXED_PAYOUTS = 3;
const FIXED_INTERVAL_MS = 60 * 60 * 1000;
const DYNAMIC_MIN_DELAY_MINUTES = 30;
const DYNAMIC_MAX_DELAY_MINUTES = 90;
const DYNAMIC_MIN_PAYOUT_BPS = 5_500;
const DYNAMIC_MAX_PAYOUT_BPS = 6_500;
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
  recorded: boolean;
}

interface PayoutInventorySource {
  venue: 'coinbase' | 'kraken' | 'okx';
  asset: 'USD' | 'USDC' | 'USDT';
  reservedAssetAmount: number;
}

interface StrategyDecision {
  sequence: number;
  payoutFraction: number;
  retainedFraction: number;
  scheduledNotBefore: number;
  delayMinutes: number;
  mode: 'fixed_first_three' | 'bounded_dynamic';
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

function splitProfit(realized: number, payoutFraction: number): { realized: number; payout: number; retained: number } {
  const normalized = Number(realized.toFixed(12));
  const boundedFraction = Math.max(0.55, Math.min(0.65, payoutFraction));
  const payout = Number((normalized * boundedFraction).toFixed(12));
  const retained = Number((normalized - payout).toFixed(12));
  if (!(normalized > 0) || !(payout > 0) || retained < 0 || Math.abs((payout + retained) - normalized) > 1e-9) {
    throw new Error('Invalid realized-profit payout allocation');
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
  return {
    ...unique[0],
    reservedAssetAmount: payoutUsd,
  };
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dynamicPayoutFraction(): number {
  return randomInt(DYNAMIC_MIN_PAYOUT_BPS, DYNAMIC_MAX_PAYOUT_BPS + 1) / 10_000;
}

function dynamicDelayMinutes(): number {
  return randomInt(DYNAMIC_MIN_DELAY_MINUTES, DYNAMIC_MAX_DELAY_MINUTES + 1);
}

async function allocateStrategyDecision(client: { query: (text: string, values?: unknown[]) => Promise<any> }): Promise<StrategyDecision> {
  const state = await client.query(
    `SELECT profitable_payout_sequence, last_profit_payout_scheduled_at
     FROM public.cryptocrawler_terminal_sweep_control
     WHERE system_key='cryptocrawler'
     FOR UPDATE`,
  );
  if (state.rowCount !== 1) throw new Error('Treasury control state unavailable for payout strategy allocation');

  const previousSequence = Number(state.rows[0]?.profitable_payout_sequence || 0);
  const sequence = previousSequence + 1;
  const fixed = sequence <= FIRST_FIXED_PAYOUTS;
  const payoutFraction = fixed ? FIXED_PAYOUT_FRACTION : dynamicPayoutFraction();
  const retainedFraction = Number((1 - payoutFraction).toFixed(8));
  const delayMinutes = fixed ? 60 : dynamicDelayMinutes();
  const now = Date.now();
  const previousScheduled = state.rows[0]?.last_profit_payout_scheduled_at
    ? new Date(state.rows[0].last_profit_payout_scheduled_at).getTime()
    : 0;
  const anchor = Math.max(now, Number.isFinite(previousScheduled) ? previousScheduled : 0);
  const scheduledNotBefore = anchor + delayMinutes * 60_000;

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
    payoutFraction,
    retainedFraction,
    scheduledNotBefore,
    delayMinutes,
    mode: fixed ? 'fixed_first_three' : 'bounded_dynamic',
  };
}

/**
 * Persists one terminal-confirmed profitable settlement exactly once and creates
 * its durable payout job in the same transaction.
 *
 * The payout decision is selected once and persisted. The first three profitable
 * settlements use a fixed 60/40 split and one-hour cadence. Later settlements use
 * a bounded 55-65% payout share and a bounded 30-90 minute strategy interval;
 * the retained share is always exactly the complement. Retry/restart never
 * re-rolls either choice.
 *
 * Payout capital is attached to the actual sell-side quote inventory when that
 * source is unambiguous and is excluded from NEW trade spendability. Existing
 * reservations are never cancelled or preempted. The retained share remains
 * ordinary operating capital for strategies, gas, fees and inventory needs.
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const existing = await client.query(
          `SELECT event_id, realized_profit_usd, payout_target_usd, retained_target_usd,
                  payout_fraction, retained_fraction, payout_sequence, scheduled_not_before,
                  source_venue, source_asset
           FROM public.cryptocrawler_profit_payout_jobs
           WHERE event_id=$1
           LIMIT 1`,
          [eventId],
        );
        if (existing.rowCount === 1) {
          await client.query('COMMIT');
          const row = existing.rows[0];
          return {
            eventId,
            realizedProfitUsd: Number(row.realized_profit_usd),
            payoutTargetUsd: Number(row.payout_target_usd),
            retainedTargetUsd: Number(row.retained_target_usd),
            payoutFraction: Number(row.payout_fraction),
            retainedFraction: Number(row.retained_fraction),
            payoutSequence: Number(row.payout_sequence),
            scheduledNotBefore: new Date(row.scheduled_not_before).getTime(),
            payoutSourceVenue: row.source_venue ? String(row.source_venue) : null,
            payoutSourceAsset: row.source_asset ? String(row.source_asset) : null,
            recorded: false,
          };
        }

        const decision = await allocateStrategyDecision(client);
        const allocation = splitProfit(realized, decision.payoutFraction);
        const payoutSource = payoutInventorySource(feedback, allocation.payout);

        const inserted = await client.query(
          `INSERT INTO private.cryptocrawler_rainbow_profit_events
            (event_id, opportunity_id, realized_profit_usd, payout_target_usd, retained_target_usd,
             payout_operating_cost_usd, status, destination_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, 'queued', $6, now(), now())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [eventId, feedback.opportunityId || null, allocation.realized, allocation.payout, allocation.retained, destinationHash],
        );

        if (inserted.rowCount !== 1) {
          throw new Error('Profit event appeared concurrently while payout strategy state was locked');
        }

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
            payoutSource?.venue || sourceVenue(feedback),
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
          `UPDATE public.cryptocrawler_terminal_sweep_control
           SET retained_profit_usd = retained_profit_usd + $1,
               destination_address = COALESCE(NULLIF($2, ''), destination_address),
               updated_at = now()
           WHERE system_key='cryptocrawler'`,
          [allocation.retained, DESTINATION],
        );

        await client.query('COMMIT');
        logger.info('[Treasury] Profit payout strategy persisted', {
          component: 'RetainedProfitLedger',
          eventId,
          payoutSequence: decision.sequence,
          strategyMode: decision.mode,
          payoutFraction: decision.payoutFraction,
          retainedFraction: decision.retainedFraction,
          delayMinutes: decision.delayMinutes,
          scheduledNotBefore: new Date(decision.scheduledNotBefore).toISOString(),
          payoutSourceVenue: payoutSource?.venue || sourceVenue(feedback),
          payoutSourceAsset: payoutSource?.asset || null,
          decisionReRolledOnRetry: false,
        });
        return {
          eventId,
          realizedProfitUsd: allocation.realized,
          payoutTargetUsd: allocation.payout,
          retainedTargetUsd: allocation.retained,
          payoutFraction: decision.payoutFraction,
          retainedFraction: decision.retainedFraction,
          payoutSequence: decision.sequence,
          scheduledNotBefore: decision.scheduledNotBefore,
          payoutSourceVenue: payoutSource?.venue || sourceVenue(feedback),
          payoutSourceAsset: payoutSource?.asset || null,
          recorded: true,
        };
      } catch (error) {
        lastError = error;
        try { await client.query('ROLLBACK'); } catch { /* transaction may already be gone */ }
        if (attempt < RETRY_ATTEMPTS) {
          const delayMs = Math.min(10_000, RETRY_BASE_MS * (2 ** (attempt - 1)));
          logger.warn('[Treasury] Profit-split persistence retry scheduled', {
            component: 'RetainedProfitLedger',
            eventId,
            attempt,
            maxAttempts: RETRY_ATTEMPTS,
            delayMs,
            idempotentEvent: true,
            externalPayoutAuthorized: false,
          });
          await sleep(delayMs);
        }
      } finally {
        client.release();
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'profit-split persistence failed'));
  }

  private async ensureStore(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const requirements = await pool.query(
        `SELECT
           to_regclass('private.cryptocrawler_rainbow_profit_events') IS NOT NULL AS event_table,
           to_regclass('public.cryptocrawler_terminal_sweep_control') IS NOT NULL AS control_table,
           to_regclass('public.cryptocrawler_profit_payout_jobs') IS NOT NULL AS payout_table,
           to_regclass('public.cryptocrawler_payout_asset_reservations') IS NOT NULL AS payout_reserve_table`,
      );
      const row = requirements.rows[0] || {};
      if (row.event_table !== true || row.control_table !== true || row.payout_table !== true || row.payout_reserve_table !== true) {
        throw new Error('profit split migrations 018 and 019 are required before realized-profit capture');
      }
    })().catch(error => {
      this.ready = null;
      logger.warn('[Treasury] Profit-split persistence unavailable', {
        component: 'RetainedProfitLedger',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    return this.ready;
  }
}

export const retainedProfitLedger = new RetainedProfitLedger();