import { coinGeckoPriceClient } from './coingecko-client.js';
import { isCryptoCrawlerMasterPowerOn } from '../runtime/manual-power-state.js';
import {
  createZeroCapitalPriceEvidence,
  getFreshZeroCapitalPriceEvidence,
  type ZeroCapitalPriceEvidence,
} from '../core/zero-capital-price-evidence.js';

/**
 * Provider-neutral live USD price authority used by execution economics.
 *
 * Latency rule: hot stablecoin evidence is kept resident before APE needs it;
 * overlapping refreshes collapse per symbol; fresh resident reads never wait.
 */
class LivePriceMesh {
  private readonly residentEvidence = new Map<string, Readonly<ZeroCapitalPriceEvidence>>();
  private readonly symbolRefreshInFlight = new Map<string, Promise<void>>();
  private readonly hotSymbols = ['USDC', 'USDT'] as const;
  private residentPlaneStarted = false;
  private residentPlaneTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startResidentPricePlane();
  }

  private liveCacheTtlMs(): number {
    const configured = Number(process.env.LIVE_PRICE_CACHE_TTL_MS || 3_000);
    return Number.isFinite(configured)
      ? Math.max(500, Math.min(15_000, Math.trunc(configured)))
      : 3_000;
  }

  private evidenceMaxAgeMs(): number {
    const configured = Number(process.env.ZERO_CAPITAL_PRICE_EVIDENCE_MAX_AGE_MS || 5_000);
    return Number.isFinite(configured)
      ? Math.max(500, Math.min(30_000, Math.trunc(configured)))
      : 5_000;
  }

  private backgroundRefreshLeadMs(): number {
    const configured = Number(process.env.ZERO_CAPITAL_PRICE_RESIDENT_REFRESH_LEAD_MS || 1_500);
    return Number.isFinite(configured)
      ? Math.max(250, Math.min(5_000, Math.trunc(configured)))
      : 1_500;
  }

  private backgroundCadenceMs(): number {
    const ttl = this.evidenceMaxAgeMs();
    return Math.max(500, Math.min(2_000, Math.trunc(ttl / 3)));
  }

  private normalizedSymbols(symbols: readonly string[]): string[] {
    return [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].sort();
  }

  private publishResidentEvidence(prices: ReadonlyMap<string, number>): void {
    const receivedAt = Date.now();
    const conservativeObservedAt = Math.max(0, receivedAt - this.liveCacheTtlMs());
    const expiresAt = conservativeObservedAt + this.evidenceMaxAgeMs();

    for (const [rawSymbol, rawPrice] of prices) {
      const symbol = rawSymbol.trim().toUpperCase();
      const priceUsd = Number(rawPrice);
      if (!symbol || !Number.isFinite(priceUsd) || priceUsd <= 0 || expiresAt <= receivedAt) continue;
      this.residentEvidence.set(symbol, createZeroCapitalPriceEvidence({
        priceUsd,
        observedAt: conservativeObservedAt,
        expiresAt,
        source: 'live_price_mesh',
      }));
    }
  }

  private needsRefresh(symbol: string, now = Date.now()): boolean {
    const evidence = this.residentEvidence.get(symbol);
    if (!evidence) return true;
    return evidence.expiresAt - now <= this.backgroundRefreshLeadMs();
  }

  /** Start one immediate warmup and then refresh only near expiry. Timers are unref'd. */
  private startResidentPricePlane(): void {
    if (this.residentPlaneStarted) return;
    this.residentPlaneStarted = true;
    const tick = () => {
      // CryptoCrawler price residency is subordinate to the manual master power.
      // Keep the module import-safe for LegalWhat/Pantheon/Lexara: while OFF it
      // performs no crypto provider I/O and consumes no recurring crypto work.
      if (!isCryptoCrawlerMasterPowerOn()) return;
      const now = Date.now();
      const due = this.hotSymbols.filter(symbol => this.needsRefresh(symbol, now));
      if (due.length > 0) this.primeResidentSymbolPrices(due);
    };
    const initial = setTimeout(tick, 0);
    initial.unref?.();
    this.residentPlaneTimer = setInterval(tick, this.backgroundCadenceMs());
    this.residentPlaneTimer.unref?.();
  }

  /**
   * Launches at most one provider request for symbols not already represented by an
   * in-flight refresh. Overlapping callers reuse the same promise per symbol.
   */
  private ensureRefresh(symbols: readonly string[]): Promise<void>[] {
    if (!isCryptoCrawlerMasterPowerOn()) return [];
    const normalized = this.normalizedSymbols(symbols);
    const waiters: Promise<void>[] = [];
    const missing: string[] = [];

    for (const symbol of normalized) {
      const existing = this.symbolRefreshInFlight.get(symbol);
      if (existing) waiters.push(existing);
      else if (this.needsRefresh(symbol)) missing.push(symbol);
    }

    if (missing.length > 0) {
      let pending: Promise<void>;
      pending = coinGeckoPriceClient.getLiveSymbolPrices(missing)
        .then(prices => {
          this.publishResidentEvidence(prices);
        })
        .finally(() => {
          for (const symbol of missing) {
            if (this.symbolRefreshInFlight.get(symbol) === pending) this.symbolRefreshInFlight.delete(symbol);
          }
        });
      for (const symbol of missing) this.symbolRefreshInFlight.set(symbol, pending);
      waiters.push(pending);
    }

    return [...new Set(waiters)];
  }

  /** Fire-and-forget resident warmup for latency-critical callers. Never waits. */
  primeResidentSymbolPrices(symbols: readonly string[]): void {
    for (const pending of this.ensureRefresh(symbols)) void pending.catch(() => undefined);
  }

  /**
   * Return fresh resident prices immediately when present. Only missing/near-expiry
   * symbols await the coalesced provider mesh refresh; there is no batching timer.
   */
  async getLiveSymbolPrices(symbols: string[]): Promise<Map<string, number>> {
    const normalized = this.normalizedSymbols(symbols);
    if (normalized.length === 0 || !isCryptoCrawlerMasterPowerOn()) return new Map<string, number>();
    const waiters = this.ensureRefresh(normalized);
    if (waiters.length > 0) await Promise.all(waiters);

    const now = Date.now();
    const prices = new Map<string, number>();
    for (const symbol of normalized) {
      const evidence = this.peekLiveSymbolPriceEvidence(symbol, now);
      if (evidence) prices.set(symbol, evidence.priceUsd);
    }
    return prices;
  }

  /**
   * Synchronous resident-only price access for latency-critical consumers.
   * This never initiates a provider request, never waits, and never extends the
   * lifetime of the underlying market observation.
   */
  peekLiveSymbolPriceEvidence(
    symbol: string,
    now = Date.now(),
  ): Readonly<ZeroCapitalPriceEvidence> | null {
    const key = symbol.trim().toUpperCase();
    const evidence = this.residentEvidence.get(key);
    const fresh = getFreshZeroCapitalPriceEvidence(evidence, now);
    if (!fresh && evidence) this.residentEvidence.delete(key);
    return fresh;
  }

  getResidentPricePlaneSnapshot() {
    const now = Date.now();
    return {
      hotSymbols: [...this.hotSymbols],
      residentFreshSymbols: [...this.residentEvidence.keys()].filter(symbol => Boolean(this.peekLiveSymbolPriceEvidence(symbol, now))),
      inFlightSymbols: [...this.symbolRefreshInFlight.keys()],
      perSymbolSingleflight: true as const,
      backgroundNearExpiryRefresh: true as const,
      hotPathWaitForResidentHit: false as const,
    };
  }
}

export const livePriceMesh = new LivePriceMesh();
