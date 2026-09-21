import { URL } from 'url';
import { promises as dns } from 'dns';
import { isIP } from 'net';

export type PublicAcquisitionKind = 'html' | 'json' | 'xml' | 'rss' | 'csv' | 'text';

export interface PantheonAcquisitionAuthority {
  investigationId: string;
  categoryId: string;
  workId: string;
  capability: string;
  deadlineAt: number;
}

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
  errorType?: 'rate_limited'|'forbidden'|'not_found'|'dns_failure'|'tls_failure'|'timeout'|'invalid_url'|'unsupported_content'|'circuit_open'|'network_failure'|'http_error';
  retryAfterMs?: number;
}

interface HostState {
  active: number;
  nextAllowedAt: number;
  consecutiveFailures: number;
  circuitOpenUntil: number;
  latencyEwmaMs: number;
  forbiddenUntil: number;
  notFoundCount: number;
  rateLimitedCount: number;
}

const hostStates = new Map<string, HostState>();
const inflight = new Map<string, Promise<PublicAcquisitionResult>>();
const recent = new Map<string, { at: number; value: PublicAcquisitionResult }>();
const RECENT_TTL_MS = 30_000;
const MAX_PER_HOST = 2;
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 12_000;
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_OPEN_MS = 30_000;

const BLOCKED_EXTENSIONS = /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|svg|ico|mp[34]|m4[av]|avi|mov|webm|zip|gz|rar|7z|exe|dmg|apk)(?:$|[?#])/i;
const BLOCKED_HOST_HINTS = /(?:googletagmanager|google-analytics|doubleclick|newrelic|addthis|chartbeat|optimizely|tinypass|fonts\.googleapis|fonts\.gstatic|static\.files\.bbci|m\.files\.bbci|assets\.guim|static\.guim|i\.guim|j\.ophan)/i;

function stateFor(host: string): HostState {
  let state = hostStates.get(host);
  if (!state) {
    state = { active: 0, nextAllowedAt: 0, consecutiveFailures: 0, circuitOpenUntil: 0, latencyEwmaMs: 0, forbiddenUntil: 0, notFoundCount: 0, rateLimitedCount: 0 };
    hostStates.set(host, state);
  }
  return state;
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
  return normalized === 'localhost' || normalized.endsWith('.localhost') ||
    normalized === '0.0.0.0' || normalized === '::1' || normalized === '::' ||
    normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    normalized.startsWith('::ffff:169.254.') || normalized.startsWith('fc') || normalized.startsWith('fd') ||
    normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') ||
    /^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

async function assertPublicResolution(url: URL): Promise<void> {
  if (isIP(url.hostname)) {
    if (isPrivateHost(url.hostname)) throw new Error('Private-network acquisition is not permitted');
    return;
  }
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('Public acquisition hostname did not resolve');
  if (records.some(record => isPrivateHost(record.address))) throw new Error('Public acquisition hostname resolves to a private network');
}

export function admitPantheonUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  try {
    return { ok: true, url: canonicalPublicUrl(raw).toString() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function canonicalPublicUrl(raw: string): URL {
  const cleaned = String(raw || '').trim().replace(/[),.;]+$/, '');
  const url = new URL(cleaned);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported acquisition protocol');
  if (isPrivateHost(url.hostname)) throw new Error('Private-network acquisition is not permitted');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  if (BLOCKED_EXTENSIONS.test(url.pathname) || BLOCKED_HOST_HINTS.test(url.hostname)) {
    throw new Error('Non-investigative resource is not eligible for acquisition');
  }
  return url;
}

function blockedResponseBody(value: string): boolean {
  const lowered = value.toLowerCase();
  return ['our systems have detected unusual traffic','captcha','verify you are human','access denied','enable javascript on your web browser'].some(marker => lowered.includes(marker));
}

function supportedContentType(value: string): boolean {
  const type = value.toLowerCase();
  if (!type) return true;
  return /(?:text\/|json|xml|rss|atom|csv|pdf)/i.test(type) &&
    !/(?:javascript|css|font|image\/|audio\/|video\/)/i.test(type);
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function classify(status: number, error?: unknown): PublicAcquisitionResult['errorType'] {
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  const message = error instanceof Error ? error.message : String(error || '');
  if (/ENOTFOUND|EAI_AGAIN|hostname did not resolve/i.test(message)) return 'dns_failure';
  if (/TLS|SSL|secure.*connection|ECONNRESET/i.test(message)) return 'tls_failure';
  if (/abort|timed out|timeout/i.test(message)) return 'timeout';
  if (/invalid|unsupported acquisition|eligible for acquisition/i.test(message)) return 'invalid_url';
  return status > 0 ? 'http_error' : 'network_failure';
}

function failureResult(url: string, status: number, error: unknown, retryMs?: number): PublicAcquisitionResult {
  const message = error instanceof Error ? error.message : String(error || (status ? `HTTP ${status}` : 'Acquisition failed'));
  return {
    url, ok: false, status, kind: kindFor('', url), contentType: '', content: '',
    retrievedAt: new Date().toISOString(), error: message, errorType: classify(status, error), retryAfterMs: retryMs,
  };
}

async function waitForHost(host: string, deadlineAt: number): Promise<boolean> {
  const state = stateFor(host);
  while (Date.now() < deadlineAt) {
    if (state.circuitOpenUntil > Date.now() || state.forbiddenUntil > Date.now()) return false;
    if (state.active < MAX_PER_HOST && state.nextAllowedAt <= Date.now()) {
      state.active += 1;
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(150, Math.max(20, deadlineAt - Date.now()))));
  }
  return false;
}

function releaseHost(host: string): void {
  const state = stateFor(host);
  state.active = Math.max(0, state.active - 1);
}

function recordHostResult(host: string, status: number, latencyMs: number, retryMs?: number): void {
  const state = stateFor(host);
  state.latencyEwmaMs = state.latencyEwmaMs ? (state.latencyEwmaMs * 0.7 + latencyMs * 0.3) : latencyMs;
  if (status >= 200 && status < 400) {
    state.consecutiveFailures = 0;
    state.circuitOpenUntil = 0;
    state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + Math.min(750, Math.floor(state.latencyEwmaMs / 2)));
    return;
  }
  state.consecutiveFailures += 1;
  if (status === 403) {
    state.forbiddenUntil = Math.max(state.forbiddenUntil, Date.now() + CIRCUIT_OPEN_MS);
  }
  if (status === 404) state.notFoundCount += 1;
  if (status === 429) state.rateLimitedCount += 1;
  if (status === 429 || status === 503) {
    state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + (retryMs || Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(4, state.consecutiveFailures))));
  }
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  }
}

async function acquireOnce(url: URL, timeoutMs: number, hardDeadlineAt?: number): Promise<PublicAcquisitionResult> {
  const deadlineAt = hardDeadlineAt == null
    ? Date.now() + Math.max(500, timeoutMs)
    : Math.min(hardDeadlineAt, Date.now() + Math.max(1, timeoutMs));
  const host = url.hostname.toLowerCase();
  const admitted = await waitForHost(host, deadlineAt);
  if (!admitted) return { ...failureResult(url.toString(), 0, new Error('Host circuit open or acquisition deadline exhausted')), errorType: 'circuit_open' };

  const started = Date.now();
  try {
    let current = url;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      await assertPublicResolution(current);
      const remaining = Math.max(1, deadlineAt - Date.now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        response = await fetch(current, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'user-agent': 'LegalWhat-Pantheon/1.0 public-record research',
            accept: 'text/html,application/xhtml+xml,application/json,application/xml,text/xml,text/csv,text/plain,application/pdf;q=0.8',
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      const redirectAdmission = admitPantheonUrl(new URL(location, current).toString());
      if (!redirectAdmission.ok) throw new Error(`Redirect rejected by Pantheon URL admission: ${redirectAdmission.reason}`);
      current = new URL(redirectAdmission.url);
    }
    if (!response) throw new Error('Public acquisition produced no response');
    if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error('Public acquisition exceeded redirect limit');

    const retryMs = retryAfterMs(response);
    const latency = Date.now() - started;
    recordHostResult(host, response.status, latency, retryMs);

    const contentType = response.headers.get('content-type') || '';
    if (!supportedContentType(contentType)) {
      return { ...failureResult(current.toString(), response.status, new Error(`Unsupported investigative content type: ${contentType}`)), errorType: 'unsupported_content' };
    }
    if (!response.ok) return failureResult(current.toString(), response.status, new Error(`HTTP ${response.status}`), retryMs);

    const text = (await response.text()).slice(0, 2_000_000);
    if (blockedResponseBody(text)) {
      return { ...failureResult(current.toString(), response.status, new Error('Blocked/challenge response is not investigative evidence')), errorType: 'http_error' };
    }
    return {
      url: current.toString(), ok: true, status: response.status, kind: kindFor(contentType, current.toString()),
      contentType, content: text, etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined, retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    recordHostResult(host, 0, Date.now() - started);
    return failureResult(url.toString(), 0, error);
  } finally {
    releaseHost(host);
  }
}

export async function acquirePantheonResource(rawUrl: string, timeoutMs: number, authority: PantheonAcquisitionAuthority): Promise<PublicAcquisitionResult> {
  if (!authority?.investigationId || !authority.categoryId || !authority.workId || !authority.capability) {
    return failureResult(String(rawUrl || ''), 0, new Error('Pantheon acquisition rejected: incomplete work authorization'));
  }
  return acquirePublicResource(rawUrl, timeoutMs, authority);
}

export async function acquirePublicResource(rawUrl: string, timeoutMs = 12_000, authority?: PantheonAcquisitionAuthority): Promise<PublicAcquisitionResult> {
  if (authority && authority.deadlineAt <= Date.now()) {
    return failureResult(String(rawUrl || ''), 0, new Error('Pantheon acquisition authorization expired'));
  }
  let url: URL;
  try {
    url = canonicalPublicUrl(rawUrl);
  } catch (error) {
    return failureResult(String(rawUrl || ''), 0, error);
  }
  const key = url.toString();
  const cached = recent.get(key);
  if (cached && Date.now() - cached.at < RECENT_TTL_MS) return cached.value;
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const deadlineAt = authority
      ? Math.min(authority.deadlineAt, Date.now() + Math.max(500, timeoutMs))
      : Date.now() + Math.max(500, timeoutMs);
    let last = failureResult(key, 0, new Error('Acquisition not attempted'));
    for (let attempt = 0; attempt <= MAX_RETRIES && Date.now() < deadlineAt; attempt++) {
      const remaining = Math.max(1, deadlineAt - Date.now());
      last = await acquireOnce(url, remaining, deadlineAt);
      if (last.ok) break;
      const retryable = last.status === 408 || last.status === 429 || last.status === 500 || last.status === 502 || last.status === 503 || last.status === 504 ||
        ['timeout','tls_failure','network_failure'].includes(String(last.errorType));
      if (!retryable || attempt >= MAX_RETRIES) break;
      const exponential = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
      const delay = Math.min(remaining, last.retryAfterMs || (exponential + Math.floor(Math.random() * 350)));
      if (delay <= 0 || Date.now() + delay >= deadlineAt) break;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    recent.set(key, { at: Date.now(), value: last });
    return last;
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export async function acquirePublicResources(urls: string[], timeoutMs?: number, authority?: PantheonAcquisitionAuthority): Promise<PublicAcquisitionResult[]> {
  const unique = [...new Set(urls.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 40);
  const settled = await Promise.allSettled(unique.map((url, index) => acquirePublicResource(url, timeoutMs, authority ? { ...authority, workId: `${authority.workId}:${index}` } : undefined)));
  return settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : failureResult(unique[index], 0, result.reason));
}

export function getPublicAcquisitionHostHealth(): Record<string, Omit<HostState, 'active'>> {
  return Object.fromEntries([...hostStates.entries()].map(([host, state]) => [host, {
    nextAllowedAt: state.nextAllowedAt,
    consecutiveFailures: state.consecutiveFailures,
    circuitOpenUntil: state.circuitOpenUntil,
    latencyEwmaMs: state.latencyEwmaMs,
    forbiddenUntil: state.forbiddenUntil,
    notFoundCount: state.notFoundCount,
    rateLimitedCount: state.rateLimitedCount,
  }]));
}
