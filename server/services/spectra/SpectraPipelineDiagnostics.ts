/** Counts only. Never copy targets, records, coordinates, URLs or error text. */
import { mergeSpectraRetrievalDiagnostics, type SpectraRetrievalSummary } from './SpectraRetrievalDiagnostics';

export interface SpectraRetrievalCounts {
  selected: number;
  retrieved: number;
  deadlineExpiredPasses: number;
  diagnostics?: SpectraRetrievalSummary;
}

interface PipelineInput {
  discoveryResults: number;
  retrieval: SpectraRetrievalCounts;
  configuredCollectors: number;
  activeAttempts: ReadonlyArray<{ status: string; normalizerKind?: string; reasonCode?: string; measurementCount?: number }>;
  activeBatchOutcomes: ReadonlyArray<{ status: string }>;
  activeObservations: number;
  suppliedObservations: number;
  savedObservations: number;
  normalizedObservations: number;
  acceptedObservations: number;
  rejectedObservations: number;
  qualityIssues: ReadonlyArray<{ code: string }>;
  solvedObservations: number;
  fusedCandidates: number;
  regionalCandidates: number;
  regional?: {
    sourcesEvaluated: number; corroboratedClues: number; provisionalClues: number;
    directoryClues: number; profileClues: number;
    phoneSupplied: boolean; phoneOriginAvailable: boolean; phoneOriginRecords: number;
    suppliedClues: number; geocodeAttempts: number; geocodeMatches: number; geocodeFailures: number;
    mappedBy: string;
  };
}

const count = (value: number) => Number.isFinite(value)
  ? Math.max(0, Math.floor(value)) : 0;
const issueCodes = new Set([
  'invalid_timestamp', 'invalid_coordinate', 'invalid_confidence',
  'invalid_accuracy', 'missing_accuracy', 'low_accuracy',
  'duplicate_point', 'implausible_transition',
]);

export function buildSpectraPipelineDiagnostics(input: PipelineInput) {
  const selected = count(input.retrieval.selected);
  const retrieved = Math.min(selected, count(input.retrieval.retrieved));
  const issues: Record<string, number> = {};
  for (const issue of input.qualityIssues) {
    const code = issueCodes.has(issue.code) ? issue.code : 'other';
    issues[code] = (issues[code] || 0) + 1;
  }
  const collectors = new Map<string, { family: string; fulfilled: number; failed: number; skipped: number; measurements: number; reasons: Record<string, number> }>();
  for (const row of input.activeAttempts) {
    const family = ['android-managed-lost-mode', 'apple-managed-lost-mode', 'cisco-spaces-location'].includes(row.normalizerKind || '') ? row.normalizerKind! : 'other';
    const entry = collectors.get(family) || { family, fulfilled: 0, failed: 0, skipped: 0, measurements: 0, reasons: {} };
    if (row.status === 'fulfilled' || row.status === 'failed' || row.status === 'skipped') entry[row.status]++;
    entry.measurements += count(row.measurementCount || 0);
    if (row.reasonCode) {
      const code = ['not-configured', 'missing-device', 'request-failed'].includes(row.reasonCode) ? row.reasonCode : 'other';
      entry.reasons[code] = (entry.reasons[code] || 0) + 1;
    }
    collectors.set(family, entry);
  }
  return {
    scope: 'evidence-pipeline' as const,
    discoveryResults: count(input.discoveryResults),
    publicRetrieval: {
      // Counts can include the same URL in separate passes; not unique sources.
      countingUnit: 'page-selection' as const,
      selected,
      retrieved,
      notRetrieved: selected - retrieved,
      deadlineExpiredPasses: count(input.retrieval.deadlineExpiredPasses),
      diagnostics: input.retrieval.diagnostics
        ? mergeSpectraRetrievalDiagnostics([input.retrieval.diagnostics]) : undefined,
    },
    telemetry: {
      collectors: [...collectors.values()],
      configuredCollectors: count(input.configuredCollectors),
      fulfilled: input.activeAttempts.filter(row => row.status === 'fulfilled').length,
      failed: input.activeAttempts.filter(row => row.status === 'failed').length,
      skipped: input.activeAttempts.filter(row => row.status === 'skipped').length,
      normalizationFailed: input.activeBatchOutcomes.filter(row => row.status === 'rejected').length,
      observations: count(input.activeObservations),
    },
    observations: {
      supplied: count(input.suppliedObservations),
      saved: count(input.savedObservations),
      normalized: count(input.normalizedObservations),
      accepted: count(input.acceptedObservations),
      rejected: count(input.rejectedObservations),
      qualityIssues: issues,
      solved: count(input.solvedObservations),
    },
    coordinateFusion: {
      executed: input.solvedObservations > 0,
      candidates: count(input.fusedCandidates),
    },
    regionalCandidates: count(input.regionalCandidates),
    regional: input.regional ? {
      sourcesEvaluated: count(input.regional.sourcesEvaluated),
      corroboratedClues: count(input.regional.corroboratedClues),
      provisionalClues: count(input.regional.provisionalClues),
      directoryClues: count(input.regional.directoryClues),
      profileClues: count(input.regional.profileClues),
      phoneSupplied: input.regional.phoneSupplied === true,
      phoneOriginAvailable: input.regional.phoneOriginAvailable === true,
      phoneOriginRecords: count(input.regional.phoneOriginRecords),
      suppliedClues: count(input.regional.suppliedClues),
      geocodeAttempts: count(input.regional.geocodeAttempts),
      geocodeMatches: count(input.regional.geocodeMatches),
      geocodeFailures: count(input.regional.geocodeFailures),
      mappedBy: ['corroborated', 'public-document', 'public-profile', 'phone-assignment', 'supplied-clue'].includes(input.regional.mappedBy)
        ? input.regional.mappedBy : 'none',
    } : undefined,
    outcome: input.solvedObservations > 0 ? 'location-observations' as const
      : input.regionalCandidates > 0 ? 'regional-context' as const
      : 'no-mappable-evidence' as const,
  };
}
