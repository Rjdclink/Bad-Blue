import {
  fingerprintEventSemantics,
  type EventContractSemantics,
  type EventOutcome,
  type EventOrderSide,
  type EventVenue,
  type EventVenueAccountEvidence,
  type EventVenueMarket,
  type EventVenueOrderRequest,
  type EventVenueOrderState,
  type EventVenueSettlement,
  type EventVenueSizedQuote,
} from './event-venue.js';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';
const TTL_MS = Math.max(1_000, Math.min(30_000, Number(process.env.CRYPTOCRAWL_POLYMARKET_EVENT_TTL_MS || 5_000)));

type MarketRow = Record<string, any>;
type Level = { price?: string | number; size?: string | number };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 10_000_000_000 ? value * 1_000 : value;
  const raw = text(value); if (!raw) return null;
  const parsed = Date.parse(raw); return Number.isFinite(parsed) ? parsed : null;
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`POLYMARKET_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}
async function marketById(marketId: string): Promise<MarketRow | null> {
  const payload = await json<any>(`${GAMMA_BASE}/markets?id=${encodeURIComponent(marketId)}`).catch(() => null);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.markets) ? payload.markets : [];
  return rows[0] ?? null;
}
function tokenFor(row: MarketRow, outcome: EventOutcome): string | null {
  const outcomes = parseArray(row?.outcomes).map(value => value.trim().toLowerCase());
  const ids = row?.clob_token_ids?.map?.(String) ?? parseArray(row?.clobTokenIds);
  const index = outcomes.indexOf(outcome);
  return index >= 0 && ids[index] ? String(ids[index]) : null;
}
function semanticsFrom(row: MarketRow): EventContractSemantics | null {
  const outcomes = parseArray(row?.outcomes);
  const yesIndex = outcomes.findIndex(value => value.trim().toLowerCase() === 'yes');
  const noIndex = outcomes.findIndex(value => value.trim().toLowerCase() === 'no');
  const question = text(row?.question);
  const rules = [text(row?.description), text(row?.rules)].filter(Boolean).join(' | ');
  const settlementSource = text(row?.resolutionSource ?? row?.resolution_source);
  const cutoffAt = timestamp(row?.endDate ?? row?.end_date ?? row?.endDateIso);
  const timezone = text(row?.timezone ?? row?.timeZone);
  const resolutionProcedure = text(row?.resolutionProcedure ?? row?.resolution_procedure ?? row?.description);
  const voidTreatment = text(row?.voidTreatment ?? row?.void_treatment);
  const cancellationTreatment = text(row?.cancellationTreatment ?? row?.cancellation_treatment);
  const payoutDefinition = text(row?.payoutDefinition ?? row?.payout_definition);
  const settlementTiming = text(row?.settlementTiming ?? row?.settlement_timing);
  if (!question || !rules || yesIndex < 0 || noIndex < 0 || !settlementSource || !cutoffAt || !timezone || !resolutionProcedure || !voidTreatment || !cancellationTreatment || !payoutDefinition || !settlementTiming) return null;
  return {
    question,
    rules,
    outcomeDefinitionYes: outcomes[yesIndex],
    outcomeDefinitionNo: outcomes[noIndex],
    settlementSource,
    cutoffAt,
    timezone,
    resolutionProcedure,
    voidTreatment,
    cancellationTreatment,
    payoutDefinition,
    settlementTiming,
  };
}
function bestLevels(levels: Level[] | undefined, side: EventOrderSide): Array<{ price: number; size: number }> {
  return (levels ?? []).map(level => ({ price: Number(level.price), size: Number(level.size) }))
    .filter(level => Number.isFinite(level.price) && level.price > 0 && level.price < 1 && Number.isFinite(level.size) && level.size > 0)
    .sort((a, b) => side === 'buy' ? a.price - b.price : b.price - a.price);
}
async function feeRate(tokenId: string): Promise<number | null> {
  const payload = await json<any>(`${CLOB_BASE}/fee-rate?token_id=${encodeURIComponent(tokenId)}`).catch(() => null);
  const raw = Number(payload?.base_fee ?? payload?.fee_rate_bps ?? payload?.feeRateBps);
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}

export class PolymarketEventVenue implements EventVenue {
  readonly venue = 'polymarket';

  async getMarket(marketId: string): Promise<EventVenueMarket | null> {
    const row = await marketById(marketId);
    if (!row) return null;
    const semantics = semanticsFrom(row);
    if (!semantics) return null;
    const now = Date.now();
    const closed = row?.closed === true || row?.active === false;
    return {
      venue: this.venue,
      marketId: String(row?.id ?? marketId),
      conditionId: text(row?.conditionId ?? row?.condition_id) || null,
      status: closed ? 'closed' : row?.acceptingOrders === false ? 'paused' : 'open',
      semantics,
      semanticsFingerprint: fingerprintEventSemantics(semantics),
      observedAt: now,
      expiresAt: now + TTL_MS,
      provenance: ['polymarket_gamma:public_market', 'semantic_fields:explicit_only_no_inference', 'execution_authority:false'],
    };
  }

  async getSizedQuote(marketId: string, outcome: EventOutcome, side: EventOrderSide, contracts: number): Promise<EventVenueSizedQuote | null> {
    if (!(contracts > 0) || !Number.isFinite(contracts)) return null;
    const row = await marketById(marketId);
    if (!row) return null;
    const tokenId = tokenFor(row, outcome);
    if (!tokenId) return null;
    const book = await json<any>(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`).catch(() => null);
    if (!book) return null;
    const levels = bestLevels(side === 'buy' ? book?.asks : book?.bids, side);
    let remaining = contracts;
    let notional = 0;
    let worst: number | null = null;
    for (const level of levels) {
      if (remaining <= 1e-9) break;
      const take = Math.min(remaining, level.size);
      notional += take * level.price;
      remaining -= take;
      worst = level.price;
    }
    const complete = remaining <= 1e-9;
    const vwapPrice = complete ? notional / contracts : null;
    const feeBps = await feeRate(tokenId);
    const feeUsd = complete && feeBps !== null && vwapPrice !== null
      ? contracts * (feeBps / 10_000) * vwapPrice * (1 - vwapPrice)
      : null;
    const top = levels[0]?.price ?? null;
    const slippageUsd = complete && top !== null ? Math.max(0, side === 'buy' ? notional - contracts * top : contracts * top - notional) : null;
    const now = Date.now();
    return {
      venue: this.venue,
      marketId,
      outcome,
      side,
      contracts,
      complete,
      vwapPrice,
      worstPrice: complete ? worst : null,
      notionalUsd: complete ? notional : null,
      feeUsd,
      slippageUsd,
      observedAt: now,
      expiresAt: now + TTL_MS,
      authenticated: false,
      provenance: [
        'polymarket_clob:public_orderbook',
        ...(feeBps !== null ? ['polymarket_clob:public_market_fee_rate'] : ['polymarket_fee:evidence_missing']),
        'account_execution_authentication:false',
        'execution_authority:false',
      ],
    };
  }

  async getAccountEvidence(): Promise<EventVenueAccountEvidence> {
    const now = Date.now();
    return {
      venue: this.venue,
      authenticated: false,
      accountAccessible: false,
      orderSubmissionAllowed: false,
      prefundedSystemOwnedUsd: null,
      systemOwnedProvenance: [],
      feeEvidenceAuthenticated: false,
      observedAt: now,
      expiresAt: now + TTL_MS,
      provenance: ['polymarket_account:authenticated_adapter_not_configured', 'account_balance_mints_ownership:false', 'execution_authority:false'],
    };
  }

  async placeOrRecoverOrder(_request: EventVenueOrderRequest): Promise<EventVenueOrderState> {
    throw new Error('POLYMARKET_AUTHENTICATED_EXECUTION_ADAPTER_UNAVAILABLE');
  }
  async getOrder(_orderId: string): Promise<EventVenueOrderState | null> { return null; }
  async cancelOrder(_orderId: string): Promise<EventVenueOrderState | null> { return null; }
  async getSettlement(_marketId: string): Promise<EventVenueSettlement | null> { return null; }
}

export const polymarketEventVenue = new PolymarketEventVenue();
