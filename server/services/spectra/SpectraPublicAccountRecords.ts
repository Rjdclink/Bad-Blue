import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

/** Public posts from an explicitly supplied Bluesky profile; no account login or API key. */
export interface SpectraPublicAccountCollection {
  records: SpectraRetrievedEvidence[];
  status: 'not_supplied' | 'ok' | 'empty' | 'failed' | 'partial';
  reason?: 'invalid_profile' | 'http_error' | 'invalid_response' | 'body_too_large' | 'timeout' | 'network_error';
  profileUrl?: string;
}

export interface SpectraPublicProfileCandidates {
  records: SpectraRetrievedEvidence[];
  status: 'skipped' | 'ok' | 'empty' | 'failed';
  reason?: SpectraPublicAccountCollection['reason'];
}

const API_ORIGIN = 'https://public.api.bsky.app';
const PROFILE_RE = /https:\/\/bsky\.app\/profile\/([a-z0-9][a-z0-9.-]{1,250})(?=[/?#\s),;]|$)/ig;
const MAX_BYTES = 900_000;
const MAX_POSTS = 40;
const TIMEOUT_MS = 3_500;

function nameParts(value: string): string[] {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z]{2,}/g) || [];
}

/** A name match is a candidate, never proof that the account belongs to the subject. */
export async function discoverSpectraPublicBlueskyProfiles(
  name: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraPublicProfileCandidates> {
  const parts = nameParts(name);
  if (parts.length < 2 || parts.length > 6 || name.length > 120) {
    return { records: [], status: 'skipped' };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  timer.unref?.();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('timeout');
    const endpoint = new URL('/xrpc/app.bsky.actor.searchActors', API_ORIGIN);
    // Middle names are often omitted from public display names. Query the
    // first and last names, then retain only records matching both.
    endpoint.searchParams.set('q', `${parts[0]} ${parts[parts.length - 1]}`);
    endpoint.searchParams.set('limit', '20');
    const response = await boundedJson(endpoint, options.fetchImpl || fetch, controller.signal);
    if (!Array.isArray(response.actors)) throw new Error('invalid_response');
    const retrievedAt = new Date().toISOString();
    const records: SpectraRetrievedEvidence[] = [];
    const seen = new Set<string>();
    for (const raw of response.actors.slice(0, 20)) {
      const actor = object(raw);
      const did = String(actor?.did || '');
      const handle = String(actor?.handle || '').toLowerCase();
      const displayParts = nameParts(String(actor?.displayName || ''));
      if ((!/^did:plc:[a-z2-7]{24}$/.test(did) && !/^did:web:[a-z0-9.:%-]{1,250}$/i.test(did))
        || !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62}$/.test(handle)
        || !displayParts.includes(parts[0]) || !displayParts.includes(parts[parts.length - 1])
        || seen.has(did)) continue;
      seen.add(did);
      const url = `https://bsky.app/profile/${handle}`;
      records.push({
        url, requestedUrl: url, retrievedAt, contentType: 'application/json',
        title: 'Possible public Bluesky profile',
        textExcerpt: typeof actor?.description === 'string' ? actor.description.slice(0, 4_000) : undefined,
        structuredRecord: actor, observations: [],
      });
      if (records.length >= 3) break;
    }
    return { records, status: records.length ? 'ok' : 'empty' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = timedOut || controller.signal.aborted ? 'timeout'
      : ['http_error', 'invalid_response', 'body_too_large'].includes(message)
        ? message as SpectraPublicAccountCollection['reason'] : 'network_error';
    return { records: [], status: 'failed', reason };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : null;
}

function sourceDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 86_400_000
    ? date.toISOString() : undefined;
}

export function suppliedBlueskyProfile(input: string): { handle: string; url: string } | null {
  PROFILE_RE.lastIndex = 0;
  const match = PROFILE_RE.exec(input.slice(0, 13_000));
  if (!match) return null;
  const handle = match[1].toLowerCase();
  if (!/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62}$/.test(handle)) return null;
  return { handle, url: `https://bsky.app/profile/${handle}` };
}

async function boundedJson(url: URL, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Record<string, any>> {
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'manual', signal,
    headers: { Accept: 'application/json', 'User-Agent': 'LegalWhat-SPECTRA/1.0' },
  });
  if (!response.ok || response.status >= 300) throw new Error('http_error');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('body_too_large');
  if (!/^application\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error('invalid_response');
  }
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('body_too_large');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed = object(JSON.parse(new TextDecoder().decode(bytes)));
    if (parsed && !parsed.error) return parsed;
  } catch { /* fall through */ }
  throw new Error('invalid_response');
}

export async function collectSpectraPublicAccountRecords(
  input: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraPublicAccountCollection> {
  const profile = suppliedBlueskyProfile(input);
  if (!profile) return { records: [], status: 'not_supplied' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  timer.unref?.();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const records: SpectraRetrievedEvidence[] = [];
  try {
    if (options.signal?.aborted) throw new Error('timeout');
    const profileEndpoint = new URL('/xrpc/app.bsky.actor.getProfile', API_ORIGIN);
    profileEndpoint.searchParams.set('actor', profile.handle);
    const actor = await boundedJson(profileEndpoint, options.fetchImpl || fetch, controller.signal);
    const did = String(actor.did || '');
    if ((!/^did:plc:[a-z2-7]{24}$/.test(did) && !/^did:web:[a-z0-9.:%-]{1,250}$/i.test(did))
      || String(actor.handle || '').toLowerCase() !== profile.handle) {
      throw new Error('invalid_response');
    }
    records.push({
      url: profile.url, requestedUrl: profile.url, retrievedAt: new Date().toISOString(),
      contentType: 'application/json', title: 'Public Bluesky profile',
      textExcerpt: typeof actor.description === 'string' ? actor.description.slice(0, 4_000) : undefined,
      structuredRecord: actor, observations: [],
    });
    const feedEndpoint = new URL('/xrpc/app.bsky.feed.getAuthorFeed', API_ORIGIN);
    feedEndpoint.searchParams.set('actor', did);
    feedEndpoint.searchParams.set('filter', 'posts_no_replies');
    feedEndpoint.searchParams.set('limit', String(MAX_POSTS));
    const feed = await boundedJson(feedEndpoint, options.fetchImpl || fetch, controller.signal);
    if (!Array.isArray(feed.feed)) throw new Error('invalid_response');

    const retrievedAt = new Date().toISOString();
    for (const entry of feed.feed.slice(0, MAX_POSTS)) {
      const post = object(object(entry)?.post);
      const content = object(post?.record);
      const uri = String(post?.uri || '');
      const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9]+)$/.exec(uri);
      if (!post || !content || post.author?.did !== did || match?.[1] !== did
        || content.$type !== 'app.bsky.feed.post') continue;
      const date = sourceDate(content.createdAt);
      if (!date) continue;
      const sourceUrl = `https://bsky.app/profile/${did}/post/${match[2]}`;
      records.push({
        url: sourceUrl,
        requestedUrl: sourceUrl,
        retrievedAt,
        publishedAt: date,
        contentType: 'application/json',
        title: 'Public Bluesky post',
        textExcerpt: typeof content.text === 'string' ? content.text.slice(0, 4_000) : undefined,
        // The public feed view includes resolved image URLs and alt text in
        // addition to the post record's blob references. Retain the view as
        // source metadata without claiming the image bytes were downloaded.
        structuredRecord: {
          uri, cid: post.cid, author: { did, handle: post.author.handle },
          record: content, embed: object(post.embed) || undefined,
        },
        observations: [], // Place mentions are not measured positions of the account owner.
      });
    }
    return { records, status: records.length > 1 ? 'ok' : 'partial', profileUrl: profile.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = timedOut || controller.signal.aborted ? 'timeout'
      : ['http_error', 'invalid_response', 'body_too_large'].includes(message)
        ? message as SpectraPublicAccountCollection['reason'] : 'network_error';
    return { records, status: records.length ? 'partial' : 'failed', reason, profileUrl: profile.url };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
