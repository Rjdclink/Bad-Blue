import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { getOkxExecutionRestBaseUrl, OkxPrivateApiError, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { pool } from '../runtime/cryptocrawl-runtime-database.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getExactOkxOrderAssetDeltas, type ExactCexOrderAssetDeltaEvidence } from './cex-system-capital-settlement-evidence.js';
import { applyExactCexSystemOwnedSettlement } from './cex-system-owned-lot-ledger.js';
import { addExactDecimals } from './exact-decimal.js';
import {
  recoverFundingCapitalHold,
  reserveFundingEntryCapital,
  replaceSpotEntryReservationWithBaseHold,
  renewFundingCapitalHold,
  releaseFundingCapitalHold,
  type FundingCapitalHold,
} from './funding-capital-reservation.js';
import {
  fundingPositionLifecycle,
  type FundingExecutionPlan,
  type FundingLifecycleAdapter,
  type FundingOpenReceipt,
  type FundingOpeningRecoveryResult,
  type FundingTerminalSettlement,
} from './funding-position-lifecycle.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';
import { measureOkxFundingExecutionEvidence, type OkxFundingExecutionEvidence } from './okx-funding-evidence.js';

export type OkxFundingExecutionPlan = FundingExecutionPlan & {
  okx: {
    spotInstId: string;
    swapInstId: string;
    baseAsset: string;
    quoteAsset: string;
    contracts: number;
    baseQuantity: number;
    /** Entry-time projected funding rate. It is not a locked or guaranteed rate. */
    lockedFundingRate: number;
    evidenceMeasuredAt: number;
    evidenceExpiresAt: number;
    entry: Pick<OkxFundingExecutionEvidence, 'spotEntryLimit' | 'perpEntryLimit'>;
  };
};

const preparedPlans = new Map<string, OkxFundingExecutionPlan>();
const lifecyclePlanIds = new Map<string, string>();
const lifecycleCapitalHolds = new Map<string, FundingCapitalHold>();
let registered = false;

function asOkxPlan(plan: FundingExecutionPlan): OkxFundingExecutionPlan | null {
  const candidate = plan as Partial<OkxFundingExecutionPlan>;
  return candidate.okx ? plan as OkxFundingExecutionPlan : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fundingAuthority(lifecycleId: string) {
  return {
    strategySelectionAuthority: 'funding_arbitrage_policy' as const,
    notionalAuthority: 'profit_ladder' as const,
    executionAuthority: 'funding_position_lifecycle' as const,
    governanceAdmitted: true as const,
    reference: lifecycleId,
  };
}

function fundingClientOrderId(lifecycleId: string, leg: string): string {
  const digest = createHash('sha256').update(`${lifecycleId}:${leg}`).digest('hex');
  return `f${leg}${digest.slice(0, 28)}`.slice(0, 32);
}

function fundingHoldUntil(plan: OkxFundingExecutionPlan, openedAt = Date.now()): number {
  const maxHoldMs = Math.max(60_000, Number(process.env.CRYPTOCRAWL_FUNDING_MAX_HOLD_MS || 8 * 60 * 60_000));
  return Math.min(plan.fundingTimestamp + maxHoldMs, openedAt + 24 * 60 * 60_000);
}

function durableHoldFromReceipt(plan: OkxFundingExecutionPlan, receipt: FundingOpenReceipt): FundingCapitalHold | null {
  const legacyIds = receipt.capitalReservationIds ?? [];
  const marginReservationId = receipt.marginReservationId ?? legacyIds[0];
  if (!marginReservationId) return null;
  const legacySecond = legacyIds[1] ?? null;
  const spotEntryReservationId = receipt.spotEntryReservationId !== undefined
    ? receipt.spotEntryReservationId
    : receipt.entryOwnershipConfirmed === false ? legacySecond : null;
  const baseReservationId = receipt.baseReservationId !== undefined
    ? receipt.baseReservationId
    : receipt.entryOwnershipConfirmed === false ? null : legacySecond;
  const holdUntil = fundingHoldUntil(plan, receipt.openedAt);
  if (!Number.isFinite(holdUntil) || holdUntil <= Date.now()) return null;
  return {
    lifecycleId: receipt.lifecycleId,
    opportunityId: plan.opportunityId,
    quoteAsset: plan.okx.quoteAsset,
    baseAsset: plan.okx.baseAsset,
    marginReservationId,
    spotEntryReservationId,
    baseReservationId,
    holdUntil,
  };
}

async function recoverHold(plan: OkxFundingExecutionPlan, lifecycleId: string, receipt?: FundingOpenReceipt): Promise<FundingCapitalHold | null> {
  const cached = lifecycleCapitalHolds.get(lifecycleId);
  if (cached) return cached;
  const fromReceipt = receipt ? durableHoldFromReceipt(plan, receipt) : null;
  if (fromReceipt) {
    lifecycleCapitalHolds.set(lifecycleId, fromReceipt);
    return fromReceipt;
  }
  const recovered = await recoverFundingCapitalHold({
    lifecycleId,
    opportunityId: plan.opportunityId,
    baseAsset: plan.okx.baseAsset,
    quoteAsset: plan.okx.quoteAsset,
    holdUntil: fundingHoldUntil(plan, receipt?.openedAt ?? Date.now()),
  }).catch(() => null);
  if (recovered) lifecycleCapitalHolds.set(lifecycleId, recovered);
  return recovered;
}

async function durablePlanForLifecycle(lifecycleId: string): Promise<OkxFundingExecutionPlan | null> {
  const result = await pool.query(
    `SELECT plan FROM private.cryptocrawler_funding_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  ).catch(() => null);
  const raw = result?.rows?.[0]?.plan;
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) as FundingExecutionPlan : raw as FundingExecutionPlan;
  return asOkxPlan(parsed);
}

async function queryOrder(instId: string, ordId: string): Promise<any> {
  const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', { instId, ordId }, { lane: 'order_read' });
  const row = response.data[0];
  if (!row || String(row.ordId || '') !== ordId) throw new Error(`OKX funding order ${ordId} state unavailable`);
  return row;
}

type ClientOrderLookup = { state: 'found'; row: any } | { state: 'absent' };
type FundingOrderState = { ordId: string; filled: boolean; terminal: boolean; quantity: number; row: any };

async function lookupOrderByClientId(instId: string, clOrdId: string): Promise<ClientOrderLookup> {
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', { instId, clOrdId }, { lane: 'order_read' });
    const row = response.data[0];
    if (!row || String(row.clOrdId || '') !== clOrdId) {
      throw new Error(`OKX clOrdId lookup returned mismatched identity for ${clOrdId}`);
    }
    return { state: 'found', row };
  } catch (error) {
    // Only OKX's explicit OrderNotFound result proves absence. Network, rate,
    // credential, region, parsing and identity uncertainty must never authorize
    // a second submission.
    if (error instanceof OkxPrivateApiError && String(error.code) === '51603') return { state: 'absent' };
    throw error;
  }
}

async function placeOrRecoverOrder(input: {
  lifecycleId: string;
  leg: string;
  instId: string;
  tdMode: 'cash' | 'cross';
  side: 'buy' | 'sell';
  size: number;
  price?: number;
  reduceOnly?: boolean;
  ordType?: 'fok' | 'market';
}): Promise<string> {
  const clOrdId = fundingClientOrderId(input.lifecycleId, input.leg);
  const prior = await lookupOrderByClientId(input.instId, clOrdId);
  if (prior.state === 'found' && prior.row?.ordId) return String(prior.row.ordId);
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
      instId: input.instId,
      tdMode: input.tdMode,
      side: input.side,
      ordType: input.ordType || 'fok',
      sz: cexDecimalString(input.size),
      clOrdId,
      ...(input.price !== undefined ? { px: cexDecimalString(input.price) } : {}),
      ...(input.reduceOnly ? { reduceOnly: 'true' } : {}),
    }, { lane: 'order_write' });
    const row = response.data[0];
    if (!row || String(row.sCode || '0') !== '0' || !row.ordId) {
      throw new Error(`OKX funding order rejected: ${String(row?.sMsg || 'missing order id')}`);
    }
    return String(row.ordId);
  } catch (error) {
    // A write error can be an ambiguous acknowledgement. Re-query the exact
    // deterministic client ID. If that recovery read is itself uncertain, it
    // throws and the durable lifecycle retries later without resubmission.
    const recovered = await lookupOrderByClientId(input.instId, clOrdId);
    if (recovered.state === 'found' && recovered.row?.ordId) return String(recovered.row.ordId);
    throw error;
  }
}

function rowOrderState(row: any): Omit<FundingOrderState, 'ordId'> {
  const state = String(row?.state || '').toLowerCase();
  const quantity = Number(row?.accFillSz || 0);
  return {
    filled: state === 'filled' && quantity > 0,
    terminal: state === 'filled' || state === 'canceled' || state === 'mmp_canceled',
    quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
    row,
  };
}

async function terminalFilled(instId: string, ordId: string): Promise<FundingOrderState> {
  const row = await queryOrder(instId, ordId);
  return { ordId, ...rowOrderState(row) };
}

async function stateByClientId(instId: string, lifecycleId: string, leg: string): Promise<FundingOrderState | null> {
  const lookup = await lookupOrderByClientId(instId, fundingClientOrderId(lifecycleId, leg));
  if (lookup.state === 'absent') return null;
  const row = lookup.row;
  if (!row?.ordId) throw new Error('OKX deterministic funding order lacks ordId');
  return { ordId: String(row.ordId), ...rowOrderState(row) };
}

function unsafePartialTerminal(state: FundingOrderState | null): boolean {
  return Boolean(state?.terminal && !state.filled && state.quantity > 0);
}

function uncertainTerminalSettlement(input: {
  receipt: FundingOpenReceipt;
  spotState: FundingOrderState | null;
  perpState: FundingOrderState | null;
  spotOrderId: string | null;
  perpOrderId: string | null;
  error: string;
}): FundingTerminalSettlement {
  return {
    lifecycleId: input.receipt.lifecycleId,
    terminal: false,
    settlementConfirmed: false,
    spotClosed: input.spotState?.filled === true,
    perpClosed: input.perpState?.filled === true,
    spotCloseOrderId: input.spotOrderId || undefined,
    perpCloseOrderId: input.perpOrderId || undefined,
    fundingPaymentUsd: null,
    realizedEntryExitPnlUsd: null,
    realizedFeesUsd: null,
    realizedNetProfitUsd: null,
    settledAt: null,
    provenance: [
      'okx_close_state_not_authoritative_enough_for_emergency_resubmission',
      'funding_capital_retained_until_terminal_exposure_truth',
      'synthetic_evidence:false',
    ],
    error: input.error,
  };
}

async function emergencyNeutralize(input: {
  plan: OkxFundingExecutionPlan;
  lifecycleId: string;
  spotExposureOpen: boolean;
  perpExposureOpen: boolean;
}): Promise<{ spotOrderId?: string; perpOrderId?: string }> {
  const [spotResult, perpResult] = await Promise.allSettled([
    input.spotExposureOpen
      ? placeOrRecoverOrder({ lifecycleId: input.lifecycleId, leg: 'es', instId: input.plan.okx.spotInstId, tdMode: 'cash', side: 'sell', size: input.plan.okx.baseQuantity, ordType: 'market' })
      : Promise.resolve(''),
    input.perpExposureOpen
      ? placeOrRecoverOrder({ lifecycleId: input.lifecycleId, leg: 'ep', instId: input.plan.okx.swapInstId, tdMode: 'cross', side: 'buy', size: input.plan.okx.contracts, ordType: 'market', reduceOnly: true })
      : Promise.resolve(''),
  ]);
  const spotOrderId = spotResult.status === 'fulfilled' && spotResult.value ? spotResult.value : undefined;
  const perpOrderId = perpResult.status === 'fulfilled' && perpResult.value ? perpResult.value : undefined;
  if (input.spotExposureOpen) {
    if (!spotOrderId || !(await terminalFilled(input.plan.okx.spotInstId, spotOrderId)).filled) {
      throw new Error('FUNDING_EMERGENCY_SPOT_NEUTRALIZATION_UNPROVEN');
    }
  }
  if (input.perpExposureOpen) {
    if (!perpOrderId || !(await terminalFilled(input.plan.okx.swapInstId, perpOrderId)).filled) {
      throw new Error('FUNDING_EMERGENCY_PERP_NEUTRALIZATION_UNPROVEN');
    }
  }
  return { spotOrderId, perpOrderId };
}

function normalizedSpotSettlement(input: {
  plan: OkxFundingExecutionPlan;
  orderId: string;
  side: 'buy' | 'sell';
  row: any;
  submittedAt: number;
}): NormalizedOrderSettlement {
  const filled = Number(input.row?.accFillSz || 0);
  const avgPx = Number(input.row?.avgPx || input.row?.fillPx || 0);
  return {
    venue: 'okx', orderId: input.orderId, symbol: input.plan.symbol, side: input.side,
    status: 'filled', terminal: true, requestedQuantity: filled, filledQuantity: filled, remainingQuantity: 0,
    averageFillPrice: Number.isFinite(avgPx) && avgPx > 0 ? avgPx : null, fills: [], feeAmount: null, feeAsset: null,
    submittedAt: input.submittedAt, terminalAt: Date.now(),
    requestedQuantityDecimal: String(input.row?.sz || input.row?.accFillSz || ''),
    filledQuantityDecimal: String(input.row?.accFillSz || ''),
    averageFillPriceDecimal: String(input.row?.avgPx || input.row?.fillPx || '') || null,
    feeAmountDecimal: null,
  };
}

async function applySpotOwnership(input: {
  plan: OkxFundingExecutionPlan;
  lifecycleId: string;
  orderId: string;
  side: 'buy' | 'sell';
  row: any;
  submittedAt: number;
}): Promise<ExactCexOrderAssetDeltaEvidence> {
  const normalized = normalizedSpotSettlement(input);
  const evidence = await getExactOkxOrderAssetDeltas(normalized);
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: input.plan.opportunityId,
    strategy: 'okx_spot_perp_funding',
    authority: fundingAuthority(input.lifecycleId),
  });
  return evidence;
}

async function orderFillEconomics(input: {
  instType: 'SPOT' | 'SWAP';
  instId: string;
  ordId: string;
  side: 'buy' | 'sell';
  baseAsset: string;
  quoteAsset: string;
}): Promise<{ quoteCashflow: number; pnl: number; feeDeltaQuote: number; exactDerivativeQuoteDelta: string; fills: number }> {
  const response = await okxPrivateRequest('/api/v5/trade/fills', 'GET', {
    instType: input.instType, instId: input.instId, ordId: input.ordId, limit: '100',
  }, { lane: 'account_read' });
  let quoteCashflow = 0;
  let pnl = 0;
  let feeDeltaQuote = 0;
  let exactDerivativeQuoteDelta = '0';
  let fills = 0;
  for (const row of response.data) {
    if (String(row.ordId || '') !== input.ordId) continue;
    const size = finite(row.fillSz);
    const price = finite(row.fillPx);
    if (size === null || size <= 0 || price === null || price <= 0) continue;
    fills += 1;
    if (input.instType === 'SPOT') quoteCashflow += (input.side === 'sell' ? 1 : -1) * size * price;
    const fillPnlRaw = String(row.fillPnl ?? '0').trim() || '0';
    const fillPnl = finite(fillPnlRaw);
    if (fillPnl !== null) pnl += fillPnl;
    const feeRaw = String(row.fee ?? '0').trim() || '0';
    const fee = finite(feeRaw);
    const feeCcy = String(row.feeCcy || '').trim().toUpperCase();
    if (fee !== null && fee !== 0) {
      if (feeCcy === input.quoteAsset) feeDeltaQuote += fee;
      else if (feeCcy === input.baseAsset && input.instType === 'SPOT') feeDeltaQuote += fee * price;
      else throw new Error(`OKX funding fill fee currency ${feeCcy || 'missing'} cannot be valued canonically`);
    }
    if (input.instType === 'SWAP') {
      if (fee !== null && fee !== 0 && feeCcy !== input.quoteAsset) {
        throw new Error(`OKX funding SWAP fee currency ${feeCcy || 'missing'} is not canonical quote asset ${input.quoteAsset}`);
      }
      exactDerivativeQuoteDelta = addExactDecimals(exactDerivativeQuoteDelta, fillPnlRaw);
      exactDerivativeQuoteDelta = addExactDecimals(exactDerivativeQuoteDelta, feeRaw);
    }
  }
  if (fills === 0) throw new Error(`OKX funding order ${input.ordId} has no authenticated fills`);
  return { quoteCashflow, pnl, feeDeltaQuote, exactDerivativeQuoteDelta, fills };
}

async function fundingPaymentEvidence(input: { instId: string; openedAt: number; closedAt: number }): Promise<{ numeric: number; exactQuoteDelta: string; rows: number }> {
  const response = await okxPrivateRequest('/api/v5/account/bills', 'GET', {
    instType: 'SWAP', instId: input.instId, type: '8', limit: '100',
  }, { lane: 'account_read' });
  let numeric = 0;
  let exactQuoteDelta = '0';
  let rows = 0;
  for (const row of response.data) {
    const ts = Number(row.ts || 0);
    if (!Number.isFinite(ts) || ts < input.openedAt - 5_000 || ts > input.closedAt + 60_000) continue;
    const subType = String(row.subType || '');
    if (subType !== '173' && subType !== '174') continue;
    const raw = String(row.balChg ?? row.pnl ?? '').trim();
    if (!raw) continue;
    const value = finite(raw);
    if (value === null) continue;
    numeric += value;
    exactQuoteDelta = addExactDecimals(exactQuoteDelta, raw);
    rows += 1;
  }
  return { numeric, exactQuoteDelta, rows };
}

async function currentFundingSnapshot(plan: OkxFundingExecutionPlan): Promise<{ rate: number; fundingTime: number; processing: boolean } | null> {
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const payload = await fetch(`${baseUrl}/api/v5/public/funding-rate?instId=${encodeURIComponent(plan.okx.swapInstId)}`).then(r => r.json()).catch(() => null);
  const row = payload?.code === '0' ? payload?.data?.[0] : null;
  if (!row) return null;
  const processing = String(row.settState || '').toLowerCase() === 'processing';
  const rate = Number(row.fundingRate);
  const fundingTime = Number(row.fundingTime);
  return Number.isFinite(rate) && Number.isFinite(fundingTime) ? { rate, fundingTime, processing } : null;
}

async function applyDerivativeFundingOwnership(input: { plan: OkxFundingExecutionPlan; lifecycleId: string; exactQuoteDelta: string }): Promise<void> {
  if (Number(input.exactQuoteDelta) === 0) return;
  const evidence: ExactCexOrderAssetDeltaEvidence = {
    venue: 'okx', orderId: `funding:${input.lifecycleId}`, symbol: input.plan.symbol, side: 'sell',
    baseAsset: input.plan.okx.baseAsset, quoteAsset: input.plan.okx.quoteAsset,
    terminalState: 'funding_lifecycle_closed', accumulatedFillDecimal: '0', fills: [],
    assetDeltas: { [input.plan.okx.quoteAsset]: input.exactQuoteDelta },
    settlementReference: `okx-funding:${input.lifecycleId}`,
    provenance: ['okx_authenticated_swap_fills', 'okx_authenticated_funding_bills:type_8', 'exact_decimal_derivative_and_funding_quote_delta', 'spot_asset_transforms_recorded_separately', 'synthetic_evidence:false'],
  };
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: input.plan.opportunityId,
    strategy: 'okx_spot_perp_funding',
    authority: fundingAuthority(input.lifecycleId),
  });
}

async function terminalEconomics(input: {
  plan: OkxFundingExecutionPlan;
  receipt: FundingOpenReceipt;
  spotCloseOrderId: string;
  perpCloseOrderId: string;
  closedAt: number;
}): Promise<FundingTerminalSettlement> {
  const { plan, receipt } = input;
  const [spotOpenEcon, spotCloseEcon, perpOpenEcon, perpCloseEcon, funding, prices] = await Promise.all([
    orderFillEconomics({ instType: 'SPOT', instId: plan.okx.spotInstId, ordId: receipt.spotOrderId, side: 'buy', baseAsset: plan.okx.baseAsset, quoteAsset: plan.okx.quoteAsset }),
    orderFillEconomics({ instType: 'SPOT', instId: plan.okx.spotInstId, ordId: input.spotCloseOrderId, side: 'sell', baseAsset: plan.okx.baseAsset, quoteAsset: plan.okx.quoteAsset }),
    orderFillEconomics({ instType: 'SWAP', instId: plan.okx.swapInstId, ordId: receipt.perpOrderId, side: 'sell', baseAsset: plan.okx.baseAsset, quoteAsset: plan.okx.quoteAsset }),
    orderFillEconomics({ instType: 'SWAP', instId: plan.okx.swapInstId, ordId: input.perpCloseOrderId, side: 'buy', baseAsset: plan.okx.baseAsset, quoteAsset: plan.okx.quoteAsset }),
    fundingPaymentEvidence({ instId: plan.okx.swapInstId, openedAt: receipt.openedAt, closedAt: input.closedAt }),
    coinGeckoPriceClient.getLiveSymbolPrices([plan.okx.quoteAsset]),
  ]);
  if (funding.rows === 0) {
    return {
      lifecycleId: receipt.lifecycleId, terminal: false, settlementConfirmed: false, spotClosed: true, perpClosed: true,
      spotCloseOrderId: input.spotCloseOrderId, perpCloseOrderId: input.perpCloseOrderId,
      fundingPaymentUsd: null, realizedEntryExitPnlUsd: null, realizedFeesUsd: null, realizedNetProfitUsd: null,
      settledAt: null,
      provenance: ['okx_terminal_both_legs_closed', 'okx_funding_bill_evidence_pending', 'synthetic_evidence:false'],
      error: 'OKX_FUNDING_BILL_EVIDENCE_PENDING',
    };
  }
  const quoteUsd = prices.get(plan.okx.quoteAsset);
  if (!Number.isFinite(quoteUsd) || Number(quoteUsd) <= 0) throw new Error('OKX funding terminal quote-currency USD price unavailable');
  const grossPnlUsd = (spotOpenEcon.quoteCashflow + spotCloseEcon.quoteCashflow + perpOpenEcon.pnl + perpCloseEcon.pnl) * Number(quoteUsd);
  const fundingPaymentUsd = funding.numeric * Number(quoteUsd);
  const signedFees = spotOpenEcon.feeDeltaQuote + spotCloseEcon.feeDeltaQuote + perpOpenEcon.feeDeltaQuote + perpCloseEcon.feeDeltaQuote;
  const realizedFeesUsd = -signedFees * Number(quoteUsd);
  const realizedNetProfitUsd = grossPnlUsd + fundingPaymentUsd - realizedFeesUsd;
  const exactDerivativeDelta = addExactDecimals(
    addExactDecimals(perpOpenEcon.exactDerivativeQuoteDelta, perpCloseEcon.exactDerivativeQuoteDelta),
    funding.exactQuoteDelta,
  );
  await applyDerivativeFundingOwnership({ plan, lifecycleId: receipt.lifecycleId, exactQuoteDelta: exactDerivativeDelta });
  return {
    lifecycleId: receipt.lifecycleId, terminal: true, settlementConfirmed: true, spotClosed: true, perpClosed: true,
    spotCloseOrderId: input.spotCloseOrderId, perpCloseOrderId: input.perpCloseOrderId,
    fundingPaymentUsd, realizedEntryExitPnlUsd: grossPnlUsd, realizedFeesUsd, realizedNetProfitUsd, settledAt: input.closedAt,
    provenance: ['okx_authenticated_spot_and_swap_fills', 'okx_authenticated_funding_bills:type_8', 'okx_terminal_both_legs_closed', 'cex_system_owned_lot_ledger:exact_spot_and_derivative_transforms', 'coingecko_live_quote_currency_usd', 'synthetic_evidence:false'],
  };
}

async function reconcileEntryOwnership(plan: OkxFundingExecutionPlan, receipt: FundingOpenReceipt): Promise<FundingOpenReceipt> {
  if (receipt.entryOwnershipConfirmed === true) return receipt;
  const spotState = await terminalFilled(plan.okx.spotInstId, receipt.spotOrderId);
  if (!spotState.filled || !spotState.row) throw new Error('FUNDING_SPOT_ENTRY_FILL_UNAVAILABLE_FOR_ACCOUNTING');
  const hold = await recoverHold(plan, receipt.lifecycleId, receipt);
  if (!hold) throw new Error('FUNDING_DURABLE_CAPITAL_HOLD_UNAVAILABLE');
  const submittedAt = receipt.entrySubmittedAt ?? receipt.openedAt;
  const spotEvidence = await applySpotOwnership({
    plan,
    lifecycleId: receipt.lifecycleId,
    orderId: receipt.spotOrderId,
    side: 'buy',
    row: spotState.row,
    submittedAt,
  });
  const acquiredBase = spotEvidence.assetDeltas[plan.okx.baseAsset];
  if (!acquiredBase || Number(acquiredBase) <= 0) throw new Error('OKX funding spot entry did not produce exact system-owned base inventory');
  const updatedHold = await replaceSpotEntryReservationWithBaseHold({ hold, exactBaseAmount: acquiredBase });
  if (!updatedHold.baseReservationId || updatedHold.spotEntryReservationId) throw new Error('FUNDING_ACQUIRED_BASE_HOLD_NOT_PROVEN');
  lifecycleCapitalHolds.set(receipt.lifecycleId, updatedHold);
  return {
    ...receipt,
    entryOwnershipConfirmed: true,
    marginReservationId: updatedHold.marginReservationId,
    spotEntryReservationId: null,
    baseReservationId: updatedHold.baseReservationId,
    capitalReservationIds: [updatedHold.marginReservationId, updatedHold.baseReservationId],
  };
}

async function openingAgeMs(lifecycleId: string): Promise<number> {
  const result = await pool.query(
    `SELECT created_at FROM private.cryptocrawler_funding_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  ).catch(() => null);
  const created = result?.rows?.[0]?.created_at ? new Date(result.rows[0].created_at).getTime() : Date.now();
  return Math.max(0, Date.now() - created);
}

const adapter: FundingLifecycleAdapter = {
  venue: 'okx',

  async verifyCurrentPlan(plan) {
    const okx = asOkxPlan(plan);
    if (!okx || okx.expiresAt <= Date.now() || okx.okx.evidenceExpiresAt <= Date.now() || okx.fundingTimestamp <= Date.now()) return false;
    const current = await currentFundingSnapshot(okx);
    if (!current || current.processing || current.fundingTime !== okx.fundingTimestamp || current.rate <= 0) return false;
    const projectedFundingUsd = current.rate * okx.notionalUsd;
    const projectedNetUsd = projectedFundingUsd - okx.expectedEntryCostUsd - okx.expectedExitCostUsd;
    return Number.isFinite(projectedNetUsd) && projectedNetUsd > 0;
  },

  async openDeltaNeutral(plan, lifecycleId) {
    const okx = asOkxPlan(plan);
    if (!okx) throw new Error('OKX funding plan extension missing');
    lifecyclePlanIds.set(lifecycleId, okx.opportunityId);
    const holdUntil = fundingHoldUntil(okx);
    const reserved = await reserveFundingEntryCapital({
      lifecycleId,
      opportunityId: okx.opportunityId,
      baseAsset: okx.okx.baseAsset,
      quoteAsset: okx.okx.quoteAsset,
      spotEntryLimit: okx.okx.entry.spotEntryLimit,
      baseQuantity: okx.okx.baseQuantity,
      marginBufferUsd: okx.marginBufferUsd,
      expectedEntryCostUsd: okx.expectedEntryCostUsd,
      holdUntil,
    });
    lifecycleCapitalHolds.set(lifecycleId, reserved.hold);
    const submittedAt = Date.now();
    const [perpSubmit, spotSubmit] = await Promise.allSettled([
      placeOrRecoverOrder({ lifecycleId, leg: 'ip', instId: okx.okx.swapInstId, tdMode: 'cross', side: 'sell', size: okx.okx.contracts, price: okx.okx.entry.perpEntryLimit, ordType: 'fok' }),
      placeOrRecoverOrder({ lifecycleId, leg: 'is', instId: okx.okx.spotInstId, tdMode: 'cash', side: 'buy', size: okx.okx.baseQuantity, price: okx.okx.entry.spotEntryLimit, ordType: 'fok' }),
    ]);
    const perpOrderId = perpSubmit.status === 'fulfilled' ? perpSubmit.value : null;
    const spotOrderId = spotSubmit.status === 'fulfilled' ? spotSubmit.value : null;
    const [perpState, spotState] = await Promise.all([
      perpOrderId ? terminalFilled(okx.okx.swapInstId, perpOrderId).catch(() => null) : Promise.resolve(null),
      spotOrderId ? terminalFilled(okx.okx.spotInstId, spotOrderId).catch(() => null) : Promise.resolve(null),
    ]);

    const entryStateUncertain = perpSubmit.status === 'rejected'
      || spotSubmit.status === 'rejected'
      || !perpOrderId
      || !spotOrderId
      || !perpState
      || !spotState
      || !perpState.terminal
      || !spotState.terminal
      || unsafePartialTerminal(perpState)
      || unsafePartialTerminal(spotState);
    if (entryStateUncertain) {
      logger.warn('[FundingLifecycle] Entry order state is not authoritative enough to release capital or submit emergency orders', {
        component: 'OkxFundingLifecycleAdapter',
        lifecycleId,
        opportunityId: okx.opportunityId,
        perpSubmissionResolved: perpSubmit.status === 'fulfilled',
        spotSubmissionResolved: spotSubmit.status === 'fulfilled',
        perpStateKnown: Boolean(perpState),
        spotStateKnown: Boolean(spotState),
        capitalReleased: false,
        emergencyNeutralizationAuthorized: false,
      });
      throw new Error('FUNDING_ENTRY_ORDER_STATE_UNCERTAIN');
    }

    const perpBase = perpState.quantity > 0 && okx.okx.contracts > 0
      ? perpState.quantity / okx.okx.contracts * okx.okx.baseQuantity
      : 0;
    const deltaNeutral = perpState.filled
      && spotState.filled
      && Math.abs(spotState.quantity - perpBase) <= Math.max(1e-10, okx.okx.baseQuantity * 1e-6);
    if (!deltaNeutral) {
      await emergencyNeutralize({
        plan: okx,
        lifecycleId,
        spotExposureOpen: spotState.filled,
        perpExposureOpen: perpState.filled,
      });
      await releaseFundingCapitalHold(reserved.hold).catch(() => undefined);
      lifecycleCapitalHolds.delete(lifecycleId);
      lifecyclePlanIds.delete(lifecycleId);
      throw new Error('OKX funding entry legs reached known terminal non-neutral state; deterministic emergency neutralization completed');
    }

    return {
      lifecycleId,
      spotOrderId,
      perpOrderId,
      openedAt: Date.now(),
      entrySubmittedAt: submittedAt,
      deltaNeutral: true,
      measuredSpotQuantity: spotState.quantity,
      measuredPerpQuantity: perpBase,
      entryOwnershipConfirmed: false,
      marginReservationId: reserved.hold.marginReservationId,
      spotEntryReservationId: reserved.hold.spotEntryReservationId,
      baseReservationId: null,
      capitalReservationIds: [reserved.hold.marginReservationId, reserved.spotEntryReservationId],
    };
  },

  async recoverOpening(plan, lifecycleId): Promise<FundingOpeningRecoveryResult> {
    const okx = asOkxPlan(plan);
    if (!okx) return { status: 'failed', error: 'FUNDING_OKX_PLAN_EXTENSION_MISSING' };
    lifecyclePlanIds.set(lifecycleId, okx.opportunityId);
    const [spotState, perpState] = await Promise.all([
      stateByClientId(okx.okx.spotInstId, lifecycleId, 'is'),
      stateByClientId(okx.okx.swapInstId, lifecycleId, 'ip'),
    ]);
    if (!spotState && !perpState) {
      if (await openingAgeMs(lifecycleId) < Math.max(10_000, Number(process.env.CRYPTOCRAWL_FUNDING_OPEN_RECOVERY_GRACE_MS || 30_000))) {
        return { status: 'pending', error: 'FUNDING_ENTRY_ORDERS_NOT_YET_VISIBLE' };
      }
      const hold = await recoverHold(okx, lifecycleId);
      if (hold) await releaseFundingCapitalHold(hold).catch(() => undefined);
      return { status: 'failed', error: 'FUNDING_ENTRY_ORDERS_NOT_SUBMITTED_OR_RECOVERABLE' };
    }
    if ((spotState && !spotState.terminal) || (perpState && !perpState.terminal)) {
      return { status: 'pending', error: 'FUNDING_ENTRY_ORDER_STATE_PENDING' };
    }
    if (unsafePartialTerminal(spotState) || unsafePartialTerminal(perpState)) {
      return { status: 'pending', error: 'FUNDING_ENTRY_PARTIAL_TERMINAL_EXPOSURE_RECONCILIATION_REQUIRED' };
    }

    const perpBase = perpState?.quantity && okx.okx.contracts > 0
      ? perpState.quantity / okx.okx.contracts * okx.okx.baseQuantity
      : 0;
    const deltaNeutral = Boolean(
      spotState?.filled
      && perpState?.filled
      && Math.abs(spotState.quantity - perpBase) <= Math.max(1e-10, okx.okx.baseQuantity * 1e-6),
    );
    if (!deltaNeutral) {
      await emergencyNeutralize({
        plan: okx,
        lifecycleId,
        spotExposureOpen: spotState?.filled === true,
        perpExposureOpen: perpState?.filled === true,
      });
      const hold = await recoverHold(okx, lifecycleId);
      if (hold) await releaseFundingCapitalHold(hold).catch(() => undefined);
      return { status: 'failed', error: 'FUNDING_PARTIAL_ENTRY_RECOVERED_AND_NEUTRALIZED' };
    }

    const hold = await recoverHold(okx, lifecycleId);
    if (!hold) return { status: 'pending', error: 'FUNDING_ENTRY_CAPITAL_HOLD_RECOVERY_PENDING' };
    const openedAt = Math.max(
      Number(spotState?.row?.fillTime || spotState?.row?.uTime || Date.now()),
      Number(perpState?.row?.fillTime || perpState?.row?.uTime || Date.now()),
    );
    return {
      status: 'opened',
      receipt: {
        lifecycleId,
        spotOrderId: spotState!.ordId,
        perpOrderId: perpState!.ordId,
        openedAt,
        entrySubmittedAt: Math.min(
          Number(spotState?.row?.cTime || openedAt),
          Number(perpState?.row?.cTime || openedAt),
        ),
        deltaNeutral: true,
        measuredSpotQuantity: spotState!.quantity,
        measuredPerpQuantity: perpBase,
        entryOwnershipConfirmed: Boolean(hold.baseReservationId && !hold.spotEntryReservationId),
        marginReservationId: hold.marginReservationId,
        spotEntryReservationId: hold.spotEntryReservationId,
        baseReservationId: hold.baseReservationId,
        capitalReservationIds: [
          hold.marginReservationId,
          ...(hold.baseReservationId ? [hold.baseReservationId] : hold.spotEntryReservationId ? [hold.spotEntryReservationId] : []),
        ],
      },
    };
  },

  async reconcileOpenReceipt(plan, receipt) {
    const okx = asOkxPlan(plan);
    if (!okx) throw new Error('OKX funding plan extension missing during entry accounting');
    return reconcileEntryOwnership(okx, receipt);
  },

  async marginHealthy(receipt) {
    const cachedOpportunityId = lifecyclePlanIds.get(receipt.lifecycleId);
    let plan = cachedOpportunityId ? preparedPlans.get(cachedOpportunityId) ?? null : null;
    if (!plan) plan = await durablePlanForLifecycle(receipt.lifecycleId);
    if (!plan) return false;
    lifecyclePlanIds.set(receipt.lifecycleId, plan.opportunityId);
    const hold = await recoverHold(plan, receipt.lifecycleId, receipt);
    if (!hold) return false;
    if (receipt.entryOwnershipConfirmed === true && !hold.baseReservationId) return false;
    lifecycleCapitalHolds.set(receipt.lifecycleId, hold);
    if (!await renewFundingCapitalHold(hold)) return false;
    const [positions, funding] = await Promise.all([
      okxPrivateRequest('/api/v5/account/positions', 'GET', { instId: plan.okx.swapInstId }, { lane: 'account_read' }),
      currentFundingSnapshot(plan),
    ]);
    const row = positions.data.find(item => String(item?.instId || '').toUpperCase() === plan.okx.swapInstId) || positions.data[0];
    if (!row) return false;
    const pos = Math.abs(Number(row.pos || 0));
    const mgnRatio = Number(row.mgnRatio || Number.POSITIVE_INFINITY);
    const minimumRatio = Math.max(1.01, Number(process.env.CRYPTOCRAWL_FUNDING_MIN_MARGIN_RATIO || 1.20));
    if (!Number.isFinite(pos) || pos < plan.okx.contracts * 0.999999 || !Number.isFinite(mgnRatio) || mgnRatio < minimumRatio) return false;
    if (Date.now() < plan.fundingTimestamp && funding && !funding.processing) {
      const remainingProjectedNet = funding.rate * plan.notionalUsd - plan.expectedExitCostUsd;
      if (!Number.isFinite(remainingProjectedNet) || remainingProjectedNet <= 0) return false;
    }
    return true;
  },

  async closeAndSettle(plan, receipt) {
    const okx = asOkxPlan(plan);
    if (!okx) throw new Error('OKX funding plan extension missing at close');
    const fresh = await measureOkxFundingExecutionEvidence({
      symbol: okx.okx.baseAsset + okx.okx.quoteAsset,
      swapInstId: okx.okx.swapInstId,
      targetNotionalUsd: okx.notionalUsd,
    });
    if (!fresh) throw new Error('OKX funding close depth unavailable');

    const submittedAt = Date.now();
    const [perpClose, spotClose] = await Promise.allSettled([
      placeOrRecoverOrder({ lifecycleId: receipt.lifecycleId, leg: 'cp', instId: okx.okx.swapInstId, tdMode: 'cross', side: 'buy', size: okx.okx.contracts, price: fresh.perpExitLimit, ordType: 'fok', reduceOnly: true }),
      placeOrRecoverOrder({ lifecycleId: receipt.lifecycleId, leg: 'cs', instId: okx.okx.spotInstId, tdMode: 'cash', side: 'sell', size: receipt.measuredSpotQuantity, price: fresh.spotExitLimit, ordType: 'fok' }),
    ]);
    let perpCloseId = perpClose.status === 'fulfilled' ? perpClose.value : null;
    let spotCloseId = spotClose.status === 'fulfilled' ? spotClose.value : null;
    let [perpClosed, spotClosed] = await Promise.all([
      perpCloseId ? terminalFilled(okx.okx.swapInstId, perpCloseId).catch(() => null) : Promise.resolve(null),
      spotCloseId ? terminalFilled(okx.okx.spotInstId, spotCloseId).catch(() => null) : Promise.resolve(null),
    ]);

    const closeStateUncertain = perpClose.status === 'rejected'
      || spotClose.status === 'rejected'
      || !perpCloseId
      || !spotCloseId
      || !perpClosed
      || !spotClosed
      || !perpClosed.terminal
      || !spotClosed.terminal
      || unsafePartialTerminal(perpClosed)
      || unsafePartialTerminal(spotClosed);
    if (closeStateUncertain) {
      logger.warn('[FundingLifecycle] Close order state is not authoritative enough for emergency resubmission', {
        component: 'OkxFundingLifecycleAdapter',
        lifecycleId: receipt.lifecycleId,
        opportunityId: okx.opportunityId,
        capitalReleased: false,
        emergencyNeutralizationAuthorized: false,
      });
      return uncertainTerminalSettlement({
        receipt,
        spotState: spotClosed,
        perpState: perpClosed,
        spotOrderId: spotCloseId,
        perpOrderId: perpCloseId,
        error: 'FUNDING_CLOSE_ORDER_STATE_UNCERTAIN',
      });
    }

    if (!perpClosed.filled || !spotClosed.filled) {
      const emergency = await emergencyNeutralize({
        plan: okx,
        lifecycleId: receipt.lifecycleId,
        spotExposureOpen: !spotClosed.filled,
        perpExposureOpen: !perpClosed.filled,
      });
      if (!spotClosed.filled && emergency.spotOrderId) spotCloseId = emergency.spotOrderId;
      if (!perpClosed.filled && emergency.perpOrderId) perpCloseId = emergency.perpOrderId;
      [perpClosed, spotClosed] = await Promise.all([
        perpCloseId ? terminalFilled(okx.okx.swapInstId, perpCloseId) : Promise.resolve(null),
        spotCloseId ? terminalFilled(okx.okx.spotInstId, spotCloseId) : Promise.resolve(null),
      ]);
    }
    if (!perpClosed?.filled || !spotClosed?.filled || !perpCloseId || !spotCloseId || !spotClosed.row) {
      return uncertainTerminalSettlement({
        receipt,
        spotState: spotClosed,
        perpState: perpClosed,
        spotOrderId: spotCloseId,
        perpOrderId: perpCloseId,
        error: 'FUNDING_CLOSE_EXPOSURE_NEUTRALIZATION_UNPROVEN',
      });
    }

    let reconciledReceipt = receipt;
    try {
      reconciledReceipt = await reconcileEntryOwnership(okx, receipt);
      await applySpotOwnership({
        plan: okx,
        lifecycleId: receipt.lifecycleId,
        orderId: spotCloseId,
        side: 'sell',
        row: spotClosed.row,
        submittedAt,
      });
    } catch (error) {
      return {
        lifecycleId: receipt.lifecycleId, terminal: false, settlementConfirmed: false, spotClosed: true, perpClosed: true,
        spotCloseOrderId: spotCloseId, perpCloseOrderId: perpCloseId,
        fundingPaymentUsd: null, realizedEntryExitPnlUsd: null, realizedFeesUsd: null, realizedNetProfitUsd: null,
        settledAt: null,
        provenance: ['okx_terminal_both_legs_closed', 'funding_entry_or_close_ownership_accounting_pending', 'system_owned_capital_not_released', 'synthetic_evidence:false'],
        error: `FUNDING_TERMINAL_ACCOUNTING_PENDING:${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const hold = await recoverHold(okx, receipt.lifecycleId, reconciledReceipt);
    if (hold) await releaseFundingCapitalHold(hold).catch(() => undefined);
    lifecycleCapitalHolds.delete(receipt.lifecycleId);
    const closedAt = Date.now();
    const settlement = await terminalEconomics({
      plan: okx,
      receipt: reconciledReceipt,
      spotCloseOrderId: spotCloseId,
      perpCloseOrderId: perpCloseId,
      closedAt,
    });
    lifecyclePlanIds.delete(receipt.lifecycleId);
    return settlement;
  },

  async reconcileSettlement(plan, receipt, prior) {
    const okx = asOkxPlan(plan);
    if (!okx) return prior;
    const reconciledReceipt = await reconcileEntryOwnership(okx, receipt);
    const spotCloseOrderId = prior.spotCloseOrderId
      || (await stateByClientId(okx.okx.spotInstId, receipt.lifecycleId, 'cs'))?.ordId
      || (await stateByClientId(okx.okx.spotInstId, receipt.lifecycleId, 'es'))?.ordId;
    const perpCloseOrderId = prior.perpCloseOrderId
      || (await stateByClientId(okx.okx.swapInstId, receipt.lifecycleId, 'cp'))?.ordId
      || (await stateByClientId(okx.okx.swapInstId, receipt.lifecycleId, 'ep'))?.ordId;
    if (!spotCloseOrderId || !perpCloseOrderId) return prior;
    const [spotClosed, perpClosed] = await Promise.all([
      terminalFilled(okx.okx.spotInstId, spotCloseOrderId),
      terminalFilled(okx.okx.swapInstId, perpCloseOrderId),
    ]);
    if (!spotClosed.filled || !perpClosed.filled || !spotClosed.row) return prior;
    await applySpotOwnership({
      plan: okx,
      lifecycleId: receipt.lifecycleId,
      orderId: spotCloseOrderId,
      side: 'sell',
      row: spotClosed.row,
      submittedAt: Number(spotClosed.row?.cTime || Date.now()),
    });
    const hold = await recoverHold(okx, receipt.lifecycleId, reconciledReceipt);
    if (hold) await releaseFundingCapitalHold(hold).catch(() => undefined);
    lifecycleCapitalHolds.delete(receipt.lifecycleId);
    const settlement = await terminalEconomics({
      plan: okx,
      receipt: reconciledReceipt,
      spotCloseOrderId,
      perpCloseOrderId,
      closedAt: Date.now(),
    });
    if (settlement.terminal) lifecyclePlanIds.delete(receipt.lifecycleId);
    return settlement;
  },
};

export function ensureOkxFundingLifecycleAdapterRegistered(): void {
  if (registered) return;
  fundingPositionLifecycle.registerAdapter(adapter);
  registered = true;
  logger.info('[FundingLifecycle] OKX production funding adapter registered', {
    component: 'OkxFundingLifecycleAdapter', venue: 'okx', executionAuthority: 'funding_position_lifecycle',
    privateRequestAuthority: 'cex_private_authority', capitalAuthority: 'cex_inventory_ledger_min_physical_and_system_owned',
    terminalEvidence: 'authenticated_fills_plus_funding_bills', projectedProfitAuthority: false,
    clientOrderRecovery: 'deterministic_clOrdId_query_before_resubmit_fail_closed_on_lookup_uncertainty',
  });
}

export function rememberPreparedOkxFundingPlan(plan: OkxFundingExecutionPlan): void {
  preparedPlans.set(plan.opportunityId, plan);
  for (const [id, candidate] of preparedPlans.entries()) if (candidate.expiresAt <= Date.now()) preparedPlans.delete(id);
}

export function getPreparedOkxFundingPlan(opportunityId: string): OkxFundingExecutionPlan | null {
  const plan = preparedPlans.get(opportunityId) ?? null;
  if (!plan || plan.expiresAt <= Date.now()) {
    preparedPlans.delete(opportunityId);
    return null;
  }
  return plan;
}
