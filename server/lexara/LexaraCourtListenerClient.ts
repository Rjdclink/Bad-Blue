import { createHash } from 'node:crypto';

// Public archived records, never user questions or generated legal conclusions.
// This cache is process-local, bounded, and isolated when the existing key changes.
const MAX_ENTRIES = 100;
const MAX_CACHE_BYTES = 8_000_000;
const SEARCH_TTL_MS = 3 * 60_000;
const DOCUMENT_TTL_MS = 15 * 60_000;
const cache = new Map<string, { value: any; expires: number; bytes: number }>();
const pending = new Map<string, { promise: Promise<any | null>; controller: AbortController; users: number }>();
let credential = '';
let cacheBytes = 0;
let blockedUntil = 0;

function clearCache() { cache.clear(); cacheBytes = 0; }

/** GET only: existing API credential, no paid PACER endpoints and no retries. */
export async function lexaraCourtListenerJson(path: string, signal?: AbortSignal): Promise<any | null> {
  const token = process.env.COURTLISTENER_API_TOKEN?.trim();
  if (!token || signal?.aborted || !/^(?:search\/\?|recap-documents\/\d+\/|opinions\/\d+\/)/.test(path)) return null;
  const fingerprint = createHash('sha256').update(token).digest('hex');
  if (fingerprint !== credential) {
    for (const request of pending.values()) request.controller.abort();
    pending.clear(); clearCache(); blockedUntil = 0; credential = fingerprint;
  }
  const url = new URL(path, 'https://www.courtlistener.com/api/rest/v4/');
  url.searchParams.sort();
  const key = url.pathname + url.search;
  const endpoint = path.split('?')[0];
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) {
    cache.delete(key); cache.set(key, saved);
    console.info('[LEXARA CourtCache]', { endpoint, outcome: 'hit' });
    return saved.value;
  }
  if (saved) { cache.delete(key); cacheBytes -= saved.bytes; }
  if (blockedUntil > Date.now()) {
    console.info('[LEXARA CourtCache]', { endpoint, outcome: 'cooldown', retryAfterSeconds: Math.ceil((blockedUntil - Date.now()) / 1000) });
    return null;
  }
  let request = pending.get(key);
  if (request) console.info('[LEXARA CourtCache]', { endpoint, outcome: 'shared' });
  else {
    const controller = new AbortController();
    request = { controller, users: 0, promise: Promise.resolve(null) };
    const entry = request;
    request.promise = Promise.resolve().then(async () => {
      const timer = setTimeout(() => controller.abort(), 2_000);
      try {
        const response = await fetch(url, { headers: { Authorization: `Token ${token}`, Accept: 'application/json' }, signal: controller.signal });
        console.info('[LEXARA CourtCache]', { endpoint, outcome: 'network', status: response.status });
        if (!response.ok) {
          if (credential === fingerprint && response.status === 429) {
            const retry = response.headers.get('retry-after');
            const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : NaN;
            const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : retry ? Date.parse(retry) : NaN;
            // Honor the full window, including hour/day limits. Do not retry here.
            blockedUntil = Math.max(blockedUntil, Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60_000);
          } else if (credential === fingerprint && [401, 403].includes(response.status)) {
            clearCache(); blockedUntil = Date.now() + 60_000;
          }
          return null;
        }
        const text = await response.text();
        if (text.length > MAX_CACHE_BYTES || controller.signal.aborted) return null;
        const value = JSON.parse(text);
        const id = Number(url.pathname.match(/\/(?:recap-documents|opinions)\/(\d+)\//)?.[1]);
        const valid = endpoint === 'search/' ? Array.isArray(value?.results) : Number(value?.id) === id;
        if (!valid || credential !== fingerprint) return null;
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes <= MAX_CACHE_BYTES) {
          while (cache.size >= MAX_ENTRIES || cacheBytes + bytes > MAX_CACHE_BYTES) {
            const oldest = cache.keys().next().value;
            if (!oldest) break;
            cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
          }
          cache.set(key, { value, bytes, expires: Date.now() + (endpoint === 'search/' ? SEARCH_TTL_MS : DOCUMENT_TTL_MS) });
          cacheBytes += bytes;
        }
        return value;
      } catch { return null; }
      finally { clearTimeout(timer); if (pending.get(key) === entry) pending.delete(key); }
    });
    pending.set(key, request);
  }
  const entry = request;
  entry.users++;
  return new Promise(resolve => {
    let finished = false;
    const finish = (value: any | null) => {
      if (finished) return;
      finished = true; signal?.removeEventListener('abort', abort);
      entry.users--;
      if (!entry.users && pending.get(key) === entry) {
        pending.delete(key); entry.controller.abort();
      }
      resolve(value);
    };
    const abort = () => finish(null);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    entry.promise.then(value => finish(signal?.aborted ? null : value), () => finish(null));
  });
}
