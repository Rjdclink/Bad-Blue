/**
 * Conservative in-process admission for LegalWhat model calls. The upstream
 * account remains authoritative: these are ceilings below the published free
 * allowances, and 429/402 responses still close a route immediately.
 * Multiple Railway replicas or other apps sharing a key need a shared ledger.
 */
import { AIProvider } from './aiTokenGovernor';

type Bucket = { startedAt: number; used: number; blockedUntil: number };
const buckets = new Map<string, Bucket>();
const DAY = 86_400_000;
const MINUTE = 60_000;

function nextPacificMidnight(now: number): number {
  // 09:00 UTC is at or after midnight Pacific in both seasonal offsets.
  const current = new Date(now);
  const boundary = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), 9);
  return boundary > now ? boundary : boundary + DAY;
}

function bucketSettings(provider: AIProvider, model: string, maxTokens: number, prompt: string) {
  switch (provider) {
    case AIProvider.GEMINI:
      return { key: `gemini:${model}`, windowMs: DAY, limit: 16, cost: 1, resetAt: nextPacificMidnight };
    case AIProvider.GROQ:
    case AIProvider.GPT_OSS:
      return { key: 'groq:daily', windowMs: DAY, limit: 700, cost: 1 };
    case AIProvider.COHERE:
      return { key: 'cohere:monthly', windowMs: 31 * DAY, limit: 800, cost: 1 };
    case AIProvider.CLOUDFLARE:
      return {
        key: 'cloudflare:neurons', windowMs: DAY, limit: 8000,
        // Reserve for full requested output before dispatch; Qwen costs more.
        cost: Math.ceil((prompt.length / 4) * 0.05 + maxTokens * 0.3),
      };
    case AIProvider.CLAUDE_OPUS:
      return { key: 'anthropic:opus:daily', windowMs: DAY, limit: 2, cost: 1 };
    case AIProvider.CLAUDE:
      return { key: 'anthropic:sonnet:daily', windowMs: DAY, limit: 20, cost: 1 };
    case AIProvider.MISTRAL:
      // A free workspace has account-specific limits. Its 429 headers are decisive.
      return { key: 'mistral:minute', windowMs: MINUTE, limit: 2, cost: 1 };
    default:
      return null;
  }
}

function groqTokenSettings(provider: AIProvider, maxTokens: number, prompt: string) {
  return provider === AIProvider.GROQ || provider === AIProvider.GPT_OSS
    ? { key: 'groq:tokens:minute', windowMs: MINUTE, limit: 6000,
        cost: Math.ceil(prompt.length / 4) + maxTokens }
    : null;
}

function readBucket(
  settings: NonNullable<ReturnType<typeof bucketSettings>>,
  now: number,
): Bucket {
  const old = buckets.get(settings.key);
  const resetAt = 'resetAt' in settings && settings.resetAt
    ? settings.resetAt(old?.startedAt || now)
    : (old?.startedAt || now) + settings.windowMs;
  if (!old || now >= resetAt) {
    const fresh = { startedAt: now, used: 0, blockedUntil: old?.blockedUntil || 0 };
    buckets.set(settings.key, fresh);
    return fresh;
  }
  return old;
}

export function canUseLegalProvider(
  provider: AIProvider, model: string, maxTokens = 450, prompt = '',
): boolean {
  const settings = bucketSettings(provider, model, maxTokens, prompt);
  if (!settings) return true;
  const bucket = readBucket(settings, Date.now());
  const tokens = groqTokenSettings(provider, maxTokens, prompt);
  const tokenBucket = tokens ? readBucket(tokens, Date.now()) : null;
  return Date.now() >= bucket.blockedUntil && bucket.used + settings.cost <= settings.limit
    && (!tokens || !tokenBucket || tokenBucket.used + tokens.cost <= tokens.limit);
}

export function reserveLegalProvider(
  provider: AIProvider, model: string, maxTokens: number, prompt: string,
): boolean {
  const settings = bucketSettings(provider, model, maxTokens, prompt);
  if (!settings) return true;
  const bucket = readBucket(settings, Date.now());
  const tokens = groqTokenSettings(provider, maxTokens, prompt);
  const tokenBucket = tokens ? readBucket(tokens, Date.now()) : null;
  if (Date.now() < bucket.blockedUntil || bucket.used + settings.cost > settings.limit
    || (tokens && tokenBucket && tokenBucket.used + tokens.cost > tokens.limit)) return false;
  bucket.used += settings.cost;
  if (tokens && tokenBucket) tokenBucket.used += tokens.cost;
  return true;
}

export function noteLegalProviderError(
  provider: AIProvider, model: string, error: unknown,
): void {
  const settings = bucketSettings(provider, model, 0, '');
  if (!settings) return;
  const bucket = readBucket(settings, Date.now());
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (provider === AIProvider.MISTRAL && /0 requests\/minute|limit-req-minute.*0/.test(message)) {
    bucket.blockedUntil = Date.now() + DAY;
  } else if (provider === AIProvider.GEMINI && /429|quota|resource_exhausted/.test(message)) {
    bucket.blockedUntil = nextPacificMidnight(Date.now());
  } else if (/402|payment required|insufficient credit/.test(message)) {
    bucket.blockedUntil = Date.now() + DAY;
  } else if (/429|rate limit|quota/.test(message)) {
    bucket.blockedUntil = Date.now() + MINUTE;
  } else if (/no permitted capability-compatible/.test(message)) {
    bucket.blockedUntil = Date.now() + 30 * MINUTE;
  }
}
