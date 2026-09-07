import { Contract } from 'ethers';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import {
  cancelPolymarketEventOrderState,
  getPolymarketEventOrderState,
  placeOrRecoverPolymarketEventOrder,
} from '../execution/polymarket-event-order-authority.js';
import {
  getPolymarketSystemCashSnapshot,
  recoverPolymarketSystemCashReservation,
  reservePolymarketSystemCash,
} from '../execution/polymarket-system-owned-cash-ledger.js';
import { getPolymarketAuthenticatedAccountSnapshot } from '../intelligence/polymarket-authenticated-authority.js';
import { getPolymarketGeographicEligibility, requirePolymarketGeographicEligibility } from '../intelligence/polymarket-geographic-authority.js';
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
const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const CTF_ABI = [
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)',
  'function payoutNumerators(bytes32 conditionId,uint256 index) view returns (uint256)',
];
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
async function executionMetadata(tokenId: string): Promise<{ tickSize: number; negRisk: boolean } | null> {
  const [tick, negRisk] = await Promise.all([
    json<any>(`${CLOB_BASE}/tick-size?token_id=${encodeURIComponent(tokenId)}`).catch(() => null),
    json<any>(`${CLOB_BASE}/neg-risk?token_id=${encodeURIComponent(tokenId)}`).catch(() => null),
  ]);
  const tickSize = Number(tick?.minimum_tick_size ?? tick?.tick_size);
  if (![0.1, 0.01, 0.005, 0.0025, 0.001, 0.0001].includes(tickSize)) return null;
  if (typeof negRisk?.neg_risk !== 'boolean') return null;
  return { tickSize, negRisk: negRisk.neg_risk };
}
function reservationExpiry(row: MarketRow): number {
  const cutoff = timestamp(row?.endDate ?? row?.end_date ?? row?.endDateIso);
  const grace = Math.max(60_000, Math.min(14 * 24 * 60 * 60_000,
    Number(process.env.CRYPTOCRAWL_POLYMARKET_SETTLEMENT_GRACE_MS || 7 * 24 * 60 * 60_000)));
  return Math.max(Date.now() + 60_000, (cutoff ?? Date.now() + 24 * 60 * 60_000) + grace);
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
      provenance: ['polymarket_gamma:public_market', 'semantic_fields:explicit_only_no_inference', 'execution_authority:conditional_on_authenticated_account_system_cash_geography_and_order_evidence'],
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
    const authenticated = await getPolymarketAuthenticatedAccountSnapshot().then(() => true).catch(() => false);
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
      authenticated,
      provenance: [
        'polymarket_clob:public_exact_orderbook_depth',
        ...(feeBps !== null ? ['polymarket_clob:market_fee_rate_authoritative_account_independent'] : ['polymarket_fee:evidence_missing']),
        authenticated ? 'polymarket_account:l1_l2_authenticated' : 'polymarket_account:authentication_missing',
        'depth_and_fee_observation:does_not_grant_execution_without_system_owned_cash_and_geography',
      ],
    };
  }

  async getAccountEvidence(): Promise<EventVenueAccountEvidence> {
    const now = Date.now();
    const [account, cash, geographic] = await Promise.all([
      getPolymarketAuthenticatedAccountSnapshot().catch(() => null),
      getPolymarketSystemCashSnapshot(true).catch(() => null),
      getPolymarketGeographicEligibility(true).catch(() => null),
    ]);
    const authenticated = account !== null;
    const accountAccessible = authenticated && account.closedOnly !== true;
    const geographicExecutionAllowed = geographic?.eligible === true;
    const orderSubmissionAllowed = accountAccessible && account.collateralAllowanceProven && geographicExecutionAllowed;
    const prefundedSystemOwnedUsd = cash?.authenticatedCapacity ? cash.usableUsd : null;
    return {
      venue: this.venue,
      authenticated,
      accountAccessible,
      orderSubmissionAllowed,
      prefundedSystemOwnedUsd,
      systemOwnedProvenance: cash ? [
        'ownership:cryptocrawler_polymarket_system_owned_cash_lots',
        'physical_capacity:authenticated_polymarket_collateral_balance',
        'account_balance_mints_ownership:false',
        'personal_wallet_fallback:false',
      ] : [],
      // Polymarket CLOB fees are market/token schedule facts, not account-tier
      // discounts. Authenticated account identity plus the exact per-token fee
      // endpoint therefore completes the execution fee authority at quote time.
      feeEvidenceAuthenticated: authenticated,
      observedAt: Math.max(now, account?.observedAt ?? 0, cash?.observedAt ?? 0, geographic?.observedAt ?? 0),
      expiresAt: now + TTL_MS,
      provenance: [
        ...(account?.provenance ?? ['polymarket_account:authentication_missing']),
        ...(cash ? ['polymarket_system_cash:canonical_owned_lot_authority'] : ['polymarket_system_cash:evidence_missing']),
        ...(geographic?.provenance ?? ['polymarket_geographic_execution:evidence_missing_fail_closed']),
        geographicExecutionAllowed ? 'polymarket_geographic_execution:allowed' : 'polymarket_geographic_execution:not_allowed_or_unproven',
        'polymarket_fee_model:market_specific_not_account_tiered',
        'account_balance_mints_ownership:false',
      ],
    };
  }

  async placeOrRecoverOrder(request: EventVenueOrderRequest): Promise<EventVenueOrderState> {
    if (request.side !== 'buy') throw new Error('POLYMARKET_SYSTEM_OWNED_CONDITIONAL_INVENTORY_AUTHORITY_UNAVAILABLE');
    await requirePolymarketGeographicEligibility(true);
    const row = await marketById(request.marketId);
    if (!row) throw new Error('POLYMARKET_MARKET_UNAVAILABLE');
    const conditionId = text(row?.conditionId ?? row?.condition_id);
    const tokenId = tokenFor(row, request.outcome);
    if (!conditionId || !tokenId) throw new Error('POLYMARKET_MARKET_EXECUTION_IDENTITY_INCOMPLETE');
    const metadata = await executionMetadata(tokenId);
    if (!metadata) throw new Error('POLYMARKET_EXECUTION_METADATA_INCOMPLETE');
    const feeBps = await feeRate(tokenId);
    if (feeBps === null) throw new Error('POLYMARKET_EXECUTION_FEE_EVIDENCE_INCOMPLETE');
    const reserveAmountUsd = request.contracts * request.limitPrice
      + request.contracts * (feeBps / 10_000) * request.limitPrice * (1 - request.limitPrice);
    let reservation = await recoverPolymarketSystemCashReservation({
      lifecycleId: request.clientOrderId,
      opportunityId: request.marketId,
    });
    if (!reservation) {
      reservation = await reservePolymarketSystemCash({
        lifecycleId: request.clientOrderId,
        opportunityId: request.marketId,
        amountUsd: reserveAmountUsd,
        expiresAt: reservationExpiry(row),
      });
    }
    if (!reservation || reservation.amountUsd + 1e-9 < reserveAmountUsd) {
      throw new Error('POLYMARKET_PROVEN_SYSTEM_OWNED_CASH_RESERVATION_UNAVAILABLE');
    }
    return placeOrRecoverPolymarketEventOrder({
      clientOrderId: request.clientOrderId,
      marketId: request.marketId,
      conditionId,
      tokenId,
      outcome: request.outcome,
      side: request.side,
      contracts: request.contracts,
      limitPrice: request.limitPrice,
      timeInForce: request.timeInForce,
      postOnly: request.postOnly,
      tickSize: metadata.tickSize,
      negRisk: metadata.negRisk,
    });
  }

  async getOrder(orderId: string): Promise<EventVenueOrderState | null> {
    return getPolymarketEventOrderState(orderId);
  }

  async cancelOrder(orderId: string): Promise<EventVenueOrderState | null> {
    return cancelPolymarketEventOrderState(orderId);
  }

  async getSettlement(marketId: string): Promise<EventVenueSettlement | null> {
    const row = await marketById(marketId);
    if (!row) return null;
    const conditionId = text(row?.conditionId ?? row?.condition_id);
    if (!/^0x[a-fA-F0-9]{64}$/.test(conditionId)) return null;
    const outcomes = parseArray(row?.outcomes).map(value => value.trim().toLowerCase());
    const yesIndex = outcomes.indexOf('yes');
    const noIndex = outcomes.indexOf('no');
    if (yesIndex < 0 || noIndex < 0) return null;
    try {
      const observed = await multiProviderRpcManager.execute('polygon', 'contract_calls', async provider => {
        const ctf = new Contract(CONDITIONAL_TOKENS, CTF_ABI, provider);
        const denominator = await ctf.payoutDenominator(conditionId);
        if (denominator.isZero()) return { denominator: 0n, yes: 0n, no: 0n };
        const [yes, no] = await Promise.all([
          ctf.payoutNumerators(conditionId, yesIndex),
          ctf.payoutNumerators(conditionId, noIndex),
        ]);
        return { denominator: BigInt(denominator.toString()), yes: BigInt(yes.toString()), no: BigInt(no.toString()) };
      });
      const { denominator, yes, no } = observed.result;
      const now = Date.now();
      if (denominator === 0n) {
        return {
          venue: this.venue,
          marketId,
          terminal: false,
          result: 'unknown',
          payoutPerWinningContractUsd: null,
          realizedSettlementFeeUsd: null,
          observedAt: now,
          provenance: ['polymarket_ctf:payout_denominator_zero_not_terminal', `rpc_provider:${observed.provenance.provider}`],
        };
      }
      const explicitlyCancelled = row?.cancelled === true || row?.canceled === true;
      const result: EventVenueSettlement['result'] = explicitlyCancelled
        ? 'cancelled'
        : yes === denominator && no === 0n
          ? 'yes'
          : no === denominator && yes === 0n
            ? 'no'
            : yes > 0n && yes === no
              ? 'void'
              : 'unknown';
      return {
        venue: this.venue,
        marketId,
        terminal: result !== 'unknown',
        result,
        payoutPerWinningContractUsd: result === 'yes' || result === 'no' ? 1 : result === 'void' || result === 'cancelled' ? Number(yes) / Number(denominator) : null,
        realizedSettlementFeeUsd: result === 'unknown' ? null : 0,
        observedAt: now,
        provenance: [
          'polymarket_ctf:onchain_payout_vector',
          'polymarket_ctf:protocol_redemption_fee_zero_gas_external',
          `condition_id:${conditionId}`,
          `rpc_provider:${observed.provenance.provider}`,
          result === 'unknown' ? 'settlement:quarantine_unknown_vector' : 'settlement:terminal_authoritative',
        ],
      };
    } catch {
      return null;
    }
  }
}

export const polymarketEventVenue = new PolymarketEventVenue();