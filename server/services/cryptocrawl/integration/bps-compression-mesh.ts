import logger from '../../../logger.js';
import { getDynamicZeroCapitalDiscoveryState } from '../discovery/dynamic-zero-capital-routes.js';
import { ensureOkxRpiFeeAdvisory, getOkxRpiFeeOpportunities } from '../intelligence/okx-rpi-fee-advisory.js';
import { buildHyperdynamicBpsPlan, type HyperdynamicBpsPlan } from '../optimization/hyperdynamic-bps-solution-engine.js';
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
  hyperdynamic: HyperdynamicBpsPlan;
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

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positivePriority(bestPositiveBps: number): number {
  return 4 + Math.min(6, Math.max(0, bestPositiveBps) / 5);
}

function gapPriority(gapBps: number | null, scaleBps: number): number {
  if (gapBps === null || !Number.isFinite(gapBps)) return 0.15;
  return 1 / (1 + Math.max(0, gapBps) / scaleBps);
}

function normalizeShares(
  cexRaw: number,
  zeroRaw: number,
  explorationMultiplier: number,
): { cex: number; zero: number; exploration: number } {
  const configuredExplorationFloor = bounded(process.env.CRYPTOCRAWL_BPS_MESH_EXPLORATION_FLOOR, 0.10, 0.05, 0.30);
  const explorationFloor = Math.max(0.05, Math.min(0.30, configuredExplorationFloor * explorationMultiplier));
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
  const negatives = modes.filter(mode => !mode.economicallyPositive && Number.isFinite(mode.bpsToBreakEven));
  const bestPositiveBps = positives.length > 0
    ? Math.max(...positives.map(mode => Math.max(mode.expectedFeeAdjustedBps, mode.netAfterExchangeFeesBps)))
    : null;
  const negativeRiskGaps = negatives
    .filter(mode => Number.isFinite(mode.riskAdjustedBpsToBreakEven))
    .map(mode => mode.riskAdjustedBpsToBreakEven);
  const closestRiskAdjustedGapBps = negativeRiskGaps.length > 0 ? Math.min(...negativeRiskGaps) : null;
  const closestFeeGapBps = negatives.length > 0 ? Math.min(...negatives.map(mode => mode.bpsToBreakEven)) : null;
  const rpi = getOkxRpiFeeOpportunities();
  const maxRpiSavingsVsTakerBps = rpi.length > 0 ? Math.max(...rpi.map(item => item.rpiSavingsVsTakerBps)) : null;

  const zero = getZeroCapitalRecoverySnapshot();
  const dynamic = getDynamicZeroCapitalDiscoveryState();
  const zeroPositive = zero?.positiveCandidates ?? 0;
  const zeroGap = zero?.closestCandidateBpsToBreakEven ?? null;
  const zeroQuoteUtilization = dynamic.structuralCandidates > 0 ? dynamic.measuredQuotes / dynamic.structuralCandidates : null;
  const zeroPositiveYield = dynamic.measuredQuotes > 0 ? dynamic.positiveQuotes / dynamic.measuredQuotes : null;

  const freshness = modes.map(mode => finite((mode as any).feeFreshnessScore)).filter((value): value is number => value !== null);
  const feeFreshnessShare = freshness.length > 0 ? freshness.filter(value => value >= 0.75).length / freshness.length : null;
  const staleFeeModes = freshness.filter(value => value < 0.75).length;
  const hybrids = negatives.filter(mode => mode.mode === 'MT' || mode.mode === 'TM');
  const makerSavings = modes.map(mode => finite((mode as any).makerFeeSavingsVsTakerBps)).filter((value): value is number => value !== null);
  const combinedFees = modes.map(mode => finite(mode.combinedFeeBps)).filter((value): value is number => value !== null);
  const grossSpreads = modes.map(mode => finite(mode.grossSpreadBps)).filter((value): value is number => value !== null);
  const recoveries = negatives.map(mode => finite(mode.recoveryEfficiency)).filter((value): value is number => value !== null);
  const relativeCexAdvantageBps = zeroGap !== null && closestRiskAdjustedGapBps !== null
    ? zeroGap - closestRiskAdjustedGapBps
    : null;

  const hyperdynamic = buildHyperdynamicBpsPlan({
    closestFeeGapBps,
    closestRiskGapBps: closestRiskAdjustedGapBps,
    positiveModes: positives.length,
    feeFreshnessShare,
    staleFeeModes,
    hybridNearMissShare: negatives.length > 0 ? hybrids.length / negatives.length : null,
    bestRecoveryEfficiency: recoveries.length > 0 ? Math.max(...recoveries) : null,
    makerSavingsBps: makerSavings.length > 0 ? Math.max(...makerSavings) : null,
    lowestCombinedFeeBps: combinedFees.length > 0 ? Math.min(...combinedFees) : null,
    bestGrossSpreadBps: grossSpreads.length > 0 ? Math.max(...grossSpreads) : null,
    observedModes: modes.length,
    withinFiveBps: negatives.filter(mode => mode.bpsToBreakEven <= 5).length,
    withinTenBps: negatives.filter(mode => mode.bpsToBreakEven <= 10).length,
    medianGapBps: median(negatives.map(mode => mode.bpsToBreakEven)),
    p90GapBps: negatives.length > 0 ? [...negatives.map(mode => mode.bpsToBreakEven)].sort((a, b) => a - b)[Math.min(negatives.length - 1, Math.floor(negatives.length * 0.9))] : null,
    rpiSavingsBps: maxRpiSavingsVsTakerBps,
    rpiEligibleSymbols: rpi.length,
    zeroCapitalGapBps: zeroGap,
    zeroCapitalPositiveYield: zeroPositiveYield,
    zeroCapitalQuoteUtilization: zeroQuoteUtilization,
    relativeCexAdvantageBps,
  });

  let cexRaw = bestPositiveBps !== null
    ? positivePriority(bestPositiveBps)
    : gapPriority(closestRiskAdjustedGapBps, 10);
  if (maxRpiSavingsVsTakerBps !== null && maxRpiSavingsVsTakerBps > 0) {
    cexRaw *= 1 + Math.min(0.50, maxRpiSavingsVsTakerBps / 40);
  }
  cexRaw *= hyperdynamic.cexPriorityMultiplier;

  let zeroRaw = zeroPositive > 0 ? 3 + Math.min(4, zeroPositive) : gapPriority(zeroGap, 25);
  if (zero?.closestCandidateGapImproving === true) zeroRaw *= 1.20;
  if (zero?.closestCandidateGapImproving === false) zeroRaw *= 0.90;
  zeroRaw *= hyperdynamic.zeroCapitalPriorityMultiplier;

  const shares = normalizeShares(cexRaw, zeroRaw, hyperdynamic.explorationMultiplier);
  const baseBreadth = Math.max(0.40, Math.min(1, 0.40 + 0.60 * shares.cex / Math.max(0.01, 1 - shares.exploration)));
  const baseCadence = Math.max(0.50, Math.min(1.50, 1.25 - 0.75 * shares.cex));
  const cexBreadthBias = Math.max(0.35, Math.min(1, baseBreadth * hyperdynamic.breadthMultiplier));
  const cexCadenceBias = Math.max(0.40, Math.min(1.75, baseCadence * hyperdynamic.cadenceMultiplier));

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
    hyperdynamic,
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
    hyperdynamic: {
      ...latest.hyperdynamic,
      activeSolutionIds: [...latest.hyperdynamic.activeSolutionIds],
      activeSolutionKeys: [...latest.hyperdynamic.activeSolutionKeys],
    },
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
