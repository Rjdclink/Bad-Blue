import logger from '../../../logger.js';
import {
  placeReservedCoinbaseSystemCapital,
  reconcilePendingCoinbaseSystemCapitalPlacements,
} from '../execution/coinbase-system-capital-placement.js';
import { reconcilePendingCexSystemCapitalPlacements } from '../execution/cex-system-capital-placement.js';
import { pool } from './cryptocrawl-runtime-database.js';

let installed = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function reconciliationIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_SYSTEM_CAPITAL_RECONCILE_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(120_000, Math.trunc(parsed))) : 15_000;
}

async function nextReservedCoinbaseAllocation(): Promise<string | null> {
  const result = await pool.query(
    `SELECT allocation_id
     FROM public.cryptocrawler_system_capital_allocations
     WHERE destination_kind='cex' AND lower(destination_venue)='coinbase' AND status='RESERVED'
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  return result.rows[0]?.allocation_id ? String(result.rows[0].allocation_id) : null;
}

async function reconcileOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // One runtime lifecycle owner may advance a RESERVED allocation. Coinbase is
    // enabled only through its provenance-backed native-gas adapter. Existing OKX
    // pending transactions remain reconciliation-only until the legacy submit path
    // is migrated behind the same system-owned gas-spend authority.
    const reservedCoinbase = await nextReservedCoinbaseAllocation();
    if (reservedCoinbase) {
      try {
        await placeReservedCoinbaseSystemCapital(reservedCoinbase);
      } catch (error) {
        logger.warn('[SystemCapitalPlacement] Coinbase RESERVED placement remained fail-closed', {
          component: 'SystemCapitalPlacement',
          allocationId: reservedCoinbase,
          error: error instanceof Error ? error.message : String(error),
          operatorNativeGasAuthorityGranted: false,
          sourceCapitalReleased: false,
          duplicateSubmissionAllowed: false,
        });
      }
    }

    const [coinbaseResults, existingResults] = await Promise.all([
      reconcilePendingCoinbaseSystemCapitalPlacements(20),
      reconcilePendingCexSystemCapitalPlacements(20),
    ]);
    const results = [...coinbaseResults, ...existingResults];
    const placed = results.filter(result => result.status === 'PLACED').length;
    const pending = results.filter(result => result.status === 'PLACEMENT_PENDING').length;
    if (reservedCoinbase || results.length > 0) {
      logger.info('[SystemCapitalPlacement] Canonical placement lifecycle cycle completed', {
        component: 'SystemCapitalPlacement',
        reservedCoinbaseAttempted: Boolean(reservedCoinbase),
        checked: results.length,
        placed,
        pending,
        sourceCapitalReleased: false,
        destinationSpendabilityRequiresPlacedState: true,
        coinbaseRawAccountBalanceAuthority: false,
        newOkxSubmissionEnabled: false,
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
  logger.info('[CryptoCoreRuntime] System-capital placement lifecycle installed', {
    component: 'CryptoCoreRuntime',
    lifecycleOwner: 'CryptoCoreRuntime',
    createsAllocations: false,
    selectsStrategies: false,
    submitsNewPlacementTransactions: 'coinbase_only_with_provenance_backed_system_native_gas',
    reconcilesExistingPendingTransactions: true,
    duplicatePlacementAuthorityCreated: false,
    intervalMs: process.env.NO_INTERVALS === 'true' ? null : reconciliationIntervalMs(),
  });
}

export function stopSystemCapitalPlacementReconciliation(): void {
  if (timer) clearInterval(timer);
  timer = null;
  installed = false;
}
