import { randomUUID } from 'node:crypto';
import { isDatabaseConfigured, pool } from '../../../db.js';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';

export interface FundingExecutionPlan {
  opportunityId: string;
  venue: 'okx' | 'kraken';
  symbol: string;
  notionalUsd: number;
  expectedNetProfitUsd: number;
  expectedEntryCostUsd: number;
  expectedExitCostUsd: number;
  expectedFundingUsd: number;
  marginBufferUsd: number;
  fundingTimestamp: number;
  expiresAt: number;
  provenance: string[];
}

export interface FundingOpenReceipt {
  lifecycleId: string;
  spotOrderId: string;
  perpOrderId: string;
  openedAt: number;
  deltaNeutral: boolean;
  measuredSpotQuantity: number;
  measuredPerpQuantity: number;
}

export interface FundingTerminalSettlement {
  lifecycleId: string;
  terminal: boolean;
  settlementConfirmed: boolean;
  spotClosed: boolean;
  perpClosed: boolean;
  fundingPaymentUsd: number | null;
  realizedEntryExitPnlUsd: number | null;
  realizedFeesUsd: number | null;
  realizedNetProfitUsd: number | null;
  settledAt: number | null;
  provenance: string[];
  error?: string;
}

export interface FundingLifecycleAdapter {
  venue: FundingExecutionPlan['venue'];
  verifyCurrentPlan(plan: FundingExecutionPlan): Promise<boolean>;
  openDeltaNeutral(plan: FundingExecutionPlan, lifecycleId: string): Promise<FundingOpenReceipt>;
  marginHealthy(receipt: FundingOpenReceipt): Promise<boolean>;
  closeAndSettle(plan: FundingExecutionPlan, receipt: FundingOpenReceipt): Promise<FundingTerminalSettlement>;
}

export interface FundingLifecycleResult {
  success: boolean;
  settlementConfirmed: boolean;
  status: 'rejected' | 'opened' | 'closed' | 'failed' | 'settlement_unknown';
  lifecycleId?: string;
  settlement?: FundingTerminalSettlement;
  error?: string;
}

type StoredLifecycle = {
  lifecycleId: string;
  plan: FundingExecutionPlan;
  status: string;
  receipt: FundingOpenReceipt | null;
  settlement: FundingTerminalSettlement | null;
  lastError: string | null;
};

const TABLE = 'private.cryptocrawler_funding_lifecycles';

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function fundingStoreReadyTtlMs(): number {
  return bounded(process.env.CRYPTOCRAWL_FUNDING_TABLE_READY_TTL_MS, 300_000, 30_000, 900_000);
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  try { return JSON.parse(String(raw)) as T; } catch { return null; }
}

class FundingPositionLifecycle {
  private readonly adapters = new Map<FundingExecutionPlan['venue'], FundingLifecycleAdapter>();
  private tableProbeInFlight: Promise<boolean> | null = null;
  private tableReadyUntil = 0;
  private tableRetryAfter = 0;
  private advancing = new Set<string>();

  registerAdapter(adapter: FundingLifecycleAdapter): void {
    this.adapters.set(adapter.venue, adapter);
  }

  getRegisteredVenues(): FundingExecutionPlan['venue'][] {
    return [...this.adapters.keys()];
  }

  /** Reuse startup's exact schema proof instead of paying another readiness query. */
  primeStoreReady(ttlMs = fundingStoreReadyTtlMs()): void {
    const boundedTtlMs = bounded(ttlMs, fundingStoreReadyTtlMs(), 30_000, 900_000);
    this.tableReadyUntil = Math.max(this.tableReadyUntil, Date.now() + boundedTtlMs);
    this.tableRetryAfter = 0;
  }

  /**
   * Open a funding lifecycle and return immediately after terminal entry fills are
   * proven delta-neutral. Holding/margin monitoring/close settlement is advanced
   * by later canonical scheduler ticks via advanceOpenLifecycles(). The scheduler
   * therefore never sleeps through a funding window.
   */
  async execute(plan: FundingExecutionPlan): Promise<FundingLifecycleResult> {
    const rejection = this.validate(plan);
    if (rejection) return { success: false, settlementConfirmed: false, status: 'rejected', error: rejection };
    const adapter = this.adapters.get(plan.venue);
    if (!adapter) return { success: false, settlementConfirmed: false, status: 'rejected', error: 'REJECT_FUNDING_LIFECYCLE_ADAPTER_UNAVAILABLE' };
    if (!await adapter.verifyCurrentPlan(plan)) {
      return { success: false, settlementConfirmed: false, status: 'rejected', error: 'REJECT_FUNDING_PLAN_NO_LONGER_CURRENT' };
    }

    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: `cex:${plan.venue}` });
    if (!await this.ensureStore()) {
      return { success: false, settlementConfirmed: false, status: 'rejected', error: 'REJECT_FUNDING_LIFECYCLE_STORE_UNAVAILABLE' };
    }

    // The partial unique index on active opportunity_id is the concurrency
    // authority. Healthy opens now cost one DB statement instead of a pre-read
    // plus insert. Only the rare conflict path performs a read to return the
    // already-active lifecycle to the caller.
    const lifecycleId = `funding:${randomUUID()}`;
    const inserted = await this.insertOpeningIfAbsent(lifecycleId, plan);
    if (!inserted) {
      const existing = await this.findActiveByOpportunity(plan.opportunityId);
      if (existing) {
        return {
          success: existing.status === 'open',
          settlementConfirmed: false,
          status: existing.status === 'failed' ? 'failed' : 'opened',
          lifecycleId: existing.lifecycleId,
          error: existing.status === 'open' ? undefined : 'FUNDING_OPPORTUNITY_ALREADY_ACTIVE',
        };
      }
      return {
        success: false,
        settlementConfirmed: false,
        status: 'rejected',
        error: 'FUNDING_OPPORTUNITY_ALREADY_ACTIVE',
      };
    }

    let receipt: FundingOpenReceipt;
    try {
      receipt = await adapter.openDeltaNeutral(plan, lifecycleId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persist(lifecycleId, plan, 'failed', message);
      return { success: false, settlementConfirmed: false, status: 'failed', lifecycleId, error: 'FUNDING_OPEN_FAILED' };
    }
    if (!receipt.deltaNeutral || !(receipt.measuredSpotQuantity > 0) || !(receipt.measuredPerpQuantity > 0)) {
      await this.persist(lifecycleId, plan, 'failed', 'opened legs are not proven delta-neutral', receipt);
      return { success: false, settlementConfirmed: false, status: 'failed', lifecycleId, error: 'FUNDING_DELTA_NEUTRALITY_UNPROVEN' };
    }
    await this.persist(lifecycleId, plan, 'open', null, receipt);
    logger.info('[FundingLifecycle] Delta-neutral position opened; lifecycle delegated to scheduler ticks', {
      component: 'FundingPositionLifecycle',
      lifecycleId,
      venue: plan.venue,
      symbol: plan.symbol,
      fundingTimestamp: plan.fundingTimestamp,
      blockingWait: false,
      durableState: true,
    });
    return { success: true, settlementConfirmed: false, status: 'opened', lifecycleId };
  }

  async advanceOpenLifecycles(limit = 4): Promise<FundingLifecycleResult[]> {
    if (!await this.ensureStore()) return [];
    const rows = await pool.query(
      `SELECT lifecycle_id, plan, status, open_receipt, terminal_settlement, last_error
       FROM ${TABLE}
       WHERE status IN ('open','closing','settlement_unknown')
       ORDER BY updated_at ASC
       LIMIT $1`,
      [bounded(limit, 4, 1, 32)],
    );
    const results: FundingLifecycleResult[] = [];
    for (const row of rows.rows) {
      const lifecycleId = String(row.lifecycle_id || '');
      if (!lifecycleId || this.advancing.has(lifecycleId)) continue;
      this.advancing.add(lifecycleId);
      try {
        const result = await this.advanceStored({
          lifecycleId,
          plan: parseJson<FundingExecutionPlan>(row.plan)!,
          status: String(row.status || ''),
          receipt: parseJson<FundingOpenReceipt>(row.open_receipt),
          settlement: parseJson<FundingTerminalSettlement>(row.terminal_settlement),
          lastError: row.last_error ? String(row.last_error) : null,
        });
        results.push(result);
      } finally {
        this.advancing.delete(lifecycleId);
      }
    }
    return results;
  }

  private async advanceStored(stored: StoredLifecycle): Promise<FundingLifecycleResult> {
    const { lifecycleId, plan, receipt } = stored;
    if (!plan || !receipt) {
      return { success: false, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId, error: 'FUNDING_DURABLE_STATE_INCOMPLETE' };
    }
    const adapter = this.adapters.get(plan.venue);
    if (!adapter) {
      return { success: false, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId, error: 'FUNDING_LIFECYCLE_ADAPTER_UNAVAILABLE' };
    }

    const maxHoldMs = bounded(process.env.CRYPTOCRAWL_FUNDING_MAX_HOLD_MS, 8 * 60 * 60_000, 60_000, 24 * 60 * 60_000);
    const postPaymentHoldMs = bounded(process.env.CRYPTOCRAWL_FUNDING_POST_PAYMENT_HOLD_MS, 30_000, 0, 5 * 60_000);
    const normalCloseAt = Math.min(plan.fundingTimestamp + postPaymentHoldMs, receipt.openedAt + maxHoldMs);
    const healthy = await adapter.marginHealthy(receipt).catch(() => false);
    if (healthy && Date.now() < normalCloseAt && stored.status !== 'closing') {
      return { success: true, settlementConfirmed: false, status: 'opened', lifecycleId };
    }

    const closeReason = healthy ? 'funding_window_complete' : 'margin_health_exit';
    await this.persist(lifecycleId, plan, 'closing', closeReason, receipt);
    let settlement: FundingTerminalSettlement;
    try {
      settlement = await adapter.closeAndSettle(plan, receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persist(lifecycleId, plan, 'settlement_unknown', message, receipt);
      return { success: false, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId, error: 'FUNDING_CLOSE_SETTLEMENT_FAILED' };
    }

    const confirmed = settlement.terminal
      && settlement.settlementConfirmed
      && settlement.spotClosed
      && settlement.perpClosed
      && settlement.fundingPaymentUsd !== null
      && settlement.realizedEntryExitPnlUsd !== null
      && settlement.realizedFeesUsd !== null
      && settlement.realizedNetProfitUsd !== null
      && Number.isFinite(settlement.realizedNetProfitUsd);
    await this.persist(lifecycleId, plan, confirmed ? 'closed' : 'settlement_unknown', settlement.error || null, receipt, settlement);
    logger.info('[FundingLifecycle] Terminal funding lifecycle result', {
      component: 'FundingPositionLifecycle',
      lifecycleId,
      venue: plan.venue,
      symbol: plan.symbol,
      closeReason,
      settlementConfirmed: confirmed,
      realizedNetProfitUsd: settlement.realizedNetProfitUsd,
    });
    return {
      success: confirmed && (settlement.realizedNetProfitUsd ?? Number.NEGATIVE_INFINITY) > 0,
      settlementConfirmed: confirmed,
      status: confirmed ? 'closed' : 'settlement_unknown',
      lifecycleId,
      settlement,
      error: confirmed ? undefined : settlement.error || 'FUNDING_TERMINAL_SETTLEMENT_INCOMPLETE',
    };
  }

  private validate(plan: FundingExecutionPlan): string | null {
    if (!(plan.notionalUsd > 0) || !Number.isFinite(plan.notionalUsd)) return 'REJECT_FUNDING_NOTIONAL';
    if (!(plan.expectedNetProfitUsd > 0) || !Number.isFinite(plan.expectedNetProfitUsd)) return 'REJECT_FUNDING_NONPOSITIVE_NET';
    if (![plan.expectedEntryCostUsd, plan.expectedExitCostUsd, plan.expectedFundingUsd, plan.marginBufferUsd].every(Number.isFinite)) return 'REJECT_FUNDING_ECONOMICS_INCOMPLETE';
    if (!(plan.marginBufferUsd > 0)) return 'REJECT_FUNDING_MARGIN_BUFFER';
    if (!Number.isFinite(plan.fundingTimestamp) || plan.fundingTimestamp <= Date.now()) return 'REJECT_FUNDING_TIMESTAMP';
    if (!Number.isFinite(plan.expiresAt) || plan.expiresAt <= Date.now()) return 'REJECT_FUNDING_EXPIRED';
    return null;
  }

  private async ensureStore(): Promise<boolean> {
    if (!isDatabaseConfigured) return false;
    const now = Date.now();
    if (this.tableReadyUntil > now) return true;
    if (now < this.tableRetryAfter) return false;
    if (this.tableProbeInFlight) return this.tableProbeInFlight;
    const readyTtlMs = fundingStoreReadyTtlMs();
    const retryMs = bounded(process.env.CRYPTOCRAWL_FUNDING_TABLE_RETRY_MS, 5_000, 1_000, 60_000);
    const probe = pool.query(`SELECT to_regclass('${TABLE}') IS NOT NULL AS ready`)
      .then(result => {
        const ready = result.rows?.[0]?.ready === true;
        if (ready) {
          this.tableReadyUntil = Date.now() + readyTtlMs;
          this.tableRetryAfter = 0;
        } else {
          this.tableReadyUntil = 0;
          this.tableRetryAfter = Date.now() + retryMs;
          logger.error('[FundingLifecycle] Migration-owned lifecycle table is missing', {
            component: 'FundingPositionLifecycle',
            table: TABLE,
            runtimeDdlAllowed: false,
            executionAuthorityGranted: false,
          });
        }
        return ready;
      })
      .catch(error => {
        this.tableReadyUntil = 0;
        this.tableRetryAfter = Date.now() + retryMs;
        logger.warn('[FundingLifecycle] Lifecycle-store verification failed closed', {
          component: 'FundingPositionLifecycle',
          retryAfterMs: retryMs,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      })
      .finally(() => {
        if (this.tableProbeInFlight === probe) this.tableProbeInFlight = null;
      });
    this.tableProbeInFlight = probe;
    return probe;
  }

  private async insertOpeningIfAbsent(lifecycleId: string, plan: FundingExecutionPlan): Promise<boolean> {
    const result = await pool.query(
      `INSERT INTO ${TABLE}
        (lifecycle_id, opportunity_id, venue, symbol, status, expected_net_profit_usd, plan, last_error, updated_at)
       VALUES ($1,$2,$3,$4,'opening',$5,$6::jsonb,NULL,now())
       ON CONFLICT DO NOTHING
       RETURNING lifecycle_id`,
      [
        lifecycleId,
        plan.opportunityId,
        plan.venue,
        plan.symbol,
        plan.expectedNetProfitUsd,
        JSON.stringify(plan),
      ],
    );
    return result.rowCount === 1;
  }

  private async findActiveByOpportunity(opportunityId: string): Promise<StoredLifecycle | null> {
    const result = await pool.query(
      `SELECT lifecycle_id, plan, status, open_receipt, terminal_settlement, last_error
       FROM ${TABLE}
       WHERE opportunity_id = $1 AND status IN ('opening','open','closing','settlement_unknown')
       ORDER BY updated_at DESC LIMIT 1`,
      [opportunityId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    const plan = parseJson<FundingExecutionPlan>(row.plan);
    if (!plan) return null;
    return {
      lifecycleId: String(row.lifecycle_id),
      plan,
      status: String(row.status),
      receipt: parseJson<FundingOpenReceipt>(row.open_receipt),
      settlement: parseJson<FundingTerminalSettlement>(row.terminal_settlement),
      lastError: row.last_error ? String(row.last_error) : null,
    };
  }

  private async persist(
    lifecycleId: string,
    plan: FundingExecutionPlan,
    status: string,
    error: string | null,
    receipt?: FundingOpenReceipt,
    settlement?: FundingTerminalSettlement,
  ): Promise<void> {
    await pool.query(`INSERT INTO ${TABLE}
      (lifecycle_id, opportunity_id, venue, symbol, status, expected_net_profit_usd, plan, open_receipt, terminal_settlement, last_error, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,now())
      ON CONFLICT (lifecycle_id) DO UPDATE SET status=EXCLUDED.status, open_receipt=EXCLUDED.open_receipt,
        terminal_settlement=EXCLUDED.terminal_settlement, last_error=EXCLUDED.last_error, updated_at=now()`, [
      lifecycleId, plan.opportunityId, plan.venue, plan.symbol, status, plan.expectedNetProfitUsd,
      JSON.stringify(plan), receipt ? JSON.stringify(receipt) : null, settlement ? JSON.stringify(settlement) : null, error,
    ]);
  }
}

const fundingPositionLifecycleSingleton = new FundingPositionLifecycle();

/** Startup migration verification already proved this exact table exists. */
export function primeFundingLifecycleStoreReady(ttlMs = fundingStoreReadyTtlMs()): void {
  fundingPositionLifecycleSingleton.primeStoreReady(ttlMs);
}

export const fundingPositionLifecycle = fundingPositionLifecycleSingleton;
