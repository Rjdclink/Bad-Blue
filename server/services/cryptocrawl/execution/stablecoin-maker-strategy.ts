import type { VerifiedArbitragePlan, QuoteVenue } from '../arbitrage/arbitrage-verifier.js';
import { stageManager } from '../governance/stage-management.js';
import { resolveCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/cex-private-authority.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { floorToIncrement } from './coinbase-product-policy.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';

export type MakerLegMode = 'maker';
export type MakerRecoveryStrategy = 'stablecoin_post_only' | 'volatile_spread_post_only';

type MakerExecutionMetadata = {
  strategy: MakerRecoveryStrategy;
  buyMode: MakerLegMode;
  sellMode: MakerLegMode;
  ttlMs: number;
  takerFallbackAllowed: false;
  feeAuthority: 'authenticated';
  bookAuthority: 'websocket' | 'rest_fallback';
  canaryCeilingUsd: number;
  canaryProofSamples: number;
  volatileMinGrossSpreadBps: number | null;
};

export type MakerRecoveryPlan = VerifiedArbitragePlan & {
  makerExecution: MakerExecutionMetadata;
};

export type StablecoinMakerPlan = MakerRecoveryPlan & {
  makerExecution: MakerExecutionMetadata & { strategy: 'stablecoin_post_only' };
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

type MakerCanaryProof = {
  samples: number;
  wins: number;
  winRate: number | null;
  ceilingUsd: number;
};

const STABLECOIN_SYMBOLS = new Set(['USDGUSDT', 'USDCUSDT', 'DAIUSDT', 'RLUSDUSDT']);
const DEFAULT_TTL_MS = 30_000;
const PROOF_CAPS_USD = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const;

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteBoundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function authenticatedMakerFeeBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Math.max(0, evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.max(0, evidence.makerRebateBps);
  return null;
}

function isMakerEvidence(item: ReturnType<typeof stageManager.getState>['cryptaraExecutionEvidence'][number]): boolean {
  const strategy = String(item.strategy || '').toLowerCase();
  const provenance = item.provenance || [];
  return strategy.includes('maker') || provenance.some(entry => String(entry).toLowerCase().includes('maker'));
}

function makerCanaryProof(): MakerCanaryProof {
  const bootstrapUsd = finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_BOOTSTRAP_USD', 10, 10, 100);
  const hardMaxUsd = finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_MAX_USD', 5_000, bootstrapUsd, 5_000);
  const evidence = stageManager.getState().cryptaraExecutionEvidence
    .filter(item => item.settlementConfirmed === true && isMakerEvidence(item))
    .slice(-20);
  const wins = evidence.filter(item => item.success === true && Number(item.realizedProfitUsd) > 0).length;
  const winRate = evidence.length > 0 ? wins / evidence.length : null;

  let tier = 0;
  if (wins >= 1 && (winRate ?? 0) >= 0.80) tier = 1;
  if (wins >= 3 && (winRate ?? 0) >= 0.85) tier = 2;
  if (wins >= 5 && (winRate ?? 0) >= 0.85) tier = 3;
  if (wins >= 10 && (winRate ?? 0) >= 0.90) tier = 4;
  if (wins >= 20 && (winRate ?? 0) >= 0.90) tier = 5;
  if (wins >= 35 && (winRate ?? 0) >= 0.92) tier = 6;
  if (wins >= 50 && (winRate ?? 0) >= 0.94) tier = 7;
  if (wins >= 75 && (winRate ?? 0) >= 0.95) tier = 8;

  const proofCap = Math.max(bootstrapUsd, PROOF_CAPS_USD[tier]);
  return {
    samples: evidence.length,
    wins,
    winRate,
    ceilingUsd: Math.min(hardMaxUsd, proofCap),
  };
}

export function getDynamicMakerCanaryStatus(): MakerCanaryProof {
  return makerCanaryProof();
}

function maxCanaryUsd(requested: number): { amount: number; proof: MakerCanaryProof } {
  const proof = makerCanaryProof();
  return { amount: Math.min(requested, proof.ceilingUsd), proof };
}

function volatileMinGrossSpreadBps(): number {
  return finiteBoundedEnv('CRYPTO_ARBITRAGE_VOLATILE_MAKER_MIN_GROSS_SPREAD_BPS', 70, 10, 2_000);
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

async function evaluateMakerCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
  requireStablecoin: boolean;
}): Promise<MakerRecoveryPlan | null> {
  const symbol = input.symbol.trim().toUpperCase();
  const stablecoin = STABLECOIN_SYMBOLS.has(symbol);
  if (input.requireStablecoin && !stablecoin) return null;
  if (!(input.notionalUsd > 0) || !/^([A-Z0-9]+)(USDT|USDC|USD)$/.test(symbol)) return null;

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
  const volatileFloorBps = stablecoin ? null : volatileMinGrossSpreadBps();

  let best: MakerRecoveryPlan | null = null;
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
      const feeFloorBps = buyFeeBps + sellFeeBps;
      if (!(grossSpreadBps > feeFloorBps)) continue;
      if (volatileFloorBps !== null && grossSpreadBps < volatileFloorBps) continue;

      const [buyConstraints, sellConstraints] = await Promise.all([
        getSpotProductConstraints(buy.venue, symbol).catch(() => null),
        getSpotProductConstraints(sell.venue, symbol).catch(() => null),
      ]);
      if (!buyConstraints || !sellConstraints) continue;
      const commonIncrement = Math.max(buyConstraints.baseIncrement, sellConstraints.baseIncrement);
      const queueParticipation = Math.max(0.001, Math.min(0.10, Number(process.env.CRYPTO_ARBITRAGE_MAKER_QUEUE_PARTICIPATION || 0.02)));
      const canary = maxCanaryUsd(input.notionalUsd);
      const queueQty = Math.min(buy.bidQty, sell.askQty) * queueParticipation;
      const requestedQty = Math.min(canary.amount / buyPrice, queueQty);
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
      const candidate: MakerRecoveryPlan = {
        symbol,
        notionalUsd: buyNotional,
        requestedNotionalUsd: canary.amount,
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
          strategy: stablecoin ? 'stablecoin_post_only' : 'volatile_spread_post_only',
          buyMode: 'maker',
          sellMode: 'maker',
          ttlMs: ttlMs(),
          takerFallbackAllowed: false,
          feeAuthority: 'authenticated',
          bookAuthority: authority,
          canaryCeilingUsd: canary.proof.ceilingUsd,
          canaryProofSamples: canary.proof.samples,
          volatileMinGrossSpreadBps: volatileFloorBps,
        },
      };
      if (!best || candidate.netProfitUsd > best.netProfitUsd) best = candidate;
    }
  }
  return best;
}

/** Stablecoin-only compatibility entry point retained for existing callers/tests. */
export async function evaluateStablecoinMakerCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<StablecoinMakerPlan | null> {
  return evaluateMakerCandidate({ ...input, requireStablecoin: true }) as Promise<StablecoinMakerPlan | null>;
}

/**
 * Maker recovery for any measured Kraken/OKX spot pair. Stablecoins need only
 * clear authenticated maker fees; volatile pairs additionally require a wide
 * gross spread (70 bps by default) before a tiny post-only canary is admitted.
 */
export async function evaluateMakerRecoveryCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<MakerRecoveryPlan | null> {
  return evaluateMakerCandidate({ ...input, requireStablecoin: false });
}

export function isStablecoinMakerPlan(plan: VerifiedArbitragePlan): plan is StablecoinMakerPlan {
  const value = plan as MakerRecoveryPlan;
  return value?.makerExecution?.strategy === 'stablecoin_post_only' && value.makerExecution.takerFallbackAllowed === false;
}

export function isMakerRecoveryPlan(plan: VerifiedArbitragePlan): plan is MakerRecoveryPlan {
  const value = plan as MakerRecoveryPlan;
  return (value?.makerExecution?.strategy === 'stablecoin_post_only' || value?.makerExecution?.strategy === 'volatile_spread_post_only')
    && value.makerExecution.takerFallbackAllowed === false;
}
