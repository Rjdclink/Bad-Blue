// Production bootstrap wrapper: establish and prove the Overflow storefront
// before normal application runtime starts.
//
// This wrapper is intentionally query-free. It never imports an application
// Primary gateway, never monkey-patches pg.Pool, and never turns an existing
// application Primary pool into an upstream transport. Until the storefront is
// explicitly active, index.ts fails closed without probing Primary.
await import('./migrations/reconcileAppSchema.js');

const { installCryptaraSuperWorkerAdmission } = await import(
  './services/cryptocrawl/integration/cryptara-super-worker.js'
);
await installCryptaraSuperWorkerAdmission();

const { startCryptaraHyperBridgeBootstrap } = await import(
  './services/cryptocrawl/integration/cryptara-supabase-hyper-bridge-bootstrap.js'
);
await startCryptaraHyperBridgeBootstrap();

await import('./index.js');
