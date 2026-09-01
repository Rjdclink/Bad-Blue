// Production bootstrap wrapper: establish the cheapest possible resource-control
// surface before the application is allowed to initialize its normal runtime.
//
// 1) reconcileAppSchema imports db.ts and applies Railway's one-client rollout
//    headroom guard at module evaluation time, but performs no database query.
// 2) Cryptara installs its existing ordinary-pool admission proxy against that
//    already-contracted primary pool. It creates no connection itself.
// 3) HyperBridge starts the already-existing auxiliary overflow lane single-flight
//    and we wait only for that overflow admission result before loading index.ts.
// 4) A verified overflow lane is a head start, not a process-wide primary veto.
//    The existing Cryptara admission governor remains the sole primary acquisition
//    control, so index.ts can perform its one bounded primary probe and the
//    canonical runtime can later re-check authoritative schema without a locally
//    manufactured permanent failure.
// 5) Overflow remains auxiliary-only. Primary execution/governance/settlement
//    authority stays fail-closed whenever the authoritative primary is unavailable.
//
// If overflow is unavailable, the established bounded primary startup path remains
// available as the fallback data plane. The wrapper itself never queries primary.
await import('./migrations/reconcileAppSchema.js');

const { installCryptaraSuperWorkerAdmission } = await import(
  './services/cryptocrawl/integration/cryptara-super-worker.js'
);
await installCryptaraSuperWorkerAdmission();

const {
  getCryptaraHyperBridgeBootstrapSnapshot,
  startCryptaraHyperBridgeBootstrap,
} = await import(
  './services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.js'
);

await startCryptaraHyperBridgeBootstrap();
const overflowBootstrap = getCryptaraHyperBridgeBootstrapSnapshot();

if (overflowBootstrap.state === 'ready') {
  console.log(
    '[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] verified overflow head-start active; primary remains bounded by Cryptara admission and retains sole authoritative execution/governance/settlement role',
  );
}

await import('./index.js');
