import logger from '../../../logger.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
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
import {
  measuredCandidateRegistry,
  type MeasuredOpportunityTopology,
} from './measured-candidate-registry.js';

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

type TopologyTaskKey = 'cex' | 'dex' | 'cross_chain' | 'mempool' | 'liquidation' | 'maker' | 'funding';

interface TimedTopologyResult<T> {
  value: T | null;
  durationMs: number | null;
  skipped: boolean;
  reusedInFlight: boolean;
}

class TopologyTaskWatchdogError extends Error {
  constructor(key: TopologyTaskKey, timeoutMs: number) {
    super(`${key} topology discovery watchdog expired after ${timeoutMs}ms`);
    this.name = 'TopologyTaskWatchdogError';
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function topologyTaskWatchdogMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_TOPOLOGY_TASK_WATCHDOG_MS || 90_000);
  return Number.isFinite(parsed) ? Math.max(15_000, Math.min(180_000, Math.trunc(parsed))) : 90_000;
}

function withTopologyWatchdog<T>(task: Promise<T>, key: TopologyTaskKey): Promise<T> {
  const timeoutMs = topologyTaskWatchdogMs();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TopologyTaskWatchdogError(key, timeoutMs)), timeoutMs);
    timer.unref?.();
    task.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const TOPOLOGY_PHASE: Record<MeasuredOpportunityTopology, number> = {
  CEX_CEX: 0,
  DEX_ATOMIC: 1,
  ZERO_CAPITAL_ATOMIC: 2,
  CROSS_CHAIN: 3,
  MEMPOOL_BACKRUN: 4,
  LIQUIDATION: 5,
  MAKER_CEX: 6,
  FUNDING_ARBITRAGE: 7,
  PREDICTION_EVENT: 8,
};

class MultiTopologyDiscoveryController {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<MultiTopologyDiscoveryCycle> | null = null;
  private latest: MultiTopologyDiscoveryCycle | null = null;
  private running = false;
  private baseIntervalMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_MULTI_TOPOLOGY_SCAN_INTERVAL_MS || 15_000));
  private cycleSequence = 0;
  private readonly lastTopologyScanAt = new Map<MeasuredOpportunityTopology, number>();
  private readonly topologyTasks = new Map<TopologyTaskKey, Promise<unknown>>();

  start(): void {
    if (this.running) return;
    this.running = true;
    this.baseIntervalMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_MULTI_TOPOLOGY_SCAN_INTERVAL_MS || 15_000));
    this.runScheduledCycle();
    logger.info('[OpportunityGraph] Unified adaptive discovery controller started', {
      component: 'MultiTopologyDiscoveryController',
      baseIntervalMs: this.baseIntervalMs,
      topologyTaskWatchdogMs: topologyTaskWatchdogMs(),
      hungTopologyIsolation: true,
      duplicateHungTopologySuppression: true,
      timedOutTopologyOwnershipReleased: true,
      fixedTopologyPriority: false,
      adaptiveScanAllocationApplied: true,
      topologies: ['CEX_CEX', 'DEX_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN', 'LIQUIDATION', 'MAKER_CEX', 'FUNDING_ARBITRAGE'],
      externalTopologyCadences: ['ZERO_CAPITAL_ATOMIC', 'PREDICTION_EVENT'],
      zeroCapitalDiscoveryAuthority: 'CanonicalZeroCapitalDiscovery',
      predictionEventDiscoveryAuthority: 'prediction_market_discovery_wiring',
      candidateAuthority: 'measured_candidate_registry',
      realizedPerformanceAdjustsAttention: true,
      liveMeasuredEvidenceAdjustsColdStartAttention: true,
      minimumCoveragePreserved: true,
      onchainProviderReadinessAuthority: 'dynamic_rpc_provider_wiring_single_installation_promise',
      cexDiscoveryBlockedByRpcBootstrap: false,
      executionDispatchAuthority: 'canonical_execution_scheduler_only',
      discoveryMaySubmitTransactions: false,
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
    this.topologyTasks.clear();
  }

  private runScheduledCycle(): void {
    void this.scanOnce()
      .catch(error => {
        logger.warn('[OpportunityGraph] Unified adaptive discovery cycle failed closed; recurring schedule continues', {
          component: 'MultiTopologyDiscoveryController',
          error: error instanceof Error ? error.message : String(error),
          recurringSchedulePreserved: true,
          executionAuthority: false,
        });
      })
      .finally(() => this.scheduleNext());
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runScheduledCycle();
    }, this.baseIntervalMs);
    this.timer.unref?.();
  }

  private async runTopologyTask<T>(
    key: TopologyTaskKey,
    enabled: boolean,
    operation: () => Promise<T> | T,
  ): Promise<TimedTopologyResult<T>> {
    if (!enabled) return { value: null, durationMs: null, skipped: true, reusedInFlight: false };
    const startedAt = process.hrtime.bigint();
    let tracked = this.topologyTasks.get(key) as Promise<T> | undefined;
    const reusedInFlight = Boolean(tracked);
    if (!tracked) {
      let owned!: Promise<T>;
      owned = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (this.topologyTasks.get(key) === owned) this.topologyTasks.delete(key);
        });
      tracked = owned;
      this.topologyTasks.set(key, owned as Promise<unknown>);
    }

    try {
      const value = await withTopologyWatchdog(tracked, key);
      return { value, durationMs: elapsedMs(startedAt), skipped: false, reusedInFlight };
    } catch (error) {
      if (error instanceof TopologyTaskWatchdogError) {
        if (this.topologyTasks.get(key) === tracked) this.topologyTasks.delete(key);
        logger.warn('[OpportunityGraph] Topology discovery task exceeded its watchdog; other topologies and future controller cycles continue', {
          component: 'MultiTopologyDiscoveryController',
          topologyTask: key,
          timeoutMs: topologyTaskWatchdogMs(),
          reusedInFlight,
          duplicateTaskSuppressedWhilePending: true,
          timedOutTaskOwnershipReleased: true,
          futureCycleMayStartFreshTask: true,
          executionAuthority: false,
        });
      }
      throw error;
    }
  }

  /**
   * Search-allocation only. Priority >= 0.90 keeps full base cadence. Weights
   * below that reduce expensive discovery work by a bounded stride, but every
   * topology is forced to refresh within maxCoverageGapMs. No candidate becomes
   * executable because of this decision and no topology can be permanently starved.
   */
  private shouldScanTopology(topology: MeasuredOpportunityTopology, priorityWeight: number, now: number): boolean {
    const maxCoverageGapMs = Math.max(
      this.baseIntervalMs,
      Math.min(120_000, Number(process.env.CRYPTOCRAWL_TOPOLOGY_MAX_COVERAGE_GAP_MS || 45_000)),
    );
    const last = this.lastTopologyScanAt.get(topology) || 0;
    if (last === 0 || now - last >= maxCoverageGapMs) return true;
    if (priorityWeight >= 0.90) return true;
    const stride = priorityWeight >= 0.70 ? 2 : 3;
    return (this.cycleSequence + TOPOLOGY_PHASE[topology]) % stride === 0;
  }

  private markTopologyScanned(topology: MeasuredOpportunityTopology, enabled: boolean, now: number): void {
    if (enabled) this.lastTopologyScanAt.set(topology, now);
  }

  async scanOnce(): Promise<MultiTopologyDiscoveryCycle> {
    if (this.inFlight) return this.inFlight;
    const startedAt = Date.now();
    const cycleId = `multi-topology:${startedAt}`;
    const scanPriorities = adaptiveTopologyOptimizer.getSnapshot();
    const priorityByTopology = new Map(scanPriorities.map(state => [state.topology, state.priorityWeight]));
    const should = (topology: MeasuredOpportunityTopology) => this.shouldScanTopology(
      topology,
      Number(priorityByTopology.get(topology) ?? 1),
      startedAt,
    );
    const runCex = should('CEX_CEX');
    const runDex = should('DEX_ATOMIC');
    const runCross = should('CROSS_CHAIN');
    const runMempool = should('MEMPOOL_BACKRUN');
    const runLiquidation = should('LIQUIDATION');
    const runMaker = should('MAKER_CEX');
    const runFunding = should('FUNDING_ARBITRAGE');
    this.cycleSequence += 1;

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

      const beforeFunding = runFunding
        ? measuredCandidateRegistry.getRecent(4096).filter(candidate => candidate.topology === 'FUNDING_ARBITRAGE').length
        : 0;

      // The canonical RPC mesh owns one installation promise. On-chain producers
      // wait for that shared readiness boundary so their first evidence cycle cannot
      // observe provider candidates while they are still being admitted/probed.
      // CEX, maker and funding discovery remain independent and start immediately.
      const rpcReady = ensureDynamicRpcProviderWiring();

      // Every selected producer is bounded independently. Promise.allSettled alone
      // cannot finish while any member remains permanently pending, so each task has
      // a watchdog and a single-flight identity. A timed-out task relinquishes the
      // single-flight slot so a future cycle can reacquire fresh evidence instead of
      // permanently inheriting an unresolved promise.
      const [cex, dex, cross, mempool, liquidation, maker, funding] = await Promise.allSettled([
        this.runTopologyTask('cex', runCex, () => measuredOpportunityGraph.scanOnce()),
        this.runTopologyTask('dex', runDex, async () => { await rpcReady; return discoverMeasuredDexCandidates(); }),
        this.runTopologyTask('cross_chain', runCross, async () => { await rpcReady; return discoverMeasuredCrossChainCandidates(); }),
        this.runTopologyTask('mempool', runMempool, async () => { await rpcReady; return discoverMeasuredMempoolCandidates(); }),
        this.runTopologyTask('liquidation', runLiquidation, async () => { await rpcReady; return discoverMeasuredLiquidationCandidates(); }),
        this.runTopologyTask('maker', runMaker, () => discoverMeasuredMakerCandidates()),
        this.runTopologyTask('funding', runFunding, () => fundingRateMonitor.scanOnce()),
      ]);

      this.markTopologyScanned('CEX_CEX', runCex, startedAt);
      this.markTopologyScanned('DEX_ATOMIC', runDex, startedAt);
      this.markTopologyScanned('CROSS_CHAIN', runCross, startedAt);
      this.markTopologyScanned('MEMPOOL_BACKRUN', runMempool, startedAt);
      this.markTopologyScanned('LIQUIDATION', runLiquidation, startedAt);
      this.markTopologyScanned('MAKER_CEX', runMaker, startedAt);
      this.markTopologyScanned('FUNDING_ARBITRAGE', runFunding, startedAt);

      if (cex.status === 'fulfilled' && cex.value.value) {
        cexCandidates = cex.value.value.deterministicPositive;
        durationMsByTopology.cex = cex.value.durationMs;
      } else if (cex.status === 'rejected') errors.push(`cex:${cex.reason instanceof Error ? cex.reason.message : String(cex.reason)}`);
      if (dex.status === 'fulfilled' && dex.value.value) {
        dexCandidates = dex.value.value.length;
        durationMsByTopology.dex = dex.value.durationMs;
      } else if (dex.status === 'rejected') errors.push(`dex:${dex.reason instanceof Error ? dex.reason.message : String(dex.reason)}`);
      if (cross.status === 'fulfilled' && cross.value.value) {
        crossChainCandidates = cross.value.value.length;
        durationMsByTopology.crossChain = cross.value.durationMs;
      } else if (cross.status === 'rejected') errors.push(`cross_chain:${cross.reason instanceof Error ? cross.reason.message : String(cross.reason)}`);
      if (mempool.status === 'fulfilled' && mempool.value.value) {
        mempoolCandidates = mempool.value.value.length;
        durationMsByTopology.mempool = mempool.value.durationMs;
      } else if (mempool.status === 'rejected') errors.push(`mempool:${mempool.reason instanceof Error ? mempool.reason.message : String(mempool.reason)}`);
      if (liquidation.status === 'fulfilled' && liquidation.value.value) {
        liquidationCandidates = liquidation.value.value.length;
        durationMsByTopology.liquidation = liquidation.value.durationMs;
      } else if (liquidation.status === 'rejected') errors.push(`liquidation:${liquidation.reason instanceof Error ? liquidation.reason.message : String(liquidation.reason)}`);
      if (maker.status === 'fulfilled' && maker.value.value) {
        makerCandidates = maker.value.value.length;
        durationMsByTopology.maker = maker.value.durationMs;
      } else if (maker.status === 'rejected') errors.push(`maker:${maker.reason instanceof Error ? maker.reason.message : String(maker.reason)}`);
      if (funding.status === 'fulfilled' && !funding.value.skipped) {
        durationMsByTopology.funding = funding.value.durationMs;
        const afterFunding = measuredCandidateRegistry.getRecent(4096)
          .filter(candidate => candidate.topology === 'FUNDING_ARBITRAGE').length;
        fundingCandidates = Math.max(0, afterFunding - beforeFunding);
      } else if (funding.status === 'rejected') errors.push(`funding:${funding.reason instanceof Error ? funding.reason.message : String(funding.reason)}`);

      // Routing is advisory only. The canonical execution scheduler consumes the
      // same measured registry independently; discovery never calls an executor.
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
        scanPriorities,
        admissionPolicy: adaptiveTopologyOptimizer.getDynamicAdmissionPolicy(),
        assemblyPolicy: adaptiveTopologyOptimizer.getAssemblyPolicy(),
        routedOpportunities,
        compositePlan,
        registry: measuredCandidateRegistry.getMetrics(60_000),
        errors,
      };
      this.latest = cycle;

      const skippedTopologies = [
        ['CEX_CEX', runCex],
        ['DEX_ATOMIC', runDex],
        ['CROSS_CHAIN', runCross],
        ['MEMPOOL_BACKRUN', runMempool],
        ['LIQUIDATION', runLiquidation],
        ['MAKER_CEX', runMaker],
        ['FUNDING_ARBITRAGE', runFunding],
      ].filter(([, enabled]) => !enabled).map(([topology]) => topology);

      logger.info('[OpportunityGraph] Unified adaptive discovery cycle completed', {
        component: 'MultiTopologyDiscoveryController',
        cycleId,
        durationMs: completedAt - startedAt,
        durationMsByTopology,
        topologyTaskWatchdogMs: topologyTaskWatchdogMs(),
        isolatedPendingTopologyTasks: [...this.topologyTasks.keys()],
        timedOutTopologyOwnershipReleased: true,
        fixedTopologyPriority: false,
        adaptiveScanAllocationApplied: true,
        skippedTopologies,
        minimumCoveragePreserved: true,
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
