import { discoveryFetch } from '../../lexara/DiscoveryDiagnostics';

const MAX_JSON_BYTES = 2_000_000;

export function configuredSpectraEndpoint(value: string | undefined): URL | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url;
    if (
      url.protocol === 'http:'
      && url.hostname.toLowerCase().endsWith('.railway.internal')
    ) return url;
    return null;
  } catch {
    return null;
  }
}

export function joinSpectraEndpoint(base: URL, path: string): URL {
  const root = new URL(base.toString());
  root.pathname = root.pathname.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
  root.search = '';
  root.hash = '';
  return root;
}

export async function readSpectraJsonResponse(response: Response): Promise<any> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new SyntaxError('Provider response exceeded the JSON size limit.');
  }

  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_JSON_BYTES) {
        throw new SyntaxError('Provider response exceeded the JSON size limit.');
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    return bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function fetchSpectraConfiguredJson(
  url: URL,
  init: RequestInit,
  timeoutMs = 7_000,
): Promise<any> {
  const response = await discoveryFetch(fetch, url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(15_000, timeoutMs))),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`Configured provider returned HTTP ${response.status}.`);
  }
  return readSpectraJsonResponse(response);
}

export function bearerHeader(token: string | undefined): Record<string, string> {
  const value = String(token || '').trim();
  if (!value) return {};
  return {
    Authorization: /^(?:Bearer|Basic)\s+/i.test(value) ? value : `Bearer ${value}`,
  };
}

export function basicHeader(
  username: string | undefined,
  password: string | undefined,
): Record<string, string> {
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`,
  };
}
