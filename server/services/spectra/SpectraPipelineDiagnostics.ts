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
  activeAttempts: ReadonlyArray<{ status: string }>;
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
    outcome: input.solvedObservations > 0 ? 'location-observations' as const
      : input.regionalCandidates > 0 ? 'regional-context' as const
      : 'no-mappable-evidence' as const,
  };
}
