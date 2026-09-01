import { createHash } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';
import {
  getCryptaraSupabaseCompSwitchSnapshot,
  refreshCryptaraSupabaseCompSwitch,
} from '../integration/cryptara-supabase-comp-switch.js';

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
  private running = false;
  private inFlight: Promise<RainbowProfitSnapshot | null> | null = null;
  private latest: RainbowProfitSnapshot | null = null;
  private lastSignature = '';

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refreshAndSchedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
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

  private async refreshAndSchedule(): Promise<void> {
    try {
      // Switch state is refreshed from already-measured DB-admission telemetry;
      // this does not issue another Supabase query. The snapshot query below then
      // follows the normal or comp cadence selected by Cryptara.
      await refreshCryptaraSupabaseCompSwitch().catch(() => getCryptaraSupabaseCompSwitchSnapshot());
      await this.refresh();
    } finally {
      if (!this.running) return;
      // One-shot scheduling prevents overlap/drift when Supabase is slow. Comp
      // mode makes observability less chatty without changing any payout/treasury
      // or execution-critical cadence.
      const policy = getCryptaraSupabaseCompSwitchSnapshot().policy;
      const delayMs = Math.min(3_600_000, Math.max(INTERVAL_MS, Math.floor(INTERVAL_MS * policy.observabilityMultiplier)));
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.refreshAndSchedule();
      }, delayMs);
      this.timer.unref?.();
    }
  }

  private async refreshOnce(): Promise<RainbowProfitSnapshot | null> {
    if (!isDatabaseConfigured) return null;
    try {
      // This used to issue three concurrent queries every refresh. Collapse the
      // same snapshot into one SQL round trip and classify it as low-priority
      // observability so governance/settlement persistence always wins pressure.
      const result = await withCryptaraSupabasePriority('low', () => pool.query(`
        WITH summary AS (
          SELECT
            COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_events,
            COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_events,
            COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_events,
            COALESCE(SUM(realized_profit_usd) FILTER (WHERE status = 'queued'), 0)::numeric AS queued_profit_usd,
            COALESCE(SUM(realized_profit_usd) FILTER (WHERE status = 'submitted'), 0)::numeric AS submitted_profit_usd,
            COALESCE(SUM(realized_profit_usd) FILTER (WHERE status = 'confirmed'), 0)::numeric AS confirmed_profit_usd,
            MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
          FROM private.cryptocrawler_rainbow_profit_events
        ),
        fees AS (
          SELECT COALESCE(SUM(batch_fee), 0)::numeric AS confirmed_fees
          FROM (
            SELECT batch_id, MAX(payout_fee)::numeric AS batch_fee
            FROM private.cryptocrawler_rainbow_profit_events
            WHERE status = 'confirmed' AND batch_id IS NOT NULL AND payout_fee IS NOT NULL
            GROUP BY batch_id
          ) batches
        ),
        latest AS (
          SELECT transaction_hash
          FROM private.cryptocrawler_rainbow_profit_events
          WHERE status = 'confirmed' AND transaction_hash IS NOT NULL AND transaction_hash <> ''
          ORDER BY confirmed_at DESC NULLS LAST, updated_at DESC
          LIMIT 1
        )
        SELECT summary.*, fees.confirmed_fees, latest.transaction_hash
        FROM summary
        CROSS JOIN fees
        LEFT JOIN latest ON true
      `));

      const row = result.rows[0] || {};
      const oldest = row.oldest_queued_at ? new Date(row.oldest_queued_at).getTime() : null;
      const observedAt = Date.now();
      const snapshot: RainbowProfitSnapshot = {
        observedAt,
        queuedProfitUsd: numeric(row.queued_profit_usd),
        submittedProfitUsd: numeric(row.submitted_profit_usd),
        confirmedProfitUsd: numeric(row.confirmed_profit_usd),
        queuedEvents: numeric(row.queued_events),
        submittedEvents: numeric(row.submitted_events),
        confirmedEvents: numeric(row.confirmed_events),
        oldestQueuedAgeMs: Number.isFinite(oldest) ? Math.max(0, observedAt - (oldest as number)) : null,
        confirmedWithdrawalFees: numeric(row.confirmed_fees),
        lastConfirmedTransactionHash: row.transaction_hash ? String(row.transaction_hash) : null,
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
