import { discoveryFetch } from '../../lexara/DiscoveryDiagnostics';
import { load } from 'cheerio';
import { isIP } from 'node:net';
import { assertPublicUrl, type SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

export interface SpectraPublicMastodonCollection {
  records: SpectraRetrievedEvidence[];
  profileUrl?: string;
  status: 'not_supplied' | 'not_configured' | 'ok' | 'empty' | 'failed' | 'partial';
  reason?: 'invalid_configuration' | 'authorization_failed' | 'http_error' | 'invalid_response' | 'body_too_large' | 'timeout' | 'network_error';
}

export interface SpectraMastodonProfileCandidates {
  records: SpectraRetrievedEvidence[];
  status: 'skipped' | 'not_configured' | 'ok' | 'empty' | 'failed';
  reason?: SpectraPublicMastodonCollection['reason'];
}

const MAX_RESPONSE_BYTES = 900_000;
const MAX_STATUSES = 20;
const TIMEOUT_MS = 3_500;

function nameParts(value: string): string[] {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z]{2,}/g) || [];
}

/** Searches the configured instance only. Returned accounts are unverified candidates. */
export async function discoverSpectraPublicMastodonProfiles(
  name: string,
  options: {
    token?: string; instanceUrl?: string; fetchImpl?: typeof fetch; signal?: AbortSignal;
    validateOrigin?: typeof assertPublicUrl;
  } = {},
): Promise<SpectraMastodonProfileCandidates> {
  const parts = nameParts(name);
  if (parts.length < 2 || parts.length > 6 || name.length > 120) {
    return { records: [], status: 'skipped' };
  }
  const token = (options.token ?? process.env.SPECTRA_MASTODON_ACCESS_TOKEN ?? '').trim();
  const instance = (options.instanceUrl ?? process.env.SPECTRA_MASTODON_INSTANCE_URL ?? '').trim();
  if (!token || !instance) return { records: [], status: 'not_configured' };
  let origin: URL;
  try {
    origin = new URL(instance);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
      || origin.port || origin.username || origin.password || isIP(origin.hostname)
      || !origin.hostname.includes('.')) throw new Error('invalid_configuration');
    await (options.validateOrigin || assertPublicUrl)(origin.toString());
  } catch {
    return { records: [], status: 'failed', reason: 'invalid_configuration' };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  timer.unref?.();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) throw new Error('timeout');
    const endpoint = new URL('/api/v1/accounts/search', origin);
    endpoint.searchParams.set('q', `${parts[0]} ${parts[parts.length - 1]}`);
    endpoint.searchParams.set('limit', '20');
    endpoint.searchParams.set('resolve', 'false');
    const accounts = await boundedJson(endpoint, token, options.fetchImpl || fetch, controller.signal);
    if (!Array.isArray(accounts)) throw new Error('invalid_response');
    const retrievedAt = new Date().toISOString();
    const records: SpectraRetrievedEvidence[] = [];
    const seen = new Set<string>();
    for (const raw of accounts.slice(0, 20)) {
      const account = object(raw);
      const displayParts = nameParts(String(account?.display_name || ''));
      const profile = suppliedMastodonProfile(String(account?.url || ''));
      if (!profile || !displayParts.includes(parts[0])
        || !displayParts.includes(parts[parts.length - 1])
        || seen.has(profile.url)) continue;
      seen.add(profile.url);
      records.push({
        url: profile.url, requestedUrl: profile.url, retrievedAt,
        contentType: 'application/json', title: 'Possible public Mastodon profile',
        textExcerpt: load(String(account?.note || '')).text().replace(/\s+/g, ' ').trim().slice(0, 4_000),
        structuredRecord: account, observations: [],
      });
      if (records.length >= 3) break;
    }
    return { records, status: records.length ? 'ok' : 'empty' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = timedOut || controller.signal.aborted ? 'timeout'
      : ['authorization_failed', 'http_error', 'invalid_response', 'body_too_large'].includes(message)
        ? message as SpectraPublicMastodonCollection['reason'] : 'network_error';
    return { records: [], status: 'failed', reason };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Mastodon profile links are clues, never proof of account ownership. */
export function suppliedMastodonProfile(input: string): { account: string; url: string } | null {
  const match = /https:\/\/([a-z0-9.-]+)\/@([a-z0-9_]{1,30})(?=[/?#\s),;]|$)/i.exec(input.slice(0, 13_000));
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!host.includes('.') || host.length > 253 || host.split('.').some(label =>
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
  const username = match[2];
  return { account: `${username}@${host}`, url: `https://${host}/@${username}` };
}

function object(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : null;
}

async function boundedJson(url: URL, token: string | null, fetchImpl: typeof fetch, signal: AbortSignal): Promise<unknown> {
  // Never forward credentials to a supplied profile URL or follow a redirect.
  const response = await discoveryFetch(fetchImpl, url, {
    method: 'GET', redirect: 'manual', signal,
    headers: {
      Accept: 'application/json', 'User-Agent': 'LegalWhat-SPECTRA/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok || response.status >= 300) {
    throw new Error(token && (response.status === 401 || response.status === 403)
      ? 'authorization_failed' : 'http_error');
  }
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error('invalid_response');
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error('body_too_large');
  if (!response.body) throw new Error('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('body_too_large');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new Error('invalid_response'); }
}

export async function collectSpectraPublicMastodonRecords(
  input: string,
  options: {
    token?: string; instanceUrl?: string; fetchImpl?: typeof fetch; signal?: AbortSignal;
    validateOrigin?: typeof assertPublicUrl;
  } = {},
): Promise<SpectraPublicMastodonCollection> {
  const profile = suppliedMastodonProfile(input);
  if (!profile) return { records: [], status: 'not_supplied' };
  const token = (options.token ?? process.env.SPECTRA_MASTODON_ACCESS_TOKEN ?? '').trim();
  const instance = (options.instanceUrl ?? process.env.SPECTRA_MASTODON_INSTANCE_URL ?? '').trim();
  if (!token || !instance) return { records: [], status: 'not_configured', profileUrl: profile.url };
  let origin: URL;
  try {
    origin = new URL(instance);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
      || origin.port || origin.username || origin.password || isIP(origin.hostname)
      || !origin.hostname.includes('.')) {
      throw new Error('invalid_configuration');
    }
    // An operator-configured origin still passes the existing public-URL guard.
    await (options.validateOrigin || assertPublicUrl)(origin.toString());
  } catch {
    return { records: [], status: 'failed', reason: 'invalid_configuration', profileUrl: profile.url };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  timer.unref?.();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const records: SpectraRetrievedEvidence[] = [];
  try {
    if (options.signal?.aborted) throw new Error('timeout');
    const lookup = new URL('/api/v1/accounts/lookup', origin);
    lookup.searchParams.set('acct', profile.account);
    const account = object(await boundedJson(lookup, token, options.fetchImpl || fetch, controller.signal));
    const id = String(account?.id || '');
    const accountUrl = typeof account?.url === 'string' ? account.url.replace(/\/$/, '') : '';
    if (!/^\d{1,30}$/.test(id) || accountUrl.toLowerCase() !== profile.url.toLowerCase()) {
      throw new Error('invalid_response');
    }
    records.push({
      url: profile.url, requestedUrl: profile.url, retrievedAt: new Date().toISOString(),
      contentType: 'application/json', title: 'Public Mastodon profile',
      textExcerpt: load(String(account?.note || '')).text().replace(/\s+/g, ' ').trim().slice(0, 4_000),
      structuredRecord: account, observations: [],
    });
    const statusesEndpoint = new URL(`/api/v1/accounts/${id}/statuses`, origin);
    statusesEndpoint.searchParams.set('limit', String(MAX_STATUSES));
    statusesEndpoint.searchParams.set('exclude_reblogs', 'true');
    const statuses = await boundedJson(statusesEndpoint, null, options.fetchImpl || fetch, controller.signal);
    if (!Array.isArray(statuses)) throw new Error('invalid_response');
    const retrievedAt = new Date().toISOString();
    for (const raw of statuses.slice(0, MAX_STATUSES)) {
      const status = object(raw);
      if (!status || status.visibility !== 'public' || status.reblog
        || String(object(status.account)?.id || '') !== id) continue;
      const publishedMs = Date.parse(String(status.created_at || ''));
      if (!Number.isFinite(publishedMs) || publishedMs > Date.now() + 86_400_000) continue;
      let canonical: URL;
      try { canonical = new URL(String(status.url || '')); }
      catch { continue; }
      if (canonical.protocol !== 'https:' || canonical.username || canonical.password
        || canonical.origin !== new URL(profile.url).origin) continue;
      const excerpt = load(String(status.content || '')).text().replace(/\s+/g, ' ').trim().slice(0, 4_000);
      records.push({
        url: canonical.toString(), requestedUrl: canonical.toString(), retrievedAt,
        publishedAt: new Date(publishedMs).toISOString(), title: 'Public Mastodon status',
        textExcerpt: excerpt, contentType: 'application/json',
        structuredRecord: status, observations: [],
      });
    }
    return { records, status: records.length > 1 ? 'ok' : 'partial', profileUrl: profile.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = timedOut || controller.signal.aborted ? 'timeout'
      : ['authorization_failed', 'http_error', 'invalid_response', 'body_too_large'].includes(message)
        ? message as SpectraPublicMastodonCollection['reason'] : 'network_error';
    return { records, status: records.length ? 'partial' : 'failed', reason, profileUrl: profile.url };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
