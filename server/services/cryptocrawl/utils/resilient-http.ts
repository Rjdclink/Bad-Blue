interface RetryableFetchOptions {
  init?: RequestInit;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  timeoutMs?: number;
  retryableStatusCodes?: number[];
  shouldRetryError?: (error: unknown) => boolean;
}

const DEFAULT_RETRYABLE_STATUS_CODES = [408, 409, 425, 429, 500, 502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | undefined {
  if (!retryAfterHeader) return undefined;

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const retryDate = Date.parse(retryAfterHeader);
  if (Number.isFinite(retryDate)) {
    return Math.max(0, retryDate - Date.now());
  }

  return undefined;
}

function calculateBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number
): number {
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitterSpan = exponentialDelay * Math.max(0, Math.min(jitterRatio, 1));
  const jitter = Math.floor((Math.random() * 2 - 1) * jitterSpan);
  return Math.max(baseDelayMs, exponentialDelay + jitter);
}

function defaultRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('temporarily unavailable')
  );
}

export async function fetchJsonWithRetry<T>(
  url: string,
  options: RetryableFetchOptions = {}
): Promise<T> {
  const {
    init,
    maxRetries = 4,
    baseDelayMs = 500,
    maxDelayMs = 15000,
    jitterRatio = 0.2,
    timeoutMs = 12000,
    retryableStatusCodes = DEFAULT_RETRYABLE_STATUS_CODES,
    shouldRetryError = defaultRetryableError,
  } = options;

  const retryableSet = new Set(retryableStatusCodes);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return await response.json() as T;
      }

      const retryable = retryableSet.has(response.status);
      if (!retryable || attempt === maxRetries) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const delayMs = retryAfterMs ?? calculateBackoffDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      await sleep(delayMs);
    } catch (error) {
      clearTimeout(timeout);

      const retryable = shouldRetryError(error);
      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      const delayMs = calculateBackoffDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      await sleep(delayMs);
    }
  }

  throw new Error('Retry loop exhausted unexpectedly');
}
