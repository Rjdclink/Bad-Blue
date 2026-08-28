import logger from '../../../logger.js';
import { endToEndLatencyHarness } from '../runtime/end-to-end-latency-harness.js';

let timer: NodeJS.Timeout | null = null;
let installed = false;

function intervalsAllowed(): boolean {
  if (process.env.NO_INTERVALS === 'true') return false;
  return (process.env.CRYPTARA_MODE || '').trim().toUpperCase() !== 'SILENT_WATCHER_ONLY';
}

/**
 * Periodically publishes the measured S-80 distribution/runtime-pressure
 * snapshot. It never feeds readiness, ranking, governance, or execution; SLO
 * suggestions remain derived only after the harness has enough real samples.
 */
export function ensureLatencyObservability(): void {
  if (installed) return;
  installed = true;

  logger.info('[LatencyHarness] Latency observability installed', {
    component: 'LatencyObservability',
    authority: 'telemetry_only',
    executionAuthority: false,
    readinessAuthority: false,
    syntheticSloAllowed: false,
  });

  // Emit one truthful snapshot even in NO_INTERVALS mode. With no samples the
  // harness reports insufficient_samples rather than inventing an SLO.
  endToEndLatencyHarness.logMeasuredBaseline();
  if (!intervalsAllowed()) return;

  const intervalMs = Math.max(15_000, Number(process.env.CRYPTOCRAWL_LATENCY_HEARTBEAT_MS || 60_000));
  timer = setInterval(() => endToEndLatencyHarness.logMeasuredBaseline(), intervalMs);
  timer.unref?.();
}

export function stopLatencyObservability(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
