export type CryptaraNetworkRole =
  | 'execution'
  | 'atomic_principal'
  | 'fee_payment'
  | 'settlement'
  | 'retained_capital'
  | 'capital_transfer';

export interface CryptaraNetworkObservation {
  network: string;
  protocol?: string;
  role: CryptaraNetworkRole;
  terminal: true;
  success: boolean;
  observedAt: number;
  latencyMs?: number;
  realizedCostUsd?: number;
  realizedNetProfitUsd?: number;
  ambiguous?: boolean;
  provenance: string[];
}

export interface CryptaraNetworkRanking {
  key: string;
  network: string;
  protocol?: string;
  role: CryptaraNetworkRole;
  score: number;
  confidence: number;
  samples: number;
  executionAuthority: false;
  canonicalEconomicsAuthority: false;
}

interface Metrics {
  network: string;
  protocol?: string;
  role: CryptaraNetworkRole;
  samples: number;
  successes: number;
  ambiguities: number;
  successEwma: number;
  latencyEwmaMs: number;
  costEwmaUsd: number;
  netProfitEwmaUsd: number;
  lastObservedAt: number;
}

function alpha(): number {
  const parsed = Number(process.env.CRYPTARA_NETWORK_LEARNING_ALPHA || 0.18);
  return Number.isFinite(parsed) ? Math.max(0.02, Math.min(0.5, parsed)) : 0.18;
}

function ewma(previous: number, value: number, samples: number): number {
  if (samples <= 1) return value;
  const a = alpha();
  return previous * (1 - a) + value * a;
}

function key(network: string, role: CryptaraNetworkRole, protocol?: string): string {
  return `${network.trim().toLowerCase()}:${String(protocol || '*').trim().toLowerCase()}:${role}`;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function confidence(samples: number): number {
  const prior = Math.max(4, Math.min(100, finite(process.env.CRYPTARA_NETWORK_LEARNING_PRIOR_SAMPLES, 16)));
  return Math.max(0, Math.min(1, samples / (samples + prior)));
}

function freshness(lastObservedAt: number, now: number): number {
  const halfLife = Math.max(60_000, Math.min(30 * 24 * 60 * 60_000, finite(process.env.CRYPTARA_NETWORK_LEARNING_HALF_LIFE_MS, 4 * 60 * 60_000)));
  return lastObservedAt > 0 ? Math.pow(0.5, Math.max(0, now - lastObservedAt) / halfLife) : 0;
}

export class CryptaraNetworkSpecializationLearning {
  private readonly metrics = new Map<string, Metrics>();

  record(observation: CryptaraNetworkObservation): void {
    if (observation.terminal !== true || !observation.network?.trim()) return;
    const metricKey = key(observation.network, observation.role, observation.protocol);
    const current = this.metrics.get(metricKey) || {
      network: observation.network.trim().toLowerCase(),
      protocol: observation.protocol?.trim().toLowerCase(),
      role: observation.role,
      samples: 0,
      successes: 0,
      ambiguities: 0,
      successEwma: 0.5,
      latencyEwmaMs: 0,
      costEwmaUsd: 0,
      netProfitEwmaUsd: 0,
      lastObservedAt: 0,
    };

    current.samples += 1;
    if (observation.success) current.successes += 1;
    if (observation.ambiguous) current.ambiguities += 1;
    current.successEwma = ewma(current.successEwma, observation.success ? 1 : 0, current.samples);
    if (observation.latencyMs !== undefined) current.latencyEwmaMs = ewma(current.latencyEwmaMs, Math.max(0, finite(observation.latencyMs)), current.samples);
    if (observation.realizedCostUsd !== undefined) current.costEwmaUsd = ewma(current.costEwmaUsd, Math.max(0, finite(observation.realizedCostUsd)), current.samples);
    if (observation.realizedNetProfitUsd !== undefined) current.netProfitEwmaUsd = ewma(current.netProfitEwmaUsd, finite(observation.realizedNetProfitUsd), current.samples);
    current.lastObservedAt = Number.isFinite(observation.observedAt) ? observation.observedAt : Date.now();
    this.metrics.set(metricKey, current);
  }

  score(network: string, role: CryptaraNetworkRole, protocol?: string, now = Date.now()): CryptaraNetworkRanking {
    const metricKey = key(network, role, protocol);
    const metric = this.metrics.get(metricKey);
    if (!metric) {
      return { key: metricKey, network: network.toLowerCase(), protocol: protocol?.toLowerCase(), role, score: 0.5, confidence: 0, samples: 0, executionAuthority: false, canonicalEconomicsAuthority: false };
    }
    const sampleConfidence = confidence(metric.samples) * freshness(metric.lastObservedAt, now);
    const latencyScore = 1 / (1 + Math.max(0, metric.latencyEwmaMs) / 1_000);
    const costScore = 1 / (1 + Math.max(0, metric.costEwmaUsd));
    const profitScore = metric.netProfitEwmaUsd >= 0
      ? 0.5 + 0.5 * metric.netProfitEwmaUsd / (1 + metric.netProfitEwmaUsd)
      : 0.5 / (1 + Math.abs(metric.netProfitEwmaUsd));
    const ambiguityPenalty = Math.min(0.25, metric.ambiguities / Math.max(1, metric.samples));
    const evidence = Math.max(0, Math.min(1,
      metric.successEwma * 0.35 + profitScore * 0.35 + latencyScore * 0.15 + costScore * 0.15 - ambiguityPenalty,
    ));
    const score = 0.5 * (1 - sampleConfidence) + evidence * sampleConfidence;
    return {
      key: metricKey,
      network: metric.network,
      protocol: metric.protocol,
      role,
      score: Math.max(0, Math.min(1, score)),
      confidence: sampleConfidence,
      samples: metric.samples,
      executionAuthority: false,
      canonicalEconomicsAuthority: false,
    };
  }

  rank(candidates: Array<{ network: string; protocol?: string }>, role: CryptaraNetworkRole): CryptaraNetworkRanking[] {
    return candidates
      .map(candidate => this.score(candidate.network, role, candidate.protocol))
      .sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.key.localeCompare(right.key));
  }
}

let singleton: CryptaraNetworkSpecializationLearning | null = null;

export function getCryptaraNetworkSpecializationLearning(): CryptaraNetworkSpecializationLearning {
  if (!singleton) singleton = new CryptaraNetworkSpecializationLearning();
  return singleton;
}
