import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/cex-private-authority.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { isIncrementAligned } from './coinbase-product-policy.js';

interface FreshConstraint {
  venue: 'kraken' | 'okx';
  symbol: string;
  baseIncrement: number;
  priceIncrement: number;
  baseMinSize: number;
  quoteMinSize: number | null;
}

const TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.CRYPTO_CEX_PRODUCT_CONSTRAINT_TIMEOUT_MS || 4_000)));

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function canonicalSymbol(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\/_-]/g, '');
  const match = compact.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!match) return null;
  let base = match[1];
  if (base === 'XBT') base = 'BTC';
  if (base === 'XDG') base = 'DOGE';
  return `${base}${match[2]}`;
}

function powerOfTenIncrement(decimals: unknown): number | null {
  const parsed = Number(decimals);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 18) return null;
  return 10 ** -parsed;
}

async function fetchFreshKrakenConstraint(symbolInput: string): Promise<FreshConstraint> {
  const symbol = canonicalSymbol(symbolInput);
  if (!symbol) throw new Error(`REJECT_PRODUCT_DRIFT: unsupported Kraken SPOT symbol ${symbolInput}`);
  const payload = await fetchJsonWithRetry<any>('https://api.kraken.com/0/public/AssetPairs', {
    init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 500,
    timeoutMs: TIMEOUT_MS,
  });
  if (Array.isArray(payload?.error) && payload.error.length > 0) {
    throw new Error(`REJECT_PRODUCT_DRIFT: Kraken AssetPairs refresh failed: ${payload.error.join(', ')}`);
  }
  const matches: FreshConstraint[] = [];
  const rows = payload?.result && typeof payload.result === 'object' ? payload.result : {};
  for (const raw of Object.values(rows)) {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!row) continue;
    const rowSymbol = canonicalSymbol(String(row.altname || row.wsname || ''));
    if (rowSymbol !== symbol) continue;
    const state = typeof row.status === 'string' ? row.status.trim().toLowerCase() : 'online';
    if (state !== 'online') continue;
    const baseIncrement = powerOfTenIncrement(row.lot_decimals);
    const priceIncrement = powerOfTenIncrement(row.pair_decimals);
    const baseMinSize = positive(row.ordermin);
    if (baseIncrement === null || priceIncrement === null || baseMinSize === null) continue;
    matches.push({
      venue: 'kraken',
      symbol,
      baseIncrement,
      priceIncrement,
      baseMinSize,
      quoteMinSize: positive(row.costmin),
    });
  }
  if (matches.length !== 1) {
    throw new Error(`REJECT_PRODUCT_DRIFT: Kraken ${symbol} has ${matches.length} unambiguous live constraint records`);
  }
  return matches[0];
}

async function fetchFreshOkxConstraint(symbolInput: string): Promise<FreshConstraint> {
  const symbol = canonicalSymbol(symbolInput);
  if (!symbol) throw new Error(`REJECT_PRODUCT_DRIFT: unsupported OKX SPOT symbol ${symbolInput}`);
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const compact = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!compact) throw new Error(`REJECT_PRODUCT_DRIFT: unsupported OKX SPOT symbol ${symbolInput}`);
  const instId = `${compact[1]}-${compact[2]}`;
  const payload = await fetchJsonWithRetry<any>(`${baseUrl}/api/v5/public/instruments?instType=SPOT&instId=${encodeURIComponent(instId)}`, {
    init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 500,
    timeoutMs: TIMEOUT_MS,
  });
  if (String(payload?.code) !== '0') {
    throw new Error(`REJECT_PRODUCT_DRIFT: OKX instrument refresh failed: ${String(payload?.code)} ${String(payload?.msg || '')}`.trim());
  }
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const row = rows.find((value: any) => String(value?.instId || '').trim().toUpperCase() === instId);
  if (!row || String(row.state || '').trim().toLowerCase() !== 'live') {
    throw new Error(`REJECT_PRODUCT_DRIFT: OKX ${instId} is not live at submission time`);
  }
  const baseIncrement = positive(row.lotSz);
  const priceIncrement = positive(row.tickSz);
  const baseMinSize = positive(row.minSz);
  if (baseIncrement === null || priceIncrement === null || baseMinSize === null) {
    throw new Error(`REJECT_PRODUCT_DRIFT: OKX ${instId} returned incomplete execution constraints`);
  }
  return { venue: 'okx', symbol, baseIncrement, priceIncrement, baseMinSize, quoteMinSize: null };
}

function validateLeg(side: 'buy' | 'sell', quantity: number, price: number, constraint: FreshConstraint): void {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} order values are invalid`);
  }
  if (!isIncrementAligned(quantity, constraint.baseIncrement)) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} quantity no longer aligns to lot increment ${constraint.baseIncrement}`);
  }
  if (!isIncrementAligned(price, constraint.priceIncrement)) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} price no longer aligns to tick increment ${constraint.priceIncrement}`);
  }
  if (quantity + constraint.baseIncrement * 1e-7 < constraint.baseMinSize) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} quantity is below current minimum ${constraint.baseMinSize}`);
  }
  if (constraint.quoteMinSize !== null && quantity * price + constraint.baseIncrement * constraint.priceIncrement < constraint.quoteMinSize) {
    throw new Error(`REJECT_PRODUCT_DRIFT: ${constraint.venue} ${side} notional is below current quote minimum ${constraint.quoteMinSize}`);
  }
}

/**
 * Re-fetch live venue constraints immediately before order submission. This is
 * intentionally validation-only: after Monte Carlo/risk approval we never resize,
 * round, or otherwise mutate the plan. Any product drift fails closed and forces
 * the opportunity back through discovery/economics/MC with fresh evidence.
 */
export async function assertFreshCexProductConstraints(plan: VerifiedArbitragePlan): Promise<void> {
  const checks: Array<Promise<{ side: 'buy' | 'sell'; constraint: FreshConstraint }>> = [];
  if (plan.buyVenue === 'kraken') checks.push(fetchFreshKrakenConstraint(plan.symbol).then(constraint => ({ side: 'buy' as const, constraint })));
  if (plan.buyVenue === 'okx') checks.push(fetchFreshOkxConstraint(plan.symbol).then(constraint => ({ side: 'buy' as const, constraint })));
  if (plan.sellVenue === 'kraken') checks.push(fetchFreshKrakenConstraint(plan.symbol).then(constraint => ({ side: 'sell' as const, constraint })));
  if (plan.sellVenue === 'okx') checks.push(fetchFreshOkxConstraint(plan.symbol).then(constraint => ({ side: 'sell' as const, constraint })));

  const constraints = await Promise.all(checks);
  for (const { side, constraint } of constraints) {
    const price = side === 'buy' ? (plan.buyLimitPrice ?? plan.buyAsk) : (plan.sellLimitPrice ?? plan.sellBid);
    validateLeg(side, plan.baseQty, price, constraint);
  }
}
