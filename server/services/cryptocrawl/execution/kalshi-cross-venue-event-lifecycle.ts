import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import {
  type CrossVenueEventArbitrageCandidate,
} from '../discovery/kalshi-cross-venue-event-arbitrage.js';
import { compareEventSemantics } from '../discovery/event-venue.js';
import { polymarketEventVenue } from '../discovery/polymarket-event-venue.js';
import { measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import { getKalshiEventSemanticsEvidence } from '../intelligence/kalshi-event-semantics-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  applyKalshiEventTerminalCashSettlement,
  recoverKalshiEventSystemCashReservation,
  releaseKalshiEventSystemCashReservation,
  reserveKalshiEventSystemCash,
  type KalshiEventSystemCashReservation,
} from './kalshi-event-system-owned-cash-ledger.js';
import {
  getKalshiEventOrder,
  getKalshiEventSettlement,
  placeOrRecoverKalshiEventOrder,
  requireTerminalKalshiEventFokFill,
  type KalshiEventFillEvidence,
  type KalshiEventOrderState,
} from './kalshi-event-order-authority.js';
import {
  recoverPolymarketSystemCashReservation,
  releasePolymarketSystemCashReservation,
  reservePolymarketSystemCash,
  type PolymarketSystemCashReservation,
} from './polymarket-system-owned-cash-ledger.js';

const TABLE = 'private.cryptocrawler_cross_venue_event_lifecycles';

type CrossVenueLifecycleStatus =
  | 'RESERVING'
  | 'KALSHI_OPENING'
  | 'KALSHI_FILLED'
  | 'POLYMARKET_OPENING'
  | 'HEDGED_WAITING_SETTLEMENT'
  | 'ONE_LEG_RECOVERY'
  | 'KALSHI_UNWINDING'
  | 'FLAT_RECOVERED'
  | 'SETTLED'
  | 'FAILED'
  | 'QUARANTINED';

type KalshiReceipt = {
  orderId: string;
  contracts: number;
  averageOutcomePrice: number;
  entryCostUsd: number;
  feeUsd: number;
  fills: KalshiEventFillEvidence[];
  observedAt: number;
};

type PolymarketReceipt = {
  orderId: string;
  contracts: number;
  averageOutcomePrice: number;
  entryCostUsd: number;
  feeUsd: number;
  observedAt: number;
};

type LifecycleRow = {
  lifecycleId: string;
  opportunityId: string;
  status: CrossVenueLifecycleStatus;
  plan: CrossVenueEventArbitrageCandidate;
  semanticFingerprint: string;
  kalshiCashReservationId: string | null;
  polymarketCashReservationId: string | null;
  kalshiOrderId: string | null;
  polymarketOrderId: string | null;
  kalshiUnwindOrderId: string | null;
  kalshiEntryReceipt: KalshiReceipt | null;
  polymarketEntryReceipt: PolymarketReceipt | null;
  recoveryReceipt: Record<string, unknown> | null;
  terminalSettlement: Record<string, unknown> | null;
  lastError: string | null;
};

export interface CrossVenueEventLifecycleResult {
  lifecycleId: string;
  opportunityId: string;
  status: CrossVenueLifecycleStatus;
  submitted: boolean;
  hedged: boolean;
  settlementConfirmed: boolean;
  success: boolean;
  kalshiOrderId?: string;
  polymarketOrderId?: string;
  recoveryOrderId?: string;
  error?: string;
}

type FreshAdmission = {
  semanticFingerprint: string;
  kalshiWorstOutcomePrice: number;
  polymarketWorstPrice: number;
  kalshiNotionalUsd: number;
  polymarketNotionalUsd: number;
  kalshiFeeUsd: number;
  polymarketFeeUsd: number;
  slippageUsd: number;
  settlementCostReserveUsd: number;
  capitalLockCostUsd: number;
  guaranteedResidualUsd: number;
  kalshiReserveUsd: number;
  polymarketReserveUsd: number;
  expiresAt: number;
};

function lifecycleId(opportunityId: string): string {
  const digest = createHash('sha256').update(`cryptocrawl:cross-event:${opportunityId}`).digest('hex');
  return `cross-event:${digest.slice(0, 48)}`;
}
function polymarketClientOrderId(id: string): string {
  return `cpx-${createHash('sha256').update(`${id}:polymarket`).digest('hex').slice(0, 44)}`;
}
function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('CROSS_EVENT_NON_FINITE_DECIMAL');
  return value.toFixed(12).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function tolerance(value: number): number { return Math.max(1e-8, Math.abs(value) * 1e-8); }
function minimumResidualUsd(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_CROSS_EVENT_MIN_RESIDUAL_USD || 0.01);
  return Number.isFinite(parsed) ? Math.max(0.000001, Math.min(10_000, parsed)) : 0.01;
}
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return null; }
}
function parseRow(row: any): LifecycleRow | null {
  if (!row?.lifecycle_id || !row?.opportunity_id) return null;
  const plan = parseJson<CrossVenueEventArbitrageCandidate>(row.plan);
  if (!plan) return null;
  return {
    lifecycleId: String(row.lifecycle_id),
    opportunityId: String(row.opportunity_id),
    status: String(row.status) as CrossVenueLifecycleStatus,
    plan,
    semanticFingerprint: String(row.semantic_fingerprint || ''),
    kalshiCashReservationId: row.kalshi_cash_reservation_id ? String(row.kalshi_cash_reservation_id) : null,
    polymarketCashReservationId: row.polymarket_cash_reservation_id ? String(row.polymarket_cash_reservation_id) : null,
    kalshiOrderId: row.kalshi_order_id ? String(row.kalshi_order_id) : null,
    polymarketOrderId: row.polymarket_order_id ? String(row.polymarket_order_id) : null,
    kalshiUnwindOrderId: row.kalshi_unwind_order_id ? String(row.kalshi_unwind_order_id) : null,
    kalshiEntryReceipt: parseJson<KalshiReceipt>(row.kalshi_entry_receipt),
    polymarketEntryReceipt: parseJson<PolymarketReceipt>(row.polymarket_entry_receipt),
    recoveryReceipt: parseJson<Record<string, unknown>>(row.recovery_receipt),
    terminalSettlement: parseJson<Record<string, unknown>>(row.terminal_settlement),
    lastError: row.last_error ? String(row.last_error) : null,
  };
}
function terminal(status: CrossVenueLifecycleStatus): boolean {
  return status === 'FLAT_RECOVERED' || status === 'SETTLED' || status === 'FAILED';
}
function result(row: LifecycleRow, error?: string): CrossVenueEventLifecycleResult {
  return {
    lifecycleId: row.lifecycleId,
    opportunityId: row.opportunityId,
    status: row.status,
    submitted: Boolean(row.kalshiOrderId || row.polymarketOrderId),
    hedged: row.status === 'HEDGED_WAITING_SETTLEMENT' || row.status === 'SETTLED',
    settlementConfirmed: row.status === 'SETTLED' || row.status === 'FLAT_RECOVERED',
    success: row.status === 'SETTLED',
    kalshiOrderId: row.kalshiOrderId ?? undefined,
    polymarketOrderId: row.polymarketOrderId ?? undefined,
    recoveryOrderId: row.kalshiUnwindOrderId ?? undefined,
    error: error ?? row.lastError ?? undefined,
  };
}
async function persist(id: string, patch: Record<string, unknown>): Promise<LifecycleRow> {
  const allowed = new Set([
    'status','semantic_fingerprint','kalshi_cash_reservation_id','polymarket_cash_reservation_id',
    'kalshi_order_id','polymarket_order_id','kalshi_unwind_order_id','kalshi_entry_receipt',
    'polymarket_entry_receipt','recovery_receipt','terminal_settlement','last_error','submitted_at','terminal_at',
  ]);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) {
    const current = await loadByLifecycleId(id);
    if (!current) throw new Error('CROSS_EVENT_LIFECYCLE_MISSING');
    return current;
  }
  const setters = entries.map(([key], index) => `${key}=$${index + 2}`).join(',');
  const updated = await pool.query(
    `UPDATE ${TABLE} SET ${setters},updated_at=now() WHERE lifecycle_id=$1 RETURNING *`,
    [id, ...entries.map(([, value]) => value)],
  );
  const row = parseRow(updated.rows?.[0]);
  if (!row) throw new Error('CROSS_EVENT_LIFECYCLE_UPDATE_FAILED');
  return row;
}
async function loadByLifecycleId(id: string): Promise<LifecycleRow | null> {
  const query = await pool.query(`SELECT * FROM ${TABLE} WHERE lifecycle_id=$1`, [id]);
  return parseRow(query.rows?.[0]);
}
async function createOrLoad(candidate: CrossVenueEventArbitrageCandidate): Promise<LifecycleRow> {
  const id = lifecycleId(candidate.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id]);
    const prior = await client.query(`SELECT * FROM ${TABLE} WHERE lifecycle_id=$1 FOR UPDATE`, [id]);
    const existing = parseRow(prior.rows?.[0]);
    if (existing) {
      if (existing.opportunityId !== candidate.id
        || existing.plan.kalshiTicker !== candidate.kalshiTicker
        || existing.plan.secondVenueMarketId !== candidate.secondVenueMarketId
        || existing.plan.kalshiOutcome !== candidate.kalshiOutcome
        || existing.plan.secondVenueOutcome !== candidate.secondVenueOutcome
        || existing.plan.matchedContracts !== candidate.matchedContracts) {
        throw new Error('CROSS_EVENT_LIFECYCLE_IMMUTABLE_PLAN_MISMATCH');
      }
      await client.query('COMMIT');
      return existing;
    }
    const inserted = await client.query(
      `INSERT INTO ${TABLE} (
         lifecycle_id,opportunity_id,kalshi_ticker,polymarket_market_id,polymarket_condition_id,
         matched_contracts,kalshi_outcome,polymarket_outcome,status,plan,semantic_fingerprint
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RESERVING',$9::jsonb,$10) RETURNING *`,
      [
        id,
        candidate.id,
        candidate.kalshiTicker.trim().toUpperCase(),
        candidate.secondVenueMarketId,
        String(candidate.provenance.find(value => value.startsWith('condition_id:'))?.slice('condition_id:'.length) || '0x' + '0'.repeat(64)),
        candidate.matchedContracts,
        candidate.kalshiOutcome,
        candidate.secondVenueOutcome,
        JSON.stringify(candidate),
        'pending',
      ],
    );
    await client.query('COMMIT');
    const row = parseRow(inserted.rows?.[0]);
    if (!row) throw new Error('CROSS_EVENT_LIFECYCLE_INSERT_FAILED');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function kalshiBookOrder(outcome: 'yes' | 'no', action: 'buy' | 'sell', outcomePrice: number): { side: 'bid' | 'ask'; price: number } {
  if (!(outcomePrice > 0) || !(outcomePrice < 1)) throw new Error('CROSS_EVENT_KALSHI_OUTCOME_PRICE_INVALID');
  const side = outcome === 'yes' ? (action === 'buy' ? 'bid' : 'ask') : (action === 'buy' ? 'ask' : 'bid');
  const price = outcome === 'yes' ? outcomePrice : 1 - outcomePrice;
  return { side, price };
}

async function freshAdmission(candidate: CrossVenueEventArbitrageCandidate): Promise<FreshAdmission> {
  const now = Date.now();
  if (candidate.status !== 'eligible' || candidate.expiresAt <= now || candidate.matchedContracts <= 0) {
    throw new Error('CROSS_EVENT_CANDIDATE_NOT_CURRENTLY_ELIGIBLE');
  }
  const [kalshiSemantics, secondMarket, secondAccount, kalshiDepth, secondQuote] = await Promise.all([
    getKalshiEventSemanticsEvidence(candidate.kalshiTicker, true),
    polymarketEventVenue.getMarket(candidate.secondVenueMarketId),
    polymarketEventVenue.getAccountEvidence(),
    measureKalshiEventSizedDepth({
      ticker: candidate.kalshiTicker,
      outcome: candidate.kalshiOutcome,
      side: 'buy',
      contracts: candidate.matchedContracts,
      forceRefresh: true,
    }),
    polymarketEventVenue.getSizedQuote(
      candidate.secondVenueMarketId,
      candidate.secondVenueOutcome,
      'buy',
      candidate.matchedContracts,
    ),
  ]);
  if (!kalshiSemantics?.complete || !kalshiSemantics.semantics || !secondMarket?.semantics) {
    throw new Error('CROSS_EVENT_EXACT_SEMANTICS_UNAVAILABLE');
  }
  const equivalence = compareEventSemantics(kalshiSemantics.semantics, secondMarket.semantics);
  if (!equivalence.equivalent) throw new Error(`CROSS_EVENT_SEMANTIC_MISMATCH:${equivalence.mismatches.join(',')}`);
  if (secondMarket.status !== 'open') throw new Error('CROSS_EVENT_POLYMARKET_NOT_OPEN');
  if (!secondAccount.authenticated || !secondAccount.accountAccessible || !secondAccount.orderSubmissionAllowed) {
    throw new Error('CROSS_EVENT_POLYMARKET_EXECUTION_ACCESS_UNPROVEN');
  }
  if (!kalshiDepth?.complete || kalshiDepth.notionalUsd === null || kalshiDepth.vwapPrice === null || kalshiDepth.worstPrice === null || kalshiDepth.expiresAt <= now) {
    throw new Error('CROSS_EVENT_KALSHI_EXECUTABLE_DEPTH_UNPROVEN');
  }
  if (!secondQuote?.complete || !secondQuote.authenticated || secondQuote.notionalUsd === null || secondQuote.vwapPrice === null || secondQuote.worstPrice === null || secondQuote.feeUsd === null || secondQuote.slippageUsd === null || secondQuote.expiresAt <= now) {
    throw new Error('CROSS_EVENT_POLYMARKET_EXECUTABLE_QUOTE_UNPROVEN');
  }
  const kalshiFee = await estimateKalshiEventFees({
    ticker: candidate.kalshiTicker,
    contracts: candidate.matchedContracts,
    price: kalshiDepth.vwapPrice,
    forceRefresh: true,
  });
  if (!kalshiFee?.economicCreditAllowed || kalshiFee.takerFeeUsd === null || kalshiFee.expiresAt <= now) {
    throw new Error('CROSS_EVENT_KALSHI_AUTHENTICATED_FEE_UNPROVEN');
  }
  const settlementCostReserveUsd = candidate.settlementCostReserveUsd;
  const capitalLockCostUsd = candidate.capitalLockCostUsd;
  if (settlementCostReserveUsd === null || settlementCostReserveUsd < 0 || capitalLockCostUsd === null || capitalLockCostUsd < 0) {
    throw new Error('CROSS_EVENT_SETTLEMENT_OR_CAPITAL_LOCK_COST_UNPROVEN');
  }
  // VWAP notional already contains book slippage. Keep slippage observable but
  // never subtract it a second time from the guaranteed residual.
  const guaranteedResidualUsd = candidate.matchedContracts
    - kalshiDepth.notionalUsd
    - secondQuote.notionalUsd
    - kalshiFee.takerFeeUsd
    - secondQuote.feeUsd
    - settlementCostReserveUsd
    - capitalLockCostUsd;
  if (!(guaranteedResidualUsd >= minimumResidualUsd())) {
    throw new Error(`CROSS_EVENT_CURRENT_GUARANTEED_RESIDUAL_BELOW_FLOOR:${guaranteedResidualUsd.toFixed(8)}`);
  }
  const kalshiReserveUsd = candidate.matchedContracts * kalshiDepth.worstPrice + kalshiFee.takerFeeUsd;
  const polymarketReserveUsd = candidate.matchedContracts * secondQuote.worstPrice + secondQuote.feeUsd;
  if (secondAccount.prefundedSystemOwnedUsd === null || secondAccount.prefundedSystemOwnedUsd + tolerance(secondAccount.prefundedSystemOwnedUsd) < polymarketReserveUsd) {
    throw new Error('CROSS_EVENT_POLYMARKET_SYSTEM_OWNED_PREFUNDING_INSUFFICIENT');
  }
  return {
    semanticFingerprint: equivalence.left.canonical,
    kalshiWorstOutcomePrice: kalshiDepth.worstPrice,
    polymarketWorstPrice: secondQuote.worstPrice,
    kalshiNotionalUsd: kalshiDepth.notionalUsd,
    polymarketNotionalUsd: secondQuote.notionalUsd,
    kalshiFeeUsd: kalshiFee.takerFeeUsd,
    polymarketFeeUsd: secondQuote.feeUsd,
    slippageUsd: secondQuote.slippageUsd,
    settlementCostReserveUsd,
    capitalLockCostUsd,
    guaranteedResidualUsd,
    kalshiReserveUsd,
    polymarketReserveUsd,
    expiresAt: Math.min(candidate.expiresAt, kalshiDepth.expiresAt, secondQuote.expiresAt, secondMarket.expiresAt),
  };
}

async function ensureReservations(row: LifecycleRow, admission: FreshAdmission): Promise<{ row: LifecycleRow; kalshi: KalshiEventSystemCashReservation; polymarket: PolymarketSystemCashReservation }> {
  let kalshi = await recoverKalshiEventSystemCashReservation({ lifecycleId: row.lifecycleId, opportunityId: row.opportunityId });
  if (!kalshi) {
    kalshi = await reserveKalshiEventSystemCash({
      lifecycleId: row.lifecycleId,
      opportunityId: row.opportunityId,
      amountUsd: admission.kalshiReserveUsd,
      expiresAt: admission.expiresAt,
    });
  }
  if (!kalshi || kalshi.amountUsd + tolerance(kalshi.amountUsd) < admission.kalshiReserveUsd) {
    throw new Error('CROSS_EVENT_KALSHI_SYSTEM_CASH_RESERVATION_UNAVAILABLE');
  }
  let polymarket = await recoverPolymarketSystemCashReservation({ lifecycleId: row.lifecycleId, opportunityId: row.opportunityId });
  if (!polymarket) {
    polymarket = await reservePolymarketSystemCash({
      lifecycleId: row.lifecycleId,
      opportunityId: row.opportunityId,
      amountUsd: admission.polymarketReserveUsd,
      expiresAt: admission.expiresAt,
    });
  }
  if (!polymarket || polymarket.amountUsd + tolerance(polymarket.amountUsd) < admission.polymarketReserveUsd) {
    await releaseKalshiEventSystemCashReservation(kalshi.reservationId).catch(() => undefined);
    throw new Error('CROSS_EVENT_POLYMARKET_SYSTEM_CASH_RESERVATION_UNAVAILABLE');
  }
  row = await persist(row.lifecycleId, {
    semantic_fingerprint: admission.semanticFingerprint,
    kalshi_cash_reservation_id: kalshi.reservationId,
    polymarket_cash_reservation_id: polymarket.reservationId,
    last_error: null,
  });
  return { row, kalshi, polymarket };
}

function buildKalshiReceipt(candidate: CrossVenueEventArbitrageCandidate, state: KalshiEventOrderState, fills: KalshiEventFillEvidence[], feeUsd: number): KalshiReceipt {
  const entryCostUsd = fills.reduce((sum, fill) => sum + fill.contracts * (candidate.kalshiOutcome === 'yes' ? fill.yesPrice : fill.noPrice), 0);
  return {
    orderId: state.orderId,
    contracts: candidate.matchedContracts,
    averageOutcomePrice: entryCostUsd / candidate.matchedContracts,
    entryCostUsd,
    feeUsd,
    fills: fills.map(fill => ({ ...fill })),
    observedAt: Date.now(),
  };
}

async function resolveKalshiEntry(row: LifecycleRow, admission: FreshAdmission): Promise<LifecycleRow> {
  const candidate = row.plan;
  let state: KalshiEventOrderState | null = row.kalshiOrderId ? await getKalshiEventOrder(row.kalshiOrderId).catch(() => null) : null;
  if (!state) {
    const order = kalshiBookOrder(candidate.kalshiOutcome, 'buy', admission.kalshiWorstOutcomePrice);
    state = await placeOrRecoverKalshiEventOrder({
      scope: row.lifecycleId,
      leg: 'cross-entry',
      ticker: candidate.kalshiTicker,
      side: order.side,
      contracts: candidate.matchedContracts,
      price: order.price,
      timeInForce: 'fill_or_kill',
      postOnly: false,
      reduceOnly: false,
      cancelOrderOnPause: true,
    });
    row = await persist(row.lifecycleId, {
      status: 'KALSHI_OPENING',
      kalshi_order_id: state.orderId,
      submitted_at: new Date(),
      last_error: null,
    });
  }
  let terminalFill: Awaited<ReturnType<typeof requireTerminalKalshiEventFokFill>>;
  try {
    terminalFill = await requireTerminalKalshiEventFokFill({ state, requestedContracts: candidate.matchedContracts });
  } catch (error) {
    return persist(row.lifecycleId, {
      status: 'KALSHI_OPENING',
      last_error: error instanceof Error ? error.message : String(error),
    });
  }
  const receipt = buildKalshiReceipt(candidate, terminalFill.state, terminalFill.fills, terminalFill.feeUsd);
  return persist(row.lifecycleId, {
    status: 'KALSHI_FILLED',
    kalshi_entry_receipt: JSON.stringify(receipt),
    last_error: null,
  });
}

async function currentSecondLegAdmission(row: LifecycleRow): Promise<{ limitPrice: number; notionalUsd: number; feeUsd: number; residualUsd: number }> {
  const candidate = row.plan;
  if (!row.kalshiEntryReceipt) throw new Error('CROSS_EVENT_KALSHI_ENTRY_RECEIPT_MISSING');
  const [market, account, quote] = await Promise.all([
    polymarketEventVenue.getMarket(candidate.secondVenueMarketId),
    polymarketEventVenue.getAccountEvidence(),
    polymarketEventVenue.getSizedQuote(candidate.secondVenueMarketId, candidate.secondVenueOutcome, 'buy', candidate.matchedContracts),
  ]);
  const kalshiSemantics = await getKalshiEventSemanticsEvidence(candidate.kalshiTicker, true);
  if (!market?.semantics || !kalshiSemantics?.complete || !kalshiSemantics.semantics) throw new Error('CROSS_EVENT_SECOND_LEG_SEMANTICS_UNAVAILABLE');
  const equivalence = compareEventSemantics(kalshiSemantics.semantics, market.semantics);
  if (!equivalence.equivalent || equivalence.left.canonical !== row.semanticFingerprint) throw new Error('CROSS_EVENT_SEMANTICS_CHANGED_AFTER_FIRST_FILL');
  if (!account.authenticated || !account.accountAccessible || !account.orderSubmissionAllowed) throw new Error('CROSS_EVENT_POLYMARKET_ACCESS_CHANGED_AFTER_FIRST_FILL');
  if (!quote?.complete || !quote.authenticated || quote.notionalUsd === null || quote.worstPrice === null || quote.feeUsd === null || quote.expiresAt <= Date.now()) {
    throw new Error('CROSS_EVENT_SECOND_LEG_EXECUTABLE_QUOTE_UNPROVEN');
  }
  const settlement = candidate.settlementCostReserveUsd ?? 0;
  const capitalLock = candidate.capitalLockCostUsd ?? 0;
  const residualUsd = candidate.matchedContracts
    - row.kalshiEntryReceipt.entryCostUsd
    - row.kalshiEntryReceipt.feeUsd
    - quote.notionalUsd
    - quote.feeUsd
    - settlement
    - capitalLock;
  if (!(residualUsd >= minimumResidualUsd())) throw new Error(`CROSS_EVENT_SECOND_LEG_NO_LONGER_PROFITABLE:${residualUsd.toFixed(8)}`);
  return { limitPrice: quote.worstPrice, notionalUsd: quote.notionalUsd, feeUsd: quote.feeUsd, residualUsd };
}

async function resolvePolymarketEntry(row: LifecycleRow): Promise<LifecycleRow> {
  const candidate = row.plan;
  const second = await currentSecondLegAdmission(row);
  let state = row.polymarketOrderId ? await polymarketEventVenue.getOrder(row.polymarketOrderId).catch(() => null) : null;
  if (!state) {
    state = await polymarketEventVenue.placeOrRecoverOrder({
      clientOrderId: polymarketClientOrderId(row.lifecycleId),
      marketId: candidate.secondVenueMarketId,
      outcome: candidate.secondVenueOutcome,
      side: 'buy',
      contracts: candidate.matchedContracts,
      limitPrice: second.limitPrice,
      timeInForce: 'fill_or_kill',
      postOnly: false,
      reduceOnly: false,
    });
    row = await persist(row.lifecycleId, {
      status: 'POLYMARKET_OPENING',
      polymarket_order_id: state.orderId || null,
      last_error: null,
    });
  }
  if (state.status === 'filled'
    && state.terminal
    && state.filledContracts + tolerance(candidate.matchedContracts) >= candidate.matchedContracts
    && state.averageFillPrice !== null
    && state.realizedFeeUsd !== null) {
    const receipt: PolymarketReceipt = {
      orderId: state.orderId,
      contracts: candidate.matchedContracts,
      averageOutcomePrice: state.averageFillPrice,
      entryCostUsd: state.averageFillPrice * candidate.matchedContracts,
      feeUsd: state.realizedFeeUsd,
      observedAt: Date.now(),
    };
    return persist(row.lifecycleId, {
      status: 'HEDGED_WAITING_SETTLEMENT',
      polymarket_entry_receipt: JSON.stringify(receipt),
      last_error: null,
    });
  }
  if (state.status === 'cancelled' || state.status === 'rejected') {
    return persist(row.lifecycleId, { status: 'ONE_LEG_RECOVERY', last_error: `POLYMARKET_SECOND_LEG_${state.status.toUpperCase()}` });
  }
  if (state.filledContracts > tolerance(candidate.matchedContracts)
    && state.filledContracts + tolerance(candidate.matchedContracts) < candidate.matchedContracts) {
    return persist(row.lifecycleId, { status: 'QUARANTINED', last_error: 'POLYMARKET_FOK_PARTIAL_FILL_INVARIANT_BREACH' });
  }
  return persist(row.lifecycleId, { status: 'POLYMARKET_OPENING', last_error: 'POLYMARKET_FOK_TERMINAL_STATE_PENDING' });
}

async function unwindKalshiFirstLeg(row: LifecycleRow): Promise<LifecycleRow> {
  const candidate = row.plan;
  const entry = row.kalshiEntryReceipt;
  if (!entry) return persist(row.lifecycleId, { status: 'QUARANTINED', last_error: 'CROSS_EVENT_RECOVERY_ENTRY_RECEIPT_MISSING' });
  const depth = await measureKalshiEventSizedDepth({
    ticker: candidate.kalshiTicker,
    outcome: candidate.kalshiOutcome,
    side: 'sell',
    contracts: candidate.matchedContracts,
    forceRefresh: true,
  }).catch(() => null);
  if (!depth?.complete || depth.worstPrice === null || depth.vwapPrice === null || depth.notionalUsd === null || depth.expiresAt <= Date.now()) {
    return persist(row.lifecycleId, { status: 'ONE_LEG_RECOVERY', last_error: 'KALSHI_REDUCE_ONLY_UNWIND_DEPTH_UNPROVEN' });
  }
  const fee = await estimateKalshiEventFees({
    ticker: candidate.kalshiTicker,
    contracts: candidate.matchedContracts,
    price: depth.vwapPrice,
    forceRefresh: true,
  }).catch(() => null);
  if (!fee?.economicCreditAllowed || fee.takerFeeUsd === null) {
    return persist(row.lifecycleId, { status: 'ONE_LEG_RECOVERY', last_error: 'KALSHI_REDUCE_ONLY_UNWIND_FEE_UNPROVEN' });
  }
  const order = kalshiBookOrder(candidate.kalshiOutcome, 'sell', depth.worstPrice);
  let state = row.kalshiUnwindOrderId ? await getKalshiEventOrder(row.kalshiUnwindOrderId).catch(() => null) : null;
  if (!state) {
    state = await placeOrRecoverKalshiEventOrder({
      scope: row.lifecycleId,
      leg: 'cross-unwind',
      ticker: candidate.kalshiTicker,
      side: order.side,
      contracts: candidate.matchedContracts,
      price: order.price,
      timeInForce: 'fill_or_kill',
      postOnly: false,
      reduceOnly: true,
      cancelOrderOnPause: true,
    });
    row = await persist(row.lifecycleId, {
      status: 'KALSHI_UNWINDING',
      kalshi_unwind_order_id: state.orderId,
      last_error: null,
    });
  }
  let terminalFill: Awaited<ReturnType<typeof requireTerminalKalshiEventFokFill>>;
  try {
    terminalFill = await requireTerminalKalshiEventFokFill({ state, requestedContracts: candidate.matchedContracts });
  } catch (error) {
    return persist(row.lifecycleId, { status: 'KALSHI_UNWINDING', last_error: error instanceof Error ? error.message : String(error) });
  }
  const proceedsUsd = terminalFill.fills.reduce((sum, fill) => sum + fill.contracts * (candidate.kalshiOutcome === 'yes' ? fill.yesPrice : fill.noPrice), 0);
  const unwindFeeUsd = terminalFill.feeUsd;
  const realizedPnlUsd = proceedsUsd - entry.entryCostUsd - entry.feeUsd - unwindFeeUsd;
  const recoveryReceipt = {
    entryOrderId: entry.orderId,
    unwindOrderId: terminalFill.state.orderId,
    contracts: candidate.matchedContracts,
    entryCostUsd: entry.entryCostUsd,
    entryFeeUsd: entry.feeUsd,
    unwindProceedsUsd: proceedsUsd,
    unwindFeeUsd,
    realizedPnlUsd,
    zeroResidualPositionRequired: true,
    reduceOnly: true,
    observedAt: Date.now(),
  };
  await applyKalshiEventTerminalCashSettlement({
    settlementReference: `cross-event-flat:${row.lifecycleId}`,
    lifecycleId: row.lifecycleId,
    opportunityId: row.opportunityId,
    strategy: 'kalshi_polymarket_cross_event_arbitrage_recovery',
    cashDeltaUsd: decimal(realizedPnlUsd),
    realizedStrategyProfitUsd: decimal(realizedPnlUsd),
    realizedFeesUsd: decimal(entry.feeUsd + unwindFeeUsd),
    realizedIncentiveUsd: '0',
    settlementEvidence: recoveryReceipt,
    authorityEvidence: {
      oneLegRecovery: true,
      kalshiAuthenticatedFills: true,
      reduceOnlyUnwind: true,
      polymarketSecondLegFilled: false,
      personalCapitalUsed: false,
    },
  });
  if (row.kalshiCashReservationId) await releaseKalshiEventSystemCashReservation(row.kalshiCashReservationId);
  if (row.polymarketCashReservationId) await releasePolymarketSystemCashReservation(row.polymarketCashReservationId);
  return persist(row.lifecycleId, {
    status: 'FLAT_RECOVERED',
    recovery_receipt: JSON.stringify(recoveryReceipt),
    terminal_at: new Date(),
    last_error: null,
  });
}

async function reconcileHedgedSettlement(row: LifecycleRow): Promise<LifecycleRow> {
  const candidate = row.plan;
  const [kalshiSettlement, polymarketSettlement] = await Promise.all([
    getKalshiEventSettlement(candidate.kalshiTicker).catch(() => null),
    polymarketEventVenue.getSettlement(candidate.secondVenueMarketId).catch(() => null),
  ]);
  if (!kalshiSettlement || !polymarketSettlement?.terminal) return row;
  const kalshiResult = String(kalshiSettlement.marketResult || '').toLowerCase();
  const polymarketResult = polymarketSettlement.result;
  if ((kalshiResult !== 'yes' && kalshiResult !== 'no') || (polymarketResult !== 'yes' && polymarketResult !== 'no')) {
    return persist(row.lifecycleId, {
      status: 'QUARANTINED',
      terminal_settlement: JSON.stringify({ kalshiSettlement, polymarketSettlement }),
      last_error: 'CROSS_EVENT_NON_BINARY_OR_EXCEPTIONAL_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION',
    });
  }
  if (kalshiResult !== polymarketResult) {
    return persist(row.lifecycleId, {
      status: 'QUARANTINED',
      terminal_settlement: JSON.stringify({ kalshiSettlement, polymarketSettlement }),
      last_error: 'CROSS_EVENT_EQUIVALENT_MARKETS_RESOLVED_DIFFERENTLY',
    });
  }
  return persist(row.lifecycleId, {
    status: 'HEDGED_WAITING_SETTLEMENT',
    terminal_settlement: JSON.stringify({
      kalshiSettlement,
      polymarketSettlement,
      commonResolution: kalshiResult,
      exactlyOnePurchasedOutcomeWins: candidate.kalshiOutcome !== candidate.secondVenueOutcome,
      resolutionProven: true,
      polymarketOnchainRedemptionCashRealizationRequired: true,
    }),
    last_error: 'POLYMARKET_REDEMPTION_CASH_REALIZATION_REQUIRED',
  });
}

async function advance(row: LifecycleRow, fresh?: FreshAdmission): Promise<LifecycleRow> {
  if (terminal(row.status) || row.status === 'QUARANTINED') return row;
  if (row.status === 'HEDGED_WAITING_SETTLEMENT') return reconcileHedgedSettlement(row);
  if (row.status === 'ONE_LEG_RECOVERY' || row.status === 'KALSHI_UNWINDING') return unwindKalshiFirstLeg(row);

  let admission = fresh;
  if (!admission) admission = await freshAdmission(row.plan);
  if (row.semanticFingerprint !== 'pending' && row.semanticFingerprint !== admission.semanticFingerprint) {
    return persist(row.lifecycleId, { status: 'QUARANTINED', last_error: 'CROSS_EVENT_SEMANTICS_CHANGED_BEFORE_COMPLETION' });
  }
  const reserved = await ensureReservations(row, admission);
  row = reserved.row;
  if (row.status === 'RESERVING' || row.status === 'KALSHI_OPENING') row = await resolveKalshiEntry(row, admission);
  if (row.status === 'KALSHI_FILLED' || row.status === 'POLYMARKET_OPENING') {
    try {
      row = await resolvePolymarketEntry(row);
    } catch (error) {
      row = await persist(row.lifecycleId, { status: 'ONE_LEG_RECOVERY', last_error: error instanceof Error ? error.message : String(error) });
      row = await unwindKalshiFirstLeg(row);
    }
  }
  return row;
}

export async function executeKalshiCrossVenueEventCandidate(candidate: CrossVenueEventArbitrageCandidate): Promise<CrossVenueEventLifecycleResult> {
  let row = await createOrLoad(candidate);
  try {
    const admission = await freshAdmission(candidate);
    row = await advance(row, admission);
    return result(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!row.kalshiOrderId) {
      if (row.kalshiCashReservationId) await releaseKalshiEventSystemCashReservation(row.kalshiCashReservationId).catch(() => undefined);
      if (row.polymarketCashReservationId) await releasePolymarketSystemCashReservation(row.polymarketCashReservationId).catch(() => undefined);
      row = await persist(row.lifecycleId, { status: 'FAILED', last_error: message, terminal_at: new Date() });
    } else {
      row = await persist(row.lifecycleId, { status: 'ONE_LEG_RECOVERY', last_error: message });
      row = await unwindKalshiFirstLeg(row).catch(() => row);
    }
    logger.error('[CrossVenueEventLifecycle] Cross-venue lifecycle failed closed', {
      component: 'KalshiCrossVenueEventLifecycle', lifecycleId: row.lifecycleId,
      opportunityId: row.opportunityId, status: row.status, error: message,
      secondLegSubmittedWhileFirstLegAmbiguous: false,
      personalCapitalFallback: false,
    });
    return result(row, message);
  }
}

export async function advanceKalshiCrossVenueEventLifecycles(limit = 8): Promise<CrossVenueEventLifecycleResult[]> {
  const capped = Math.max(1, Math.min(64, Math.trunc(limit)));
  const query = await pool.query(
    `SELECT * FROM ${TABLE}
     WHERE status NOT IN ('FLAT_RECOVERED','SETTLED','FAILED','QUARANTINED')
     ORDER BY updated_at ASC LIMIT $1`,
    [capped],
  );
  const output: CrossVenueEventLifecycleResult[] = [];
  for (const raw of query.rows) {
    let row = parseRow(raw);
    if (!row) continue;
    try {
      row = await advance(row);
      output.push(result(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (row.kalshiOrderId && !row.polymarketEntryReceipt) {
        row = await persist(row.lifecycleId, { status: 'ONE_LEG_RECOVERY', last_error: message });
        row = await unwindKalshiFirstLeg(row).catch(() => row);
      } else {
        row = await persist(row.lifecycleId, { last_error: message });
      }
      output.push(result(row, message));
    }
  }
  return output;
}
