import logger from '../../../logger.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import { unifiedMultiLegArbitrageEngine } from '../optimization/unified-multileg-arbitrage-engine.js';
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
  dexCandidates: number;
  crossChainCandidates: number;
  mempoolCandidates: number;
  liquidationCandidates: number;
  makerCandidates: number;
  durationMsByTopology: {
    dex: number | null;
    crossChain: number | null;
    mempool: number | null;
    liquidation: number | null;
    maker: number | null;
  };
  scannedThisCycle: MeasuredOpportunityTopology[];
  scanPriorities: ReturnType<typeof adaptiveTopologyOptimizer.getSnapshot>;
  assemblyPolicy: ReturnType<typeof adaptiveTopologyOptimizer.getAssemblyPolicy>;
  compositePlan: ReturnType<typeof unifiedMultiLegArbitrageEngine.getLatestPlan>;
  registry: ReturnType<typeof measuredCandidateRegistry.getMetrics>;
  errors: string[];
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
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
  private readonly lastScanAt = new Map<MeasuredOpportunityTopology, number>();

  start(): void {
    if (this.running) return;
    this.running = true;
    this.baseIntervalMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_MULTI_TOPOLOGY_SCAN_INTERVAL_MS || 15_000));
    void this.scanOnce().finally(() => this.scheduleNext());
    logger.info('[OpportunityGraph] Non-CEX measured topology producers started', {
      component: 'MultiTopologyDiscoveryController',
      baseIntervalMs: this.baseIntervalMs,
      adaptivePerTopologyCadence: true,
      topologies: ['DEX_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN', 'LIQUIDATION', 'ZERO_CAPITAL_ATOMIC', 'MAKER_CEX'],
      candidateAuthority: 'measured_candidate_registry',
      realizedBpsPriorityAuthority: 'terminal_settlement_only',
      minimumCoveragePreserved: true,
      makerOrdersAssumedFilled: false,
      liquidationProfitAssumed: false,
      syntheticEvidenceAllowed: false,
      compositeAssemblyExecutionAuthority: false,
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
    const tickMs = Math.max(1_000, Math.floor(this.baseIntervalMs / 2));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scanOnce().finally(() => this.scheduleNext());
    }, tickMs);
    this.timer.unref?.();
  }

  private due(topology: MeasuredOpportunityTopology, now: number): boolean {
    const weight = adaptiveTopologyOptimizer.getPriority(topology);
    const interval = Math.max(
      Math.floor(this.baseIntervalMs / 2),
      Math.min(this.baseIntervalMs * 2, Math.floor(this.baseIntervalMs / Math.max(0.5, Math.min(2, weight)))),
    );
    const last = this.lastScanAt.get(topology) || 0;
    return last === 0 || now - last >= interval;
  }

  private markScanned(topology: MeasuredOpportunityTopology, at: number): void {
    this.lastScanAt.set(topology, at);
  }

  async scanOnce(): Promise<MultiTopologyDiscoveryCycle> {
    if (this.inFlight) return this.inFlight;
    const startedAt = Date.now();
    const cycleId = `multi-topology:${startedAt}`;
    this.inFlight = (async () => {
      const errors: string[] = [];
      const scannedThisCycle: MeasuredOpportunityTopology[] = [];
      let dexCandidates = 0;
      let crossChainCandidates = 0;
      let mempoolCandidates = 0;
      let liquidationCandidates = 0;
      let makerCandidates = 0;
      const durationMsByTopology: MultiTopologyDiscoveryCycle['durationMsByTopology'] = {
        dex: null,
        crossChain: null,
        mempool: null,
        liquidation: null,
        maker: null,
      };

      const dexDue = this.due('DEX_ATOMIC', startedAt);
      const crossDue = this.due('CROSS_CHAIN', startedAt);
      const makerDue = this.due('MAKER_CEX', startedAt);
      const mempoolDue = this.due('MEMPOOL_BACKRUN', startedAt);
      const liquidationDue = this.due('LIQUIDATION', startedAt);

      const [dex, cross, maker, liquidation] = await Promise.allSettled([
        dexDue ? timed(() => discoverMeasuredDexCandidates()) : Promise.resolve(null),
        crossDue ? timed(() => discoverMeasuredCrossChainCandidates()) : Promise.resolve(null),
        makerDue ? timed(() => discoverMeasuredMakerCandidates()) : Promise.resolve(null),
        liquidationDue ? timed(() => discoverMeasuredLiquidationCandidates()) : Promise.resolve(null),
      ]);
      if (dexDue) {
        this.markScanned('DEX_ATOMIC', startedAt);
        scannedThisCycle.push('DEX_ATOMIC');
        if (dex.status === 'fulfilled' && dex.value) {
          dexCandidates = dex.value.value.length;
          durationMsByTopology.dex = dex.value.durationMs;
        } else if (dex.status === 'rejected') errors.push(`dex:${dex.reason instanceof Error ? dex.reason.message : String(dex.reason)}`);
      }
      if (crossDue) {
        this.markScanned('CROSS_CHAIN', startedAt);
        scannedThisCycle.push('CROSS_CHAIN');
        if (cross.status === 'fulfilled' && cross.value) {
          crossChainCandidates = cross.value.value.length;
          durationMsByTopology.crossChain = cross.value.durationMs;
        } else if (cross.status === 'rejected') errors.push(`cross_chain:${cross.reason instanceof Error ? cross.reason.message : String(cross.reason)}`);
      }
      if (makerDue) {
        this.markScanned('MAKER_CEX', startedAt);
        scannedThisCycle.push('MAKER_CEX');
        if (maker.status === 'fulfilled' && maker.value) {
          makerCandidates = maker.value.value.length;
          durationMsByTopology.maker = maker.value.durationMs;
        } else if (maker.status === 'rejected') errors.push(`maker:${maker.reason instanceof Error ? maker.reason.message : String(maker.reason)}`);
      }
      if (liquidationDue) {
        this.markScanned('LIQUIDATION', startedAt);
        scannedThisCycle.push('LIQUIDATION');
        if (liquidation.status === 'fulfilled' && liquidation.value) {
          liquidationCandidates = liquidation.value.value.length;
          durationMsByTopology.liquidation = liquidation.value.durationMs;
        } else if (liquidation.status === 'rejected') errors.push(`liquidation:${liquidation.reason instanceof Error ? liquidation.reason.message : String(liquidation.reason)}`);
      }

      if (mempoolDue) {
        const mempoolStartedAt = process.hrtime.bigint();
        this.markScanned('MEMPOOL_BACKRUN', startedAt);
        scannedThisCycle.push('MEMPOOL_BACKRUN');
        try {
          mempoolCandidates = discoverMeasuredMempoolCandidates().length;
        } catch (error) {
          errors.push(`mempool:${error instanceof Error ? error.message : String(error)}`);
        } finally {
          durationMsByTopology.mempool = elapsedMs(mempoolStartedAt);
        }
      }

      const compositePlan = unifiedMultiLegArbitrageEngine.assemble();
      const completedAt = Date.now();
      const cycle: MultiTopologyDiscoveryCycle = {
        cycleId,
        startedAt,
        completedAt,
        dexCandidates,
        crossChainCandidates,
        mempoolCandidates,
        liquidationCandidates,
        makerCandidates,
        durationMsByTopology,
        scannedThisCycle,
        scanPriorities: adaptiveTopologyOptimizer.getSnapshot(),
        assemblyPolicy: adaptiveTopologyOptimizer.getAssemblyPolicy(),
        compositePlan,
        registry: measuredCandidateRegistry.getMetrics(60_000),
        errors,
      };
      this.latest = cycle;
      logger.info('[OpportunityGraph] Multi-topology measured discovery cycle completed', {
        component: 'MultiTopologyDiscoveryController',
        cycleId,
        durationMs: completedAt - startedAt,
        durationMsByTopology,
        scannedThisCycle,
        scanPriorities: cycle.scanPriorities.map(state => ({
          topology: state.topology,
          priorityWeight: state.priorityWeight,
          realizedBpsEwma: state.realizedBpsEwma,
          terminalSamples: state.terminalSamples,
        })),
        assemblyPolicy: cycle.assemblyPolicy,
        compositePlan: cycle.compositePlan ? {
          planId: cycle.compositePlan.planId,
          selectedLegCount: cycle.compositePlan.selectedLegCount,
          selectedExecutionPath: cycle.compositePlan.selectedExecutionPath,
          executionMode: cycle.compositePlan.executionMode,
          notionalWeightedNetProfitBps: cycle.compositePlan.notionalWeightedNetProfitBps,
          arithmeticLegBpsSum: cycle.compositePlan.arithmeticLegBpsSum,
          compositionGainVerified: cycle.compositePlan.compositionGainVerified,
        } : null,
        dexCandidates,
        crossChainCandidates,
        mempoolCandidates,
        liquidationCandidates,
        makerCandidates,
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
      scannedThisCycle: [...this.latest.scannedThisCycle],
      scanPriorities: this.latest.scanPriorities.map(state => ({ ...state })),
      assemblyPolicy: { ...this.latest.assemblyPolicy },
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
