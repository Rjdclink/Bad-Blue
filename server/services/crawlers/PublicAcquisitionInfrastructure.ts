import { URL } from 'url';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { pantheonAbortableDelay, throwIfPantheonAborted } from '../pantheon/PantheonDeadline';
import { parsePantheonDocument, type PantheonParsedDocument } from '../pantheon/PantheonDocumentIntelligence';
import { persistPantheonRawSnapshot, type PantheonRawSnapshotDescriptor } from '../pantheon/PantheonRawSnapshotStore';
import {
  acquirePantheonDomainLease,
  releasePantheonDomainLease,
  type PantheonDomainLease,
} from '../pantheon/PantheonFrontierStore';

export type PublicAcquisitionKind = 'html' | 'json' | 'xml' | 'rss' | 'csv' | 'pdf' | 'image' | 'text';

export interface PantheonAcquisitionAuthority {
  investigationId: string;
  categoryId: string;
  workId: string;
  capability: string;
  deadlineAt: number;
  canonicalUrl?: string;
  route?: 'primary' | 'fallback';
  fallbackFor?: string;
  /** Ephemeral source session headers; never persisted or emitted to telemetry. */
  requestHeaders?: Record<string, string>;
}

interface PantheonAcquisitionContext {
  authority: PantheonAcquisitionAuthority;
  signal?: AbortSignal;
}

export interface PublicAcquisitionRequestOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
}

const acquisitionContext = new AsyncLocalStorage<PantheonAcquisitionContext>();

export function runWithPantheonAcquisitionContext<T>(
  authority: PantheonAcquisitionAuthority,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return acquisitionContext.run({ authority, signal }, operation);
}

export function isPantheonAcquisitionContextActive(): boolean {
  return Boolean(acquisitionContext.getStore()?.authority);
}

export function getPantheonAcquisitionContext(): Readonly<PantheonAcquisitionContext> | undefined {
  return acquisitionContext.getStore();
}

export interface PublicAcquisitionResult {
  url: string;
  ok: boolean;
  status: number;
  kind: PublicAcquisitionKind;
  contentType: string;
  content: string;
  parser?: PantheonParsedDocument['parser'];
  ocrApplied?: boolean;
  redirectChain?: string[];
  snapshot?: PantheonRawSnapshotDescriptor;
  etag?: string;
  lastModified?: string;
  retrievedAt: string;
  error?: string;
  errorType?: 'rate_limited'|'auth_required'|'forbidden'|'robots_disallowed'|'not_found'|'dns_failure'|'tls_failure'|'timeout'|'invalid_url'|'unsupported_content'|'circuit_open'|'network_failure'|'http_error';
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
const RECENT_MAX_ENTRIES = 2_000;
const MAX_PER_HOST = 2;
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 12_000;
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_OPEN_MS = 30_000;
const PANTHEON_USER_AGENT = 'LegalWhat-Pantheon/1.0';
const ROBOTS_CACHE_TTL_MS = 30 * 60_000;
interface PantheonRobotsPolicy {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
}
const robotsPolicies = new Map<string, { expiresAt: number; policy: PantheonRobotsPolicy }>();
const robotsInflight = new Map<string, Promise<PantheonRobotsPolicy>>();

const BLOCKED_EXTENSIONS = /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot|gif|webp|svg|ico|mp[34]|m4[av]|avi|mov|webm|zip|gz|rar|7z|exe|dmg|apk)(?:$|[?#])/i;
const BLOCKED_HOST_HINTS = /(?:googletagmanager|google-analytics|doubleclick|newrelic|addthis|chartbeat|optimizely|tinypass|fonts\.googleapis|fonts\.gstatic|static\.files\.bbci|m\.files\.bbci|assets\.guim|static\.guim|i\.guim|j\.ophan)/i;
const MALFORMED_RECURSIVE_SCHEME = /^https?:\/\/https?(?::?\/\/|%3a%2f%2f)/i;
const AUTH_ROUTE_HINT = /(?:^|\/)(?:login|log-in|log_in|signin|sign-in|sign_in|users\/sign_in|account\/login|oauth\/authorize)(?:\/|$)/i;
const CREDENTIAL_QUERY_KEY = /^(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|session[_-]?token|signature)$/i;

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
  if (value.includes('pdf') || /\.pdf(?:$|[?#])/i.test(url)) return 'pdf';
  if (/^image\/(?:png|jpe?g|tiff?|bmp)/i.test(value) || /\.(?:png|jpe?g|tiff?|bmp)(?:$|[?#])/i.test(url)) return 'image';
  if (value.includes('json') || url.endsWith('.json')) return 'json';
  if (value.includes('rss') || value.includes('atom')) return 'rss';
  if (value.includes('xml') || url.endsWith('.xml')) return 'xml';
  if (value.includes('csv') || url.endsWith('.csv')) return 'csv';
  if (value.includes('html')) return 'html';
  return 'text';
}

function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  const version = isIP(normalized);
  if (version === 4) {
    return normalized === '0.0.0.0' || /^127\./.test(normalized) || /^10\./.test(normalized) ||
      /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
  }
  if (version === 6) {
    return normalized === '::1' || normalized === '::' ||
      normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
      normalized.startsWith('::ffff:169.254.') || normalized.startsWith('fc') || normalized.startsWith('fd') ||
      normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return false;
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
  if (MALFORMED_RECURSIVE_SCHEME.test(cleaned)) {
    throw new Error('Malformed recursive URL rejected');
  }
  const url = new URL(cleaned);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported acquisition protocol');
  if (isPrivateHost(url.hostname)) throw new Error('Private-network acquisition is not permitted');
  if (url.username || url.password) throw new Error('Credential-gated URL skipped: embedded credentials are not permitted');
  if (AUTH_ROUTE_HINT.test(url.pathname)) throw new Error('Credential-gated URL skipped: sign-in route');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (CREDENTIAL_QUERY_KEY.test(key)) {
      throw new Error('Credential-gated URL skipped: API key or access token required');
    }
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

export function isPantheonRobotsAllowed(targetUrl: string, robotsUrl: string, robotsText: string): boolean {
  const allowed = parsePantheonRobotsPolicy(robotsUrl, robotsText).isAllowed(targetUrl, PANTHEON_USER_AGENT);
  return allowed !== false;
}

function parsePantheonRobotsPolicy(robotsUrl: string, robotsText: string): PantheonRobotsPolicy {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let agents: string[] = [];
  let rules: Array<{ allow: boolean; path: string }> = [];
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const sourceLine of String(robotsText || '').split(/\r?\n/)) {
    const line = sourceLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && agents.length && value) {
      rules.push({ allow: field === 'allow', path: value });
    }
  }
  flush();

  return {
    isAllowed(rawUrl: string, rawUserAgent = '*'): boolean {
      let path: string;
      try {
        const parsed = new URL(rawUrl, robotsUrl);
        path = `${parsed.pathname}${parsed.search}`;
      } catch {
        return false;
      }
      const userAgent = rawUserAgent.toLowerCase();
      const candidates = groups.flatMap(group => group.agents
        .filter(agent => agent === '*' || userAgent.includes(agent))
        .map(agent => ({ specificity: agent === '*' ? 0 : agent.length, rules: group.rules })));
      if (!candidates.length) return true;
      const highestSpecificity = Math.max(...candidates.map(candidate => candidate.specificity));
      const applicableRules = candidates
        .filter(candidate => candidate.specificity === highestSpecificity)
        .flatMap(candidate => candidate.rules)
        .flatMap(rule => {
          const anchored = rule.path.endsWith('$');
          const pattern = anchored ? rule.path.slice(0, -1) : rule.path;
          const expression = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
          const matches = new RegExp(`^${expression}${anchored ? '$' : ''}`).test(path);
          return matches ? [{ ...rule, specificity: pattern.replace(/\*/g, '').length }] : [];
        })
        .sort((left, right) => right.specificity - left.specificity || Number(right.allow) - Number(left.allow));
      return applicableRules[0]?.allow ?? true;
    },
  };
}

async function robotsPolicyFor(target: URL, deadlineAt: number, signal?: AbortSignal): Promise<PantheonRobotsPolicy> {
  const origin = target.origin;
  const cached = robotsPolicies.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.policy;
  const existing = robotsInflight.get(origin);
  if (existing) return existing;

  const task = (async () => {
    const robotsUrl = new URL('/robots.txt', origin);
    await assertPublicResolution(robotsUrl);
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortFromParent, { once: true });
    const remaining = Math.max(1, Math.min(3_000, deadlineAt - Date.now()));
    const timer = setTimeout(() => controller.abort(new Error('robots.txt acquisition deadline exceeded')), remaining);
    let policy: PantheonRobotsPolicy;
    let ttl = ROBOTS_CACHE_TTL_MS;
    try {
      const response = await fetch(robotsUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'user-agent': `${PANTHEON_USER_AGENT} public-record research`, accept: 'text/plain' },
      });
      if (response.ok) {
        const text = (await response.text()).slice(0, 500_000);
        policy = parsePantheonRobotsPolicy(robotsUrl.toString(), text);
      } else if (response.status >= 500) {
        // RFC 9309 treats an unreachable robots service as complete disallow.
        policy = parsePantheonRobotsPolicy(robotsUrl.toString(), 'User-agent: *\nDisallow: /');
        ttl = 5 * 60_000;
      } else {
        // 4xx means the robots file is unavailable, so crawling is permitted.
        policy = parsePantheonRobotsPolicy(robotsUrl.toString(), '');
      }
    } catch {
      policy = parsePantheonRobotsPolicy(robotsUrl.toString(), 'User-agent: *\nDisallow: /');
      ttl = 60_000;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromParent);
    }
    robotsPolicies.set(origin, { expiresAt: Date.now() + ttl, policy });
    return policy;
  })();
  robotsInflight.set(origin, task);
  try {
    return await task;
  } finally {
    robotsInflight.delete(origin);
  }
}

/**
 * Detects credential walls after a public GET without attempting to evade them.
 * A normal public page that merely links to a sign-in page is not rejected.
 */
export function detectPublicAccessBarrier(value: string, contentType = ''): string | undefined {
  const sample = String(value || '').slice(0, 300_000);
  const lowered = sample.toLowerCase();
  if (!lowered.trim()) return undefined;

  const apiKeyWall = /(?:api[ _-]?key|access token)\s+(?:is\s+)?(?:missing|required|invalid)|(?:missing|required)\s+(?:an?\s+)?(?:api[ _-]?key|access token)|["'](?:unauthorized|authentication_required)["']/.test(lowered);
  if (apiKeyWall) return 'Credential-gated response skipped: API key or access token required';

  const title = lowered.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ').trim() || '';
  const titledLoginWall = /^(?:sign[ -]?in|log[ -]?in|authentication required|authorization required|access required)(?:\s|[-|:]).*|^(?:sign[ -]?in|log[ -]?in|authentication required|authorization required|access required)$/.test(title);
  const explicitLoginWall = /(?:please|you must|must|need to|required to)\s+(?:sign[ -]?in|log[ -]?in)\s+(?:to|before)\s+(?:continue|view|access|proceed)|(?:sign[ -]?in|log[ -]?in)\s+(?:is\s+)?required\s+(?:to|for)/.test(lowered);
  const credentialForm = /<form[^>]+(?:action|id|class)=["'][^"']*(?:login|signin|sign-in|sign_in|authentication)[^"']*["']/i.test(sample) &&
    /<input[^>]+type=["']password["']/i.test(sample);
  if (titledLoginWall || explicitLoginWall || credentialForm) {
    return 'Credential-gated response skipped: sign-in required';
  }

  const paywall = /(?:subscribe|subscription|membership)\s+(?:is\s+)?required\s+(?:to|for)\s+(?:continue|view|access|read)/.test(lowered);
  if (paywall) return 'Credential-gated response skipped: subscription required';
  return undefined;
}

function supportedContentType(value: string): boolean {
  const type = value.toLowerCase();
  if (!type) return true;
  return /(?:text\/|json|xml|rss|atom|csv|pdf|image\/(?:png|jpe?g|tiff?|bmp))/i.test(type) &&
    !/(?:javascript|css|font|audio\/|video\/)/i.test(type);
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
  if (status === 401 || status === 402 || status === 407) return 'auth_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  const message = error instanceof Error ? error.message : String(error || '');
  if (/credential-gated|sign[ -]?in required|api[ _-]?key.*required|access token.*required|subscription required/i.test(message)) return 'auth_required';
  if (/robots\.txt policy/i.test(message)) return 'robots_disallowed';
  if (/ENOTFOUND|EAI_AGAIN|hostname did not resolve/i.test(message)) return 'dns_failure';
  if (/TLS|SSL|secure.*connection|ECONNRESET/i.test(message)) return 'tls_failure';
  if (/abort|timed out|timeout/i.test(message)) return 'timeout';
  if (/invalid|malformed recursive|unsupported acquisition|eligible for acquisition|outside the canonical work authorization/i.test(message)) return 'invalid_url';
  return status > 0 ? 'http_error' : 'network_failure';
}

export function pantheonTelemetryUrl(raw: string): string {
  const sourceRef = createHash('sha256').update(String(raw || '')).digest('hex').slice(0, 16);
  try {
    const url = new URL(String(raw || ''));
    return `${url.protocol}//${url.host}/[REDACTED]#source=${sourceRef}`;
  } catch {
    return `[INVALID]#source=${sourceRef}`;
  }
}

const acquisitionTelemetrySampleCounts = new Map<string, number>();

function logAcquisitionEvent(
  authority: PantheonAcquisitionAuthority | undefined,
  event: 'dispatch' | 'outcome' | 'rejected',
  url: string,
  details: Record<string, unknown> = {},
): void {
  if (!authority) return;
  const key = [
    authority.investigationId,
    authority.categoryId,
    event,
    String(details.errorType || details.outcome || details.status || 'none'),
  ].join(':');
  const count = (acquisitionTelemetrySampleCounts.get(key) || 0) + 1;
  acquisitionTelemetrySampleCounts.set(key, count);
  // Per-URL provenance is retained in the durable frontier. Runtime logs are
  // sampled so a blocked provider cannot exhaust the deployment log stream.
  if (count !== 1 && count % 25 !== 0) return;
  console.log(`[PANTHEON][URL] ${JSON.stringify({
    event,
    investigationId: authority.investigationId,
    categoryId: authority.categoryId,
    workId: authority.workId,
    capability: authority.capability,
    route: authority.route || 'primary',
    ...(authority.fallbackFor ? { fallbackFor: authority.fallbackFor } : {}),
    url: pantheonTelemetryUrl(url),
    ...details,
    sampleCount: count,
  })}`);
}

function rememberRecent(key: string, value: PublicAcquisitionResult): void {
  const now = Date.now();
  recent.set(key, { at: now, value });
  if (recent.size <= RECENT_MAX_ENTRIES) return;
  for (const [candidateKey, candidate] of recent) {
    if (now - candidate.at >= RECENT_TTL_MS) recent.delete(candidateKey);
  }
  while (recent.size > RECENT_MAX_ENTRIES) {
    const oldest = recent.keys().next().value as string | undefined;
    if (!oldest) break;
    recent.delete(oldest);
  }
}

function failureResult(url: string, status: number, error: unknown, retryMs?: number): PublicAcquisitionResult {
  const message = error instanceof Error ? error.message : String(error || (status ? `HTTP ${status}` : 'Acquisition failed'));
  return {
    url, ok: false, status, kind: kindFor('', url), contentType: '', content: '',
    retrievedAt: new Date().toISOString(), error: message, errorType: classify(status, error), retryAfterMs: retryMs,
  };
}

async function waitForHost(host: string, deadlineAt: number, signal?: AbortSignal): Promise<boolean> {
  const state = stateFor(host);
  while (Date.now() < deadlineAt) {
    throwIfPantheonAborted(signal);
    if (state.circuitOpenUntil > Date.now() || state.forbiddenUntil > Date.now()) return false;
    if (state.active < MAX_PER_HOST && state.nextAllowedAt <= Date.now()) {
      state.active += 1;
      return true;
    }
    await pantheonAbortableDelay(Math.min(150, Math.max(20, deadlineAt - Date.now())), signal);
  }
  return false;
}

async function waitForDistributedHost(
  host: string,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<PantheonDomainLease> {
  while (Date.now() < deadlineAt) {
    throwIfPantheonAborted(signal);
    const lease = await acquirePantheonDomainLease(host, deadlineAt);
    if (lease.acquired) return lease;
    await pantheonAbortableDelay(Math.min(150, Math.max(20, deadlineAt - Date.now())), signal);
  }
  return { mode: 'database', acquired: false, domain: host };
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

async function acquireOnce(
  url: URL,
  timeoutMs: number,
  hardDeadlineAt?: number,
  signal?: AbortSignal,
  requestOptions: PublicAcquisitionRequestOptions = {},
  authority?: PantheonAcquisitionAuthority,
): Promise<PublicAcquisitionResult> {
  const deadlineAt = hardDeadlineAt == null
    ? Date.now() + Math.max(500, timeoutMs)
    : Math.min(hardDeadlineAt, Date.now() + Math.max(1, timeoutMs));
  const host = url.hostname.toLowerCase();
  const admitted = await waitForHost(host, deadlineAt, signal);
  if (!admitted) return { ...failureResult(url.toString(), 0, new Error('Host circuit open or acquisition deadline exhausted')), errorType: 'circuit_open' };

  const domainLease = await waitForDistributedHost(host, deadlineAt, signal);
  if (!domainLease.acquired) {
    releaseHost(host);
    return { ...failureResult(url.toString(), 0, new Error('Shared host admission deadline exhausted')), errorType: 'circuit_open' };
  }

  const started = Date.now();
  let distributedStatus = 0;
  let distributedRetryAfterMs: number | undefined;
  try {
    let current = url;
    let response: Response | undefined;
    const redirectChain = [current.toString()];
    for (let redirects = 0; redirects <= 5; redirects++) {
      throwIfPantheonAborted(signal);
      await assertPublicResolution(current);
      const robotsPolicy = await robotsPolicyFor(current, deadlineAt, signal);
      if (robotsPolicy.isAllowed(current.toString(), PANTHEON_USER_AGENT) === false) {
        return { ...failureResult(current.toString(), 0, new Error('Blocked by the source robots.txt policy')), errorType: 'robots_disallowed' };
      }
      const remaining = Math.max(1, deadlineAt - Date.now());
      const controller = new AbortController();
      const abortFromParent = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abortFromParent, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('Pantheon acquisition deadline exceeded')), remaining);
      try {
        const method = requestOptions.method || 'GET';
        response = await fetch(current, {
          method,
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'user-agent': `${PANTHEON_USER_AGENT} public-record research`,
            accept: 'text/html,application/xhtml+xml,application/json,application/xml,text/xml,text/csv,text/plain,application/pdf;q=0.8',
            ...(authority?.requestHeaders || {}),
            ...(requestOptions.headers || {}),
          },
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortFromParent);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      const redirectAdmission = admitPantheonUrl(new URL(location, current).toString());
      if (!redirectAdmission.ok) throw new Error(`Redirect rejected by Pantheon URL admission: ${redirectAdmission.reason}`);
      current = new URL(redirectAdmission.url);
      redirectChain.push(current.toString());
    }
    if (!response) throw new Error('Public acquisition produced no response');
    if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error('Public acquisition exceeded redirect limit');

    const retryMs = retryAfterMs(response);
    distributedStatus = response.status;
    distributedRetryAfterMs = retryMs;
    const latency = Date.now() - started;
    recordHostResult(host, response.status, latency, retryMs);

    const contentType = response.headers.get('content-type') || '';
    if (!supportedContentType(contentType)) {
      return { ...failureResult(current.toString(), response.status, new Error(`Unsupported investigative content type: ${contentType}`)), errorType: 'unsupported_content' };
    }
    if (!response.ok) return failureResult(current.toString(), response.status, new Error(`HTTP ${response.status}`), retryMs);

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (requestOptions.method !== 'HEAD' && declaredLength > 12_000_000) {
      return { ...failureResult(current.toString(), response.status, new Error('Investigative source exceeds the 12 MB acquisition limit')), errorType: 'unsupported_content' };
    }
    const retrievedAt = new Date().toISOString();
    const bytes = requestOptions.method === 'HEAD'
      ? Buffer.alloc(0)
      : Buffer.from(await response.arrayBuffer());
    if (bytes.length > 12_000_000) {
      return { ...failureResult(current.toString(), response.status, new Error('Investigative source exceeds the 12 MB acquisition limit')), errorType: 'unsupported_content' };
    }
    const parsed = requestOptions.method === 'HEAD'
      ? undefined
      : await parsePantheonDocument({ bytes, contentType, url: current.toString(), signal });
    const text = parsed?.content || '';
    if (blockedResponseBody(text)) {
      return { ...failureResult(current.toString(), response.status, new Error('Blocked/challenge response is not investigative evidence')), errorType: 'http_error' };
    }
    const accessBarrier = requestOptions.method === 'HEAD' ? undefined : detectPublicAccessBarrier(text, contentType);
    if (accessBarrier) {
      return { ...failureResult(current.toString(), response.status, new Error(accessBarrier)), errorType: 'auth_required' };
    }
    const snapshot = requestOptions.method === 'HEAD' || !authority
      ? undefined
      : await persistPantheonRawSnapshot({
          investigationId: authority.investigationId,
          bytes,
          capturedAt: retrievedAt,
        });
    return {
      url: current.toString(), ok: true, status: response.status, kind: kindFor(contentType, current.toString()),
      contentType, content: text, etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined, retrievedAt,
      parser: parsed?.parser,
      ocrApplied: parsed?.ocrApplied,
      redirectChain,
      snapshot,
    };
  } catch (error) {
    distributedStatus = 0;
    recordHostResult(host, 0, Date.now() - started);
    return failureResult(url.toString(), 0, error);
  } finally {
    await releasePantheonDomainLease({
      lease: domainLease,
      status: distributedStatus,
      latencyMs: Date.now() - started,
      retryAfterMs: distributedRetryAfterMs,
    });
    releaseHost(host);
  }
}

export async function acquirePantheonResource(
  rawUrl: string,
  timeoutMs: number,
  authority: PantheonAcquisitionAuthority,
  signal?: AbortSignal,
  requestOptions: PublicAcquisitionRequestOptions = {},
): Promise<PublicAcquisitionResult> {
  if (!authority?.investigationId || !authority.categoryId || !authority.workId || !authority.capability) {
    return failureResult(String(rawUrl || ''), 0, new Error('Pantheon acquisition rejected: incomplete work authorization'));
  }
  return acquirePublicResource(rawUrl, timeoutMs, authority, signal, requestOptions);
}

export async function acquirePublicResource(
  rawUrl: string,
  timeoutMs = 12_000,
  authority?: PantheonAcquisitionAuthority,
  signal?: AbortSignal,
  requestOptions: PublicAcquisitionRequestOptions = {},
): Promise<PublicAcquisitionResult> {
  const telemetryStartedAt = Date.now();
  const inherited = acquisitionContext.getStore();
  authority = authority || inherited?.authority;
  signal = signal || inherited?.signal;
  try {
    throwIfPantheonAborted(signal);
  } catch (error) {
    const result = failureResult(String(rawUrl || ''), 0, error);
    logAcquisitionEvent(authority, 'rejected', String(rawUrl || ''), { method: requestOptions.method || 'GET', status: result.status, errorType: result.errorType, durationMs: Date.now() - telemetryStartedAt });
    return result;
  }
  if (authority && authority.deadlineAt <= Date.now()) {
    const result = failureResult(String(rawUrl || ''), 0, new Error('Pantheon acquisition authorization expired'));
    logAcquisitionEvent(authority, 'rejected', String(rawUrl || ''), { method: requestOptions.method || 'GET', status: result.status, errorType: result.errorType, durationMs: Date.now() - telemetryStartedAt });
    return result;
  }
  let url: URL;
  try {
    url = canonicalPublicUrl(rawUrl);
  } catch (error) {
    const result = failureResult(String(rawUrl || ''), 0, error);
    logAcquisitionEvent(authority, 'rejected', String(rawUrl || ''), { method: requestOptions.method || 'GET', status: result.status, errorType: result.errorType, durationMs: Date.now() - telemetryStartedAt });
    return result;
  }
  if (authority?.canonicalUrl) {
    try {
      const authorized = canonicalPublicUrl(authority.canonicalUrl).toString();
      if (url.toString() !== authorized) {
        const result = failureResult(url.toString(), 0, new Error('Pantheon acquisition rejected: URL is outside the canonical work authorization'));
        logAcquisitionEvent(authority, 'rejected', url.toString(), {
          method: requestOptions.method || 'GET',
          status: result.status,
          errorType: result.errorType,
          durationMs: Date.now() - telemetryStartedAt,
        });
        return result;
      }
    } catch (error) {
      const result = failureResult(url.toString(), 0, error);
      logAcquisitionEvent(authority, 'rejected', url.toString(), {
        method: requestOptions.method || 'GET',
        status: result.status,
        errorType: result.errorType,
        durationMs: Date.now() - telemetryStartedAt,
      });
      return result;
    }
  }
  const cacheKey = url.toString();
  const method = requestOptions.method || 'GET';
  logAcquisitionEvent(authority, 'dispatch', cacheKey, { method });
  // One canonical source snapshot is shared by every crawler participating in
  // the same investigation. Each caller still receives its own execution audit
  // and telemetry, while duplicate GET fanout cannot hammer a host.
  const key = authority
    ? `${cacheKey}#${authority.investigationId}:${method}`
    : `${cacheKey}#public:${method}`;
  const cached = recent.get(key);
  if (cached && Date.now() - cached.at < RECENT_TTL_MS) {
    logAcquisitionEvent(authority, 'outcome', cached.value.url, {
      method, status: cached.value.status, outcome: cached.value.ok ? 'completed' : 'skipped_or_failed',
      errorType: cached.value.errorType, durationMs: Date.now() - telemetryStartedAt, cache: 'recent',
    });
    return cached.value;
  }
  const existing = inflight.get(key);
  if (existing) {
    const result = await existing;
    logAcquisitionEvent(authority, 'outcome', result.url, {
      method, status: result.status, outcome: result.ok ? 'completed' : 'skipped_or_failed',
      errorType: result.errorType, durationMs: Date.now() - telemetryStartedAt, cache: 'inflight',
    });
    return result;
  }

  const task = (async () => {
    const deadlineAt = authority
      ? Math.min(authority.deadlineAt, Date.now() + Math.max(500, timeoutMs))
      : Date.now() + Math.max(500, timeoutMs);
    let last = failureResult(cacheKey, 0, new Error('Acquisition not attempted'));
    for (let attempt = 0; attempt <= MAX_RETRIES && Date.now() < deadlineAt; attempt++) {
      throwIfPantheonAborted(signal);
      const remaining = Math.max(1, deadlineAt - Date.now());
      last = await acquireOnce(url, remaining, deadlineAt, signal, requestOptions, authority);
      if (last.ok) break;
      const retryable = last.status === 408 || last.status === 429 || last.status === 500 || last.status === 502 || last.status === 503 || last.status === 504 ||
        ['timeout','tls_failure','network_failure'].includes(String(last.errorType));
      if (!retryable || attempt >= MAX_RETRIES) break;
      const exponential = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
      const delay = Math.min(remaining, last.retryAfterMs || (exponential + Math.floor(Math.random() * 350)));
      if (delay <= 0 || Date.now() + delay >= deadlineAt) break;
      await pantheonAbortableDelay(delay, signal);
    }
    rememberRecent(key, last);
    return last;
  })();
  inflight.set(key, task);
  try {
    const result = await task;
    logAcquisitionEvent(authority, 'outcome', result.url, {
      method, status: result.status, outcome: result.ok ? 'completed' : 'skipped_or_failed',
      errorType: result.errorType, durationMs: Date.now() - telemetryStartedAt,
      finalUrl: pantheonTelemetryUrl(result.url),
      redirectCount: Math.max(0, Number(result.redirectChain?.length || 1) - 1),
      contentType: result.contentType || undefined,
      parser: result.parser,
      ocrApplied: result.ocrApplied,
      rawSha256: result.snapshot?.rawSha256,
      traceId: authority ? `${authority.investigationId}:${authority.categoryId}:${authority.workId}` : undefined,
    });
    return result;
  } catch (error) {
    logAcquisitionEvent(authority, 'outcome', cacheKey, {
      method, status: 0, outcome: 'failed', errorType: classify(0, error), durationMs: Date.now() - telemetryStartedAt,
    });
    throw error;
  } finally {
    inflight.delete(key);
  }
}

export async function acquirePublicResources(urls: string[], timeoutMs?: number, authority?: PantheonAcquisitionAuthority, signal?: AbortSignal): Promise<PublicAcquisitionResult[]> {
  const unique = [...new Set(urls.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 40);
  const settled = await Promise.allSettled(unique.map((url, index) => acquirePublicResource(url, timeoutMs, authority ? { ...authority, workId: `${authority.workId}:${index}` } : undefined, signal)));
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
