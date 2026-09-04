// Production bootstrap: reconcile and prove the ordinary Primary application
// schema first, establish the CryptoCrawler Overflow data plane second, then load
// the application. Primary and Overflow are explicit, separate authorities; no
// global pg.Pool interception or cross-database acquisition wrapper is installed.
process.env.PRIMARY_APPLICATION_SCHEMA_READY = 'false';
process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';

const { runAllSchemaMigrations } = await import('./migrations/reconcileAppSchema.js');
const { requirePrimaryApplicationSchema } = await import(
  './migrations/primaryApplicationSchemaReadiness.js'
);

// The canonical migration list remains the sole mutation authority. Production
// startup is fail-closed: a thrown migration error cannot be downgraded to a log
// entry, and workers/routes never load until the migration-owned postconditions
// are independently proven on Primary.
const primaryMigrationResults = await runAllSchemaMigrations({ continueOnError: false });
const reportedPrimaryMigrationFailures = primaryMigrationResults.filter(result => !result.success);
if (reportedPrimaryMigrationFailures.length > 0) {
  throw new Error(
    `Primary application migration readiness failed: ${reportedPrimaryMigrationFailures
      .map(result => `${result.name}: ${result.error || 'unspecified migration failure'}`)
      .join('; ')}`,
  );
}
await requirePrimaryApplicationSchema();
process.env.PRIMARY_APPLICATION_SCHEMA_READY = 'true';
console.log(
  '[PRIMARY][SCHEMA-AUTHORITY] READY: canonical migrations completed and required application tables verified before route/worker startup',
);

if (process.env.SUBAGENT_ENABLE_OFFICER_SEARCH === 'true') {
  const { requireOfficerSearchRuntimeReadiness } = await import(
    './officerSearchRuntimeReadiness.js'
  );
  await requireOfficerSearchRuntimeReadiness();
  console.log(
    '[PRIMARY][OFFICER-SEARCH] READY: search-session and priority-queue dependencies proved before harvester modules load',
  );
}

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
      '[CRYPTARA][OVERFLOW-AUTHORITY] READY: complete CryptoCrawler runtime schema verified on Overflow; Primary application schema is independently ready',
    );
  } catch (error) {
    process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';
    console.error(
      '[CRYPTARA][OVERFLOW-AUTHORITY] DEGRADED: Overflow transport is reachable but complete CryptoCrawler authority schema is not ready; CryptoCrawler execution remains fail-closed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

await import('./index.js');
