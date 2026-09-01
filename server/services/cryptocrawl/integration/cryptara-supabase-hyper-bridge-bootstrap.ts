import {
  getCryptaraParallelProxySnapshot,
  isCryptaraParallelProxyConfigured,
  withCryptaraParallelProxy,
} from './cryptara-supabase-overflow-worker.js';

export type CryptaraHyperBridgeBootstrapState =
  | 'idle'
  | 'not_configured'
  | 'probing'
  | 'ready'
  | 'degraded';

type BootstrapSnapshot = {
  state: CryptaraHyperBridgeBootstrapState;
  configured: boolean;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  reason: string | null;
  inFlight: boolean;
};

let state: CryptaraHyperBridgeBootstrapState = 'idle';
let startedAt = 0;
let completedAt = 0;
let latencyMs = 0;
let reason: string | null = null;
let probeInFlight: Promise<void> | null = null;

/**
 * Start the existing overflow transport as early as possible without introducing
 * another pool, timer, configuration alias, or blocking bootstrap dependency.
 *
 * The probe is intentionally single-flight and fire-and-observe: the caller starts
 * it before the authoritative primary probe, but never waits for overflow I/O.
 * That gives the auxiliary lane a connection head start at zero added critical-path
 * latency. Primary authority is unchanged and the bridge cannot satisfy execution,
 * governance, treasury, settlement, signer, nonce, or profitability truth.
 */
export function startCryptaraHyperBridgeBootstrap(): Promise<void> {
  if (probeInFlight) return probeInFlight;

  startedAt = Date.now();
  completedAt = 0;
  latencyMs = 0;
  reason = null;

  if (!isCryptaraParallelProxyConfigured) {
    state = 'not_configured';
    reason = getCryptaraParallelProxySnapshot().configurationError || 'SUPABASE_DATABASE_URL_OVERFLOW unavailable';
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] not configured before primary probe (${reason})`);
    probeInFlight = Promise.resolve();
    completedAt = Date.now();
    return probeInFlight;
  }

  state = 'probing';
  console.log('[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane started before primary database probe');

  probeInFlight = (async () => {
    const probeStartedAt = Date.now();
    const result = await withCryptaraParallelProxy('observability', query =>
      query('SELECT 1 AS hyper_bridge_ready'),
    );
    latencyMs = Date.now() - probeStartedAt;
    completedAt = Date.now();

    if (result.used && Number(result.value?.rows?.[0]?.hyper_bridge_ready) === 1) {
      state = 'ready';
      reason = null;
      console.log(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane ready in ${latencyMs}ms before/alongside primary admission`);
      return;
    }

    state = 'degraded';
    reason = result.reason;
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane probe degraded (${result.reason}); primary authority remains unchanged`);
  })().catch(error => {
    completedAt = Date.now();
    latencyMs = Math.max(0, completedAt - startedAt);
    state = 'degraded';
    reason = error instanceof Error ? error.message : String(error);
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane probe failed (${reason}); primary authority remains unchanged`);
  });

  return probeInFlight;
}

export function getCryptaraHyperBridgeBootstrapSnapshot(): BootstrapSnapshot {
  return {
    state,
    configured: isCryptaraParallelProxyConfigured,
    startedAt,
    completedAt,
    latencyMs,
    reason,
    inFlight: state === 'probing',
  };
}
