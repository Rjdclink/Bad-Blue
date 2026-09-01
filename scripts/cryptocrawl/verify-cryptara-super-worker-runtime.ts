import assert from 'node:assert/strict';
import {
  getCryptaraSuperWorkerSnapshot,
  invalidateCryptaraSharedInformation,
  requestCryptaraSharedInformation,
} from '../../server/services/cryptocrawl/integration/cryptara-super-worker.js';

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const sharedKey = `verify:super-worker:shared:${Date.now()}`;
  let originLoads = 0;
  const consumers = Array.from({ length: 32 }, (_, index) => `consumer-${index}`);

  const leases = await Promise.all(consumers.map(consumer =>
    requestCryptaraSharedInformation({
      key: sharedKey,
      consumer,
      informationClass: 'resource_snapshot',
      freshForMs: 80,
      maxItems: 2,
      loader: async () => {
        originLoads += 1;
        await sleep(20);
        return [11, 22, 33, 44];
      },
      estimatedBytes: 32,
    }),
  ));

  assert.equal(originLoads, 1, '32 simultaneous consumers must collapse to one origin load');
  for (const lease of leases) {
    assert.deepEqual(lease.value, [11, 22], 'consumer maxItems projection must bound delivered information');
  }
  const during = getCryptaraSuperWorkerSnapshot();
  assert.equal(during.information.activeLeases, 32, 'all shared readers must be visible while pinned');
  assert.ok(during.information.coalescedRequests >= 31, 'all but the origin request should be coalesced');
  assert.ok(during.information.upstreamCallsAvoided >= 31, 'coalescing must report avoided upstream calls');

  for (const lease of leases) lease.release();
  assert.equal(getCryptaraSuperWorkerSnapshot().information.activeLeases, 0, 'all leases must release cleanly');

  const cachedLease = await requestCryptaraSharedInformation({
    key: sharedKey,
    consumer: 'cache-reuser',
    informationClass: 'resource_snapshot',
    freshForMs: 80,
    loader: async () => {
      originLoads += 1;
      return [99];
    },
  });
  assert.equal(originLoads, 1, 'fresh shared truth must be reused instead of reloaded');
  assert.equal(cachedLease.source, 'cache');
  cachedLease.release();

  await sleep(90);
  const refreshedLease = await requestCryptaraSharedInformation({
    key: sharedKey,
    consumer: 'post-expiry',
    informationClass: 'resource_snapshot',
    freshForMs: 80,
    loader: async () => {
      originLoads += 1;
      return [55];
    },
  });
  assert.equal(originLoads, 2, 'expired shared truth must trigger a fresh origin load');
  assert.deepEqual(refreshedLease.value, [55]);
  refreshedLease.release();
  invalidateCryptaraSharedInformation(sharedKey);

  const truthKey = `verify:super-worker:truth:${Date.now()}`;
  let truthLoads = 0;
  for (let index = 0; index < 2; index += 1) {
    const lease = await requestCryptaraSharedInformation({
      key: truthKey,
      consumer: `truth-${index}`,
      informationClass: 'execution_truth',
      freshForMs: 5_000,
      loader: async () => {
        truthLoads += 1;
        return { sequence: truthLoads };
      },
    });
    lease.release();
  }
  assert.equal(truthLoads, 2, 'execution truth class must force zero retained freshness even when caller requests caching');

  await assert.rejects(
    requestCryptaraSharedInformation({
      key: `verify:super-worker:acl:${Date.now()}`,
      consumer: 'not-authorized',
      allowedConsumers: ['authorized-only'],
      informationClass: 'background',
      loader: () => 'should-not-run',
    }),
    /CRYPTARA_SUPER_WORKER_CONSUMER_NOT_ALLOWED/,
    'consumer allow-list must reject unauthorized fan-out before origin work executes',
  );

  const finalSnapshot = getCryptaraSuperWorkerSnapshot();
  assert.equal(finalSnapshot.authority, 'resource_proxy_only');
  assert.equal(finalSnapshot.writeAuthority, false);
  assert.equal(finalSnapshot.executionAuthority, false);
  assert.equal(finalSnapshot.information.activeLeases, 0);

  console.log('[cryptara-super-worker-runtime] PASS', {
    originLoads,
    truthLoads,
    avoidedUpstreamCalls: finalSnapshot.information.upstreamCallsAvoided,
    retainedEntries: finalSnapshot.information.retainedEntries,
    retainedBytes: finalSnapshot.information.retainedBytes,
  });
}

main().catch(error => {
  console.error('[cryptara-super-worker-runtime] FAIL', error);
  process.exitCode = 1;
});
