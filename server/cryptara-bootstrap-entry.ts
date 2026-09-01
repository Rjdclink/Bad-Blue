// Production bootstrap wrapper: establish the Cryptara data plane before normal
// application runtime is allowed to acquire authoritative-primary connections.
//
// 1) reconcileAppSchema imports db.ts and applies Railway rollout headroom without
//    performing a query.
// 2) Cryptara installs the existing admission governor.
// 3) HyperBridge verifies the overflow Supabase lane first.
// 4) The complete CryptoCrawler execution/governance/settlement schema is then
//    provisioned and verified on Overflow before CryptoCrawler runtime evaluation.
// 5) Legacy non-CryptoCrawler primary acquisitions remain observable behind the
//    overflow-primary gateway; CryptoCrawler owns a separate Overflow runtime DB
//    plane and must not use these primary pools as execution authority.
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
  const { ensureCryptocrawlOverflowRuntimeSchema } = await import(
    './services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.js'
  );
  try {
    await ensureCryptocrawlOverflowRuntimeSchema();
    console.log(
      '[CRYPTARA][OVERFLOW-AUTHORITY] READY: complete CryptoCrawler runtime schema verified on Overflow; Primary is not a CryptoCrawler runtime prerequisite',
    );
  } catch (error) {
    console.error(
      '[CRYPTARA][OVERFLOW-AUTHORITY] DEGRADED: Overflow transport is reachable but complete CryptoCrawler authority schema is not ready; execution remains fail-closed',
      error instanceof Error ? error.message : String(error),
    );
  }

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
          `[CRYPTARA][OVERFLOW-GATEWAY] legacy primary pool acquisition #${routedPrimaryAcquisitions} intercepted; route=application->overflow/bridge->primary; direct-application-primary=0`,
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
      '[CRYPTARA][OVERFLOW-GATEWAY] ACTIVE: legacy Primary access remains gateway-observable; CryptoCrawler runtime authority is Overflow-only',
    );
  }
}

await import('./index.js');
