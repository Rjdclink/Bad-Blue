import logger from '../../../logger.js';
import { getDexQuoteMeshSnapshot } from './dex-quote-provider-mesh.js';

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 300_000;

function proofIntervalMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_DEX_MESH_RUNTIME_PROOF_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.trunc(configured)));
}

let started = false;
let timer: NodeJS.Timeout | null = null;

export function emitDexMeshRuntimeProof(): void {
  const snapshot = getDexQuoteMeshSnapshot();
  const now = snapshot.observedAt;
  const providers = snapshot.providers.map(row => ({
    provider: row.provider,
    successes: row.successes,
    failures: row.failures,
    consecutiveFailures: row.consecutiveFailures,
    lastUsedAt: row.lastUsedAt,
    lastUsedAgeMs: row.lastUsedAt > 0 ? Math.max(0, now - row.lastUsedAt) : null,
    cooldownUntil: row.cooldownUntil,
    healthScore: row.healthScore,
  }));
  const usedProviders = providers.filter(row => row.lastUsedAt > 0).map(row => row.provider);
  const recentlyUsedProviders = providers
    .filter(row => row.lastUsedAgeMs !== null && row.lastUsedAgeMs <= proofIntervalMs() * 2)
    .map(row => row.provider);

  logger.info('[DexQuoteMesh] Runtime provider proof', {
    component: 'DexQuoteProviderMesh',
    observedAt: now,
    activePerRequest: snapshot.activePerRequest,
    maximumHedgeProviders: snapshot.maximumHedgeProviders,
    zeroXProductionDependency: snapshot.zeroXProductionDependency,
    globalProviderCooldownAllowed: snapshot.globalProviderCooldownAllowed,
    usedProviders,
    recentlyUsedProviders,
    providers,
  });
}

export function ensureDexMeshRuntimeProof(): void {
  if (started || String(process.env.CRYPTOCRAWL_DEX_MESH_RUNTIME_PROOF_ENABLED || 'true').toLowerCase() === 'false') return;
  started = true;
  const intervalMs = proofIntervalMs();
  const first = setTimeout(() => emitDexMeshRuntimeProof(), Math.min(5_000, intervalMs));
  first.unref?.();
  timer = setInterval(() => emitDexMeshRuntimeProof(), intervalMs);
  timer.unref?.();
}

export function stopDexMeshRuntimeProofForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

ensureDexMeshRuntimeProof();
