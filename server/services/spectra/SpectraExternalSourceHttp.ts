import { discoveryFetch } from '../../lexara/DiscoveryDiagnostics';

const MAX_JSON_BYTES = 2_000_000;

/** Missing JSON numbers are not zero-valued measurements. */
export function spectraFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export type SpectraConfiguredProviderErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'quota'
  | 'rate-limit'
  | 'client'
  | 'upstream'
  | 'network'
  | 'invalid-response';

export class SpectraConfiguredProviderError extends Error {
  constructor(
    message: string,
    public readonly category: SpectraConfiguredProviderErrorCategory,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SpectraConfiguredProviderError';
  }
}

function configuredProviderCategory(status: number): SpectraConfiguredProviderErrorCategory {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if ([402, 432, 433].includes(status)) return 'quota';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'upstream';
  return 'client';
}

function transientConfiguredProviderError(error: unknown): boolean {
  if (error instanceof SpectraConfiguredProviderError) {
    return error.category === 'upstream' || error.category === 'network'
      || error.category === 'invalid-response';
  }
  const seen = new Set<unknown>();
  let candidate: any = error;
  for (let depth = 0; candidate && depth < 5 && !seen.has(candidate); depth += 1) {
    seen.add(candidate);
    if (
      candidate.name === 'TimeoutError'
      || candidate.name === 'SyntaxError'
      || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
        'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']
        .includes(String(candidate.code || ''))
    ) return true;
    candidate = candidate.cause;
  }
  return false;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

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
  maxAttempts = 2,
): Promise<any> {
  const boundedTimeout = Math.max(1_000, Math.min(15_000, timeoutMs));
  const attemptLimit = Math.max(1, Math.min(2, Math.floor(maxAttempts)));
  let lastError: unknown;

  // At most two attempts. Permanent client/auth/quota/rate-limit responses are
  // never retried; transient network, 5xx and malformed-response failures get
  // one bounded recovery attempt and then the caller skips this source.
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    try {
      const response = await discoveryFetch(fetch, url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(boundedTimeout),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        const error = new SpectraConfiguredProviderError(
          `Configured provider returned HTTP ${response.status}.`,
          configuredProviderCategory(response.status),
          response.status,
        );
        if (!transientConfiguredProviderError(error) || attempt === attemptLimit - 1) throw error;
        lastError = error;
      } else {
        try {
          return await readSpectraJsonResponse(response);
        } catch (error) {
          const normalized = error instanceof SpectraConfiguredProviderError
            ? error
            : new SpectraConfiguredProviderError(
                'Configured provider returned invalid JSON.',
                'invalid-response',
              );
          if (attempt === attemptLimit - 1) throw normalized;
          lastError = normalized;
        }
      }
    } catch (error) {
      const normalized = error instanceof SpectraConfiguredProviderError
        ? error
        : new SpectraConfiguredProviderError(
            'Configured provider request failed.',
            'network',
          );
      if (!transientConfiguredProviderError(normalized) || attempt === attemptLimit - 1) throw normalized;
      lastError = normalized;
    }
    await sleep(150);
  }

  throw lastError instanceof Error
    ? lastError
    : new SpectraConfiguredProviderError(
        'Configured provider request failed.',
        'network',
      );
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
