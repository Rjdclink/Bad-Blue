// Production bootstrap: reconcile the ordinary application schema, establish the
// CryptoCrawler Overflow data plane, then start the application. Primary and
// Overflow remain explicit, separate authorities; no global pg.Pool interception
// or cross-database acquisition wrapper is installed.
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
      '[CRYPTARA][OVERFLOW-AUTHORITY] READY: complete CryptoCrawler runtime schema verified on Overflow; Primary is not a CryptoCrawler runtime prerequisite',
    );
  } catch (error) {
    process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';
    console.error(
      '[CRYPTARA][OVERFLOW-AUTHORITY] DEGRADED: Overflow transport is reachable but complete CryptoCrawler authority schema is not ready; execution remains fail-closed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Advisory zero-capital funding learning observes canonical candidate lifecycle
// updates directly. It cannot mutate candidates, provider selection, economics,
// settlement, scheduling or execution authority.
const { ensureZeroCapitalFundingLifecycleObserver } = await import(
  './services/cryptocrawl/evolution/zero-capital-funding-lifecycle-observer.js'
);
ensureZeroCapitalFundingLifecycleObserver();

// Preserve the useful PR #520 network-capability layer without restoring its
// obsolete execution wrappers. These observers verify only current chain/RPC
// identity and remain fail-closed for execution until route-local provider,
// zero-personal-fee and terminal settlement evidence all exist.
const { ensureExpandedNetworkObservability } = await import(
  './services/cryptocrawl/runtime/expanded-network-observability.js'
);
ensureExpandedNetworkObservability();

// Canonical provider selections feed advisory external-capital specialization.
// The observer cannot select a provider, mutate economics, or submit capital.
const { ensureExternalCapitalSelectionObserver } = await import(
  './services/cryptocrawl/integration/external-capital-selection-observer.js'
);
ensureExternalCapitalSelectionObserver();

// Authenticated inventory-route fee/network evidence feeds planning only. It may
// reduce future rebalance drag but cannot move funds or alter trade economics.
const { ensureMeasuredRebalanceRouteEvidenceWiring } = await import(
  './services/cryptocrawl/integration/measured-rebalance-route-evidence-wiring.js'
);
ensureMeasuredRebalanceRouteEvidenceWiring();

// Zero-capital gas ownership proof and native spend reservation are now explicit
// functions called by the single canonical ZERO_CAPITAL_ATOMIC executor. The
// bootstrap must not rewrite engine methods or install a parallel execution path.
await import('./index.js');