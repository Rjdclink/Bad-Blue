import { discoveryFetch } from '../../lexara/DiscoveryDiagnostics';
import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

/** Public RECAP docket metadata. A case-name match is a lead, never proof of identity or residence. */
export interface SpectraPublicCourtCollection {
  status: 'not_applicable' | 'unconfigured' | 'ok' | 'empty' | 'failed';
  records: SpectraRetrievedEvidence[];
}

type CourtSearch = (url: URL, token: string, signal: AbortSignal) => Promise<unknown>;

const defaultSearch: CourtSearch = async (url, token, signal) => {
  const response = await discoveryFetch(fetch, url, {
    headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    signal,
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('CourtListener search unavailable');
  }
  if (Number(response.headers.get('content-length') || 0) > 512_000) {
    throw new Error('CourtListener response too large');
  }
  const body = await response.text();
  if (body.length > 512_000) throw new Error('CourtListener response too large');
  return JSON.parse(body);
};

function docketUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, 'https://www.courtlistener.com');
    return url.protocol === 'https:' && url.hostname === 'www.courtlistener.com'
      && /^\/docket\/\d+\//.test(url.pathname) && !url.username && !url.password
      ? url.toString() : null;
  } catch { return null; }
}

export async function collectSpectraPublicCourtRecords(
  subject: string,
  options: { token?: string; search?: CourtSearch; signal?: AbortSignal } = {},
): Promise<SpectraPublicCourtCollection> {
  const name = subject.replace(/\s+/g, ' ').trim();
  const parts = name.split(' ');
  if (parts.length < 2 || parts.length > 5 || parts.some(part => !/^[\p{L}][\p{L}'’.-]*$/u.test(part))) {
    return { status: 'not_applicable', records: [] };
  }
  const token = options.token ?? process.env.COURTLISTENER_API_TOKEN;
  if (!token) return { status: 'unconfigured', records: [] };
  const endpoint = new URL('https://www.courtlistener.com/api/rest/v3/search/');
  endpoint.searchParams.set('type', 'r');
  endpoint.searchParams.set('q', `"${name}"`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await (options.search || defaultSearch)(endpoint, token, controller.signal);
    const results = response && typeof response === 'object'
      ? (response as { results?: unknown }).results : null;
    if (!Array.isArray(results)) return { status: 'failed', records: [] };
    const records: SpectraRetrievedEvidence[] = [];
    const first = parts[0].toLowerCase();
    const last = parts[parts.length - 1].toLowerCase();
    for (const value of results.slice(0, 12)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      const caseName = typeof item.caseName === 'string' ? item.caseName.slice(0, 350) : '';
      const caseWords: string[] = caseName.toLowerCase().match(/[\p{L}]+/gu) || [];
      if (!caseWords.includes(first) || !caseWords.includes(last)) continue;
      const url = docketUrl(item.docket_absolute_url ?? item.absolute_url);
      if (!url) continue;
      const date = typeof item.dateFiled === 'string' && Number.isFinite(Date.parse(item.dateFiled))
        ? new Date(item.dateFiled).toISOString() : undefined;
      const court = typeof item.court === 'string' ? item.court.slice(0, 200) : undefined;
      const docketNumber = typeof item.docketNumber === 'string' ? item.docketNumber.slice(0, 100) : undefined;
      const record = { caseName, court, docketNumber, dateFiled: date, docketUrl: url };
      records.push({
        url, requestedUrl: endpoint.toString(), title: `Public RECAP docket: ${caseName}`,
        retrievedAt: new Date().toISOString(), publishedAt: date,
        contentType: 'application/json', structuredRecord: record,
        textExcerpt: [caseName, court && `Court: ${court}`, docketNumber && `Docket: ${docketNumber}`]
          .filter(Boolean).join('. '),
        observations: [],
      });
      if (records.length >= 3) break;
    }
    return { status: records.length ? 'ok' : 'empty', records };
  } catch {
    return { status: 'failed', records: [] };
  } finally { clearTimeout(timer); }
}
