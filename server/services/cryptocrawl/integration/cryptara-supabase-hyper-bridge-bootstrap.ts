import {
  getCryptaraParallelProxySnapshot,
  isCryptaraParallelProxyConfigured,
  withCryptaraParallelProxy,
} from './cryptara-supabase-overflow-worker.js';
import {
  getCryptaraOverflowSuperWorkerSnapshot,
  startCryptaraOverflowSuperWorker,
  stopCryptaraOverflowSuperWorker,
} from './cryptara-overflow-super-worker.js';
import { isCryptoCrawlerDatabaseAccessAllowed } from '../runtime/manual-power-state.js';
import {
  closeCryptaraParallelProxyPool,
  reopenCryptaraParallelProxyPool,
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
  overflowWorker: ReturnType<typeof getCryptaraOverflowSuperWorkerSnapshot>;
};

let state: CryptaraHyperBridgeBootstrapState = 'idle';
let startedAt = 0;
let completedAt = 0;
let latencyMs = 0;
let reason: string | null = null;
let probeInFlight: Promise<void> | null = null;
let probeGeneration = 0;

/**
 * Start the dedicated overflow control worker before either remote database lane.
 * The worker itself is local-only and therefore adds no network latency. After it
 * is online, the existing overflow transport receives one single-flight head-start
 * probe while the caller continues immediately toward normal bootstrap.
 */
export function startCryptaraHyperBridgeBootstrap(): Promise<void> {
  if (!isCryptoCrawlerDatabaseAccessAllowed()) {
    state = 'idle';
    startedAt = 0;
    completedAt = Date.now();
    latencyMs = 0;
    reason = 'master_power_off';
    return Promise.resolve();
  }
  if (probeInFlight) return probeInFlight;

  reopenCryptaraParallelProxyPool();
  startCryptaraOverflowSuperWorker();
  startedAt = Date.now();
  completedAt = 0;
  latencyMs = 0;
  reason = null;

  if (!isCryptaraParallelProxyConfigured) {
    state = 'not_configured';
    reason = getCryptaraParallelProxySnapshot().configurationError || 'overflow database configuration unavailable';
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow worker online but remote overflow lane is not configured (${reason})`);
    probeInFlight = Promise.resolve();
    completedAt = Date.now();
    return probeInFlight;
  }

  state = 'probing';
  const generation = ++probeGeneration;
  console.log('[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow Super Worker online before primary; auxiliary lane head-started');

  probeInFlight = (async () => {
    const probeStartedAt = Date.now();
    const result = await withCryptaraParallelProxy('observability', query =>
      query('SELECT 1 AS hyper_bridge_ready'),
    );
    if (generation !== probeGeneration || !isCryptoCrawlerDatabaseAccessAllowed()) return;
    latencyMs = Date.now() - probeStartedAt;
    completedAt = Date.now();

    if (result.used && Number(result.value?.rows?.[0]?.hyper_bridge_ready) === 1) {
      state = 'ready';
      reason = null;
      console.log(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] overflow lane ready in ${latencyMs}ms; worker coherence remains local/no-primary-ping`);
      return;
    }

    state = 'degraded';
    reason = result.reason;
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane probe degraded (${result.reason}); no primary probe was issued by overflow worker`);
  })().catch(error => {
    if (generation !== probeGeneration || !isCryptoCrawlerDatabaseAccessAllowed()) return;
    completedAt = Date.now();
    latencyMs = Math.max(0, completedAt - startedAt);
    state = 'degraded';
    reason = error instanceof Error ? error.message : String(error);
    console.warn(`[CRYPTARA][HYPER-BRIDGE][BOOTSTRAP] auxiliary lane probe failed (${reason}); no primary probe was issued by overflow worker`);
  });

  return probeInFlight;
}

export async function stopCryptaraHyperBridgeBootstrap(): Promise<void> {
  probeGeneration += 1;
  stopCryptaraOverflowSuperWorker();
  probeInFlight = null;
  await closeCryptaraParallelProxyPool();
  state = 'idle';
  startedAt = 0;
  completedAt = Date.now();
  latencyMs = 0;
  reason = 'master_power_off';
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
    overflowWorker: getCryptaraOverflowSuperWorkerSnapshot(),
  };
}
