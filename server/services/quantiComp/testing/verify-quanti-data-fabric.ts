import assert from 'node:assert/strict';
import { QuantiDataFabric } from '../dataFabric.js';

const fabric = new QuantiDataFabric({ maxPooledBytes: 1024 * 1024, maxBuffersPerClass: 4 });

const first = fabric.acquireFloat64(10, { zero: false });
first.view[0] = 42;
const firstBuffer = first.buffer;
first.release();
const second = fabric.acquireFloat64(10);
assert.equal(second.buffer, firstBuffer);
assert.equal(second.reused, true);
assert.equal(second.view[0], 0);
second.release();

const published = fabric.publishFloat64State('prices', [10, 20, 30]);
assert.equal(published.version, 1);
const pinned = fabric.pinFloat64State('prices');
assert.ok(pinned);
assert.deepEqual(Array.from(pinned!.view), [10, 20, 30]);

const updated = fabric.updateFloat64State('prices', [[1, 25]]);
assert.equal(updated.version, 2);
assert.deepEqual(Array.from(pinned!.view), [10, 20, 30], 'pinned generation must remain immutable');
const current = fabric.pinFloat64State('prices');
assert.ok(current);
assert.deepEqual(Array.from(current!.view), [10, 25, 30]);
pinned!.release();
current!.release();

fabric.updateFloat64State('prices', [[2, 35]]);
const newest = fabric.pinFloat64State('prices');
assert.deepEqual(Array.from(newest!.view), [10, 25, 35]);
newest!.release();

const status = fabric.getStatus();
assert.ok(status.reuses >= 1);
assert.equal(status.stateCells, 1);
fabric.deleteState('prices');
fabric.shutdown();
console.log('Quanti data fabric verification passed');
