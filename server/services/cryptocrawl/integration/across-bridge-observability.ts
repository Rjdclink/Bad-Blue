import logger from '../../../logger.js';
import { getAcrossBridgeMetrics, getAcrossBridgeReadiness } from '../bridge/across-bridge-provider.js';

let timer: NodeJS.Timeout | null = null;

export function emitAcrossBridgeEvidenceHealth(): void {
  const readiness = getAcrossBridgeReadiness();
  const metrics = getAcrossBridgeMetrics();
  logger.info('[AcrossBridge] Measured cross-chain evidence health', {
    component: 'AcrossBridgeObservability',
    readiness,
    metrics,
    authority: 'bridge_evidence_only',
    executionAuthority: false,
    requiredForCoreCexDiscovery: false,
    requiredForGlobalReadiness: false,
    deterministicProfitAuthority: false,
    settlementAuthority: false,
  });
}

export function ensureAcrossBridgeObservability(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(15_000, Number(process.env.CRYPTOCRAWL_ACROSS_HEALTH_INTERVAL_MS || 60_000));
  emitAcrossBridgeEvidenceHealth();
  timer = setInterval(emitAcrossBridgeEvidenceHealth, intervalMs);
  timer.unref?.();
}
