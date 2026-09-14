import { kalshiAuthenticatedRequest } from './kalshi-authenticated-authority.js';
import { estimateKalshiEventFees } from './kalshi-event-fee-authority.js';

export type KalshiRfqOutcome = 'yes' | 'no';

export interface KalshiRfqSelectedLeg {
  eventTicker: string;
  marketTicker: string;
  side: 'yes' | 'no';
  yesSettlementValueUsd: number | null;
}

export interface KalshiRfqState {
  id: string;
  marketTicker: string;
  contracts: number;
  status: string;
  mveCollectionTicker: string | null;
  mveSelectedLegs: KalshiRfqSelectedLeg[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface KalshiRfqAcquisitionQuote {
  rfqId: string;
  quoteId: string;
  marketTicker: string;
  outcome: KalshiRfqOutcome;
  contracts: number;
  acceptedSide: 'yes' | 'no';
  acquisitionPriceUsd: number;
  acquisitionNotionalUsd: number;
  estimatedTakerFeeUsd: number;
  allInAcquisitionCostUsd: number;
  quoteStatus: string;
  rfqCreatorOrderId: string | null;
  mveCollectionTicker: string | null;
  mveSelectedLegs: KalshiRfqSelectedLeg[];
  observedAt: number;
  provenance: string[];
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function probability(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 && parsed < 1 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedContracts(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('Kalshi RFQ contracts must be positive');
  return value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function normalizeSelectedLegs(value: unknown): KalshiRfqSelectedLeg[] {
  return (Array.isArray(value) ? value : []).flatMap((row: any) => {
    const eventTicker = String(row?.event_ticker || '').trim().toUpperCase();
    const marketTicker = String(row?.market_ticker || '').trim().toUpperCase();
    const side = String(row?.side || '').trim().toLowerCase();
    if (!eventTicker || !marketTicker || (side !== 'yes' && side !== 'no')) return [];
    const settlement = finite(row?.yes_settlement_value_dollars);
    return [{ eventTicker, marketTicker, side: side as 'yes' | 'no', yesSettlementValueUsd: settlement }];
  });
}

function normalizeRfq(row: any): KalshiRfqState | null {
  const id = String(row?.id || '').trim();
  const marketTicker = String(row?.market_ticker || '').trim().toUpperCase();
  const contracts = positive(row?.contracts_fp);
  if (!id || !marketTicker || contracts === null) return null;
  return {
    id,
    marketTicker,
    contracts,
    status: String(row?.status || '').trim().toLowerCase(),
    mveCollectionTicker: row?.mve_collection_ticker ? String(row.mve_collection_ticker).trim().toUpperCase() : null,
    mveSelectedLegs: normalizeSelectedLegs(row?.mve_selected_legs),
    createdAt: timestamp(row?.created_ts),
    updatedAt: timestamp(row?.updated_ts),
  };
}

async function selfRfqs(marketTicker: string): Promise<KalshiRfqState[]> {
  const query = new URLSearchParams({ market_ticker: marketTicker, user_filter: 'self', subaccount: '0', limit: '100' });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/communications/rfqs?${query.toString()}`);
  return (Array.isArray(payload?.rfqs) ? payload.rfqs : []).map(normalizeRfq).filter((row): row is KalshiRfqState => row !== null);
}

export async function cancelKalshiRfq(rfqIdInput: string): Promise<void> {
  const rfqId = rfqIdInput.trim();
  if (!rfqId) return;
  await kalshiAuthenticatedRequest(`/trade-api/v2/communications/rfqs/${encodeURIComponent(rfqId)}`, { method: 'DELETE' });
}

export async function ensureKalshiRfq(input: {
  marketTicker: string;
  contracts: number;
  restRemainder?: boolean;
}): Promise<KalshiRfqState> {
  const marketTicker = input.marketTicker.trim().toUpperCase();
  if (!marketTicker || !(input.contracts > 0) || !Number.isFinite(input.contracts)) throw new Error('Kalshi RFQ inputs are invalid');
  const existing = await selfRfqs(marketTicker);
  const exactOpen = existing.find(row => row.status === 'open' && Math.abs(row.contracts - input.contracts) <= 1e-8);
  if (exactOpen) return exactOpen;
  for (const stale of existing.filter(row => row.status === 'open')) {
    await cancelKalshiRfq(stale.id).catch(() => undefined);
  }
  const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/communications/rfqs', {
    method: 'POST',
    body: {
      market_ticker: marketTicker,
      contracts_fp: fixedContracts(input.contracts),
      rest_remainder: input.restRemainder === true,
      replace_existing: true,
      subaccount: 0,
    },
  });
  const id = String(payload?.id || '').trim();
  if (!id) throw new Error('Kalshi RFQ create response omitted id');
  const current = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/communications/rfqs/${encodeURIComponent(id)}`);
  const normalized = normalizeRfq(current?.rfq);
  if (!normalized) throw new Error('Kalshi RFQ create response could not be recovered');
  return normalized;
}

async function quoteRows(rfqId: string): Promise<any[]> {
  const query = new URLSearchParams({ rfq_id: rfqId, rfq_user_filter: 'self', limit: '500' });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/communications/quotes?${query.toString()}`);
  return Array.isArray(payload?.quotes) ? payload.quotes : [];
}

export async function getBestKalshiRfqAcquisitionQuote(input: {
  rfq: KalshiRfqState;
  outcome: KalshiRfqOutcome;
  forceFeeRefresh?: boolean;
}): Promise<KalshiRfqAcquisitionQuote | null> {
  const candidates: KalshiRfqAcquisitionQuote[] = [];
  for (const row of await quoteRows(input.rfq.id)) {
    const quoteId = String(row?.id || '').trim();
    const status = String(row?.status || '').trim().toLowerCase();
    if (!quoteId || !['open', 'accepted', 'confirmed', 'executed'].includes(status)) continue;
    const yesBid = probability(row?.yes_bid_dollars);
    const noBid = probability(row?.no_bid_dollars);
    const acceptedSide: 'yes' | 'no' = input.outcome === 'yes' ? 'no' : 'yes';
    const makerBid = input.outcome === 'yes' ? noBid : yesBid;
    if (makerBid === null) continue;
    const acquisitionPriceUsd = 1 - makerBid;
    if (!(acquisitionPriceUsd > 0) || !(acquisitionPriceUsd < 1)) continue;
    const sideContracts = positive(input.outcome === 'yes' ? row?.no_contracts_fp : row?.yes_contracts_fp);
    const contracts = sideContracts ?? positive(row?.contracts_fp) ?? input.rfq.contracts;
    if (Math.abs(contracts - input.rfq.contracts) > 1e-8) continue;
    const fee = await estimateKalshiEventFees({
      ticker: input.rfq.marketTicker,
      contracts,
      price: acquisitionPriceUsd,
      forceRefresh: input.forceFeeRefresh === true,
    }).catch(() => null);
    if (!fee?.economicCreditAllowed || fee.takerFeeUsd === null) continue;
    const acquisitionNotionalUsd = contracts * acquisitionPriceUsd;
    candidates.push({
      rfqId: input.rfq.id,
      quoteId,
      marketTicker: input.rfq.marketTicker,
      outcome: input.outcome,
      contracts,
      acceptedSide,
      acquisitionPriceUsd,
      acquisitionNotionalUsd,
      estimatedTakerFeeUsd: fee.takerFeeUsd,
      allInAcquisitionCostUsd: acquisitionNotionalUsd + fee.takerFeeUsd,
      quoteStatus: status,
      rfqCreatorOrderId: row?.rfq_creator_order_id ? String(row.rfq_creator_order_id).trim() : null,
      mveCollectionTicker: input.rfq.mveCollectionTicker,
      mveSelectedLegs: input.rfq.mveSelectedLegs.map(leg => ({ ...leg })),
      observedAt: Date.now(),
      provenance: [
        'kalshi_rfq:authenticated_requester_quote',
        'kalshi_rfq:full_requested_size',
        'kalshi_rfq:taker_fee_included',
        input.rfq.mveCollectionTicker ? 'kalshi_rfq:native_combo_market' : 'kalshi_rfq:ordinary_market',
        'variable_rewards_precredited:false',
      ],
    });
  }
  return candidates.sort((a, b) => a.allInAcquisitionCostUsd - b.allInAcquisitionCostUsd || a.quoteId.localeCompare(b.quoteId))[0] ?? null;
}

export async function acceptKalshiRfqQuote(quote: KalshiRfqAcquisitionQuote): Promise<void> {
  await kalshiAuthenticatedRequest(`/trade-api/v2/communications/quotes/${encodeURIComponent(quote.quoteId)}/accept`, {
    method: 'PUT',
    body: { accepted_side: quote.acceptedSide },
  });
}

export async function recoverKalshiRfqRequesterOrder(input: {
  rfqId: string;
  quoteId: string;
}): Promise<{ orderId: string | null; status: string; terminalWithoutExecution: boolean }> {
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/communications/quotes/${encodeURIComponent(input.quoteId)}`);
  const row = payload?.quote;
  if (!row || String(row?.rfq_id || '').trim() !== input.rfqId) throw new Error('Kalshi RFQ quote identity mismatch');
  const status = String(row?.status || '').trim().toLowerCase();
  const orderId = row?.rfq_creator_order_id ? String(row.rfq_creator_order_id).trim() : null;
  const terminalWithoutExecution = /cancel|reject|expire|closed/.test(status) && !orderId;
  return { orderId: orderId || null, status, terminalWithoutExecution };
}

export async function waitForKalshiRfqRequesterOrder(input: {
  rfqId: string;
  quoteId: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const timeoutMs = Math.max(500, Math.min(60_000, Math.trunc(input.timeoutMs ?? 6_000)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await recoverKalshiRfqRequesterOrder(input);
    if (current.orderId) return current.orderId;
    if (current.terminalWithoutExecution) return null;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}
