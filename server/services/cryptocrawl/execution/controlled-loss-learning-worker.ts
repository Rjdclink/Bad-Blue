import { createHash, randomInt, randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { cexOrderBookStreams, type StreamOrderBookLevel } from '../intelligence/cex-order-book-stream.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexInventoryLedger } from './cex-inventory-ledger.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
} from './cex-settlement.js';
import { getSpotProductConstraints, type SpotProductConstraints } from './cex-spot-product-policy.js';
import { getExactSystemCapitalOrderAssetDeltas, type ExactCexOrderAssetDeltaEvidence } from './cex-system-capital-settlement-evidence.js';
import { applyExactCexSystemOwnedSettlement, getExactSystemOwnedCexInventory } from './cex-system-owned-lot-ledger.js';
import { addExactDecimals } from './exact-decimal.js';
import type { NormalizedOrderSettlement, NormalizedRealizedExecution } from './settlement-types.js';

const STRATEGY_TIMEZONE = 'America/Chicago';
const MAX_LOSS_FRACTION = 0.05;
// The live spot principal is deliberately much smaller than the permitted loss.
// This leaves substantial room for the spread, both taker fees, and an extreme
// adverse move without using leverage or widening the operator's 5% ceiling.
const PRINCIPAL_FRACTION_OF_MAX_LOSS = 0.20;
const MAX_SOURCE_RESERVE_FRACTION_OF_MAX_LOSS = 0.35;
const MIN_RANDOM_DELAY_MS = 15_000;
const DAY_END_GUARD_MS = 30_000;
const WORKER_INTERVAL_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_CONTROLLED_LOSS_INTERVAL_MS || 10_000)));
const RETRY_MS = Math.max(10_000, Math.min(10 * 60_000, Number(process.env.CRYPTOCRAWL_CONTROLLED_LOSS_RETRY_MS || 30_000)));
const ORDER_TIMEOUT_MS = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_CONTROLLED_LOSS_ORDER_TIMEOUT_MS || 30_000)));
const ORDER_POLL_MS = Math.max(250, Math.min(5_000, Number(process.env.CRYPTOCRAWL_CONTROLLED_LOSS_ORDER_POLL_MS || 1_000)));
const BOOK_MAX_AGE_MS = Math.max(500, Math.min(5_000, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)));
const FEE_MAX_AGE_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_CONTROLLED_LOSS_FEE_MAX_AGE_MS || 30_000)));
const CANDIDATE_SYMBOLS = ['ETHUSDT', 'ETHUSDC'] as const;

type Venue = 'kraken' | 'okx';
type CandidateSymbol = typeof CANDIDATE_SYMBOLS[number];

type ControlledLossEvent = {
  event_id: string;
  local_date: string;
  unlock_profit_event_id: string;
  unlocked_at: string;
  scheduled_not_before: string;
  status: string;
  gross_profit_usd_at_claim: string | number | null;
  max_loss_usd: string | number | null;
  expected_loss_usd: string | number | null;
  venue: Venue | null;
  symbol: CandidateSymbol | null;
  base_asset: string | null;
  quote_asset: string | null;
  quote_asset_usd: string | number | null;
  authenticated_taker_fee_bps: string | number | null;
  source_quote_reserve: string | number | null;
  requested_base_quantity: string | number | null;
  entry_limit_price: string | number | null;
  entry_client_order_id: string | null;
  entry_order_id: string | null;
  entry_inventory_reservation_id: string | null;
  entry_applied: boolean;
  exit_base_quantity: string | number | null;
  exit_limit_price: string | number | null;
  exit_client_order_id: string | null;
  exit_order_id: string | null;
  exit_inventory_reservation_id: string | null;
  exit_applied: boolean;
  realized_profit_usd: string | number | null;
  settlement_evidence: Record<string, unknown> | null;
  attempt_count: number;
  retry_not_before: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
};

type PreparedCandidate = {
  venue: Venue;
  symbol: CandidateSymbol;
  constraints: SpotProductConstraints;
  quoteUsd: number;
  feeBps: number;
  baseQuantity: number;
  entryLimitPrice: number;
  indicativeExitPrice: number;
  sourceQuoteReserve: number;
  expectedLossUsd: number;
};

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function liveExecutionPosture(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function localDateKey(epochMs = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STRATEGY_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextLocalDateBoundary(epochMs: number): number {
  const current = localDateKey(epochMs);
  let low = epochMs;
  let high = epochMs + 36 * 60 * 60_000;
  while (high - low > 1_000) {
    const midpoint = Math.floor((low + high) / 2);
    if (localDateKey(midpoint) === current) low = midpoint;
    else high = midpoint;
  }
  return high;
}

function randomizedPostWinTime(unlockedAt: number): number {
  const earliest = unlockedAt + MIN_RANDOM_DELAY_MS;
  const latest = nextLocalDateBoundary(unlockedAt) - DAY_END_GUARD_MS;
  if (latest <= earliest) return earliest;
  return randomInt(earliest, latest + 1);
}

function deterministicId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

function numericString(value: number, decimals = 16): string {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('controlled-loss order requires a finite positive decimal');
  return value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

function floorIncrement(value: number, increment: number): number {
  if (!(value > 0) || !(increment > 0)) return 0;
  return Number((Math.floor((value + increment * 1e-9) / increment) * increment).toPrecision(15));
}

function depthWorstPrice(levels: readonly StreamOrderBookLevel[], quantity: number): number | null {
  let accumulated = 0;
  for (const level of levels) {
    if (!(level.quantity > 0) || !(level.price > 0)) continue;
    accumulated += level.quantity;
    if (accumulated + 1e-12 >= quantity) return level.price;
  }
  return null;
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = randomInt(0, index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

async function usdPrice(assetInput: string): Promise<number> {
  const asset = assetInput.trim().toUpperCase();
  if (asset === 'USD') return 1;
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([asset]);
  const price = prices.get(asset);
  if (!price || !Number.isFinite(price) || price <= 0) throw new Error(`live USD price unavailable for controlled-loss asset ${asset}`);
  return price;
}

async function scheduleTodayAfterFirstWin(): Promise<void> {
  const today = localDateKey();
  const result = await pool.query(
    `SELECT d.local_date::text, d.is_trade_day, d.realized_profit_usd::text,
            p.event_id, p.created_at
     FROM public.cryptocrawler_operator_strategy_days d
     JOIN LATERAL (
       SELECT event_id, created_at
       FROM public.cryptocrawler_operator_profit_events
       WHERE local_date=d.local_date
       ORDER BY created_at ASC, event_id ASC
       LIMIT 1
     ) p ON true
     WHERE d.local_date=$1::date AND d.is_trade_day=true AND d.realized_profit_usd > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.cryptocrawler_controlled_loss_learning_events e
         WHERE e.local_date=d.local_date
       )
     LIMIT 1`,
    [today],
  );
  const row = result.rows[0];
  if (!row) return;
  const unlockedAt = new Date(row.created_at).getTime();
  const scheduledAt = randomizedPostWinTime(unlockedAt);
  await pool.query(
    `INSERT INTO public.cryptocrawler_controlled_loss_learning_events
       (event_id, local_date, unlock_profit_event_id, unlocked_at, scheduled_not_before,
        status, created_at, updated_at)
     VALUES ($1::uuid,$2::date,$3,to_timestamp($4/1000.0),to_timestamp($5/1000.0),
             'SCHEDULED',now(),now())
     ON CONFLICT (local_date) DO NOTHING`,
    [randomUUID(), today, String(row.event_id), unlockedAt, scheduledAt],
  );
  logger.info('[ControlledLossLearning] First terminal win unlocked one randomized learning-loss event', {
    component: 'ControlledLossLearningWorker',
    localDate: today,
    unlockProfitEventId: String(row.event_id),
    unlockedAt,
    scheduledNotBefore: scheduledAt,
    randomPlacementAfterFirstWin: true,
    normalParentTradeQuotaConsumed: false,
    maxLossFraction: MAX_LOSS_FRACTION,
  });
}

async function loadActiveEvent(): Promise<ControlledLossEvent | null> {
  const result = await pool.query(
    `SELECT * FROM public.cryptocrawler_controlled_loss_learning_events
     WHERE local_date=(now() AT TIME ZONE 'America/Chicago')::date
       AND status IN ('SCHEDULED','PREPARED','ENTRY_SUBMITTED','ENTRY_TERMINAL','EXIT_SUBMITTED','RETRYABLE')
       AND scheduled_not_before <= now()
       AND (retry_not_before IS NULL OR retry_not_before <= now())
     ORDER BY created_at ASC
     LIMIT 1`,
  );
  return result.rows[0] as ControlledLossEvent | undefined || null;
}

async function normalParentTradeInFlight(localDate: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM public.cryptocrawler_operator_trade_reservations
       WHERE local_date=$1::date AND status='SUBMITTED'
     ) AS active`,
    [localDate],
  );
  return result.rows[0]?.active === true;
}

async function currentGrossProfit(localDate: string): Promise<number> {
  const result = await pool.query(
    `SELECT realized_profit_usd::text AS gross
     FROM public.cryptocrawler_operator_strategy_days
     WHERE local_date=$1::date AND is_trade_day=true`,
    [localDate],
  );
  const gross = Number(result.rows[0]?.gross || 0);
  return Number.isFinite(gross) && gross > 0 ? gross : 0;
}

async function buildCandidate(maxLossUsd: number): Promise<PreparedCandidate | null> {
  const pairs = shuffled((['kraken', 'okx'] as const).flatMap(venue =>
    shuffled(CANDIDATE_SYMBOLS).map(symbol => ({ venue, symbol })),
  ));

  for (const pair of pairs) {
    try {
      const [constraints, fee, book] = await Promise.all([
        getSpotProductConstraints(pair.venue, pair.symbol, true),
        resolveCexFeeEvidence(pair.venue, pair.symbol, { maxAgeMs: FEE_MAX_AGE_MS, forceRefresh: true }),
        cexOrderBookStreams.getQuote(pair.venue, pair.symbol, BOOK_MAX_AGE_MS),
      ]);
      if (!fee || fee.source === 'configured_override' || !(fee.takerFeeBps >= 0) || !Number.isFinite(fee.takerFeeBps)) continue;
      if (constraints.baseAsset !== 'ETH' || !['USDT', 'USDC'].includes(constraints.quoteAsset)) continue;
      const quoteUsd = await usdPrice(constraints.quoteAsset);
      const feeRate = fee.takerFeeBps / 10_000;
      // Refuse pathological account fee evidence rather than silently widening risk.
      if (!(feeRate >= 0) || feeRate > 0.02) continue;

      const principalUsd = maxLossUsd * PRINCIPAL_FRACTION_OF_MAX_LOSS;
      const principalQuote = principalUsd / quoteUsd;
      let baseQuantity = floorIncrement(principalQuote / book.ask, constraints.baseIncrement);
      if (baseQuantity < constraints.baseMinSize * 1.05) continue;
      if (constraints.baseMaxSize !== null) baseQuantity = Math.min(baseQuantity, floorIncrement(constraints.baseMaxSize, constraints.baseIncrement));
      if (!(baseQuantity > 0)) continue;

      const entryLimitPrice = depthWorstPrice(book.depth.asks, baseQuantity);
      const indicativeExitPrice = depthWorstPrice(book.depth.bids, baseQuantity);
      if (!(entryLimitPrice && indicativeExitPrice && entryLimitPrice > 0 && indicativeExitPrice > 0)) continue;

      const entryPrincipalQuote = baseQuantity * entryLimitPrice;
      if (constraints.quoteMinSize !== null && entryPrincipalQuote < constraints.quoteMinSize) continue;
      if (constraints.quoteMaxSize !== null && entryPrincipalQuote > constraints.quoteMaxSize) continue;
      const sourceQuoteReserve = entryPrincipalQuote * (1 + feeRate + 0.005);
      const sourceReserveUsd = sourceQuoteReserve * quoteUsd;
      if (sourceReserveUsd > maxLossUsd * MAX_SOURCE_RESERVE_FRACTION_OF_MAX_LOSS + 1e-9) continue;

      const expectedEntryCost = baseQuantity * entryLimitPrice * (1 + feeRate);
      const expectedExitProceeds = baseQuantity * indicativeExitPrice * Math.max(0, 1 - feeRate);
      const expectedLossUsd = Math.max(0, (expectedEntryCost - expectedExitProceeds) * quoteUsd);
      if (!(expectedLossUsd > 0) || expectedLossUsd >= maxLossUsd) continue;

      const systemOwned = Number(await getExactSystemOwnedCexInventory(pair.venue, constraints.quoteAsset));
      if (!Number.isFinite(systemOwned) || systemOwned + 1e-12 < sourceQuoteReserve) continue;

      const adapter = createProductionCexSettlementAdapters()[pair.venue];
      if (!adapter.getBalances) continue;
      const balances = await adapter.getBalances();
      await cexInventoryLedger.reconcile(pair.venue, balances);

      return {
        venue: pair.venue,
        symbol: pair.symbol,
        constraints,
        quoteUsd,
        feeBps: fee.takerFeeBps,
        baseQuantity,
        entryLimitPrice,
        indicativeExitPrice,
        sourceQuoteReserve,
        expectedLossUsd,
      };
    } catch (error) {
      logger.debug('[ControlledLossLearning] Candidate rejected while preserving the 5% loss ceiling', {
        component: 'ControlledLossLearningWorker',
        venue: pair.venue,
        symbol: pair.symbol,
        error: error instanceof Error ? error.message : String(error),
        failClosed: true,
      });
    }
  }
  return null;
}

async function prepareEvent(row: ControlledLossEvent): Promise<ControlledLossEvent | null> {
  const gross = await currentGrossProfit(row.local_date);
  if (!(gross > 0)) return null;
  const maxLossUsd = gross * MAX_LOSS_FRACTION;
  const candidate = await buildCandidate(maxLossUsd);
  if (!candidate) {
    await pool.query(
      `UPDATE public.cryptocrawler_controlled_loss_learning_events
       SET status='RETRYABLE', retry_not_before=now()+($2::text || ' milliseconds')::interval,
           attempt_count=attempt_count+1, last_attempt_at=now(),
           last_error='No unlevered provenance-backed FOK round-trip fits inside the current 5% loss budget',
           updated_at=now()
       WHERE event_id=$1::uuid`,
      [row.event_id, RETRY_MS],
    );
    return null;
  }

  const attempt = row.attempt_count + 1;
  const entryClientId = deterministicId(`controlled-loss:${row.event_id}:entry:${attempt}`);
  const exitClientId = deterministicId(`controlled-loss:${row.event_id}:exit:${attempt}`);
  const result = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='PREPARED', gross_profit_usd_at_claim=$2, max_loss_usd=$3,
         expected_loss_usd=$4, venue=$5, symbol=$6, base_asset=$7, quote_asset=$8,
         quote_asset_usd=$9, authenticated_taker_fee_bps=$10,
         source_quote_reserve=$11, requested_base_quantity=$12, entry_limit_price=$13,
         entry_client_order_id=$14, exit_client_order_id=$15,
         retry_not_before=NULL, attempt_count=$16, last_attempt_at=now(), last_error=NULL,
         updated_at=now()
     WHERE event_id=$1::uuid
     RETURNING *`,
    [
      row.event_id, gross, maxLossUsd, candidate.expectedLossUsd, candidate.venue, candidate.symbol,
      candidate.constraints.baseAsset, candidate.constraints.quoteAsset, candidate.quoteUsd,
      candidate.feeBps, candidate.sourceQuoteReserve, candidate.baseQuantity,
      candidate.entryLimitPrice, entryClientId, exitClientId, attempt,
    ],
  );
  return result.rows[0] as ControlledLossEvent | undefined || null;
}

async function existingReservation(opportunityId: string, venue: Venue, asset: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT reservation_id, SUM(amount)::text AS amount
     FROM public.cryptocrawler_cex_inventory_reservations_v1
     WHERE opportunity_id=$1 AND venue=$2 AND asset=$3 AND expires_at > now()
     GROUP BY reservation_id`,
    [opportunityId, venue, asset],
  );
  if (result.rowCount > 1) throw new Error(`multiple active inventory reservations exist for ${opportunityId}`);
  return result.rows[0]?.reservation_id ? String(result.rows[0].reservation_id) : null;
}

async function ensureReservation(input: {
  row: ControlledLossEvent;
  leg: 'entry' | 'exit';
  venue: Venue;
  asset: string;
  amount: number;
}): Promise<string> {
  const opportunityId = `controlled-loss:${input.row.event_id}:${input.leg}`;
  const adopted = await existingReservation(opportunityId, input.venue, input.asset);
  if (adopted) return adopted;

  const adapter = createProductionCexSettlementAdapters()[input.venue];
  if (!adapter.getBalances) throw new Error(`${input.venue} does not expose authenticated balance reconciliation`);
  const balances = await adapter.getBalances();
  await cexInventoryLedger.reconcile(input.venue, balances);
  const reservation = await cexInventoryLedger.reserve(opportunityId, [{ venue: input.venue, asset: input.asset, amount: input.amount }]);
  if (!reservation) throw new Error(`controlled-loss ${input.leg} inventory reservation unavailable`);
  return reservation.reservationId;
}

async function releaseReservation(reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  await pool.query(
    `DELETE FROM public.cryptocrawler_cex_inventory_reservations_v1 WHERE reservation_id=$1`,
    [reservationId],
  );
}

async function recoverKrakenOrder(clientId: string): Promise<string | null> {
  const responses = await Promise.all([
    krakenPrivateRequest('/0/private/OpenOrders', { trades: 'true' }),
    krakenPrivateRequest('/0/private/ClosedOrders', { trades: 'true' }),
  ]);
  const matches: string[] = [];
  for (const response of responses) {
    for (const collectionName of ['open', 'closed']) {
      const collection = response?.[collectionName] || {};
      for (const [orderId, value] of Object.entries(collection)) {
        const order: any = value;
        const observed = String(order?.cl_ord_id || order?.clOrdId || '').replace(/-/g, '').toLowerCase();
        if (observed && observed === clientId.replace(/-/g, '').toLowerCase()) matches.push(orderId);
      }
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) throw new Error('multiple Kraken orders match one controlled-loss deterministic client id');
  return unique[0] || null;
}

async function recoverOkxOrder(clientId: string, constraints: SpotProductConstraints): Promise<string | null> {
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', {
      instId: constraints.exchangeSymbol,
      clOrdId: clientId,
    }, { lane: 'account_read' });
    return response.data[0]?.ordId ? String(response.data[0].ordId) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/51603|order.*does not exist|order.*not exist/i.test(message)) return null;
    throw error;
  }
}

async function submitOrRecoverOrder(input: {
  row: ControlledLossEvent;
  leg: 'entry' | 'exit';
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  clientId: string;
  knownOrderId: string | null;
}): Promise<{ orderId: string; submittedAt: number }> {
  if (!input.row.venue || !input.row.symbol) throw new Error('controlled-loss order intent lacks venue/symbol');
  const constraints = await getSpotProductConstraints(input.row.venue, input.row.symbol, true);
  let orderId = input.knownOrderId;
  if (!orderId) {
    orderId = input.row.venue === 'kraken'
      ? await recoverKrakenOrder(input.clientId)
      : await recoverOkxOrder(input.clientId, constraints);
  }
  const submittedAt = Date.now();
  if (!orderId) {
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: `cex:${input.row.venue}`, venue: input.row.venue, pair: input.row.symbol });
    if (input.row.venue === 'kraken') {
      const response = await krakenPrivateRequest('/0/private/AddOrder', {
        pair: constraints.exchangeSymbol,
        type: input.side,
        ordertype: 'limit',
        price: numericString(input.price),
        volume: numericString(input.quantity),
        timeinforce: 'FOK',
        cl_ord_id: input.clientId,
      });
      orderId = String(response?.txid?.[0] || '').trim();
    } else {
      const response = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
        instId: constraints.exchangeSymbol,
        tdMode: 'cash',
        side: input.side,
        ordType: 'fok',
        px: numericString(input.price),
        sz: numericString(input.quantity),
        clOrdId: input.clientId,
      }, { lane: 'order_write' });
      orderId = String(response.data[0]?.ordId || '').trim();
    }
    if (!orderId) throw new Error(`${input.row.venue} controlled-loss ${input.leg} FOK submission returned no order id`);
  }
  const orderColumn = input.leg === 'entry' ? 'entry_order_id' : 'exit_order_id';
  const status = input.leg === 'entry' ? 'ENTRY_SUBMITTED' : 'EXIT_SUBMITTED';
  await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET ${orderColumn}=$2, status=$3, last_attempt_at=now(), last_error=NULL, updated_at=now()
     WHERE event_id=$1::uuid`,
    [input.row.event_id, orderId, status],
  );
  return { orderId, submittedAt };
}

async function waitTerminal(adapter: CexSettlementAdapter, receipt: CexOrderReceipt): Promise<NormalizedOrderSettlement> {
  const deadline = Date.now() + ORDER_TIMEOUT_MS;
  let settlement = await adapter.query(receipt);
  while (!settlement.terminal && Date.now() < deadline) {
    await sleep(ORDER_POLL_MS);
    settlement = await adapter.query(receipt);
  }
  return settlement;
}

function learningAuthority(eventId: string, leg: 'entry' | 'exit') {
  return {
    learningAuthority: 'cryptara_controlled_loss' as const,
    notionalAuthority: 'controlled_loss_budget' as const,
    executionAuthority: 'controlled_loss_learning_worker' as const,
    governanceAdmitted: true as const,
    reference: `controlled-loss:${eventId}:${leg}`,
    maxLossFraction: MAX_LOSS_FRACTION,
    intentionalLearning: true,
    unleveredSpotOnly: true,
    fillOrKill: true,
    normalParentTradeQuotaConsumed: false,
    canonicalProfitabilityAuthorityChanged: false,
  };
}

async function resetForFreshEntry(row: ControlledLossEvent, reason: string): Promise<void> {
  await releaseReservation(row.entry_inventory_reservation_id);
  await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='RETRYABLE', retry_not_before=now()+($2::text || ' milliseconds')::interval,
         venue=NULL, symbol=NULL, base_asset=NULL, quote_asset=NULL, quote_asset_usd=NULL,
         authenticated_taker_fee_bps=NULL, source_quote_reserve=NULL, requested_base_quantity=NULL,
         entry_limit_price=NULL, entry_client_order_id=NULL, entry_order_id=NULL,
         entry_inventory_reservation_id=NULL, entry_applied=false,
         exit_base_quantity=NULL, exit_limit_price=NULL, exit_client_order_id=NULL,
         exit_order_id=NULL, exit_inventory_reservation_id=NULL, exit_applied=false,
         last_error=$3, last_attempt_at=now(), updated_at=now()
     WHERE event_id=$1::uuid`,
    [row.event_id, RETRY_MS, reason],
  );
}

async function processEntry(row: ControlledLossEvent): Promise<ControlledLossEvent | null> {
  if (!row.venue || !row.symbol || !row.quote_asset || !row.entry_client_order_id ||
      !(Number(row.source_quote_reserve) > 0) || !(Number(row.requested_base_quantity) > 0) || !(Number(row.entry_limit_price) > 0)) {
    throw new Error('controlled-loss PREPARED state is incomplete');
  }
  const reservationId = await ensureReservation({
    row,
    leg: 'entry',
    venue: row.venue,
    asset: row.quote_asset,
    amount: Number(row.source_quote_reserve),
  });
  await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET entry_inventory_reservation_id=$2::uuid, updated_at=now() WHERE event_id=$1::uuid`,
    [row.event_id, reservationId],
  );
  const order = await submitOrRecoverOrder({
    row: { ...row, entry_inventory_reservation_id: reservationId },
    leg: 'entry',
    side: 'buy',
    quantity: Number(row.requested_base_quantity),
    price: Number(row.entry_limit_price),
    clientId: row.entry_client_order_id,
    knownOrderId: row.entry_order_id,
  });
  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const settlement = await waitTerminal(adapter, {
    venue: row.venue,
    orderId: order.orderId,
    symbol: row.symbol,
    side: 'buy',
    requestedQuantity: Number(row.requested_base_quantity),
    submittedAt: order.submittedAt,
  });
  if (!settlement.terminal) return null;
  if (!(Number(settlement.filledQuantity || 0) > 0)) {
    await resetForFreshEntry({ ...row, entry_inventory_reservation_id: reservationId }, 'Controlled-loss entry FOK ended without a fill; fresh random-safe candidate required');
    return null;
  }

  const evidence = await getExactSystemCapitalOrderAssetDeltas(settlement);
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: `controlled-loss:${row.event_id}:entry`,
    strategy: 'controlled_loss_learning',
    authority: learningAuthority(row.event_id, 'entry'),
  });
  await releaseReservation(reservationId);
  const result = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='ENTRY_TERMINAL', entry_order_id=$2, entry_inventory_reservation_id=NULL,
         entry_applied=true, settlement_evidence=jsonb_build_object('entry',$3::jsonb),
         last_error=NULL, updated_at=now()
     WHERE event_id=$1::uuid RETURNING *`,
    [row.event_id, order.orderId, JSON.stringify(evidence)],
  );
  return result.rows[0] as ControlledLossEvent | undefined || null;
}

async function entrySettlementAndEvidence(row: ControlledLossEvent): Promise<{ settlement: NormalizedOrderSettlement; evidence: ExactCexOrderAssetDeltaEvidence }> {
  if (!row.venue || !row.symbol || !row.entry_order_id || !(Number(row.requested_base_quantity) > 0)) {
    throw new Error('controlled-loss terminal entry identity is incomplete');
  }
  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const settlement = await adapter.query({
    venue: row.venue,
    orderId: row.entry_order_id,
    symbol: row.symbol,
    side: 'buy',
    requestedQuantity: Number(row.requested_base_quantity),
    submittedAt: new Date(row.unlocked_at).getTime(),
  });
  if (!settlement.terminal || !(Number(settlement.filledQuantity || 0) > 0)) throw new Error('controlled-loss entry is not authenticated terminal-filled');
  return { settlement, evidence: await getExactSystemCapitalOrderAssetDeltas(settlement) };
}

async function prepareExit(row: ControlledLossEvent, entryEvidence: ExactCexOrderAssetDeltaEvidence): Promise<ControlledLossEvent> {
  if (!row.venue || !row.symbol || !row.base_asset) throw new Error('controlled-loss exit lacks durable market identity');
  const constraints = await getSpotProductConstraints(row.venue, row.symbol, true);
  const acquiredBase = Number(entryEvidence.assetDeltas[row.base_asset] || 0);
  const exitQuantity = floorIncrement(acquiredBase, constraints.baseIncrement);
  if (!(exitQuantity >= constraints.baseMinSize)) {
    throw new Error('controlled-loss exact entry credit cannot satisfy a safe minimum-size exit');
  }
  const book = await cexOrderBookStreams.getQuote(row.venue, row.symbol, BOOK_MAX_AGE_MS);
  const exitLimitPrice = depthWorstPrice(book.depth.bids, exitQuantity);
  if (!(exitLimitPrice && exitLimitPrice > 0)) throw new Error('fresh controlled-loss exit depth is unavailable');
  const attempt = row.attempt_count + 1;
  const exitClientId = deterministicId(`controlled-loss:${row.event_id}:exit:${attempt}`);
  const result = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET exit_base_quantity=$2, exit_limit_price=$3, exit_client_order_id=$4,
         exit_order_id=NULL, exit_inventory_reservation_id=NULL,
         attempt_count=$5, last_attempt_at=now(), last_error=NULL, updated_at=now()
     WHERE event_id=$1::uuid RETURNING *`,
    [row.event_id, exitQuantity, exitLimitPrice, exitClientId, attempt],
  );
  return result.rows[0] as ControlledLossEvent;
}

async function processExit(row: ControlledLossEvent): Promise<ControlledLossEvent | null> {
  if (!row.venue || !row.symbol || !row.base_asset) throw new Error('controlled-loss exit identity is incomplete');
  const entry = await entrySettlementAndEvidence(row);
  if (!row.exit_client_order_id || !(Number(row.exit_base_quantity) > 0) || !(Number(row.exit_limit_price) > 0)) {
    row = await prepareExit(row, entry.evidence);
  }
  const quantity = Number(row.exit_base_quantity);
  const price = Number(row.exit_limit_price);
  if (!row.exit_client_order_id || !(quantity > 0) || !(price > 0)) throw new Error('controlled-loss exit intent was not durably prepared');

  const reservationId = await ensureReservation({ row, leg: 'exit', venue: row.venue, asset: row.base_asset, amount: quantity });
  await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET exit_inventory_reservation_id=$2::uuid, updated_at=now() WHERE event_id=$1::uuid`,
    [row.event_id, reservationId],
  );
  const order = await submitOrRecoverOrder({
    row: { ...row, exit_inventory_reservation_id: reservationId },
    leg: 'exit', side: 'sell', quantity, price,
    clientId: row.exit_client_order_id,
    knownOrderId: row.exit_order_id,
  });
  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const settlement = await waitTerminal(adapter, {
    venue: row.venue, orderId: order.orderId, symbol: row.symbol, side: 'sell',
    requestedQuantity: quantity, submittedAt: order.submittedAt,
  });
  if (!settlement.terminal) return null;
  if (!(Number(settlement.filledQuantity || 0) > 0)) {
    await releaseReservation(reservationId);
    await pool.query(
      `UPDATE public.cryptocrawler_controlled_loss_learning_events
       SET status='ENTRY_TERMINAL', retry_not_before=now()+($2::text || ' milliseconds')::interval,
           exit_base_quantity=NULL, exit_limit_price=NULL, exit_client_order_id=NULL,
           exit_order_id=NULL, exit_inventory_reservation_id=NULL,
           last_error='Controlled-loss exit FOK ended without a fill; entry ownership remains intact and a fresh exit will be built',
           last_attempt_at=now(), updated_at=now()
       WHERE event_id=$1::uuid`,
      [row.event_id, RETRY_MS],
    );
    return null;
  }

  const evidence = await getExactSystemCapitalOrderAssetDeltas(settlement);
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: `controlled-loss:${row.event_id}:exit`,
    strategy: 'controlled_loss_learning',
    authority: learningAuthority(row.event_id, 'exit'),
  });
  await releaseReservation(reservationId);
  const result = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='EXIT_SUBMITTED', exit_order_id=$2, exit_inventory_reservation_id=NULL,
         exit_applied=true,
         settlement_evidence=COALESCE(settlement_evidence,'{}'::jsonb) || jsonb_build_object('exit',$3::jsonb),
         last_error=NULL, updated_at=now()
     WHERE event_id=$1::uuid RETURNING *`,
    [row.event_id, order.orderId, JSON.stringify(evidence)],
  );
  return result.rows[0] as ControlledLossEvent | undefined || null;
}

function combineDeltas(...evidence: ExactCexOrderAssetDeltaEvidence[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const item of evidence) {
    for (const [asset, delta] of Object.entries(item.assetDeltas)) {
      output[asset] = addExactDecimals(output[asset] || '0', String(delta));
    }
  }
  return output;
}

async function valueDeltasUsd(deltas: Record<string, string>): Promise<{ realizedProfitUsd: number; prices: Record<string, number> }> {
  let realizedProfitUsd = 0;
  const prices: Record<string, number> = {};
  for (const [asset, delta] of Object.entries(deltas)) {
    const numericDelta = Number(delta);
    if (!Number.isFinite(numericDelta)) throw new Error(`controlled-loss exact delta is not numerically representable for ${asset}`);
    if (Math.abs(numericDelta) <= 1e-18) continue;
    const price = await usdPrice(asset);
    prices[asset] = price;
    realizedProfitUsd += numericDelta * price;
  }
  return { realizedProfitUsd, prices };
}

async function finalizeLearning(row: ControlledLossEvent): Promise<void> {
  if (!row.venue || !row.symbol || !row.base_asset || !row.quote_asset || !row.entry_order_id || !row.exit_order_id) {
    throw new Error('controlled-loss terminal round-trip identity is incomplete');
  }
  const adapter = createProductionCexSettlementAdapters()[row.venue];
  const [entrySettlement, exitSettlement] = await Promise.all([
    adapter.query({
      venue: row.venue, orderId: row.entry_order_id, symbol: row.symbol, side: 'buy',
      requestedQuantity: Number(row.requested_base_quantity), submittedAt: new Date(row.unlocked_at).getTime(),
    }),
    adapter.query({
      venue: row.venue, orderId: row.exit_order_id, symbol: row.symbol, side: 'sell',
      requestedQuantity: Number(row.exit_base_quantity), submittedAt: Date.now(),
    }),
  ]);
  if (!entrySettlement.terminal || !exitSettlement.terminal) throw new Error('controlled-loss finalization requires two authenticated terminal orders');
  const [entryEvidence, exitEvidence] = await Promise.all([
    getExactSystemCapitalOrderAssetDeltas(entrySettlement),
    getExactSystemCapitalOrderAssetDeltas(exitSettlement),
  ]);
  const deltas = combineDeltas(entryEvidence, exitEvidence);
  const terminalValuation = await valueDeltasUsd(deltas);
  const realizedProfitUsd = Number(terminalValuation.realizedProfitUsd.toFixed(12));
  const maxLossUsd = Number(row.max_loss_usd || 0);
  const currentGross = await currentGrossProfit(row.local_date);
  const currentMaxLoss = currentGross * MAX_LOSS_FRACTION;
  if (!(maxLossUsd > 0) || maxLossUsd > currentMaxLoss + 1e-9 || realizedProfitUsd < -maxLossUsd - 1e-9) {
    await pool.query(
      `UPDATE public.cryptocrawler_controlled_loss_learning_events
       SET status='MANUAL_REVIEW', realized_profit_usd=$2, terminal_price_observed_at=now(),
           last_error='Authenticated controlled-loss terminal result conflicts with the 5% loss invariant', updated_at=now()
       WHERE event_id=$1::uuid`,
      [row.event_id, realizedProfitUsd],
    );
    throw new Error('controlled-loss terminal result conflicts with the 5% loss invariant');
  }

  const quoteUsd = terminalValuation.prices[row.quote_asset] || await usdPrice(row.quote_asset);
  const entryQuoteDelta = Number(entryEvidence.assetDeltas[row.quote_asset] || 0);
  const exitQuoteDelta = Number(exitEvidence.assetDeltas[row.quote_asset] || 0);
  const acquisitionCostUsd = entryQuoteDelta < 0 ? -entryQuoteDelta * quoteUsd : null;
  const proceedsUsd = exitQuoteDelta > 0 ? exitQuoteDelta * quoteUsd : null;
  const submittedAt = Math.min(entrySettlement.submittedAt, exitSettlement.submittedAt);
  const settledAt = Math.max(entrySettlement.terminalAt || submittedAt, exitSettlement.terminalAt || submittedAt);
  const expectedLossUsd = Number(row.expected_loss_usd || 0);
  const normalized: NormalizedRealizedExecution = {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt,
    settledAt,
    venueOrRoute: `controlled-loss:${row.venue}`,
    chain: 'cex',
    predicted: {
      profitUsd: expectedLossUsd > 0 ? -expectedLossUsd : null,
      feeUsd: null,
      slippageBps: null,
    },
    realized: {
      acquisitionCostUsd,
      proceedsUsd,
      exchangeFeeUsd: null,
      gasUsd: 0,
      gasUsed: null,
      effectiveGasPriceWei: null,
      slippageBps: null,
      netProfitUsd: realizedProfitUsd,
    },
    provenance: [
      'intentional_controlled_loss_learning',
      'unlocked_after_first_terminal_profit',
      'randomized_post_win_schedule',
      'max_daily_loss_fraction:0.05',
      'normal_parent_trade_quota_consumed:false',
      'unlevered_spot_only',
      'fok_entry_exit',
      'exact_system_owned_asset_deltas',
      'terminal_live_usd_valuation',
      'residual_mark_to_market_if_any',
      ...entryEvidence.provenance.map(value => `entry:${value}`),
      ...exitEvidence.provenance.map(value => `exit:${value}`),
    ],
    orders: [entrySettlement, exitSettlement],
  };

  const evidence = {
    entry: entryEvidence,
    exit: exitEvidence,
    combinedAssetDeltas: deltas,
    terminalUsdPrices: terminalValuation.prices,
    grossPositiveDailyProfitUsd: currentGross,
    maxLossUsd,
    realizedProfitUsd,
  };
  await pool.query(
    `SELECT public.cryptocrawler_record_controlled_loss_terminal($1::uuid,$2,$3::jsonb) AS status`,
    [row.event_id, realizedProfitUsd, JSON.stringify(evidence)],
  );

  await recordCryptaraExecutionEvidence({
    source: 'manual',
    opportunityId: `controlled-loss:${row.event_id}`,
    chain: 'cex',
    symbol: row.symbol,
    strategy: 'controlled_loss_learning',
    success: realizedProfitUsd > 0,
    expectedProfitUsd: expectedLossUsd > 0 ? -expectedLossUsd : 0,
    realizedProfitUsd,
    feeUsd: null,
    slippageBps: null,
    latencyMs: Math.max(0, settledAt - submittedAt),
    usedZeroCapital: false,
    timestamp: settledAt,
    notes: realizedProfitUsd < 0
      ? 'Intentional controlled negative-edge learning settlement'
      : 'Controlled negative-edge learning round-trip settled non-negative; terminal truth preserved without fabricating a loss',
    settlementStatus: normalized.status,
    settlementConfirmed: true,
    provenance: normalized.provenance,
    settlement: normalized,
  });

  await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET terminal_price_observed_at=now(), updated_at=now() WHERE event_id=$1::uuid`,
    [row.event_id],
  );
  logger.info('[ControlledLossLearning] Terminal learning round-trip recorded by canonical Cryptara learning', {
    component: 'ControlledLossLearningWorker',
    eventId: row.event_id,
    localDate: row.local_date,
    venue: row.venue,
    symbol: row.symbol,
    grossPositiveDailyProfitUsd: currentGross,
    maxLossUsd,
    realizedProfitUsd,
    actualLossFractionOfGross: realizedProfitUsd < 0 ? Math.abs(realizedProfitUsd) / currentGross : 0,
    maxLossFraction: MAX_LOSS_FRACTION,
    normalParentTradeQuotaConsumed: false,
    terminalTruthFabricated: false,
  });
}

async function processActiveEvent(row: ControlledLossEvent): Promise<void> {
  if (localDateKey() !== row.local_date) {
    await pool.query(
      `UPDATE public.cryptocrawler_controlled_loss_learning_events
       SET status='MISSED', last_error='Trading day ended before a safely terminal controlled-loss round-trip could be completed',
           completed_at=now(), updated_at=now()
       WHERE event_id=$1::uuid AND status NOT IN ('TERMINAL_LOSS','TERMINAL_NONLOSS')`,
      [row.event_id],
    );
    return;
  }
  if (await normalParentTradeInFlight(row.local_date)) return;

  if (row.status === 'SCHEDULED' || (row.status === 'RETRYABLE' && !row.venue)) {
    const prepared = await prepareEvent(row);
    if (!prepared) return;
    row = prepared;
  }
  if (row.status === 'PREPARED' || row.status === 'ENTRY_SUBMITTED') {
    const entered = await processEntry(row);
    if (!entered) return;
    row = entered;
  }
  if (row.status === 'ENTRY_TERMINAL' || (row.status === 'RETRYABLE' && row.entry_applied)) {
    const exited = await processExit(row);
    if (!exited) return;
    row = exited;
  }
  if (row.exit_applied || row.status === 'EXIT_SUBMITTED') {
    await finalizeLearning(row);
  }
}

async function runOnceInternal(): Promise<void> {
  if (!isDatabaseConfigured || !liveExecutionPosture()) return;
  await scheduleTodayAfterFirstWin();
  const row = await loadActiveEvent();
  if (!row) return;
  try {
    await processActiveEvent(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Preserve the exact durable state. A retry must recover by deterministic
    // client id before any resubmission; it must never clear ambiguous order state.
    await pool.query(
      `UPDATE public.cryptocrawler_controlled_loss_learning_events
       SET last_error=$2, last_attempt_at=now(), updated_at=now()
       WHERE event_id=$1::uuid AND status NOT IN ('TERMINAL_LOSS','TERMINAL_NONLOSS','MISSED')`,
      [row.event_id, message.slice(0, 2000)],
    ).catch(() => undefined);
    logger.warn('[ControlledLossLearning] Controlled learning attempt deferred without widening risk', {
      component: 'ControlledLossLearningWorker',
      eventId: row.event_id,
      status: row.status,
      error: message,
      duplicateSubmissionAuthorityGranted: false,
      maxLossFractionChanged: false,
    });
  }
}

export async function runControlledLossLearningOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runOnceInternal().finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureControlledLossLearningWorker(): void {
  if (timer || process.env.NO_INTERVALS === 'true' || process.env.ALLOW_INTERVALS !== 'true') return;
  timer = setInterval(() => { void runControlledLossLearningOnce(); }, WORKER_INTERVAL_MS);
  timer.unref?.();
  void runControlledLossLearningOnce();
  logger.info('[ControlledLossLearning] Randomized post-first-win learning worker online', {
    component: 'ControlledLossLearningWorker',
    eventsPerTradingDay: 1,
    normalParentTradesPerTradingDayUnchanged: '1_to_3',
    unlockAuthority: 'first_terminal_positive_profit_event',
    placement: 'durable_randomized_after_first_win',
    maxLossFractionOfGrossPositiveDailyProfit: MAX_LOSS_FRACTION,
    principalFractionOfMaxLoss: PRINCIPAL_FRACTION_OF_MAX_LOSS,
    leverage: false,
    venues: ['kraken', 'okx'],
    orderTimeInForce: 'FOK',
    canonicalCryptaraLearning: true,
  });
}

export function stopControlledLossLearningWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
