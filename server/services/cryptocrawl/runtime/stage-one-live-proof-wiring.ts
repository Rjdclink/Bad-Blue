import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { getLatestCexEconomicBarrier } from '../discovery/cex-economic-barrier.js';
import { recordStageOneMeasuredCycleProof } from '../governance/stage-one-live-proof.js';

let timer: NodeJS.Timeout | null = null;
let lastCycleId: string | null = null;
let inFlight: Promise<void> | null = null;

async function sampleLatestCycle(): Promise<void> {
  if (inFlight) return inFlight;
  const cycle = measuredOpportunityGraph.getLatestCycle();
  if (!cycle || cycle.cycleId === lastCycleId) return;
  const barrier = getLatestCexEconomicBarrier(60_000);
  if (!barrier) return;
  lastCycleId = cycle.cycleId;

  inFlight = recordStageOneMeasuredCycleProof({
    observedAt: cycle.completedAt,
    selectedSymbols: cycle.selectedSymbols,
    evaluatedSymbols: cycle.evaluatedSymbols,
    publicDiscoveryObservations: cycle.publicDiscoveryObservations,
    publicDiscoveryVenues: cycle.publicDiscoveryVenues,
    economicBarrierStatus: barrier.status,
    deterministicPositive: cycle.deterministicPositive,
    eligibleCandidates: cycle.eligibleCandidates,
    errorCount: cycle.errors.length,
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureStageOneLiveProofWiring(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = 2_000;
  void sampleLatestCycle();
  timer = setInterval(() => void sampleLatestCycle().catch(error => {
    logger.warn('[StageOneProof] Live-proof sampler degraded; core discovery remains active', {
      component: 'StageOneLiveProofWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  }), intervalMs);
  timer.unref?.();
  logger.info('[StageOneProof] Measured live-proof sampler started', {
    component: 'StageOneLiveProofWiring',
    intervalMs,
    hotPathBlocking: false,
    tradeAuthority: false,
    realizedProfitAuthority: false,
  });
}

export function stopStageOneLiveProofWiring(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastCycleId = null;
}
