import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';
import { discoveryFetch, discoverySignal } from '../../lexara/DiscoveryDiagnostics';

/**
 * X's documented Post lookup supplies media expansion only for a post that
 * Spectra has already retrieved. This is not a search API or a way to access
 * protected accounts. API responses are leads; image bytes must still pass the
 * existing public-image retrieval and provenance checks.
 */
export interface SpectraXMediaLookup {
  posts: SpectraRetrievedEvidence[];
  attempted: number;
  retrieved: number;
  failed: number;
  status: 'unconfigured' | 'complete' | 'partial';
}

const MAX_POSTS = 4;
const MAX_MEDIA_PER_POST = 4;
const MAX_JSON_BYTES = 300_000;
const TIMEOUT_MS = 3_500;

export function spectraXPostId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']
      .includes(url.hostname.toLowerCase())) return null;
    const match = /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d{5,20})\/?$/.exec(url.pathname);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function validPhotoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2_200) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      ? url.toString() : null;
  } catch {
    return null;
  }
}

async function boundedJson(response: Response): Promise<any | null> {
  if (!response.ok || !response.body
    || !/\bjson\b/i.test(response.headers.get('content-type') || '')
    || Number(response.headers.get('content-length') || 0) > MAX_JSON_BYTES) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) return null;
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(data)); } catch { return null; }
}

function publishedTime(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > Date.UTC(2000, 0, 1) && ms <= Date.now() + 300_000
    ? new Date(ms).toISOString() : undefined;
}

export async function collectSpectraXPostMedia(
  retrievedPages: readonly SpectraRetrievedEvidence[],
  options: { token?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraXMediaLookup> {
  const token = (options.token ?? process.env.SPECTRA_X_BEARER_TOKEN ?? '').trim();
  const requestSignal = discoverySignal(options.signal);
  if (!token) return { posts: [], attempted: 0, retrieved: 0, failed: 0, status: 'unconfigured' };

  // Input MUST be a successfully retrieved post, never a search-result URL.
  const selected = new Map<string, SpectraRetrievedEvidence>();
  for (const page of retrievedPages.slice(0, 100)) {
    if (!page || typeof page.retrievedAt !== 'string' || !Number.isFinite(Date.parse(page.retrievedAt))) continue;
    const id = spectraXPostId(page.url);
    if (id && !selected.has(id)) selected.set(id, page);
    if (selected.size >= MAX_POSTS) break;
  }

  const resolved = new Map<string, SpectraRetrievedEvidence>();
  let attempted = 0, failed = 0;
  const acquirePost = async ([id, page]: [string, SpectraRetrievedEvidence]): Promise<void> => {
    if (requestSignal?.aborted) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    requestSignal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, TIMEOUT_MS);
    timer.unref?.();
    attempted++;
    try {
      // Fixed official host prevents user-supplied URLs from receiving the token.
      const endpoint = new URL('https://api.x.com/2/tweets/' + id);
      endpoint.searchParams.set('expansions', 'attachments.media_keys');
      endpoint.searchParams.set('media.fields', 'media_key,type,url');
      endpoint.searchParams.set('tweet.fields', 'created_at');
      const response = await discoveryFetch(options.fetchImpl || fetch, endpoint, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      });
      if (controller.signal.aborted || requestSignal?.aborted) return;
      const payload = await boundedJson(response);
      // A cancelled/closed investigation must not admit a late API response.
      if (controller.signal.aborted || requestSignal?.aborted) return;
      if (!payload || String(payload?.data?.id || '') !== id) { failed++; return; }
      const keys = new Set(
        Array.isArray(payload.data.attachments?.media_keys)
          ? payload.data.attachments.media_keys.filter((value: unknown): value is string =>
            typeof value === 'string').slice(0, 16) : [],
      );
      const urls = Array.isArray(payload.includes?.media)
        ? [...new Set(payload.includes.media
          .filter((media: any) => media?.type === 'photo' && keys.has(media?.media_key))
          .map((media: any) => validPhotoUrl(media.url))
          .filter((url: string | null): url is string => url !== null))].slice(0, MAX_MEDIA_PER_POST)
        : [];
      resolved.set(id, {
        ...page,
        // The original retrieved post remains the evidence. The API expansion
        // only contributes verified photo URLs, not new subject observations.
        publicImageUrls: [...new Set([...urls, ...(page.publicImageUrls || [])])].slice(0, 8),
        publishedAt: page.publishedAt || publishedTime(payload.data.created_at),
      });
    } catch {
      failed++;
    } finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener('abort', cancel);
    }
  };
  // At most two X requests in flight; results retain their original post order.
  const entries = [...selected.entries()];
  for (let index = 0; index < entries.length; index += 2) {
    await Promise.all(entries.slice(index, index + 2).map(acquirePost));
  }
  const posts: SpectraRetrievedEvidence[] = entries.flatMap(([id]) => {
    const found = resolved.get(id);
    return found ? [found] : [];
  });
  return {
    posts,
    attempted,
    retrieved: posts.length,
    failed,
    status: failed || (requestSignal?.aborted && posts.length < selected.size) ? 'partial' : 'complete',
  };
}
