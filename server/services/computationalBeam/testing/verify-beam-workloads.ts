import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DirectionalBeamLayer } from '../directionalBeamLayer';
import { Task, TaskIntensity, TaskType } from '../types';

function createTask(id: string, workload: Task['workload']): Task {
  return {
    id,
    type: TaskType.MONTE_CARLO,
    intensity: TaskIntensity.HEAVY,
    payload: {},
    workload,
    metadata: {
      created: new Date(),
      priority: 100,
      retries: 0,
      maxRetries: 0,
    },
  };
}

async function waitForEvent(layer: DirectionalBeamLayer, event: 'task-completed' | 'task-failed', taskId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 2_000);
    layer.on(event, (data) => {
      if (data.taskId === taskId) {
        clearTimeout(timeout);
        resolve(data);
      }
    });
  });
}

async function verifyRealExecution(): Promise<void> {
  const layer = new DirectionalBeamLayer();
  const input = 'beam-verification';
  let expected = input;
  for (let index = 0; index < 20_000; index += 1) {
    expected = createHash('sha256').update(expected).digest('hex');
  }
  const task = createTask('beam-real-workload', {
    id: 'deterministic-hash',
    type: 'verification',
    input,
    timeoutMs: 1_000,
    execute(value) {
      let result = String(value);
      for (let index = 0; index < 20_000; index += 1) {
        result = createHash('sha256').update(result).digest('hex');
      }
      return result;
    },
    validate(result) {
      return typeof result === 'string' && result.length === 64;
    },
  });

  const completion = waitForEvent(layer, 'task-completed', task.id);
  await layer.acceptTask(task);
  const event = await completion;
  assert.equal(event.result, expected);
  assert.ok(event.metrics.cpuTimeMs >= 0);
  assert.ok(event.duration >= 0);
}

async function verifyCancellation(): Promise<void> {
  const layer = new DirectionalBeamLayer();
  const task = createTask('beam-cancel-workload', {
    id: 'cancellable-workload',
    type: 'verification',
    input: undefined,
    timeoutMs: 1_000,
    async execute(_input, context) {
      while (!context.signal.aborted) {
        await new Promise(resolve => setImmediate(resolve));
      }
      throw new Error('cancelled');
    },
    validate() {
      return false;
    },
  });

  const failure = waitForEvent(layer, 'task-failed', task.id);
  await layer.acceptTask(task);
  assert.equal(layer.cancelTask(task.id), true);
  const event = await failure;
  assert.match(event.error, /cancelled|timed out/i);
}

await verifyRealExecution();
await verifyCancellation();
console.log('Computational Beam workload verification passed');