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

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

class FundingPositionLifecycle {
  private readonly adapters = new Map<FundingExecutionPlan['venue'], FundingLifecycleAdapter>();
  private ready: Promise<void> | null = null;

  registerAdapter(adapter: FundingLifecycleAdapter): void {
    this.adapters.set(adapter.venue, adapter);
  }

  getRegisteredVenues(): FundingExecutionPlan['venue'][] {
    return [...this.adapters.keys()];
  }

  async execute(plan: FundingExecutionPlan): Promise<FundingLifecycleResult> {
    const rejection = this.validate(plan);
    if (rejection) return { success: false, settlementConfirmed: false, status: 'rejected', error: rejection };
    const adapter = this.adapters.get(plan.venue);
    if (!adapter) return { success: false, settlementConfirmed: false, status: 'rejected', error: 'REJECT_FUNDING_LIFECYCLE_ADAPTER_UNAVAILABLE' };
    if (!await adapter.verifyCurrentPlan(plan)) {
      return { success: false, settlementConfirmed: false, status: 'rejected', error: 'REJECT_FUNDING_PLAN_NO_LONGER_CURRENT' };
    }

    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: `cex:${plan.venue}` });
    await this.ensureStore();
    const lifecycleId = `funding:${randomUUID()}`;
    await this.persist(lifecycleId, plan, 'opening', null);

    let receipt: FundingOpenReceipt;
    try {
      receipt = await adapter.openDeltaNeutral(plan, lifecycleId);
    } catch (error) {
      await this.persist(lifecycleId, plan, 'failed', error instanceof Error ? error.message : String(error));
      return { success: false, settlementConfirmed: false, status: 'failed', lifecycleId, error: 'FUNDING_OPEN_FAILED' };
    }
    if (!receipt.deltaNeutral || !(receipt.measuredSpotQuantity > 0) || !(receipt.measuredPerpQuantity > 0)) {
      await this.persist(lifecycleId, plan, 'failed', 'opened legs are not proven delta-neutral');
      return { success: false, settlementConfirmed: false, status: 'failed', lifecycleId, error: 'FUNDING_DELTA_NEUTRALITY_UNPROVEN' };
    }
    await this.persist(lifecycleId, plan, 'open', null, receipt);

    const maxHoldMs = bounded(process.env.CRYPTOCRAWL_FUNDING_MAX_HOLD_MS, 8 * 60 * 60_000, 60_000, 24 * 60 * 60_000);
    const marginPollMs = bounded(process.env.CRYPTOCRAWL_FUNDING_MARGIN_POLL_MS, 5_000, 1_000, 60_000);
    const normalCloseAt = Math.min(plan.fundingTimestamp + bounded(process.env.CRYPTOCRAWL_FUNDING_POST_PAYMENT_HOLD_MS, 30_000, 0, 5 * 60_000), receipt.openedAt + maxHoldMs);
    let closeReason = 'funding_window_complete';
    while (Date.now() < normalCloseAt) {
      const healthy = await adapter.marginHealthy(receipt).catch(() => false);
      if (!healthy) {
        closeReason = 'margin_health_exit';
        break;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(marginPollMs, Math.max(0, normalCloseAt - Date.now()))));
    }

    await this.persist(lifecycleId, plan, 'closing', closeReason, receipt);
    let settlement: FundingTerminalSettlement;
    try {
      settlement = await adapter.closeAndSettle(plan, receipt);
    } catch (error) {
      await this.persist(lifecycleId, plan, 'settlement_unknown', error instanceof Error ? error.message : String(error), receipt);
      return { success: false, settlementConfirmed: false, status: 'settlement_unknown', lifecycleId, error: 'FUNDING_CLOSE_SETTLEMENT_FAILED' };
    }

    const confirmed = settlement.terminal
      && settlement.settlementConfirmed
      && settlement.spotClosed
      && settlement.perpClosed
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

  private async ensureStore(): Promise<void> {
    if (!isDatabaseConfigured) throw new Error('Funding lifecycle requires durable PostgreSQL state');
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await pool.query('CREATE SCHEMA IF NOT EXISTS private');
      await pool.query(`CREATE TABLE IF NOT EXISTS private.cryptocrawler_funding_lifecycles (
        lifecycle_id text PRIMARY KEY,
        opportunity_id text NOT NULL,
        venue text NOT NULL,
        symbol text NOT NULL,
        status text NOT NULL,
        expected_net_profit_usd numeric NOT NULL,
        plan jsonb NOT NULL,
        open_receipt jsonb,
        terminal_settlement jsonb,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    })().catch(error => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async persist(
    lifecycleId: string,
    plan: FundingExecutionPlan,
    status: string,
    error: string | null,
    receipt?: FundingOpenReceipt,
    settlement?: FundingTerminalSettlement,
  ): Promise<void> {
    await pool.query(`INSERT INTO private.cryptocrawler_funding_lifecycles
      (lifecycle_id, opportunity_id, venue, symbol, status, expected_net_profit_usd, plan, open_receipt, terminal_settlement, last_error, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,now())
      ON CONFLICT (lifecycle_id) DO UPDATE SET status=EXCLUDED.status, open_receipt=EXCLUDED.open_receipt,
        terminal_settlement=EXCLUDED.terminal_settlement, last_error=EXCLUDED.last_error, updated_at=now()`, [
      lifecycleId, plan.opportunityId, plan.venue, plan.symbol, status, plan.expectedNetProfitUsd,
      JSON.stringify(plan), receipt ? JSON.stringify(receipt) : null, settlement ? JSON.stringify(settlement) : null, error,
    ]);
  }
}

export const fundingPositionLifecycle = new FundingPositionLifecycle();
