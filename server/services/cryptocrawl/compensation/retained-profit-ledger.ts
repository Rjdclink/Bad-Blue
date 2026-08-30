import { createHash } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';

const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();
const PAYOUT_FRACTION = 0.60;
const RETAINED_FRACTION = 0.40;
const retryAttemptsRaw = Number(process.env.CRYPTOCRAWL_RETAINED_PROFIT_RETRIES || 4);
const retryBaseMsRaw = Number(process.env.CRYPTOCRAWL_RETAINED_PROFIT_RETRY_BASE_MS || 250);
const RETRY_ATTEMPTS = Number.isFinite(retryAttemptsRaw) ? Math.max(1, Math.min(8, Math.trunc(retryAttemptsRaw))) : 4;
const RETRY_BASE_MS = Number.isFinite(retryBaseMsRaw) ? Math.max(50, Math.min(5_000, Math.trunc(retryBaseMsRaw))) : 250;

export interface ProfitSplitAllocation {
  eventId: string;
  realizedProfitUsd: number;
  payoutTargetUsd: number;
  retainedTargetUsd: number;
  payoutSourceVenue: string | null;
  payoutSourceAsset: string | null;
  recorded: boolean;
}

interface PayoutInventorySource {
  venue: 'coinbase' | 'kraken' | 'okx';
  asset: 'USD' | 'USDC' | 'USDT';
  reservedAssetAmount: number;
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

function splitProfit(realized: number): { realized: number; payout: number; retained: number } {
  const normalized = Number(realized.toFixed(12));
  const payout = Number((normalized * PAYOUT_FRACTION).toFixed(12));
  const retained = Number((normalized - payout).toFixed(12));
  if (!(normalized > 0) || !(payout > 0) || retained < 0 || Math.abs((payout + retained) - normalized) > 1e-9) {
    throw new Error('Invalid 60/40 realized-profit allocation');
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
    // Current canonical CEX quote assets are USD-pegged/fiat USD, so the
    // terminal-realized USD payout obligation maps one-for-one to the quote
    // inventory generated on the sell side. Unknown/non-USD quote sources are
    // deliberately not guessed.
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

/**
 * Persists one terminal-confirmed profitable settlement exactly once and creates
 * its durable payout job in the same database transaction.
 *
 * 60% is payout capital. For canonical USD-quoted CEX settlements it is attached
 * to the actual sell-side venue/quote inventory and excluded from NEW trade
 * spendability until paid. 40% remains ordinary operating capital and is not
 * inventory-reserved, so strategies, gas and fees can keep using it.
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
    const allocation = splitProfit(realized);
    const payoutSource = payoutInventorySource(feedback, allocation.payout);
    const destinationHash = destinationFingerprint();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO private.cryptocrawler_rainbow_profit_events
            (event_id, opportunity_id, realized_profit_usd, payout_target_usd, retained_target_usd,
             payout_operating_cost_usd, status, destination_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 0, 'queued', $6, now(), now())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [eventId, feedback.opportunityId || null, allocation.realized, allocation.payout, allocation.retained, destinationHash],
        );

        if (inserted.rowCount === 1) {
          await client.query(
            `INSERT INTO public.cryptocrawler_profit_payout_jobs
              (event_id, opportunity_id, realized_profit_usd, payout_target_usd, retained_target_usd,
               payout_asset, payout_network, status, source_venue, source_asset, destination_hash, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,'ETH','ethereum','QUEUED',$6,$7,$8,now(),now())`,
            [
              eventId,
              feedback.opportunityId || null,
              allocation.realized,
              allocation.payout,
              allocation.retained,
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
        }

        await client.query('COMMIT');
        return {
          eventId,
          realizedProfitUsd: allocation.realized,
          payoutTargetUsd: allocation.payout,
          retainedTargetUsd: allocation.retained,
          payoutSourceVenue: payoutSource?.venue || sourceVenue(feedback),
          payoutSourceAsset: payoutSource?.asset || null,
          recorded: inserted.rowCount === 1,
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
            payoutFraction: PAYOUT_FRACTION,
            retainedFraction: RETAINED_FRACTION,
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
        throw new Error('profit split migration 018 is required before realized-profit capture');
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
