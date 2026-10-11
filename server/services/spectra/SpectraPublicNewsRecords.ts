import { retrieveSpectraPublicEvidence, type SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

/** GDELT supplies article leads; only successfully retrieved articles are evidence. */
export interface SpectraPublicNewsCollection {
  records: SpectraRetrievedEvidence[];
  status: 'not_applicable' | 'ok' | 'empty' | 'failed' | 'partial';
  articleLeads: number;
}

function articleUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

export async function collectSpectraPublicNewsRecords(
  subject: string,
  options: {
    signal?: AbortSignal;
    retrieve?: typeof retrieveSpectraPublicEvidence;
  } = {},
): Promise<SpectraPublicNewsCollection> {
  const name = subject.replace(/\s+/g, ' ').trim();
  const tokens = name.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5
    || tokens.some(token => !/^[\p{L}][\p{L}'’.-]*$/u.test(token))) {
    return { status: 'not_applicable', articleLeads: 0, records: [] };
  }
  const endpoint = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  endpoint.searchParams.set('query', `"${name}"`);
  endpoint.searchParams.set('mode', 'artlist');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('timespan', '3m');
  endpoint.searchParams.set('sort', 'datedesc');
  endpoint.searchParams.set('maxrecords', '10');
  const retrieve = options.retrieve || retrieveSpectraPublicEvidence;
  const [index] = await retrieve([endpoint.toString()], options.signal).catch(() => []);
  const raw = index?.structuredRecord;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'failed', articleLeads: 0, records: [] };
  }
  const articles = (raw as Record<string, unknown>).articles;
  if (!Array.isArray(articles)) return { status: 'empty', articleLeads: 0, records: [] };
  const urls = [...new Set(articles.slice(0, 10).map(item =>
    articleUrl(item && typeof item === 'object' ? (item as { url?: unknown }).url : null)
  ).filter((url): url is string => Boolean(url)))].slice(0, 3);
  if (!urls.length) return { status: 'empty', articleLeads: 0, records: [] };
  const records = await retrieve(urls, options.signal).catch(() => []);
  return {
    records,
    articleLeads: urls.length,
    status: records.length === urls.length ? 'ok' : records.length ? 'partial' : 'failed',
  };
}
