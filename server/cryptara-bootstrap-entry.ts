// Production bootstrap wrapper: establish the cheapest possible resource-control
// surface before the application is allowed to ask PostgreSQL for anything.
//
// 1) reconcileAppSchema imports db.ts and applies Railway's one-client rollout
//    headroom guard at module evaluation time, but performs no database query.
// 2) Cryptara installs its existing ordinary-pool admission proxy against that
//    already-contracted pool. It creates no connection itself.
// 3) Only then do we load the normal server entry, whose first DB operation is the
//    serialized SELECT 1 readiness probe.
//
// Once governance is restored, the existing handoff releases the pool ceiling and
// Cryptara grows useful concurrency from observed healthy admissions.
await import('./migrations/reconcileAppSchema.js');

const { installCryptaraSuperWorkerAdmission } = await import(
  './services/cryptocrawl/integration/cryptara-super-worker.js'
);
await installCryptaraSuperWorkerAdmission();

await import('./index.js');
