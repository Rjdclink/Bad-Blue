import type { QuantiExecutionResult, QuantiInteractionInsight, QuantiWorkload } from './types.js';
import type { QuantiSubmitOptions } from './runtime.js';
import { QuantiBackendRegistry } from './backendRegistry.js';

type BackendRuntimeTarget = {
  submit<Input, Result>(workload: QuantiWorkload<Input, Result>, options?: QuantiSubmitOptions): Promise<QuantiExecutionResult<Result>>;
  getInteractionInsights(kind: string, limit?: number): QuantiInteractionInsight[];
};

const installed = new WeakSet<object>();

export function installQuantiBackendRouting(runtime: BackendRuntimeTarget, registry: QuantiBackendRegistry): void {
  if (installed.has(runtime as object)) return;
  installed.add(runtime as object);
  const originalSubmit = runtime.submit.bind(runtime);

  runtime.submit = function backendSubmit<Input, Result>(
    workload: QuantiWorkload<Input, Result>,
    options: QuantiSubmitOptions = {},
  ): Promise<QuantiExecutionResult<Result>> {
    const eligible = workload.policy.deterministic === true && workload.policy.sideEffectFree === true && workload.policy.backendEligible === true;
    const plan = registry.plan(workload.kind, workload.lane, eligible);
    const executor = registry.getExecutor(workload.kind, plan.backend);
    const adjusted: QuantiWorkload<Input, Result> = executor
      ? {
          ...workload,
          resourceHints: { ...workload.resourceHints, preferredBackend: plan.backend },
          features: {
            ...workload.features,
            heterogeneousBackend: plan.backend === 'inline' ? 0 : 1,
            heterogeneousCanary: plan.canary ? 1 : 0,
          },
          execute: (input, context) => executor.execute(input, { ...context, backend: plan.backend }) as Promise<Result> | Result,
        }
      : workload;

    const promise = originalSubmit(adjusted, options);
    void promise.then(
      result => {
        result.metrics.backend = plan.backend;
        registry.recordSuccess(workload.kind, plan.backend, result.metrics, result.executionId);
      },
      () => registry.recordFailure(workload.kind, plan.backend, `failure:${workload.id}:${plan.backend}`),
    );
    return promise;
  };
}
