import logger from '../../../logger.js';
import { reconcilePendingCexSystemCapitalPlacements } from '../execution/cex-system-capital-placement.js';

let installed = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function reconciliationIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_RECONCILE_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(120_000, Math.trunc(parsed))) : 15_000;
}

async function reconcileOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const results = await reconcilePendingCexSystemCapitalPlacements(20);
    const placed = results.filter(result => result.status === 'PLACED').length;
    const pending = results.filter(result => result.status === 'PLACEMENT_PENDING').length;
    if (results.length > 0) {
      logger.info('[SystemCapitalPlacement] Pending placement reconciliation completed', {
        component: 'SystemCapitalPlacement',
        checked: results.length,
        placed,
        pending,
        sourceCapitalReleased: false,
        destinationSpendabilityRequiresPlacedState: true,
      });
    }
  })().catch(error => {
    logger.error('[SystemCapitalPlacement] Reconciliation cycle failed closed', {
      component: 'SystemCapitalPlacement',
      error: error instanceof Error ? error.message : String(error),
      sourceCapitalReleased: false,
      destinationInventorySpendableWithoutPlacement: false,
    });
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function ensureSystemCapitalPlacementReconciliation(): void {
  if (installed) return;
  installed = true;
  queueMicrotask(() => void reconcileOnce());
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void reconcileOnce(), reconciliationIntervalMs());
    timer.unref?.();
  }
  logger.info('[CryptoCoreRuntime] System-capital placement reconciliation installed', {
    component: 'CryptoCoreRuntime',
    lifecycleOwner: 'CryptoCoreRuntime',
    createsAllocations: false,
    selectsStrategies: false,
    submitsNewPlacementTransactions: false,
    reconcilesExistingPendingTransactionsOnly: true,
    intervalMs: process.env.NO_INTERVALS === 'true' ? null : reconciliationIntervalMs(),
  });
}

export function stopSystemCapitalPlacementReconciliation(): void {
  if (timer) clearInterval(timer);
  timer = null;
  installed = false;
}
