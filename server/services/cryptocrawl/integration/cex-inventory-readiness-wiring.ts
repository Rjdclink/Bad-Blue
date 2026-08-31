import logger from '../../../logger.js';
import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { cexInventoryLedger, type InventoryVenue } from '../execution/cex-inventory-ledger.js';
import { createProductionCexSettlementAdapters, type CexSettlementAdapter, type ExecutableCexVenue } from '../execution/cex-settlement.js';
import { stageManager } from '../governance/stage-management.js';
import { buildExecutionReadinessProfitabilityPlan } from '../optimization/execution-readiness-profitability-policy.js';

interface BalanceCapableAdapter extends CexSettlementAdapter {
  getBalances: () => Promise<Record<string, string>>;
}

export interface CexInventoryReadinessSnapshot {
  observedAt: number;
  running: boolean;
  configuredExecutableVenues: ExecutableCexVenue[];
  reconciledVenues: ExecutableCexVenue[];
  failedVenues: Array<{ venue: ExecutableCexVenue; error: string }>;
  /** Compatibility count of authenticated venue/asset rows, including zero balances. */
  inventoryAssets: number;
  positiveBalanceAssets: number;
  spendableAssets: number;
  payoutReservedAssets: number;
  inventoryFreshnessShare: number | null;
  nextRefreshMs: number;
  activeReadinessRules: number;
  authority: 'authenticated_balance_readiness_only';
  executionAuthority: false;
  syntheticBalancesAllowed: false;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let latest: CexInventoryReadinessSnapshot = {
  observedAt: 0,
  running: false,
  configuredExecutableVenues: [],
  reconciledVenues: [],
  failedVenues: [],
  inventoryAssets: 0,
  positiveBalanceAssets: 0,
  spendableAssets: 0,
  payoutReservedAssets: 0,
  inventoryFreshnessShare: null,
  nextRefreshMs: 60_000,
  activeReadinessRules: 0,
  authority: 'authenticated_balance_readiness_only',
  executionAuthority: false,
  syntheticBalancesAllowed: false,
};

function baseRefreshMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_INVENTORY_REFRESH_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(10_000, Math.min(300_000, Math.trunc(parsed))) : 60_000;
}

function freshnessWindowMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CEX_INVENTORY_FRESH_MS || 90_000);
  return Number.isFinite(parsed) ? Math.max(15_000, Math.min(600_000, Math.trunc(parsed))) : 90_000;
}

function spendable(snapshot: ReturnType<typeof cexInventoryLedger.getSnapshots>[number]): number {
  return Math.max(0,
    snapshot.available - snapshot.reserved - snapshot.payoutReserved - snapshot.pendingOrder - snapshot.pendingTransfer - snapshot.minimumReserve,
  );
}

function currentMetrics(now = Date.now()) {
  const snapshots = cexInventoryLedger.getSnapshots();
  const venues = new Set(snapshots.map(item => item.venue));
  const fresh = snapshots.filter(item => now - item.lastReconciliationAt <= freshnessWindowMs());
  return {
    snapshots,
    inventoryAssetCount: snapshots.length,
    positiveBalanceAssetCount: snapshots.filter(item => item.available > 0).length,
    inventoryVenueCount: venues.size,
    inventoryFreshnessShare: snapshots.length > 0 ? fresh.length / snapshots.length : 0,
    spendableAssets: snapshots.filter(item => spendable(item) > 0).length,
    payoutReservedAssets: snapshots.filter(item => item.payoutReserved > 0).length,
  };
}

function nextRefreshIntervalMs(): { intervalMs: number; activeRules: number } {
  const metrics = currentMetrics();
  const state = stageManager.getState();
  const plan = buildExecutionReadinessProfitabilityPlan({
    inventoryAssetCount: metrics.positiveBalanceAssetCount,
    inventoryVenueCount: metrics.inventoryVenueCount,
    inventoryFreshnessShare: metrics.inventoryFreshnessShare,
    governanceCanExecute: stageManager.canExecuteTrades() ? 1 : 0,
    stageNumber: state.currentStage,
  });
  return {
    intervalMs: Math.max(10_000, Math.min(300_000, Math.round(baseRefreshMs() * plan.inventoryRefreshIntervalMultiplier))),
    activeRules: plan.activeRuleCount,
  };
}

async function refreshOnce(): Promise<void> {
  const venues = getActiveExecutableQuoteVenues() as ExecutableCexVenue[];
  const adapters = createProductionCexSettlementAdapters();
  const reconciledVenues: ExecutableCexVenue[] = [];
  const failedVenues: Array<{ venue: ExecutableCexVenue; error: string }> = [];

  await Promise.allSettled(venues.map(async venue => {
    const adapter = adapters[venue] as BalanceCapableAdapter | undefined;
    if (!adapter?.getBalances) {
      failedVenues.push({ venue, error: 'authenticated_balance_adapter_unavailable' });
      return;
    }
    try {
      const balances = await adapter.getBalances();
      await cexInventoryLedger.reconcile(venue as InventoryVenue, balances);
      reconciledVenues.push(venue);
    } catch (error) {
      failedVenues.push({ venue, error: error instanceof Error ? error.message : String(error) });
    }
  }));

  const metrics = currentMetrics();
  const next = nextRefreshIntervalMs();
  latest = {
    observedAt: Date.now(),
    running: false,
    configuredExecutableVenues: [...venues],
    reconciledVenues: [...reconciledVenues],
    failedVenues: [...failedVenues],
    inventoryAssets: metrics.inventoryAssetCount,
    positiveBalanceAssets: metrics.positiveBalanceAssetCount,
    spendableAssets: metrics.spendableAssets,
    payoutReservedAssets: metrics.payoutReservedAssets,
    inventoryFreshnessShare: metrics.inventoryAssetCount > 0 ? metrics.inventoryFreshnessShare : null,
    nextRefreshMs: next.intervalMs,
    activeReadinessRules: next.activeRules,
    authority: 'authenticated_balance_readiness_only',
    executionAuthority: false,
    syntheticBalancesAllowed: false,
  };

  logger.info('[CexInventoryReadiness] Authenticated execution inventory refreshed', {
    component: 'CexInventoryReadinessWiring',
    configuredExecutableVenues: venues,
    reconciledVenues,
    failedVenues: failedVenues.map(item => ({ venue: item.venue, error: item.error })),
    inventoryAssetRows: metrics.inventoryAssetCount,
    positiveBalanceAssets: metrics.positiveBalanceAssetCount,
    spendableAssets: metrics.spendableAssets,
    payoutReservedAssets: metrics.payoutReservedAssets,
    zeroBalanceRowsExcludedFromReadinessPressure: true,
    payoutShareExcludedFromNewTradeSpendability: true,
    retainedShareRemainsSpendable: true,
    inventoryFreshnessShare: latest.inventoryFreshnessShare,
    nextRefreshMs: latest.nextRefreshMs,
    proactiveHydration: true,
    zeroInventoryBypass: false,
    executionAuthority: false,
    syntheticBalancesAllowed: false,
  });
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  const { intervalMs } = nextRefreshIntervalMs();
  timer = setTimeout(async () => {
    timer = null;
    await runRefresh();
    scheduleNext();
  }, intervalMs);
  timer.unref?.();
}

async function runRefresh(): Promise<void> {
  if (running) return running;
  latest = { ...latest, running: true };
  running = refreshOnce().catch(error => {
    logger.warn('[CexInventoryReadiness] Inventory hydration cycle failed closed', {
      component: 'CexInventoryReadinessWiring',
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }).finally(() => {
    running = null;
    latest = { ...latest, running: false };
  });
  return running;
}

export function ensureCexInventoryReadinessWiring(): void {
  if (timer || running || process.env.CRYPTOCRAWL_CEX_INVENTORY_READINESS_ENABLED === 'false') return;
  void runRefresh().finally(scheduleNext);
  logger.info('[CexInventoryReadiness] Proactive authenticated inventory hydration installed', {
    component: 'CexInventoryReadinessWiring',
    baseRefreshMs: baseRefreshMs(),
    freshnessWindowMs: freshnessWindowMs(),
    privateRequestDeduplication: 'one_in_flight_cycle',
    liveExecutionPreparation: true,
    payoutReservationsProtectedFromNewOrders: true,
    retainedFortyPercentAvailableToStrategies: true,
    stageManagerAuthorityPreserved: true,
    strictPositiveNetAuthorityPreserved: true,
    executionAuthority: false,
  });
}

export function getCexInventoryReadinessSnapshot(): CexInventoryReadinessSnapshot {
  return {
    ...latest,
    configuredExecutableVenues: [...latest.configuredExecutableVenues],
    reconciledVenues: [...latest.reconciledVenues],
    failedVenues: latest.failedVenues.map(item => ({ ...item })),
  };
}
