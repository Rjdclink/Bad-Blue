import logger from '../../../logger.js';
import {
  canonicalOpportunityState,
  type CanonicalOpportunitySnapshot,
} from '../intelligence/canonical-opportunity-state.js';

export type RuntimeInvariantCode =
  | 'eligible_missing_plan'
  | 'eligible_non_positive_economics'
  | 'eligible_stale_quote'
  | 'realized_before_terminal_settlement'
  | 'settled_without_terminal_confirmation';

export interface RuntimeInvariantViolation {
  code: RuntimeInvariantCode;
  opportunityId: string;
  symbol: string;
  detectedAt: number;
  snapshotUpdatedAt: number;
  detail: string;
}

export interface RuntimeInvariantQuarantine {
  opportunityId: string;
  symbol: string;
  quarantinedAt: number;
  snapshotUpdatedAt: number;
  codes: RuntimeInvariantCode[];
  reasons: string[];
}

export interface RuntimeInvariantMonitorSnapshot {
  running: boolean;
  lastScanAt: number | null;
  totalViolations: number;
  activeQuarantines: number;
  quarantines: RuntimeInvariantQuarantine[];
  recentViolations: RuntimeInvariantViolation[];
}

class RuntimeInvariantMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastScanAt: number | null = null;
  private totalViolations = 0;
  private readonly quarantines = new Map<string, RuntimeInvariantQuarantine>();
  private readonly recentViolations: RuntimeInvariantViolation[] = [];
  private readonly maxRecentViolations = 256;

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_RUNTIME_INVARIANT_MS || 5_000));
    this.scan();
    this.timer = setInterval(() => this.scan(), intervalMs);
    this.timer.unref?.();
    logger.info('[RuntimeInvariant] Canonical invariant monitor started', {
      component: 'CryptoCrawlerRuntimeInvariantMonitor',
      intervalMs,
      authority: 'fail_closed_candidate_quarantine',
      executionAuthorityGranted: false,
      preservesGovernanceAuthority: true,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  scan(): RuntimeInvariantMonitorSnapshot {
    const now = Date.now();
    const recent = canonicalOpportunityState.getRecent(512);
    const activeIds = new Set(recent.map(snapshot => snapshot.opportunityId));

    for (const snapshot of recent) {
      this.assessOpportunity(snapshot, now);
    }

    for (const opportunityId of this.quarantines.keys()) {
      if (!activeIds.has(opportunityId)) this.quarantines.delete(opportunityId);
    }

    this.lastScanAt = now;
    return this.getSnapshot();
  }

  isOpportunitySafe(snapshot: CanonicalOpportunitySnapshot): boolean {
    return this.assessOpportunity(snapshot, Date.now()).length === 0;
  }

  isOpportunityQuarantined(opportunityId: string): boolean {
    return this.quarantines.has(opportunityId);
  }

  getSnapshot(): RuntimeInvariantMonitorSnapshot {
    return {
      running: this.timer !== null,
      lastScanAt: this.lastScanAt,
      totalViolations: this.totalViolations,
      activeQuarantines: this.quarantines.size,
      quarantines: [...this.quarantines.values()].map(entry => ({
        ...entry,
        codes: [...entry.codes],
        reasons: [...entry.reasons],
      })),
      recentViolations: this.recentViolations.slice(-20).map(violation => ({ ...violation })),
    };
  }

  private assessOpportunity(snapshot: CanonicalOpportunitySnapshot, now: number): RuntimeInvariantViolation[] {
    const violations = this.evaluate(snapshot, now);
    if (violations.length === 0) {
      const released = this.quarantines.delete(snapshot.opportunityId);
      if (released) {
        logger.info('[RuntimeInvariant] Opportunity quarantine cleared by fresh valid evidence', {
          component: 'CryptoCrawlerRuntimeInvariantMonitor',
          opportunityId: snapshot.opportunityId,
          symbol: snapshot.symbol,
          snapshotUpdatedAt: snapshot.updatedAt,
        });
      }
      return violations;
    }

    const existing = this.quarantines.get(snapshot.opportunityId);
    const codes = [...new Set(violations.map(violation => violation.code))];
    const reasons = violations.map(violation => violation.detail);
    const fingerprint = `${snapshot.updatedAt}:${codes.join(',')}:${reasons.join('|')}`;
    const existingFingerprint = existing
      ? `${existing.snapshotUpdatedAt}:${existing.codes.join(',')}:${existing.reasons.join('|')}`
      : null;

    this.quarantines.set(snapshot.opportunityId, {
      opportunityId: snapshot.opportunityId,
      symbol: snapshot.symbol,
      quarantinedAt: existing?.quarantinedAt ?? now,
      snapshotUpdatedAt: snapshot.updatedAt,
      codes,
      reasons,
    });

    if (fingerprint !== existingFingerprint) {
      this.totalViolations += violations.length;
      this.recentViolations.push(...violations);
      if (this.recentViolations.length > this.maxRecentViolations) {
        this.recentViolations.splice(0, this.recentViolations.length - this.maxRecentViolations);
      }
      logger.error('[RuntimeInvariant] Canonical opportunity quarantined', {
        component: 'CryptoCrawlerRuntimeInvariantMonitor',
        opportunityId: snapshot.opportunityId,
        symbol: snapshot.symbol,
        status: snapshot.status,
        codes,
        reasons,
        executionBlockedByInvariantMonitor: true,
      });
    }

    return violations;
  }

  private evaluate(snapshot: CanonicalOpportunitySnapshot, now: number): RuntimeInvariantViolation[] {
    const violations: RuntimeInvariantViolation[] = [];
    const add = (code: RuntimeInvariantCode, detail: string) => {
      violations.push({
        code,
        opportunityId: snapshot.opportunityId,
        symbol: snapshot.symbol,
        detectedAt: now,
        snapshotUpdatedAt: snapshot.updatedAt,
        detail,
      });
    };

    if (snapshot.status === 'eligible') {
      if (!snapshot.plan) {
        add('eligible_missing_plan', 'Eligible opportunity has no canonical verified execution plan.');
      } else {
        if (!Number.isFinite(snapshot.plan.netProfitUsd) || snapshot.plan.netProfitUsd <= 0) {
          add(
            'eligible_non_positive_economics',
            `Eligible opportunity netProfitUsd must be finite and > 0; observed ${String(snapshot.plan.netProfitUsd)}.`,
          );
        }

        const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
        const observedAgeMs = Math.max(0, now - snapshot.observedAt);
        if (
          !Number.isFinite(snapshot.plan.quoteAgeMs)
          || snapshot.plan.quoteAgeMs < 0
          || snapshot.plan.quoteAgeMs > maxQuoteAgeMs
          || observedAgeMs > maxQuoteAgeMs
        ) {
          add(
            'eligible_stale_quote',
            `Eligible opportunity quote/evidence is stale or invalid; planQuoteAgeMs=${String(snapshot.plan.quoteAgeMs)}, observedAgeMs=${observedAgeMs}, max=${maxQuoteAgeMs}.`,
          );
        }
      }
    }

    if (
      snapshot.realized.realizedProfitUsd !== null
      && snapshot.realized.settlementConfirmed !== true
    ) {
      add(
        'realized_before_terminal_settlement',
        'Realized P&L is present without terminal confirmed settlement.',
      );
    }

    if (snapshot.status === 'settled' && snapshot.realized.settlementConfirmed !== true) {
      add(
        'settled_without_terminal_confirmation',
        'Canonical status is settled without terminal settlement confirmation.',
      );
    }

    return violations;
  }
}

export const runtimeInvariantMonitor = new RuntimeInvariantMonitor();

export function ensureRuntimeInvariantMonitor(): RuntimeInvariantMonitor {
  runtimeInvariantMonitor.start();
  return runtimeInvariantMonitor;
}
