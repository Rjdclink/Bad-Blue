import logger from '../../../logger.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import { unifiedMultiLegArbitrageEngine } from '../optimization/unified-multileg-arbitrage-engine.js';
import { routeRecentMeasuredOpportunities } from '../execution/unified-execution-router.js';
import { measuredOpportunityGraph } from './opportunity-graph.js';
import { fundingRateMonitor } from './funding-rate-monitor.js';
import { discoverMeasuredDexCandidates } from './dex-opportunity-generator.js';
import { discoverMeasuredCrossChainCandidates } from './cross-chain-opportunity-generator.js';
import { discoverMeasuredMempoolCandidates } from './mempool-opportunity-generator.js';
import { discoverMeasuredLiquidationCandidates } from './liquidation-opportunity-generator.js';
import { discoverMeasuredMakerCandidates } from './maker-opportunity-generator.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';

export interface MultiTopologyDiscoveryCycle {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  cexCandidates: number;
  dexCandidates: number;
  crossChainCandidates: number;
  mempoolCandidates: number;
  liquidationCandidates: number;
  makerCandidates: number;
  fundingCandidates: number;
  durationMsByTopology: {
    cex: number | null;
    dex: number | null;
    crossChain: number | null;
    mempool: number | null;
    liquidation: number | null;
    maker: number | null;
    funding: number | null;
  };
  scanPriorities: ReturnType<typeof adaptiveTopologyOptimizer.getSnapshot>;
  admissionPolicy: ReturnType<typeof adaptiveTopologyOptimizer.getDynamicAdmissionPolicy>;
  assemblyPolicy: ReturnType<typeof adaptiveTopologyOptimizer.getAssemblyPolicy>;
  routedOpportunities: ReturnType<typeof routeRecentMeasuredOpportunities>;
  compositePlan: ReturnType<typeof unifiedMultiLegArbitrageEngine.getLatestPlan>;
  registry: ReturnType<typeof measuredCandidateRegistry.getMetrics>;
  errors: string[];
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function timed<T>(operation: () => Promise<T> | T): Promise<{ value: T; durationMs: number }> {
  const startedAt = process.hrtime.bigint();
  const value = await operation();
  return { value, durationMs: elapsedMs(startedAt) };
}

class MultiTopologyDiscoveryController {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<MultiTopologyDiscoveryCycle> | null = null;
  private latest: MultiTopologyDiscoveryCycle | null = null;
  private running = false;
  private baseIntervalMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_MULTI_TOPOLOGY_SCAN_INTERVAL_MS || 15_000));

  start(): void {
    if (this.running) return;
    this.running = true;
    this.baseIntervalMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_MULTI_TOPOLOGY_SCAN_INTERVAL_MS || 15_000));
    void this.scanOnce().finally(() => this.scheduleNext());
    logger.info('[OpportunityGraph] Unified parallel discovery controller started', {
      component: 'MultiTopologyDiscoveryController',
      baseIntervalMs: this.baseIntervalMs,
      parallelEveryCycle: true,
      fixedTopologyPriority: false,
      topologies: ['CEX_CEX', 'DEX_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN', 'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE', 'ZERO_CAPITAL_ATOMIC'],
      zeroCapitalDiscoveryAuthority: 'zero_capital_engine_parallel_runtime',
      candidateAuthority: 'measured_candidate_registry',
      realizedPerformanceAdjustsAttention: true,
      minimumCoveragePreserved: true,
      makerOrdersAssumedFilled: false,
      liquidationProfitAssumed: false,
      fundingCarryAssumedExecutable: false,
      syntheticEvidenceAllowed: false,
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scanOnce().finally(() => this.scheduleNext());
    }, this.baseIntervalMs);
    this.timer.unref?.();
  }

  async scanOnce(): Promise<MultiTopologyDiscoveryCycle> {
    if (this.inFlight) return this.inFlight;
    const startedAt = Date.now();
    const cycleId = `multi-topology:${startedAt}`;
    this.inFlight = (async () => {
      const errors: string[] = [];
      let cexCandidates = 0;
      let dexCandidates = 0;
      let crossChainCandidates = 0;
      let mempoolCandidates = 0;
      let liquidationCandidates = 0;
      let makerCandidates = 0;
      let fundingCandidates = 0;
      const durationMsByTopology: MultiTopologyDiscoveryCycle['durationMsByTopology'] = {
        cex: null,
        dex: null,
        crossChain: null,
        mempool: null,
        liquidation: null,
        maker: null,
        funding: null,
      };

      const beforeFunding = measuredCandidateRegistry.getRecent(4096)
        .filter(candidate => candidate.topology === 'FUNDING_ARBITRAGE').length;

      // No source has a fixed ordering or hard-coded preference. Each producer
      // starts in the same event-loop turn and retains its own provider/rate safety.
      const [cex, dex, cross, mempool, liquidation, maker, funding] = await Promise.allSettled([
        timed(() => measuredOpportunityGraph.scanOnce()),
        timed(() => discoverMeasuredDexCandidates()),
        timed(() => discoverMeasuredCrossChainCandidates()),
        timed(() => discoverMeasuredMempoolCandidates()),
        timed(() => discoverMeasuredLiquidationCandidates()),
        timed(() => discoverMeasuredMakerCandidates()),
        timed(() => fundingRateMonitor.scanOnce()),
      ]);

      if (cex.status === 'fulfilled') {
        cexCandidates = cex.value.value.deterministicPositive;
        durationMsByTopology.cex = cex.value.durationMs;
      } else errors.push(`cex:${cex.reason instanceof Error ? cex.reason.message : String(cex.reason)}`);
      if (dex.status === 'fulfilled') {
        dexCandidates = dex.value.value.length;
        durationMsByTopology.dex = dex.value.durationMs;
      } else errors.push(`dex:${dex.reason instanceof Error ? dex.reason.message : String(dex.reason)}`);
      if (cross.status === 'fulfilled') {
        crossChainCandidates = cross.value.value.length;
        durationMsByTopology.crossChain = cross.value.durationMs;
      } else errors.push(`cross_chain:${cross.reason instanceof Error ? cross.reason.message : String(cross.reason)}`);
      if (mempool.status === 'fulfilled') {
        mempoolCandidates = mempool.value.value.length;
        durationMsByTopology.mempool = mempool.value.durationMs;
      } else errors.push(`mempool:${mempool.reason instanceof Error ? mempool.reason.message : String(mempool.reason)}`);
      if (liquidation.status === 'fulfilled') {
        liquidationCandidates = liquidation.value.value.length;
        durationMsByTopology.liquidation = liquidation.value.durationMs;
      } else errors.push(`liquidation:${liquidation.reason instanceof Error ? liquidation.reason.message : String(liquidation.reason)}`);
      if (maker.status === 'fulfilled') {
        makerCandidates = maker.value.value.length;
        durationMsByTopology.maker = maker.value.durationMs;
      } else errors.push(`maker:${maker.reason instanceof Error ? maker.reason.message : String(maker.reason)}`);
      if (funding.status === 'fulfilled') {
        durationMsByTopology.funding = funding.value.durationMs;
        const afterFunding = measuredCandidateRegistry.getRecent(4096)
          .filter(candidate => candidate.topology === 'FUNDING_ARBITRAGE').length;
        fundingCandidates = Math.max(0, afterFunding - beforeFunding);
      } else errors.push(`funding:${funding.reason instanceof Error ? funding.reason.message : String(funding.reason)}`);

      const routedOpportunities = routeRecentMeasuredOpportunities(1024);
      const compositePlan = unifiedMultiLegArbitrageEngine.assemble();
      const completedAt = Date.now();
      const cycle: MultiTopologyDiscoveryCycle = {
        cycleId,
        startedAt,
        completedAt,
        cexCandidates,
        dexCandidates,
        crossChainCandidates,
        mempoolCandidates,
        liquidationCandidates,
        makerCandidates,
        fundingCandidates,
        durationMsByTopology,
        scanPriorities: adaptiveTopologyOptimizer.getSnapshot(),
        admissionPolicy: adaptiveTopologyOptimizer.getDynamicAdmissionPolicy(),
        assemblyPolicy: adaptiveTopologyOptimizer.getAssemblyPolicy(),
        routedOpportunities,
        compositePlan,
        registry: measuredCandidateRegistry.getMetrics(60_000),
        errors,
      };
      this.latest = cycle;
      logger.info('[OpportunityGraph] Unified parallel discovery cycle completed', {
        component: 'MultiTopologyDiscoveryController',
        cycleId,
        durationMs: completedAt - startedAt,
        durationMsByTopology,
        fixedTopologyPriority: false,
        scanPriorities: cycle.scanPriorities.map(state => ({
          topology: state.topology,
          priorityWeight: state.priorityWeight,
          realizedBpsEwma: state.realizedBpsEwma,
          realizedCostMultiplierEwma: state.realizedCostMultiplierEwma,
          terminalSamples: state.terminalSamples,
        })),
        admissionPolicy: cycle.admissionPolicy,
        assemblyPolicy: cycle.assemblyPolicy,
        admittedRoutes: cycle.routedOpportunities.filter(decision => decision.admitted).slice(0, 12).map(decision => ({
          opportunityId: decision.opportunityId,
          topology: decision.topology,
          path: decision.path,
          profitabilityScore: decision.score.profitabilityScore,
          executionRisk: decision.score.executionRisk,
          confidenceLevel: decision.score.confidenceLevel,
        })),
        compositePlan: cycle.compositePlan ? {
          planId: cycle.compositePlan.planId,
          selectedLegCount: cycle.compositePlan.selectedLegCount,
          selectedExecutionPath: cycle.compositePlan.selectedExecutionPath,
          executionMode: cycle.compositePlan.executionMode,
          notionalWeightedNetProfitBps: cycle.compositePlan.notionalWeightedNetProfitBps,
          sharedPrincipalStackedBps: cycle.compositePlan.sharedPrincipalStackedBps,
          exactCompositeSimulation: cycle.compositePlan.exactCompositeSimulation,
        } : null,
        cexCandidates,
        dexCandidates,
        crossChainCandidates,
        mempoolCandidates,
        liquidationCandidates,
        makerCandidates,
        fundingCandidates,
        registry: cycle.registry,
        errors: errors.slice(0, 12),
      });
      return cycle;
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  getLatestCycle(): MultiTopologyDiscoveryCycle | null {
    return this.latest ? {
      ...this.latest,
      durationMsByTopology: { ...this.latest.durationMsByTopology },
      scanPriorities: this.latest.scanPriorities.map(state => ({ ...state })),
      admissionPolicy: { ...this.latest.admissionPolicy },
      assemblyPolicy: { ...this.latest.assemblyPolicy },
      routedOpportunities: this.latest.routedOpportunities.map(decision => ({
        ...decision,
        score: { ...decision.score, components: { ...decision.score.components } },
        threshold: { ...decision.threshold },
        reasons: [...decision.reasons],
      })),
      compositePlan: this.latest.compositePlan ? {
        ...this.latest.compositePlan,
        legs: this.latest.compositePlan.legs.map(leg => ({
          ...leg,
          chains: [...leg.chains],
          venues: [...leg.venues],
          assets: [...leg.assets],
        })),
        reasons: [...this.latest.compositePlan.reasons],
      } : null,
      registry: {
        ...this.latest.registry,
        byTopology: Object.fromEntries(Object.entries(this.latest.registry.byTopology).map(([key, value]) => [key, { ...value }])) as MultiTopologyDiscoveryCycle['registry']['byTopology'],
      },
      errors: [...this.latest.errors],
    } : null;
  }
}

export const multiTopologyDiscoveryController = new MultiTopologyDiscoveryController();
