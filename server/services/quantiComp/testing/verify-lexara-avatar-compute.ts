import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QuantiCompError } from '../types.js';
import { QuantiCompRuntime } from '../runtime.js';
import { QuantiTensorFabric } from '../tensorFabric.js';

async function verifyGenerationShedding(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 1, workerId: 'lexara-avatar-test' });
  let oldStarted = false;
  let oldAborted = false;

  const old = runtime.submit({
    id: 'avatar-old',
    kind: 'lexara.avatar.segment',
    lane: 'ultra_hot',
    priority: 100,
    input: 1,
    resourceHints: { resourceDomain: 'lexara-avatar-visual' },
    policy: {
      timeoutMs: 2_000,
      supersessionKey: 'lexara-avatar:test-session',
      generation: 1,
      preemptible: true,
    },
    async execute(_input, context) {
      oldStarted = true;
      while (!context.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      oldAborted = true;
      return 1;
    },
    validate: value => value === 1,
  });

  while (!oldStarted) await new Promise(resolve => setImmediate(resolve));

  const fresh = runtime.submit({
    id: 'avatar-fresh',
    kind: 'lexara.avatar.segment',
    lane: 'ultra_hot',
    priority: 100,
    input: 2,
    resourceHints: { resourceDomain: 'lexara-avatar-visual' },
    policy: {
      timeoutMs: 2_000,
      supersessionKey: 'lexara-avatar:test-session',
      generation: 2,
      preemptible: true,
    },
    execute: value => value * 2,
    validate: value => value === 4,
  });

  await assert.rejects(
    old,
    (error: unknown) => error instanceof QuantiCompError && error.code === 'SUPERSEDED',
  );
  const latest = await fresh;
  assert.equal(latest.result, 4);
  assert.equal(oldAborted, true);

  await assert.rejects(
    runtime.submit({
      id: 'avatar-stale',
      kind: 'lexara.avatar.segment',
      lane: 'ultra_hot',
      priority: 100,
      input: 3,
      policy: {
        timeoutMs: 500,
        supersessionKey: 'lexara-avatar:test-session',
        generation: 1,
      },
      execute: value => value,
      validate: () => true,
    }),
    (error: unknown) => error instanceof QuantiCompError && error.code === 'SUPERSEDED',
  );

  runtime.shutdown();
}

async function verifyDomainIsolation(): Promise<void> {
  const runtime = new QuantiCompRuntime({ maxConcurrency: 2, workerId: 'lexara-avatar-isolation-test' });
  let releaseLegal!: () => void;
  const legalGate = new Promise<void>(resolve => { releaseLegal = resolve; });
  let legalStarted = false;

  const legal = runtime.submit({
    id: 'legal-work',
    kind: 'lexara.legal.reasoning',
    lane: 'hot',
    priority: 100,
    input: 'legal',
    resourceHints: { resourceDomain: 'lexara-legal' },
    policy: { timeoutMs: 2_000, preemptible: false },
    async execute(value) {
      legalStarted = true;
      await legalGate;
      return value;
    },
    validate: value => value === 'legal',
  });

  while (!legalStarted) await new Promise(resolve => setImmediate(resolve));

  const firstAvatar = runtime.submit({
    id: 'avatar-isolated-old',
    kind: 'lexara.avatar.segment',
    lane: 'ultra_hot',
    priority: 100,
    input: 1,
    resourceHints: { resourceDomain: 'lexara-avatar-visual' },
    policy: {
      timeoutMs: 2_000,
      supersessionKey: 'lexara-avatar:isolation',
      generation: 1,
      preemptible: true,
    },
    async execute(_value, context) {
      while (!context.signal.aborted) await new Promise(resolve => setTimeout(resolve, 1));
      return 1;
    },
    validate: () => true,
  });

  await new Promise(resolve => setImmediate(resolve));
  const latestAvatar = runtime.submit({
    id: 'avatar-isolated-new',
    kind: 'lexara.avatar.segment',
    lane: 'ultra_hot',
    priority: 100,
    input: 2,
    resourceHints: { resourceDomain: 'lexara-avatar-visual' },
    policy: {
      timeoutMs: 2_000,
      supersessionKey: 'lexara-avatar:isolation',
      generation: 2,
      preemptible: true,
    },
    execute: value => value,
    validate: value => value === 2,
  });

  await assert.rejects(
    firstAvatar,
    (error: unknown) => error instanceof QuantiCompError && error.code === 'SUPERSEDED',
  );
  releaseLegal();
  assert.equal((await legal).result, 'legal');
  assert.equal((await latestAvatar).result, 2);
  runtime.shutdown();
}

function verifyTensorFabric(): void {
  const fabric = new QuantiTensorFabric({
    maxPooledBytes: 1024 * 1024,
    maxBuffersPerClass: 2,
    maxStateBytes: 1024 * 1024,
  });

  const first = fabric.acquireFloat32(32);
  const firstBuffer = first.buffer;
  first.view[0] = 7;
  first.release();

  const reused = fabric.acquireFloat32(32);
  assert.equal(reused.reused, true);
  assert.equal(reused.buffer, firstBuffer);
  reused.release();

  fabric.publishFloat32State('identity', [1, 2, 3, 4], { ttlMs: 1000 });
  const pinned = fabric.pinFloat32State('identity');
  assert.ok(pinned);
  assert.deepEqual(Array.from(pinned!.view), [1, 2, 3, 4]);
  pinned!.release();

  fabric.publishFloat32State('expired', [5, 6], { ttlMs: 1 });
  assert.equal(fabric.evictExpired(Date.now() + 10), 1);
  assert.equal(fabric.pinFloat32State('expired'), null);

  const status = fabric.getStatus();
  assert.ok(status.reuses >= 1);
  assert.ok(status.stateCells >= 1);
  fabric.shutdown();
}

function verifyBlueprint(): void {
  const file = path.resolve(
    process.cwd(),
    'docs/QUANTICOMP_LEXARA_REALTIME_GPU_100_SOURCE_BLUEPRINT_20260920.md',
  );
  const text = fs.readFileSync(file, 'utf8');
  const section = text.split('## Sources — exactly 100')[1]?.split('## Implementation contract')[0] || '';
  const sourceLines = section.split('\n').filter(line => /^\d+\.\s/.test(line));
  assert.equal(sourceLines.length, 100);
  assert.match(text, /Ray.*resource-aware/i);
  assert.match(text, /Ice Crystal/i);
  assert.match(text, /LeBrony/i);
  assert.match(text, /snake-skin/i);
  assert.match(text, /latest useful generation wins/i);
  assert.match(text, /audio.*authority/i);
  assert.match(text, /GPU.*does not create/i);
}

await verifyGenerationShedding();
await verifyDomainIsolation();
verifyTensorFabric();
verifyBlueprint();
console.log('QuantiComp LEXARA realtime avatar compute verification passed');
