import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import logger from '../../../logger.js';

export type LatencyStage =
  | 'ingest'
  | 'normalize'
  | 'candidate'
  | 'deterministic_economics'
  | 'ml_advisory'
  | 'mc_cache'
  | 'governance_risk'
  | 'resource_lease'
  | 'submit'
  | 'exchange_rpc_ack'
  | 'terminal_settlement'
  | 'learning_enqueue';

export type LatencyWorkKind = 'queue' | 'compute' | 'network';
export type LatencyOutcome = 'ok' | 'timeout' | 'cancel' | 'retry' | 'error';

export interface LatencyDimensions {
  traceId?: string;
  worker?: string;
  backend?: string;
  provider?: string;
  venue?: string;
  chain?: string;
  symbol?: string;
  strategy?: string;
}

export interface LatencySample extends LatencyDimensions {
  stage: LatencyStage;
  kind: LatencyWorkKind;
  durationMs: number;
  outcome: LatencyOutcome;
  observedAt: number;
}

export interface LatencyDistribution {
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  timeouts: number;
  cancels: number;
  retries: number;
  errors: number;
  measuredSlo: {
    status: 'insufficient_samples' | 'measured_baseline';
    basis: 'measured_p95_p99_with_25pct_margin';
    suggestedP95Ms: number | null;
    suggestedP99Ms: number | null;
  };
}

export interface RuntimePressureSnapshot {
  observedAt: number;
  eventLoopDelayMs: {
    enabled: boolean;
    mean: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
  };
  gc: {
    observations: number;
    totalDurationMs: number;
    maxDurationMs: number;
  };
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  };
}

export interface LatencyHarnessSnapshot {
  authority: 'telemetry_only';
  executionAuthority: false;
  sampleCount: number;
  byStage: Record<LatencyStage, LatencyDistribution>;
  byKind: Record<LatencyWorkKind, LatencyDistribution>;
  pressure: RuntimePressureSnapshot;
}

interface SpanHandle {
  end(outcome?: LatencyOutcome, extraDimensions?: LatencyDimensions): number;
}

const STAGES: LatencyStage[] = [
  'ingest',
  'normalize',
  'candidate',
  'deterministic_economics',
  'ml_advisory',
  'mc_cache',
  'governance_risk',
  'resource_lease',
  'submit',
  'exchange_rpc_ack',
  'terminal_settlement',
  'learning_enqueue',
];
const KINDS: LatencyWorkKind[] = ['queue', 'compute', 'network'];
const MAX_SAMPLES = Math.max(512, Math.min(50_000, Number(process.env.CRYPTOCRAWL_LATENCY_SAMPLE_LIMIT || 10_000)));
const MIN_SLO_SAMPLES = Math.max(20, Math.min(10_000, Number(process.env.CRYPTOCRAWL_LATENCY_SLO_MIN_SAMPLES || 100)));

function monotonicNowNs(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(durationNs: bigint): number {
  return Number(durationNs) / 1_000_000;
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function distribution(samples: readonly LatencySample[]): LatencyDistribution {
  const durations = samples.map(sample => sample.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  const p95 = percentile(durations, 0.95);
  const p99 = percentile(durations, 0.99);
  const enough = durations.length >= MIN_SLO_SAMPLES;
  return {
    samples: durations.length,
    p50Ms: percentile(durations, 0.50),
    p95Ms: p95,
    p99Ms: p99,
    maxMs: durations.length > 0 ? durations[durations.length - 1] : null,
    timeouts: samples.filter(sample => sample.outcome === 'timeout').length,
    cancels: samples.filter(sample => sample.outcome === 'cancel').length,
    retries: samples.filter(sample => sample.outcome === 'retry').length,
    errors: samples.filter(sample => sample.outcome === 'error').length,
    measuredSlo: {
      status: enough ? 'measured_baseline' : 'insufficient_samples',
      basis: 'measured_p95_p99_with_25pct_margin',
      suggestedP95Ms: enough && p95 !== null ? p95 * 1.25 : null,
      suggestedP99Ms: enough && p99 !== null ? p99 * 1.25 : null,
    },
  };
}

class EndToEndLatencyHarness {
  private readonly samples: LatencySample[] = [];
  private readonly eventLoop = process.env.NO_INTERVALS === 'true'
    ? null
    : monitorEventLoopDelay({ resolution: 20 });
  private gcObservations = 0;
  private gcTotalDurationMs = 0;
  private gcMaxDurationMs = 0;
  private readonly gcObserver: PerformanceObserver | null;

  constructor() {
    this.eventLoop?.enable();
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!Number.isFinite(entry.duration) || entry.duration < 0) continue;
          this.gcObservations++;
          this.gcTotalDurationMs += entry.duration;
          this.gcMaxDurationMs = Math.max(this.gcMaxDurationMs, entry.duration);
        }
      });
      observer.observe({ entryTypes: ['gc'] });
    } catch {
      observer = null;
    }
    this.gcObserver = observer;
  }

  startSpan(stage: LatencyStage, kind: LatencyWorkKind, dimensions: LatencyDimensions = {}): SpanHandle {
    const startedAtNs = monotonicNowNs();
    let ended = false;
    return {
      end: (outcome: LatencyOutcome = 'ok', extraDimensions: LatencyDimensions = {}) => {
        if (ended) return 0;
        ended = true;
        const durationMs = Math.max(0, nsToMs(monotonicNowNs() - startedAtNs));
        this.record({
          stage,
          kind,
          durationMs,
          outcome,
          observedAt: Date.now(),
          ...dimensions,
          ...extraDimensions,
        });
        return durationMs;
      },
    };
  }

  measureSync<T>(
    stage: LatencyStage,
    kind: LatencyWorkKind,
    dimensions: LatencyDimensions,
    work: () => T,
  ): T {
    const span = this.startSpan(stage, kind, dimensions);
    try {
      const result = work();
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  }

  async measureAsync<T>(
    stage: LatencyStage,
    kind: LatencyWorkKind,
    dimensions: LatencyDimensions,
    work: () => Promise<T>,
  ): Promise<T> {
    const span = this.startSpan(stage, kind, dimensions);
    try {
      const result = await work();
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  }

  record(sample: LatencySample): void {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
    this.samples.push({ ...sample });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  recordOutcome(
    stage: LatencyStage,
    kind: LatencyWorkKind,
    durationMs: number,
    outcome: LatencyOutcome,
    dimensions: LatencyDimensions = {},
  ): void {
    this.record({ stage, kind, durationMs, outcome, observedAt: Date.now(), ...dimensions });
  }

  getSnapshot(): LatencyHarnessSnapshot {
    const byStage = Object.fromEntries(STAGES.map(stage => [stage, distribution(this.samples.filter(sample => sample.stage === stage))])) as Record<LatencyStage, LatencyDistribution>;
    const byKind = Object.fromEntries(KINDS.map(kind => [kind, distribution(this.samples.filter(sample => sample.kind === kind))])) as Record<LatencyWorkKind, LatencyDistribution>;
    return {
      authority: 'telemetry_only',
      executionAuthority: false,
      sampleCount: this.samples.length,
      byStage,
      byKind,
      pressure: this.getRuntimePressure(),
    };
  }

  getRecentSamples(limit = 256): LatencySample[] {
    return this.samples.slice(-Math.max(1, Math.min(MAX_SAMPLES, Math.floor(limit)))).map(sample => ({ ...sample }));
  }

  logMeasuredBaseline(): void {
    const snapshot = this.getSnapshot();
    logger.info('[LatencyHarness] Measured runtime latency baseline', {
      component: 'EndToEndLatencyHarness',
      ...snapshot,
      syntheticBenchmarkAuthority: false,
      hfturboMockLatencyAuthority: false,
    });
  }

  private getRuntimePressure(): RuntimePressureSnapshot {
    const memory = process.memoryUsage();
    const eventLoopEnabled = this.eventLoop !== null;
    const toMs = (nanoseconds: number): number | null =>
      eventLoopEnabled && Number.isFinite(nanoseconds) ? nanoseconds / 1_000_000 : null;
    return {
      observedAt: Date.now(),
      eventLoopDelayMs: {
        enabled: eventLoopEnabled,
        mean: eventLoopEnabled ? toMs(this.eventLoop!.mean) : null,
        p95: eventLoopEnabled ? toMs(this.eventLoop!.percentile(95)) : null,
        p99: eventLoopEnabled ? toMs(this.eventLoop!.percentile(99)) : null,
        max: eventLoopEnabled ? toMs(this.eventLoop!.max) : null,
      },
      gc: {
        observations: this.gcObservations,
        totalDurationMs: this.gcTotalDurationMs,
        maxDurationMs: this.gcMaxDurationMs,
      },
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
    };
  }
}

export const endToEndLatencyHarness = new EndToEndLatencyHarness();
