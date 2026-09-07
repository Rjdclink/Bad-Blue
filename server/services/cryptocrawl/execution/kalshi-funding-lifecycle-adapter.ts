import logger from '../../../logger.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';
import {
  getKalshiMarginAccountReadiness,
  getKalshiPerpExecutionEvidence,
  getKalshiPerpPosition,
  type KalshiOrderbookLevel,
} from '../intelligence/kalshi-perps-market-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  hydrateKalshiFundingCapitalReadiness,
  kalshiFundingEvidenceProjectedNetUsd,
  measureKalshiFundingExecutionEvidence,
  type KalshiFundingExecutionEvidence,
} from './kalshi-funding-evidence.js';
import {
  applyKalshiFundingCexSpotOwnership,
  placeOrRecoverKalshiFundingCexOrder,
  queryKalshiFundingCexOrder,
  recoverKalshiFundingCexOrder,
  requireTerminalKalshiFundingCexFill,
  summarizeKalshiFundingCexSpotEconomics,
  type KalshiFundingHedgeVenue,
} from './kalshi-funding-cex-hedge.js';
import {
  recoverKalshiFundingHedgeHold,
  releaseKalshiFundingHedgeHold,
  renewKalshiFundingHedgeHold,
  replaceKalshiFundingHedgeQuoteWithBase,
  reserveKalshiFundingHedgeQuote,
  type KalshiFundingHedgeCapitalHold,
} from './kalshi-funding-hedge-capital.js';
import {
  cancelKalshiPerpOrder,
  getKalshiFundingPayments,
  getKalshiPerpFillsForOrder,
  getKalshiPerpOrder,
  kalshiFundingClientOrderId,
  placeOrRecoverKalshiPerpOrder,
  requireTerminalKalshiFokFill,
  summarizeKalshiPerpFillEconomics,
  type KalshiPerpOrderState,
} from './kalshi-perps-order-authority.js';
import {
  applyKalshiTerminalMarginSettlement,
  getKalshiSystemMarginSnapshot,
  recoverKalshiSystemMarginReservation,
  releaseKalshiSystemMarginReservation,
  renewKalshiSystemMarginReservation,
  reserveKalshiSystemMargin,
  type KalshiSystemMarginReservation,
} from './kalshi-system-owned-margin-ledger.js';
import type { CexSystemCapitalSettlementAuthority } from './cex-system-owned-lot-ledger.js';
import {
  fundingPositionLifecycle,
  type FundingExecutionPlan,
  type FundingLifecycleAdapter,
  type FundingOpenReceipt,
  type FundingOpeningRecoveryResult,
  type FundingTerminalSettlement,
} from './funding-position-lifecycle.js';

export type KalshiFundingExecutionPlan = Omit<FundingExecutionPlan, 'venue'> & {
  venue: 'kalshi_perps';
  kalshi: {
    ticker: string;
    baseAsset: string;
    quoteAsset: 'USD';
    hedgeVenue: KalshiFundingHedgeVenue;
    hedgeSymbol: string;
    contracts: number;
    contractSize: number;
    baseQuantity: number;
    fundingRate: number;
    evidenceMeasuredAt: number;
    evidenceExpiresAt: number;
    kalshiTakerFeeBps: number;
    hedgeTakerFeeBps: number;
    entry: {
      kalshiEntryLimit: number;
      spotEntryLimit: number;
    };
  };
};

type KalshiFundingOpenReceipt = FundingOpenReceipt & {
  hedgeVenue: KalshiFundingHedgeVenue;
  kalshiContracts: number;
  contractSize: number;
};

const preparedPlans = new Map<string, KalshiFundingExecutionPlan>();
const lifecyclePlans = new Map<string, KalshiFundingExecutionPlan>();
const marginReservations = new Map<string, KalshiSystemMarginReservation>();
const hedgeHolds = new Map<string, KalshiFundingHedgeCapitalHold>();
let registered = false;

function asKalshiPlan(plan: FundingExecutionPlan): KalshiFundingExecutionPlan | null {
  const candidate = plan as unknown as Partial<KalshiFundingExecutionPlan>;
  return candidate.venue === 'kalshi_perps' && candidate.kalshi
    ? candidate as KalshiFundingExecutionPlan
    : null;
}

function fundingAuthority(lifecycleId: string): CexSystemCapitalSettlementAuthority {
  return {
    strategySelectionAuthority: 'funding_arbitrage_policy',
    notionalAuthority: 'profit_ladder',
    executionAuthority: 'funding_position_lifecycle',
    governanceAdmitted: true,
    reference: lifecycleId,
    venue: 'kalshi_perps',
    hedgeExecution: 'system_owned_cex_spot',
  };
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimal(value: number, places = 12): string {
  if (!Number.isFinite(value)) throw new Error('Kalshi funding exact-accounting value is not finite');
  const text = value.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function holdUntil(plan: KalshiFundingExecutionPlan, openedAt = Date.now()): number {
  const maxHoldMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_FUNDING_MAX_HOLD_MS || 8 * 60 * 60_000)));
  const accountingRecoveryMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_KALSHI_TERMINAL_ACCOUNTING_HOLD_MS || 6 * 60 * 60_000)));
  return Math.min(openedAt + 24 * 60 * 60_000, Math.max(plan.fundingTimestamp + maxHoldMs, Date.now() + accountingRecoveryMs));
}

function kalshiMarginRequirementUsd(plan: KalshiFundingExecutionPlan): number {
  // Reserve a full-notional system-owned backing envelope rather than assuming
  // leverage lowers capital consumption. This prevents a mixed account balance
  // from silently becoming the source of margin.
  const feesAndExit = Math.max(0, plan.expectedEntryCostUsd) + Math.max(0, plan.expectedExitCostUsd);
  const cushion = Math.max(1, plan.notionalUsd * 0.01);
  return plan.notionalUsd + feesAndExit + cushion;
}

function hedgeQuoteRequirementUsd(plan: KalshiFundingExecutionPlan): number {
  const raw = plan.kalshi.entry.spotEntryLimit * plan.kalshi.baseQuantity;
  return raw * (1 + plan.kalshi.hedgeTakerFeeBps / 10_000 + 0.0025);
}

async function exclusiveSystemOwnedKalshiAccount(requiredUsd: number): Promise<boolean> {
  const [snapshot, readiness, orders] = await Promise.all([
    getKalshiSystemMarginSnapshot(true),
    getKalshiMarginAccountReadiness(true, true),
    kalshiAuthenticatedRequest<any>('/trade-api/v2/margin/orders?subaccount=0&limit=1000').catch(() => null),
  ]);
  if (!snapshot.authenticatedCapacity || !readiness.authenticated || !readiness.marginEnabled || !readiness.availableBalanceComputed) return false;
  if (snapshot.usableUsd + 1e-9 < requiredUsd) return false;
  const equity = finite(readiness.accountEquityUsd);
  if (equity === null || equity < 0) return false;
  // New Kalshi exposure is allowed only when all physical equity is covered by
  // the system-ownership ledger. Extra unexplained cash could be personal funds.
  const unexplained = Math.max(0, equity - snapshot.ownedUsd);
  const tolerance = Math.max(0.01, equity * 1e-6);
  if (unexplained > tolerance) return false;
  const activeOrders = (Array.isArray(orders?.orders) ? orders.orders : [])
    .filter((row: any) => Number(row?.remaining_count || 0) > 0);
  return activeOrders.length === 0;
}

function walk(levels: readonly { price: number; quantity: number }[], quantity: number): number | null {
  if (!(quantity > 0)) return null;
  let remaining = quantity;
  let worst: number | null = null;
  for (const level of levels) {
    if (!(level.price > 0) || !(level.quantity > 0)) continue;
    const take = Math.min(remaining, level.quantity);
    remaining -= take;
    worst = level.price;
    if (remaining <= Math.max(1e-10, quantity * 1e-8)) return worst;
  }
  return null;
}

async function freshExitLimits(plan: KalshiFundingExecutionPlan, contracts: number, baseQuantity: number): Promise<{
  kalshiBuyLimit: number;
  spotSellLimit: number;
}> {
  const maxAgeMs = Math.max(500, Math.min(10_000, Number(process.env.CRYPTOCRAWL_KALSHI_FUNDING_EVIDENCE_TTL_MS || 3_000)));
  const [kalshi, spot] = await Promise.all([
    getKalshiPerpExecutionEvidence(plan.kalshi.ticker, true),
    cexOrderBookStreams.getQuote(plan.kalshi.hedgeVenue, plan.kalshi.hedgeSymbol, maxAgeMs),
  ]);
  if (!kalshi || !spot) throw new Error('KALSHI_FUNDING_EXIT_DEPTH_UNAVAILABLE');
  const kalshiBuyLimit = walk(kalshi.orderbook.asks, contracts);
  const spotSellLimit = walk(spot.depth.bids, baseQuantity);
  if (!(kalshiBuyLimit && kalshiBuyLimit > 0) || !(spotSellLimit && spotSellLimit > 0)) {
    throw new Error('KALSHI_FUNDING_EXIT_DEPTH_INSUFFICIENT');
  }
  return { kalshiBuyLimit, spotSellLimit };
}

async function currentPlan(plan: KalshiFundingExecutionPlan): Promise<KalshiFundingExecutionPlan | null> {
  const evidence = await measureKalshiFundingExecutionEvidence({
    ticker: plan.kalshi.ticker,
    targetNotionalUsd: plan.notionalUsd,
  });
  if (!evidence || evidence.hedgeVenue !== plan.kalshi.hedgeVenue || evidence.hedgeSymbol !== plan.kalshi.hedgeSymbol) return null;
  const hydrated = await hydrateKalshiFundingCapitalReadiness(evidence).catch(() => null);
  if (!hydrated || hydrated.expiresAt <= Date.now()) return null;
  const projected = kalshiFundingEvidenceProjectedNetUsd(hydrated);
  if (!(projected > 0) || hydrated.fundingRate <= 0) return null;
  const baseTolerance = Math.max(1e-10, plan.kalshi.baseQuantity * 1e-6);
  const contractTolerance = Math.max(1e-8, plan.kalshi.contracts * 1e-6);
  if (Math.abs(hydrated.baseQuantity - plan.kalshi.baseQuantity) > baseTolerance || Math.abs(hydrated.contracts - plan.kalshi.contracts) > contractTolerance) return null;
  const fees = hydrated.expectedTradingFeesUsd;
  const basisAndSlip = hydrated.measuredNotionalUsd * (hydrated.entryBasisBps + hydrated.exitBasisReserveBps + hydrated.expectedSlippageBps) / 10_000;
  return {
    ...plan,
    notionalUsd: hydrated.measuredNotionalUsd,
    expectedNetProfitUsd: projected,
    expectedEntryCostUsd: fees / 2 + basisAndSlip / 2,
    expectedExitCostUsd: fees / 2 + basisAndSlip / 2,
    expectedFundingUsd: hydrated.measuredNotionalUsd * hydrated.fundingRate,
    fundingTimestamp: hydrated.nextFundingTime,
    expiresAt: Math.min(plan.expiresAt, hydrated.expiresAt, hydrated.nextFundingTime - 1),
    provenance: [...plan.provenance, ...hydrated.provenance, 'kalshi_funding_plan:live_reverified'],
    kalshi: {
      ticker: hydrated.ticker,
      baseAsset: hydrated.baseAsset,
      quoteAsset: hydrated.quoteAsset,
      hedgeVenue: hydrated.hedgeVenue,
      hedgeSymbol: hydrated.hedgeSymbol,
      contracts: hydrated.contracts,
      contractSize: hydrated.contractSize,
      baseQuantity: hydrated.baseQuantity,
      fundingRate: hydrated.fundingRate,
      evidenceMeasuredAt: hydrated.measuredAt,
      evidenceExpiresAt: hydrated.expiresAt,
      kalshiTakerFeeBps: hydrated.kalshiTakerFeeBps,
      hedgeTakerFeeBps: hydrated.hedgeTakerFeeBps,
      entry: {
        kalshiEntryLimit: hydrated.kalshiEntryLimit,
        spotEntryLimit: hydrated.spotEntryLimit,
      },
    },
  };
}

async function durablePlan(lifecycleId: string): Promise<KalshiFundingExecutionPlan | null> {
  const cached = lifecyclePlans.get(lifecycleId);
  if (cached) return cached;
  const result = await pool.query(
    `SELECT plan FROM private.cryptocrawler_funding_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  ).catch(() => null);
  const raw = result?.rows?.[0]?.plan;
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const plan = asKalshiPlan(parsed as FundingExecutionPlan);
  if (plan) lifecyclePlans.set(lifecycleId, plan);
  return plan;
}

async function recoverCapital(plan: KalshiFundingExecutionPlan, lifecycleId: string, receipt?: FundingOpenReceipt): Promise<{
  margin: KalshiSystemMarginReservation | null;
  hedge: KalshiFundingHedgeCapitalHold | null;
}> {
  let margin = marginReservations.get(lifecycleId) ?? null;
  if (!margin) {
    margin = await recoverKalshiSystemMarginReservation({ lifecycleId, opportunityId: plan.opportunityId });
    if (margin) marginReservations.set(lifecycleId, margin);
  }
  let hedge = hedgeHolds.get(lifecycleId) ?? null;
  if (!hedge) {
    hedge = await recoverKalshiFundingHedgeHold({
      lifecycleId,
      opportunityId: plan.opportunityId,
      venue: plan.kalshi.hedgeVenue,
      baseAsset: plan.kalshi.baseAsset,
      quoteAsset: plan.kalshi.quoteAsset,
      holdUntil: holdUntil(plan, receipt?.openedAt ?? Date.now()),
    });
    if (hedge) hedgeHolds.set(lifecycleId, hedge);
  }
  return { margin, hedge };
}

async function releaseCapital(plan: KalshiFundingExecutionPlan, receipt: FundingOpenReceipt): Promise<void> {
  const recovered = await recoverCapital(plan, receipt.lifecycleId, receipt);
  if (recovered.hedge) await releaseKalshiFundingHedgeHold(recovered.hedge);
  if (recovered.margin) await releaseKalshiSystemMarginReservation(recovered.margin.reservationId);
  hedgeHolds.delete(receipt.lifecycleId);
  marginReservations.delete(receipt.lifecycleId);
  lifecyclePlans.delete(receipt.lifecycleId);
}

async function requireKalshiPositionClosed(ticker: string): Promise<boolean> {
  const position = await getKalshiPerpPosition(ticker).catch(() => null);
  return !position || Math.abs(position.contracts) <= 1e-8;
}

async function kalshiCloseLimit(ticker: string, side: 'bid' | 'ask', contracts: number): Promise<number> {
  const evidence = await getKalshiPerpExecutionEvidence(ticker, true);
  if (!evidence) throw new Error('KALSHI_EMERGENCY_CLOSE_DEPTH_UNAVAILABLE');
  const levels: readonly KalshiOrderbookLevel[] = side === 'bid' ? evidence.orderbook.asks : evidence.orderbook.bids;
  const limit = walk(levels, contracts);
  if (!(limit && limit > 0)) throw new Error('KALSHI_EMERGENCY_CLOSE_DEPTH_INSUFFICIENT');
  return limit;
}

async function closeKalshiExposure(plan: KalshiFundingExecutionPlan, lifecycleId: string, leg: string): Promise<KalshiPerpOrderState | null> {
  const position = await getKalshiPerpPosition(plan.kalshi.ticker).catch(() => null);
  if (!position || Math.abs(position.contracts) <= 1e-8) return null;
  const contracts = Math.abs(position.contracts);
  const side: 'bid' | 'ask' = position.contracts < 0 ? 'bid' : 'ask';
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const price = await kalshiCloseLimit(plan.kalshi.ticker, side, contracts);
      const state = await placeOrRecoverKalshiPerpOrder({
        lifecycleId,
        leg: `${leg}-${attempt}`,
        ticker: plan.kalshi.ticker,
        side,
        contracts,
        price,
        timeInForce: 'fill_or_kill',
        reduceOnly: true,
      });
      const terminal = await requireTerminalKalshiFokFill({ state, requestedContracts: contracts, minimumObservedAt: Date.now() - 60_000 });
      if (terminal.state.fullyFilled && await requireKalshiPositionClosed(plan.kalshi.ticker)) return terminal.state;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`KALSHI_EMERGENCY_CLOSE_UNPROVEN:${lastError instanceof Error ? lastError.message : String(lastError || 'unknown')}`);
}

async function submitEntry(plan: KalshiFundingExecutionPlan, lifecycleId: string, capital: {
  margin: KalshiSystemMarginReservation;
  hedge: KalshiFundingHedgeCapitalHold;
}): Promise<KalshiFundingOpenReceipt> {
  const submittedAt = Date.now();
  const [perpSubmitted, spotSubmitted] = await Promise.allSettled([
    placeOrRecoverKalshiPerpOrder({
      lifecycleId,
      leg: 'kp-entry',
      ticker: plan.kalshi.ticker,
      side: 'ask',
      contracts: plan.kalshi.contracts,
      price: plan.kalshi.entry.kalshiEntryLimit,
      timeInForce: 'fill_or_kill',
      cancelOrderOnPause: true,
    }),
    placeOrRecoverKalshiFundingCexOrder({
      venue: plan.kalshi.hedgeVenue,
      lifecycleId,
      leg: 'cs-entry',
      symbol: plan.kalshi.hedgeSymbol,
      side: 'buy',
      quantity: plan.kalshi.baseQuantity,
      price: plan.kalshi.entry.spotEntryLimit,
      ordType: 'fok',
    }),
  ]);

  const perpState = perpSubmitted.status === 'fulfilled' ? perpSubmitted.value : null;
  const spotOrder = spotSubmitted.status === 'fulfilled' ? spotSubmitted.value : null;
  const [perpTerminal, spotTerminal] = await Promise.allSettled([
    perpState
      ? requireTerminalKalshiFokFill({ state: perpState, requestedContracts: plan.kalshi.contracts, minimumObservedAt: submittedAt })
      : Promise.reject(perpSubmitted.status === 'rejected' ? perpSubmitted.reason : new Error('Kalshi perp entry not submitted')),
    spotOrder
      ? requireTerminalKalshiFundingCexFill({
          venue: plan.kalshi.hedgeVenue,
          orderId: spotOrder.orderId,
          symbol: plan.kalshi.hedgeSymbol,
          side: 'buy',
          requestedQuantity: plan.kalshi.baseQuantity,
          submittedAt: spotOrder.submittedAt,
        })
      : Promise.reject(spotSubmitted.status === 'rejected' ? spotSubmitted.reason : new Error('CEX spot entry not submitted')),
  ]);

  if (perpTerminal.status !== 'fulfilled' || spotTerminal.status !== 'fulfilled') {
    // Do not release capital until any real orphan exposure is neutralized and
    // system-owned accounting is applied. Deterministic IDs make this restart-safe.
    let spotEntrySettlement = spotTerminal.status === 'fulfilled' ? spotTerminal.value : null;
    if (!spotEntrySettlement && spotOrder) {
      spotEntrySettlement = await queryKalshiFundingCexOrder({
        venue: plan.kalshi.hedgeVenue,
        orderId: spotOrder.orderId,
        symbol: plan.kalshi.hedgeSymbol,
        side: 'buy',
        requestedQuantity: plan.kalshi.baseQuantity,
        submittedAt: spotOrder.submittedAt,
      }).catch(() => null);
    }
    try {
      let liveHedge = capital.hedge;
      if (spotEntrySettlement && (spotEntrySettlement.filledQuantity ?? 0) > 0) {
        const entryEvidence = await applyKalshiFundingCexSpotOwnership({
          lifecycleId,
          opportunityId: plan.opportunityId,
          settlement: spotEntrySettlement,
          authority: fundingAuthority(lifecycleId),
        });
        const acquired = entryEvidence.assetDeltas[plan.kalshi.baseAsset];
        if (!acquired || Number(acquired) <= 0) throw new Error('KALSHI_FUNDING_ORPHAN_SPOT_BASE_OWNERSHIP_UNPROVEN');
        liveHedge = await replaceKalshiFundingHedgeQuoteWithBase({ hold: liveHedge, exactBaseAmount: acquired });
        hedgeHolds.set(lifecycleId, liveHedge);
        const close = await placeOrRecoverKalshiFundingCexOrder({
          venue: plan.kalshi.hedgeVenue,
          lifecycleId,
          leg: 'cs-entry-emergency',
          symbol: plan.kalshi.hedgeSymbol,
          side: 'sell',
          quantity: Number(acquired),
          ordType: 'market',
        });
        const closeSettlement = await requireTerminalKalshiFundingCexFill({
          venue: plan.kalshi.hedgeVenue,
          orderId: close.orderId,
          symbol: plan.kalshi.hedgeSymbol,
          side: 'sell',
          requestedQuantity: Number(acquired),
          submittedAt: close.submittedAt,
        });
        await applyKalshiFundingCexSpotOwnership({
          lifecycleId,
          opportunityId: plan.opportunityId,
          settlement: closeSettlement,
          authority: fundingAuthority(lifecycleId),
        });
      }
      await closeKalshiExposure(plan, lifecycleId, 'kp-entry-emergency');
      await releaseKalshiFundingHedgeHold(liveHedge);
      await releaseKalshiSystemMarginReservation(capital.margin.reservationId);
      hedgeHolds.delete(lifecycleId);
      marginReservations.delete(lifecycleId);
      throw new Error('KALSHI_FUNDING_ENTRY_LEG_MISMATCH_NEUTRALIZED');
    } catch (error) {
      if (error instanceof Error && error.message === 'KALSHI_FUNDING_ENTRY_LEG_MISMATCH_NEUTRALIZED') throw error;
      logger.error('[KalshiFunding] Entry mismatch recovery failed; durable capital remains held', {
        component: 'KalshiFundingLifecycleAdapter', lifecycleId, opportunityId: plan.opportunityId,
        error: error instanceof Error ? error.message : String(error),
        capitalReleased: false, exposureForgotten: false,
      });
      throw new Error('KALSHI_FUNDING_ENTRY_RECOVERY_REQUIRED');
    }
  }

  const perp = perpTerminal.value;
  const spot = spotTerminal.value;
  const measuredPerpBase = perp.fills.reduce((sum, fill) => sum + fill.contracts, 0) * plan.kalshi.contractSize;
  const measuredSpotBase = Number(spot.filledQuantity || 0);
  const mismatch = Math.abs(measuredPerpBase - measuredSpotBase);
  const tolerance = Math.max(1e-10, Math.max(measuredPerpBase, measuredSpotBase) * 1e-6);
  if (mismatch > tolerance) throw new Error('KALSHI_FUNDING_DELTA_NEUTRALITY_MISMATCH');

  lifecyclePlans.set(lifecycleId, plan);
  return {
    lifecycleId,
    spotOrderId: spot.orderId,
    perpOrderId: perp.state.orderId,
    openedAt: Date.now(),
    entrySubmittedAt: submittedAt,
    deltaNeutral: true,
    measuredSpotQuantity: measuredSpotBase,
    measuredPerpQuantity: measuredPerpBase,
    entryOwnershipConfirmed: false,
    marginReservationId: capital.margin.reservationId,
    spotEntryReservationId: capital.hedge.quoteReservationId,
    baseReservationId: capital.hedge.baseReservationId,
    capitalReservationIds: [capital.margin.reservationId, capital.hedge.quoteReservationId].filter((value): value is string => Boolean(value)),
    hedgeVenue: plan.kalshi.hedgeVenue,
    kalshiContracts: plan.kalshi.contracts,
    contractSize: plan.kalshi.contractSize,
  };
}

async function reconcileEntryOwnership(plan: KalshiFundingExecutionPlan, receipt: KalshiFundingOpenReceipt): Promise<KalshiFundingOpenReceipt> {
  if (receipt.entryOwnershipConfirmed === true) return receipt;
  const capital = await recoverCapital(plan, receipt.lifecycleId, receipt);
  if (!capital.margin || !capital.hedge) throw new Error('KALSHI_FUNDING_DURABLE_CAPITAL_HOLD_UNAVAILABLE');
  const spot = await requireTerminalKalshiFundingCexFill({
    venue: plan.kalshi.hedgeVenue,
    orderId: receipt.spotOrderId,
    symbol: plan.kalshi.hedgeSymbol,
    side: 'buy',
    requestedQuantity: receipt.measuredSpotQuantity,
    submittedAt: receipt.entrySubmittedAt ?? receipt.openedAt,
  });
  const evidence = await applyKalshiFundingCexSpotOwnership({
    lifecycleId: receipt.lifecycleId,
    opportunityId: plan.opportunityId,
    settlement: spot,
    authority: fundingAuthority(receipt.lifecycleId),
  });
  const acquiredBase = evidence.assetDeltas[plan.kalshi.baseAsset];
  if (!acquiredBase || Number(acquiredBase) <= 0) throw new Error('KALSHI_FUNDING_SPOT_ENTRY_OWNERSHIP_UNPROVEN');
  const updated = await replaceKalshiFundingHedgeQuoteWithBase({ hold: capital.hedge, exactBaseAmount: acquiredBase });
  hedgeHolds.set(receipt.lifecycleId, updated);
  return {
    ...receipt,
    entryOwnershipConfirmed: true,
    spotEntryReservationId: null,
    baseReservationId: updated.baseReservationId,
    capitalReservationIds: [capital.margin.reservationId, updated.baseReservationId].filter((value): value is string => Boolean(value)),
  };
}

async function closePair(plan: KalshiFundingExecutionPlan, receipt: KalshiFundingOpenReceipt): Promise<{
  spotCloseOrderId: string;
  perpCloseOrderId: string;
  spotCloseSettlement: Awaited<ReturnType<typeof requireTerminalKalshiFundingCexFill>>;
  closedAt: number;
}> {
  let spotCloseOrderId = await recoverKalshiFundingCexOrder({
    venue: plan.kalshi.hedgeVenue,
    lifecycleId: receipt.lifecycleId,
    leg: 'cs-close',
    symbol: plan.kalshi.hedgeSymbol,
  });
  let perpCloseOrderId: string | null = null;
  const existingPerpClientId = kalshiFundingClientOrderId(receipt.lifecycleId, 'kp-close');
  const orderPayload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/margin/orders?subaccount=0&ticker=${encodeURIComponent(plan.kalshi.ticker)}&limit=1000`).catch(() => null);
  const existingPerp = (Array.isArray(orderPayload?.orders) ? orderPayload.orders : [])
    .find((row: any) => String(row?.client_order_id || '') === existingPerpClientId);
  if (existingPerp?.order_id) perpCloseOrderId = String(existingPerp.order_id);

  if (!spotCloseOrderId || !perpCloseOrderId) {
    const limits = await freshExitLimits(plan, receipt.kalshiContracts, receipt.measuredSpotQuantity);
    const [perpSubmit, spotSubmit] = await Promise.allSettled([
      perpCloseOrderId
        ? Promise.resolve(await getKalshiPerpOrder(perpCloseOrderId))
        : placeOrRecoverKalshiPerpOrder({
            lifecycleId: receipt.lifecycleId,
            leg: 'kp-close',
            ticker: plan.kalshi.ticker,
            side: 'bid',
            contracts: receipt.kalshiContracts,
            price: limits.kalshiBuyLimit,
            timeInForce: 'fill_or_kill',
            reduceOnly: true,
          }),
      spotCloseOrderId
        ? Promise.resolve({ orderId: spotCloseOrderId, submittedAt: Date.now() })
        : placeOrRecoverKalshiFundingCexOrder({
            venue: plan.kalshi.hedgeVenue,
            lifecycleId: receipt.lifecycleId,
            leg: 'cs-close',
            symbol: plan.kalshi.hedgeSymbol,
            side: 'sell',
            quantity: receipt.measuredSpotQuantity,
            price: limits.spotSellLimit,
            ordType: 'fok',
          }),
    ]);
    if (perpSubmit.status === 'fulfilled') perpCloseOrderId = perpSubmit.value.orderId;
    if (spotSubmit.status === 'fulfilled') spotCloseOrderId = spotSubmit.value.orderId;
  }

  let spotSettlement = spotCloseOrderId
    ? await queryKalshiFundingCexOrder({
        venue: plan.kalshi.hedgeVenue,
        orderId: spotCloseOrderId,
        symbol: plan.kalshi.hedgeSymbol,
        side: 'sell',
        requestedQuantity: receipt.measuredSpotQuantity,
        submittedAt: Date.now(),
      }).catch(() => null)
    : null;
  let perpState = perpCloseOrderId ? await getKalshiPerpOrder(perpCloseOrderId).catch(() => null) : null;

  const spotFull = Boolean(spotSettlement?.terminal && (spotSettlement.filledQuantity ?? 0) >= receipt.measuredSpotQuantity * (1 - 1e-8));
  const perpFull = Boolean(perpState?.terminal && perpState.filledContracts >= receipt.kalshiContracts * (1 - 1e-8));

  if (!spotFull) {
    const emergency = await placeOrRecoverKalshiFundingCexOrder({
      venue: plan.kalshi.hedgeVenue,
      lifecycleId: receipt.lifecycleId,
      leg: 'cs-close-emergency',
      symbol: plan.kalshi.hedgeSymbol,
      side: 'sell',
      quantity: receipt.measuredSpotQuantity,
      ordType: 'market',
    });
    spotSettlement = await requireTerminalKalshiFundingCexFill({
      venue: plan.kalshi.hedgeVenue,
      orderId: emergency.orderId,
      symbol: plan.kalshi.hedgeSymbol,
      side: 'sell',
      requestedQuantity: receipt.measuredSpotQuantity,
      submittedAt: emergency.submittedAt,
    });
    spotCloseOrderId = emergency.orderId;
  }
  if (!perpFull) {
    if (perpState && !perpState.terminal) await cancelKalshiPerpOrder(perpState.orderId).catch(() => undefined);
    perpState = await closeKalshiExposure(plan, receipt.lifecycleId, 'kp-close-emergency');
    if (!perpState) throw new Error('KALSHI_FUNDING_PERP_CLOSE_UNPROVEN');
    perpCloseOrderId = perpState.orderId;
  }

  if (!spotSettlement || !spotCloseOrderId || !perpCloseOrderId || !await requireKalshiPositionClosed(plan.kalshi.ticker)) {
    throw new Error('KALSHI_FUNDING_CLOSE_EXPOSURE_UNPROVEN');
  }
  await applyKalshiFundingCexSpotOwnership({
    lifecycleId: receipt.lifecycleId,
    opportunityId: plan.opportunityId,
    settlement: spotSettlement,
    authority: fundingAuthority(receipt.lifecycleId),
  });
  return { spotCloseOrderId, perpCloseOrderId, spotCloseSettlement: spotSettlement, closedAt: Date.now() };
}

async function terminalEconomics(input: {
  plan: KalshiFundingExecutionPlan;
  receipt: KalshiFundingOpenReceipt;
  spotCloseOrderId: string;
  perpCloseOrderId: string;
  closedAt: number;
}): Promise<FundingTerminalSettlement> {
  const { plan, receipt } = input;
  const [spotOpen, spotClose, perpOpenFills, perpCloseFills, funding] = await Promise.all([
    requireTerminalKalshiFundingCexFill({
      venue: plan.kalshi.hedgeVenue,
      orderId: receipt.spotOrderId,
      symbol: plan.kalshi.hedgeSymbol,
      side: 'buy',
      requestedQuantity: receipt.measuredSpotQuantity,
      submittedAt: receipt.entrySubmittedAt ?? receipt.openedAt,
    }),
    requireTerminalKalshiFundingCexFill({
      venue: plan.kalshi.hedgeVenue,
      orderId: input.spotCloseOrderId,
      symbol: plan.kalshi.hedgeSymbol,
      side: 'sell',
      requestedQuantity: receipt.measuredSpotQuantity,
      submittedAt: input.closedAt - 60_000,
    }),
    getKalshiPerpFillsForOrder({ ticker: plan.kalshi.ticker, orderId: receipt.perpOrderId, minObservedAt: receipt.entrySubmittedAt ?? receipt.openedAt, maxObservedAt: input.closedAt }),
    getKalshiPerpFillsForOrder({ ticker: plan.kalshi.ticker, orderId: input.perpCloseOrderId, minObservedAt: receipt.openedAt, maxObservedAt: input.closedAt }),
    getKalshiFundingPayments({ ticker: plan.kalshi.ticker, openedAt: receipt.openedAt, closedAt: input.closedAt }),
  ]);
  const spotOpenEcon = summarizeKalshiFundingCexSpotEconomics({ settlement: spotOpen, baseAsset: plan.kalshi.baseAsset, quoteAsset: plan.kalshi.quoteAsset });
  const spotCloseEcon = summarizeKalshiFundingCexSpotEconomics({ settlement: spotClose, baseAsset: plan.kalshi.baseAsset, quoteAsset: plan.kalshi.quoteAsset });
  const perpOpen = summarizeKalshiPerpFillEconomics(perpOpenFills);
  const perpClose = summarizeKalshiPerpFillEconomics(perpCloseFills);
  if (perpOpenFills.length === 0 || perpCloseFills.length === 0) {
    throw new Error('KALSHI_FUNDING_TERMINAL_PERP_FILLS_INCOMPLETE');
  }

  const fundingPaymentUsd = funding.reduce((sum, row) => sum + row.fundingAmountUsd, 0);
  if (input.closedAt >= plan.fundingTimestamp + 5_000 && funding.length === 0) {
    return {
      lifecycleId: receipt.lifecycleId,
      terminal: false,
      settlementConfirmed: false,
      spotClosed: true,
      perpClosed: true,
      spotCloseOrderId: input.spotCloseOrderId,
      perpCloseOrderId: input.perpCloseOrderId,
      fundingPaymentUsd: null,
      realizedEntryExitPnlUsd: null,
      realizedFeesUsd: null,
      realizedNetProfitUsd: null,
      settledAt: null,
      provenance: ['kalshi_both_legs_closed', 'kalshi_funding_history_pending', 'system_owned_capital_retained', 'synthetic_evidence:false'],
      error: 'KALSHI_FUNDING_HISTORY_PENDING',
    };
  }

  const spotGrossPnl = spotOpenEcon.grossQuoteCashflow + spotCloseEcon.grossQuoteCashflow;
  const perpGrossPnl = perpOpen.realizedPnlUsd + perpClose.realizedPnlUsd;
  const realizedEntryExitPnlUsd = spotGrossPnl + perpGrossPnl;
  const realizedFeesUsd = spotOpenEcon.feeCostQuote + spotCloseEcon.feeCostQuote + perpOpen.feesUsd + perpClose.feesUsd;
  const realizedNetProfitUsd = realizedEntryExitPnlUsd + fundingPaymentUsd - realizedFeesUsd;
  const kalshiMarginDeltaUsd = perpGrossPnl + fundingPaymentUsd - perpOpen.feesUsd - perpClose.feesUsd;

  await applyKalshiTerminalMarginSettlement({
    settlementReference: `kalshi-funding:${receipt.lifecycleId}`,
    lifecycleId: receipt.lifecycleId,
    opportunityId: plan.opportunityId,
    strategy: 'kalshi_cex_spot_perp_funding',
    marginDeltaUsd: decimal(kalshiMarginDeltaUsd),
    realizedStrategyProfitUsd: decimal(realizedNetProfitUsd),
    realizedFeesUsd: decimal(perpOpen.feesUsd + perpClose.feesUsd),
    realizedFundingUsd: decimal(fundingPaymentUsd),
    settlementEvidence: {
      ticker: plan.kalshi.ticker,
      hedgeVenue: plan.kalshi.hedgeVenue,
      hedgeSymbol: plan.kalshi.hedgeSymbol,
      perpEntryOrderId: receipt.perpOrderId,
      perpCloseOrderId: input.perpCloseOrderId,
      spotEntryOrderId: receipt.spotOrderId,
      spotCloseOrderId: input.spotCloseOrderId,
      perpEntryFills: perpOpenFills,
      perpCloseFills,
      fundingPayments: funding,
      accountBalanceMintsOwnership: false,
      syntheticEvidence: false,
    },
    authorityEvidence: {
      strategySelectionAuthority: 'funding_arbitrage_policy',
      notionalAuthority: 'profit_ladder',
      executionAuthority: 'funding_position_lifecycle',
      governanceAdmitted: true,
      reference: receipt.lifecycleId,
    },
  });

  await releaseCapital(plan, receipt);
  return {
    lifecycleId: receipt.lifecycleId,
    terminal: true,
    settlementConfirmed: true,
    spotClosed: true,
    perpClosed: true,
    spotCloseOrderId: input.spotCloseOrderId,
    perpCloseOrderId: input.perpCloseOrderId,
    fundingPaymentUsd,
    realizedEntryExitPnlUsd,
    realizedFeesUsd,
    realizedNetProfitUsd,
    settledAt: input.closedAt,
    provenance: [
      'kalshi_authenticated_perp_entry_exit_fills',
      'kalshi_authenticated_funding_history_or_pre_funding_zero',
      `${plan.kalshi.hedgeVenue}_authenticated_spot_entry_exit_fills`,
      'kalshi_system_owned_margin_ledger:terminal_delta_applied',
      'cex_system_owned_lot_ledger:spot_transforms_applied',
      'capital_released_only_after_terminal_accounting',
      'synthetic_evidence:false',
    ],
  };
}

const adapter = {
  venue: 'kalshi_perps',

  async verifyCurrentPlan(rawPlan: FundingExecutionPlan): Promise<boolean> {
    const plan = asKalshiPlan(rawPlan);
    if (!plan || plan.expiresAt <= Date.now() || plan.fundingTimestamp <= Date.now()) return false;
    const refreshed = await currentPlan(plan).catch(() => null);
    if (!refreshed || refreshed.expiresAt <= Date.now()) return false;
    if (!await exclusiveSystemOwnedKalshiAccount(kalshiMarginRequirementUsd(refreshed)).catch(() => false)) return false;
    Object.assign(rawPlan as any, refreshed);
    preparedPlans.set(refreshed.opportunityId, refreshed);
    return true;
  },

  async openDeltaNeutral(rawPlan: FundingExecutionPlan, lifecycleId: string): Promise<FundingOpenReceipt> {
    const plan = asKalshiPlan(rawPlan);
    if (!plan) throw new Error('KALSHI_FUNDING_PLAN_INVALID');
    const requiredMarginUsd = kalshiMarginRequirementUsd(plan);
    if (!await exclusiveSystemOwnedKalshiAccount(requiredMarginUsd)) throw new Error('KALSHI_FUNDING_SYSTEM_OWNED_MARGIN_NOT_EXCLUSIVE_OR_INSUFFICIENT');
    const expiresAt = holdUntil(plan);
    const margin = await reserveKalshiSystemMargin({ lifecycleId, opportunityId: plan.opportunityId, amountUsd: requiredMarginUsd, expiresAt });
    if (!margin) throw new Error('KALSHI_FUNDING_SYSTEM_OWNED_MARGIN_UNAVAILABLE');
    marginReservations.set(lifecycleId, margin);
    let hedge: KalshiFundingHedgeCapitalHold;
    try {
      hedge = await reserveKalshiFundingHedgeQuote({
        lifecycleId,
        opportunityId: plan.opportunityId,
        venue: plan.kalshi.hedgeVenue,
        baseAsset: plan.kalshi.baseAsset,
        quoteAsset: plan.kalshi.quoteAsset,
        quoteAmount: hedgeQuoteRequirementUsd(plan),
        holdUntil: expiresAt,
      });
      hedgeHolds.set(lifecycleId, hedge);
    } catch (error) {
      await releaseKalshiSystemMarginReservation(margin.reservationId).catch(() => undefined);
      marginReservations.delete(lifecycleId);
      throw error;
    }
    return submitEntry(plan, lifecycleId, { margin, hedge });
  },

  async recoverOpening(rawPlan: FundingExecutionPlan, lifecycleId: string): Promise<FundingOpeningRecoveryResult> {
    const plan = asKalshiPlan(rawPlan);
    if (!plan) return { status: 'failed', error: 'KALSHI_FUNDING_DURABLE_PLAN_INVALID' };
    const capital = await recoverCapital(plan, lifecycleId);
    if (!capital.margin || !capital.hedge) return { status: 'failed', error: 'KALSHI_FUNDING_DURABLE_CAPITAL_HOLD_UNAVAILABLE' };
    if (plan.fundingTimestamp <= Date.now() || plan.expiresAt <= Date.now()) {
      await closeKalshiExposure(plan, lifecycleId, 'kp-opening-expired').catch(() => undefined);
      return { status: 'failed', error: 'KALSHI_FUNDING_OPENING_WINDOW_EXPIRED' };
    }
    try {
      const receipt = await submitEntry(plan, lifecycleId, { margin: capital.margin, hedge: capital.hedge });
      return { status: 'opened', receipt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/RECOVERY_REQUIRED|unavailable|timeout|pending/i.test(message)) return { status: 'pending', error: message };
      return { status: 'failed', error: message };
    }
  },

  async reconcileOpenReceipt(rawPlan: FundingExecutionPlan, rawReceipt: FundingOpenReceipt): Promise<FundingOpenReceipt> {
    const plan = asKalshiPlan(rawPlan);
    if (!plan) throw new Error('KALSHI_FUNDING_PLAN_INVALID');
    return reconcileEntryOwnership(plan, rawReceipt as KalshiFundingOpenReceipt);
  },

  async marginHealthy(rawReceipt: FundingOpenReceipt): Promise<boolean> {
    const receipt = rawReceipt as KalshiFundingOpenReceipt;
    const plan = await durablePlan(receipt.lifecycleId);
    if (!plan) return false;
    const [capital, readiness, position] = await Promise.all([
      recoverCapital(plan, receipt.lifecycleId, receipt),
      getKalshiMarginAccountReadiness(true, true).catch(() => null),
      getKalshiPerpPosition(plan.kalshi.ticker).catch(() => null),
    ]);
    if (!capital.margin || !capital.hedge || !readiness?.authenticated || !readiness.marginEnabled || !position) return false;
    const renewed = await Promise.all([
      renewKalshiSystemMarginReservation(capital.margin, holdUntil(plan, receipt.openedAt)),
      renewKalshiFundingHedgeHold(capital.hedge),
    ]);
    if (!renewed.every(Boolean)) return false;
    const expectedContracts = receipt.kalshiContracts;
    if (!(position.contracts < 0) || Math.abs(Math.abs(position.contracts) - expectedContracts) > Math.max(1e-8, expectedContracts * 1e-6)) return false;
    const equity = finite(readiness.accountEquityUsd);
    const maintenance = finite(readiness.maintenanceMarginUsd);
    if (equity === null || maintenance === null || equity <= Math.max(0, maintenance) * 1.20) return false;
    return true;
  },

  async closeAndSettle(rawPlan: FundingExecutionPlan, rawReceipt: FundingOpenReceipt): Promise<FundingTerminalSettlement> {
    const plan = asKalshiPlan(rawPlan);
    const receipt = rawReceipt as KalshiFundingOpenReceipt;
    if (!plan) throw new Error('KALSHI_FUNDING_PLAN_INVALID');
    const closed = await closePair(plan, receipt);
    return terminalEconomics({ plan, receipt, spotCloseOrderId: closed.spotCloseOrderId, perpCloseOrderId: closed.perpCloseOrderId, closedAt: closed.closedAt });
  },

  async reconcileSettlement(rawPlan: FundingExecutionPlan, rawReceipt: FundingOpenReceipt, prior: FundingTerminalSettlement): Promise<FundingTerminalSettlement> {
    const plan = asKalshiPlan(rawPlan);
    const receipt = rawReceipt as KalshiFundingOpenReceipt;
    if (!plan || !prior.spotCloseOrderId || !prior.perpCloseOrderId || !prior.spotClosed || !prior.perpClosed) {
      throw new Error('KALSHI_FUNDING_RECONCILIATION_IDENTITY_INCOMPLETE');
    }
    return terminalEconomics({
      plan,
      receipt,
      spotCloseOrderId: prior.spotCloseOrderId,
      perpCloseOrderId: prior.perpCloseOrderId,
      closedAt: prior.settledAt ?? Date.now(),
    });
  },
} as unknown as FundingLifecycleAdapter;

export function rememberPreparedKalshiFundingPlan(plan: KalshiFundingExecutionPlan): void {
  if (plan.expiresAt <= Date.now()) return;
  preparedPlans.set(plan.opportunityId, plan);
  for (const [id, candidate] of preparedPlans.entries()) if (candidate.expiresAt <= Date.now()) preparedPlans.delete(id);
}

export function getPreparedKalshiFundingPlan(opportunityId: string): KalshiFundingExecutionPlan | null {
  const plan = preparedPlans.get(opportunityId) ?? null;
  if (!plan || plan.expiresAt <= Date.now()) {
    preparedPlans.delete(opportunityId);
    return null;
  }
  return plan;
}

export function ensureKalshiFundingLifecycleAdapterRegistered(): void {
  if (registered) return;
  fundingPositionLifecycle.registerAdapter(adapter);
  registered = true;
  logger.info('[KalshiFunding] Durable Kalshi spot-perp funding lifecycle adapter registered', {
    component: 'KalshiFundingLifecycleAdapter',
    venue: 'kalshi_perps',
    deterministicOrderRecovery: true,
    fillOrKillEntryAndClose: true,
    emergencyNeutralization: true,
    systemOwnedKalshiMarginRequired: true,
    systemOwnedCexHedgeRequired: true,
    accountBalanceCreatesOwnership: false,
    terminalFundingAndFeeEvidenceRequired: true,
    projectedFundingIsDeterministicProfit: false,
  });
}