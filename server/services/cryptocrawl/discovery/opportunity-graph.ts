import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { getBoundTechnicalEvidence } from '../integration/technical-evidence-synchronizer.js';
import { marketDataProviders, type MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { buildObservedCexCandidates } from './cex-observation-candidates.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { scanPublicCexUniverse } from './public-cex-discovery.js';
import { getCexScanCapacity, type ScanCapacityDecision } from './scan-capacity-policy.js';

export interface MeasuredOpportunityGraphCycle {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  topology: 'CEX_CEX';
  universeAssets: number;
  selectedSymbols: number;
  evaluatedSymbols: number;
  publicDiscoveryObservations: number;
  publicDiscoveryVenues: number;
  publicDiscoveryFailures: number;
  observedCandidatesRegistered: number;
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

function registerDeterministicCexCandidate(plan: VerifiedArbitragePlan, observedAt: number, maxQuoteAgeMs: number): void {
  measuredCandidateRegistry.record({
    opportunityId: opportunityId(plan),
    topology: 'CEX_CEX',
    observedAt,
    expiresAt: observedAt + Math.max(1, maxQuoteAgeMs - Math.min(maxQuoteAgeMs, plan.quoteAgeMs)),
    status: 'deterministic_positive',
    assets: [plan.symbol],
    venues: [plan.buyVenue, plan.sellVenue],
    chains: ['cex'],
    rawQuotes: [
      { source: 'direct_exchange_quotes', venue: plan.buyVenue, symbol: plan.symbol, observedAt: observedAt - plan.quoteAgeMs, ask: plan.buyAsk, executable: true },
      { source: 'direct_exchange_quotes', venue: plan.sellVenue, symbol: plan.symbol, observedAt: observedAt - plan.quoteAgeMs, bid: plan.sellBid, executable: true },
    ],
    depth: {
      status: plan.liquidity.status === 'measured' ? 'measured' : 'unavailable',
      detail: plan.liquidity.status === 'measured' ? plan.liquidity.source.join(',') : 'Measured executable depth unavailable',
    },
    economics: {
      grossProfitUsd: plan.grossProfitUsd,
      deterministicNetProfitUsd: plan.netProfitUsd,
      feeUsd: plan.costs.buyFeeUsd + plan.costs.sellFeeUsd,
      gasUsd: plan.costs.gasUsd,
      bridgeUsd: plan.costs.bridgeFeeUsd,
      expectedSlippageBps: plan.expectedSlippageBps ?? null,
      expectedPriceImpactBps: plan.expectedPriceImpactBps ?? null,
    },
    quoteAgeMs: plan.quoteAgeMs,
    executableCapability: true,
    executionCapabilityReason: 'Kraken/OKX verified plan uses the settlement-safe centralized executor; MC, governance, inventory and resource locks still control admission',
    missingInformation: [],
    provenance: ['measured_opportunity_graph', 'direct_exchange_quotes', 'authenticated_fee_evidence', 'depth_aware_notional_search', 'deterministic_positive_net'],
  });
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
      candidateAuthority: 'measured_candidate_registry',
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

    const publicDiscoveryPromise = scanPublicCexUniverse(selected).catch(error => {
      errors.push(`public_cex_discovery:${error instanceof Error ? error.message : String(error)}`);
      return { startedAt, completedAt: Date.now(), symbols: selected.length, observations: [], failures: [] };
    });

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
    const publicDiscovery = await publicDiscoveryPromise;

    // Raw public BBOs are measured search evidence. Register only symbols with
    // two or more independently observed venues, and keep them explicitly
    // non-executable with unknown economics. This makes the CEX_CEX discovery
    // funnel truthful without allowing discovery-only venues into execution.
    const observedCandidateTtlMs = Math.max(
      500,
      Number(process.env.CRYPTOCRAWL_PUBLIC_BBO_CACHE_MS || 1_500),
    );
    const observedCandidates = buildObservedCexCandidates(publicDiscovery.observations, observedCandidateTtlMs);
    for (const candidate of observedCandidates) measuredCandidateRegistry.record(candidate);

    const byRoute = new Map<string, VerifiedArbitragePlan>();
    for (const plan of evaluated) {
      if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) continue;
      const key = planKey(plan);
      const previous = byRoute.get(key);
      if (!previous || plan.netProfitUsd > previous.netProfitUsd) byRoute.set(key, plan);
    }
    const positivePlans = [...byRoute.values()].sort((left, right) => right.netProfitUsd - left.netProfitUsd);
    for (const plan of positivePlans) registerDeterministicCexCandidate(plan, Date.now(), maxQuoteAgeMs);

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
          const id = opportunityId(plan);
          const technicalEvidence = await getBoundTechnicalEvidence({
            opportunityId: id,
            symbol: plan.symbol,
            observedAt,
            maxAgeMs: Math.max(30_000, Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000)),
          });

          try {
            const assessment = await cryptara.assessOpportunity({
              opportunityId: id,
              observedAt,
              chain: 'cex',
              symbol: plan.symbol,
              plan,
              tradingView: technicalEvidence.analysis,
              mempool: alchemyIntegration.getMempoolAnalysis(),
              marketUniverse: universe,
              dexObservation: null,
              missingInformation: [
                ...technicalEvidence.missingInformation,
                ...providerStatuses
                  .filter(status => status.state === 'failed' || status.state === 'stale' || status.state === 'unavailable')
                  .map(status => `provider_${status.provider}_${status.state}`),
              ],
              provenance: [
                'measured_opportunity_graph',
                'direct_exchange_quotes',
                ...technicalEvidence.provenance,
                ...[...new Set(universe.flatMap(asset => asset.sources || [asset.source]))],
                ...providerStatuses.map(status => `provider:${status.provider}:${status.state}`),
              ],
            });
            if (assessment.recommendation === 'consider' && plan.netProfitUsd > 0) {
              eligibleCandidates++;
              measuredCandidateRegistry.updateStatus(id, 'eligible', {
                provenance: [...technicalEvidence.provenance, 'Cryptara:consider', 'monte_carlo:approved_or_complete'],
              });
            } else {
              measuredCandidateRegistry.updateStatus(id, 'blocked', {
                missingInformation: assessment.missingInformation,
                provenance: [...technicalEvidence.provenance, `Cryptara:${assessment.recommendation}`],
              });
            }
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
      publicDiscoveryObservations: publicDiscovery.observations.length,
      publicDiscoveryVenues: new Set(publicDiscovery.observations.map(observation => observation.venue)).size,
      publicDiscoveryFailures: publicDiscovery.failures.length,
      observedCandidatesRegistered: observedCandidates.length,
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
      publicDiscoveryObservations: cycle.publicDiscoveryObservations,
      publicDiscoveryVenues: cycle.publicDiscoveryVenues,
      publicDiscoveryFailures: cycle.publicDiscoveryFailures,
      observedCandidatesRegistered: cycle.observedCandidatesRegistered,
      deterministicPositive: cycle.deterministicPositive,
      assessedCandidates: cycle.assessedCandidates,
      eligibleCandidates: cycle.eligibleCandidates,
      candidateRegistry: measuredCandidateRegistry.getMetrics(60_000),
      canonicalObservedPerMinute: canonical.observedOpportunities,
      canonicalVerifiedPositivePerMinute: canonical.verifiedPositiveOpportunities,
      canonicalEligiblePerMinute: canonical.eligibleOpportunities,
      errors: errors.slice(0, 12),
    });
    return this.getLatestCycle()!;
  }
}

export const measuredOpportunityGraph = new MeasuredOpportunityGraph();
