import { URL } from 'url';

export type PublicAcquisitionKind = 'html' | 'json' | 'xml' | 'rss' | 'csv' | 'text';

export interface PublicAcquisitionResult {
  url: string;
  ok: boolean;
  status: number;
  kind: PublicAcquisitionKind;
  contentType: string;
  content: string;
  etag?: string;
  lastModified?: string;
  retrievedAt: string;
  error?: string;
}

function kindFor(contentType: string, url: string): PublicAcquisitionKind {
  const value = contentType.toLowerCase();
  if (value.includes('json') || url.endsWith('.json')) return 'json';
  if (value.includes('rss') || value.includes('atom')) return 'rss';
  if (value.includes('xml') || url.endsWith('.xml')) return 'xml';
  if (value.includes('csv') || url.endsWith('.csv')) return 'csv';
  if (value.includes('html')) return 'html';
  return 'text';
}

function allowedPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported acquisition protocol');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error('Private-network acquisition is not permitted');
  return url;
}

/**
 * First-class, credential-free public acquisition lane for Pantheon.
 * It intentionally handles only ordinary publicly retrievable resources; browser
 * rendering and specialized crawlers remain separate fallbacks.
 */
export async function acquirePublicResource(rawUrl: string, timeoutMs = 12_000): Promise<PublicAcquisitionResult> {
  const url = allowedPublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'LegalWhat-Pantheon/1.0 public-record research',
        accept: 'text/html,application/xhtml+xml,application/json,application/xml,text/xml,text/csv,text/plain;q=0.8,*/*;q=0.5',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const text = (await response.text()).slice(0, 2_000_000);
    return {
      url: response.url || url.toString(),
      ok: response.ok,
      status: response.status,
      kind: kindFor(contentType, response.url || url.toString()),
      contentType,
      content: text,
      etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      retrievedAt: new Date().toISOString(),
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      url: url.toString(),
      ok: false,
      status: 0,
      kind: kindFor('', url.toString()),
      contentType: '',
      content: '',
      retrievedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? 'Timed out' : (error?.message || String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function acquirePublicResources(urls: string[], timeoutMs?: number): Promise<PublicAcquisitionResult[]> {
  const unique = [...new Set(urls)].slice(0, 40);
  const settled = await Promise.allSettled(unique.map(url => acquirePublicResource(url, timeoutMs)));
  return settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : {
        url: unique[index],
        ok: false,
        status: 0,
        kind: 'text' as const,
        contentType: '',
        content: '',
        retrievedAt: new Date().toISOString(),
        error: result.reason?.message || String(result.reason),
      });
}
