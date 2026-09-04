// Production CryptoCrawler bootstrap.
//
// CryptoCrawler owns an explicit Overflow runtime data plane. Ordinary LegalWhat,
// Officer Search, People Search, Sub-Agent, and other Primary application schemas
// are separate concerns and are never CryptoCrawler readiness prerequisites.
// Importing reconcileAppSchema installs the existing Railway rollout headroom only;
// it does not grant Primary application migrations any CryptoCrawler startup authority.
await import('./migrations/reconcileAppSchema.js');

process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';

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
  const { ensureCryptocrawlOverflowRuntimeSchema } = await import(
    './services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.js'
  );
  try {
    await ensureCryptocrawlOverflowRuntimeSchema();
    process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'true';
    console.log(
      '[CRYPTARA][OVERFLOW-AUTHORITY] READY: complete CryptoCrawler runtime schema verified on Overflow; Primary application and Officer Search schemas are not CryptoCrawler runtime prerequisites',
    );
  } catch (error) {
    process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';
    console.error(
      '[CRYPTARA][OVERFLOW-AUTHORITY] DEGRADED: Overflow transport is reachable but complete CryptoCrawler authority schema is not ready; CryptoCrawler execution remains fail-closed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Deliberately no pg.Pool.prototype interception here. Primary remains the normal
// application database authority; CryptoCrawler modules use their explicit Overflow
// runtime database authority instead of globally rerouting unrelated application DB I/O.
await import('./index.js');
