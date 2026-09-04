import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { getOkxExecutionRestBaseUrl } from './okx-region-authority.js';

export interface OkxRpiTakerDepthLevel {
  price: number;
  quantity: number;
  organicQuantity: number;
  rpiQuantity: number;
}

export interface OkxRpiTakerDepthSnapshot {
  symbol: string;
  exchangeSymbol: string;
  observedAt: number;
  serverTimestamp: number | null;
  bids: OkxRpiTakerDepthLevel[];
  asks: OkxRpiTakerDepthLevel[];
  additionalRpiBidQuantity: number;
  additionalRpiAskQuantity: number;
  authority: 'okx_books_rpi_measured_execution_overlay';
  standardL2Authority: false;
  economicBpsAuthority: false;
  executionAuthority: false;
}

export interface OkxRpiTakerFillCheck {
  executable: boolean;
  quantity: number;
  notionalUsd: number;
  averagePrice: number | null;
  limitPrice: number | null;
  reason: string;
}

export interface OkxRpiTakerBenefit {
  useRpiTakerAccess: boolean;
  total: OkxRpiTakerFillCheck;
  organic: OkxRpiTakerFillCheck;
  measuredPriceImprovementBps: number;
  measuredAdditionalBaseQuantity: number;
  reason: string;
  authority: 'measured_submit_time_rpi_liquidity_choice';
  economicBpsAuthority: false;
  executionAuthority: false;
}

const RPI_DEPTH = 400;
const REQUEST_TIMEOUT_MS = Math.max(1_000, Math.min(8_000, Number(process.env.CRYPTO_OKX_RPI_TAKER_BOOK_TIMEOUT_MS || 3_000)));

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseLevels(raw: unknown, side: 'bid' | 'ask'): OkxRpiTakerDepthLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels = raw.flatMap(level => {
    if (!Array.isArray(level) || level.length < 3) return [];
    const price = finitePositive(level[0]);
    const total = finiteNonNegative(level[1]);
    const organic = finiteNonNegative(level[2]);
    if (price === null || total === null || organic === null || total <= 0 || organic > total + 1e-12) return [];
    return [{
      price,
      quantity: total,
      organicQuantity: organic,
      rpiQuantity: Math.max(0, total - organic),
    }];
  });
  return levels.sort((left, right) => side === 'bid' ? right.price - left.price : left.price - right.price);
}

function timestampMs(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 10_000_000_000 ? Math.round(parsed * 1_000) : Math.round(parsed);
}

/**
 * Fresh, measured OKX books-rpi overlay. Ordinary `books` / the canonical CEX
 * websocket remain standard L2 truth. This overlay exists only to compare an
 * explicitly RPI-accessible taker execution surface at the exact requested size.
 * It never invents BPS, grants execution authority, or satisfies missing venue
 * coverage by itself.
 */
export async function fetchFreshOkxRpiTakerDepth(
  symbolInput: string,
  maxAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)),
): Promise<OkxRpiTakerDepthSnapshot | null> {
  const [baseUrl, constraints] = await Promise.all([
    getOkxExecutionRestBaseUrl(),
    getSpotProductConstraints('okx', symbolInput, true),
  ]).catch(() => [null, null] as const);
  if (!baseUrl || !constraints) return null;

  const payload = await fetchJsonWithRetry<any>(
    `${baseUrl}/api/v5/market/books-rpi?instId=${encodeURIComponent(constraints.exchangeSymbol)}&sz=${RPI_DEPTH}`,
    {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 75,
      maxDelayMs: 300,
      timeoutMs: REQUEST_TIMEOUT_MS,
    },
  ).catch(() => null);
  if (!payload || String(payload?.code) !== '0') return null;
  const row = payload?.data?.[0];
  if (!row) return null;

  const bids = parseLevels(row.bids, 'bid');
  const asks = parseLevels(row.asks, 'ask');
  if (bids.length === 0 || asks.length === 0) return null;
  const observedAt = Date.now();
  const serverTimestamp = timestampMs(row.ts);
  if (serverTimestamp !== null) {
    if (serverTimestamp > observedAt + 1_000 || observedAt - serverTimestamp > Math.max(250, maxAgeMs)) return null;
  }

  return {
    symbol: constraints.symbol,
    exchangeSymbol: constraints.exchangeSymbol,
    observedAt,
    serverTimestamp,
    bids,
    asks,
    additionalRpiBidQuantity: bids.reduce((sum, level) => sum + level.rpiQuantity, 0),
    additionalRpiAskQuantity: asks.reduce((sum, level) => sum + level.rpiQuantity, 0),
    authority: 'okx_books_rpi_measured_execution_overlay',
    standardL2Authority: false,
    economicBpsAuthority: false,
    executionAuthority: false,
  };
}

function checkLevels(
  levels: readonly OkxRpiTakerDepthLevel[],
  quantityInput: number,
  plannedLimitPriceInput: number,
  side: 'buy' | 'sell',
  quantitySelector: (level: OkxRpiTakerDepthLevel) => number,
): OkxRpiTakerFillCheck {
  const quantity = Number(quantityInput);
  const plannedLimitPrice = Number(plannedLimitPriceInput);
  if (!(quantity > 0) || !(plannedLimitPrice > 0)) {
    return { executable: false, quantity: 0, notionalUsd: 0, averagePrice: null, limitPrice: null, reason: 'invalid_quantity_or_limit' };
  }

  let remaining = quantity;
  let filled = 0;
  let notionalUsd = 0;
  let worstPrice: number | null = null;
  for (const level of levels) {
    const withinLimit = side === 'buy'
      ? level.price <= plannedLimitPrice + 1e-12
      : level.price + 1e-12 >= plannedLimitPrice;
    if (!withinLimit) break;
    const available = Math.max(0, Number(quantitySelector(level)) || 0);
    const take = Math.min(remaining, available);
    if (take <= 0) continue;
    filled += take;
    notionalUsd += take * level.price;
    remaining -= take;
    worstPrice = level.price;
    if (remaining <= Math.max(1e-12, quantity * 1e-10)) break;
  }

  const executable = remaining <= Math.max(1e-12, quantity * 1e-10) && filled > 0;
  return {
    executable,
    quantity: filled,
    notionalUsd,
    averagePrice: filled > 0 ? notionalUsd / filled : null,
    limitPrice: worstPrice,
    reason: executable ? 'depth_within_planned_limit' : 'depth_insufficient_or_worse_than_planned_limit',
  };
}

/**
 * Submit-time protection only. Canonical profitability was already computed by
 * the verifier. This check proves the fresh books-rpi surface can still fill the
 * requested quantity at the same-or-better limit price; it never recomputes or
 * upgrades plan economics.
 */
export function checkOkxRpiTakerFill(input: {
  snapshot: OkxRpiTakerDepthSnapshot;
  side: 'buy' | 'sell';
  quantity: number;
  plannedLimitPrice: number;
}): OkxRpiTakerFillCheck {
  const levels = input.side === 'buy' ? input.snapshot.asks : input.snapshot.bids;
  const result = checkLevels(levels, input.quantity, input.plannedLimitPrice, input.side, level => level.quantity);
  return {
    ...result,
    reason: result.executable
      ? 'fresh_books_rpi_depth_within_planned_limit'
      : 'fresh_books_rpi_depth_insufficient_or_worse_than_planned_limit',
  };
}

/**
 * Compare the same fresh books-rpi frame with and without the incremental RPI
 * quantity. rpiTakerAccess is enabled only when the total surface is executable
 * at the already-verified limit and RPI adds measured executable depth or a
 * strictly better average price. This is an execution-choice observation only;
 * realized terminal fills remain the BPS/profit truth.
 */
export function evaluateOkxRpiTakerBenefit(input: {
  snapshot: OkxRpiTakerDepthSnapshot;
  side: 'buy' | 'sell';
  quantity: number;
  plannedLimitPrice: number;
}): OkxRpiTakerBenefit {
  const levels = input.side === 'buy' ? input.snapshot.asks : input.snapshot.bids;
  const total = checkLevels(levels, input.quantity, input.plannedLimitPrice, input.side, level => level.quantity);
  const organic = checkLevels(levels, input.quantity, input.plannedLimitPrice, input.side, level => level.organicQuantity);
  const measuredAdditionalBaseQuantity = input.side === 'buy'
    ? input.snapshot.additionalRpiAskQuantity
    : input.snapshot.additionalRpiBidQuantity;

  let measuredPriceImprovementBps = 0;
  if (total.executable && organic.executable && total.averagePrice !== null && organic.averagePrice !== null && organic.averagePrice > 0) {
    measuredPriceImprovementBps = input.side === 'buy'
      ? Math.max(0, (organic.averagePrice - total.averagePrice) / organic.averagePrice * 10_000)
      : Math.max(0, (total.averagePrice - organic.averagePrice) / organic.averagePrice * 10_000);
  }
  const addsExecutableDepth = total.executable && !organic.executable && measuredAdditionalBaseQuantity > 0;
  const improvesPrice = total.executable && measuredPriceImprovementBps > 1e-9;
  const useRpiTakerAccess = measuredAdditionalBaseQuantity > 0 && (addsExecutableDepth || improvesPrice);

  return {
    useRpiTakerAccess,
    total,
    organic,
    measuredPriceImprovementBps,
    measuredAdditionalBaseQuantity,
    reason: useRpiTakerAccess
      ? addsExecutableDepth ? 'measured_rpi_increment_makes_current_limit_fully_executable' : 'measured_rpi_increment_improves_current_average_price'
      : 'no_measured_submit_time_rpi_execution_benefit',
    authority: 'measured_submit_time_rpi_liquidity_choice',
    economicBpsAuthority: false,
    executionAuthority: false,
  };
}
