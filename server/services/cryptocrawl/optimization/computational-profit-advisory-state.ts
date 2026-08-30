export interface ComputationalProfitAdvisorySnapshot {
  observedAt: number;
  notionalBias: number;
  refinementDensity: number;
  prefetchAggression: number;
  evidenceRefreshFactor: number;
  profitLadderMaxNotionalUsd: number;
  dollarValuePerBpsUsd: number;
  measuredAverageSlippageBps: number | null;
  measuredAverageLatencyMs: number | null;
  cryptaraConfidence: number | null;
  authority: 'advisory_only';
  executionAuthority: false;
}

const DEFAULT_STATE: ComputationalProfitAdvisorySnapshot = {
  observedAt: 0,
  notionalBias: 1,
  refinementDensity: 0.5,
  prefetchAggression: 0.5,
  evidenceRefreshFactor: 1,
  profitLadderMaxNotionalUsd: 0,
  dollarValuePerBpsUsd: 0,
  measuredAverageSlippageBps: null,
  measuredAverageLatencyMs: null,
  cryptaraConfidence: null,
  authority: 'advisory_only',
  executionAuthority: false,
};

let latest: ComputationalProfitAdvisorySnapshot = { ...DEFAULT_STATE };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export function publishComputationalProfitAdvisory(input: Partial<ComputationalProfitAdvisorySnapshot>): void {
  latest = {
    observedAt: Number.isFinite(input.observedAt) ? Number(input.observedAt) : Date.now(),
    notionalBias: clamp(Number(input.notionalBias ?? latest.notionalBias), 0.10, 1),
    refinementDensity: clamp(Number(input.refinementDensity ?? latest.refinementDensity), 0.25, 1),
    prefetchAggression: clamp(Number(input.prefetchAggression ?? latest.prefetchAggression), 0.25, 1),
    evidenceRefreshFactor: clamp(Number(input.evidenceRefreshFactor ?? latest.evidenceRefreshFactor), 0.50, 1.50),
    profitLadderMaxNotionalUsd: Math.max(0, Number(input.profitLadderMaxNotionalUsd ?? latest.profitLadderMaxNotionalUsd) || 0),
    dollarValuePerBpsUsd: Math.max(0, Number(input.dollarValuePerBpsUsd ?? latest.dollarValuePerBpsUsd) || 0),
    measuredAverageSlippageBps: input.measuredAverageSlippageBps === null
      ? null
      : Number.isFinite(Number(input.measuredAverageSlippageBps)) ? Math.max(0, Number(input.measuredAverageSlippageBps)) : latest.measuredAverageSlippageBps,
    measuredAverageLatencyMs: input.measuredAverageLatencyMs === null
      ? null
      : Number.isFinite(Number(input.measuredAverageLatencyMs)) ? Math.max(0, Number(input.measuredAverageLatencyMs)) : latest.measuredAverageLatencyMs,
    cryptaraConfidence: input.cryptaraConfidence === null
      ? null
      : Number.isFinite(Number(input.cryptaraConfidence)) ? clamp(Number(input.cryptaraConfidence), 0, 1) : latest.cryptaraConfidence,
    authority: 'advisory_only',
    executionAuthority: false,
  };
}

export function getComputationalProfitAdvisory(maxAgeMs = 60_000): ComputationalProfitAdvisorySnapshot {
  if (latest.observedAt <= 0 || Date.now() - latest.observedAt > Math.max(1_000, maxAgeMs)) {
    return { ...DEFAULT_STATE };
  }
  return { ...latest };
}
