import { QuantiCompError, type QuantiExecutionResult, type QuantiWorkload } from './types.js';
import type { QuantiCompRuntime, QuantiSubmitOptions } from './runtime.js';

const installed = new WeakSet<object>();
let pressureState: 'normal' | 'pressured' = 'normal';

function isAdvisoryLane(lane: QuantiWorkload['lane']): boolean { return lane === 'background' || lane === 'batch' || lane === 'warm'; }

export function installQuantiAdmissionControl(runtime: QuantiCompRuntime): void {
  if (installed.has(runtime)) return;
  installed.add(runtime);
  const originalSubmit = runtime.submit.bind(runtime);
  runtime.submit = function boundedSubmit<Input, Result>(workload: QuantiWorkload<Input, Result>, options: QuantiSubmitOptions = {}): Promise<QuantiExecutionResult<Result>> {
    const status = runtime.getStatus();
    const hardQueue = Math.max(64, Number(process.env.QUANTI_COMP_HARD_QUEUE_LIMIT || 4096));
    const softQueue = Math.max(32, Math.min(hardQueue - 1, Number(process.env.QUANTI_COMP_SOFT_QUEUE_LIMIT || Math.floor(hardQueue * 0.75))));
    const reserveHot = Math.max(1, Math.min(status.maxConcurrency, Number(process.env.QUANTI_COMP_RESERVED_HOT_CAPACITY || 1)));
    const memoryPressure = status.resource.totalMemoryBytes > 0 ? 1 - status.resource.freeMemoryBytes / status.resource.totalMemoryBytes : 0;
    const high = status.resource.eventLoopUtilization >= 0.92 || status.resource.eventLoopDelayP95Ms >= 100 || memoryPressure >= 0.92;
    const recovered = status.resource.eventLoopUtilization <= 0.75 && status.resource.eventLoopDelayP95Ms <= 40 && memoryPressure <= 0.80;
    if (pressureState === 'normal' && high) pressureState = 'pressured';
    else if (pressureState === 'pressured' && recovered) pressureState = 'normal';

    if (status.queuedExecutions >= hardQueue) {
      return Promise.reject(new QuantiCompError('Quanti Comp hard queue limit reached', 'INVALID_WORKLOAD', { workloadId: workload.id, queueDepth: status.queuedExecutions, reason: 'overloaded' }));
    }
    const reserved = status.activeExecutions >= Math.max(0, status.maxConcurrency - reserveHot);
    if (isAdvisoryLane(workload.lane) && (status.queuedExecutions >= softQueue || pressureState === 'pressured' || reserved)) {
      return Promise.reject(new QuantiCompError('Advisory Quanti workload shed to preserve hot safety/decision capacity', 'INVALID_WORKLOAD', {
        workloadId: workload.id, lane: workload.lane, queueDepth: status.queuedExecutions, pressureState, reserveHot, reason: 'advisory_overload_shed',
      }));
    }
    return originalSubmit(workload, options);
  } as QuantiCompRuntime['submit'];
}

export async function submitCoalescedQuantiBatch<Input, Result>(runtime: QuantiCompRuntime, workloads: QuantiWorkload<Input, Result>[], options: QuantiSubmitOptions = {}): Promise<Array<PromiseSettledResult<QuantiExecutionResult<Result>>>> {
  const unique = new Map<string, QuantiWorkload<Input, Result>>();
  for (const workload of workloads) unique.set(workload.policy.dedupeKey || workload.id, workload);
  return Promise.allSettled([...unique.values()].map(workload => runtime.submit(workload, options)));
}

export function getQuantiAdmissionControlHealth() {
  return { pressureState, boundedQueue: true as const, advisoryShedBeforeSafetyCritical: true as const, reservedHotCapacity: true as const, coalescedBatchSupport: true as const };
}
