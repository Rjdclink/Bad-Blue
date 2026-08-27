import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { TradingViewEngine } from '../babel/tradingview-integration.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { marketDataProviders, type MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { getCexScanCapacity, type ScanCapacityDecision } from './scan-capacity-policy.js';

export type MeasuredOpportunityTopology =
  | 'CEX_CEX'
  | 'DEX_ATOMIC'
  | 'ZERO_CAPITAL_ATOMIC'
  | 'CROSS_CHAIN'
  | 'MEMPOOL_BACKRUN';

export interface MeasuredOpportunityGraphCycle {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  topology: 'CEX_CEX';
  universeAssets: number;
  selectedSymbols: number;
  evaluatedSymbols: number;
  deterministicPositive: number;
  assessedCandidates: number;
  eligibleCandidates: number;
  capacity: ScanCapacityDecision;
  positivePlans: Array<{
    opportunityId: string;
    symbol: string;
    buyVenue: string;
    sellVenue: string;
    notionalUsd: number;
    netProfitUsd: number;
    quoteAgeMs: number;
  }>;
  errors: string[];
}

function positiveFinite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueSymbols(configuredSymbol: string, universe: readonly MarketUniverseAsset[]): string[] {
  return [...new Set([
    configuredSymbol,
    ...universe.map(asset => asset.symbol.trim().toUpperCase()).filter(Boolean),
  ])];
}

function planKey(plan: VerifiedArbitragePlan): string {
  return `${plan.buyVenue}:${plan.sellVenue}:${plan.symbol}`;
}

function opportunityId(plan: VerifiedArbitragePlan): string {
  return `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`;
}

async function runBounded<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(items.length, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

class MeasuredOpportunityGraph {
  private timer: NodeJS.Timeout | null = null;
  private scanInFlight: Promise<MeasuredOpportunityGraphCycle> | null = null;
  private latestCycle: MeasuredOpportunityGraphCycle | null = null;

  async scanOnce(): Promise<MeasuredOpportunityGraphCycle> {
    if (this.scanInFlight) return this.scanInFlight;
    const promise = this.runCycle().finally(() => {
      this.scanInFlight = null;
    });
    this.scanInFlight = promise;
    return promise;
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(2_000, Number(process.env.CRYPTOCRAWL_OPPORTUNITY_GRAPH_INTERVAL_MS || 5_000));
    void this.scanOnce().catch(error => {
      logger.warn('[OpportunityGraph] Initial measured scan failed closed', {
        component: 'MeasuredOpportunityGraph',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.timer = setInterval(() => {
      void this.scanOnce().catch(error => {
        logger.warn('[OpportunityGraph] Measured scan failed closed', {
          component: 'MeasuredOpportunityGraph',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, intervalMs);
    this.timer.unref?.();
    logger.info('[OpportunityGraph] Continuous measured discovery started', {
      component: 'MeasuredOpportunityGraph',
      intervalMs,
      topology: 'CEX_CEX',
      syntheticEvidenceAllowed: false,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getLatestCycle(): MeasuredOpportunityGraphCycle | null {
    if (!this.latestCycle) return null;
    return {
      ...this.latestCycle,
      capacity: { ...this.latestCycle.capacity },
      positivePlans: this.latestCycle.positivePlans.map(plan => ({ ...plan })),
      errors: [...this.latestCycle.errors],
    };
  }

  private async runCycle(): Promise<MeasuredOpportunityGraphCycle> {
    const startedAt = Date.now();
    const cycleId = `cex-graph:${startedAt}`;
    const errors: string[] = [];
    const configuredSymbol = (process.env.CRYPTO_ARBITRAGE_SYMBOL || 'ETHUSDT').trim().toUpperCase();
    const maxNotionalUsd = positiveFinite(process.env.CRYPTO_ARBITRAGE_NOTIONAL_USD, 200);
    const maxQuoteAgeMs = positiveFinite(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS, 5_000);

    const universe = await marketDataProviders.discoverUniverse();
    const symbols = uniqueSymbols(configuredSymbol, universe);
    const capacity = getCexScanCapacity(symbols.length);
    const selected = symbols.slice(0, capacity.symbolBudget);

    // CEX inventory arbitrage is evaluated as pre-positioned inventory. It does
    // not silently add on-chain gas/bridge cost to the instantaneous CEX trade.
    // Rebalancing/bridge economics belong to their own candidate topology.
    const evaluated = await runBounded(selected, capacity.workerConcurrency, async symbol => {
      try {
        return await arbitrageVerifier.evaluateOnce({
          symbol,
          notionalUsd: maxNotionalUsd,
          maxQuoteAgeMs,
          gas: { enabled: false, chain: 'polygon' },
          bridge: { enabled: false, fromChain: 'polygon', toChain: 'polygon', token: 'USDC' },
        });
      } catch (error) {
        errors.push(`${symbol}:${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    });

    const byRoute = new Map<string, VerifiedArbitragePlan>();
    for (const plan of evaluated) {
      if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) continue;
      const key = planKey(plan);
      const previous = byRoute.get(key);
      if (!previous || plan.netProfitUsd > previous.netProfitUsd) byRoute.set(key, plan);
    }
    const positivePlans = [...byRoute.values()].sort((left, right) => right.netProfitUsd - left.netProfitUsd);

    // Cheap deterministic economics already ran inside ArbitrageVerifier. Only a
    // bounded high-value subset receives TradingView + Cryptara + Hyper MC work.
    const maxAssessments = Math.max(1, Math.min(
      positivePlans.length || 1,
      Number(process.env.CRYPTOCRAWL_DEEP_ASSESSMENT_CANDIDATES || 12),
      24,
    ));
    const assessmentCandidates = positivePlans.slice(0, maxAssessments);
    let eligibleCandidates = 0;

    if (assessmentCandidates.length > 0) {
      const cryptara = getCryptara();
      if (!cryptara.getStatus().isRunning) {
        try {
          await cryptara.initialize();
        } catch (error) {
          errors.push(`cryptara_initialize:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (cryptara.getStatus().isRunning) {
        const providerStatuses = marketDataProviders.getProviderStatuses();
        await runBounded(assessmentCandidates, Math.min(4, assessmentCandidates.length), async plan => {
          const observedAt = Date.now();
          let technical = null;
          try {
            technical = await TradingViewEngine.getAnalysis(plan.symbol, '1h');
          } catch (error) {
            errors.push(`technical:${plan.symbol}:${error instanceof Error ? error.message : String(error)}`);
          }

          try {
            const assessment = await cryptara.assessOpportunity({
              opportunityId: opportunityId(plan),
              observedAt,
              chain: 'cex',
              symbol: plan.symbol,
              plan,
              tradingView: technical,
              mempool: alchemyIntegration.getMempoolAnalysis(),
              marketUniverse: universe,
              dexObservation: null,
              missingInformation: [
                ...(technical ? [] : ['live_technical_analysis']),
                ...providerStatuses
                  .filter(status => status.state === 'failed' || status.state === 'stale' || status.state === 'unavailable')
                  .map(status => `provider_${status.provider}_${status.state}`),
              ],
              provenance: [
                'measured_opportunity_graph',
                'direct_exchange_quotes',
                ...(technical?.dataProvenance === 'live' ? ['TradingView'] : []),
                ...[...new Set(universe.flatMap(asset => asset.sources || [asset.source]))],
                ...providerStatuses.map(status => `provider:${status.provider}:${status.state}`),
              ],
            });
            if (assessment.recommendation === 'consider' && plan.netProfitUsd > 0) eligibleCandidates++;
          } catch (error) {
            errors.push(`assessment:${plan.symbol}:${error instanceof Error ? error.message : String(error)}`);
          }
        });
      }
    }

    const completedAt = Date.now();
    const cycle: MeasuredOpportunityGraphCycle = {
      cycleId,
      startedAt,
      completedAt,
      topology: 'CEX_CEX',
      universeAssets: universe.length,
      selectedSymbols: selected.length,
      evaluatedSymbols: evaluated.length,
      deterministicPositive: positivePlans.length,
      assessedCandidates: assessmentCandidates.length,
      eligibleCandidates,
      capacity,
      positivePlans: positivePlans.map(plan => ({
        opportunityId: opportunityId(plan),
        symbol: plan.symbol,
        buyVenue: plan.buyVenue,
        sellVenue: plan.sellVenue,
        notionalUsd: plan.notionalUsd,
        netProfitUsd: plan.netProfitUsd,
        quoteAgeMs: plan.quoteAgeMs,
      })),
      errors,
    };
    this.latestCycle = cycle;

    const canonical = canonicalOpportunityState.getMetrics(60_000);
    logger.info('[OpportunityGraph] Measured CEX cycle completed', {
      component: 'MeasuredOpportunityGraph',
      cycleId,
      durationMs: completedAt - startedAt,
      universeAssets: cycle.universeAssets,
      selectedSymbols: cycle.selectedSymbols,
      deterministicPositive: cycle.deterministicPositive,
      assessedCandidates: cycle.assessedCandidates,
      eligibleCandidates: cycle.eligibleCandidates,
      canonicalObservedPerMinute: canonical.observedOpportunities,
      canonicalVerifiedPositivePerMinute: canonical.verifiedPositiveOpportunities,
      canonicalEligiblePerMinute: canonical.eligibleOpportunities,
      errors: errors.slice(0, 12),
    });
    return this.getLatestCycle()!;
  }
}

export const measuredOpportunityGraph = new MeasuredOpportunityGraph();
