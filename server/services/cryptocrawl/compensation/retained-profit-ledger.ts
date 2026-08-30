import { createHash } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';

const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();
const RETRY_ATTEMPTS = Math.max(1, Math.min(8, Number(process.env.CRYPTOCRAWL_RETAINED_PROFIT_RETRIES || 4)));
const RETRY_BASE_MS = Math.max(50, Math.min(5_000, Number(process.env.CRYPTOCRAWL_RETAINED_PROFIT_RETRY_BASE_MS || 250)));

function destinationFingerprint(): string {
  return DESTINATION
    ? createHash('sha256').update(DESTINATION.toLowerCase()).digest('hex').slice(0, 16)
    : 'unconfigured';
}

function realizedProfit(feedback: CryptaraExecutionFeedback): number | null {
  const value = Number(feedback.realizedProfitUsd ?? feedback.settlement?.realized.netProfitUsd);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Records terminally-settled profit without authorizing an external payout.
 * The event id is deterministic, so bounded retries are safe: the insert is
 * idempotent and retained_profit_usd is incremented only when a new event row is
 * inserted in the same transaction.
 */
class RetainedProfitLedger {
  private ready: Promise<void> | null = null;

  async recordTerminalSettlement(feedback: CryptaraExecutionFeedback): Promise<void> {
    if (!feedback.settlement || feedback.settlement.terminal !== true || feedback.settlement.settlementConfirmed !== true) return;
    if (feedback.success !== true) return;
    const realized = realizedProfit(feedback);
    if (realized === null || !isDatabaseConfigured) return;

    await this.ensureStore();
    const eventId = terminalFeedbackIdentity(feedback);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO private.cryptocrawler_rainbow_profit_events
            (event_id, opportunity_id, realized_profit_usd, status, destination_hash, created_at, updated_at)
           VALUES ($1, $2, $3, 'queued', $4, now(), now())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [eventId, feedback.opportunityId || null, realized, destinationFingerprint()],
        );
        if (inserted.rowCount === 1) {
          await client.query(
            `UPDATE public.cryptocrawler_terminal_sweep_control
             SET retained_profit_usd = retained_profit_usd + $1,
                 destination_address = COALESCE(NULLIF($2, ''), destination_address),
                 updated_at = now()
             WHERE system_key='cryptocrawler'`,
            [realized, DESTINATION],
          );
        }
        await client.query('COMMIT');
        return;
      } catch (error) {
        lastError = error;
        try { await client.query('ROLLBACK'); } catch { /* transaction may already be gone */ }
        if (attempt < RETRY_ATTEMPTS) {
          const delayMs = Math.min(10_000, RETRY_BASE_MS * (2 ** (attempt - 1)));
          logger.warn('[Treasury] Retained-profit persistence retry scheduled', {
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
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'retained-profit persistence failed'));
  }

  private async ensureStore(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await pool.query('CREATE SCHEMA IF NOT EXISTS private');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS private.cryptocrawler_rainbow_profit_events (
          event_id text PRIMARY KEY,
          opportunity_id text,
          realized_profit_usd numeric NOT NULL CHECK (realized_profit_usd > 0),
          status text NOT NULL CHECK (status IN ('queued','submitted','confirmed','failed')),
          batch_id text,
          client_id text,
          asset text,
          chain text,
          payout_amount numeric,
          payout_fee numeric,
          withdrawal_id text,
          transaction_hash text,
          destination_hash text NOT NULL,
          last_error text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          confirmed_at timestamptz
        )
      `);
      const control = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='cryptocrawler_terminal_sweep_control'`,
      );
      if (control.rowCount !== 1) {
        throw new Error('terminal sweep control migration 015 is required before retained-profit capture');
      }
    })().catch(error => {
      this.ready = null;
      logger.warn('[Treasury] Retained-profit persistence unavailable', {
        component: 'RetainedProfitLedger',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    return this.ready;
  }
}

export const retainedProfitLedger = new RetainedProfitLedger();
