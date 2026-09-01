// Production bootstrap wrapper: establish the Cryptara data plane before normal
// application runtime is allowed to acquire authoritative-Primary connections.
//
// 1) reconcileAppSchema imports db.ts and applies Railway rollout headroom without
//    performing a query.
// 2) Cryptara installs the existing admission governor.
// 3) HyperBridge verifies the existing Overflow Supabase lane first.
// 4) When Overflow is operational, pg.Pool Primary acquisitions are intercepted
//    before index.ts loads. Legacy application callers are placed inside the
//    process-local governed Overflow-primary context; the existing Primary pool
//    still owns the actual upstream network connection. No third pool/config alias
//    is created and Primary authority is unchanged.
// 5) index.ts treats verified Overflow as the normal proxy information plane and
//    performs zero direct Primary health/recovery probes. Reusable information uses
//    local/Overflow first; a true miss may use one governed Primary upstream load.
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
  const { pool, coordinationPool } = await import('./db.js');
  const {
    isCryptaraOverflowPrimaryGatewayContext,
    runThroughCryptaraOverflowPrimaryGateway,
  } = await import(
    './services/cryptocrawl/integration/cryptara-overflow-primary-gateway.js'
  );

  const prototype: any = Object.getPrototypeOf(pool);
  const PRIMARY_GATEWAY_PATCH = Symbol.for('badblue.cryptara.overflowPrimaryGatewayConnect');

  if (!prototype[PRIMARY_GATEWAY_PATCH]) {
    const previousConnect = prototype.connect as (...args: any[]) => any;
    const primaryConnectionStrings = new Set(
      [pool, coordinationPool]
        .map((candidate: any) => String(candidate?.options?.connectionString || '').trim())
        .filter(Boolean),
    );
    const primaryApplicationNames = new Set(
      [pool, coordinationPool]
        .map((candidate: any) => String(candidate?.options?.application_name || '').trim())
        .filter(Boolean),
    );
    let routedPrimaryAcquisitions = 0;

    prototype.connect = function cryptaraOverflowPrimaryGatewayConnect(
      this: any,
      callback?: (...args: any[]) => void,
    ): any {
      const connectionString = String(this?.options?.connectionString || '').trim();
      const applicationName = String(this?.options?.application_name || '').trim();
      const targetsPrimary =
        this === pool ||
        this === coordinationPool ||
        (connectionString.length > 0 && primaryConnectionStrings.has(connectionString)) ||
        (applicationName.length > 0 && primaryApplicationNames.has(applicationName));

      if (!targetsPrimary || isCryptaraOverflowPrimaryGatewayContext()) {
        return typeof callback === 'function'
          ? previousConnect.call(this, callback)
          : previousConnect.call(this);
      }

      routedPrimaryAcquisitions += 1;
      if (
        routedPrimaryAcquisitions <= 4 ||
        (routedPrimaryAcquisitions & (routedPrimaryAcquisitions - 1)) === 0
      ) {
        console.log(
          `[CRYPTARA][OVERFLOW-GATEWAY] governed Primary pool acquisition #${routedPrimaryAcquisitions}; logical-route=application->local/overflow->gateway->primary, upstream-transport=existing-primary-pool, ungoverned-primary-acquisitions=0`,
        );
      }

      return runThroughCryptaraOverflowPrimaryGateway(
        'legacy_application_primary_acquisition',
        () => typeof callback === 'function'
          ? previousConnect.call(this, callback)
          : previousConnect.call(this),
      );
    };

    prototype[PRIMARY_GATEWAY_PATCH] = true;
    console.log(
      '[CRYPTARA][OVERFLOW-GATEWAY] ACTIVE: Overflow is the governed application information boundary; local/Overflow is first for eligible reads, upstream misses use the existing Primary pool, ungoverned Primary acquisitions=0, direct Primary health/recovery probes disabled',
    );
  }
}

await import('./index.js');
