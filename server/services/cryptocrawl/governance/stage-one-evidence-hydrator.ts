import logger from '../../../logger.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { refreshCexInventoryReadinessNow } from '../integration/cex-inventory-readiness-wiring.js';
import { stageManager } from './stage-management.js';

export interface StageOneEvidenceHydrationResult {
  attempted: boolean;
  graphCompleted: boolean;
  inventoryCompleted: boolean;
  deterministicPositive: number | null;
  eligibleCandidates: number | null;
  spendableAssets: number | null;
  errors: string[];
  authority: 'measured_read_only_hydration';
  executionAuthority: false;
}

let inFlight: Promise<StageOneEvidenceHydrationResult> | null = null;
let lastCompletedAt = 0;
let lastResult: StageOneEvidenceHydrationResult | null = null;

function minimumHydrationIntervalMs(): number {
  const parsed = Number(process.env.CRYPTO_STAGE_ONE_EVIDENCE_HYDRATION_MIN_MS || 1_750);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(10_000, Math.trunc(parsed))) : 1_750;
}

function clone(result: StageOneEvidenceHydrationResult): StageOneEvidenceHydrationResult {
  return { ...result, errors: [...result.errors] };
}

/**
 * Stage advancement must fail closed on missing critical evidence, but it should
 * not remain blocked merely because the proof producers have not refreshed yet.
 * This helper actively refreshes the canonical measured CEX graph and the exact
 * authenticated inventory authority before Stage-1 progression is evaluated.
 * It does not synthesize evidence, alter thresholds, or grant execution authority.
 */
export async function hydrateStageOneAdvancementEvidence(force = false): Promise<StageOneEvidenceHydrationResult> {
  const state = stageManager.getState();
  if (state.currentStage !== 1 || state.isPaused || state.manualHold || state.killSwitchActive || state.blockingAnomaly) {
    return {
      attempted: false,
      graphCompleted: false,
      inventoryCompleted: false,
      deterministicPositive: null,
      eligibleCandidates: null,
      spendableAssets: null,
      errors: [],
      authority: 'measured_read_only_hydration',
      executionAuthority: false,
    };
  }

  const now = Date.now();
  if (!force && lastResult && now - lastCompletedAt < minimumHydrationIntervalMs()) return clone(lastResult);
  if (inFlight) return inFlight.then(clone);

  const work = (async (): Promise<StageOneEvidenceHydrationResult> => {
    const [graphResult, inventoryResult] = await Promise.allSettled([
      measuredOpportunityGraph.scanOnce(),
      refreshCexInventoryReadinessNow(),
    ]);
    const errors: string[] = [];
    if (graphResult.status === 'rejected') errors.push(`graph:${graphResult.reason instanceof Error ? graphResult.reason.message : String(graphResult.reason)}`);
    if (inventoryResult.status === 'rejected') errors.push(`inventory:${inventoryResult.reason instanceof Error ? inventoryResult.reason.message : String(inventoryResult.reason)}`);

    const result: StageOneEvidenceHydrationResult = {
      attempted: true,
      graphCompleted: graphResult.status === 'fulfilled',
      inventoryCompleted: inventoryResult.status === 'fulfilled',
      deterministicPositive: graphResult.status === 'fulfilled' ? graphResult.value.deterministicPositive : null,
      eligibleCandidates: graphResult.status === 'fulfilled' ? graphResult.value.eligibleCandidates : null,
      spendableAssets: inventoryResult.status === 'fulfilled' ? inventoryResult.value.spendableAssets : null,
      errors,
      authority: 'measured_read_only_hydration',
      executionAuthority: false,
    };
    lastCompletedAt = Date.now();
    lastResult = result;

    logger.info('[StageOneEvidence] Advancement proof hydration completed', {
      component: 'StageOneEvidenceHydrator',
      graphCompleted: result.graphCompleted,
      inventoryCompleted: result.inventoryCompleted,
      deterministicPositive: result.deterministicPositive,
      eligibleCandidates: result.eligibleCandidates,
      spendableAssets: result.spendableAssets,
      errors: errors.slice(0, 6),
      minimumHydrationIntervalMs: minimumHydrationIntervalMs(),
      missingEvidenceBypass: false,
      thresholdsChanged: false,
      executionAuthority: false,
    });
    return result;
  })().finally(() => {
    inFlight = null;
  });

  inFlight = work;
  return work.then(clone);
}
