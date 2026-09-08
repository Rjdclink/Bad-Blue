import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { getBoundTechnicalEvidence } from '../integration/technical-evidence-synchronizer.js';
import { marketDataProviders, type MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { buildObservedCexCandidates } from './cex-observation-candidates.js';
import { selectCexFormationSymbols, recordCexFormationOutcome } from './cex-edge-attention.js';
import { recordCexEconomicBarrier } from './cex-economic-barrier.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { scanPublicCexUniverse } from './public-cex-discovery.js';
import { getCexScanCapacity, type ScanCapacityDecision } from './scan-capacity-policy.js';

export interface MeasuredOpportunityGraphCycle {
  cycleId: string;
  cycleTrigger: 'continuous_scan' | 'positive_observation_revalidation';
  startedAt: number;
  completedAt: number;
  topology: 'CEX_CEX';
  universeAssets: number;
  selectedSymbols: number;
  formationExplorationSymbols: number;
  formationExploitationSymbols: number;
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
  const measuredDepth = plan.liquidity.status === 'measured';
  measuredCandidateRegistry.record({
    opportunityId: opportunityId(plan),
    topology: 'CEX_CEX',
    observedAt,
    expiresAt: observedAt + Math.max(1, maxQuoteAgeMs - Math.min(maxQuoteAgeMs, plan.quoteAgeMs)),
    status: measuredDepth ? 'eligible' : 'deterministic_positive',
    assets: [plan.symbol],
    venues: [plan.buyVenue, plan.sellVenue],
    chains: ['cex'],
    rawQuotes: [
      { source: 'direct_exchange_quotes', venue: plan.buyVenue, symbol: plan.symbol, observedAt: observedAt - plan.quoteAgeMs, ask: plan.buyAsk, executable: true },
      { source: 'direct_exchange_quotes', venue: plan.sellVenue, symbol: plan.symbol, observedAt: observedAt - plan.quoteAgeMs, bid: plan.sellBid, executable: true },
    ],
    depth: {
      status: measuredDepth ? 'measured' : 'unavailable',
      detail: measuredDepth ? plan.liquidity.source.join(',') : 'Measured executable depth unavailable',
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
    executionCapabilityReason: 'Verified CEX plan uses a settlement-safe centralized executor; governance, inventory and resource locks still control execution',
    missingInformation: [],
    provenance: [
      'measured_opportunity_graph',
      'formation_attention_scheduler',
      'direct_exchange_quotes',
      'authenticated_fee_evidence',
      'depth_aware_notional_search',
      'deterministic_positive_net',
      ...(measuredDepth ? ['positive_all_in_net_execution_eligible'] : []),
    ],
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
  /** Sole market-refresh execution authority. Continuous and targeted cycles never overlap. */
  private scanInFlight: Promise<MeasuredOpportunityGraphCycle> | null = null;
  /** Coalesced exact-symbol requests waiting behind the sole scan authority. */
  private targetedDrainPromise: Promise<MeasuredOpportunityGraphCycle> | null = null;
  private readonly pendingTargetedSymbols = new Set<string>();
  /** Symbols currently being refreshed are not allowed to enqueue themselves recursively. */
  private readonly activeTargetedSymbols = new Set<string>();
  private targetedRequestsCoalesced = 0;
  private latestCycle: MeasuredOpportunityGraphCycle | null = null;
  private running = false;

  async scanOnce(): Promise<MeasuredOpportunityGraphCycle> {
    // Targeted recovery owns the same serialized refresh lane. A global scan never
    // races a targeted scan and therefore cannot produce competing candidate snapshots.
    if (this.targetedDrainPromise) return this.targetedDrainPromise;
    if (this.scanInFlight) return this.scanInFlight;
    return this.runExclusiveCycle();
  }

  async revalidateSymbols(symbolsInput: readonly string[]): Promise<MeasuredOpportunityGraphCycle> {
    const symbols = [...new Set(symbolsInput.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 16);
    if (symbols.length === 0) return this.scanOnce();

    for (const symbol of symbols) {
      // Candidate-update subscribers may all request the same refresh. More
      // importantly, a candidate emitted by the active targeted cycle must never
      // recursively schedule that same symbol again. The active cycle already is
      // the freshest canonical measurement for that request.
      if (this.activeTargetedSymbols.has(symbol) || this.pendingTargetedSymbols.has(symbol)) {
        this.targetedRequestsCoalesced += 1;
        continue;
      }
      this.pendingTargetedSymbols.add(symbol);
    }

    if (!this.targetedDrainPromise) {
      const promise = this.drainTargetedQueue().finally(() => {
        if (this.targetedDrainPromise === promise) this.targetedDrainPromise = null;
      });
      this.targetedDrainPromise = promise;
    }
    return this.targetedDrainPromise;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const initialIntervalMs = Math.max(1_000, Number(process.env.CRYPTOCRAWL_OPPORTUNITY_GRAPH_INTERVAL_MS || 5_000));
    void this.scanOnce()
      .then(cycle => {
        if (this.running) this.scheduleNext(cycle.capacity.recommendedIntervalMs);
      })
      .catch(error => {
        logger.warn('[OpportunityGraph] Initial measured scan failed closed', {
          component: 'MeasuredOpportunityGraph',
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.running) this.scheduleNext(initialIntervalMs);
      });
    logger.info('[OpportunityGraph] Continuous measured discovery started', {
      component: 'MeasuredOpportunityGraph',
      initialIntervalMs,
      adaptiveCadence: true,
      topology: 'CEX_CEX',
      scanAttention: 'formation_probability_plus_value_of_information',
      scanAttentionAuthority: 'advisory_only',
      candidateAuthority: 'measured_candidate_registry_positive_all_in_net',
      refreshAuthority: 'single_serialized_opportunity_graph_pipeline',
      targetedRequestPolicy: 'coalesced_exact_symbol_non_recursive',
      syntheticEvidenceAllowed: false,
      executionPausedDuringLowActivity: false,
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingTargetedSymbols.clear();
    this.activeTargetedSymbols.clear();
  }

  private async runExclusiveCycle(options?: {
    symbols?: readonly string[];
    trigger?: MeasuredOpportunityGraphCycle['cycleTrigger'];
  }): Promise<MeasuredOpportunityGraphCycle> {
    // This method is the only path allowed to execute runCycle. If an earlier
    // cycle is still draining, wait for it rather than creating a second authority.
    while (this.scanInFlight) {
      try { await this.scanInFlight; } catch { /* the next canonical refresh may still proceed */ }
    }
    const promise = this.runCycle(options).finally(() => {
      if (this.scanInFlight === promise) this.scanInFlight = null;
    });
    this.scanInFlight = promise;
    return promise;
  }

  private async drainTargetedQueue(): Promise<MeasuredOpportunityGraphCycle> {
    let latest: MeasuredOpportunityGraphCycle | null = this.latestCycle;
    while (this.pendingTargetedSymbols.size > 0) {
      if (this.scanInFlight) {
        try { await this.scanInFlight; } catch { /* retry through the same canonical lane */ }
      }
      const batch = [...this.pendingTargetedSymbols].slice(0, 16);
      for (const symbol of batch) {
        this.pendingTargetedSymbols.delete(symbol);
        this.activeTargetedSymbols.add(symbol);
      }
      try {
        latest = await this.runExclusiveCycle({
          symbols: batch,
          trigger: 'positive_observation_revalidation',
        });
      } finally {
        for (const symbol of batch) this.activeTargetedSymbols.delete(symbol);
      }
    }
    if (latest) return latest;
    return this.runExclusiveCycle();
  }

  private scheduleNext(intervalMs?: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const fallback = Math.max(1_000, Number(process.env.CRYPTOCRAWL_OPPORTUNITY_GRAPH_INTERVAL_MS || 5_000));
    const delay = Math.max(1_000, Number.isFinite(intervalMs) && intervalMs! > 0 ? intervalMs! : fallback);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scanOnce()
        .then(cycle => {
          if (this.running) this.scheduleNext(cycle.capacity.recommendedIntervalMs);
        })
        .catch(error => {
          logger.warn('[OpportunityGraph] Measured scan failed closed', {
            component: 'MeasuredOpportunityGraph',
            error: error instanceof Error ? error.message : String(error),
          });
          if (this.running) this.scheduleNext(fallback);
        });
    }, delay);
    this.timer.unref?.();
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

  private async runCycle(options?: {
    symbols?: readonly string[];
    trigger?: MeasuredOpportunityGraphCycle['cycleTrigger'];
  }): Promise<MeasuredOpportunityGraphCycle> {
    const startedAt = Date.now();
    const cycleTrigger = options?.trigger || 'continuous_scan';
    const cycleId = `cex-graph:${cycleTrigger}:${startedAt}`;
    const errors: string[] = [];
    const configuredSymbol = (process.env.CRYPTO_ARBITRAGE_SYMBOL || 'ETHUSDT').trim().toUpperCase();
    const maxNotionalUsd = positiveFinite(process.env.CRYPTO_ARBITRAGE_NOTIONAL_USD, 200);
    const maxQuoteAgeMs = positiveFinite(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS, 5_000);

    const universe = await marketDataProviders.discoverUniverse();
    const symbols = uniqueSymbols(configuredSymbol, universe);
    const selectionCapacity = getCexScanCapacity(symbols.length);
    const formationSelection = selectCexFormationSymbols(symbols, selectionCapacity.symbolBudget, configuredSymbol);
    const targetedSymbols = [...new Set((options?.symbols || []).map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
    const selected = targetedSymbols.length > 0 ? targetedSymbols : formationSelection.symbols;
    const capacity = targetedSymbols.length > 0 ? getCexScanCapacity(selected.length) : selectionCapacity;

    const publicDiscoveryPromise = scanPublicCexUniverse(selected).catch(error => {
      errors.push(`public_cex_discovery:${error instanceof Error ? error.message : String(error)}`);
      return { startedAt, completedAt: Date.now(), symbols: selected.length, observations: [], failures: [] };
    });

    let evaluated: Array<VerifiedArbitragePlan | null>;
    try {
      const evaluatedBySymbol = await arbitrageVerifier.evaluateMany({
        notionalUsd: maxNotionalUsd,
        maxQuoteAgeMs,
        gas: { enabled: false, chain: 'polygon' },
        bridge: { enabled: false, fromChain: 'polygon', toChain: 'polygon', token: 'USDC' },
      }, selected, capacity);
      evaluated = selected.map(symbol => evaluatedBySymbol.get(symbol) ?? null);
    } catch (error) {
      errors.push(`cex_batch:${error instanceof Error ? error.message : String(error)}`);
      evaluated = selected.map(() => null);
    }

    const formationObservedAt = Date.now();
    evaluated.forEach((plan, index) => recordCexFormationOutcome(selected[index], plan, formationObservedAt));
    const publicDiscovery = await publicDiscoveryPromise;

    const economicBarrier = recordCexEconomicBarrier(
      arbitrageVerifier.getBestCrossVenueFeeContext(selected),
      selected.length / Math.max(1, symbols.length),
    );

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
    let eligibleCandidates = positivePlans.filter(plan => plan.liquidity.status === 'measured').length;

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
                'formation_attention_scheduler',
                'direct_exchange_quotes',
                ...technicalEvidence.provenance,
                ...[...new Set(universe.flatMap(asset => asset.sources || [asset.source]))],
                ...providerStatuses.map(status => `provider:${status.provider}:${status.state}`),
              ],
            });
            const current = measuredCandidateRegistry.get(id);
            if (current) {
              measuredCandidateRegistry.updateStatus(id, current.status, {
                provenance: [
                  ...technicalEvidence.provenance,
                  `Cryptara:advisory_${assessment.recommendation}`,
                  'advisory_assessment_execution_veto:false',
                ],
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
      cycleTrigger,
      startedAt,
      completedAt,
      topology: 'CEX_CEX',
      universeAssets: universe.length,
      selectedSymbols: selected.length,
      formationExplorationSymbols: targetedSymbols.length > 0 ? selected.length : formationSelection.exploration.length,
      formationExploitationSymbols: targetedSymbols.length > 0 ? 0 : formationSelection.exploitation.length,
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
    const topAttentionScores = [...formationSelection.scores]
      .filter(score => score.score !== null)
      .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
      .slice(0, 8)
      .map(score => ({
        symbol: score.symbol,
        score: score.score,
        positiveProbability: score.positiveProbability,
        valueOfInformation: score.valueOfInformation,
      }));
    logger.info('[OpportunityGraph] Measured CEX edge-formation cycle completed', {
      component: 'MeasuredOpportunityGraph',
      cycleId,
      cycleTrigger,
      durationMs: completedAt - startedAt,
      nextScanIntervalMs: cycle.capacity.recommendedIntervalMs,
      universeAssets: cycle.universeAssets,
      selectedSymbols: cycle.selectedSymbols,
      formationExplorationSymbols: cycle.formationExplorationSymbols,
      formationExploitationSymbols: cycle.formationExploitationSymbols,
      topAttentionScores,
      attentionAuthority: formationSelection.authority,
      economicEvaluationMode: 'single_authoritative_batch',
      refreshAuthority: 'single_serialized_opportunity_graph_pipeline',
      targetedQueueDepth: this.pendingTargetedSymbols.size,
      activeTargetedSymbols: [...this.activeTargetedSymbols],
      targetedRequestsCoalesced: this.targetedRequestsCoalesced,
      recursiveTargetedRevalidationAllowed: false,
      publicDiscoveryObservations: cycle.publicDiscoveryObservations,
      publicDiscoveryVenues: cycle.publicDiscoveryVenues,
      publicDiscoveryFailures: cycle.publicDiscoveryFailures,
      observedCandidatesRegistered: cycle.observedCandidatesRegistered,
      deterministicPositive: cycle.deterministicPositive,
      assessedCandidates: cycle.assessedCandidates,
      eligibleCandidates: cycle.eligibleCandidates,
      economicBarrier,
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