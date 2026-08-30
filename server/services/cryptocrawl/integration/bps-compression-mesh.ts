import logger from '../../../logger.js';
import { ensureOkxRpiFeeAdvisory, getOkxRpiFeeOpportunities } from '../intelligence/okx-rpi-fee-advisory.js';
import { getCexFourModeSnapshot } from './cex-four-mode-observability-wiring.js';
import { getZeroCapitalRecoverySnapshot } from './zero-capital-recovery-observability.js';

export interface BpsCompressionMeshSnapshot {
  observedAt: number;
  cex: {
    observedModes: number;
    positiveModes: number;
    bestPositiveBps: number | null;
    closestRiskAdjustedGapBps: number | null;
    rpiEligibleSymbols: number;
    maxRpiSavingsVsTakerBps: number | null;
    rawPriority: number;
    attentionShare: number;
  };
  zeroCapital: {
    observedCandidates: number;
    positiveCandidates: number;
    closestGapBps: number | null;
    gapImproving: boolean | null;
    rawPriority: number;
    attentionShare: number;
  };
  exploration: {
    attentionShare: number;
  };
  cexBreadthBias: number;
  cexCadenceBias: number;
  objective: 'measured_distance_to_positive_bps_per_scarcity_unit';
  authority: 'search_and_compute_scheduling_only';
  executionAuthority: false;
  syntheticEvidenceAllowed: false;
}

let latest: BpsCompressionMeshSnapshot | null = null;
let timer: NodeJS.Timeout | null = null;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function positivePriority(bestPositiveBps: number): number {
  return 4 + Math.min(6, Math.max(0, bestPositiveBps) / 5);
}

function gapPriority(gapBps: number | null, scaleBps: number): number {
  if (gapBps === null || !Number.isFinite(gapBps)) return 0.15;
  return 1 / (1 + Math.max(0, gapBps) / scaleBps);
}

function normalizeShares(cexRaw: number, zeroRaw: number): { cex: number; zero: number; exploration: number } {
  const explorationFloor = bounded(process.env.CRYPTOCRAWL_BPS_MESH_EXPLORATION_FLOOR, 0.10, 0.05, 0.30);
  const zeroFloor = bounded(process.env.CRYPTOCRAWL_BPS_MESH_ZERO_CAPITAL_FLOOR, 0.10, 0.05, 0.35);
  const available = Math.max(0, 1 - explorationFloor - zeroFloor);
  const denominator = Math.max(1e-9, cexRaw + zeroRaw);
  const cexVariable = available * cexRaw / denominator;
  const zeroVariable = available * zeroRaw / denominator;
  return {
    cex: cexVariable,
    zero: zeroFloor + zeroVariable,
    exploration: explorationFloor,
  };
}

export function refreshBpsCompressionMesh(): BpsCompressionMeshSnapshot {
  const modes = getCexFourModeSnapshot();
  const positives = modes.filter(mode => mode.economicallyPositive);
  const bestPositiveBps = positives.length > 0
    ? Math.max(...positives.map(mode => Math.max(mode.expectedFeeAdjustedBps, mode.netAfterExchangeFeesBps)))
    : null;
  const negativeRiskGaps = modes
    .filter(mode => !mode.economicallyPositive && Number.isFinite(mode.riskAdjustedBpsToBreakEven))
    .map(mode => mode.riskAdjustedBpsToBreakEven);
  const closestRiskAdjustedGapBps = negativeRiskGaps.length > 0 ? Math.min(...negativeRiskGaps) : null;
  const rpi = getOkxRpiFeeOpportunities();
  const maxRpiSavingsVsTakerBps = rpi.length > 0 ? Math.max(...rpi.map(item => item.rpiSavingsVsTakerBps)) : null;
  let cexRaw = bestPositiveBps !== null
    ? positivePriority(bestPositiveBps)
    : gapPriority(closestRiskAdjustedGapBps, 10);
  if (maxRpiSavingsVsTakerBps !== null && maxRpiSavingsVsTakerBps > 0) {
    // RPI is only an authenticated fee-opportunity signal here. It may make a
    // near-miss more worth measuring, but it never changes executable economics.
    cexRaw *= 1 + Math.min(0.50, maxRpiSavingsVsTakerBps / 40);
  }

  const zero = getZeroCapitalRecoverySnapshot();
  const zeroPositive = zero?.positiveCandidates ?? 0;
  const zeroGap = zero?.closestCandidateBpsToBreakEven ?? null;
  let zeroRaw = zeroPositive > 0 ? 3 + Math.min(4, zeroPositive) : gapPriority(zeroGap, 25);
  if (zero?.closestCandidateGapImproving === true) zeroRaw *= 1.20;
  if (zero?.closestCandidateGapImproving === false) zeroRaw *= 0.90;

  const shares = normalizeShares(cexRaw, zeroRaw);
  // Map the measured CEX attention share into bounded Antenna/Compute scheduling
  // biases. These do not alter economics, admission, governance, or execution.
  const cexBreadthBias = Math.max(0.40, Math.min(1, 0.40 + 0.60 * shares.cex / Math.max(0.01, 1 - shares.exploration)));
  const cexCadenceBias = Math.max(0.50, Math.min(1.50, 1.25 - 0.75 * shares.cex));

  latest = {
    observedAt: Date.now(),
    cex: {
      observedModes: modes.length,
      positiveModes: positives.length,
      bestPositiveBps,
      closestRiskAdjustedGapBps,
      rpiEligibleSymbols: rpi.length,
      maxRpiSavingsVsTakerBps,
      rawPriority: cexRaw,
      attentionShare: shares.cex,
    },
    zeroCapital: {
      observedCandidates: zero?.observedCandidates ?? 0,
      positiveCandidates: zeroPositive,
      closestGapBps: zeroGap,
      gapImproving: zero?.closestCandidateGapImproving ?? null,
      rawPriority: zeroRaw,
      attentionShare: shares.zero,
    },
    exploration: { attentionShare: shares.exploration },
    cexBreadthBias,
    cexCadenceBias,
    objective: 'measured_distance_to_positive_bps_per_scarcity_unit',
    authority: 'search_and_compute_scheduling_only',
    executionAuthority: false,
    syntheticEvidenceAllowed: false,
  };

  logger.info('[BpsCompressionMesh] Cross-topology profitability attention refreshed', {
    component: 'BpsCompressionMesh',
    ...latest,
  });
  return getBpsCompressionMeshSnapshot()!;
}

export function getBpsCompressionMeshSnapshot(): BpsCompressionMeshSnapshot | null {
  return latest ? {
    ...latest,
    cex: { ...latest.cex },
    zeroCapital: { ...latest.zeroCapital },
    exploration: { ...latest.exploration },
  } : null;
}

export function ensureBpsCompressionMesh(): void {
  if (timer || process.env.CRYPTOCRAWL_BPS_COMPRESSION_MESH_ENABLED === 'false') return;
  ensureOkxRpiFeeAdvisory();
  refreshBpsCompressionMesh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = bounded(process.env.CRYPTOCRAWL_BPS_COMPRESSION_MESH_INTERVAL_MS, 15_000, 5_000, 120_000);
    timer = setInterval(refreshBpsCompressionMesh, intervalMs);
    timer.unref?.();
  }
}
