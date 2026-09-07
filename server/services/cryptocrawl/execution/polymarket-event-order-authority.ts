import logger from '../../../logger.js';
import type { EventOrderSide, EventOrderTimeInForce, EventOutcome, EventVenueOrderState } from '../discovery/event-venue.js';
import {
  buildPolymarketSignedOrder,
  cancelPolymarketOrder,
  getPolymarketOrder,
  getPolymarketTrades,
  postPolymarketSignedOrder,
} from '../intelligence/polymarket-authenticated-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';

const TABLE = 'private.cryptocrawler_polymarket_event_order_intents';

type IntentStatus = 'PREPARING' | 'PREPARED' | 'SUBMISSION_UNKNOWN' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'RECOVERY_REQUIRED';

type IntentRow = {
  clientOrderId: string;
  marketId: string;
  conditionId: string;
  tokenId: string;
  outcome: EventOutcome;
  side: EventOrderSide;
  contracts: number;
  limitPrice: number;
  timeInForce: EventOrderTimeInForce;
  postOnly: boolean;
  orderTimestamp: string;
  orderId: string | null;
  signedBody: Record<string, unknown> | null;
  status: IntentStatus;
  filledContracts: number;
  averageFillPrice: number | null;
  realizedFeeUsd: number | null;
};

export interface PolymarketEventOrderIntent {
  clientOrderId: string;
  marketId: string;
  conditionId: string;
  tokenId: string;
  outcome: EventOutcome;
  side: EventOrderSide;
  contracts: number;
  limitPrice: number;
  timeInForce: EventOrderTimeInForce;
  postOnly: boolean;
  tickSize: number;
  negRisk: boolean;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseBody(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; }
}
function parseRow(row: any): IntentRow | null {
  if (!row?.client_order_id) return null;
  const contracts = Number(row.contracts);
  const limitPrice = Number(row.limit_price);
  if (!Number.isFinite(contracts) || contracts <= 0 || !Number.isFinite(limitPrice) || !(limitPrice > 0) || !(limitPrice < 1)) return null;
  return {
    clientOrderId: String(row.client_order_id),
    marketId: String(row.market_id),
    conditionId: String(row.condition_id),
    tokenId: String(row.token_id),
    outcome: String(row.outcome) as EventOutcome,
    side: String(row.side) as EventOrderSide,
    contracts,
    limitPrice,
    timeInForce: String(row.time_in_force) as EventOrderTimeInForce,
    postOnly: row.post_only === true,
    orderTimestamp: String(row.order_timestamp),
    orderId: row.order_id ? String(row.order_id) : null,
    signedBody: parseBody(row.signed_body),
    status: String(row.status) as IntentStatus,
    filledContracts: Math.max(0, Number(row.filled_contracts || 0)),
    averageFillPrice: finite(row.average_fill_price),
    realizedFeeUsd: finite(row.realized_fee_usd),
  };
}
function immutableIntentMatches(row: IntentRow, input: PolymarketEventOrderIntent): boolean {
  return row.marketId === input.marketId
    && row.conditionId.toLowerCase() === input.conditionId.toLowerCase()
    && row.tokenId === input.tokenId
    && row.outcome === input.outcome
    && row.side === input.side
    && row.contracts === input.contracts
    && Math.abs(row.limitPrice - input.limitPrice) <= 1e-12
    && row.timeInForce === input.timeInForce
    && row.postOnly === input.postOnly;
}
function terminalStatus(status: IntentStatus): boolean {
  return status === 'FILLED' || status === 'CANCELLED' || status === 'REJECTED';
}
function venueStatus(status: IntentStatus): EventVenueOrderState['status'] {
  if (status === 'FILLED') return 'filled';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'REJECTED') return 'rejected';
  if (status === 'OPEN' || status === 'PARTIALLY_FILLED') return 'open';
  if (status === 'PREPARING' || status === 'PREPARED') return 'pending';
  return 'unknown';
}
function toState(row: IntentRow, provenance: string[] = []): EventVenueOrderState {
  return {
    venue: 'polymarket',
    marketId: row.marketId,
    clientOrderId: row.clientOrderId,
    orderId: row.orderId ?? '',
    status: venueStatus(row.status),
    filledContracts: row.filledContracts,
    averageFillPrice: row.averageFillPrice,
    realizedFeeUsd: row.realizedFeeUsd,
    terminal: terminalStatus(row.status),
    observedAt: Date.now(),
    provenance: [
      'polymarket_order_intent:durable',
      'polymarket_order_recovery:exact_signed_payload',
      'ambiguous_submission:never_build_second_order',
      ...provenance,
    ],
  };
}
async function loadByClientOrderId(clientOrderId: string): Promise<IntentRow | null> {
  const result = await pool.query(`SELECT * FROM ${TABLE} WHERE client_order_id=$1`, [clientOrderId]);
  return parseRow(result.rows?.[0]);
}
async function loadByOrderId(orderId: string): Promise<IntentRow | null> {
  const result = await pool.query(`SELECT * FROM ${TABLE} WHERE order_id=$1`, [orderId]);
  return parseRow(result.rows?.[0]);
}
async function updateIntent(clientOrderId: string, patch: Record<string, unknown>): Promise<IntentRow | null> {
  const allowed = new Set(['order_id','signed_body','status','filled_contracts','average_fill_price','realized_fee_usd','last_api_status','last_error','submitted_at','terminal_at','provenance']);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return loadByClientOrderId(clientOrderId);
  const setters = entries.map(([key], index) => `${key}=$${index + 2}`).join(',');
  const result = await pool.query(`UPDATE ${TABLE} SET ${setters},updated_at=now() WHERE client_order_id=$1 RETURNING *`, [clientOrderId, ...entries.map(([, value]) => value)]);
  return parseRow(result.rows?.[0]);
}
async function createOrLoadIntent(input: PolymarketEventOrderIntent): Promise<IntentRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.clientOrderId]);
    const existing = await client.query(`SELECT * FROM ${TABLE} WHERE client_order_id=$1 FOR UPDATE`, [input.clientOrderId]);
    const prior = parseRow(existing.rows?.[0]);
    if (prior) {
      if (!immutableIntentMatches(prior, input)) throw new Error('POLYMARKET_CLIENT_ORDER_ID_INTENT_MISMATCH');
      await client.query('COMMIT');
      return prior;
    }
    const timestamp = String(Date.now());
    const inserted = await client.query(
      `INSERT INTO ${TABLE} (
         client_order_id,market_id,condition_id,token_id,outcome,side,contracts,limit_price,time_in_force,post_only,order_timestamp,status,provenance
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,'PREPARING',$12::jsonb)
       RETURNING *`,
      [
        input.clientOrderId, input.marketId, input.conditionId, input.tokenId, input.outcome, input.side, input.contracts,
        String(input.limitPrice), input.timeInForce, input.postOnly, timestamp,
        JSON.stringify(['polymarket_order_intent:created_before_signing', 'client_order_id:canonical_idempotency_key']),
      ],
    );
    await client.query('COMMIT');
    const row = parseRow(inserted.rows?.[0]);
    if (!row) throw new Error('POLYMARKET_ORDER_INTENT_INSERT_FAILED');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
async function ensureSignedIntent(row: IntentRow, input: PolymarketEventOrderIntent): Promise<IntentRow> {
  if (row.orderId && row.signedBody) return row;
  const signed = await buildPolymarketSignedOrder({
    clientOrderId: input.clientOrderId,
    tokenId: input.tokenId,
    conditionId: input.conditionId,
    side: input.side,
    contracts: input.contracts,
    limitPrice: input.limitPrice,
    timestamp: row.orderTimestamp,
    tickSize: input.tickSize,
    negRisk: input.negRisk,
    timeInForce: input.timeInForce,
    postOnly: input.postOnly,
  });
  const updated = await updateIntent(row.clientOrderId, {
    order_id: signed.orderId,
    signed_body: JSON.stringify(signed.body),
    status: 'PREPARED',
    last_error: null,
    provenance: JSON.stringify([
      ...signed.provenance,
      'signed_payload:persisted_before_submission',
      'order_hash:known_before_submission',
    ]),
  });
  if (!updated?.orderId || !updated.signedBody) throw new Error('POLYMARKET_SIGNED_ORDER_PERSIST_FAILED');
  return updated;
}
function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('POLYMARKET_HTTP_404');
}
function orderFillContribution(orderId: string, trade: any): { size: number; price: number; feeUsd: number } | null {
  const price = finite(trade?.price);
  if (price === null || !(price >= 0) || !(price <= 1)) return null;
  if (String(trade?.taker_order_id || '').toLowerCase() === orderId.toLowerCase()) {
    const size = finite(trade?.size);
    const feeBps = finite(trade?.fee_rate_bps);
    if (size === null || !(size > 0) || feeBps === null || feeBps < 0) return null;
    return { size, price, feeUsd: size * price * (1 - price) * feeBps / 10_000 };
  }
  const maker = Array.isArray(trade?.maker_orders)
    ? trade.maker_orders.find((entry: any) => String(entry?.order_id || '').toLowerCase() === orderId.toLowerCase())
    : null;
  if (!maker) return null;
  const size = finite(maker?.matched_amount);
  const makerPrice = finite(maker?.price) ?? price;
  const feeBps = finite(maker?.fee_rate_bps);
  if (size === null || !(size > 0) || feeBps === null || feeBps < 0) return null;
  return { size, price: makerPrice, feeUsd: size * makerPrice * (1 - makerPrice) * feeBps / 10_000 };
}
async function reconcileIntent(row: IntentRow): Promise<IntentRow> {
  if (!row.orderId) return row;
  let remote: any = null;
  try { remote = await getPolymarketOrder(row.orderId); } catch (error) { if (!isNotFound(error)) throw error; }
  const trades = await getPolymarketTrades({ market: row.conditionId, assetId: row.tokenId }).catch(() => []);
  const fills = trades.map(trade => orderFillContribution(row.orderId!, trade)).filter((value): value is NonNullable<typeof value> => value !== null);
  const filledContracts = fills.reduce((sum, fill) => sum + fill.size, 0);
  const weighted = fills.reduce((sum, fill) => sum + fill.size * fill.price, 0);
  const averageFillPrice = filledContracts > 0 ? weighted / filledContracts : row.averageFillPrice;
  const realizedFeeUsd = fills.length ? fills.reduce((sum, fill) => sum + fill.feeUsd, 0) : row.realizedFeeUsd;
  const remoteStatus = String(remote?.status || '').trim().toLowerCase();
  const remoteMatched = finite(remote?.size_matched) ?? 0;
  const effectiveFilled = Math.max(filledContracts, remoteMatched, row.filledContracts);
  let status: IntentStatus = row.status;
  if (effectiveFilled + 1e-9 >= row.contracts) status = 'FILLED';
  else if (/cancel/.test(remoteStatus)) status = 'CANCELLED';
  else if (/reject|fail/.test(remoteStatus)) status = 'REJECTED';
  else if (remote && effectiveFilled > 0) status = 'PARTIALLY_FILLED';
  else if (remote) status = 'OPEN';
  else if (row.status === 'FILLED' || row.status === 'CANCELLED' || row.status === 'REJECTED') status = row.status;
  else if (row.status === 'PREPARED') status = 'PREPARED';
  else status = 'SUBMISSION_UNKNOWN';
  const terminal = terminalStatus(status);
  return (await updateIntent(row.clientOrderId, {
    status,
    filled_contracts: String(effectiveFilled),
    average_fill_price: averageFillPrice === null ? null : String(averageFillPrice),
    realized_fee_usd: realizedFeeUsd === null ? null : String(Math.max(0, realizedFeeUsd)),
    last_api_status: remoteStatus || null,
    last_error: null,
    terminal_at: terminal ? new Date() : null,
  })) ?? row;
}

export async function placeOrRecoverPolymarketEventOrder(input: PolymarketEventOrderIntent): Promise<EventVenueOrderState> {
  let row = await createOrLoadIntent(input);
  row = await ensureSignedIntent(row, input);
  row = await reconcileIntent(row).catch(() => row);
  if (terminalStatus(row.status) || row.status === 'OPEN' || row.status === 'PARTIALLY_FILLED') {
    return toState(row, ['remote_reconciliation:completed_before_submission']);
  }
  if (!row.signedBody || !row.orderId) throw new Error('POLYMARKET_SIGNED_ORDER_INTENT_INCOMPLETE');

  // Mark ambiguous before the network call. Any retry reuses this exact signed
  // payload/order hash, so a lost response can never create a second exposure.
  row = (await updateIntent(row.clientOrderId, {
    status: 'SUBMISSION_UNKNOWN',
    submitted_at: new Date(),
    last_error: null,
  })) ?? row;
  try {
    const response = await postPolymarketSignedOrder(row.signedBody);
    const apiStatus = String(response?.status || '').trim().toLowerCase();
    if (response?.success === false) {
      const rejected = (await updateIntent(row.clientOrderId, {
        status: 'REJECTED',
        last_api_status: apiStatus || 'rejected',
        last_error: String(response?.errorMsg || 'POLYMARKET_ORDER_REJECTED'),
        terminal_at: new Date(),
      })) ?? row;
      return toState(rejected, ['submission:explicit_rejection']);
    }
    row = (await updateIntent(row.clientOrderId, {
      status: apiStatus === 'live' ? 'OPEN' : 'SUBMISSION_UNKNOWN',
      last_api_status: apiStatus || null,
      last_error: null,
    })) ?? row;
  } catch (error) {
    row = (await updateIntent(row.clientOrderId, {
      status: 'SUBMISSION_UNKNOWN',
      last_error: error instanceof Error ? error.message : String(error),
    })) ?? row;
    logger.warn('[PolymarketEventOrder] Submission outcome ambiguous; exact order hash retained for recovery', {
      component: 'PolymarketEventOrderAuthority', clientOrderId: row.clientOrderId, orderId: row.orderId,
      duplicateOrderConstructionAllowed: false, exactSignedPayloadRetryOnly: true,
    });
  }
  row = await reconcileIntent(row).catch(() => row);
  return toState(row, ['submission:exact_signed_payload', 'post_submit_reconciliation:attempted']);
}

export async function getPolymarketEventOrderState(orderId: string): Promise<EventVenueOrderState | null> {
  const row = await loadByOrderId(orderId);
  if (!row) return null;
  const reconciled = await reconcileIntent(row).catch(() => row);
  return toState(reconciled, ['recovery_lookup:durable_order_id']);
}

export async function cancelPolymarketEventOrderState(orderId: string): Promise<EventVenueOrderState | null> {
  const row = await loadByOrderId(orderId);
  if (!row) return null;
  if (terminalStatus(row.status)) return toState(row, ['cancel:already_terminal']);
  try {
    await cancelPolymarketOrder(orderId);
  } catch (error) {
    if (!isNotFound(error)) {
      await updateIntent(row.clientOrderId, { status: 'RECOVERY_REQUIRED', last_error: error instanceof Error ? error.message : String(error) });
    }
  }
  const reconciled = await reconcileIntent(row).catch(() => row);
  return toState(reconciled, ['cancel:authenticated', 'cancel_reconciliation:attempted']);
}

export async function recoverPolymarketEventOrders(limit = 32): Promise<EventVenueOrderState[]> {
  const capped = Math.max(1, Math.min(128, Math.trunc(limit)));
  const result = await pool.query(
    `SELECT * FROM ${TABLE}
     WHERE status IN ('PREPARING','PREPARED','SUBMISSION_UNKNOWN','OPEN','PARTIALLY_FILLED','RECOVERY_REQUIRED')
     ORDER BY updated_at ASC LIMIT $1`,
    [capped],
  );
  const output: EventVenueOrderState[] = [];
  for (const raw of result.rows) {
    const row = parseRow(raw);
    if (!row) continue;
    const reconciled = await reconcileIntent(row).catch(() => row);
    output.push(toState(reconciled, ['restart_recovery:durable_scan']));
  }
  return output;
}
