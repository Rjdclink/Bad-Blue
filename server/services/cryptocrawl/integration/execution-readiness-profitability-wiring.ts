import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { cexInventoryLedger } from '../execution/cex-inventory-ledger.js';
import { stageManager } from '../governance/stage-management.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { getProviderQualityAuctionSnapshot } from '../intelligence/provider-quality-auction.js';
import { buildExecutionReadinessProfitabilityPlan, type ExecutionReadinessProfitabilityPlan } from '../optimization/execution-readiness-profitability-policy.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';
import { getCexInventoryReadinessSnapshot } from './cex-inventory-readiness-wiring.js';

interface RetainedSymbol {
  symbol: string;
  buyVenue: 'kraken' | 'okx';
  sellVenue: 'kraken' | 'okx';
  bestGapBps: number;
  retainedUntil: number;
  lastObservedAt: number;
}

export interface ExecutionReadinessProfitabilitySnapshot {
  observedAt: number;
  closestFeeGapBps: number | null;
  bestExpectedGapBps: number | null;
  retainedSymbols: string[];
  prewarmedSymbols: string[];
  canonicalRevalidationTriggered: boolean;
  eligibleCandidates: number;
  expiringCandidates: number;
  inventoryAssets: number;
  inventoryVenues: number;
  governanceCanExecute: boolean;
  stage: number;
  policy: ExecutionReadinessProfitabilityPlan;
  authority: 'prewarm_and_revalidation_only';
  executionAuthority: false;
  optimizerCanVetoEligibleExecution: false;
}

const retained = new Map<string, RetainedSymbol>();
let timer: NodeJS.Timeout | null = null;
let cycleInFlight: Promise<void> | null = null;
let revalidationInFlight: Promise<void> | null = null;
let lastRevalidationAt = 0;
let latest: ExecutionReadinessProfitabilitySnapshot | null = null;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function stablecoinBase(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return ['USDGUSDT','RLUSDUSDT','USDCUSDT','DAIUSDT','PYUSDUSDT','USDSUSDT','USD1USDT','TUSDUSDT','USDDUSDT','STABLEUSDT'].includes(normalized);
}

function inventoryMetrics(now: number) {
  const snapshots = cexInventoryLedger.getSnapshots();
  const venues = new Set(snapshots.map(item => item.venue));
  const freshWindowMs = bounded(process.env.CRYPTOCRAWL_CEX_INVENTORY_FRESH_MS, 90_000, 15_000, 600_000);
  const fresh = snapshots.filter(item => now - item.lastReconciliationAt <= freshWindowMs).length;
  return {
    assets: snapshots.length,
    venues: venues.size,
    freshnessShare: snapshots.length > 0 ? fresh / snapshots.length : 0,
  };
}

function candidateMetrics(now: number) {
  const recent = measuredCandidateRegistry.getRecent(512);
  return {
    eligible: recent.filter(item => item.status === 'eligible' && item.expiresAt > now).length,
    expiring: recent.filter(item =>
      (item.status === 'eligible' || item.status === 'deterministic_positive')
      && item.expiresAt > now
      && item.expiresAt - now <= 5_000,
    ).length,
  };
}

function buildCurrentPlan(now = Date.now()): { plan: ExecutionReadinessProfitabilityPlan; modes: ReturnType<typeof getCexFourModeSnapshot>; eligible: number; expiring: number; inventoryAssets: number; inventoryVenues: number } {
  const modes = getCexFourModeSnapshot();
  const negatives = modes.filter(item => !item.economicallyPositive && Number.isFinite(item.bpsToBreakEven));
  const expectedGaps = modes
    .filter(item => !item.economicallyPositive && Number.isFinite(item.expectedFeeAdjustedBps))
    .map(item => Math.max(0, -item.expectedFeeAdjustedBps));
  const feeAges = modes.map(item => Number(item.feeEvidenceAgeMs)).filter(Number.isFinite);
  const freshness = modes.map(item => Number(item.feeFreshnessScore)).filter(Number.isFinite);
  const stablecoinGaps = negatives.filter(item => stablecoinBase(item.symbol)).map(item => item.bpsToBreakEven);
  const quoteAges = modes.map(item => Math.max(0, now - item.observedAt)).filter(Number.isFinite);
  const makerProbabilities = modes.map(item => item.makerFillProbability).filter((value): value is number => value !== null && Number.isFinite(value));
  const queueRisks = modes.map(item => Number(item.queueRiskPenaltyBps)).filter(Number.isFinite);
  const candidates = candidateMetrics(now);
  const inventory = inventoryMetrics(now);
  const provider = getProviderQualityAuctionSnapshot();
  const activeBids = provider.bids.filter(item => !item.temporarilyDeprioritized);
  const providerQuality = activeBids.length > 0 ? activeBids.reduce((sum, item) => sum + item.qualityScore, 0) / activeBids.length : 0;
  const providerFailureRate = activeBids.length > 0 ? Math.max(...activeBids.map(item => item.failureRate)) : 1;
  const providerLatencyMs = activeBids.length > 0 ? Math.max(...activeBids.map(item => item.p95LatencyMs)) : 1_000;
  const state = stageManager.getState();
  const plan = buildExecutionReadinessProfitabilityPlan({
    closestFeeGapBps: negatives.length > 0 ? Math.min(...negatives.map(item => item.bpsToBreakEven)) : null,
    bestExpectedGapBps: expectedGaps.length > 0 ? Math.min(...expectedGaps) : null,
    maxFeeAgeMs: feeAges.length > 0 ? Math.max(...feeAges) : null,
    feeFreshnessShare: freshness.length > 0 ? freshness.filter(value => value >= 0.75).length / freshness.length : null,
    stablecoinClosestGapBps: stablecoinGaps.length > 0 ? Math.min(...stablecoinGaps) : null,
    maxQuoteAgeMs: quoteAges.length > 0 ? Math.max(...quoteAges) : null,
    maxMakerFillProbability: makerProbabilities.length > 0 ? Math.max(...makerProbabilities) : null,
    maxQueueRiskPenaltyBps: queueRisks.length > 0 ? Math.max(...queueRisks) : null,
    inventoryAssetCount: inventory.assets,
    inventoryVenueCount: inventory.venues,
    inventoryFreshnessShare: inventory.freshnessShare,
    governanceCanExecute: stageManager.canExecuteTrades() ? 1 : 0,
    stageNumber: state.currentStage,
    eligibleCandidates: candidates.eligible,
    expiringCandidates: candidates.expiring,
    providerFailureRate,
    providerLatencyMs,
    providerQuality,
    observedModes: modes.length,
    positiveModes: modes.filter(item => item.economicallyPositive).length,
  });
  return { plan, modes, eligible: candidates.eligible, expiring: candidates.expiring, inventoryAssets: inventory.assets, inventoryVenues: inventory.venues };
}

function retainNearEdges(modes: ReturnType<typeof getCexFourModeSnapshot>, plan: ExecutionReadinessProfitabilityPlan, now: number): void {
  const baseTtlMs = bounded(process.env.CRYPTOCRAWL_NEAR_EDGE_RETENTION_MS, 15_000, 2_000, 120_000);
  const ttlMs = Math.round(Math.max(2_000, Math.min(180_000, baseTtlMs * plan.edgeRetentionMultiplier)));
  const thresholdBps = bounded(process.env.CRYPTOCRAWL_NEAR_EDGE_RETENTION_BPS, 25, 1, 100);
  const ranked = [...modes]
    .filter(item => !item.economicallyPositive && Number.isFinite(item.bpsToBreakEven) && item.bpsToBreakEven <= thresholdBps)
    .sort((left, right) => {
      const leftStable = stablecoinBase(left.symbol) ? plan.stablecoinFocusMultiplier : 1;
      const rightStable = stablecoinBase(right.symbol) ? plan.stablecoinFocusMultiplier : 1;
      return left.bpsToBreakEven / leftStable - right.bpsToBreakEven / rightStable;
    });
  const maxRetained = Math.max(4, Math.min(32, Math.round(8 * plan.bookPrewarmMultiplier)));
  for (const mode of ranked.slice(0, maxRetained)) {
    const current = retained.get(mode.symbol);
    if (!current || mode.bpsToBreakEven <= current.bestGapBps || current.retainedUntil <= now) {
      retained.set(mode.symbol, {
        symbol: mode.symbol,
        buyVenue: mode.buyVenue,
        sellVenue: mode.sellVenue,
        bestGapBps: mode.bpsToBreakEven,
        retainedUntil: now + ttlMs,
        lastObservedAt: mode.observedAt,
      });
    } else {
      current.retainedUntil = Math.max(current.retainedUntil, now + Math.round(ttlMs * 0.5));
      current.lastObservedAt = Math.max(current.lastObservedAt, mode.observedAt);
    }
  }
  for (const [symbol, item] of retained.entries()) {
    if (item.retainedUntil <= now) retained.delete(symbol);
  }
}

async function prewarm(retainedItems: RetainedSymbol[], plan: ExecutionReadinessProfitabilityPlan): Promise<string[]> {
  const base = bounded(process.env.CRYPTOCRAWL_EXECUTION_PREWARM_SYMBOLS, 6, 1, 24);
  const limit = Math.max(1, Math.min(32, Math.round(base * plan.bookPrewarmMultiplier * Math.min(1.5, plan.executionPrewarmMultiplier))));
  const selected = retainedItems
    .sort((left, right) => left.bestGapBps - right.bestGapBps || right.lastObservedAt - left.lastObservedAt)
    .slice(0, limit);
  await Promise.allSettled(selected.map(async item => {
    const quoteMaxAge = Math.max(500, Math.min(5_000, Math.round(2_000 / Math.max(0.75, plan.candidateRevalidationMultiplier))));
    await Promise.allSettled([
      cexOrderBookStreams.getQuote(item.buyVenue, item.symbol, quoteMaxAge),
      cexOrderBookStreams.getQuote(item.sellVenue, item.symbol, quoteMaxAge),
      resolveCexFeeEvidence(item.buyVenue, item.symbol),
      resolveCexFeeEvidence(item.sellVenue, item.symbol),
    ]);
  }));
  return selected.map(item => item.symbol);
}

function revalidationCooldownMs(plan: ExecutionReadinessProfitabilityPlan): number {
  const base = bounded(process.env.CRYPTOCRAWL_EXECUTION_REVALIDATION_COOLDOWN_MS, 5_000, 500, 30_000);
  return Math.max(500, Math.min(30_000, Math.round(base / Math.max(0.75, plan.candidateRevalidationMultiplier * plan.expiryUrgencyMultiplier))));
}

async function triggerCanonicalRevalidation(plan: ExecutionReadinessProfitabilityPlan): Promise<boolean> {
  if (revalidationInFlight || Date.now() - lastRevalidationAt < revalidationCooldownMs(plan)) return false;
  lastRevalidationAt = Date.now();
  revalidationInFlight = import('../discovery/opportunity-graph.js')
    .then(({ measuredOpportunityGraph }) => measuredOpportunityGraph.scanOnce())
    .then(cycle => {
      logger.info('[ExecutionReadinessProfitability] Canonical near-edge revalidation completed', {
        component: 'ExecutionReadinessProfitabilityWiring',
        cycleId: cycle.cycleId,
        deterministicPositive: cycle.deterministicPositive,
        eligibleCandidates: cycle.eligibleCandidates,
        triggerAuthority: 'fresh_revalidation_only',
        executionAuthority: false,
      });
    })
    .catch(error => {
      logger.warn('[ExecutionReadinessProfitability] Canonical revalidation degraded', {
        component: 'ExecutionReadinessProfitabilityWiring',
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
    })
    .finally(() => { revalidationInFlight = null; });
  await revalidationInFlight;
  return true;
}

async function cycle(): Promise<void> {
  const now = Date.now();
  const current = buildCurrentPlan(now);
  retainNearEdges(current.modes, current.plan, now);
  const retainedItems = [...retained.values()];
  const prewarmedSymbols = await prewarm(retainedItems, current.plan);
  const closestFeeGapBps = current.modes.filter(item => !item.economicallyPositive).reduce<number | null>((best, item) =>
    Number.isFinite(item.bpsToBreakEven) ? best === null ? item.bpsToBreakEven : Math.min(best, item.bpsToBreakEven) : best, null);
  const expectedGaps = current.modes
    .filter(item => !item.economicallyPositive && Number.isFinite(item.expectedFeeAdjustedBps))
    .map(item => Math.max(0, -item.expectedFeeAdjustedBps));
  const bestExpectedGapBps = expectedGaps.length > 0 ? Math.min(...expectedGaps) : null;
  const shouldRevalidate = current.modes.some(item => item.economicallyPositive)
    || (closestFeeGapBps !== null && closestFeeGapBps <= 2)
    || (bestExpectedGapBps !== null && bestExpectedGapBps <= 0.5)
    || current.eligible > 0
    || current.expiring > 0;
  const canonicalRevalidationTriggered = shouldRevalidate ? await triggerCanonicalRevalidation(current.plan) : false;
  latest = {
    observedAt: Date.now(),
    closestFeeGapBps,
    bestExpectedGapBps,
    retainedSymbols: retainedItems.map(item => item.symbol),
    prewarmedSymbols,
    canonicalRevalidationTriggered,
    eligibleCandidates: current.eligible,
    expiringCandidates: current.expiring,
    inventoryAssets: current.inventoryAssets,
    inventoryVenues: current.inventoryVenues,
    governanceCanExecute: stageManager.canExecuteTrades(),
    stage: stageManager.getState().currentStage,
    policy: current.plan,
    authority: 'prewarm_and_revalidation_only',
    executionAuthority: false,
    optimizerCanVetoEligibleExecution: false,
  };
  logger.info('[ExecutionReadinessProfitability] Dynamic live-execution preparation refreshed', {
    component: 'ExecutionReadinessProfitabilityWiring',
    closestFeeGapBps,
    bestExpectedGapBps,
    retainedSymbols: latest.retainedSymbols,
    prewarmedSymbols,
    eligibleCandidates: current.eligible,
    expiringCandidates: current.expiring,
    inventoryAssets: current.inventoryAssets,
    inventoryReadiness: getCexInventoryReadinessSnapshot(),
    governanceCanExecute: latest.governanceCanExecute,
    stage: latest.stage,
    activeRules: current.plan.activeRuleCount,
    canonicalRevalidationTriggered,
    optimizerCanVetoEligibleExecution: false,
    executionAuthority: false,
  });
}

function intervalMs(): number {
  const current = buildCurrentPlan();
  const base = bounded(process.env.CRYPTOCRAWL_EXECUTION_READINESS_INTERVAL_MS, 5_000, 1_000, 30_000);
  return Math.max(1_000, Math.min(30_000, Math.round(base / Math.max(0.75, current.plan.candidateRevalidationMultiplier))));
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  timer = setTimeout(async () => {
    timer = null;
    await runCycle();
    scheduleNext();
  }, intervalMs());
  timer.unref?.();
}

async function runCycle(): Promise<void> {
  if (cycleInFlight) return cycleInFlight;
  cycleInFlight = cycle().catch(error => {
    logger.warn('[ExecutionReadinessProfitability] Readiness cycle failed closed', {
      component: 'ExecutionReadinessProfitabilityWiring',
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
  }).finally(() => { cycleInFlight = null; });
  return cycleInFlight;
}

export function ensureExecutionReadinessProfitabilityWiring(): void {
  if (timer || cycleInFlight || process.env.CRYPTOCRAWL_EXECUTION_READINESS_OPTIMIZER_ENABLED === 'false') return;
  void runCycle().finally(scheduleNext);
  logger.info('[ExecutionReadinessProfitability] 200-rule execution-readiness optimizer installed', {
    component: 'ExecutionReadinessProfitabilityWiring',
    ruleCatalogSize: 200,
    nearEdgeRetentionUsesFreshRemeasurement: true,
    bookAndFeePrewarm: true,
    canonicalRevalidation: true,
    stageOneExecutionBypass: false,
    inventoryBypass: false,
    positiveNetBypass: false,
    optimizerCanVetoEligibleExecution: false,
    executionAuthority: false,
  });
}

export function getExecutionReadinessProfitabilitySnapshot(): ExecutionReadinessProfitabilitySnapshot | null {
  return latest ? {
    ...latest,
    retainedSymbols: [...latest.retainedSymbols],
    prewarmedSymbols: [...latest.prewarmedSymbols],
    policy: {
      ...latest.policy,
      activeRuleIds: [...latest.policy.activeRuleIds],
      activeRuleKeys: [...latest.policy.activeRuleKeys],
    },
  } : null;
}
