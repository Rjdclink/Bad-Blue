import logger from '../../../logger.js';
import { discoverMeasuredDexCandidates } from './dex-opportunity-generator.js';
import { discoverMeasuredCrossChainCandidates } from './cross-chain-opportunity-generator.js';
import { discoverMeasuredMempoolCandidates } from './mempool-opportunity-generator.js';
import { discoverMeasuredMakerCandidates } from './maker-opportunity-generator.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';

export interface MultiTopologyDiscoveryCycle {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  dexCandidates: number;
  crossChainCandidates: number;
  mempoolCandidates: number;
  makerCandidates: number;
  durationMsByTopology: {
    dex: number | null;
    crossChain: number | null;
    mempool: number | null;
    maker: number | null;
  };
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

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(5_000, Number(process.env.CRYPTOCRAWL_MULTI_TOPOLOGY_SCAN_INTERVAL_MS || 15_000));
    void this.scanOnce();
    this.timer = setInterval(() => void this.scanOnce(), intervalMs);
    this.timer.unref?.();
    logger.info('[OpportunityGraph] Non-CEX measured topology producers started', {
      component: 'MultiTopologyDiscoveryController',
      intervalMs,
      topologies: ['DEX_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN', 'ZERO_CAPITAL_ATOMIC', 'MAKER_CEX'],
      candidateAuthority: 'measured_candidate_registry',
      makerOrdersAssumedFilled: false,
      syntheticEvidenceAllowed: false,
      perTopologyLatency: 'monotonic_telemetry_only',
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scanOnce(): Promise<MultiTopologyDiscoveryCycle> {
    if (this.inFlight) return this.inFlight;
    const startedAt = Date.now();
    const cycleId = `multi-topology:${startedAt}`;
    this.inFlight = (async () => {
      const errors: string[] = [];
      let dexCandidates = 0;
      let crossChainCandidates = 0;
      let mempoolCandidates = 0;
      let makerCandidates = 0;
      const durationMsByTopology: MultiTopologyDiscoveryCycle['durationMsByTopology'] = {
        dex: null,
        crossChain: null,
        mempool: null,
        maker: null,
      };

      // Existing topology independence is preserved: DEX, cross-chain, and maker
      // producers continue to run concurrently. Timing wrappers are telemetry only.
      const [dex, cross, maker] = await Promise.allSettled([
        timed(() => discoverMeasuredDexCandidates()),
        timed(() => discoverMeasuredCrossChainCandidates()),
        timed(() => discoverMeasuredMakerCandidates()),
      ]);
      if (dex.status === 'fulfilled') {
        dexCandidates = dex.value.value.length;
        durationMsByTopology.dex = dex.value.durationMs;
      } else errors.push(`dex:${dex.reason instanceof Error ? dex.reason.message : String(dex.reason)}`);
      if (cross.status === 'fulfilled') {
        crossChainCandidates = cross.value.value.length;
        durationMsByTopology.crossChain = cross.value.durationMs;
      } else errors.push(`cross_chain:${cross.reason instanceof Error ? cross.reason.message : String(cross.reason)}`);
      if (maker.status === 'fulfilled') {
        makerCandidates = maker.value.value.length;
        durationMsByTopology.maker = maker.value.durationMs;
      } else errors.push(`maker:${maker.reason instanceof Error ? maker.reason.message : String(maker.reason)}`);

      const mempoolStartedAt = process.hrtime.bigint();
      try {
        mempoolCandidates = discoverMeasuredMempoolCandidates().length;
      } catch (error) {
        errors.push(`mempool:${error instanceof Error ? error.message : String(error)}`);
      } finally {
        durationMsByTopology.mempool = elapsedMs(mempoolStartedAt);
      }

      const completedAt = Date.now();
      const cycle: MultiTopologyDiscoveryCycle = {
        cycleId,
        startedAt,
        completedAt,
        dexCandidates,
        crossChainCandidates,
        mempoolCandidates,
        makerCandidates,
        durationMsByTopology,
        registry: measuredCandidateRegistry.getMetrics(60_000),
        errors,
      };
      this.latest = cycle;
      logger.info('[OpportunityGraph] Multi-topology measured discovery cycle completed', {
        component: 'MultiTopologyDiscoveryController',
        cycleId,
        durationMs: completedAt - startedAt,
        durationMsByTopology,
        dexCandidates,
        crossChainCandidates,
        mempoolCandidates,
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
      registry: {
        ...this.latest.registry,
        byTopology: Object.fromEntries(Object.entries(this.latest.registry.byTopology).map(([key, value]) => [key, { ...value }])) as MultiTopologyDiscoveryCycle['registry']['byTopology'],
      },
      errors: [...this.latest.errors],
    } : null;
  }
}

export const multiTopologyDiscoveryController = new MultiTopologyDiscoveryController();