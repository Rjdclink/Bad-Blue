import assert from 'node:assert/strict';
import { createCryptoCrawlerCoreLifecycle } from '../../server/services/cryptocrawl/runtime/core-runtime-lifecycle.js';
import { admitAnkrFallback } from '../../server/services/cryptocrawl/runtime/rpc-fallback-admission-policy.js';

const calls: string[] = [];
const lifecycle = createCryptoCrawlerCoreLifecycle({
  startDiscovery: () => calls.push('start:discovery'),
  stopDiscovery: () => calls.push('stop:discovery'),
  startScheduler: () => calls.push('start:scheduler'),
  stopScheduler: () => calls.push('stop:scheduler'),
});

assert.equal(lifecycle.isStarted(), false);
assert.equal(lifecycle.start(), true);
assert.equal(lifecycle.start(), false, 'duplicate core start must be idempotent');
assert.deepEqual(calls, ['start:discovery', 'start:scheduler']);
assert.equal(lifecycle.isStarted(), true);

assert.equal(lifecycle.stop(), true);
assert.equal(lifecycle.stop(), false, 'duplicate core stop must be idempotent');
assert.deepEqual(calls, [
  'start:discovery',
  'start:scheduler',
  'stop:scheduler',
  'stop:discovery',
]);
assert.equal(lifecycle.isStarted(), false);

const rollbackCalls: string[] = [];
const failingLifecycle = createCryptoCrawlerCoreLifecycle({
  startDiscovery: () => rollbackCalls.push('start:discovery'),
  stopDiscovery: () => rollbackCalls.push('stop:discovery'),
  startScheduler: () => { rollbackCalls.push('start:scheduler'); throw new Error('scheduler start failed'); },
  stopScheduler: () => rollbackCalls.push('stop:scheduler'),
});
assert.throws(() => failingLifecycle.start(), /scheduler start failed/);
assert.equal(failingLifecycle.isStarted(), false);
assert.deepEqual(rollbackCalls, [
  'start:discovery',
  'start:scheduler',
  'stop:scheduler',
  'stop:discovery',
]);

const configured = admitAnkrFallback({
  configuredUrl: ' https://rpc.example.test/key ',
  publicUrl: 'https://rpc.ankr.com/eth',
  allowAnonymousPublicFallback: false,
});
assert.deepEqual(configured, {
  httpUrl: 'https://rpc.example.test/key',
  provider: 'AnkrConfigured',
  priority: 8,
  provenance: 'configured',
});

assert.equal(admitAnkrFallback({
  configuredUrl: null,
  publicUrl: 'https://rpc.ankr.com/eth',
  allowAnonymousPublicFallback: false,
}), null, 'anonymous public fallback must be opt-in');

assert.deepEqual(admitAnkrFallback({
  configuredUrl: null,
  publicUrl: ' https://rpc.ankr.com/eth ',
  allowAnonymousPublicFallback: true,
}), {
  httpUrl: 'https://rpc.ankr.com/eth',
  provider: 'AnkrPublic',
  priority: 2,
  provenance: 'explicit_public_fallback',
});

console.log('[verify-core-topology-lifecycle] PASS');
