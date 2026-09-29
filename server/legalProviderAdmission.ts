/**
 * Legal-only quota admission: shared transport budgets, sliding minute limits,
 * conservative full-output reservations and expiring concurrency leases.
 * Configured limits describe actual account allowances, never spending caps.
 * Other consumers of an API key can still change upstream availability.
 */
import type { AIProvider } from './aiTokenGovernor';
import { changeLegalQuotaState, readLegalQuotaStates, freshLegalQuotaState, type LegalQuotaState } from './legalQuotaStore';
const MINUTE = 60_000, DAY = 86_400_000;
const cache = new Map<string, LegalQuotaState>();
let ledgerUnavailableUntil = 0;
let sequence = 0;
export function legalQuotaDomain(provider: AIProvider): string {
  if (provider === 'deepseek' || provider === 'kimi') return 'openrouter';
  return provider === 'claude_opus' ? 'claude' : provider === 'gpt_oss' ? 'groq' : provider;
}
function limit(domain: string, name: string, fallback: number): number {
  const value = Number(process.env[`LEXARA_${domain.toUpperCase()}_${name}`]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
function limits(domain: string) {
  // No artificial daily/monthly spending cap. Only configured account limits
  // and observed provider feedback constrain allowance. Concurrency remains
  // bounded to prevent bursts and duplicate transport work.
  const unlimited = Number.MAX_SAFE_INTEGER;
  return { rpm: limit(domain, 'RPM', unlimited), tpm: limit(domain, 'TPM', unlimited),
    rpd: limit(domain, 'RPD', unlimited), month: limit(domain, 'MONTHLY_REQUESTS', unlimited),
    concurrent: limit(domain, 'CONCURRENCY', 1) };
}
function prune(state: LegalQuotaState, now: number) {
  state.minute = state.minute.filter(x => now - x.at < MINUTE);
  // Rolling windows deliberately do not replenish early at a calendar boundary.
  if (!state.dayStart || now - state.dayStart >= DAY) { state.dayStart = now; state.dayRequests = 0; }
  if (!state.monthStart || now - state.monthStart >= 31 * DAY) { state.monthStart = now; state.monthRequests = 0; }
  for (const [id, expiry] of Object.entries(state.leases)) if (expiry <= now) delete state.leases[id];
}
function allowed(state: LegalQuotaState, domain: string, tokens: number, now: number) {
  prune(state, now);
  const cap = limits(domain);
  const observed = state.observed;
  if (observed?.requestReset && now < observed.requestReset && observed.requests !== undefined && observed.requests < 1) return false;
  if (observed?.tokenReset && now < observed.tokenReset && observed.tokens !== undefined && observed.tokens < tokens) return false;
  return now >= state.blockedUntil && state.minute.length < cap.rpm
    && state.minute.reduce((n, x) => n + x.tokens, 0) + tokens <= cap.tpm
    && state.dayRequests < cap.rpd && state.monthRequests < cap.month
    && Object.keys(state.leases).length < cap.concurrent;
}
export async function refreshLegalProviderAdmission(providers: AIProvider[]): Promise<void> {
  try {
    const states = await readLegalQuotaStates([...new Set(providers.map(legalQuotaDomain))]);
    for (const domain of providers.map(legalQuotaDomain)) cache.set(domain, states.get(domain) || freshLegalQuotaState());
    ledgerUnavailableUntil = 0;
  } catch {
    ledgerUnavailableUntil = Date.now() + 5000;
    console.warn('[HARMONY] Shared legal quota ledger unavailable; dispatch withheld');
  }
}
export function canUseLegalProvider(provider: AIProvider, _model: string, maxTokens = 450, prompt = ''): boolean {
  const domain = legalQuotaDomain(provider);
  return Date.now() >= ledgerUnavailableUntil && allowed(
    cache.get(domain) || freshLegalQuotaState(), domain, prompt.length + maxTokens, Date.now(),
  );
}
export function legalProviderCapacityScore(provider: AIProvider): number {
  const domain = legalQuotaDomain(provider), state = cache.get(domain) || freshLegalQuotaState();
  prune(state, Date.now());
  const cap = limits(domain);
  const pressure = Math.max(state.dayRequests / Math.max(1, cap.rpd),
    state.monthRequests / Math.max(1, cap.month),
    state.minute.length / Math.max(1, cap.rpm));
  // Least-recently used routes receive bounded aging credit, enough to prevent
  // permanent starvation without ignoring task fitness or quota pressure.
  const age = state.lastUsed ? Math.min(90, (Date.now() - state.lastUsed) / 1000) : 90;
  return age - pressure * 80 - Object.keys(state.leases).length * 100;
}
export type LegalProviderLease = { domain: string; id: string };
export async function reserveLegalProvider(
  provider: AIProvider, _model: string, maxTokens: number, prompt: string, timeoutMs = 30_000,
): Promise<LegalProviderLease | null> {
  const domain = legalQuotaDomain(provider);
  // Character count is intentionally conservative for multilingual input; include
  // the system prompt at the call site. Unknown/cancelled usage is never refunded.
  const tokens = prompt.length + maxTokens;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}-${++sequence}`;
  try {
    return await changeLegalQuotaState(domain, (state, now) => {
      cache.set(domain, state);
      if (!allowed(state, domain, tokens, now)) return null;
      state.minute.push({ at: now, tokens });
      state.dayRequests++; state.monthRequests++; state.lastUsed = now;
      if (state.observed?.requestReset && now < state.observed.requestReset && state.observed.requests !== undefined) state.observed.requests--;
      if (state.observed?.tokenReset && now < state.observed.tokenReset && state.observed.tokens !== undefined) state.observed.tokens -= tokens;
      state.leases[id] = now + Math.max(1000, timeoutMs) + 5000;
      return { domain, id };
    });
  } catch { ledgerUnavailableUntil = Date.now() + 5000; return null; }
}
export async function releaseLegalProvider(lease: LegalProviderLease | null): Promise<void> {
  if (!lease) return;
  try {
    await changeLegalQuotaState(lease.domain, state => {
      delete state.leases[lease.id]; cache.set(lease.domain, state);
    });
  } catch { /* Expiring lease retains conservative protection after store failure. */ }
}
function retryAfter(error: any, now: number): number {
  const raw = error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after']
    ?? error?.response?.headers?.['retry-after'];
  if (raw != null) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(String(raw)); if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const message = String(error?.message || error);
  const match = /retry[- ]after[:= ]+(\d+(?:\.\d+)?)|retry in (\d+(?:\.\d+)?)s/i.exec(message);
  return match ? Number(match[1] || match[2]) * 1000 : 0;
}
export async function noteLegalProviderError(provider: AIProvider, _model: string, error: unknown): Promise<void> {
  await noteLegalProviderHeaders(provider, (error as any)?.headers);
  const domain = legalQuotaDomain(provider);
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  // Local skips and cancellation must never lengthen a remote-provider circuit.
  if (/reserve withheld|cooling down|superseded|abort/.test(message)) return;
  const duration = /402|payment required|insufficient.credit|insufficient_quota|daily|per.day|0 requests\/minute|limit-req-minute.*0/.test(message) ? DAY
    : /429|rate.limit|quota|resource_exhausted/.test(message) ? 5_000
    : /401|403|unauthoriz|invalid.api.key/.test(message) ? 15 * MINUTE : 0;
  if (!duration) return;
  try {
    await changeLegalQuotaState(domain, (state, now) => {
      state.blockedUntil = Math.max(state.blockedUntil, now + Math.max(duration, retryAfter(error, now)));
      cache.set(domain, state);
    });
  } catch { ledgerUnavailableUntil = Date.now() + 5000; }
}

/** Capture actual remaining allowance, not a guessed plan or spending cap. */
export async function noteLegalProviderHeaders(provider: AIProvider, headers: any): Promise<void> {
  if (!headers) return;
  const get = (name: string) => headers.get?.(name) ?? headers[name];
  const prefix = legalQuotaDomain(provider) === 'claude' ? 'anthropic-ratelimit-' : 'x-ratelimit-';
  const requests = get(prefix + 'remaining-requests') ?? get('anthropic-ratelimit-requests-remaining');
  const tokens = get(prefix + 'remaining-tokens') ?? get('anthropic-ratelimit-tokens-remaining');
  if (requests == null && tokens == null) return;
  const resetMs = (raw: unknown, now: number): number => {
    if (raw == null) return now + MINUTE;
    const text = String(raw);
    const date = Date.parse(text);
    if (text.includes('-') && Number.isFinite(date)) return Math.max(now, date);
    const units = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
    if (units.length) return now + units.reduce((sum, m) => sum + Number(m[1]) * ({ ms: 1, s: 1000, m: MINUTE, h: 3600000 }[m[2]] || 0), 0);
    const seconds = Number(text);
    return now + (Number.isFinite(seconds) ? seconds * 1000 : MINUTE);
  };
  try {
    await changeLegalQuotaState(legalQuotaDomain(provider), (state, now) => {
      state.observed ||= {};
      if (requests != null && Number.isFinite(Number(requests))) {
        state.observed.requests = Math.max(0, Number(requests));
        state.observed.requestReset = resetMs(get(prefix + 'reset-requests') ?? get('anthropic-ratelimit-requests-reset'), now);
      }
      if (tokens != null && Number.isFinite(Number(tokens))) {
        state.observed.tokens = Math.max(0, Number(tokens));
        state.observed.tokenReset = resetMs(get(prefix + 'reset-tokens') ?? get('anthropic-ratelimit-tokens-reset'), now);
      }
      cache.set(legalQuotaDomain(provider), state);
    });
  } catch { ledgerUnavailableUntil = Date.now() + 5000; }
}
