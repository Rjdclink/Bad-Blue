import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import type { ProfitLadderNotionalAuthoritySnapshot } from '../governance/profit-ladder-notional-authority.js';
import { cexOrderBookStreams, type CexStreamVenue, type StreamOrderBookLevel } from '../intelligence/cex-order-book-stream.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { assertCryptocrawlRuntimeDatabaseAvailable, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexInventoryLedger } from './cex-inventory-ledger.js';
import { getExactCoinbaseOrderAssetDeltas } from './coinbase-system-capital-settlement-evidence.js';
import { getExactSystemCapitalOrderAssetDeltas } from './cex-system-capital-settlement-evidence.js';
import {
  applyExactCexSystemOwnedSettlement,
  getExactSystemOwnedCexInventory,
  type CexSystemCapitalSettlementAuthority,
  type SystemOwnedCexVenue,
} from './cex-system-owned-lot-ledger.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
} from './cex-settlement.js';

type TransformStatus = 'READY' | 'PENDING' | 'SEED_REQUIRED' | 'MANUAL_REVIEW';

type AcquisitionCandidate = {
  venue: ExecutableCexVenue;
  symbol: string;
  baseAsset: string;
  quoteAsset: 'USDC' | 'USDT';
  requestedBase: number;
  quoteCeiling: number;
  limitPrice: number;
  quoteObservedAt: number;
  feeObservedAt: number;
  takerFeeBps: number;
  ownedQuote: number;
};

type TransformRow = {
  transform_id: string;
  demand_id: string;
  opportunity_id: string;
  venue: ExecutableCexVenue;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  required_total_base_decimal: string;
  requested_base_decimal: string;
  limit_price_decimal: string;
  reserved_quote_decimal: string;
  inventory_reservation_id: string;
  order_id: string | null;
  status: string;
  authority_evidence: CexSystemCapitalSettlementAuthority;
  submitted_at: Date | string | null;
};

export interface SystemOwnedInventoryTransformResult {
  status: TransformStatus;
  detail: string;
  seedAsset?: 'USDC' | 'USDT';
  seedAmountDecimal?: number;
  transformId?: string;
  orderId?: string;
}

const TRANSFORM_TABLE = 'public.cryptocrawler_cex_inventory_transforms';
const RESERVATION_TABLE = 'public.cryptocrawler_cex_inventory_reservations_v1';
const STABLE_QUOTES = ['USDC', 'USDT'] as const;

function freshQuoteAgeMs(): number {
  const configured = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(250, Math.min(2_000, Math.trunc(configured))) : 2_000;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function exactEnough(actual: string, required: number): boolean {
  const parsed = Number(actual);
  return Number.isFinite(parsed) && parsed + 1e-12 >= required;
}

function consumeAsks(levels: readonly StreamOrderBookLevel[], requestedBase: number): { quote: number; limitPrice: number } | null {
  let remaining = requestedBase;
  let quote = 0;
  let limitPrice = 0;
  for (const level of levels) {
    if (!(level.price > 0) || !(level.quantity > 0)) continue;
    const quantity = Math.min(remaining, level.quantity);
    if (!(quantity > 0)) continue;
    quote += quantity * level.price;
    remaining -= quantity;
    limitPrice = level.price;
    if (remaining <= Math.max(1e-12, requestedBase * 1e-10)) break;
  }
  if (remaining > Math.max(1e-12, requestedBase * 1e-10) || !(quote > 0) || !(limitPrice > 0)) return null;
  return { quote, limitPrice };
}

function executionEnabled(): boolean {
  return process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function settlementAuthority(
  opportunityId: string,
  notional: ProfitLadderNotionalAuthoritySnapshot,
): CexSystemCapitalSettlementAuthority {
  if (!notional.aligned || !(notional.maxNotionalUsd > 0)) {
    throw new Error(`CEX inventory transformation requires aligned Profit Ladder authority; rung=${notional.rungKey}`);
  }
  return {
    strategySelectionAuthority: 'cryptara',
    notionalAuthority: 'profit_ladder',
    executionAuthority: 'stage_manager',
    governanceAdmitted: true,
    reference: `cex-inventory-transform:${opportunityId}:${notional.rungKey}:${notional.evaluatedAt}`,
    profitLadderRung: notional.rungKey,
    profitLadderMaxNotionalUsd: notional.maxNotionalUsd,
    stage: notional.stage,
    tierId: notional.tierId,
    purpose: 'self_funded_cex_base_inventory_transform',
  };
}

async function existingActiveTransform(demandId: string): Promise<TransformRow | null> {
  const result = await pool.query(
    `SELECT transform_id::text,demand_id::text,opportunity_id,venue,symbol,base_asset,quote_asset,
            required_total_base_decimal::text,requested_base_decimal::text,limit_price_decimal::text,
            reserved_quote_decimal::text,inventory_reservation_id,order_id,status,authority_evidence,submitted_at
     FROM ${TRANSFORM_TABLE}
     WHERE demand_id=$1::uuid AND status IN ('PREPARED','SUBMITTED','SETTLING','MANUAL_REVIEW')
     ORDER BY created_at ASC LIMIT 1`,
    [demandId],
  );
  return result.rows[0] ? result.rows[0] as TransformRow : null;
}

async function selectAcquisitionCandidate(input: {
  venue: ExecutableCexVenue;
  baseAsset: string;
  requestedBase: number;
}): Promise<AcquisitionCandidate | null> {
  const candidates: AcquisitionCandidate[] = [];
  for (const quoteAsset of STABLE_QUOTES) {
    const symbol = `${input.baseAsset}${quoteAsset}`;
    const quote = await cexOrderBookStreams.getQuote(input.venue as CexStreamVenue, symbol, freshQuoteAgeMs()).catch(() => null);
    if (!quote) continue;
    const depth = consumeAsks(quote.depth.asks, input.requestedBase);
    if (!depth) continue;
    const fee = await resolveCexFeeEvidence(input.venue, symbol, { maxAgeMs: 300_000 }).catch(() => null);
    if (!fee || fee.source === 'configured_override' || !(fee.takerFeeBps >= 0)) continue;
    const feeMultiplier = 1 + fee.takerFeeBps / 10_000;
    const quoteCeiling = depth.quote * feeMultiplier + Math.max(1e-10, depth.quote * 1e-10);
    const ownedQuote = Number(await getExactSystemOwnedCexInventory(input.venue as SystemOwnedCexVenue, quoteAsset));
    if (!Number.isFinite(ownedQuote) || ownedQuote < 0) continue;
    candidates.push({
      venue: input.venue,
      symbol,
      baseAsset: input.baseAsset,
      quoteAsset,
      requestedBase: input.requestedBase,
      quoteCeiling,
      limitPrice: depth.limitPrice,
      quoteObservedAt: quote.timestamp,
      feeObservedAt: fee.observedAt,
      takerFeeBps: fee.takerFeeBps,
      ownedQuote,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => {
    const leftReady = left.ownedQuote + 1e-12 >= left.quoteCeiling ? 0 : 1;
    const rightReady = right.ownedQuote + 1e-12 >= right.quoteCeiling ? 0 : 1;
    if (leftReady !== rightReady) return leftReady - rightReady;
    const leftShort = Math.max(0, left.quoteCeiling - left.ownedQuote);
    const rightShort = Math.max(0, right.quoteCeiling - right.ownedQuote);
    return leftShort - rightShort || left.quoteCeiling - right.quoteCeiling;
  });
  return candidates[0];
}

function adapterFor(venue: ExecutableCexVenue): CexSettlementAdapter {
  const adapter = createProductionCexSettlementAdapters()[venue];
  if (!adapter) throw new Error(`No production CEX settlement adapter for ${venue}`);
  return adapter;
}

async function reconcilePhysicalInventory(venue: ExecutableCexVenue, adapter: CexSettlementAdapter): Promise<void> {
  if (!adapter.getBalances) throw new Error(`${venue} does not expose authenticated balance reconciliation`);
  const balances = await adapter.getBalances();
  await cexInventoryLedger.reconcile(venue, balances);
}

async function holdReservationIndefinitely(reservationId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE ${RESERVATION_TABLE} SET expires_at='infinity'::timestamptz WHERE reservation_id=$1 RETURNING reservation_id`,
    [reservationId],
  );
  if (result.rowCount < 1) throw new Error(`CEX transform reservation ${reservationId} disappeared before submission`);
}

async function releaseDurableReservation(reservationId: string): Promise<void> {
  await pool.query(`DELETE FROM ${RESERVATION_TABLE} WHERE reservation_id=$1`, [reservationId]);
}

async function loadTransform(transformId: string): Promise<TransformRow> {
  const result = await pool.query(
    `SELECT transform_id::text,demand_id::text,opportunity_id,venue,symbol,base_asset,quote_asset,
            required_total_base_decimal::text,requested_base_decimal::text,limit_price_decimal::text,
            reserved_quote_decimal::text,inventory_reservation_id,order_id,status,authority_evidence,submitted_at
     FROM ${TRANSFORM_TABLE} WHERE transform_id=$1::uuid`,
    [transformId],
  );
  if (!result.rows[0]) throw new Error(`CEX inventory transform ${transformId} does not exist`);
  return result.rows[0] as TransformRow;
}

async function markDemandFromOwnedBase(row: TransformRow): Promise<SystemOwnedInventoryTransformResult> {
  const owned = await getExactSystemOwnedCexInventory(row.venue as SystemOwnedCexVenue, row.base_asset);
  const required = Number(row.required_total_base_decimal);
  const ready = exactEnough(owned, required);
  await pool.query(
    `UPDATE public.cryptocrawler_cex_bootstrap_demands
     SET status=$2,last_error=$3,updated_at=now() WHERE demand_id=$1::uuid`,
    [
      row.demand_id,
      ready ? 'READY' : 'PENDING',
      ready ? null : `Terminal transform applied but system-owned ${row.base_asset}=${owned} remains below required=${row.required_total_base_decimal}`,
    ],
  );
  return {
    status: ready ? 'READY' : 'PENDING',
    detail: ready
      ? `Terminal ${row.venue} fill created sufficient exact system-owned ${row.base_asset} inventory`
      : `Terminal fill applied exactly; additional ${row.base_asset} acquisition remains required`,
    transformId: row.transform_id,
    orderId: row.order_id || undefined,
  };
}

async function applyTerminalTransform(row: TransformRow, order: CexOrderReceipt): Promise<SystemOwnedInventoryTransformResult> {
  const adapter = adapterFor(row.venue);
  const settlement = await adapter.query(order);
  if (!settlement.terminal) {
    await pool.query(`UPDATE ${TRANSFORM_TABLE} SET status='SETTLING',updated_at=now() WHERE transform_id=$1::uuid`, [row.transform_id]);
    return { status: 'PENDING', detail: `${row.venue} inventory acquisition remains non-terminal`, transformId: row.transform_id, orderId: order.orderId };
  }

  if (!finitePositive(settlement.filledQuantity)) {
    await releaseDurableReservation(row.inventory_reservation_id);
    await pool.query(
      `UPDATE ${TRANSFORM_TABLE}
       SET status='NO_FILL',terminal_at=now(),settlement_evidence=$2::jsonb,updated_at=now()
       WHERE transform_id=$1::uuid`,
      [row.transform_id, JSON.stringify({ terminalStatus: settlement.status, filledQuantity: settlement.filledQuantity ?? 0 })],
    );
    await pool.query(
      `UPDATE public.cryptocrawler_cex_bootstrap_demands
       SET status='PENDING',last_error=$2,updated_at=now() WHERE demand_id=$1::uuid`,
      [row.demand_id, `${row.venue} inventory acquisition reached ${settlement.status} with no fill`],
    );
    return { status: 'PENDING', detail: `${row.venue} acquisition reached terminal no-fill and released its quote reservation`, transformId: row.transform_id, orderId: order.orderId };
  }

  try {
    const evidence = row.venue === 'coinbase'
      ? await getExactCoinbaseOrderAssetDeltas(settlement)
      : await getExactSystemCapitalOrderAssetDeltas(settlement);
    await applyExactCexSystemOwnedSettlement({
      evidence,
      opportunityId: row.opportunity_id,
      strategy: 'self_funded_cex_inventory_transform',
      authority: row.authority_evidence,
    });
    await releaseDurableReservation(row.inventory_reservation_id);
    if (settlement.finalBalances) {
      await cexInventoryLedger.reconcile(row.venue, settlement.finalBalances).catch(() => undefined);
    } else {
      await reconcilePhysicalInventory(row.venue, adapter).catch(() => undefined);
    }
    await pool.query(
      `UPDATE ${TRANSFORM_TABLE}
       SET status='APPLIED',settlement_reference=$2,settlement_evidence=$3::jsonb,terminal_at=now(),last_error=NULL,updated_at=now()
       WHERE transform_id=$1::uuid`,
      [row.transform_id, evidence.settlementReference, JSON.stringify({
        orderId: evidence.orderId,
        assetDeltas: evidence.assetDeltas,
        provenance: evidence.provenance,
        terminalState: evidence.terminalState,
      })],
    );
    return markDemandFromOwnedBase({ ...row, status: 'APPLIED' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE ${TRANSFORM_TABLE}
       SET status='MANUAL_REVIEW',last_error=$2,updated_at=now() WHERE transform_id=$1::uuid`,
      [row.transform_id, message.slice(0, 1500)],
    );
    await pool.query(
      `UPDATE public.cryptocrawler_cex_bootstrap_demands
       SET status='MANUAL_REVIEW',last_error=$2,updated_at=now() WHERE demand_id=$1::uuid`,
      [row.demand_id, `Terminal transform ownership reconciliation failed closed: ${message}`.slice(0, 1500)],
    );
    return {
      status: 'MANUAL_REVIEW',
      detail: `Terminal order exists but exact ownership reconciliation is unresolved; quote capital remains locked`,
      transformId: row.transform_id,
      orderId: order.orderId,
    };
  }
}

async function reconcileTransform(row: TransformRow): Promise<SystemOwnedInventoryTransformResult> {
  if (!row.order_id) {
    return {
      status: 'MANUAL_REVIEW',
      detail: 'Inventory transform has an indefinite reservation but no confirmed exchange order id; capital remains fail-closed',
      transformId: row.transform_id,
    };
  }
  const order: CexOrderReceipt = {
    venue: row.venue,
    orderId: row.order_id,
    symbol: row.symbol,
    side: 'buy',
    requestedQuantity: Number(row.requested_base_decimal),
    submittedAt: row.submitted_at ? new Date(row.submitted_at).getTime() : Date.now(),
  };
  const adapter = adapterFor(row.venue);
  let result = await applyTerminalTransform(row, order);
  if (result.status !== 'PENDING') return result;

  const submittedAt = order.submittedAt;
  if (Date.now() - submittedAt >= 5_000) {
    await adapter.cancel(order).catch(() => undefined);
    result = await applyTerminalTransform(await loadTransform(row.transform_id), order).catch(error => ({
      status: 'PENDING' as const,
      detail: error instanceof Error ? error.message : String(error),
      transformId: row.transform_id,
      orderId: row.order_id || undefined,
    }));
  }
  return result;
}

export async function ensureSystemOwnedBaseInventory(input: {
  demandId: string;
  opportunityId: string;
  plan: VerifiedArbitragePlan;
  venue: ExecutableCexVenue;
  baseAsset: string;
  requiredBaseQty: number;
  notionalAuthority: ProfitLadderNotionalAuthoritySnapshot;
}): Promise<SystemOwnedInventoryTransformResult> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  if (!executionEnabled()) return { status: 'PENDING', detail: 'Live CEX execution posture is not enabled for inventory transformation' };
  getCryptocrawlGovernance().requireAllowed('EXECUTE_OPPORTUNITY', { pair: input.plan.symbol });
  if (!(input.requiredBaseQty > 0) || !Number.isFinite(input.requiredBaseQty)) {
    throw new Error('System-owned base inventory requirement must be finite and positive');
  }

  const currentOwned = await getExactSystemOwnedCexInventory(input.venue as SystemOwnedCexVenue, input.baseAsset);
  if (exactEnough(currentOwned, input.requiredBaseQty)) {
    await pool.query(
      `UPDATE public.cryptocrawler_cex_bootstrap_demands SET status='READY',last_error=NULL,updated_at=now() WHERE demand_id=$1::uuid`,
      [input.demandId],
    );
    return { status: 'READY', detail: `Exact system-owned ${input.baseAsset} inventory is already sufficient on ${input.venue}` };
  }

  const active = await existingActiveTransform(input.demandId);
  if (active) return reconcileTransform(active);

  const ownedNumber = Math.max(0, Number(currentOwned) || 0);
  const missingBase = input.requiredBaseQty - ownedNumber;
  const candidate = await selectAcquisitionCandidate({ venue: input.venue, baseAsset: input.baseAsset, requestedBase: missingBase });
  if (!candidate) {
    return { status: 'PENDING', detail: `No fresh authenticated ${input.venue} ${input.baseAsset}/USDC-or-USDT acquisition route with measured fee/depth evidence is currently available` };
  }

  if (candidate.ownedQuote + 1e-12 < candidate.quoteCeiling) {
    return {
      status: 'SEED_REQUIRED',
      detail: `${input.venue} requires additional system-owned ${candidate.quoteAsset} before ${candidate.baseAsset} can be acquired`,
      seedAsset: candidate.quoteAsset,
      seedAmountDecimal: Math.max(0, candidate.quoteCeiling - candidate.ownedQuote),
    };
  }

  if (candidate.quoteCeiling > input.notionalAuthority.maxNotionalUsd + 1e-9) {
    return {
      status: 'PENDING',
      detail: `Required inventory transform notional ${candidate.quoteCeiling.toFixed(8)} exceeds current Profit Ladder authority ${input.notionalAuthority.maxNotionalUsd.toFixed(8)}`,
    };
  }

  const adapter = adapterFor(candidate.venue);
  await reconcilePhysicalInventory(candidate.venue, adapter);
  const reservation = await cexInventoryLedger.reserve(
    `cex-transform:${input.opportunityId}:${input.demandId}`,
    [{ venue: candidate.venue, asset: candidate.quoteAsset, amount: candidate.quoteCeiling }],
  );
  if (!reservation) return { status: 'PENDING', detail: `Canonical ${candidate.venue} ${candidate.quoteAsset} inventory reservation is unavailable` };

  const authority = settlementAuthority(input.opportunityId, input.notionalAuthority);
  const inserted = await pool.query(
    `INSERT INTO ${TRANSFORM_TABLE} (
       idempotency_key,demand_id,opportunity_id,venue,symbol,base_asset,quote_asset,
       required_total_base_decimal,requested_base_decimal,limit_price_decimal,reserved_quote_decimal,
       inventory_reservation_id,status,authority_evidence
     ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12,'PREPARED',$13::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING transform_id::text`,
    [
      `cex-transform:${input.demandId}:${candidate.symbol}:${candidate.quoteObservedAt}:${candidate.requestedBase}`,
      input.demandId,
      input.opportunityId,
      candidate.venue,
      candidate.symbol,
      candidate.baseAsset,
      candidate.quoteAsset,
      input.requiredBaseQty.toString(),
      candidate.requestedBase.toString(),
      candidate.limitPrice.toString(),
      candidate.quoteCeiling.toString(),
      reservation.reservationId,
      JSON.stringify({
        ...authority,
        quoteObservedAt: candidate.quoteObservedAt,
        feeObservedAt: candidate.feeObservedAt,
        takerFeeBps: candidate.takerFeeBps,
        quoteCeiling: candidate.quoteCeiling,
        inventoryReservationId: reservation.reservationId,
        staleQuoteExecutionAllowed: false,
      }),
    ],
  );
  if (inserted.rowCount !== 1) {
    await reservation.release();
    const activeAfterRace = await existingActiveTransform(input.demandId);
    return activeAfterRace
      ? reconcileTransform(activeAfterRace)
      : { status: 'PENDING', detail: 'Inventory transform idempotency race deferred safely' };
  }

  const transformId = String(inserted.rows[0].transform_id);
  await holdReservationIndefinitely(reservation.reservationId);
  let receipt: CexOrderReceipt;
  try {
    receipt = await adapter.submit({
      symbol: candidate.symbol,
      side: 'buy',
      quantity: candidate.requestedBase,
      price: candidate.limitPrice,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE ${TRANSFORM_TABLE} SET status='MANUAL_REVIEW',last_error=$2,updated_at=now() WHERE transform_id=$1::uuid`,
      [transformId, `Submission outcome unresolved: ${message}`.slice(0, 1500)],
    );
    await pool.query(
      `UPDATE public.cryptocrawler_cex_bootstrap_demands SET status='MANUAL_REVIEW',last_error=$2,updated_at=now() WHERE demand_id=$1::uuid`,
      [input.demandId, `Inventory transform submission outcome unresolved; canonical quote reservation remains locked: ${message}`.slice(0, 1500)],
    );
    return {
      status: 'MANUAL_REVIEW',
      detail: 'Inventory transform submission outcome is uncertain; system-owned quote capital remains indefinitely reserved',
      transformId,
    };
  }

  await pool.query(
    `UPDATE ${TRANSFORM_TABLE}
     SET status='SUBMITTED',order_id=$2,submitted_at=now(),updated_at=now()
     WHERE transform_id=$1::uuid AND status='PREPARED'`,
    [transformId, receipt.orderId],
  );
  return reconcileTransform(await loadTransform(transformId));
}

export async function reconcilePendingSystemOwnedInventoryTransforms(limit = 20): Promise<void> {
  assertCryptocrawlRuntimeDatabaseAvailable();
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await pool.query(
    `SELECT transform_id::text,demand_id::text,opportunity_id,venue,symbol,base_asset,quote_asset,
            required_total_base_decimal::text,requested_base_decimal::text,limit_price_decimal::text,
            reserved_quote_decimal::text,inventory_reservation_id,order_id,status,authority_evidence,submitted_at
     FROM ${TRANSFORM_TABLE}
     WHERE status IN ('SUBMITTED','SETTLING','MANUAL_REVIEW') AND order_id IS NOT NULL
     ORDER BY updated_at ASC LIMIT $1`,
    [bounded],
  );
  for (const row of result.rows as TransformRow[]) {
    await reconcileTransform(row).catch(async error => {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `UPDATE ${TRANSFORM_TABLE} SET status='MANUAL_REVIEW',last_error=$2,updated_at=now() WHERE transform_id=$1::uuid`,
        [row.transform_id, message.slice(0, 1500)],
      ).catch(() => undefined);
      logger.error('[CexInventoryTransform] Background terminal reconciliation failed closed', {
        component: 'CexSystemOwnedInventoryTransform',
        transformId: row.transform_id,
        venue: row.venue,
        orderId: row.order_id,
        error: message,
        reservationReleased: false,
        syntheticOwnershipCreated: false,
      });
    });
  }
}