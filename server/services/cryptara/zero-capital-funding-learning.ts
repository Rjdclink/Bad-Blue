import { getCryptara } from './index.js';

export type ZeroCapitalFundingObservationStage = 'probe' | 'prepare' | 'submit' | 'settlement';
export type ZeroCapitalFundingObservationOutcome =
  | 'success'
  | 'unavailable'
  | 'rejected'
  | 'definitive_failure'
  | 'ambiguous'
  | 'stale'
  | 'cancelled';

export interface ZeroCapitalFundingObservation {
  opportunityId: string;
  chain: string;
  strategy: string;
  laneId: string;
  provider: string;
  stage: ZeroCapitalFundingObservationStage;
  outcome: ZeroCapitalFundingObservationOutcome;
  latencyMs: number;
  retryOrdinal: number;
  redundancyDepth: number;
  estimatedCostUsd?: number;
  realizedCostUsd?: number;
  guaranteedResidualProfitUsd?: number;
  observedAt: number;
  reason?: string;
}

export interface ZeroCapitalFundingLaneMetrics {
  laneId: string;
  observations: number;
  successfulPreparations: number;
  submissions: number;
  confirmedSettlements: number;
  definitiveFailures: number;
  ambiguousSubmissions: number;
  staleObservations: number;
  availabilityEwma: number;
  executionSuccessEwma: number;
  latencyEwmaMs: number;
  costEwmaUsd: number;
  lastObservedAt: number;
  learningAuthority: 'cryptara_zero_initial_capital_funding';
  executionAuthority: false;
}

const EWMA_ALPHA = 0.2;
const MAX_OBSERVATIONS = 2_000;

function ewma(previous: number, value: number): number {
  return previous === 0 ? value : previous * (1 - EWMA_ALPHA) + value * EWMA_ALPHA;
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export class CryptaraZeroInitialCapitalFundingLearning {
  private readonly observations: ZeroCapitalFundingObservation[] = [];
  private readonly metrics = new Map<string, ZeroCapitalFundingLaneMetrics>();

  record(observation: ZeroCapitalFundingObservation): void {
    const normalized: ZeroCapitalFundingObservation = {
      ...observation,
      latencyMs: Math.max(0, Number.isFinite(observation.latencyMs) ? observation.latencyMs : 0),
      retryOrdinal: Math.max(0, Math.floor(observation.retryOrdinal || 0)),
      redundancyDepth: Math.max(0, Math.floor(observation.redundancyDepth || 0)),
      estimatedCostUsd: finiteNonNegative(observation.estimatedCostUsd),
      realizedCostUsd: finiteNonNegative(observation.realizedCostUsd),
      guaranteedResidualProfitUsd: finiteNonNegative(observation.guaranteedResidualProfitUsd),
      observedAt: Number.isFinite(observation.observedAt) ? observation.observedAt : Date.now(),
    };

    this.observations.push(normalized);
    if (this.observations.length > MAX_OBSERVATIONS) this.observations.splice(0, this.observations.length - MAX_OBSERVATIONS);

    const current = this.metrics.get(normalized.laneId) || {
      laneId: normalized.laneId,
      observations: 0,
      successfulPreparations: 0,
      submissions: 0,
      confirmedSettlements: 0,
      definitiveFailures: 0,
      ambiguousSubmissions: 0,
      staleObservations: 0,
      availabilityEwma: 0.5,
      executionSuccessEwma: 0.5,
      latencyEwmaMs: 0,
      costEwmaUsd: 0,
      lastObservedAt: 0,
      learningAuthority: 'cryptara_zero_initial_capital_funding' as const,
      executionAuthority: false as const,
    };

    current.observations++;
    current.lastObservedAt = normalized.observedAt;
    current.latencyEwmaMs = ewma(current.latencyEwmaMs, normalized.latencyMs);
    const cost = normalized.realizedCostUsd ?? normalized.estimatedCostUsd;
    if (cost !== undefined) current.costEwmaUsd = ewma(current.costEwmaUsd, cost);

    if (normalized.stage === 'probe' || normalized.stage === 'prepare') {
      const available = normalized.outcome === 'success' ? 1 : 0;
      current.availabilityEwma = ewma(current.availabilityEwma, available);
      if (normalized.outcome === 'success') current.successfulPreparations++;
    }
    if (normalized.stage === 'submit') current.submissions++;
    if (normalized.stage === 'settlement' && normalized.outcome === 'success') {
      current.confirmedSettlements++;
      current.executionSuccessEwma = ewma(current.executionSuccessEwma, 1);
    }
    if (normalized.outcome === 'definitive_failure' || normalized.outcome === 'rejected') {
      current.definitiveFailures++;
      if (normalized.stage === 'submit' || normalized.stage === 'settlement') {
        current.executionSuccessEwma = ewma(current.executionSuccessEwma, 0);
      }
    }
    if (normalized.outcome === 'ambiguous') current.ambiguousSubmissions++;
    if (normalized.outcome === 'stale') current.staleObservations++;

    this.metrics.set(normalized.laneId, current);

    // Funding telemetry is deliberately separated from CryptaraExecutionFeedback:
    // quote/provider failures are not trades and must never corrupt realized-trade calibration.
    getCryptara().emit('zero-capital:funding-learning', {
      ...normalized,
      learningAuthority: 'cryptara_zero_initial_capital_funding',
      executionAuthority: false,
    });
  }

  score(laneId: string): number {
    const metric = this.metrics.get(laneId);
    if (!metric) return 0.5;
    const latencyScore = 1 / (1 + metric.latencyEwmaMs / 1_000);
    const costScore = 1 / (1 + Math.max(0, metric.costEwmaUsd));
    const ambiguityPenalty = Math.min(0.4, metric.ambiguousSubmissions / Math.max(1, metric.submissions));
    return Math.max(0, Math.min(1,
      metric.availabilityEwma * 0.35 +
      metric.executionSuccessEwma * 0.35 +
      latencyScore * 0.15 +
      costScore * 0.15 -
      ambiguityPenalty,
    ));
  }

  rank(laneIds: string[]): Array<{ laneId: string; score: number }> {
    return [...new Set(laneIds)]
      .map(laneId => ({ laneId, score: this.score(laneId) }))
      .sort((left, right) => right.score - left.score);
  }

  getMetrics(): ZeroCapitalFundingLaneMetrics[] {
    return Array.from(this.metrics.values()).map(metric => ({ ...metric }));
  }

  getObservations(limit = 200): ZeroCapitalFundingObservation[] {
    return this.observations.slice(-Math.max(1, limit)).map(observation => ({ ...observation }));
  }
}

let singleton: CryptaraZeroInitialCapitalFundingLearning | null = null;

export function getCryptaraZeroInitialCapitalFundingLearning(): CryptaraZeroInitialCapitalFundingLearning {
  if (!singleton) singleton = new CryptaraZeroInitialCapitalFundingLearning();
  return singleton;
}
