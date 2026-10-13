type Admission = 'allowed' | 'quota-exhausted' | 'budget-unavailable' | 'rate-limit';
interface Refresh {
  controller: AbortController;
  waiters: number;
  promise: Promise<void>;
}

/** Process-local admission for one-credit basic searches. Provider limits remain authoritative.
 * GET /usage schema: https://docs.tavily.com/documentation/api-reference/endpoint/usage
 * No plan, pay-as-you-go, credential or account setting is changed here.
 */
export class TavilyBudget {
  private key = '';
  private generation = 0;
  private refreshedAt = -Infinity;
  private available = false;
  private remaining = 0;
  private estimatedKeyUsage = 0;
  private estimatedAccountUsage = 0;
  private pending?: Refresh;
  private requests: number[] = [];
  constructor(private readonly loadUsage: (key: string, signal: AbortSignal) => Promise<unknown>,
    private readonly now = () => Date.now()) {}

  reset(): void {
    this.generation++;
    this.pending?.controller.abort(new DOMException('Budget reset', 'AbortError'));
    this.key = ''; this.refreshedAt = -Infinity; this.available = false; this.remaining = 0;
    this.estimatedKeyUsage = this.estimatedAccountUsage = 0;
    this.pending = undefined; this.requests = [];
  }

  private refresh(key: string): Refresh {
    this.refreshedAt = this.now(); this.available = false;
    const generation = this.generation;
    const controller = new AbortController();
    const refresh: Refresh = { controller, waiters: 0, promise: Promise.resolve() };
    const timer = setTimeout(() => controller.abort(new DOMException('Usage deadline', 'TimeoutError')), 2_000);
    refresh.promise = (async () => {
      let onAbort!: () => void;
      try {
        // A usage lookup belongs to all its waiters, not the first HTTP request.
        const cancelled = new Promise<never>((_, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        const payload: any = await Promise.race([this.loadUsage(key, controller.signal), cancelled]);
        if (this.generation !== generation || controller.signal.aborted) return;
        const values = [payload?.key?.usage, payload?.key?.limit, payload?.account?.plan_usage,
          payload?.account?.plan_limit, payload?.account?.paygo_usage, payload?.account?.paygo_limit];
        if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) return;
        const [keyUsage, keyLimit, planUsage, planLimit, paygoUsage, paygoLimit] = values;
        // Conservative high-water accounting: stale snapshots must not restore reservations.
        // A billing-cycle decrease requires a process reset; do not guess a renewal date.
        this.estimatedKeyUsage = Math.max(this.estimatedKeyUsage, keyUsage);
        this.estimatedAccountUsage = Math.max(this.estimatedAccountUsage, planUsage + paygoUsage);
        this.remaining = Math.max(0, Math.floor(Math.min(keyLimit - this.estimatedKeyUsage,
          Math.max(0, planLimit - planUsage) + Math.max(0, paygoLimit - paygoUsage)
            - Math.max(0, this.estimatedAccountUsage - planUsage - paygoUsage))));
        this.available = true;
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        if (this.pending === refresh) this.pending = undefined;
      }
    })();
    this.pending = refresh;
    return refresh;
  }

  private waitFor(refresh: Refresh, signal: AbortSignal): Promise<void> {
    refresh.waiters++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        refresh.waiters--;
        if (!refresh.waiters && this.pending === refresh) {
          // No caller remains. Cancel work and allow the next caller to retry.
          this.generation++;
          this.pending = undefined; this.refreshedAt = -Infinity; this.available = false;
          refresh.controller.abort(new DOMException('No budget waiters', 'AbortError'));
        }
        error === undefined ? resolve() : reject(error);
      };
      const abort = () => done(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      refresh.promise.then(() => done(), error => done(error));
      if (signal.aborted) abort();
    });
  }

  async reserve(key: string, signal: AbortSignal): Promise<Admission> {
    signal.throwIfAborted();
    if (this.key !== key) { this.reset(); this.key = key; }
    const generation = this.generation;
    // At most ten usage lookups per ten minutes, including failed lookups.
    const pending = this.pending ?? (this.now() - this.refreshedAt >= 65_000 ? this.refresh(key) : undefined);
    if (pending) await this.waitFor(pending, signal);
    signal.throwIfAborted();
    if (this.generation !== generation || !this.available) return 'budget-unavailable';
    if (this.remaining < 1) return 'quota-exhausted';
    const now = this.now();
    this.requests = this.requests.filter(time => now - time < 60_000);
    if (this.requests.length >= 90) return 'rate-limit';
    this.requests.push(now); this.remaining--; this.estimatedKeyUsage++; this.estimatedAccountUsage++;
    return 'allowed';
  }
}
