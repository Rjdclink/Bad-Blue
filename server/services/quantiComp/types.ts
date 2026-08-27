export const QUANTI_COMP_VERSION = 'quanti-comp-0.1.0';

export type QuantiLane = 'ultra_hot' | 'hot' | 'warm' | 'batch' | 'background';
export type QuantiBackend = 'inline' | 'worker_thread' | 'wasm' | 'native' | 'gpu' | 'remote';

export interface QuantiResourceHints {
  cpuWeight?: number;
  memoryMB?: number;
  ioWeight?: number;
  expectedDurationMs?: number;
  preferredBackend?: QuantiBackend;
  parallelismHint?: number;
}

export interface QuantiExecutionPolicy {
  timeoutMs: number;
  deadlineAt?: number;
  deterministic?: boolean;
  sideEffectFree?: boolean;
  backendEligible?: boolean;
  allowDeduplication?: boolean;
  dedupeKey?: string;
  usefulWorkUnits?: number;
  strictValidation?: boolean;
}

export interface QuantiExecutionContext {
  signal: AbortSignal;
  executionId: string;
  workerId: string;
  backend: QuantiBackend;
  queuedAt: number;
  startedAt: number;
}

export interface QuantiWorkload<Input = unknown, Result = unknown> {
  id: string;
  kind: string;
  lane: QuantiLane;
  priority: number;
  createdAt?: number;
  input: Input;
  features?: Record<string, number>;
  resourceHints?: QuantiResourceHints;
  policy: QuantiExecutionPolicy;
  execute: (input: Input, context: QuantiExecutionContext) => Promise<Result> | Result;
  validate: (result: Result, input: Input) => Promise<boolean> | boolean;
}

export interface QuantiResourceSnapshot {
  timestamp: number;
  logicalCpus: number;
  availableParallelism: number;
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  cpuUtilizationPercent: number | null;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalMemoryBytes: number;
  arrayBuffersBytes: number;
  eventLoopUtilization: number;
  eventLoopDelayP95Ms: number;
}

export interface QuantiExecutionMetrics {
  queueLatencyMs: number;
  executionMs: number;
  validationMs: number;
  totalLatencyMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuTotalMs: number;
  rssDeltaBytes: number;
  heapDeltaBytes: number;
  usefulWorkUnits: number;
  usefulThroughputPerSecond: number;
  backend: QuantiBackend;
  resourceBefore: QuantiResourceSnapshot;
  resourceAfter: QuantiResourceSnapshot;
}

export interface QuantiExecutionResult<Result = unknown> {
  executionId: string;
  workloadId: string;
  kind: string;
  validated: true;
  result: Result;
  metrics: QuantiExecutionMetrics;
}

export interface QuantiProfileSummary {
  kind: string;
  samples: number;
  failures: number;
  successRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  cpuP50Ms: number | null;
  throughputP50PerSecond: number | null;
}

export interface QuantiInteractionInsight {
  kind: string;
  target: 'useful_throughput_per_second';
  features: string[];
  order: number;
  correlation: number;
  absoluteCorrelation: number;
  samples: number;
}

export interface QuantiRuntimeStatus {
  version: string;
  initialized: boolean;
  maxConcurrency: number;
  activeExecutions: number;
  queuedExecutions: number;
  inFlightDeduplicatedKeys: number;
  completedExecutions: number;
  failedExecutions: number;
  resource: QuantiResourceSnapshot;
  profiles: QuantiProfileSummary[];
  interactionObservationKinds: number;
}

export type QuantiCompErrorCode =
  | 'INVALID_WORKLOAD'
  | 'DEADLINE_EXPIRED'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'VALIDATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'SHUTDOWN';

export class QuantiCompError extends Error {
  constructor(
    message: string,
    public readonly code: QuantiCompErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'QuantiCompError';
  }
}
