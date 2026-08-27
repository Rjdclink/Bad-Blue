import assert from 'node:assert/strict';
import { QuantiCompError, QuantiCompRuntime } from '../index.js';

async function verifyExecutionAndValidation(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 2, workerId: 'verify' });
  const result = await runtime.submit({
    id: 'qc-basic',
    kind: 'verification.basic',
    lane: 'hot',
    priority: 80,
    input: 21,
    features: { inputSize: 1 },
    policy: { timeoutMs: 1_000, usefulWorkUnits: 1 },
    execute: value => value * 2,
    validate: value => value === 42,
  });
  assert.equal(result.result, 42);
  assert.equal(result.validated, true);
  assert.ok(result.metrics.totalLatencyMs >= 0);
  assert.ok(result.metrics.usefulThroughputPerSecond >= 0);
  assert.equal(runtime.getStatus().completedExecutions, 1);
  runtime.shutdown();
}

async function verifyPriorityAndDeadline(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 1, workerId: 'verify' });
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });

  const first = runtime.submit({
    id: 'qc-gate', kind: 'verification.gate', lane: 'hot', priority: 1, input: null,
    policy: { timeoutMs: 1_000 },
    async execute() { order.push('gate'); await gate; return true; },
    validate: value => value === true,
  });
  await new Promise(resolve => setImmediate(resolve));

  const low = runtime.submit({
    id: 'qc-low', kind: 'verification.order', lane: 'warm', priority: 100, input: null,
    policy: { timeoutMs: 1_000 },
    execute() { order.push('low'); return true; },
    validate: value => value === true,
  });
  const high = runtime.submit({
    id: 'qc-high', kind: 'verification.order', lane: 'ultra_hot', priority: 1, input: null,
    policy: { timeoutMs: 1_000 },
    execute() { order.push('high'); return true; },
    validate: value => value === true,
  });
  release();
  await Promise.all([first, low, high]);
  assert.deepEqual(order, ['gate', 'high', 'low']);

  await assert.rejects(
    runtime.submit({
      id: 'qc-expired', kind: 'verification.deadline', lane: 'hot', priority: 1, input: null,
      policy: { timeoutMs: 1_000, deadlineAt: Date.now() - 1 },
      execute: () => true,
      validate: value => value === true,
    }),
    (error: unknown) => error instanceof QuantiCompError && error.code === 'DEADLINE_EXPIRED',
  );
  runtime.shutdown();
}

async function verifyInFlightDeduplication(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 2, workerId: 'verify' });
  let executions = 0;
  const workload = (id: string) => ({
    id,
    kind: 'verification.dedupe',
    lane: 'hot' as const,
    priority: 50,
    input: 'same',
    policy: { timeoutMs: 1_000, allowDeduplication: true, dedupeKey: 'same-work' },
    async execute(value: string) {
      executions += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return value.toUpperCase();
    },
    validate: (value: string) => value === 'SAME',
  });
  const [a, b] = await Promise.all([runtime.submit(workload('a')), runtime.submit(workload('b'))]);
  assert.equal(executions, 1);
  assert.equal(a.executionId, b.executionId);
  runtime.shutdown();
}

async function verifyFifthOrderObservationIsNonAuthoritative(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 2, workerId: 'verify' });
  for (let i = 1; i <= 48; i += 1) {
    await runtime.submit({
      id: `qc-interaction-${i}`,
      kind: 'verification.interactions',
      lane: i % 2 ? 'hot' : 'warm',
      priority: i,
      input: i,
      features: { a: i, b: i % 7, c: i % 5, d: i % 3, e: i % 11, f: i % 13 },
      policy: { timeoutMs: 1_000, usefulWorkUnits: i },
      execute: value => value * value,
      validate: value => Number.isFinite(value),
    });
  }
  const insights = runtime.getInteractionInsights('verification.interactions', 50);
  assert.ok(insights.length > 0);
  assert.ok(insights.every(insight => insight.order >= 1 && insight.order <= 5));
  assert.ok(insights.some(insight => insight.order >= 2));
  runtime.shutdown();
}

async function verifyExternalCancellation(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 1, workerId: 'verify' });
  const controller = new AbortController();
  const pending = runtime.submit({
    id: 'qc-external-cancel',
    kind: 'verification.cancel',
    lane: 'hot',
    priority: 100,
    input: null,
    policy: { timeoutMs: 1_000 },
    async execute(_value, context) {
      while (!context.signal.aborted) await new Promise(resolve => setImmediate(resolve));
      throw new Error('cancelled');
    },
    validate: () => false,
  }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof QuantiCompError && error.code === 'ABORTED',
  );
  runtime.shutdown();
}

await verifyExecutionAndValidation();
await verifyPriorityAndDeadline();
await verifyInFlightDeduplication();
await verifyFifthOrderObservationIsNonAuthoritative();
await verifyExternalCancellation();
console.log('Quanti Comp foundation verification passed');
