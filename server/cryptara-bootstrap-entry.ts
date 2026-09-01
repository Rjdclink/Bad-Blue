// Production bootstrap wrapper: establish the cheapest possible resource-control
// surface before the application is allowed to ask the authoritative primary
// PostgreSQL for anything.
//
// 1) reconcileAppSchema imports db.ts and applies Railway's one-client rollout
//    headroom guard at module evaluation time, but performs no database query.
// 2) Cryptara installs its existing ordinary-pool admission proxy against that
//    already-contracted primary pool. It creates no connection itself.
// 3) HyperBridge starts the already-existing auxiliary overflow lane single-flight
//    and we wait only for that overflow admission result before loading index.ts.
// 4) When overflow is verified ready, a process-local primary-silence guard wraps
//    pg.Pool.connect(). Matching primary ordinary/coordination pools fail locally
//    before node-postgres can open a socket. Overflow uses a different Supabase
//    project/connection string, so it is unaffected.
// 5) The normal server entry may still exercise its legacy primary readiness path,
//    but while overflow is active that path is locally vetoed: zero primary DB I/O.
//    Primary-authoritative execution/governance/settlement remains fail-closed.
//
// If overflow is unavailable, no silence guard is installed and the established
// bounded primary startup path remains available as the fallback data plane.
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
  const prototype: any = Object.getPrototypeOf(pool);
  const PRIMARY_SILENCE_PATCH = Symbol.for('badblue.cryptara.primarySilenceConnect');

  if (!prototype[PRIMARY_SILENCE_PATCH]) {
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
    let blockedPrimaryAttempts = 0;

    prototype.connect = function cryptaraPrimarySilenceConnect(this: any, callback?: (...args: any[]) => void): any {
      const connectionString = String(this?.options?.connectionString || '').trim();
      const applicationName = String(this?.options?.application_name || '').trim();
      const targetsPrimary =
        this === pool ||
        this === coordinationPool ||
        (connectionString.length > 0 && primaryConnectionStrings.has(connectionString)) ||
        (applicationName.length > 0 && primaryApplicationNames.has(applicationName));

      if (!targetsPrimary) {
        return typeof callback === 'function'
          ? previousConnect.call(this, callback)
          : previousConnect.call(this);
      }

      blockedPrimaryAttempts += 1;
      const error = Object.assign(
        new Error('CRYPTARA_PRIMARY_NETWORK_SILENCED_OVERFLOW_ACTIVE'),
        { code: 'CRYPTARA_PRIMARY_SILENCED' },
      );

      // Log only the first few and powers of two. This proves local veto activity
      // without turning repeated fail-closed callers into another noisy hot path.
      if (
        blockedPrimaryAttempts <= 3 ||
        (blockedPrimaryAttempts & (blockedPrimaryAttempts - 1)) === 0
      ) {
        console.warn(
          `[CRYPTARA][PRIMARY-SILENCE] blocked local primary acquisition #${blockedPrimaryAttempts}; overflow active; primary network I/O=0`,
        );
      }

      if (typeof callback === 'function') {
        queueMicrotask(() => callback(error));
        return undefined;
      }
      return Promise.reject(error);
    };

    prototype[PRIMARY_SILENCE_PATCH] = true;
    console.log(
      '[CRYPTARA][PRIMARY-SILENCE] ACTIVE: verified overflow owns the data plane; primary ordinary+coordination PostgreSQL acquisitions are blocked locally before network I/O',
    );
  }
}

await import('./index.js');
