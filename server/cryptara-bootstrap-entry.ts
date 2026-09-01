// Production bootstrap wrapper: establish the cheapest possible resource-control
// surface before the application is allowed to ask the authoritative primary
// PostgreSQL for anything.
//
// 1) reconcileAppSchema imports db.ts and applies Railway's one-client rollout
//    headroom guard at module evaluation time, but performs no database query.
// 2) Cryptara installs its existing ordinary-pool admission proxy against that
//    already-contracted primary pool. It creates no connection itself.
// 3) HyperBridge starts the already-existing auxiliary overflow lane single-flight.
//    This is intentionally not awaited, so the overflow connection gets a head
//    start without adding latency to the critical bootstrap path.
// 4) Only then do we load the normal server entry, whose first authoritative DB
//    operation is the serialized primary SELECT 1 readiness probe.
//
// Once governance is restored, the existing handoff releases the primary pool
// ceiling and Cryptara grows useful concurrency from observed healthy admissions.
await import('./migrations/reconcileAppSchema.js');

const { installCryptaraSuperWorkerAdmission } = await import(
  './services/cryptocrawl/integration/cryptara-super-worker.js'
);
await installCryptaraSuperWorkerAdmission();

const { startCryptaraHyperBridgeBootstrap } = await import(
  './services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.js'
);
void startCryptaraHyperBridgeBootstrap();

await import('./index.js');