import logger from '../../../logger.js';
import { autonomousFaucet, DAILY_TARGET_CONFIG, STEALTH_CONFIG } from './autonomous-faucet.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { executeVerifiedArbitragePlan } from '../execution/index.js';
import { stageManager } from '../governance/stage-management.js';

const installed = new WeakSet<object>();
const inFlight = new Set<string>();
const lastAttemptAt = new Map<string, number>();
const venueInFlight = new Map<string, number>();

type FaucetRuntime = {
  state: {
    executionMode: 'disabled' | 'live';
    lastArbitrageDecision: 'EXECUTE' | 'PENDING' | 'SKIP' | 'ERROR' | 'NONE';
    tradesThisHour: number;
    tradesThisDay: number;
    profitThisSession: number;
    profitThisHour: number;
    profitThisDay: number;
    profitThisWindow: number;
    dailyTargetProgress: number;
  };
  executeWithStealth: () => Promise<void>;
  recordSuccess: () => void;
  recordFailure: (operation: string) => void;
};

function executionKey(snapshot: ReturnType<typeof canonicalOpportunityState.getLatest>): string | null {
  if (!snapshot?.plan) return null;
  return `${snapshot.plan.buyVenue}:${snapshot.plan.sellVenue}:${snapshot.plan.symbol}`;
}

function currentCandidates() {
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const now = Date.now();
  return canonicalOpportunityState.getRecent(256)
    .filter(snapshot => snapshot.plan && snapshot.plan.netProfitUsd > 0)
    .filter(snapshot => snapshot.assessment?.recommendation === 'consider')
    .filter(snapshot => snapshot.plan!.quoteAgeMs <= maxQuoteAgeMs)
    .filter(snapshot => now - snapshot.observedAt <= maxQuoteAgeMs)
    .sort((left, right) => (right.assessment?.rankScore ?? -Infinity) - (left.assessment?.rankScore ?? -Infinity));
}

function remainingExpectedProfitBudget(state: FaucetRuntime['state'], currentWindowTarget: number): number {
  return Math.max(0, Math.min(
    DAILY_TARGET_CONFIG.dailyTarget - state.profitThisDay,
    STEALTH_CONFIG.maxHourlyProfit - state.profitThisHour,
    Math.min(currentWindowTarget, DAILY_TARGET_CONFIG.maxWindowProfit) - state.profitThisWindow,
  ));
}

function selectWithinExistingCaps(target: FaucetRuntime, candidates: ReturnType<typeof currentCandidates>) {
  const variance = (Math.random() * 2 - 1) * DAILY_TARGET_CONFIG.windowVariance;
  const currentWindowTarget = DAILY_TARGET_CONFIG.baseWindowTarget * (1 + variance);
  let profitBudget = remainingExpectedProfitBudget(target.state, currentWindowTarget);
  let tradeBudget = Math.max(0, STEALTH_CONFIG.maxTradesPerHour - target.state.tradesThisHour);
  if (profitBudget <= 0 || tradeBudget <= 0) return [];

  const selected: typeof candidates = [];
  for (const snapshot of candidates) {
    const expectedProfit = snapshot.plan?.netProfitUsd ?? 0;
    if (!(expectedProfit > 0)) continue;
    if (tradeBudget <= 0) break;
    if (expectedProfit > profitBudget) continue;
    selected.push(snapshot);
    profitBudget -= expectedProfit;
    tradeBudget--;
  }
  return selected;
}

function venueCapacityAvailable(snapshot: ReturnType<typeof canonicalOpportunityState.getLatest>, maxPerVenue: number): boolean {
  if (!snapshot?.plan) return false;
  return [snapshot.plan.buyVenue, snapshot.plan.sellVenue]
    .every(venue => (venueInFlight.get(venue) || 0) < maxPerVenue);
}

function changeVenueLoad(snapshot: ReturnType<typeof canonicalOpportunityState.getLatest>, delta: 1 | -1): void {
  if (!snapshot?.plan) return;
  for (const venue of [snapshot.plan.buyVenue, snapshot.plan.sellVenue]) {
    const next = Math.max(0, (venueInFlight.get(venue) || 0) + delta);
    if (next === 0) venueInFlight.delete(venue);
    else venueInFlight.set(venue, next);
  }
}

function applyRealizedProfit(target: FaucetRuntime, realizedProfitUsd: number | null | undefined): void {
  if (realizedProfitUsd === null || realizedProfitUsd === undefined || !Number.isFinite(realizedProfitUsd)) return;
  target.state.profitThisSession += realizedProfitUsd;
  target.state.profitThisHour += realizedProfitUsd;
  target.state.profitThisDay += realizedProfitUsd;
  target.state.profitThisWindow += realizedProfitUsd;
  target.state.dailyTargetProgress = DAILY_TARGET_CONFIG.dailyTarget > 0
    ? Math.max(0, Math.min(100, target.state.profitThisDay / DAILY_TARGET_CONFIG.dailyTarget * 100))
    : 0;
}

async function runBounded<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export function ensureConcurrentExecutionWiring(): void {
  const target = autonomousFaucet as unknown as FaucetRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  target.executeWithStealth = async (): Promise<void> => {
    if (target.state.executionMode !== 'live') {
      target.state.lastArbitrageDecision = 'SKIP';
      return;
    }
    if (!stageManager.canExecuteTrades()) {
      target.state.lastArbitrageDecision = 'SKIP';
      return;
    }
    if (target.state.profitThisDay >= DAILY_TARGET_CONFIG.dailyTarget ||
        target.state.profitThisHour >= STEALTH_CONFIG.maxHourlyProfit ||
        target.state.tradesThisHour >= STEALTH_CONFIG.maxTradesPerHour) {
      target.state.lastArbitrageDecision = 'SKIP';
      return;
    }

    const concurrency = Math.max(1, Math.min(32, Number(process.env.CRYPTOCRAWL_EXECUTION_CONCURRENCY || 4)));
    const maxPerVenue = Math.max(1, Math.min(8, Number(process.env.CRYPTOCRAWL_MAX_CONCURRENT_PER_VENUE || 2)));
    const retryWindowMs = Math.max(250, Number(process.env.CRYPTOCRAWL_EXECUTION_RETRY_WINDOW_MS || 5000));
    const now = Date.now();
    const uncappedCandidates = currentCandidates().filter(snapshot => {
      const key = executionKey(snapshot);
      if (!key || inFlight.has(key) || !venueCapacityAvailable(snapshot, maxPerVenue)) return false;
      return now - (lastAttemptAt.get(key) || 0) >= retryWindowMs;
    });
    const candidates = selectWithinExistingCaps(target, uncappedCandidates);

    if (candidates.length === 0) {
      target.state.lastArbitrageDecision = 'SKIP';
      return;
    }

    logger.info('[FAUCET] Canonical concurrent execution batch selected', {
      component: 'ConcurrentExecutionWiring',
      candidateCount: candidates.length,
      concurrency,
      maxConcurrentPerVenue: maxPerVenue,
      stage: stageManager.getCurrentStage(),
      caps: {
        tradesThisHour: target.state.tradesThisHour,
        maxTradesPerHour: STEALTH_CONFIG.maxTradesPerHour,
        profitThisHour: target.state.profitThisHour,
        maxHourlyProfit: STEALTH_CONFIG.maxHourlyProfit,
        profitThisDay: target.state.profitThisDay,
        dailyTarget: DAILY_TARGET_CONFIG.dailyTarget,
      },
      candidates: candidates.map(snapshot => ({
        opportunityId: snapshot.opportunityId,
        symbol: snapshot.symbol,
        buyVenue: snapshot.plan?.buyVenue,
        sellVenue: snapshot.plan?.sellVenue,
        netProfitUsd: snapshot.plan?.netProfitUsd,
        rankScore: snapshot.assessment?.rankScore,
      })),
    });

    let settledSuccesses = 0;
    let pending = 0;
    let failures = 0;
    await runBounded(candidates, concurrency, async snapshot => {
      const key = executionKey(snapshot);
      const plan = snapshot.plan;
      if (!key || !plan || !venueCapacityAvailable(snapshot, maxPerVenue)) return;
      inFlight.add(key);
      changeVenueLoad(snapshot, 1);
      lastAttemptAt.set(key, Date.now());
      try {
        const result = await executeVerifiedArbitragePlan(plan, {
          source: 'master_pipeline',
          chain: plan.bridge?.from,
          observedSlippageBps: plan.expectedSlippageBps ?? undefined,
        });
        if (result.success && result.settlementConfirmed) {
          settledSuccesses++;
          target.state.tradesThisHour++;
          target.state.tradesThisDay++;
          applyRealizedProfit(target, result.normalized?.realized.netProfitUsd);
          target.recordSuccess();
        } else if (
          result.status === 'submitted' ||
          result.status === 'settlement_unknown' ||
          result.status === 'partially_filled' ||
          (!result.success && result.status === 'filled' && result.settlementConfirmed)
        ) {
          pending++;
        } else {
          failures++;
          target.recordFailure(`concurrent_execution_${result.status}`);
        }
      } catch (error) {
        failures++;
        target.recordFailure('concurrent_execution_exception');
        logger.error('[FAUCET] Concurrent candidate execution failed', {
          component: 'ConcurrentExecutionWiring',
          opportunityId: snapshot.opportunityId,
          symbol: snapshot.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        changeVenueLoad(snapshot, -1);
        inFlight.delete(key);
      }
    });

    target.state.lastArbitrageDecision = settledSuccesses > 0
      ? 'EXECUTE'
      : pending > 0
        ? 'PENDING'
        : failures > 0
          ? 'ERROR'
          : 'SKIP';

    logger.info('[FAUCET] Canonical concurrent execution batch completed', {
      component: 'ConcurrentExecutionWiring',
      candidates: candidates.length,
      settledSuccesses,
      pending,
      failures,
      realizedProfitState: {
        session: target.state.profitThisSession,
        hour: target.state.profitThisHour,
        day: target.state.profitThisDay,
        window: target.state.profitThisWindow,
      },
      inFlight: inFlight.size,
      venueInFlight: Object.fromEntries(venueInFlight),
    });
  };

  logger.info('[FAUCET] Concurrent execution wiring installed', {
    component: 'ConcurrentExecutionWiring',
    authority: 'canonical_verified_opportunities',
    maxConfiguredConcurrency: Math.max(1, Math.min(32, Number(process.env.CRYPTOCRAWL_EXECUTION_CONCURRENCY || 4))),
    preservedFaucetCaps: ['daily_profit', 'hourly_profit', 'window_profit', 'hourly_trade_count'],
    settlementSemantics: 'terminal_realized_only',
    sharedCexNonceState: true,
  });
}
