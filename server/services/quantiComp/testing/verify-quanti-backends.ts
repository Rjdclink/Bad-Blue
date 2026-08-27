import assert from 'node:assert/strict';
import { QuantiBackendRegistry } from '../backendRegistry.js';
import { installQuantiBackendRouting } from '../backendRuntime.js';
import type { QuantiExecutionContext, QuantiExecutionMetrics, QuantiExecutionResult, QuantiWorkload } from '../types.js';

function metrics(power: number, latency = 10): QuantiExecutionMetrics {
  return {
    queueLatencyMs: 0, executionMs: latency, validationMs: 0, totalLatencyMs: latency,
    cpuUserMs: 0, cpuSystemMs: 0, cpuTotalMs: 0, rssDeltaBytes: 0, heapDeltaBytes: 0,
    usefulWorkUnits: power * latency / 1000, usefulThroughputPerSecond: power,
    backend: 'inline', resourceBefore: {} as QuantiExecutionMetrics['resourceBefore'], resourceAfter: {} as QuantiExecutionMetrics['resourceAfter'],
  };
}

const registry = new QuantiBackendRegistry({
  minBaselineSamples: 4, minCandidateSamples: 2, maxCanarySamples: 4,
  canaryEvery: 1, minPowerGain: 0.10, rollbackWindow: 2, cooldownPlans: 3,
});
let alternateCalls = 0;
registry.registerBackend<number, number>({
  kind: 'verify.backend', backend: 'worker_thread',
  execute: value => { alternateCalls += 1; return value * 2; },
});

let fastAlternate = true;
let execution = 0;
const fake = {
  getInteractionInsights: () => [],
  async submit<Input, Result>(workload: QuantiWorkload<Input, Result>): Promise<QuantiExecutionResult<Result>> {
    execution += 1;
    const context: QuantiExecutionContext = {
      signal: new AbortController().signal, executionId: `x${execution}`, workerId: 'verify', backend: 'inline', queuedAt: Date.now(), startedAt: Date.now(),
    };
    const result = await workload.execute(workload.input, context);
    assert.equal(await workload.validate(result as Result, workload.input), true);
    const selected = workload.resourceHints?.preferredBackend || 'inline';
    const throughput = selected === 'worker_thread' ? (fastAlternate ? 130 : 60) : 100;
    return { executionId: context.executionId, workloadId: workload.id, kind: workload.kind, validated: true, result: result as Result, metrics: metrics(throughput, selected === 'worker_thread' && !fastAlternate ? 15 : 10) };
  },
};
installQuantiBackendRouting(fake, registry);
installQuantiBackendRouting(fake, registry);

const workload = (id: string, lane: QuantiWorkload['lane'] = 'warm', eligible = true): QuantiWorkload<number, number> => ({
  id, kind: 'verify.backend', lane, priority: 1, input: 21,
  policy: { timeoutMs: 1000, deterministic: true, sideEffectFree: true, backendEligible: eligible },
  execute: value => value * 2,
  validate: value => value === 42,
});

for (let i = 0; i < 4; i += 1) await fake.submit(workload(`base${i}`));
await new Promise(resolve => setImmediate(resolve));
assert.equal(registry.getKindStatus('verify.backend').state, 'baseline');

await fake.submit(workload('canary1'));
await fake.submit(workload('canary2'));
await new Promise(resolve => setImmediate(resolve));
assert.equal(alternateCalls, 2);
assert.equal(registry.getKindStatus('verify.backend').state, 'active');
assert.equal(registry.getKindStatus('verify.backend').activeBackend, 'worker_thread');

const active = await fake.submit(workload('active'));
await new Promise(resolve => setImmediate(resolve));
assert.equal(active.metrics.backend, 'worker_thread');
assert.equal(active.result, 42);

const unsafe = await fake.submit(workload('unsafe', 'warm', false));
await new Promise(resolve => setImmediate(resolve));
assert.equal(unsafe.metrics.backend, 'inline');

fastAlternate = false;
await fake.submit(workload('regress1'));
await fake.submit(workload('regress2'));
await new Promise(resolve => setImmediate(resolve));
assert.equal(registry.getKindStatus('verify.backend').state, 'rolled_back');
assert.equal(registry.getKindStatus('verify.backend').activeBackend, 'inline');

const secondary = new QuantiBackendRegistry({ minBaselineSamples: 4, minCandidateSamples: 2, canaryEvery: 1 });
secondary.registerBackend({ kind: 'hot-check', backend: 'wasm', execute: value => value });
for (let i = 0; i < 4; i += 1) secondary.recordSuccess('hot-check', 'inline', metrics(100), `h${i}`);
assert.equal(secondary.plan('hot-check', 'hot', true).backend, 'inline');
assert.equal(secondary.getKindStatus('hot-check').state, 'canary');
assert.equal(secondary.plan('hot-check', 'warm', true).backend, 'wasm');
secondary.recordSuccess('hot-check', 'wasm', metrics(120), 'hc1');
assert.equal(secondary.plan('hot-check', 'warm', true).backend, 'wasm');
secondary.recordSuccess('hot-check', 'wasm', metrics(120), 'hc2');
assert.equal(secondary.getKindStatus('hot-check').state, 'active');
assert.equal(secondary.unregisterBackend('hot-check', 'wasm'), true);
assert.equal(secondary.getKindStatus('hot-check').state, 'rolled_back');

const capabilities = registry.getStatus().capabilities;
assert.equal(capabilities.find(item => item.backend === 'worker_thread')?.environmentDetected, true);
assert.equal(capabilities.find(item => item.backend === 'gpu')?.authoritative, false);
console.log('Quanti heterogeneous backend verification passed');
