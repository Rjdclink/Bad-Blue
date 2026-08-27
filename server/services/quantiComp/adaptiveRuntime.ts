import type {
  QuantiExecutionMetrics,
  QuantiExecutionResult,
  QuantiInteractionInsight,
  QuantiWorkload,
} from './types.js';
import type { QuantiSubmitOptions } from './runtime.js';
import { QuantiAdaptiveOptimizer, type QuantiAdaptivePlan } from './adaptiveOptimizer.js';

type AdaptiveRuntimeTarget = {
  submit<Input, Result>(
    workload: QuantiWorkload<Input, Result>,
    options?: QuantiSubmitOptions,
  ): Promise<QuantiExecutionResult<Result>>;
  getInteractionInsights(kind: string, limit?: number): QuantiInteractionInsight[];
};

const installed = new WeakSet<object>();

function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1_000_000, Math.min(1_000_000, value));
}

export function installQuantiAdaptiveScheduling(
  runtime: AdaptiveRuntimeTarget,
  optimizer: QuantiAdaptiveOptimizer,
): void {
  if (installed.has(runtime as object)) return;
  installed.add(runtime as object);

  const originalSubmit = runtime.submit.bind(runtime);
  runtime.submit = function adaptiveSubmit<Input, Result>(
    workload: QuantiWorkload<Input, Result>,
    options: QuantiSubmitOptions = {},
  ): Promise<QuantiExecutionResult<Result>> {
    const plan = optimizer.plan(workload.kind, runtime.getInteractionInsights(workload.kind, 32));
    const adjusted: QuantiWorkload<Input, Result> = plan.priorityBias === 0
      ? workload
      : {
          ...workload,
          priority: clampPriority(workload.priority + plan.priorityBias),
          features: {
            ...workload.features,
            adaptivePriorityBias: plan.priorityBias,
            adaptiveCandidate: plan.strategyId === 'baseline' ? 0 : 1,
            adaptiveCanary: plan.canary ? 1 : 0,
            adaptiveEvidenceOrder: plan.evidence?.order ?? 0,
          },
        };

    const promise = originalSubmit(adjusted, options);
    void promise.then(
      result => optimizer.recordSuccess(workload.kind, plan.strategyId, result.metrics, result.executionId),
      () => optimizer.recordFailure(workload.kind, plan.strategyId, `failure:${workload.id}:${plan.strategyId}`),
    );
    return promise;
  };
}

export function adaptivePlanFeatureVector(plan: QuantiAdaptivePlan): Record<string, number> {
  return {
    adaptivePriorityBias: plan.priorityBias,
    adaptiveCandidate: plan.strategyId === 'baseline' ? 0 : 1,
    adaptiveCanary: plan.canary ? 1 : 0,
    adaptiveEvidenceOrder: plan.evidence?.order ?? 0,
  };
}

export function effectiveQuantiPower(metrics: QuantiExecutionMetrics): number {
  const cpuShare = metrics.cpuTotalMs / Math.max(1, metrics.totalLatencyMs);
  return Math.max(0, metrics.usefulThroughputPerSecond) / (1 + Math.max(0, cpuShare));
}
