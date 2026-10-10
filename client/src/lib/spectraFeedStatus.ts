export interface SpectraFeedDiagnostics {
  requestId: string;
  scope: 'discovery-http';
  hasFailures: boolean;
  incomplete: boolean;
  partial?: number;
}

export function spectraFeedNotice(diagnostics?: SpectraFeedDiagnostics): string | null {
  if (!diagnostics || diagnostics.scope !== 'discovery-http') return null;
  if (diagnostics.hasFailures) return 'Some data sources failed to respond successfully. Search coverage is incomplete.';
  if ((diagnostics.partial ?? 0) > 0) return 'Some data sources returned only partial results. Search coverage is incomplete.';
  if (diagnostics.incomplete) return 'Some data-source checks were skipped, cancelled, or still pending when this result was returned.';
  return null;
}

export interface SpectraPipelineDiagnostics {
  scope: 'evidence-pipeline';
  publicRetrieval: { selected: number; retrieved: number; deadlineExpiredPasses: number };
  telemetry: { configuredCollectors: number; failed: number; normalizationFailed: number };
  observations: { accepted: number; rejected: number };
  coordinateFusion: { executed: boolean };
}

export function spectraPipelineNotices(diagnostics?: SpectraPipelineDiagnostics): string[] {
  if (diagnostics?.scope !== 'evidence-pipeline') return [];
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const notices = [
    `${count(diagnostics.publicRetrieval.retrieved)} of ${count(diagnostics.publicRetrieval.selected)} selected pages retrieved across search passes; ${count(diagnostics.observations.accepted)} location observations accepted.`,
  ];
  if (diagnostics.publicRetrieval.deadlineExpiredPasses > 0) {
    notices.push('Some source-page retrievals reached their time limit. Page coverage is incomplete.');
  }
  if (diagnostics.telemetry.configuredCollectors === 0) {
    notices.push('No automatic telemetry pull collector is configured. Public web search remains a separate source.');
  }
  if (diagnostics.telemetry.failed > 0 || diagnostics.telemetry.normalizationFailed > 0) {
    notices.push('An automatic telemetry request or its data processing failed.');
  }
  if (diagnostics.observations.rejected > 0) {
    notices.push(`${count(diagnostics.observations.rejected)} location observations did not pass data-quality checks.`);
  }
  if (!diagnostics.coordinateFusion.executed) {
    notices.push('Coordinate fusion had no usable observations to process. Regional inference is evaluated separately.');
  }
  return notices;
}
