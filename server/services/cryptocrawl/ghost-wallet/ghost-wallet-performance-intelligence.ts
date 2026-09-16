export type GhostWalletPerformanceStage =
  | 'provider_probe'
  | 'funding_quote'
  | 'mandate_match'
  | 'route_preflight'
  | 'prepared_enqueue'
  | 'transaction_broadcast'
  | 'settlement';

export interface GhostWalletPerformanceObservation {
  stage: GhostWalletPerformanceStage;
  chain: string;
  routeKey?: string | null;
  sourceKind?: string | null;
  providerLabel?: string | null;
  latencyMs?: number | null;
  success: boolean;
  expectedNetProfitBaseUnits?: bigint | string | null;
  realizedProfitBaseUnits?: bigint | string | null;
  errorType?: string | null;
}

interface RollingMetric {
  key: string;
  stage: GhostWalletPerformanceStage;
  chain: string;
  routeKey: string | null;
  sourceKind: string | null;
  providerLabel: string | null;
  observations: number;
  successes: number;
  failures: number;
  ewmaLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorType: string | null;
  lastExpectedNetProfitBaseUnits: string | null;
  bestExpectedNetProfitBaseUnits: string | null;
  lastRealizedProfitBaseUnits: string | null;
  cumulativeRealizedProfitBaseUnits: string | null;
}

const MAX_METRICS = 512;
const EWMA_ALPHA = 0.2;
const metrics = new Map<string, RollingMetric>();
let lastObservationAt: number | null = null;
let lastProfitableOpportunityAt: number | null = null;
let lastSettlementAt: number | null = null;
let observations = 0;
let successes = 0;
let failures = 0;

function normalized(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text.slice(0, 160) : null;
}

function positiveLatency(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function bigintString(value: bigint | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try { return BigInt(value).toString(); } catch { return null; }
}

function maxBigintString(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  try { return BigInt(left) >= BigInt(right) ? left : right; } catch { return left; }
}

function addBigintStrings(left: string | null, right: string | null): string | null {
  if (right === null) return left;
  try { return (BigInt(left || '0') + BigInt(right)).toString(); } catch { return left; }
}

function metricKey(input: GhostWalletPerformanceObservation): string {
  return [
    input.stage,
    normalized(input.chain) || 'unknown',
    normalized(input.routeKey) || '-',
    normalized(input.sourceKind) || '-',
    normalized(input.providerLabel) || '-',
  ].join(':');
}

function evictIfNeeded(): void {
  while (metrics.size > MAX_METRICS) {
    const oldest = metrics.keys().next().value as string | undefined;
    if (!oldest) break;
    metrics.delete(oldest);
  }
}

export function recordGhostWalletPerformance(input: GhostWalletPerformanceObservation): void {
  const now = Date.now();
  const latencyMs = positiveLatency(input.latencyMs);
  const expected = bigintString(input.expectedNetProfitBaseUnits);
  const realized = bigintString(input.realizedProfitBaseUnits);
  const key = metricKey(input);
  const existing = metrics.get(key);
  const metric: RollingMetric = existing || {
    key,
    stage: input.stage,
    chain: normalized(input.chain) || 'unknown',
    routeKey: normalized(input.routeKey),
    sourceKind: normalized(input.sourceKind),
    providerLabel: normalized(input.providerLabel),
    observations: 0,
    successes: 0,
    failures: 0,
    ewmaLatencyMs: null,
    minLatencyMs: null,
    maxLatencyMs: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorType: null,
    lastExpectedNetProfitBaseUnits: null,
    bestExpectedNetProfitBaseUnits: null,
    lastRealizedProfitBaseUnits: null,
    cumulativeRealizedProfitBaseUnits: null,
  };
  metric.observations += 1;
  observations += 1;
  if (input.success) {
    metric.successes += 1;
    successes += 1;
    metric.lastSuccessAt = now;
  } else {
    metric.failures += 1;
    failures += 1;
    metric.lastFailureAt = now;
    metric.lastErrorType = normalized(input.errorType);
  }
  if (latencyMs !== null) {
    metric.lastLatencyMs = latencyMs;
    metric.minLatencyMs = metric.minLatencyMs === null ? latencyMs : Math.min(metric.minLatencyMs, latencyMs);
    metric.maxLatencyMs = metric.maxLatencyMs === null ? latencyMs : Math.max(metric.maxLatencyMs, latencyMs);
    metric.ewmaLatencyMs = metric.ewmaLatencyMs === null
      ? latencyMs
      : (metric.ewmaLatencyMs * (1 - EWMA_ALPHA)) + (latencyMs * EWMA_ALPHA);
  }
  if (expected !== null) {
    metric.lastExpectedNetProfitBaseUnits = expected;
    metric.bestExpectedNetProfitBaseUnits = maxBigintString(metric.bestExpectedNetProfitBaseUnits, expected);
    if (BigInt(expected) > 0n) lastProfitableOpportunityAt = now;
  }
  if (realized !== null) {
    metric.lastRealizedProfitBaseUnits = realized;
    metric.cumulativeRealizedProfitBaseUnits = addBigintStrings(metric.cumulativeRealizedProfitBaseUnits, realized);
    if (BigInt(realized) > 0n) lastSettlementAt = now;
  }
  lastObservationAt = now;
  if (existing) {
    metrics.delete(key);
    metrics.set(key, metric);
  } else {
    metrics.set(key, metric);
    evictIfNeeded();
  }
}

export function ghostWalletPerformancePenalty(input: {
  stage: GhostWalletPerformanceStage;
  chain: string;
  routeKey?: string | null;
  sourceKind?: string | null;
  providerLabel?: string | null;
}): { failureRate: number; ewmaLatencyMs: number | null } {
  const key = metricKey({ ...input, success: true });
  const metric = metrics.get(key);
  if (!metric || metric.observations <= 0) return { failureRate: 0, ewmaLatencyMs: null };
  return {
    failureRate: metric.failures / metric.observations,
    ewmaLatencyMs: metric.ewmaLatencyMs,
  };
}

export function getGhostWalletPerformanceSnapshot() {
  const rows = [...metrics.values()]
    .map(metric => ({
      ...metric,
      successRate: metric.observations > 0 ? metric.successes / metric.observations : 0,
      ewmaLatencyMs: metric.ewmaLatencyMs === null ? null : Math.round(metric.ewmaLatencyMs * 100) / 100,
    }))
    .sort((left, right) => {
      const leftTime = Math.max(left.lastSuccessAt || 0, left.lastFailureAt || 0);
      const rightTime = Math.max(right.lastSuccessAt || 0, right.lastFailureAt || 0);
      return rightTime - leftTime;
    });
  return {
    generatedAt: Date.now(),
    boundedMetricCardinality: MAX_METRICS,
    observations,
    successes,
    failures,
    successRate: observations > 0 ? successes / observations : 0,
    lastObservationAt,
    lastProfitableOpportunityAt,
    lastSettlementAt,
    metrics: rows,
  };
}

export const GHOST_WALLET_PERFORMANCE_INTELLIGENCE_POLICY = {
  executionAuthority: false,
  advisoryRankingOnly: true,
  constantTimeHotPathObservation: true,
  boundedMetricCardinality: MAX_METRICS,
  latencyEwmaAlpha: EWMA_ALPHA,
  realizedSettlementRemainsTruthAuthority: true,
} as const;
