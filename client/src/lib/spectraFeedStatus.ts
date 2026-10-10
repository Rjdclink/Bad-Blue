export interface SpectraFeedDiagnostics {
  requestId: string;
  scope: 'discovery-http';
  hasFailures: boolean;
  incomplete: boolean;
}

export function spectraFeedNotice(diagnostics?: SpectraFeedDiagnostics): string | null {
  if (!diagnostics || diagnostics.scope !== 'discovery-http') return null;
  if (diagnostics.hasFailures) return 'Some data sources failed to respond successfully. Search coverage is incomplete.';
  if (diagnostics.incomplete) return 'Some data-source checks were skipped, cancelled, or still pending when this result was returned.';
  return null;
}
