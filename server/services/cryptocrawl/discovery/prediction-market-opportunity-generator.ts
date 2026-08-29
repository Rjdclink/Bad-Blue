import logger from '../../../logger.js';

export interface PredictionParityOpportunity {
  id: string;
  venue: 'polymarket';
  marketId: string;
  conditionId: string | null;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  yesAsk: number;
  noAsk: number;
  combinedAsk: number;
  matchedShares: number;
  grossLockedProfitUsd: number;
  grossProfitBps: number;
  observedAt: number;
  expiresAt: number;
  executableCapability: false;
  executionCapabilityReason: string;
  provenance: string[];
}

type GammaMarket = {
  id?: string;
  conditionId?: string;
  condition_id?: string;
  question?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
  clob_token_ids?: string[];
  active?: boolean;
  closed?: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  restricted?: boolean;
};

type BookLevel = { price?: string | number; size?: string | number };
type ClobBook = {
  asset_id?: string;
  asks?: BookLevel[];
  timestamp?: string | number;
};

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item));
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
  } catch {
    return [];
  }
}

function binaryTokenIds(market: GammaMarket): { yesTokenId: string; noTokenId: string } | null {
  const outcomes = parseStringArray(market.outcomes).map(value => value.trim().toLowerCase());
  const tokenIds = market.clob_token_ids?.map(String) || parseStringArray(market.clobTokenIds);
  if (outcomes.length !== 2 || tokenIds.length !== 2) return null;
  const yes = outcomes.indexOf('yes');
  const no = outcomes.indexOf('no');
  if (yes < 0 || no < 0 || !tokenIds[yes] || !tokenIds[no]) return null;
  return { yesTokenId: tokenIds[yes], noTokenId: tokenIds[no] };
}

function bestAsk(book: ClobBook | undefined): { price: number; size: number } | null {
  if (!book?.asks?.length) return null;
  const levels = book.asks
    .map(level => ({ price: Number(level.price), size: Number(level.size) }))
    .filter(level => Number.isFinite(level.price) && level.price > 0 && level.price <= 1 && Number.isFinite(level.size) && level.size > 0)
    .sort((left, right) => left.price - right.price);
  return levels[0] || null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json() as Promise<T>;
}

async function fetchMarkets(): Promise<GammaMarket[]> {
  const limit = boundedInteger(process.env.PREDICTION_MARKET_SCAN_LIMIT, 40, 2, 100);
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${limit}`;
  const markets = await fetchJson<GammaMarket[]>(url, { headers: { accept: 'application/json' } });
  return Array.isArray(markets) ? markets.filter(market =>
    market.active !== false && market.closed !== true && market.enableOrderBook !== false,
  ) : [];
}

async function fetchBooks(tokenIds: string[]): Promise<Map<string, ClobBook>> {
  if (tokenIds.length === 0) return new Map();
  const books = await fetchJson<ClobBook[]>(`${CLOB_BASE}/books`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(tokenIds.map(token_id => ({ token_id }))),
  });
  const result = new Map<string, ClobBook>();
  for (const book of Array.isArray(books) ? books : []) {
    if (book?.asset_id) result.set(String(book.asset_id), book);
  }
  return result;
}

/**
 * Public-data parity scanner for binary prediction markets. It detects the
 * mechanically locked gross condition YES ask + NO ask < 1 using live public
 * order books. It intentionally does not declare deterministic net profit or
 * execution readiness until venue fees, order signing/authentication, fill
 * atomicity and settlement lifecycle are implemented and verified.
 */
export async function discoverPredictionMarketParityOpportunities(): Promise<PredictionParityOpportunity[]> {
  if (process.env.PREDICTION_MARKET_DISCOVERY_ENABLED === 'false') return [];
  const observedAt = Date.now();
  try {
    const markets = await fetchMarkets();
    const binary = markets.flatMap(market => {
      const ids = binaryTokenIds(market);
      return ids ? [{ market, ...ids }] : [];
    });
    const tokenIds = [...new Set(binary.flatMap(item => [item.yesTokenId, item.noTokenId]))];
    const books = await fetchBooks(tokenIds);
    const ttlMs = boundedInteger(process.env.PREDICTION_MARKET_QUOTE_TTL_MS, 2_000, 500, 10_000);
    const opportunities: PredictionParityOpportunity[] = [];

    for (const item of binary) {
      const yes = bestAsk(books.get(item.yesTokenId));
      const no = bestAsk(books.get(item.noTokenId));
      if (!yes || !no) continue;
      const combinedAsk = yes.price + no.price;
      if (!(combinedAsk < 1)) continue;
      const matchedShares = Math.min(yes.size, no.size);
      const grossLockedProfitUsd = (1 - combinedAsk) * matchedShares;
      const grossProfitBps = combinedAsk > 0 ? ((1 - combinedAsk) / combinedAsk) * 10_000 : 0;
      if (!(grossLockedProfitUsd > 0) || !Number.isFinite(grossProfitBps)) continue;
      opportunities.push({
        id: `prediction:polymarket:${item.market.id || item.market.conditionId || item.yesTokenId}:${observedAt}`,
        venue: 'polymarket',
        marketId: String(item.market.id || ''),
        conditionId: item.market.conditionId || item.market.condition_id || null,
        question: String(item.market.question || ''),
        yesTokenId: item.yesTokenId,
        noTokenId: item.noTokenId,
        yesAsk: yes.price,
        noAsk: no.price,
        combinedAsk,
        matchedShares,
        grossLockedProfitUsd,
        grossProfitBps,
        observedAt,
        expiresAt: observedAt + ttlMs,
        executableCapability: false,
        executionCapabilityReason: 'Public no-auth market data proves gross parity only; authenticated order submission, exact fees, matched-fill atomicity and terminal settlement are not yet execution-authoritative',
        provenance: [
          'polymarket_gamma_public:no_auth',
          'polymarket_clob_books_public:no_auth',
          'binary_yes_no_parity',
          'best_ask_depth_measured',
          'gross_profit_only',
          'execution_authority:false',
          'synthetic_evidence:false',
        ],
      });
    }

    opportunities.sort((left, right) => right.grossLockedProfitUsd - left.grossLockedProfitUsd || right.grossProfitBps - left.grossProfitBps);
    logger.info('[PredictionMarketDiscovery] Public binary parity scan completed', {
      component: 'PredictionMarketOpportunityGenerator',
      venue: 'polymarket',
      markets: markets.length,
      binaryMarkets: binary.length,
      opportunities: opportunities.length,
      bestGrossProfitBps: opportunities[0]?.grossProfitBps ?? null,
      apiKeyRequiredForDiscovery: false,
      signUpRequiredForDiscovery: false,
      deterministicNetProfitAuthority: false,
      executionAuthority: false,
    });
    return opportunities;
  } catch (error) {
    logger.warn('[PredictionMarketDiscovery] Public prediction-market scan degraded', {
      component: 'PredictionMarketOpportunityGenerator',
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
    });
    return [];
  }
}
