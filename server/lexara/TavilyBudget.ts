/** Process-local admission for one-credit basic searches. No account settings change. */
export class TavilyBudget {
  private key = '';
  private refreshedAt = -Infinity;
  private available = false;
  private remaining = 0;
  private estimatedKeyUsage = 0;
  private estimatedAccountUsage = 0;
  private pending?: Promise<void>;
  private requests: number[] = [];
  constructor(private readonly loadUsage: (key: string, signal: AbortSignal) => Promise<unknown>,
    private readonly now = () => Date.now()) {}
  reset(): void {
    this.key = ''; this.refreshedAt = -Infinity; this.available = false; this.remaining = 0;
    this.estimatedKeyUsage = this.estimatedAccountUsage = 0;
    this.pending = undefined; this.requests = [];
  }
  async reserve(key: string, signal: AbortSignal): Promise<'allowed' | 'quota-exhausted' | 'budget-unavailable' | 'rate-limit'> {
    signal.throwIfAborted();
    if (this.key !== key) { this.reset(); this.key = key; }
    // At most ten usage lookups per ten minutes in this process, including failures.
    if (this.now() - this.refreshedAt >= 65_000 && !this.pending) {
      this.refreshedAt = this.now(); this.available = false;
      const currentKey = key;
      this.pending = (async () => {
        const payload: any = await this.loadUsage(key, signal);
        if (this.key !== currentKey) return;
        const values = [payload?.key?.usage, payload?.key?.limit, payload?.account?.plan_usage,
          payload?.account?.plan_limit, payload?.account?.paygo_usage, payload?.account?.paygo_limit];
        if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return;
        const [keyUsage, keyLimit, planUsage, planLimit, paygoUsage, paygoLimit] = values;
        // Delayed provider accounting cannot restore credits already reserved locally.
        this.estimatedKeyUsage = Math.max(this.estimatedKeyUsage, keyUsage);
        this.estimatedAccountUsage = Math.max(this.estimatedAccountUsage, planUsage + paygoUsage);
        this.remaining = Math.max(0, Math.floor(Math.min(keyLimit - this.estimatedKeyUsage,
          planLimit + paygoLimit - this.estimatedAccountUsage)));
        this.available = true;
      })().finally(() => { if (this.key === currentKey) this.pending = undefined; });
    }
    await this.pending;
    signal.throwIfAborted();
    if (this.key !== key || !this.available) return 'budget-unavailable';
    if (this.remaining < 1) return 'quota-exhausted';
    const now = this.now();
    this.requests = this.requests.filter(time => now - time < 60_000);
    if (this.requests.length >= 90) return 'rate-limit';
    this.requests.push(now); this.remaining--; this.estimatedKeyUsage++; this.estimatedAccountUsage++;
    return 'allowed';
  }
}
