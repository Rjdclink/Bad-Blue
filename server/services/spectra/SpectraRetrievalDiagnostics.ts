/** Bounded diagnostics only: no URLs, bodies, identities, or exception messages. */
export const SPECTRA_RETRIEVAL_REASONS = [
  'retrieved', 'cancelled', 'timeout', 'invalid_url', 'blocked_url', 'dns_error',
  'http_error', 'redirect_limit', 'redirect_missing_location',
  'unsupported_content_type', 'response_too_large', 'invalid_response', 'network_error',
] as const;

export type SpectraRetrievalReason = typeof SPECTRA_RETRIEVAL_REASONS[number];

export interface SpectraRetrievalDiagnostic {
  targetIndex: number;
  reason: SpectraRetrievalReason;
  /** Last HTTP status observed for this page selection, not every redirect response. */
  httpStatus?: number;
}

export interface SpectraRetrievalSummary {
  countingUnit: 'page-selection';
  completed: number;
  unreported: number;
  reasons: Partial<Record<SpectraRetrievalReason, number>>;
  httpStatuses: Record<string, number>;
}

const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/** A sealed snapshot cannot be mutated by a request finishing after its deadline. */
export function createSpectraRetrievalDiagnostics(selected: number) {
  const limit = count(selected);
  const rows = new Map<number, SpectraRetrievalDiagnostic>();
  let sealed = false;
  const record = (row: SpectraRetrievalDiagnostic) => {
    if (sealed || !Number.isInteger(row.targetIndex) || row.targetIndex < 0
      || row.targetIndex >= limit || rows.has(row.targetIndex)
      || !SPECTRA_RETRIEVAL_REASONS.includes(row.reason)) return;
    const httpStatus = Number.isInteger(row.httpStatus) && row.httpStatus! >= 100 && row.httpStatus! <= 599
      ? row.httpStatus : undefined;
    rows.set(row.targetIndex, { targetIndex: row.targetIndex, reason: row.reason, httpStatus });
  };
  const finish = (): SpectraRetrievalSummary => {
    sealed = true;
    const reasons: SpectraRetrievalSummary['reasons'] = {};
    const httpStatuses: Record<string, number> = {};
    for (const row of rows.values()) {
      reasons[row.reason] = (reasons[row.reason] || 0) + 1;
      if (row.httpStatus !== undefined) {
        httpStatuses[row.httpStatus] = (httpStatuses[row.httpStatus] || 0) + 1;
      }
    }
    return { countingUnit: 'page-selection', completed: rows.size,
      unreported: limit - rows.size, reasons, httpStatuses };
  };
  return { record, finish };
}

/** Sum passes, preserving the fact that repeated page selections are not distinct evidence. */
export function mergeSpectraRetrievalDiagnostics(
  summaries: ReadonlyArray<SpectraRetrievalSummary | undefined>,
): SpectraRetrievalSummary {
  const result: SpectraRetrievalSummary = {
    countingUnit: 'page-selection', completed: 0, unreported: 0, reasons: {}, httpStatuses: {},
  };
  for (const summary of summaries) {
    if (!summary) continue;
    result.completed += count(summary.completed);
    result.unreported += count(summary.unreported);
    for (const reason of SPECTRA_RETRIEVAL_REASONS) {
      const n = count(summary.reasons[reason] || 0);
      if (n) result.reasons[reason] = (result.reasons[reason] || 0) + n;
    }
    // Do not copy arbitrary keys supplied by a caller into logs or responses.
    for (let status = 100; status <= 599; status += 1) {
      const n = count(summary.httpStatuses[status] || 0);
      if (n) result.httpStatuses[status] = (result.httpStatuses[status] || 0) + n;
    }
  }
  return result;
}
