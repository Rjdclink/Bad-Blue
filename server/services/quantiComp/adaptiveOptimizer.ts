import { EventEmitter } from 'node:events';
import type { QuantiExecutionMetrics, QuantiInteractionInsight } from './types.js';

export type QuantiAdaptiveState = 'baseline' | 'canary' | 'active' | 'rolled_back';

export interface QuantiAdaptiveOptimizerOptions {
  minBaselineSamples?: number;
  minInteractionSamples?: number;
  minInteractionCorrelation?: number;
  minCandidateSamples?: number;
  maxCanarySamples?: number;
  canaryEvery?: number;
  minPowerGain?: number;
  maxP95Regression?: number;
  maxFailureRateIncrease?: number;
  rollbackPowerRatio?: number;
  rollbackP95Ratio?: number;
  rollbackFailureRateIncrease?: number;
  rollbackWindow?: number;
  cooldownSubmissions?: number;
  maxPriorityBias?: number;
  observationWindow?: number;
}

export interface QuantiAdaptivePlan {
  kind: string;
  strategyId: string;
  state: QuantiAdaptiveState;
  priorityBias: number;
  canary: boolean;
  evidence?: {
    order: number;
    features: string[];
    correlation: number;
    samples: number;
  };
}

export interface QuantiAdaptiveStrategySummary {
  strategyId: string;
  samples: number;
  successes: number;
  failures: number;
  failureRate: number;
  medianEffectivePower: number | null;
  p95LatencyMs: number | null;
}

export interface QuantiAdaptiveKindStatus {
  kind: string;
  state: QuantiAdaptiveState;
  activeStrategyId: string;
  priorityBias: number;
  baseline: QuantiAdaptiveStrategySummary;
  candidate: QuantiAdaptiveStrategySummary | null;
  evidence: QuantiAdaptivePlan['evidence'] | null;
  cooldownRemaining: number;
  submissions: number;
  promotions: number;
  rollbacks: number;
  lastTransitionAt: number | null;
  lastReason: string | null;
}

export interface QuantiAdaptiveStatus {
  kinds: QuantiAdaptiveKindStatus[];
  activeKinds: number;
  canaryKinds: number;
  rolledBackKinds: number;
}

type Outcome = {
  success: boolean;
  effectivePower: number;
  latencyMs: number;
};

type StrategyState = {
  id: string;
  priorityBias: number;
  outcomes: Outcome[];
};

type KindState = {
  kind: string;
  state: QuantiAdaptiveState;
  baseline: StrategyState;
  candidate: StrategyState | null;
  evidence: QuantiAdaptivePlan['evidence'] | null;
  submissions: number;
  cooldownRemaining: number;
  promotions: number;
  rollbacks: number;
  lastTransitionAt: number | null;
  lastReason: string | null;
  frozenBaseline: QuantiAdaptiveStrategySummary | null;
};

const DEFAULTS = {
  minBaselineSamples: 64,
  minInteractionSamples: 64,
  minInteractionCorrelation: 0.35,
  minCandidateSamples: 16,
  maxCanarySamples: 32,
  canaryEvery: 8,
  minPowerGain: 0.05,
  maxP95Regression: 0.05,
  maxFailureRateIncrease: 0.02,
  rollbackPowerRatio: 0.92,
  rollbackP95Ratio: 1.15,
  rollbackFailureRateIncrease: 0.05,
  rollbackWindow: 32,
  cooldownSubmissions: 64,
  maxPriorityBias: 25,
  observationWindow: 128,
} as const;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function effectivePower(metrics: QuantiExecutionMetrics): number {
  const cpuShare = metrics.cpuTotalMs / Math.max(1, metrics.totalLatencyMs);
  return Math.max(0, metrics.usefulThroughputPerSecond) / (1 + Math.max(0, cpuShare));
}

function strategySummary(strategy: StrategyState, window?: number): QuantiAdaptiveStrategySummary {
  const outcomes = window ? strategy.outcomes.slice(-window) : strategy.outcomes;
  const successes = outcomes.filter(item => item.success);
  const failures = outcomes.length - successes.length;
  return {
    strategyId: strategy.id,
    samples: outcomes.length,
    successes: successes.length,
    failures,
    failureRate: outcomes.length ? failures / outcomes.length : 0,
    medianEffectivePower: median(successes.map(item => item.effectivePower)),
    p95LatencyMs: percentile(successes.map(item => item.latencyMs), 0.95),
  };
}

function boundedBias(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-maximum, Math.min(maximum, Math.round(value)));
}

export class QuantiAdaptiveOptimizer extends EventEmitter {
  private readonly options: Required<QuantiAdaptiveOptimizerOptions>;
  private readonly kinds = new Map<string, KindState>();
  private readonly seenObservations = new Set<string>();

  constructor(options: QuantiAdaptiveOptimizerOptions = {}) {
    super();
    this.options = {
      minBaselineSamples: Math.max(4, options.minBaselineSamples ?? DEFAULTS.minBaselineSamples),
      minInteractionSamples: Math.max(4, options.minInteractionSamples ?? DEFAULTS.minInteractionSamples),
      minInteractionCorrelation: Math.max(0.05, Math.min(0.95, options.minInteractionCorrelation ?? DEFAULTS.minInteractionCorrelation)),
      minCandidateSamples: Math.max(2, options.minCandidateSamples ?? DEFAULTS.minCandidateSamples),
      maxCanarySamples: Math.max(2, options.maxCanarySamples ?? DEFAULTS.maxCanarySamples),
      canaryEvery: Math.max(1, options.canaryEvery ?? DEFAULTS.canaryEvery),
      minPowerGain: Math.max(0, options.minPowerGain ?? DEFAULTS.minPowerGain),
      maxP95Regression: Math.max(0, options.maxP95Regression ?? DEFAULTS.maxP95Regression),
      maxFailureRateIncrease: Math.max(0, options.maxFailureRateIncrease ?? DEFAULTS.maxFailureRateIncrease),
      rollbackPowerRatio: Math.max(0.1, Math.min(1, options.rollbackPowerRatio ?? DEFAULTS.rollbackPowerRatio)),
      rollbackP95Ratio: Math.max(1, options.rollbackP95Ratio ?? DEFAULTS.rollbackP95Ratio),
      rollbackFailureRateIncrease: Math.max(0, options.rollbackFailureRateIncrease ?? DEFAULTS.rollbackFailureRateIncrease),
      rollbackWindow: Math.max(4, options.rollbackWindow ?? DEFAULTS.rollbackWindow),
      cooldownSubmissions: Math.max(1, options.cooldownSubmissions ?? DEFAULTS.cooldownSubmissions),
      maxPriorityBias: Math.max(1, Math.min(100, options.maxPriorityBias ?? DEFAULTS.maxPriorityBias)),
      observationWindow: Math.max(32, options.observationWindow ?? DEFAULTS.observationWindow),
    };
    this.options.maxCanarySamples = Math.max(this.options.minCandidateSamples, this.options.maxCanarySamples);
  }

  plan(kind: string, insights: QuantiInteractionInsight[] = []): QuantiAdaptivePlan {
    const state = this.ensureKind(kind);
    state.submissions += 1;

    if ((state.state === 'baseline' || state.state === 'rolled_back') && state.cooldownRemaining > 0) {
      state.cooldownRemaining -= 1;
    }
    if ((state.state === 'baseline' || state.state === 'rolled_back') && state.cooldownRemaining === 0) {
      this.maybeNominate(state, insights);
    }

    if (state.state === 'canary' && state.candidate) {
      const canary = state.submissions % this.options.canaryEvery === 0;
      if (canary) return this.toPlan(state, state.candidate, true);
    }
    if (state.state === 'active' && state.candidate) return this.toPlan(state, state.candidate, false);
    return this.toPlan(state, state.baseline, false);
  }

  recordSuccess(
    kind: string,
    strategyId: string,
    metrics: QuantiExecutionMetrics,
    observationId?: string,
  ): void {
    if (!this.claimObservation(observationId)) return;
    const state = this.ensureKind(kind);
    const strategy = this.strategyFor(state, strategyId);
    if (!strategy) return;
    strategy.outcomes.push({
      success: true,
      effectivePower: effectivePower(metrics),
      latencyMs: Math.max(0, metrics.totalLatencyMs),
    });
    this.trim(strategy);
    this.evaluate(state);
  }

  recordFailure(kind: string, strategyId: string, observationId?: string): void {
    if (!this.claimObservation(observationId)) return;
    const state = this.ensureKind(kind);
    const strategy = this.strategyFor(state, strategyId);
    if (!strategy) return;
    strategy.outcomes.push({ success: false, effectivePower: 0, latencyMs: 0 });
    this.trim(strategy);
    this.evaluate(state);
  }

  getKindStatus(kind: string): QuantiAdaptiveKindStatus {
    return this.statusFor(this.ensureKind(kind));
  }

  getStatus(): QuantiAdaptiveStatus {
    const kinds = Array.from(this.kinds.values()).map(state => this.statusFor(state));
    return {
      kinds,
      activeKinds: kinds.filter(item => item.state === 'active').length,
      canaryKinds: kinds.filter(item => item.state === 'canary').length,
      rolledBackKinds: kinds.filter(item => item.state === 'rolled_back').length,
    };
  }

  reset(kind?: string): void {
    if (kind) this.kinds.delete(kind);
    else this.kinds.clear();
  }

  private maybeNominate(state: KindState, insights: QuantiInteractionInsight[]): void {
    if (strategySummary(state.baseline).samples < this.options.minBaselineSamples) return;
    const evidence = insights
      .filter(insight =>
        insight.order >= 2 && insight.order <= 5 &&
        insight.samples >= this.options.minInteractionSamples &&
        insight.absoluteCorrelation >= this.options.minInteractionCorrelation &&
        insight.features.some(feature =>
          feature === 'priority' ||
          feature === 'queueDepthAtSubmit' ||
          feature === 'activeAtSubmit' ||
          feature === 'cpuBefore' ||
          feature === 'eventLoopUtilizationBefore' ||
          feature === 'eventLoopDelayP95BeforeMs'
        ),
      )
      .sort((a, b) => b.absoluteCorrelation - a.absoluteCorrelation || b.order - a.order)[0];
    if (!evidence) return;

    let direction = evidence.correlation >= 0 ? 1 : -1;
    if (!evidence.features.includes('priority') && evidence.correlation < 0) direction = 1;
    const magnitude = Math.min(
      this.options.maxPriorityBias,
      Math.max(5, Math.round(5 + evidence.absoluteCorrelation * 20)),
    );
    const bias = boundedBias(direction * magnitude, this.options.maxPriorityBias);
    const candidate: StrategyState = {
      id: `priority-bias:${bias}`,
      priorityBias: bias,
      outcomes: [],
    };
    state.candidate = candidate;
    state.evidence = {
      order: evidence.order,
      features: [...evidence.features],
      correlation: evidence.correlation,
      samples: evidence.samples,
    };
    state.state = 'canary';
    state.lastTransitionAt = Date.now();
    state.lastReason = `interaction order ${evidence.order} nominated bounded priority bias ${bias}`;
    this.emit('candidate-nominated', this.statusFor(state));
  }

  private evaluate(state: KindState): void {
    if (!state.candidate) return;
    if (state.state === 'canary') {
      const candidate = strategySummary(state.candidate);
      const baseline = strategySummary(state.baseline, Math.max(32, this.options.minBaselineSamples));
      if (candidate.samples >= this.options.minCandidateSamples && this.qualifies(candidate, baseline)) {
        state.state = 'active';
        state.promotions += 1;
        state.frozenBaseline = baseline;
        state.lastTransitionAt = Date.now();
        state.lastReason = `canary promoted: effective power and tail/failure guardrails passed`;
        this.emit('candidate-promoted', this.statusFor(state));
        return;
      }
      if (candidate.samples >= this.options.maxCanarySamples) {
        this.rollback(state, 'canary did not beat baseline within guardrails');
      }
      return;
    }

    if (state.state === 'active') {
      const candidate = strategySummary(state.candidate, this.options.rollbackWindow);
      const baseline = state.frozenBaseline;
      if (!baseline || candidate.samples < this.options.rollbackWindow) return;
      const powerBad = baseline.medianEffectivePower !== null && candidate.medianEffectivePower !== null &&
        candidate.medianEffectivePower < baseline.medianEffectivePower * this.options.rollbackPowerRatio;
      const latencyBad = baseline.p95LatencyMs !== null && candidate.p95LatencyMs !== null &&
        candidate.p95LatencyMs > baseline.p95LatencyMs * this.options.rollbackP95Ratio;
      const failureBad = candidate.failureRate > baseline.failureRate + this.options.rollbackFailureRateIncrease;
      if (powerBad || latencyBad || failureBad) {
        this.rollback(state, `automatic rollback: power=${powerBad}, latency=${latencyBad}, failures=${failureBad}`);
      }
    }
  }

  private qualifies(candidate: QuantiAdaptiveStrategySummary, baseline: QuantiAdaptiveStrategySummary): boolean {
    if (candidate.medianEffectivePower === null || baseline.medianEffectivePower === null) return false;
    if (candidate.p95LatencyMs === null || baseline.p95LatencyMs === null) return false;
    const powerOk = candidate.medianEffectivePower >= baseline.medianEffectivePower * (1 + this.options.minPowerGain);
    const latencyOk = candidate.p95LatencyMs <= baseline.p95LatencyMs * (1 + this.options.maxP95Regression);
    const failureOk = candidate.failureRate <= baseline.failureRate + this.options.maxFailureRateIncrease;
    return powerOk && latencyOk && failureOk;
  }

  private rollback(state: KindState, reason: string): void {
    state.state = 'rolled_back';
    state.rollbacks += 1;
    state.cooldownRemaining = this.options.cooldownSubmissions;
    state.lastTransitionAt = Date.now();
    state.lastReason = reason;
    state.candidate = null;
    state.evidence = null;
    state.frozenBaseline = null;
    this.emit('candidate-rolled-back', this.statusFor(state));
  }

  private ensureKind(kind: string): KindState {
    let state = this.kinds.get(kind);
    if (state) return state;
    state = {
      kind,
      state: 'baseline',
      baseline: { id: 'baseline', priorityBias: 0, outcomes: [] },
      candidate: null,
      evidence: null,
      submissions: 0,
      cooldownRemaining: 0,
      promotions: 0,
      rollbacks: 0,
      lastTransitionAt: null,
      lastReason: null,
      frozenBaseline: null,
    };
    this.kinds.set(kind, state);
    return state;
  }

  private strategyFor(state: KindState, strategyId: string): StrategyState | null {
    if (strategyId === state.baseline.id) return state.baseline;
    if (state.candidate?.id === strategyId) return state.candidate;
    return null;
  }

  private toPlan(state: KindState, strategy: StrategyState, canary: boolean): QuantiAdaptivePlan {
    return {
      kind: state.kind,
      strategyId: strategy.id,
      state: state.state,
      priorityBias: strategy.priorityBias,
      canary,
      evidence: state.evidence || undefined,
    };
  }

  private trim(strategy: StrategyState): void {
    if (strategy.outcomes.length > this.options.observationWindow) {
      strategy.outcomes.splice(0, strategy.outcomes.length - this.options.observationWindow);
    }
  }

  private claimObservation(observationId?: string): boolean {
    if (!observationId) return true;
    if (this.seenObservations.has(observationId)) return false;
    this.seenObservations.add(observationId);
    if (this.seenObservations.size > 4096) {
      const first = this.seenObservations.values().next().value;
      if (first) this.seenObservations.delete(first);
    }
    return true;
  }

  private statusFor(state: KindState): QuantiAdaptiveKindStatus {
    return {
      kind: state.kind,
      state: state.state,
      activeStrategyId: state.state === 'active' && state.candidate ? state.candidate.id : 'baseline',
      priorityBias: state.state === 'active' && state.candidate ? state.candidate.priorityBias : 0,
      baseline: strategySummary(state.baseline),
      candidate: state.candidate ? strategySummary(state.candidate) : null,
      evidence: state.evidence ? { ...state.evidence, features: [...state.evidence.features] } : null,
      cooldownRemaining: state.cooldownRemaining,
      submissions: state.submissions,
      promotions: state.promotions,
      rollbacks: state.rollbacks,
      lastTransitionAt: state.lastTransitionAt,
      lastReason: state.lastReason,
    };
  }
}

export const quantiAdaptiveOptimizer = new QuantiAdaptiveOptimizer();
