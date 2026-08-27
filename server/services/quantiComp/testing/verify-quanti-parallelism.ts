import assert from 'node:assert/strict';
import {
  QuantiParallelismError,
  QuantiParallelismGovernor,
} from '../parallelismGovernor.js';

async function verifyPriorityAndCapacity(): Promise<void> {
  const governor = new QuantiParallelismGovernor({ capacityUnits: 2 });
  const gate = await governor.acquire({ id: 'gate', units: 2, lane: 'batch', priority: 1 });
  const order: string[] = [];
  const low = governor.acquire({ id: 'low', units: 1, lane: 'batch', priority: 100 }).then(lease => {
    order.push('low');
    lease.release();
  });
  const high = governor.acquire({ id: 'high', units: 1, lane: 'hot', priority: 1 }).then(lease => {
    order.push('high');
    lease.release();
  });
  gate.release();
  await Promise.all([low, high]);
  assert.deepEqual(order, ['high', 'low']);
  const status = governor.getStatus();
  assert.equal(status.activeUnits, 0);
  assert.equal(status.peakActiveUnits, 2);
  assert.equal(status.grantedReservations, 3);
  governor.shutdown();
}

async function verifyDeadlineAndCancellation(): Promise<void> {
  const governor = new QuantiParallelismGovernor({ capacityUnits: 1 });
  const gate = await governor.acquire({ id: 'gate', units: 1, lane: 'hot', priority: 100 });
  await assert.rejects(
    governor.acquire({ id: 'deadline', units: 1, lane: 'hot', priority: 90, deadlineAt: Date.now() + 20 }),
    (error: unknown) => error instanceof QuantiParallelismError && error.code === 'DEADLINE_EXPIRED',
  );

  const controller = new AbortController();
  const cancelled = governor.acquire({ id: 'cancelled', units: 1, lane: 'hot', priority: 90, signal: controller.signal });
  controller.abort();
  await assert.rejects(
    cancelled,
    (error: unknown) => error instanceof QuantiParallelismError && error.code === 'ABORTED',
  );
  gate.release();
  assert.equal(governor.getStatus().activeUnits, 0);
  governor.shutdown();
}

await verifyPriorityAndCapacity();
await verifyDeadlineAndCancellation();
console.log('Quanti parallelism governor verification passed');
