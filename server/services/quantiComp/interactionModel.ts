import type { QuantiExecutionMetrics, QuantiInteractionInsight, QuantiLane } from './types.js';

type Observation = {
  features: Record<string, number>;
  target: number;
};

const MAX_OBSERVATIONS_PER_KIND = 1024;
const MAX_SCREENED_FEATURES = 8;
const MIN_SAMPLES = 16;
const MAX_ORDER = 5;

const laneValue: Record<QuantiLane, number> = {
  background: 1,
  batch: 2,
  warm: 3,
  hot: 4,
  ultra_hot: 5,
};

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardize(values: number[]): number[] | null {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
  if (!Number.isFinite(variance) || variance <= 1e-18) return null;
  const sd = Math.sqrt(variance);
  return values.map(value => (value - m) / sd);
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const sa = standardize(a.slice(0, n));
  const sb = standardize(b.slice(0, n));
  if (!sa || !sb) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += sa[i] * sb[i];
  return Math.max(-1, Math.min(1, sum / (n - 1)));
}

function combinations(values: string[], order: number, start = 0, prefix: string[] = [], out: string[][] = []): string[][] {
  if (prefix.length === order) {
    out.push([...prefix]);
    return out;
  }
  for (let i = start; i <= values.length - (order - prefix.length); i += 1) {
    prefix.push(values[i]);
    combinations(values, order, i + 1, prefix, out);
    prefix.pop();
  }
  return out;
}

export class QuantiInteractionModel {
  private readonly observations = new Map<string, Observation[]>();

  record(
    kind: string,
    lane: QuantiLane,
    priority: number,
    queueDepthAtSubmit: number,
    activeAtSubmit: number,
    declaredFeatures: Record<string, number> | undefined,
    metrics: QuantiExecutionMetrics,
  ): void {
    const features: Record<string, number> = {
      lane: laneValue[lane],
      priority,
      queueDepthAtSubmit,
      activeAtSubmit,
      cpuBefore: metrics.resourceBefore.cpuUtilizationPercent ?? 0,
      memoryPressureBefore: metrics.resourceBefore.totalMemoryBytes > 0
        ? 1 - metrics.resourceBefore.freeMemoryBytes / metrics.resourceBefore.totalMemoryBytes
        : 0,
      eventLoopUtilizationBefore: metrics.resourceBefore.eventLoopUtilization,
      eventLoopDelayP95BeforeMs: metrics.resourceBefore.eventLoopDelayP95Ms,
      usefulWorkUnits: metrics.usefulWorkUnits,
    };

    if (declaredFeatures) {
      for (const [key, value] of Object.entries(declaredFeatures)) {
        if (Number.isFinite(value)) features[`declared.${key}`] = value;
      }
    }

    const list = this.observations.get(kind) || [];
    list.push({
      features,
      target: metrics.usefulThroughputPerSecond,
    });
    if (list.length > MAX_OBSERVATIONS_PER_KIND) list.splice(0, list.length - MAX_OBSERVATIONS_PER_KIND);
    this.observations.set(kind, list);
  }

  getObservationKindCount(): number {
    return this.observations.size;
  }

  getInsights(kind: string, limit = 20): QuantiInteractionInsight[] {
    const rows = this.observations.get(kind) || [];
    if (rows.length < MIN_SAMPLES) return [];

    const commonFeatures = Object.keys(rows[0].features).filter(key =>
      rows.every(row => Number.isFinite(row.features[key])),
    );
    const target = rows.map(row => row.target);

    const screened = commonFeatures
      .map(feature => ({
        feature,
        correlation: correlation(rows.map(row => row.features[feature]), target),
      }))
      .filter(item => Number.isFinite(item.correlation))
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
      .slice(0, MAX_SCREENED_FEATURES)
      .map(item => item.feature);

    const standardized = new Map<string, number[]>();
    for (const feature of screened) {
      const values = standardize(rows.map(row => row.features[feature]));
      if (values) standardized.set(feature, values);
    }
    const usable = screened.filter(feature => standardized.has(feature));
    const targetStandardized = standardize(target);
    if (!targetStandardized) return [];

    const insights: QuantiInteractionInsight[] = [];
    for (let order = 1; order <= Math.min(MAX_ORDER, usable.length); order += 1) {
      if (rows.length < Math.max(MIN_SAMPLES, order * 8)) continue;
      for (const features of combinations(usable, order)) {
        const interaction = new Array(rows.length).fill(1);
        for (const feature of features) {
          const values = standardized.get(feature)!;
          for (let i = 0; i < interaction.length; i += 1) interaction[i] *= values[i];
        }
        const c = correlation(interaction, targetStandardized);
        if (!Number.isFinite(c)) continue;
        insights.push({
          kind,
          target: 'useful_throughput_per_second',
          features,
          order,
          correlation: c,
          absoluteCorrelation: Math.abs(c),
          samples: rows.length,
        });
      }
    }

    return insights
      .sort((a, b) => b.absoluteCorrelation - a.absoluteCorrelation || a.order - b.order)
      .slice(0, Math.max(1, limit));
  }
}
