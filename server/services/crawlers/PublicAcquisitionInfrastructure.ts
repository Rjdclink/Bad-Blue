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

function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb') ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function allowedPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported acquisition protocol');
  if (isPrivateHost(url.hostname.toLowerCase())) throw new Error('Private-network acquisition is not permitted');
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
    let current = url;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetch(current, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'user-agent': 'LegalWhat-Pantheon/1.0 public-record research',
        accept: 'text/html,application/xhtml+xml,application/json,application/xml,text/xml,text/csv,text/plain;q=0.8,*/*;q=0.5',
      },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      current = allowedPublicUrl(new URL(location, current).toString());
    }
    if (!response) throw new Error('Public acquisition produced no response');
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
