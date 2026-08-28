import { createHash } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';

export interface RainbowProfitSnapshot {
  observedAt: number;
  queuedProfitUsd: number;
  submittedProfitUsd: number;
  confirmedProfitUsd: number;
  queuedEvents: number;
  submittedEvents: number;
  confirmedEvents: number;
  oldestQueuedAgeMs: number | null;
  confirmedWithdrawalFees: number;
  lastConfirmedTransactionHash: string | null;
  destinationFingerprint: string | null;
}

const INTERVAL_MS = boundedEnv('CRYPTO_RAINBOW_OBSERVABILITY_INTERVAL_MS', 60_000, 15_000, 3_600_000);
const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function destinationFingerprint(): string | null {
  if (!DESTINATION) return null;
  return createHash('sha256').update(DESTINATION.toLowerCase()).digest('hex').slice(0, 16);
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

class RainbowProfitObservability {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<RainbowProfitSnapshot | null> | null = null;
  private latest: RainbowProfitSnapshot | null = null;
  private lastSignature = '';

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getLatest(): RainbowProfitSnapshot | null {
    return this.latest ? { ...this.latest } : null;
  }

  async refresh(): Promise<RainbowProfitSnapshot | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refreshOnce().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async refreshOnce(): Promise<RainbowProfitSnapshot | null> {
    if (!isDatabaseConfigured) return null;
    try {
      const [states, fees, latestTx] = await Promise.all([
        pool.query(`
          SELECT status,
                 COUNT(*)::int AS events,
                 COALESCE(SUM(realized_profit_usd), 0)::numeric AS profit_usd,
                 MIN(created_at) AS oldest_created_at
          FROM private.cryptocrawler_rainbow_profit_events
          GROUP BY status
        `),
        pool.query(`
          SELECT COALESCE(SUM(batch_fee), 0)::numeric AS confirmed_fees
          FROM (
            SELECT batch_id, MAX(payout_fee)::numeric AS batch_fee
            FROM private.cryptocrawler_rainbow_profit_events
            WHERE status='confirmed' AND batch_id IS NOT NULL AND payout_fee IS NOT NULL
            GROUP BY batch_id
          ) batches
        `),
        pool.query(`
          SELECT transaction_hash
          FROM private.cryptocrawler_rainbow_profit_events
          WHERE status='confirmed' AND transaction_hash IS NOT NULL AND transaction_hash <> ''
          ORDER BY confirmed_at DESC NULLS LAST, updated_at DESC
          LIMIT 1
        `),
      ]);

      const byStatus = new Map<string, { events: number; profitUsd: number; oldest: number | null }>();
      for (const row of states.rows) {
        const oldest = row.oldest_created_at ? new Date(row.oldest_created_at).getTime() : null;
        byStatus.set(String(row.status), {
          events: numeric(row.events),
          profitUsd: numeric(row.profit_usd),
          oldest: Number.isFinite(oldest) ? oldest : null,
        });
      }
      const queued = byStatus.get('queued') || { events: 0, profitUsd: 0, oldest: null };
      const submitted = byStatus.get('submitted') || { events: 0, profitUsd: 0, oldest: null };
      const confirmed = byStatus.get('confirmed') || { events: 0, profitUsd: 0, oldest: null };
      const observedAt = Date.now();
      const snapshot: RainbowProfitSnapshot = {
        observedAt,
        queuedProfitUsd: queued.profitUsd,
        submittedProfitUsd: submitted.profitUsd,
        confirmedProfitUsd: confirmed.profitUsd,
        queuedEvents: queued.events,
        submittedEvents: submitted.events,
        confirmedEvents: confirmed.events,
        oldestQueuedAgeMs: queued.oldest === null ? null : Math.max(0, observedAt - queued.oldest),
        confirmedWithdrawalFees: numeric(fees.rows[0]?.confirmed_fees),
        lastConfirmedTransactionHash: latestTx.rows[0]?.transaction_hash ? String(latestTx.rows[0].transaction_hash) : null,
        destinationFingerprint: destinationFingerprint(),
      };
      this.latest = snapshot;

      const signature = JSON.stringify({
        queuedProfitUsd: snapshot.queuedProfitUsd,
        submittedProfitUsd: snapshot.submittedProfitUsd,
        confirmedProfitUsd: snapshot.confirmedProfitUsd,
        queuedEvents: snapshot.queuedEvents,
        submittedEvents: snapshot.submittedEvents,
        confirmedEvents: snapshot.confirmedEvents,
        confirmedWithdrawalFees: snapshot.confirmedWithdrawalFees,
        lastConfirmedTransactionHash: snapshot.lastConfirmedTransactionHash,
      });
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        logger.info('[RainbowBridge] Profit lifecycle snapshot', {
          component: 'RainbowProfitObservability',
          ...snapshot,
          lastConfirmedTransactionHash: snapshot.lastConfirmedTransactionHash
            ? `${snapshot.lastConfirmedTransactionHash.slice(0, 10)}...`
            : null,
        });
      }
      return { ...snapshot };
    } catch (error) {
      // Table creation belongs to the bridge itself. During first startup the
      // observer may run before that initialization completes; retry next cycle.
      logger.debug('[RainbowBridge] Profit lifecycle snapshot deferred', {
        component: 'RainbowProfitObservability',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export const rainbowProfitObservability = new RainbowProfitObservability();
