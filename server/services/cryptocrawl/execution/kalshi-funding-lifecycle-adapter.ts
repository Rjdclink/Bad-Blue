import logger from '../../../logger.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';
import {
  getKalshiMarginAccountReadiness,
  getKalshiPerpExecutionEvidence,
  type KalshiOrderbookLevel,
} from '../intelligence/kalshi-perps-market-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import {
  hydrateKalshiFundingCapitalReadiness,
  kalshiFundingEvidenceProjectedNetUsd,
  measureKalshiFundingExecutionEvidence,
  type KalshiFundingDirection,
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
  getKalshiPerpPosition,
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
import { getExactSystemCapitalOrderAssetDeltas } from './cex-system-capital-settlement-evidence.js';
import {
  applyVerifiedOkxMarginShortSettlement,
  type CexSystemCapitalSettlementAuthority,
} from './cex-system-owned-lot-ledger.js';
import {
  assessOkxMarginShortHealth,
  getOkxBaseLiability,
  proveOkxMarginShortBorrow,
  proveOkxMarginShortRepaid,
  proveOkxMarginShortSystemOwnedCollateral,
  recoverOkxMarginShortResidualRepayment,
} from './okx-margin-short-authority.js';
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
    direction?: KalshiFundingDirection;
    hedgeVenue: KalshiFundingHedgeVenue;
    hedgeSymbol: string;
    contracts: number;
    contractSize: number;
    baseQuantity: number;
    fundingRate: number;
    borrowCostUsd?: number;
    shortSpotCapability?: boolean;
    evidenceMeasuredAt: number;
    evidenceExpiresAt: number;
    kalshiTakerFeeBps: number;
    hedgeTakerFeeBps: number;
    entry: {
      kalshiEntryLimit: number;
      spotEntryLimit: number;
    };
    exitReference?: {
      spotLimit: number;
    };
  };
};

type KalshiFundingOpenReceipt = FundingOpenReceipt & {
  hedgeVenue: KalshiFundingHedgeVenue;
  kalshiContracts: number;
  contractSize: number;
  direction?: KalshiFundingDirection;
  borrowedBase?: number;
  borrowObservedAt?: number;
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

function planDirection(plan: KalshiFundingExecutionPlan): KalshiFundingDirection {
  if (plan.kalshi.direction === 'long_perp_short_spot' || plan.kalshi.direction === 'long_spot_short_perp') return plan.kalshi.direction;
  return plan.kalshi.fundingRate < 0 ? 'long_perp_short_spot' : 'long_spot_short_perp';
}

function inversePlan(plan: KalshiFundingExecutionPlan): boolean {
  return planDirection(plan) === 'long_perp_short_spot';
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
  const feesAndExit = Math.max(0, plan.expectedEntryCostUsd) + Math.max(0, plan.expectedExitCostUsd);
  const cushion = Math.max(1, plan.notionalUsd * 0.01);
  return plan.notionalUsd + feesAndExit + cushion;
}

function inverseHedgeBufferFraction(): number {
  const raw = Number(process.env.CRYPTOCRAWL_OKX_MARGIN_SHORT_COLLATERAL_BUFFER_FRACTION || 0.25);
  return Math.max(0.05, Math.min(0.50, Number.isFinite(raw) ? raw : 0.25));
}

function hedgeQuoteRequirementUsd(plan: KalshiFundingExecutionPlan): number {
  const entry = plan.kalshi.entry.spotEntryLimit;
  if (inversePlan(plan)) {
    const exitReference = plan.kalshi.exitReference?.spotLimit ?? entry;
    const raw = Math.max(entry, exitReference) * plan.kalshi.baseQuantity;
    return raw * (1 + plan.kalshi.hedgeTakerFeeBps / 10_000 + inverseHedgeBufferFraction())
      + Math.max(0, plan.kalshi.borrowCostUsd ?? 0);
  }
  const raw = entry * plan.kalshi.baseQuantity;
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
  const unexplained = Math.max(0, equity - snapshot.ownedUsd);
  const tolerance = Math.max(0.01, equity * 1e-6);
  if (unexplained > tolerance) return false;
  const activeOrders = (Array.isArray(orders?.orders) ? orders.orders : [])
    .filter((row: any) => Number(row?.remaining_count || 0) > 0);
  return activeOrders.length === 0;
}

async function exclusiveSystemOwnedInverseCollateral(plan: KalshiFundingExecutionPlan): Promise<boolean> {
  if (!inversePlan(plan)) return true;
  if (plan.kalshi.hedgeVenue !== 'okx') return false;
  const proof = await proveOkxMarginShortSystemOwnedCollateral({
    quoteAsset: plan.kalshi.quoteAsset,
    requiredQuoteAmount: hedgeQuoteRequirementUsd(plan),
  }).catch(() => null);
  return proof?.exclusiveSystemOwnedCollateral === true;
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

async function freshSpotCloseLimit(plan: KalshiFundingExecutionPlan, baseQuantity: number): Promise<number> {
  const maxAgeMs = Math.max(500, Math.min(10_000, Number(process.env.CRYPTOCRAWL_KALSHI_FUNDING_EVIDENCE_TTL_MS || 3_000)));
  const spot = await cexOrderBookStreams.getQuote(plan.kalshi.hedgeVenue, plan.kalshi.hedgeSymbol, maxAgeMs);
  if (!spot) throw new Error('KALSHI_FUNDING_EXIT_DEPTH_UNAVAILABLE');
  const levels = inversePlan(plan) ? spot.depth.asks : spot.depth.bids;
  const limit = walk(levels, baseQuantity);
  if (!(limit && limit > 0)) throw new Error('KALSHI_FUNDING_EXIT_DEPTH_INSUFFICIENT');
  return limit;
}

async function currentPlan(plan: KalshiFundingExecutionPlan): Promise<KalshiFundingExecutionPlan | null> {
  const evidence = await measureKalshiFundingExecutionEvidence({
    ticker: plan.kalshi.ticker,
    targetNotionalUsd: plan.notionalUsd,
  });
  if (!evidence || evidence.hedgeVenue !== plan.kalshi.hedgeVenue || evidence.hedgeSymbol !== plan.kalshi.hedgeSymbol) return null;
  if (evidence.direction !== planDirection(plan)) return null;
  const hydrated = await hydrateKalshiFundingCapitalReadiness(evidence).catch(() => null);
  if (!hydrated || hydrated.expiresAt <= Date.now()) return null;
  const projected = kalshiFundingEvidenceProjectedNetUsd(hydrated);
  if (!(projected > 0) || hydrated.fundingRate === 0) return null;
  if (hydrated.direction === 'long_perp_short_spot' && (hydrated.hedgeVenue !== 'okx' || hydrated.shortSpotCapability !== true)) return null;
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
    expectedExitCostUsd: fees / 2 + basisAndSlip / 2 + Math.max(0, hydrated.borrowCostUsd),
    expectedFundingUsd: hydrated.measuredNotionalUsd * Math.abs(hydrated.fundingRate),
    fundingTimestamp: hydrated.nextFundingTime,
    expiresAt: Math.min(plan.expiresAt, hydrated.expiresAt, hydrated.nextFundingTime - 1),
    provenance: [...plan.provenance, ...hydrated.provenance, 'kalshi_funding_plan:live_reverified'],
    kalshi: {
      ticker: hydrated.ticker,
      baseAsset: hydrated.baseAsset,
      quoteAsset: hydrated.quoteAsset,
      direction: hydrated.direction,
      hedgeVenue: hydrated.hedgeVenue,
      hedgeSymbol: hydrated.hedgeSymbol,
      contracts: hydrated.contracts,
      contractSize: hydrated.contractSize,
      baseQuantity: hydrated.baseQuantity,
      fundingRate: hydrated.fundingRate,
      borrowCostUsd: hydrated.borrowCostUsd,
      shortSpotCapability: hydrated.shortSpotCapability,
      evidenceMeasuredAt: hydrated.measuredAt,
      evidenceExpiresAt: hydrated.expiresAt,
      kalshiTakerFeeBps: hydrated.kalshiTakerFeeBps,
      hedgeTakerFeeBps: hydrated.hedgeTakerFeeBps,
      entry: {
        kalshiEntryLimit: hydrated.kalshiEntryLimit,
        spotEntryLimit: hydrated.spotEntryLimit,
      },
      exitReference: { spotLimit: hydrated.spotExitLimit },
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

async function applyInversePairAccounting(input: {
  plan: KalshiFundingExecutionPlan;
  lifecycleId: string;
  spotEntrySettlement: Awaited<ReturnType<typeof requireTerminalKalshiFundingCexFill>>;
  spotCloseSettlement: Awaited<ReturnType<typeof requireTerminalKalshiFundingCexFill>>;
  terminalLiabilityBase: number;
}): Promise<void> {
  const [entryEvidence, closeEvidence] = await Promise.all([
    getExactSystemCapitalOrderAssetDeltas(input.spotEntrySettlement),
    getExactSystemCapitalOrderAssetDeltas(input.spotCloseSettlement),
  ]);
  await applyVerifiedOkxMarginShortSettlement({
    lifecycleId: input.lifecycleId,
    opportunityId: input.plan.opportunityId,
    entryEvidence,
    closeEvidence,
    terminalLiabilityBase: input.terminalLiabilityBase,
    expectedPrincipalBase: input.plan.kalshi.baseQuantity,
    authority: fundingAuthority(input.lifecycleId),
  });
}

async function neutralizeSpotEntry(input: {
  plan: KalshiFundingExecutionPlan;
  lifecycleId: string;
  settlement: Awaited<ReturnType<typeof queryKalshiFundingCexOrder>>;
  submittedAt: number;
  hold: KalshiFundingHedgeCapitalHold;
}): Promise<KalshiFundingHedgeCapitalHold> {
  const { plan, lifecycleId, settlement } = input;
  const filled = Number(settlement.filledQuantity || 0);
  if (!(filled > 0)) return input.hold;
  if (inversePlan(plan)) {
    if (plan.kalshi.hedgeVenue !== 'okx') throw new Error('KALSHI_FUNDING_INVERSE_HEDGE_VENUE_INVALID');
    const liability = await getOkxBaseLiability(plan.kalshi.baseAsset);
    const closeQuantity = Math.max(filled, liability.liabilityBase);
    const close = await placeOrRecoverKalshiFundingCexOrder({
      venue: 'okx', lifecycleId, leg: 'cs-entry-emergency', symbol: plan.kalshi.hedgeSymbol,
      side: 'buy', quantity: closeQuantity, ordType: 'market', tradeMode: 'cross',
    });
    const closeSettlement = await requireTerminalKalshiFundingCexFill({
      venue: 'okx', orderId: close.orderId, symbol: plan.kalshi.hedgeSymbol,
      side: 'buy', requestedQuantity: closeQuantity, submittedAt: close.submittedAt,
    });
    const repayment = await recoverOkxMarginShortResidualRepayment({
      baseAsset: plan.kalshi.baseAsset,
      expectedPrincipalBase: filled,
      maximumRepayableBase: Number(closeSettlement.filledQuantity || 0),
    });
    const repaid = await proveOkxMarginShortRepaid({
      baseAsset: plan.kalshi.baseAsset,
      expectedRepayBase: filled,
      closeSubmittedAt: input.submittedAt,
    });
    await applyInversePairAccounting({
      plan,
      lifecycleId,
      spotEntrySettlement: settlement,
      spotCloseSettlement: closeSettlement,
      terminalLiabilityBase: Math.max(repayment.liabilityBase, repaid.liabilityBase),
    });
    return input.hold;
  }

  const entryEvidence = await applyKalshiFundingCexSpotOwnership({
    lifecycleId,
    opportunityId: plan.opportunityId,
    settlement,
    authority: fundingAuthority(lifecycleId),
  });
  const acquired = entryEvidence.assetDeltas[plan.kalshi.baseAsset];
  if (!acquired || Number(acquired) <= 0) throw new Error('KALSHI_FUNDING_ORPHAN_SPOT_BASE_OWNERSHIP_UNPROVEN');
  const liveHedge = await replaceKalshiFundingHedgeQuoteWithBase({ hold: input.hold, exactBaseAmount: acquired });
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
  return liveHedge;
}

async function submitEntry(plan: KalshiFundingExecutionPlan, lifecycleId: string, capital: {
  margin: KalshiSystemMarginReservation;
  hedge: KalshiFundingHedgeCapitalHold;
}): Promise<KalshiFundingOpenReceipt> {
  const inverse = inversePlan(plan);
  if (inverse && (plan.kalshi.hedgeVenue !== 'okx' || plan.kalshi.shortSpotCapability !== true)) {
    throw new Error('KALSHI_FUNDING_INVERSE_SHORT_SPOT_CAPABILITY_UNPROVEN');
  }
  const perpSide: 'bid' | 'ask' = inverse ? 'bid' : 'ask';
  const spotSide: 'buy' | 'sell' = inverse ? 'sell' : 'buy';
  const submittedAt = Date.now();
  const [perpSubmitted, spotSubmitted] = await Promise.allSettled([
    placeOrRecoverKalshiPerpOrder({
      lifecycleId,
      leg: 'kp-entry',
      ticker: plan.kalshi.ticker,
      side: perpSide,
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
      side: spotSide,
      quantity: plan.kalshi.baseQuantity,
      price: plan.kalshi.entry.spotEntryLimit,
      ordType: 'fok',
      ...(inverse ? { tradeMode: 'cross' as const } : {}),
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
          side: spotSide,
          requestedQuantity: plan.kalshi.baseQuantity,
          submittedAt: spotOrder.submittedAt,
        })
      : Promise.reject(spotSubmitted.status === 'rejected' ? spotSubmitted.reason : new Error('CEX spot entry not submitted')),
  ]);

  if (perpTerminal.status !== 'fulfilled' || spotTerminal.status !== 'fulfilled') {
    let spotEntrySettlement = spotTerminal.status === 'fulfilled' ? spotTerminal.value : null;
    if (!spotEntrySettlement && spotOrder) {
      spotEntrySettlement = await queryKalshiFundingCexOrder({
        venue: plan.kalshi.hedgeVenue,
        orderId: spotOrder.orderId,
        symbol: plan.kalshi.hedgeSymbol,
        side: spotSide,
        requestedQuantity: plan.kalshi.baseQuantity,
        submittedAt: spotOrder.submittedAt,
      }).catch(() => null);
    }
    try {
      let liveHedge = capital.hedge;
      if (spotEntrySettlement && (spotEntrySettlement.filledQuantity ?? 0) > 0) {
        liveHedge = await neutralizeSpotEntry({
          plan, lifecycleId, settlement: spotEntrySettlement, submittedAt, hold: liveHedge,
        });
      }
      await closeKalshiExposure(plan, lifecycleId, 'kp-entry-emergency');
      if (inverse) {
        const liability = await getOkxBaseLiability(plan.kalshi.baseAsset);
        if (liability.liabilityBase > Math.max(1e-10, plan.kalshi.baseQuantity * 1e-6)) {
          throw new Error('KALSHI_FUNDING_ENTRY_RECOVERY_RESIDUAL_LIABILITY');
        }
      }
      await releaseKalshiFundingHedgeHold(liveHedge);
      await releaseKalshiSystemMarginReservation(capital.margin.reservationId);
      hedgeHolds.delete(lifecycleId);
      marginReservations.delete(lifecycleId);
      throw new Error('KALSHI_FUNDING_ENTRY_LEG_MISMATCH_NEUTRALIZED');
    } catch (error) {
      if (error instanceof Error && error.message === 'KALSHI_FUNDING_ENTRY_LEG_MISMATCH_NEUTRALIZED') throw error;
      logger.error('[KalshiFunding] Entry mismatch recovery failed; durable capital remains held', {
        component: 'KalshiFundingLifecycleAdapter', lifecycleId, opportunityId: plan.opportunityId,
        direction: planDirection(plan),
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

  let borrowProof: Awaited<ReturnType<typeof proveOkxMarginShortBorrow>> | null = null;
  if (inverse) {
    borrowProof = await proveOkxMarginShortBorrow({
      baseAsset: plan.kalshi.baseAsset,
      expectedBorrowBase: measuredSpotBase,
      submittedAt: spotOrder!.submittedAt,
    }).catch(() => null);
  }

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
    entryOwnershipConfirmed: inverse ? borrowProof !== null : false,
    marginReservationId: capital.margin.reservationId,
    spotEntryReservationId: capital.hedge.quoteReservationId,
    baseReservationId: capital.hedge.baseReservationId,
    capitalReservationIds: [capital.margin.reservationId, capital.hedge.quoteReservationId].filter((value): value is string => Boolean(value)),
    hedgeVenue: plan.kalshi.hedgeVenue,
    kalshiContracts: plan.kalshi.contracts,
    contractSize: plan.kalshi.contractSize,
    direction: planDirection(plan),
    borrowedBase: borrowProof?.borrowedBase,
    borrowObservedAt: borrowProof?.observedAt,
  };
}

async function reconcileEntryOwnership(plan: KalshiFundingExecutionPlan, receipt: KalshiFundingOpenReceipt): Promise<KalshiFundingOpenReceipt> {
  if (receipt.entryOwnershipConfirmed === true) return receipt;
  const capital = await recoverCapital(plan, receipt.lifecycleId, receipt);
  if (!capital.margin || !capital.hedge) throw new Error('KALSHI_FUNDING_DURABLE_CAPITAL_HOLD_UNAVAILABLE');
  const inverse = inversePlan(plan);
  const spotSide: 'buy' | 'sell' = inverse ? 'sell' : 'buy';
  const spot = await requireTerminalKalshiFundingCexFill({
    venue: plan.kalshi.hedgeVenue,
    orderId: receipt.spotOrderId,
    symbol: plan.kalshi.hedgeSymbol,
    side: spotSide,
    requestedQuantity: receipt.measuredSpotQuantity,
    submittedAt: receipt.entrySubmittedAt ?? receipt.openedAt,
  });

  if (inverse) {
    if (plan.kalshi.hedgeVenue !== 'okx') throw new Error('KALSHI_FUNDING_INVERSE_HEDGE_VENUE_INVALID');
    const proof = await proveOkxMarginShortBorrow({
      baseAsset: plan.kalshi.baseAsset,
      expectedBorrowBase: receipt.measuredSpotQuantity,
      submittedAt: receipt.entrySubmittedAt ?? receipt.openedAt,
    });
    return {
      ...receipt,
      entryOwnershipConfirmed: true,
      direction: 'long_perp_short_spot',
      borrowedBase: proof.borrowedBase,
      borrowObservedAt: proof.observedAt,
      capitalReservationIds: [capital.margin.reservationId, capital.hedge.quoteReservationId].filter((value): value is string => Boolean(value)),
    };
  }

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
    direction: 'long_spot_short_perp',
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
  const inverse = inversePlan(plan);
  const spotCloseSide: 'buy' | 'sell' = inverse ? 'buy' : 'sell';
  const perpCloseSide: 'bid' | 'ask' = inverse ? 'ask' : 'bid';
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

  let spotRequestedQuantity = receipt.measuredSpotQuantity;
  if (!spotCloseOrderId && inverse) {
    const health = await assessOkxMarginShortHealth({
      baseAsset: plan.kalshi.baseAsset,
      expectedPrincipalBase: receipt.measuredSpotQuantity,
    });
    if (!health.healthy) throw new Error('KALSHI_FUNDING_INVERSE_MARGIN_HEALTH_UNPROVEN');
    spotRequestedQuantity = health.liabilityBase;
    if (!(spotRequestedQuantity > Math.max(1e-10, receipt.measuredSpotQuantity * 1e-6))) {
      throw new Error('KALSHI_FUNDING_INVERSE_LIABILITY_DISAPPEARED_BEFORE_CLOSE');
    }
  }

  if (!perpCloseOrderId) {
    const price = await kalshiCloseLimit(plan.kalshi.ticker, perpCloseSide, receipt.kalshiContracts);
    const state = await placeOrRecoverKalshiPerpOrder({
      lifecycleId: receipt.lifecycleId,
      leg: 'kp-close',
      ticker: plan.kalshi.ticker,
      side: perpCloseSide,
      contracts: receipt.kalshiContracts,
      price,
      timeInForce: 'fill_or_kill',
      reduceOnly: true,
    });
    perpCloseOrderId = state.orderId;
  }

  if (!spotCloseOrderId) {
    const price = await freshSpotCloseLimit(plan, spotRequestedQuantity);
    const order = await placeOrRecoverKalshiFundingCexOrder({
      venue: plan.kalshi.hedgeVenue,
      lifecycleId: receipt.lifecycleId,
      leg: 'cs-close',
      symbol: plan.kalshi.hedgeSymbol,
      side: spotCloseSide,
      quantity: spotRequestedQuantity,
      price,
      ordType: 'fok',
      ...(inverse ? { tradeMode: 'cross' as const } : {}),
    });
    spotCloseOrderId = order.orderId;
  }

  let spotSettlement = await queryKalshiFundingCexOrder({
    venue: plan.kalshi.hedgeVenue,
    orderId: spotCloseOrderId,
    symbol: plan.kalshi.hedgeSymbol,
    side: spotCloseSide,
    requestedQuantity: receipt.measuredSpotQuantity,
    submittedAt: receipt.openedAt,
  }).catch(() => null);
  let perpState = await getKalshiPerpOrder(perpCloseOrderId).catch(() => null);

  const spotFilled = Number(spotSettlement?.filledQuantity || 0);
  const spotFull = Boolean(spotSettlement?.terminal && spotFilled >= receipt.measuredSpotQuantity * (1 - 1e-8));
  const perpFull = Boolean(perpState?.terminal && perpState.filledContracts >= receipt.kalshiContracts * (1 - 1e-8));

  if (!spotFull) {
    if (spotFilled > Math.max(1e-10, receipt.measuredSpotQuantity * 1e-8)) {
      throw new Error('KALSHI_FUNDING_CEX_FOK_PARTIAL_FILL_QUARANTINE');
    }
    let emergencyQuantity = receipt.measuredSpotQuantity;
    if (inverse) {
      const liability = await getOkxBaseLiability(plan.kalshi.baseAsset);
      emergencyQuantity = liability.liabilityBase;
      if (!(emergencyQuantity > Math.max(1e-10, receipt.measuredSpotQuantity * 1e-6))) {
        throw new Error('KALSHI_FUNDING_INVERSE_CLOSE_LIABILITY_IDENTITY_UNPROVEN');
      }
    }
    const emergency = await placeOrRecoverKalshiFundingCexOrder({
      venue: plan.kalshi.hedgeVenue,
      lifecycleId: receipt.lifecycleId,
      leg: 'cs-close-emergency',
      symbol: plan.kalshi.hedgeSymbol,
      side: spotCloseSide,
      quantity: emergencyQuantity,
      ordType: 'market',
      ...(inverse ? { tradeMode: 'cross' as const } : {}),
    });
    spotSettlement = await requireTerminalKalshiFundingCexFill({
      venue: plan.kalshi.hedgeVenue,
      orderId: emergency.orderId,
      symbol: plan.kalshi.hedgeSymbol,
      side: spotCloseSide,
      requestedQuantity: emergencyQuantity,
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

  if (inverse) {
    const repayment = await recoverOkxMarginShortResidualRepayment({
      baseAsset: plan.kalshi.baseAsset,
      expectedPrincipalBase: receipt.measuredSpotQuantity,
      maximumRepayableBase: Number(spotSettlement.filledQuantity || 0),
    });
    const repaid = await proveOkxMarginShortRepaid({
      baseAsset: plan.kalshi.baseAsset,
      expectedRepayBase: receipt.measuredSpotQuantity,
      closeSubmittedAt: receipt.openedAt,
    });
    if (Math.max(repayment.liabilityBase, repaid.liabilityBase) > Math.max(1e-10, receipt.measuredSpotQuantity * 1e-6)) {
      throw new Error('KALSHI_FUNDING_INVERSE_TERMINAL_LIABILITY_NONZERO');
    }
  } else {
    await applyKalshiFundingCexSpotOwnership({
      lifecycleId: receipt.lifecycleId,
      opportunityId: plan.opportunityId,
      settlement: spotSettlement,
      authority: fundingAuthority(receipt.lifecycleId),
    });
  }
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
  const inverse = inversePlan(plan);
  const spotEntrySide: 'buy' | 'sell' = inverse ? 'sell' : 'buy';
  const spotCloseSide: 'buy' | 'sell' = inverse ? 'buy' : 'sell';
  const [spotOpen, spotClose, perpOpenFills, perpCloseFills, funding] = await Promise.all([
    requireTerminalKalshiFundingCexFill({
      venue: plan.kalshi.hedgeVenue,
      orderId: receipt.spotOrderId,
      symbol: plan.kalshi.hedgeSymbol,
      side: spotEntrySide,
      requestedQuantity: receipt.measuredSpotQuantity,
      submittedAt: receipt.entrySubmittedAt ?? receipt.openedAt,
    }),
    requireTerminalKalshiFundingCexFill({
      venue: plan.kalshi.hedgeVenue,
      orderId: input.spotCloseOrderId,
      symbol: plan.kalshi.hedgeSymbol,
      side: spotCloseSide,
      requestedQuantity: receipt.measuredSpotQuantity,
      submittedAt: receipt.openedAt,
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
      provenance: [
        'kalshi_both_legs_closed',
        ...(inverse ? ['okx_margin_short_closed_repayment_recheck_required'] : []),
        'kalshi_funding_history_pending',
        'system_owned_capital_retained',
        'synthetic_evidence:false',
      ],
      error: 'KALSHI_FUNDING_HISTORY_PENDING',
    };
  }

  const spotGrossPnl = spotOpenEcon.grossQuoteCashflow + spotCloseEcon.grossQuoteCashflow;
  const perpGrossPnl = perpOpen.realizedPnlUsd + perpClose.realizedPnlUsd;
  const realizedEntryExitPnlUsd = spotGrossPnl + perpGrossPnl;
  const realizedFeesUsd = spotOpenEcon.feeCostQuote + spotCloseEcon.feeCostQuote + perpOpen.feesUsd + perpClose.feesUsd;
  const realizedNetProfitUsd = realizedEntryExitPnlUsd + fundingPaymentUsd - realizedFeesUsd;
  const kalshiMarginDeltaUsd = perpGrossPnl + fundingPaymentUsd - perpOpen.feesUsd - perpClose.feesUsd;

  let terminalLiabilityBase = 0;
  if (inverse) {
    const liability = await getOkxBaseLiability(plan.kalshi.baseAsset);
    terminalLiabilityBase = liability.liabilityBase;
    if (terminalLiabilityBase > Math.max(1e-10, receipt.measuredSpotQuantity * 1e-6)) {
      return {
        lifecycleId: receipt.lifecycleId,
        terminal: false,
        settlementConfirmed: false,
        spotClosed: false,
        perpClosed: true,
        spotCloseOrderId: input.spotCloseOrderId,
        perpCloseOrderId: input.perpCloseOrderId,
        fundingPaymentUsd,
        realizedEntryExitPnlUsd: null,
        realizedFeesUsd: null,
        realizedNetProfitUsd: null,
        settledAt: null,
        provenance: ['okx_margin_short_liability_nonzero', 'system_owned_capital_retained', 'synthetic_evidence:false'],
        error: 'KALSHI_FUNDING_INVERSE_TERMINAL_LIABILITY_NONZERO',
      };
    }
    await applyInversePairAccounting({
      plan,
      lifecycleId: receipt.lifecycleId,
      spotEntrySettlement: spotOpen,
      spotCloseSettlement: spotClose,
      terminalLiabilityBase,
    });
  }

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
      direction: planDirection(plan),
      hedgeVenue: plan.kalshi.hedgeVenue,
      hedgeSymbol: plan.kalshi.hedgeSymbol,
      perpEntryOrderId: receipt.perpOrderId,
      perpCloseOrderId: input.perpCloseOrderId,
      spotEntryOrderId: receipt.spotOrderId,
      spotCloseOrderId: input.spotCloseOrderId,
      perpEntryFills: perpOpenFills,
      perpCloseFills,
      fundingPayments: funding,
      terminalLiabilityBase,
      borrowedBaseOwnership: false,
      shortSaleProceedsOwnershipBeforeRepayment: false,
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
      ...(inverse ? [
        'okx_authenticated_borrow_and_repayment_history',
        'okx_terminal_base_liability_zero',
        'okx_margin_short_pair:net_quote_ownership_applied_only_after_repayment',
        'borrowed_base_and_short_proceeds:never_system_owned_while_encumbered',
      ] : ['cex_system_owned_lot_ledger:spot_transforms_applied']),
      'kalshi_system_owned_margin_ledger:terminal_delta_applied',
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
    if (!await exclusiveSystemOwnedInverseCollateral(refreshed).catch(() => false)) return false;
    Object.assign(rawPlan as any, refreshed);
    preparedPlans.set(refreshed.opportunityId, refreshed);
    return true;
  },

  async openDeltaNeutral(rawPlan: FundingExecutionPlan, lifecycleId: string): Promise<FundingOpenReceipt> {
    const plan = asKalshiPlan(rawPlan);
    if (!plan) throw new Error('KALSHI_FUNDING_PLAN_INVALID');
    if (inversePlan(plan) && (plan.kalshi.hedgeVenue !== 'okx' || plan.kalshi.shortSpotCapability !== true)) {
      throw new Error('KALSHI_FUNDING_INVERSE_SHORT_SPOT_CAPABILITY_UNPROVEN');
    }
    const requiredMarginUsd = kalshiMarginRequirementUsd(plan);
    if (!await exclusiveSystemOwnedKalshiAccount(requiredMarginUsd)) throw new Error('KALSHI_FUNDING_SYSTEM_OWNED_MARGIN_NOT_EXCLUSIVE_OR_INSUFFICIENT');
    if (!await exclusiveSystemOwnedInverseCollateral(plan)) throw new Error('KALSHI_FUNDING_OKX_SYSTEM_OWNED_COLLATERAL_NOT_EXCLUSIVE_OR_INSUFFICIENT');
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
      try {
        const side: 'buy' | 'sell' = inversePlan(plan) ? 'sell' : 'buy';
        const spotOrderId = await recoverKalshiFundingCexOrder({
          venue: plan.kalshi.hedgeVenue, lifecycleId, leg: 'cs-entry', symbol: plan.kalshi.hedgeSymbol,
        });
        let liveHedge = capital.hedge;
        if (spotOrderId) {
          const settlement = await queryKalshiFundingCexOrder({
            venue: plan.kalshi.hedgeVenue, orderId: spotOrderId, symbol: plan.kalshi.hedgeSymbol,
            side, requestedQuantity: plan.kalshi.baseQuantity, submittedAt: Date.now() - 24 * 60 * 60_000,
          });
          if ((settlement.filledQuantity ?? 0) > 0) {
            liveHedge = await neutralizeSpotEntry({ plan, lifecycleId, settlement, submittedAt: Date.now() - 24 * 60 * 60_000, hold: liveHedge });
          }
        }
        await closeKalshiExposure(plan, lifecycleId, 'kp-opening-expired');
        if (inversePlan(plan)) {
          const liability = await getOkxBaseLiability(plan.kalshi.baseAsset);
          if (liability.liabilityBase > Math.max(1e-10, plan.kalshi.baseQuantity * 1e-6)) throw new Error('KALSHI_FUNDING_OPENING_EXPIRED_RESIDUAL_LIABILITY');
        }
        await releaseKalshiFundingHedgeHold(liveHedge);
        await releaseKalshiSystemMarginReservation(capital.margin.reservationId);
        hedgeHolds.delete(lifecycleId);
        marginReservations.delete(lifecycleId);
        return { status: 'failed', error: 'KALSHI_FUNDING_OPENING_WINDOW_EXPIRED_NEUTRALIZED' };
      } catch (error) {
        return { status: 'pending', error: `KALSHI_FUNDING_OPENING_EXPIRED_RECOVERY_REQUIRED:${error instanceof Error ? error.message : String(error)}` };
      }
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
    const inverse = inversePlan(plan);
    const signCorrect = inverse ? position.contracts > 0 : position.contracts < 0;
    if (!signCorrect || Math.abs(Math.abs(position.contracts) - expectedContracts) > Math.max(1e-8, expectedContracts * 1e-6)) return false;
    const equity = finite(readiness.accountEquityUsd);
    const maintenance = finite(readiness.maintenanceMarginUsd);
    if (equity === null || maintenance === null || equity <= Math.max(0, maintenance) * 1.20) return false;
    if (inverse) {
      const health = await assessOkxMarginShortHealth({
        baseAsset: plan.kalshi.baseAsset,
        expectedPrincipalBase: receipt.measuredSpotQuantity,
      }).catch(() => null);
      if (!health?.healthy) return false;
    }
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
  logger.info('[KalshiFunding] Durable bidirectional Kalshi spot-perp funding lifecycle adapter registered', {
    component: 'KalshiFundingLifecycleAdapter',
    venue: 'kalshi_perps',
    supportedDirections: ['long_spot_short_perp', 'long_perp_short_spot'],
    negativeFundingInverseHedgeVenue: 'okx_authenticated_spot_borrow_only',
    deterministicOrderRecovery: true,
    fillOrKillEntryAndClose: true,
    emergencyNeutralization: true,
    systemOwnedKalshiMarginRequired: true,
    systemOwnedCexHedgeRequired: true,
    borrowedBaseCreatesOwnership: false,
    shortSaleProceedsCreateOwnershipBeforeRepayment: false,
    terminalZeroLiabilityRequired: true,
    accountBalanceCreatesOwnership: false,
    terminalFundingAndFeeEvidenceRequired: true,
    projectedFundingIsDeterministicProfit: false,
  });
}