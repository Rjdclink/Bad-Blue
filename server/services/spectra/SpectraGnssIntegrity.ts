export interface SpectraGnssSatelliteMeasurement {
  svid?: number | null;
  constellationType?: number | null;
  state?: number | null;
  adrState?: number | null;
  multipathIndicator?: number | null;
  cn0DbHz?: number | null;
  basebandCn0DbHz?: number | null;
  carrierFrequencyHz?: number | null;
  pseudorangeMeters?: number | null;
  pseudorangeRateMetersPerSecond?: number | null;
  pseudorangeRateUncertaintyMetersPerSecond?: number | null;
  accumulatedDeltaRangeMeters?: number | null;
  accumulatedDeltaRangeUncertaintyMeters?: number | null;
  receivedSvTimeUncertaintyNanos?: number | null;
  lineOfSightProbability?: number | null;
  excessPathLengthMeters?: number | null;
  excessPathLengthUncertaintyMeters?: number | null;
  reflectingPlanePresent?: boolean | null;
  correlationVectorCount?: number | null;
}

export interface SpectraGnssClockQuality {
  hardwareClockDiscontinuityCount?: number | null;
  timeUncertaintyNanos?: number | null;
  biasUncertaintyNanos?: number | null;
  driftUncertaintyNanosPerSecond?: number | null;
  elapsedRealtimeUncertaintyNanos?: number | null;
}

export interface SpectraGnssIntegrityAssessment {
  satelliteCount: number;
  validTrackingCount: number;
  usableAdrCount: number;
  multipathDetectedCount: number;
  strongSignalCount: number;
  uniqueFrequencyCount: number;
  uniqueConstellationCount: number;
  meanCn0DbHz?: number;
  medianPseudorangeRateUncertaintyMps?: number;
  medianAdrUncertaintyMeters?: number;
  clockContinuityHealthy: boolean;
  carrierPhaseReady: boolean;
  dualFrequencyReady: boolean;
  multiConstellationReady: boolean;
  interferenceSuspected: boolean;
  spoofingSuspected: boolean;
  jammingSuspected: boolean;
  navigationAuthenticationStatus?: 'authenticated' | 'partial' | 'failed' | 'unknown';
  measurementCorrectionCoverage: number;
  meanLineOfSightProbability?: number;
  meanExcessPathLengthMeters?: number;
  correlationVectorSatelliteCount: number;
  integrityScore: number;
  precisionReadinessScore: number;
  reasons: string[];
}

const STATE_CODE_LOCK = 1;
const STATE_TOW_DECODED = 8;
const STATE_TOW_KNOWN = 16_384;
const ADR_STATE_VALID = 1;
const ADR_STATE_RESET = 2;
const ADR_STATE_CYCLE_SLIP = 4;
const MULTIPATH_DETECTED = 1;

function finite(value: unknown): number | null {
  if (
    value === null
    || value === undefined
    || value === ''
    || typeof value === 'boolean'
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function hasTrackingValidity(stateValue: unknown): boolean {
  const state = Number(stateValue) | 0;
  const codeLock = (state & STATE_CODE_LOCK) !== 0;
  const towKnown =
    (state & STATE_TOW_DECODED) !== 0
    || (state & STATE_TOW_KNOWN) !== 0;
  return codeLock && towKnown;
}

function hasUsableAdr(adrStateValue: unknown): boolean {
  const state = Number(adrStateValue) | 0;
  return (state & ADR_STATE_VALID) !== 0
    && (state & ADR_STATE_RESET) === 0
    && (state & ADR_STATE_CYCLE_SLIP) === 0;
}

function frequencyBucket(frequencyHz: number): string {
  // Bucket to 1 MHz so the same GNSS signal from multiple satellites counts once.
  return String(Math.round(frequencyHz / 1_000_000));
}

export function assessSpectraGnssIntegrity(input: {
  satellites?: SpectraGnssSatelliteMeasurement[];
  clock?: SpectraGnssClockQuality;
  automaticGainControls?: Array<{
    carrierFrequencyHz?: number | null;
    levelDb?: number | null;
  }>;
  previousHardwareClockDiscontinuityCount?: number | null;
  navigationAuthentication?: {
    status?: string | null;
    authenticatedSatelliteCount?: number | null;
    failedSatelliteCount?: number | null;
  };
  spoofJamIndicators?: {
    spoofingSuspected?: boolean;
    jammingSuspected?: boolean;
    cn0AnomalyScore?: number | null;
    agcAnomalyScore?: number | null;
  };
}): SpectraGnssIntegrityAssessment {
  const satellites = Array.isArray(input.satellites) ? input.satellites : [];
  const clock = input.clock || {};
  const validTracking = satellites.filter(satellite =>
    hasTrackingValidity(satellite.state)
  );
  const usableAdr = satellites.filter(satellite =>
    hasUsableAdr(satellite.adrState)
    && finite(satellite.accumulatedDeltaRangeMeters) !== null
  );
  const multipathDetected = satellites.filter(satellite =>
    Number(satellite.multipathIndicator) === MULTIPATH_DETECTED
  );
  const cn0Values = satellites
    .map(satellite => finite(satellite.cn0DbHz))
    .filter((value): value is number => value !== null);
  const strongSignal = cn0Values.filter(value => value >= 30);
  const frequencies = new Set(
    satellites
      .map(satellite => finite(satellite.carrierFrequencyHz))
      .filter((value): value is number => value !== null && value > 0)
      .map(frequencyBucket),
  );
  const constellations = new Set(
    satellites
      .map(satellite => finite(satellite.constellationType))
      .filter((value): value is number => value !== null && value > 0)
      .map(String),
  );
  const prRateUncertainty = satellites
    .map(satellite => finite(satellite.pseudorangeRateUncertaintyMetersPerSecond))
    .filter((value): value is number => value !== null && value >= 0);
  const adrUncertainty = usableAdr
    .map(satellite => finite(satellite.accumulatedDeltaRangeUncertaintyMeters))
    .filter((value): value is number => value !== null && value >= 0);
  const losProbabilities = satellites
    .map(satellite => finite(satellite.lineOfSightProbability))
    .filter((value): value is number => value !== null && value >= 0 && value <= 1);
  const excessPathLengths = satellites
    .map(satellite => finite(satellite.excessPathLengthMeters))
    .filter((value): value is number => value !== null && value >= 0);
  const correctedSatelliteCount = satellites.filter(satellite =>
    finite(satellite.lineOfSightProbability) !== null
    || finite(satellite.excessPathLengthMeters) !== null
    || satellite.reflectingPlanePresent === true
  ).length;
  const correlationVectorSatelliteCount = satellites.filter(satellite =>
    (finite(satellite.correlationVectorCount) ?? 0) > 0
  ).length;

  const discontinuity = finite(clock.hardwareClockDiscontinuityCount);
  const previousDiscontinuity = finite(input.previousHardwareClockDiscontinuityCount);
  const clockContinuityHealthy =
    discontinuity === null
    || previousDiscontinuity === null
    || discontinuity === previousDiscontinuity;

  const agc = Array.isArray(input.automaticGainControls)
    ? input.automaticGainControls
    : [];
  const agcLevels = agc
    .map(value => finite(value.levelDb))
    .filter((value): value is number => value !== null);
  const interferenceSuspected =
    agcLevels.length >= 2
    && Math.max(...agcLevels) - Math.min(...agcLevels) > 18;

  const authenticationStatusRaw = String(
    input.navigationAuthentication?.status || 'unknown'
  ).trim().toLowerCase();
  const authenticatedSatelliteCount = finite(
    input.navigationAuthentication?.authenticatedSatelliteCount
  ) ?? 0;
  const failedAuthenticationCount = finite(
    input.navigationAuthentication?.failedSatelliteCount
  ) ?? 0;
  const navigationAuthenticationStatus:
    SpectraGnssIntegrityAssessment['navigationAuthenticationStatus'] =
      authenticationStatusRaw === 'authenticated'
      || authenticationStatusRaw === 'verified'
      || authenticationStatusRaw === 'osnma_verified'
        ? 'authenticated'
        : authenticationStatusRaw === 'partial'
          || authenticationStatusRaw === 'partially_authenticated'
            ? 'partial'
            : authenticationStatusRaw === 'failed'
              || authenticationStatusRaw === 'invalid'
              || failedAuthenticationCount > 0
                ? 'failed'
                : authenticatedSatelliteCount > 0
                  ? 'partial'
                  : 'unknown';

  const spoofingSuspected =
    input.spoofJamIndicators?.spoofingSuspected === true
    || (finite(input.spoofJamIndicators?.cn0AnomalyScore) ?? 0) >= 0.8;
  const jammingSuspected =
    input.spoofJamIndicators?.jammingSuspected === true
    || interferenceSuspected
    || (finite(input.spoofJamIndicators?.agcAnomalyScore) ?? 0) >= 0.8;

  const satelliteCount = satellites.length;
  const validTrackingCount = validTracking.length;
  const usableAdrCount = usableAdr.length;
  const multipathDetectedCount = multipathDetected.length;
  const strongSignalCount = strongSignal.length;
  const uniqueFrequencyCount = frequencies.size;
  const uniqueConstellationCount = constellations.size;
  const measurementCorrectionCoverage = satelliteCount
    ? correctedSatelliteCount / satelliteCount
    : 0;
  const meanLineOfSightProbability = losProbabilities.length
    ? losProbabilities.reduce((sum, value) => sum + value, 0) / losProbabilities.length
    : undefined;
  const meanExcessPathLengthMeters = excessPathLengths.length
    ? excessPathLengths.reduce((sum, value) => sum + value, 0) / excessPathLengths.length
    : undefined;
  const correctionQualityScore =
    meanLineOfSightProbability === undefined
      ? 1
      : clamp(
          meanLineOfSightProbability
          * (
            meanExcessPathLengthMeters === undefined
              ? 1
              : 1 / (1 + meanExcessPathLengthMeters / 10)
          ),
          0.10,
          1,
        );

  const trackingRatio = satelliteCount
    ? validTrackingCount / satelliteCount
    : 0;
  const multipathRatio = satelliteCount
    ? multipathDetectedCount / satelliteCount
    : 0;
  const signalRatio = satelliteCount
    ? strongSignalCount / satelliteCount
    : 0;
  const adrRatio = satelliteCount
    ? usableAdrCount / satelliteCount
    : 0;

  const carrierPhaseReady =
    usableAdrCount >= 5
    && clockContinuityHealthy;
  const dualFrequencyReady = uniqueFrequencyCount >= 2;
  const multiConstellationReady = uniqueConstellationCount >= 2;

  let integrityScore =
    0.30 * trackingRatio
    + 0.20 * signalRatio
    + 0.15 * (1 - multipathRatio)
    + 0.15 * (clockContinuityHealthy ? 1 : 0)
    + 0.10 * clamp(uniqueConstellationCount / 3)
    + 0.10 * clamp(uniqueFrequencyCount / 2);

  if (interferenceSuspected) integrityScore *= 0.7;
  if (jammingSuspected) integrityScore *= 0.65;
  if (spoofingSuspected) integrityScore *= 0.25;
  if (navigationAuthenticationStatus === 'failed') integrityScore *= 0.30;
  if (navigationAuthenticationStatus === 'partial') integrityScore *= 0.90;
  if (losProbabilities.length) {
    integrityScore *= 0.70 + 0.30 * correctionQualityScore;
  }
  integrityScore = clamp(integrityScore);

  let precisionReadinessScore =
    0.30 * adrRatio
    + 0.20 * trackingRatio
    + 0.15 * (dualFrequencyReady ? 1 : 0)
    + 0.15 * (multiConstellationReady ? 1 : 0)
    + 0.10 * (clockContinuityHealthy ? 1 : 0)
    + 0.10 * (1 - multipathRatio);

  if (!carrierPhaseReady) precisionReadinessScore *= 0.75;
  if (interferenceSuspected) precisionReadinessScore *= 0.7;
  if (jammingSuspected) precisionReadinessScore *= 0.65;
  if (spoofingSuspected) precisionReadinessScore *= 0.20;
  if (navigationAuthenticationStatus === 'failed') precisionReadinessScore *= 0.30;
  if (losProbabilities.length) {
    precisionReadinessScore *= 0.65 + 0.35 * correctionQualityScore;
  }
  precisionReadinessScore = clamp(precisionReadinessScore);

  const reasons: string[] = [];
  if (validTrackingCount < 4) {
    reasons.push('Fewer than four measurements have both code lock and known/decoded time.');
  }
  if (!clockContinuityHealthy) {
    reasons.push('The GNSS hardware clock discontinuity count changed across epochs.');
  }
  if (multipathRatio > 0.25) {
    reasons.push('A material fraction of satellite measurements report multipath.');
  }
  if (!dualFrequencyReady) {
    reasons.push('Only one carrier-frequency band is represented in the current epoch.');
  }
  if (!multiConstellationReady) {
    reasons.push('Only one GNSS constellation is represented in the current epoch.');
  }
  if (!carrierPhaseReady) {
    reasons.push('Carrier-phase/ADR measurements are not yet sufficiently continuous for precision positioning.');
  }
  if (interferenceSuspected) {
    reasons.push('Automatic gain-control spread indicates possible RF interference.');
  }
  if (jammingSuspected) {
    reasons.push('GNSS interference indicators are consistent with possible jamming.');
  }
  if (spoofingSuspected) {
    reasons.push('GNSS signal-quality indicators are consistent with possible spoofing.');
  }
  if (navigationAuthenticationStatus === 'failed') {
    reasons.push('Navigation-message authentication failed for one or more signals.');
  }
  if (
    meanLineOfSightProbability !== undefined
    && meanLineOfSightProbability < 0.5
  ) {
    reasons.push('Measurement-correction metadata indicates predominantly non-line-of-sight satellite propagation.');
  }
  if (
    meanExcessPathLengthMeters !== undefined
    && meanExcessPathLengthMeters > 10
  ) {
    reasons.push('Measurement corrections report substantial excess propagation path length consistent with multipath/NLOS bias.');
  }

  return {
    satelliteCount,
    validTrackingCount,
    usableAdrCount,
    multipathDetectedCount,
    strongSignalCount,
    uniqueFrequencyCount,
    uniqueConstellationCount,
    meanCn0DbHz: cn0Values.length
      ? cn0Values.reduce((sum, value) => sum + value, 0) / cn0Values.length
      : undefined,
    medianPseudorangeRateUncertaintyMps: median(prRateUncertainty),
    medianAdrUncertaintyMeters: median(adrUncertainty),
    clockContinuityHealthy,
    carrierPhaseReady,
    dualFrequencyReady,
    multiConstellationReady,
    interferenceSuspected,
    spoofingSuspected,
    jammingSuspected,
    navigationAuthenticationStatus,
    measurementCorrectionCoverage,
    meanLineOfSightProbability,
    meanExcessPathLengthMeters,
    correlationVectorSatelliteCount,
    integrityScore,
    precisionReadinessScore,
    reasons,
  };
}
