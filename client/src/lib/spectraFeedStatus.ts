export interface SpectraFeedDiagnostics {
  requestId: string;
  scope: 'discovery-http';
  hasFailures: boolean;
  incomplete: boolean;
  partial?: number;
  dispatched?: number;
  ok?: number;
  empty?: number;
  failed?: number;
  timeout?: number;
  skipped?: number;
  cancelled?: number;
  pending?: number;
  providers?: Array<{ provider: string; errors?: Record<string, number> }>;
}

const safeCount = (value: number | undefined) => Number.isFinite(value)
  ? Math.max(0, Math.floor(value!)) : 0;

/** Display only fixed diagnostic labels, never upstream exception text. */
export function spectraFeedNotices(diagnostics?: SpectraFeedDiagnostics): string[] {
  if (diagnostics?.scope !== 'discovery-http') return [];
  const notices: string[] = [];
  if (diagnostics.dispatched !== undefined) {
    notices.push(`Search attempts: ${safeCount(diagnostics.dispatched)} dispatched; ${safeCount(diagnostics.ok)} returned results; ${safeCount(diagnostics.empty)} returned no results; ${safeCount(diagnostics.failed)} failed; ${safeCount(diagnostics.timeout)} timed out; ${safeCount(diagnostics.skipped)} skipped; ${safeCount(diagnostics.cancelled)} cancelled; ${safeCount(diagnostics.pending)} pending when reported.`);
    notices.push('These are provider attempts, not distinct sources or accepted location evidence. Dispatched means collection work started, not that a source was reached. Partial responses overlap other outcomes.');
  }
  if (safeCount(diagnostics.partial)) notices.push(`${safeCount(diagnostics.partial)} provider attempts returned partial results.`);
  const providers: Record<string, string> = {
    tavily: 'Tavily', searxng: 'SearXNG', ddgs: 'DDGS', openserp: 'OpenSERP',
    serpapi: 'SerpAPI', scrapingbee: 'ScrapingBee', 'common-crawl': 'Common Crawl',
    'duckduckgo-instant-answer': 'DuckDuckGo Instant Answer', other: 'Other provider',
  };
  const errors: Record<string, string> = {
    'queue-capacity': 'queue full', 'queue-timeout': 'queue wait expired',
    'provider-unavailable': 'provider unavailable (specific cause unconfirmed)',
    'upstream-error': 'upstream errors', dns: 'DNS failures', connection: 'connection failures',
    timeout: 'timeouts', 'invalid-response': 'invalid responses', 'request-failed': 'request failures',
  };
  for (const row of diagnostics.providers || []) {
    if (!Object.hasOwn(providers, row.provider)) continue;
    const reasons = Object.entries(row.errors || {}).flatMap(([code, value]) => {
      const label = Object.hasOwn(errors, code) ? errors[code]
        : /^http-[45]\d\d$/.test(code) ? `HTTP ${code.slice(5)}` : undefined;
      return label && safeCount(value) ? [`${safeCount(value)} ${label}`] : [];
    });
    if (reasons.length) notices.push(`${providers[row.provider]}: ${reasons.join('; ')}.`);
  }
  return notices;
}

export function spectraObservationNotices(
  observations: ReadonlyArray<{ observationKind?: string; source?: string }>,
  status?: string,
): string[] {
  const notices: string[] = [];
  const historical = observations.filter(point => point.observationKind === 'historical'
    || ['exif_photo', 'exif_video', 'historical_location'].includes(point.source || '')).length;
  if (historical) notices.push(`${historical} historical observation${historical === 1 ? '' : 's'} shown. Historical records and media capture sites do not establish current presence.`);
  const labels: Record<string, string> = {
    unavailable: 'Current-location evidence is unavailable.',
    stale: 'Location evidence is stale; current location is unverified.',
    estimated: 'Current location remains an estimate, without sufficient corroboration.',
    conflicted: 'Location evidence conflicts; current location is unverified.',
    corroborated: 'Spatial evidence is corroborated; subject identity is assessed separately.',
  };
  if (status && Object.hasOwn(labels, status)) notices.push(labels[status]);
  return notices;
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
  publicRetrieval: { selected: number; retrieved: number; deadlineExpiredPasses: number; diagnostics?: SpectraRetrievalSummary };
  telemetry: { configuredCollectors: number; failed: number; normalizationFailed: number; fulfilled?: number; skipped?: number; observations?: number };
  observations: { accepted: number; rejected: number; supplied?: number; saved?: number; normalized?: number; solved?: number; qualityIssues?: Record<string, number> };
  coordinateFusion: { executed: boolean };
}

export interface SpectraRetrievalSummary {
  completed: number;
  unreported: number;
  reasons: Record<string, number | undefined>;
  httpStatuses: Record<string, number>;
}

export function spectraRetrievalNotices(diagnostics?: SpectraRetrievalSummary): string[] {
  if (!diagnostics) return [];
  const count = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
  const labels: Record<string, string> = {
    cancelled: 'cancelled', timeout: 'timed out', invalid_url: 'invalid URLs',
    blocked_url: 'blocked by URL policy', dns_error: 'DNS failures', http_error: 'HTTP errors',
    redirect_limit: 'redirect limit reached', redirect_missing_location: 'redirect destination missing',
    unsupported_content_type: 'unsupported content types', response_too_large: 'responses too large',
    invalid_response: 'invalid responses', network_error: 'network failures',
  };
  const failures = Object.entries(labels).flatMap(([reason, label]) => {
    const n = count(diagnostics.reasons?.[reason]);
    return n ? [`${n} ${label}`] : [];
  });
  const notices = failures.length ? [`Page retrieval: ${failures.join('; ')}.`] : [];
  const statuses = Object.entries(diagnostics.httpStatuses || {})
    .filter(([status, n]) => /^[45]\d\d$/.test(status) && count(n) > 0)
    .map(([status, n]) => `${status}: ${count(n)}`);
  if (statuses.length) notices.push(`Last observed HTTP error statuses: ${statuses.join('; ')}.`);
  if (count(diagnostics.unreported)) {
    notices.push(`${count(diagnostics.unreported)} page selections had no completed diagnostic when the result was returned; their failure cause is unconfirmed.`);
  }
  return notices;
}

export function spectraPipelineNotices(diagnostics?: SpectraPipelineDiagnostics): string[] {
  if (diagnostics?.scope !== 'evidence-pipeline') return [];
  const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const notices = [
    `${count(diagnostics.publicRetrieval.retrieved)} of ${count(diagnostics.publicRetrieval.selected)} selected pages retrieved across search passes; ${count(diagnostics.observations.accepted)} location observations accepted.`,
  ];
  notices.push(...spectraRetrievalNotices(diagnostics.publicRetrieval.diagnostics));
  if (diagnostics.publicRetrieval.selected > 0) {
    notices.push('Page selections may repeat across passes. Retrieved pages and search attempts are not independent evidence.');
  }
  if (diagnostics.publicRetrieval.deadlineExpiredPasses > 0) {
    notices.push('Some source-page retrievals reached their time limit. Page coverage is incomplete.');
  }
  if (diagnostics.telemetry.configuredCollectors === 0) {
    notices.push('No automatic telemetry pull collector is configured. Public web search remains a separate source.');
  }
  if (diagnostics.telemetry.failed > 0 || diagnostics.telemetry.normalizationFailed > 0) {
    notices.push('An automatic telemetry request or its data processing failed.');
  }
  if (diagnostics.telemetry.fulfilled !== undefined && diagnostics.telemetry.observations !== undefined) {
    notices.push(`Automatic telemetry: ${count(diagnostics.telemetry.configuredCollectors)} collectors configured; ${count(diagnostics.telemetry.fulfilled)} collection attempts fulfilled; ${count(diagnostics.telemetry.observations)} coordinate observations received. Configuration and fulfilled requests alone do not establish usable measurements.`);
  }
  const observations = diagnostics.observations;
  if (observations.supplied !== undefined && observations.saved !== undefined && observations.normalized !== undefined) {
    notices.push(`Observation inputs: ${count(observations.supplied)} supplied with this request; ${count(observations.saved)} loaded from saved records; ${count(observations.normalized)} entered quality checks. Inputs can overlap and are not independent evidence.`);
  }
  if (diagnostics.observations.rejected > 0) {
    notices.push(`${count(diagnostics.observations.rejected)} location observations did not pass data-quality checks.`);
  }
  const qualityLabels: Record<string, string> = {
    invalid_timestamp: 'invalid timestamps', invalid_coordinate: 'invalid coordinates',
    invalid_confidence: 'invalid confidence values', invalid_accuracy: 'invalid accuracy values',
    missing_accuracy: 'missing accuracy', low_accuracy: 'low accuracy',
    duplicate_point: 'duplicate observations', implausible_transition: 'implausible transitions', other: 'other issues',
  };
  const issues = Object.entries(qualityLabels).flatMap(([code, label]) => {
    const n = safeCount(observations.qualityIssues?.[code]);
    return n ? [`${n} ${label}`] : [];
  });
  if (issues.length) notices.push(`Quality checks: ${issues.join('; ')}. These include warnings on retained observations; issue counts are not rejection counts.`);
  if (!diagnostics.coordinateFusion.executed) {
    notices.push('Coordinate fusion had no usable observations to process. Regional inference is evaluated separately.');
  }
  return notices;
}
