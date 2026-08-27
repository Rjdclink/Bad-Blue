import { EventEmitter } from 'node:events';
import type {
  QuantiBackend,
  QuantiExecutionContext,
  QuantiExecutionMetrics,
  QuantiLane,
} from './types.js';

export type QuantiBackendRouteState = 'baseline' | 'canary' | 'active' | 'rolled_back';

export interface QuantiBackendExecutor<Input = unknown, Result = unknown> {
  kind: string;
  backend: Exclude<QuantiBackend, 'inline'>;
  execute: (input: Input, context: QuantiExecutionContext) => Promise<Result> | Result;
}

export interface QuantiBackendRegistryOptions {
  minBaselineSamples?: number;
  minCandidateSamples?: number;
  maxCanarySamples?: number;
  canaryEvery?: number;
  minPowerGain?: number;
  maxP95Regression?: number;
  maxFailureRateIncrease?: number;
  rollbackWindow?: number;
  rollbackPowerRatio?: number;
  rollbackP95Ratio?: number;
  rollbackFailureRateIncrease?: number;
  cooldownPlans?: number;
  observationWindow?: number;
}

export interface QuantiBackendPlan {
  kind: string;
  backend: QuantiBackend;
  state: QuantiBackendRouteState;
  canary: boolean;
  reason: string;
}

export interface QuantiBackendSummary {
  backend: QuantiBackend;
  samples: number;
  successes: number;
  failures: number;
  failureRate: number;
  medianEffectivePower: number | null;
  p95LatencyMs: number | null;
}

export interface QuantiBackendKindStatus {
  kind: string;
  state: QuantiBackendRouteState;
  activeBackend: QuantiBackend;
  candidateBackend: QuantiBackend | null;
  baseline: QuantiBackendSummary;
  candidate: QuantiBackendSummary | null;
  plans: number;
  promotions: number;
  rollbacks: number;
  cooldownRemaining: number;
  lastReason: string | null;
}

export interface QuantiBackendCapability {
  backend: QuantiBackend;
  environmentDetected: boolean;
  registeredKinds: number;
  authoritative: boolean;
}

export interface QuantiBackendRegistryStatus {
  capabilities: QuantiBackendCapability[];
  kinds: QuantiBackendKindStatus[];
  activeKinds: number;
  canaryKinds: number;
}

type Outcome = { success: boolean; power: number; latencyMs: number };
type Route = {
  state: QuantiBackendRouteState;
  candidate: Exclude<QuantiBackend, 'inline'> | null;
  baseline: Outcome[];
  candidateOutcomes: Outcome[];
  frozenBaseline: QuantiBackendSummary | null;
  plans: number;
  promotions: number;
  rollbacks: number;
  cooldownRemaining: number;
  lastReason: string | null;
};

const DEFAULTS = {
  minBaselineSamples: 32,
  minCandidateSamples: 8,
  maxCanarySamples: 16,
  canaryEvery: 8,
  minPowerGain: 0.10,
  maxP95Regression: 0.05,
  maxFailureRateIncrease: 0.01,
  rollbackWindow: 16,
  rollbackPowerRatio: 0.90,
  rollbackP95Ratio: 1.15,
  rollbackFailureRateIncrease: 0.05,
  cooldownPlans: 64,
  observationWindow: 128,
} as const;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))];
}

function power(metrics: QuantiExecutionMetrics): number {
  const cpuShare = metrics.cpuTotalMs / Math.max(1, metrics.totalLatencyMs);
  return Math.max(0, metrics.usefulThroughputPerSecond) / (1 + Math.max(0, cpuShare));
}

function summary(backend: QuantiBackend, outcomes: Outcome[], window?: number): QuantiBackendSummary {
  const rows = window ? outcomes.slice(-window) : outcomes;
  const success = rows.filter(row => row.success);
  const failures = rows.length - success.length;
  return {
    backend,
    samples: rows.length,
    successes: success.length,
    failures,
    failureRate: rows.length ? failures / rows.length : 0,
    medianEffectivePower: median(success.map(row => row.power)),
    p95LatencyMs: percentile(success.map(row => row.latencyMs), 0.95),
  };
}

function canCanaryLane(lane: QuantiLane): boolean {
  return lane === 'warm' || lane === 'batch' || lane === 'background';
}

export class QuantiBackendRegistry extends EventEmitter {
  private readonly options: Required<QuantiBackendRegistryOptions>;
  private readonly executors = new Map<string, Map<Exclude<QuantiBackend, 'inline'>, QuantiBackendExecutor>>();
  private readonly routes = new Map<string, Route>();
  private readonly seen = new Set<string>();

  constructor(options: QuantiBackendRegistryOptions = {}) {
    super();
    this.options = {
      minBaselineSamples: Math.max(4, options.minBaselineSamples ?? DEFAULTS.minBaselineSamples),
      minCandidateSamples: Math.max(2, options.minCandidateSamples ?? DEFAULTS.minCandidateSamples),
      maxCanarySamples: Math.max(2, options.maxCanarySamples ?? DEFAULTS.maxCanarySamples),
      canaryEvery: Math.max(1, options.canaryEvery ?? DEFAULTS.canaryEvery),
      minPowerGain: Math.max(0, options.minPowerGain ?? DEFAULTS.minPowerGain),
      maxP95Regression: Math.max(0, options.maxP95Regression ?? DEFAULTS.maxP95Regression),
      maxFailureRateIncrease: Math.max(0, options.maxFailureRateIncrease ?? DEFAULTS.maxFailureRateIncrease),
      rollbackWindow: Math.max(2, options.rollbackWindow ?? DEFAULTS.rollbackWindow),
      rollbackPowerRatio: Math.max(0.1, Math.min(1, options.rollbackPowerRatio ?? DEFAULTS.rollbackPowerRatio)),
      rollbackP95Ratio: Math.max(1, options.rollbackP95Ratio ?? DEFAULTS.rollbackP95Ratio),
      rollbackFailureRateIncrease: Math.max(0, options.rollbackFailureRateIncrease ?? DEFAULTS.rollbackFailureRateIncrease),
      cooldownPlans: Math.max(1, options.cooldownPlans ?? DEFAULTS.cooldownPlans),
      observationWindow: Math.max(16, options.observationWindow ?? DEFAULTS.observationWindow),
    };
    this.options.maxCanarySamples = Math.max(this.options.minCandidateSamples, this.options.maxCanarySamples);
  }

  registerBackend<Input, Result>(executor: QuantiBackendExecutor<Input, Result>): void {
    if (executor.backend === 'inline') throw new Error('QUANTI_BACKEND_INVALID: inline is the baseline and cannot be registered');
    if (!executor.kind || typeof executor.execute !== 'function') throw new Error('QUANTI_BACKEND_INVALID: kind and execute are required');
    const byBackend = this.executors.get(executor.kind) || new Map();
    byBackend.set(executor.backend, executor as QuantiBackendExecutor);
    this.executors.set(executor.kind, byBackend);
    this.emit('backend-registered', { kind: executor.kind, backend: executor.backend });
  }

  unregisterBackend(kind: string, backend: Exclude<QuantiBackend, 'inline'>): boolean {
    const byBackend = this.executors.get(kind);
    if (!byBackend?.delete(backend)) return false;
    if (!byBackend.size) this.executors.delete(kind);
    const route = this.routes.get(kind);
    if (route?.candidate === backend) this.rollback(kind, route, 'registered backend removed');
    this.emit('backend-unregistered', { kind, backend });
    return true;
  }

  getExecutor(kind: string, backend: QuantiBackend): QuantiBackendExecutor | null {
    if (backend === 'inline') return null;
    return this.executors.get(kind)?.get(backend) || null;
  }

  plan(kind: string, lane: QuantiLane, eligible: boolean): QuantiBackendPlan {
    const route = this.ensureRoute(kind);
    route.plans += 1;
    if (!eligible) return { kind, backend: 'inline', state: route.state, canary: false, reason: 'backend routing requires explicit deterministic side-effect-free eligibility' };

    if ((route.state === 'baseline' || route.state === 'rolled_back') && route.cooldownRemaining > 0) route.cooldownRemaining -= 1;
    if ((route.state === 'baseline' || route.state === 'rolled_back') && route.cooldownRemaining === 0) this.maybeNominate(kind, route);

    if (route.state === 'active' && route.candidate && this.getExecutor(kind, route.candidate)) {
      return { kind, backend: route.candidate, state: route.state, canary: false, reason: 'backend passed measured promotion guardrails' };
    }
    if (route.state === 'canary' && route.candidate && canCanaryLane(lane) && route.plans % this.options.canaryEvery === 0) {
      return { kind, backend: route.candidate, state: route.state, canary: true, reason: 'bounded side-effect-free backend canary' };
    }
    return { kind, backend: 'inline', state: route.state, canary: false, reason: route.state === 'canary' ? 'baseline sample during backend canary' : 'inline baseline' };
  }

  recordSuccess(kind: string, backend: QuantiBackend, metrics: QuantiExecutionMetrics, observationId?: string): void {
    if (!this.claim(observationId)) return;
    const route = this.ensureRoute(kind);
    const row: Outcome = { success: true, power: power(metrics), latencyMs: Math.max(0, metrics.totalLatencyMs) };
    if (backend === 'inline') route.baseline.push(row);
    else if (route.candidate === backend) route.candidateOutcomes.push(row);
    this.trim(route);
    this.evaluate(kind, route);
  }

  recordFailure(kind: string, backend: QuantiBackend, observationId?: string): void {
    if (!this.claim(observationId)) return;
    const route = this.ensureRoute(kind);
    const row: Outcome = { success: false, power: 0, latencyMs: 0 };
    if (backend === 'inline') route.baseline.push(row);
    else if (route.candidate === backend) route.candidateOutcomes.push(row);
    this.trim(route);
    this.evaluate(kind, route);
  }

  getKindStatus(kind: string): QuantiBackendKindStatus {
    return this.statusFor(kind, this.ensureRoute(kind));
  }

  getStatus(): QuantiBackendRegistryStatus {
    const kinds = Array.from(new Set([...this.routes.keys(), ...this.executors.keys()])).map(kind => this.getKindStatus(kind));
    const backends: QuantiBackend[] = ['inline', 'worker_thread', 'wasm', 'native', 'gpu', 'remote'];
    return {
      capabilities: backends.map(backend => ({
        backend,
        environmentDetected: backend === 'inline' || backend === 'worker_thread' || (backend === 'wasm' && typeof WebAssembly !== 'undefined') || this.registeredKindCount(backend) > 0,
        registeredKinds: backend === 'inline' ? 0 : this.registeredKindCount(backend),
        authoritative: backend === 'inline' || kinds.some(item => item.state === 'active' && item.activeBackend === backend),
      })),
      kinds,
      activeKinds: kinds.filter(item => item.state === 'active').length,
      canaryKinds: kinds.filter(item => item.state === 'canary').length,
    };
  }

  private maybeNominate(kind: string, route: Route): void {
    if (summary('inline', route.baseline).samples < this.options.minBaselineSamples) return;
    const registered = Array.from(this.executors.get(kind)?.keys() || []);
    const backend = registered.find(candidate => candidate !== route.candidate);
    if (!backend) return;
    route.candidate = backend;
    route.candidateOutcomes = [];
    route.state = 'canary';
    route.lastReason = `${backend} nominated for measured canary after inline baseline`;
    this.emit('backend-canary-started', this.statusFor(kind, route));
  }

  private evaluate(kind: string, route: Route): void {
    if (!route.candidate) return;
    const candidate = summary(route.candidate, route.candidateOutcomes);
    const baseline = summary('inline', route.baseline, Math.max(this.options.minBaselineSamples, 16));
    if (route.state === 'canary') {
      if (candidate.samples >= this.options.minCandidateSamples && this.qualifies(candidate, baseline)) {
        route.state = 'active';
        route.promotions += 1;
        route.frozenBaseline = baseline;
        route.lastReason = `${route.candidate} promoted by measured backend benchmark`;
        this.emit('backend-promoted', this.statusFor(kind, route));
        return;
      }
      if (candidate.samples >= this.options.maxCanarySamples) this.rollback(kind, route, 'backend canary failed promotion guardrails');
      return;
    }
    if (route.state === 'active') {
      const recent = summary(route.candidate, route.candidateOutcomes, this.options.rollbackWindow);
      const frozen = route.frozenBaseline;
      if (!frozen || recent.samples < this.options.rollbackWindow) return;
      const powerBad = frozen.medianEffectivePower !== null && recent.medianEffectivePower !== null && recent.medianEffectivePower < frozen.medianEffectivePower * this.options.rollbackPowerRatio;
      const latencyBad = frozen.p95LatencyMs !== null && recent.p95LatencyMs !== null && recent.p95LatencyMs > frozen.p95LatencyMs * this.options.rollbackP95Ratio;
      const failureBad = recent.failureRate > frozen.failureRate + this.options.rollbackFailureRateIncrease;
      if (powerBad || latencyBad || failureBad) this.rollback(kind, route, `backend rollback: power=${powerBad}, latency=${latencyBad}, failures=${failureBad}`);
    }
  }

  private qualifies(candidate: QuantiBackendSummary, baseline: QuantiBackendSummary): boolean {
    if (candidate.medianEffectivePower === null || baseline.medianEffectivePower === null) return false;
    if (candidate.p95LatencyMs === null || baseline.p95LatencyMs === null) return false;
    return candidate.medianEffectivePower >= baseline.medianEffectivePower * (1 + this.options.minPowerGain) &&
      candidate.p95LatencyMs <= baseline.p95LatencyMs * (1 + this.options.maxP95Regression) &&
      candidate.failureRate <= baseline.failureRate + this.options.maxFailureRateIncrease;
  }

  private rollback(kind: string, route: Route, reason: string): void {
    route.state = 'rolled_back';
    route.rollbacks += 1;
    route.cooldownRemaining = this.options.cooldownPlans;
    route.lastReason = reason;
    route.candidate = null;
    route.candidateOutcomes = [];
    route.frozenBaseline = null;
    this.emit('backend-rolled-back', this.statusFor(kind, route));
  }

  private ensureRoute(kind: string): Route {
    let route = this.routes.get(kind);
    if (route) return route;
    route = { state: 'baseline', candidate: null, baseline: [], candidateOutcomes: [], frozenBaseline: null, plans: 0, promotions: 0, rollbacks: 0, cooldownRemaining: 0, lastReason: null };
    this.routes.set(kind, route);
    return route;
  }

  private statusFor(kind: string, route: Route): QuantiBackendKindStatus {
    return {
      kind,
      state: route.state,
      activeBackend: route.state === 'active' && route.candidate ? route.candidate : 'inline',
      candidateBackend: route.candidate,
      baseline: summary('inline', route.baseline),
      candidate: route.candidate ? summary(route.candidate, route.candidateOutcomes) : null,
      plans: route.plans,
      promotions: route.promotions,
      rollbacks: route.rollbacks,
      cooldownRemaining: route.cooldownRemaining,
      lastReason: route.lastReason,
    };
  }

  private trim(route: Route): void {
    if (route.baseline.length > this.options.observationWindow) route.baseline.splice(0, route.baseline.length - this.options.observationWindow);
    if (route.candidateOutcomes.length > this.options.observationWindow) route.candidateOutcomes.splice(0, route.candidateOutcomes.length - this.options.observationWindow);
  }

  private claim(id?: string): boolean {
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 4096) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
    return true;
  }

  private registeredKindCount(backend: QuantiBackend): number {
    if (backend === 'inline') return 0;
    let count = 0;
    for (const byBackend of this.executors.values()) if (byBackend.has(backend)) count += 1;
    return count;
  }
}

export const quantiBackendRegistry = new QuantiBackendRegistry();
