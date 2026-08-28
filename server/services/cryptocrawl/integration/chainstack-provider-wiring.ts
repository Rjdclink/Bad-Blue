import logger from '../../../logger.js';
import { reconcileChainstackProviderInventory } from '../api/chainstack-platform-discovery.js';

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastResult: Awaited<ReturnType<typeof reconcileChainstackProviderInventory>> | null = null;
let lastError: string | null = null;

async function reconcile(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    lastResult = await reconcileChainstackProviderInventory();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    logger.warn('[Chainstack] provider inventory reconciliation degraded', {
      component: 'ChainstackProviderWiring', error: lastError, executionBlocked: false,
    });
  } finally { inFlight = false; }
}

export function ensureChainstackProviderWiring(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(5 * 60_000, Number(process.env.CHAINSTACK_RECONCILE_INTERVAL_MS || 30 * 60_000));
  void reconcile();
  timer = setInterval(() => void reconcile(), intervalMs);
  timer.unref();
  logger.info('[Chainstack] low-frequency provider discovery installed', {
    component: 'ChainstackProviderWiring', intervalMs,
    discoveryCadence: 'startup_and_low_frequency_maintenance',
    autoProvisioning: false,
    executionAuthority: false,
  });
}

export function getChainstackProviderWiringHealth() {
  return { running: timer !== null, inFlight, lastResult, lastError, autoProvisioning: false as const };
}
