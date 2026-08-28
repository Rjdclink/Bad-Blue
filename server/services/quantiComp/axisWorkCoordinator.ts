import { quantiComp } from './runtime.js';
import { quantiParallelismGovernor } from './parallelismGovernor.js';
import type { QuantiWorkload } from './types.js';

export type QuantiWorkAxis = 'chain' | 'provider' | 'strategy' | 'symbol';
export interface AxisWorkUnit<Input, Result> {
  id: string;
  axis: QuantiWorkAxis;
  partition: string;
  localityKey: string;
  workload: QuantiWorkload<Input, Result>;
}

export async function executeAxialWork<Input, Result>(units: AxisWorkUnit<Input, Result>[]): Promise<Array<PromiseSettledResult<Result>>> {
  const grouped = new Map<string, AxisWorkUnit<Input, Result>[]>();
  for (const unit of units) {
    const key = `${unit.axis}:${unit.partition}:${unit.localityKey}`;
    const group = grouped.get(key) || [];
    group.push(unit);
    grouped.set(key, group);
  }
  const queue = [...grouped.values()].sort((a,b) => b.length - a.length);
  const maxWorkers = Math.max(1, Math.min(8, Number(process.env.QUANTI_AXIS_MAX_WORKERS || 4)));
  const results: Array<PromiseSettledResult<Result>> = [];
  let cursor = 0;

  const worker = async (workerIndex: number) => {
    while (true) {
      // Bounded work stealing: workers take the next remaining locality group only
      // after their current group empties; individual units are never duplicated.
      const index = cursor++;
      if (index >= queue.length) return;
      const group = queue[index];
      const lease = await quantiParallelismGovernor.acquire({
        id: `axis:${workerIndex}:${index}:${Date.now()}`,
        units: 1,
        lane: group.some(unit => unit.workload.lane === 'ultra_hot' || unit.workload.lane === 'hot') ? 'hot' : 'batch',
        priority: Math.max(...group.map(unit => unit.workload.priority)),
        deadlineAt: Math.min(...group.map(unit => unit.workload.policy.deadlineAt ?? Number.MAX_SAFE_INTEGER)),
        metadata: { axis: group[0].axis, partition: group[0].partition, localityKey: group[0].localityKey },
      });
      try {
        for (const unit of group) {
          try {
            const execution = await quantiComp.submit(unit.workload);
            results.push({ status: 'fulfilled', value: execution.result });
          } catch (reason) {
            results.push({ status: 'rejected', reason });
          }
        }
      } finally { lease.release(); }
    }
  };
  await Promise.all(Array.from({length: Math.min(maxWorkers, queue.length)}, (_,index)=>worker(index)));
  return results;
}

export const QUANTI_AXIS_COORDINATION = Object.freeze({
  axes: ['chain','provider','strategy','symbol'] as const,
  independentWorkOnly: true,
  preservesProviderNonceResourceConstraints: true,
  batchesByDataLocality: true,
  boundedWorkStealing: true,
  workerScalingClaimsRequireMeasuredP99Benchmark: true,
  gpuSpeedupClaimsTransferable: false,
});
