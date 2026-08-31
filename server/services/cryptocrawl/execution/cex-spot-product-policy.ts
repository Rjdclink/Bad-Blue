import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/cex-private-authority.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { normalizeCoinbaseExecutablePlan } from './coinbase-executable-plan-policy.js';
import { floorToIncrement, isIncrementAligned } from './coinbase-product-policy.js';

export type ConstrainedSpotVenue = 'kraken' | 'okx';

export interface SpotProductConstraints {
  venue: ConstrainedSpotVenue;
  symbol: string;
  exchangeSymbol: string;
  baseIncrement: number;
  priceIncrement: number;
  baseMinSize: number;
  quoteMinSize: number | null;
  /** Per-order maximums from the live venue contract; null means not published here. */
  baseMaxSize: number | null;
  quoteMaxSize: number | null;
  state: 'live';
  observedAt: number;
  source: 'kraken_asset_pairs' | 'okx_public_instruments';
}

interface ConstraintSnapshot {
  expiresAt: number;
  values: Map<string, SpotProductConstraints>;
}

const TTL_MS = Math.max(5_000, Math.min(300_000, Number(process.env.CRYPTO_CEX_PRODUCT_CONSTRAINT_TTL_MS || 60_000)));
const TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.CRYPTO_CEX_PRODUCT_CONSTRAINT_TIMEOUT_MS || 4_000)));
let krakenSnapshot: ConstraintSnapshot | null = null;
let krakenInFlight: Promise<ConstraintSnapshot> | null = null;
let okxSnapshot: ConstraintSnapshot | null = null;
let okxInFlight: Promise<ConstraintSnapshot> | null = null;

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function canonicalAsset(value: unknown): string | null {
  let asset = String(value ?? '').trim().toUpperCase();
  if (!asset) return null;
  asset = asset.replace(/[^A-Z0-9]/g, '');
  if (!asset) return null;
  if (asset === 'XBT') return 'BTC';
  if (asset === 'XDG') return 'DOGE';
  return asset;
}

function canonicalKrakenAsset(value: unknown): string | null {
  let asset = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!asset) return null;
  // Kraken's legacy asset codes commonly prefix old assets/currencies with X/Z.
  // Strip only the known one-character legacy namespace shape; never infer a
  // quote currency from a suffix list.
  if ((asset.startsWith('X') || asset.startsWith('Z')) && asset.length === 4) asset = asset.slice(1);
  if (asset === 'XBT') return 'BTC';
  if (asset === 'XDG') return 'DOGE';
  return canonicalAsset(asset);
}

function canonicalPair(baseInput: unknown, quoteInput: unknown, kraken = false): string | null {
  const normalize = kraken ? canonicalKrakenAsset : canonicalAsset;
  const base = normalize(baseInput);
  const quote = normalize(quoteInput);
  if (!base || !quote) return null;
  return `${base}${quote}`;
}

function canonicalDelimitedPair(value: unknown, kraken = false): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  const parts = raw.split(/[\/_-]/).filter(Boolean);
  return parts.length === 2 ? canonicalPair(parts[0], parts[1], kraken) : null;
}

/**
 * Lookup normalization accepts any live base/quote combination. Concatenated
 * canonical symbols are preserved; venue aliases are normalized only where the
 * mapping is deterministic. Product support itself comes from the live snapshot.
 */
function canonicalLookupSymbol(value: string): string | null {
  const delimited = canonicalDelimitedPair(value);
  if (delimited) return delimited;
  let compact = value.trim().toUpperCase().replace(/[\/_-]/g, '');
  if (!compact || !/^[A-Z0-9]+$/.test(compact)) return null;
  if (compact.startsWith('XBT')) compact = `BTC${compact.slice(3)}`;
  if (compact.startsWith('XDG')) compact = `DOGE${compact.slice(3)}`;
  return compact;
}

function canonicalKrakenProduct(row: Record<string, unknown>): string | null {
  const fromWsName = canonicalDelimitedPair(row.wsname, true);
  if (fromWsName) return fromWsName;
  return canonicalPair(row.base, row.quote, true);
}

function canonicalOkxProduct(raw: Record<string, unknown>): string | null {
  const fromFields = canonicalPair(raw.baseCcy, raw.quoteCcy);
  if (fromFields) return fromFields;
  return canonicalDelimitedPair(raw.instId);
}

function powerOfTenIncrement(decimals: unknown): number | null {
  const parsed = Number(decimals);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 18) return null;
  return 10 ** -parsed;
}

async function fetchKrakenSnapshot(): Promise<ConstraintSnapshot> {
  if (krakenSnapshot && krakenSnapshot.expiresAt > Date.now()) return krakenSnapshot;
  if (krakenInFlight) return krakenInFlight;
  krakenInFlight = (async () => {
    const payload = await fetchJsonWithRetry<any>('https://api.kraken.com/0/public/AssetPairs', {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: TIMEOUT_MS,
    });
    if (Array.isArray(payload?.error) && payload.error.length > 0) {
      throw new Error(`Kraken AssetPairs constraint request failed: ${payload.error.join(', ')}`);
    }
    const values = new Map<string, SpotProductConstraints>();
    const ambiguous = new Set<string>();
    const rows = payload?.result && typeof payload.result === 'object' ? payload.result : {};
    const observedAt = Date.now();
    for (const [responseKey, raw] of Object.entries(rows)) {
      const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
      if (!row) continue;
      const state = typeof row.status === 'string' ? row.status.trim().toLowerCase() : 'online';
      if (state !== 'online') continue;
      const exchangeSymbol = typeof row.altname === 'string' && row.altname.trim() ? row.altname.trim().toUpperCase() : responseKey;
      const symbol = canonicalKrakenProduct(row);
      if (!symbol || ambiguous.has(symbol)) continue;
      const baseIncrement = powerOfTenIncrement(row.lot_decimals);
      const priceIncrement = powerOfTenIncrement(row.pair_decimals);
      const baseMinSize = positive(row.ordermin);
      if (baseIncrement === null || priceIncrement === null || baseMinSize === null) continue;
      const constraint: SpotProductConstraints = {
        venue: 'kraken',
        symbol,
        exchangeSymbol,
        baseIncrement,
        priceIncrement,
        baseMinSize,
        quoteMinSize: positive(row.costmin),
        // Kraken AssetPairs does not publish one universal single-order maximum.
        // Do not invent one; parent measured depth/inventory remains authoritative.
        baseMaxSize: null,
        quoteMaxSize: null,
        state: 'live',
        observedAt,
        source: 'kraken_asset_pairs',
      };
      if (values.has(symbol)) {
        values.delete(symbol);
        ambiguous.add(symbol);
      } else {
        values.set(symbol, constraint);
      }
    }
    const snapshot = { expiresAt: Date.now() + TTL_MS, values };
    krakenSnapshot = snapshot;
    logger.info('[CEX Product] Kraken SPOT constraints refreshed', {
      component: 'CexSpotProductPolicy',
      products: values.size,
      ambiguous: ambiguous.size,
      canonicalizationAuthority: 'live_base_quote_fields_or_wsname',
      quoteCurrencyAllowlistUsed: false,
      unpublishedSingleOrderMaxTreatedAsUnlimited: true,
    });
    return snapshot;
  })().finally(() => { krakenInFlight = null; });
  return krakenInFlight;
}

async function fetchOkxSnapshot(): Promise<ConstraintSnapshot> {
  if (okxSnapshot && okxSnapshot.expiresAt > Date.now()) return okxSnapshot;
  if (okxInFlight) return okxInFlight;
  okxInFlight = (async () => {
    const baseUrl = await getOkxExecutionRestBaseUrl();
    const payload = await fetchJsonWithRetry<any>(`${baseUrl}/api/v5/public/instruments?instType=SPOT`, {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: TIMEOUT_MS,
    });
    if (String(payload?.code) !== '0') throw new Error(`OKX SPOT instrument constraints failed: ${String(payload?.code)} ${String(payload?.msg || '')}`.trim());
    const values = new Map<string, SpotProductConstraints>();
    const observedAt = Date.now();
    for (const rawValue of Array.isArray(payload?.data) ? payload.data : []) {
      const raw = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null;
      if (!raw) continue;
      const exchangeSymbol = typeof raw.instId === 'string' ? raw.instId.trim().toUpperCase() : '';
      const symbol = canonicalOkxProduct(raw);
      if (!symbol) continue;
      const state = typeof raw.state === 'string' ? raw.state.trim().toLowerCase() : '';
      if (state !== 'live') continue;
      const baseIncrement = positive(raw.lotSz);
      const priceIncrement = positive(raw.tickSz);
      const baseMinSize = positive(raw.minSz);
      if (baseIncrement === null || priceIncrement === null || baseMinSize === null) continue;
      values.set(symbol, {
        venue: 'okx',
        symbol,
        exchangeSymbol,
        baseIncrement,
        priceIncrement,
        baseMinSize,
        quoteMinSize: null,
        // OKX documents these as current per-order maximums for SPOT. They are
        // child-order split inputs, never a parent strategy/notional ceiling.
        baseMaxSize: positive(raw.maxLmtSz),
        quoteMaxSize: positive(raw.maxLmtAmt),
        state: 'live',
        observedAt,
        source: 'okx_public_instruments',
      });
    }
    const snapshot = { expiresAt: Date.now() + TTL_MS, values };
    okxSnapshot = snapshot;
    logger.info('[CEX Product] OKX regional SPOT constraints refreshed', {
      component: 'CexSpotProductPolicy',
      baseUrl,
      products: values.size,
      canonicalizationAuthority: 'live_baseCcy_quoteCcy_fields',
      quoteCurrencyAllowlistUsed: false,
      perOrderMaximumsCaptured: true,
    });
    return snapshot;
  })().finally(() => { okxInFlight = null; });
  return okxInFlight;
}

export async function getSpotProductConstraints(venue: ConstrainedSpotVenue, symbolInput: string): Promise<SpotProductConstraints> {
  const symbol = canonicalLookupSymbol(symbolInput);
  if (!symbol) throw new Error(`Unsupported ${venue} SPOT symbol ${symbolInput}`);
  const snapshot = venue === 'kraken' ? await fetchKrakenSnapshot() : await fetchOkxSnapshot();
  const constraint = snapshot.values.get(symbol);
  if (!constraint) throw new Error(`${venue} SPOT product ${symbol} has no current live execution constraints`);
  return { ...constraint };
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) {
    const [coefficient, exponentText] = text.split('e-');
    const exponent = Number(exponentText);
    const fractional = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
    return exponent + fractional;
  }
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcd(a, b)) * b;
}

function commonIncrement(increments: number[]): number | null {
  if (increments.length === 0 || increments.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const scalePlaces = Math.min(18, Math.max(...increments.map(decimalPlaces)));
  const scale = 10 ** scalePlaces;
  if (!Number.isSafeInteger(scale)) return null;
  const units = increments.map(value => BigInt(Math.round(value * scale)));
  if (units.some(value => value <= 0n)) return null;
  const commonUnits = units.reduce((current, value) => lcm(current, value));
  const numeric = Number(commonUnits) / scale;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function feeBps(plan: VerifiedArbitragePlan, side: 'buy' | 'sell'): number | null {
  const evidence = side === 'buy' ? plan.feeEvidence?.buy : plan.feeEvidence?.sell;
  const value = Number(evidence?.takerFeeBps);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function recomputeEconomics(plan: VerifiedArbitragePlan, baseQty: number): VerifiedArbitragePlan | null {
  const buyBps = feeBps(plan, 'buy');
  const sellBps = feeBps(plan, 'sell');
  if (buyBps === null || sellBps === null) return null;
  const acquisitionCostUsd = baseQty * plan.buyAsk;
  const proceedsUsd = baseQty * plan.sellBid;
  const buyFeeUsd = acquisitionCostUsd * buyBps / 10_000;
  const sellFeeUsd = proceedsUsd * sellBps / 10_000;
  const fixedCostsUsd = plan.costs.gasUsd + plan.costs.bridgeFeeUsd + (plan.costs.transferFeeUsd ?? 0);
  const totalCostsUsd = buyFeeUsd + sellFeeUsd + fixedCostsUsd;
  const grossProfitUsd = proceedsUsd - acquisitionCostUsd;
  const netProfitUsd = grossProfitUsd - totalCostsUsd;
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) return null;
  return {
    ...plan,
    baseQty,
    notionalUsd: acquisitionCostUsd,
    executableNotionalUsd: acquisitionCostUsd,
    grossProfitUsd,
    netProfitUsd,
    costs: { ...plan.costs, buyFeeUsd, sellFeeUsd, totalCostsUsd },
  };
}

function validateLeg(
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  constraints: SpotProductConstraints,
): string | null {
  if (!isIncrementAligned(quantity, constraints.baseIncrement)) return `${constraints.venue} ${side} quantity is off lot increment ${constraints.baseIncrement}`;
  if (!isIncrementAligned(price, constraints.priceIncrement)) return `${constraints.venue} ${side} price is off tick increment ${constraints.priceIncrement}`;
  if (quantity + constraints.baseIncrement * 1e-7 < constraints.baseMinSize) return `${constraints.venue} ${side} quantity is below minimum ${constraints.baseMinSize}`;
  if (constraints.quoteMinSize !== null && quantity * price + constraints.priceIncrement * constraints.baseIncrement < constraints.quoteMinSize) {
    return `${constraints.venue} ${side} notional is below quote minimum ${constraints.quoteMinSize}`;
  }
  // Per-order maximums are intentionally not checked on the parent here. The
  // hyper-hybrid executor will split a verified parent into legal child orders.
  return null;
}

/**
 * Normalize the canonical CEX PARENT plan to the intersection of participating
 * venue lot-size constraints before Cryptara eligibility. Book prices are never
 * rounded: off-tick evidence fails closed. Per-order maximums are not parent
 * ceilings; they are preserved as live child-splitting inputs at execution.
 */
export async function normalizeCexExecutablePlan(input: VerifiedArbitragePlan): Promise<VerifiedArbitragePlan | null> {
  let plan = await normalizeCoinbaseExecutablePlan(input);
  if (!plan) return null;

  const constraints: Array<{ side: 'buy' | 'sell'; value: SpotProductConstraints }> = [];
  if (plan.buyVenue === 'kraken' || plan.buyVenue === 'okx') {
    constraints.push({ side: 'buy', value: await getSpotProductConstraints(plan.buyVenue, plan.symbol) });
  }
  if (plan.sellVenue === 'kraken' || plan.sellVenue === 'okx') {
    constraints.push({ side: 'sell', value: await getSpotProductConstraints(plan.sellVenue, plan.symbol) });
  }
  if (constraints.length === 0) return plan;

  const increment = commonIncrement(constraints.map(entry => entry.value.baseIncrement));
  if (increment === null) return null;
  const normalizedQty = floorToIncrement(plan.baseQty, increment);
  if (!(normalizedQty > 0)) return null;

  for (const entry of constraints) {
    const price = entry.side === 'buy' ? (plan.buyLimitPrice ?? plan.buyAsk) : (plan.sellLimitPrice ?? plan.sellBid);
    if (!(price > 0) || validateLeg(entry.side, normalizedQty, price, entry.value)) return null;
  }

  if (Math.abs(normalizedQty - plan.baseQty) <= Math.max(increment * 1e-8, Number.EPSILON * plan.baseQty * 16)) return plan;
  plan = recomputeEconomics(plan, normalizedQty);
  return plan;
}
