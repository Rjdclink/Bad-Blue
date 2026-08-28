import type { VerifiedArbitragePlan, QuoteVenue } from '../arbitrage/arbitrage-verifier.js';
import { resolveCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/cex-private-authority.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { floorToIncrement } from './coinbase-product-policy.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';

export type MakerLegMode = 'maker';

export type StablecoinMakerPlan = VerifiedArbitragePlan & {
  makerExecution: {
    strategy: 'stablecoin_post_only';
    buyMode: MakerLegMode;
    sellMode: MakerLegMode;
    ttlMs: number;
    takerFallbackAllowed: false;
    feeAuthority: 'authenticated';
    bookAuthority: 'websocket' | 'rest_fallback';
  };
};

type Book = {
  venue: 'kraken' | 'okx';
  bid: number;
  bidQty: number;
  ask: number;
  askQty: number;
  observedAt: number;
  authority: 'websocket' | 'rest_fallback';
};

const STABLECOIN_SYMBOLS = new Set(['USDGUSDT', 'USDCUSDT', 'DAIUSDT', 'RLUSDUSDT']);
const DEFAULT_TTL_MS = 30_000;

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function authenticatedMakerFeeBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Math.max(0, evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.max(0, evidence.makerRebateBps);
  return null;
}

async function streamBook(venue: 'kraken' | 'okx', symbol: string, maxAgeMs: number): Promise<Book | null> {
  const quote = await cexOrderBookStreams.getQuote(venue, symbol, maxAgeMs).catch(() => null);
  if (!quote) return null;
  const bidQty = finitePositive(quote.depth.bids[0]?.quantity);
  const askQty = finitePositive(quote.depth.asks[0]?.quantity);
  if (!bidQty || !askQty) return null;
  return {
    venue,
    bid: quote.bid,
    bidQty,
    ask: quote.ask,
    askQty,
    observedAt: quote.timestamp,
    authority: 'websocket',
  };
}

async function krakenBook(symbol: string, maxAgeMs: number): Promise<Book | null> {
  const stream = await streamBook('kraken', symbol, maxAgeMs);
  if (stream) return stream;
  const payload = await fetchJsonWithRetry<any>(`https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(symbol)}&count=5`, {
    init: { headers: { accept: 'application/json' } }, maxRetries: 1, baseDelayMs: 100, maxDelayMs: 400, timeoutMs: 2_000,
  });
  const key = Object.keys(payload?.result || {})[0];
  const row = key ? payload?.result?.[key] : null;
  const bid = finitePositive(row?.b?.[0]?.[0]);
  const bidQty = finitePositive(row?.b?.[0]?.[1]);
  const ask = finitePositive(row?.a?.[0]?.[0]);
  const askQty = finitePositive(row?.a?.[0]?.[1]);
  return bid && bidQty && ask && askQty
    ? { venue: 'kraken', bid, bidQty, ask, askQty, observedAt: Date.now(), authority: 'rest_fallback' }
    : null;
}

async function okxBook(symbol: string, maxAgeMs: number): Promise<Book | null> {
  const stream = await streamBook('okx', symbol, maxAgeMs);
  if (stream) return stream;
  const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!match) return null;
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const payload = await fetchJsonWithRetry<any>(`${baseUrl}/api/v5/market/books?instId=${encodeURIComponent(`${match[1]}-${match[2]}`)}&sz=5`, {
    init: { headers: { accept: 'application/json' } }, maxRetries: 1, baseDelayMs: 100, maxDelayMs: 400, timeoutMs: 2_000,
  });
  const row = payload?.data?.[0];
  const bid = finitePositive(row?.bids?.[0]?.[0]);
  const bidQty = finitePositive(row?.bids?.[0]?.[1]);
  const ask = finitePositive(row?.asks?.[0]?.[0]);
  const askQty = finitePositive(row?.asks?.[0]?.[1]);
  return bid && bidQty && ask && askQty
    ? { venue: 'okx', bid, bidQty, ask, askQty, observedAt: Date.now(), authority: 'rest_fallback' }
    : null;
}

function ttlMs(): number {
  const configured = Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || DEFAULT_TTL_MS);
  return Math.max(2_000, Math.min(30_000, Number.isFinite(configured) ? configured : DEFAULT_TTL_MS));
}

function maxCanaryUsd(requested: number): number {
  const configured = Number(process.env.CRYPTO_ARBITRAGE_MAKER_CANARY_MAX_USD || 1_000);
  const cap = Math.max(10, Math.min(5_000, Number.isFinite(configured) ? configured : 1_000));
  return Math.min(requested, cap);
}

/**
 * Builds a discovery candidate only when authenticated maker fees, measured
 * product constraints and live order-book queue prices all agree. Hot WebSocket
 * books are authoritative when fresh; bounded REST is fallback only. The
 * candidate remains post-only with no taker fallback and still requires
 * Cryptara/Monte Carlo, inventory, governance and settlement authorities.
 */
export async function evaluateStablecoinMakerCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<StablecoinMakerPlan | null> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!STABLECOIN_SYMBOLS.has(symbol) || !(input.notionalUsd > 0)) return null;

  const [kraken, okx, krakenFee, okxFee] = await Promise.all([
    krakenBook(symbol, input.maxQuoteAgeMs).catch(() => null),
    okxBook(symbol, input.maxQuoteAgeMs).catch(() => null),
    resolveCexFeeEvidence('kraken', symbol).catch(() => null),
    resolveCexFeeEvidence('okx', symbol).catch(() => null),
  ]);
  if (!kraken || !okx) return null;
  const books = [kraken, okx];
  const fees: Record<'kraken' | 'okx', CexFeeEvidence | null> = { kraken: krakenFee, okx: okxFee };
  const now = Date.now();

  let best: StablecoinMakerPlan | null = null;
  for (const buy of books) {
    for (const sell of books) {
      if (buy.venue === sell.venue) continue;
      const buyEvidence = fees[buy.venue];
      const sellEvidence = fees[sell.venue];
      const buyFeeBps = authenticatedMakerFeeBps(buyEvidence);
      const sellFeeBps = authenticatedMakerFeeBps(sellEvidence);
      if (buyFeeBps === null || sellFeeBps === null) continue;

      const buyPrice = buy.bid;
      const sellPrice = sell.ask;
      if (!(sellPrice > buyPrice)) continue;
      const grossSpreadBps = ((sellPrice - buyPrice) / buyPrice) * 10_000;
      if (!(grossSpreadBps > buyFeeBps + sellFeeBps)) continue;

      const [buyConstraints, sellConstraints] = await Promise.all([
        getSpotProductConstraints(buy.venue, symbol).catch(() => null),
        getSpotProductConstraints(sell.venue, symbol).catch(() => null),
      ]);
      if (!buyConstraints || !sellConstraints) continue;
      const commonIncrement = Math.max(buyConstraints.baseIncrement, sellConstraints.baseIncrement);
      const queueParticipation = Math.max(0.001, Math.min(0.10, Number(process.env.CRYPTO_ARBITRAGE_MAKER_QUEUE_PARTICIPATION || 0.02)));
      const canaryUsd = maxCanaryUsd(input.notionalUsd);
      const queueQty = Math.min(buy.bidQty, sell.askQty) * queueParticipation;
      const requestedQty = Math.min(canaryUsd / buyPrice, queueQty);
      const baseQty = floorToIncrement(requestedQty, commonIncrement);
      if (!(baseQty > 0) || baseQty < buyConstraints.baseMinSize || baseQty < sellConstraints.baseMinSize) continue;

      const buyNotional = baseQty * buyPrice;
      const sellNotional = baseQty * sellPrice;
      if (buyConstraints.quoteMinSize !== null && buyNotional < buyConstraints.quoteMinSize) continue;
      if (sellConstraints.quoteMinSize !== null && sellNotional < sellConstraints.quoteMinSize) continue;
      const buyFeeUsd = buyNotional * buyFeeBps / 10_000;
      const sellFeeUsd = sellNotional * sellFeeBps / 10_000;
      const grossProfitUsd = sellNotional - buyNotional;
      const totalCostsUsd = buyFeeUsd + sellFeeUsd;
      const netProfitUsd = grossProfitUsd - totalCostsUsd;
      if (!(netProfitUsd > 0)) continue;

      const quoteAgeMs = Math.max(now - buy.observedAt, now - sell.observedAt);
      if (quoteAgeMs > input.maxQuoteAgeMs) continue;
      const authority: 'websocket' | 'rest_fallback' = buy.authority === 'websocket' && sell.authority === 'websocket'
        ? 'websocket'
        : 'rest_fallback';
      const candidate: StablecoinMakerPlan = {
        symbol,
        notionalUsd: buyNotional,
        requestedNotionalUsd: canaryUsd,
        executableNotionalUsd: buyNotional,
        buyVenue: buy.venue as QuoteVenue,
        sellVenue: sell.venue as QuoteVenue,
        buyAsk: buyPrice,
        sellBid: sellPrice,
        buyLimitPrice: buyPrice,
        sellLimitPrice: sellPrice,
        baseQty,
        grossProfitUsd,
        netProfitUsd,
        spreadPct: (sellPrice - buyPrice) / buyPrice * 100,
        costs: { buyFeeUsd, sellFeeUsd, gasUsd: 0, bridgeFeeUsd: 0, transferFeeUsd: 0, totalCostsUsd },
        quoteAgeMs,
        expectedSlippageBps: 0,
        expectedPriceImpactBps: 0,
        liquidity: {
          status: 'measured',
          buyAvailableBaseQty: buy.bidQty,
          sellAvailableBaseQty: sell.askQty,
          source: [`${buy.venue}:maker_queue:${buy.authority}`, `${sell.venue}:maker_queue:${sell.authority}`],
        },
        feeEvidence: { buy: buyEvidence!, sell: sellEvidence! },
        crossVenueCostModel: 'prepositioned_inventory',
        makerExecution: {
          strategy: 'stablecoin_post_only',
          buyMode: 'maker',
          sellMode: 'maker',
          ttlMs: ttlMs(),
          takerFallbackAllowed: false,
          feeAuthority: 'authenticated',
          bookAuthority: authority,
        },
      };
      if (!best || candidate.netProfitUsd > best.netProfitUsd) best = candidate;
    }
  }
  return best;
}

export function isStablecoinMakerPlan(plan: VerifiedArbitragePlan): plan is StablecoinMakerPlan {
  const value = plan as StablecoinMakerPlan;
  return value?.makerExecution?.strategy === 'stablecoin_post_only' && value.makerExecution.takerFallbackAllowed === false;
}
