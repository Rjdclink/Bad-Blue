import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { getOkxExecutionRestBaseUrl, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getExactOkxOrderAssetDeltas, type ExactCexOrderAssetDeltaEvidence } from './cex-system-capital-settlement-evidence.js';
import { applyExactCexSystemOwnedSettlement } from './cex-system-owned-lot-ledger.js';
import { addExactDecimals } from './exact-decimal.js';
import {
  reserveFundingEntryCapital,
  replaceSpotEntryReservationWithBaseHold,
  renewFundingCapitalHold,
  releaseFundingCapitalHold,
  releaseFundingReservation,
  type FundingCapitalHold,
} from './funding-capital-reservation.js';
import {
  fundingPositionLifecycle,
  type FundingExecutionPlan,
  type FundingLifecycleAdapter,
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

async function placeOrder(input: {
  instId: string;
  tdMode: 'cash' | 'cross';
  side: 'buy' | 'sell';
  size: number;
  price?: number;
  reduceOnly?: boolean;
  ordType?: 'fok' | 'market';
}): Promise<string> {
  const response = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
    instId: input.instId,
    tdMode: input.tdMode,
    side: input.side,
    ordType: input.ordType || 'fok',
    sz: cexDecimalString(input.size),
    ...(input.price !== undefined ? { px: cexDecimalString(input.price) } : {}),
    ...(input.reduceOnly ? { reduceOnly: 'true' } : {}),
  }, { lane: 'order_write' });
  const row = response.data[0];
  if (!row || String(row.sCode || '0') !== '0' || !row.ordId) throw new Error(`OKX funding order rejected: ${String(row?.sMsg || 'missing order id')}`);
  return String(row.ordId);
}

async function queryOrder(instId: string, ordId: string): Promise<any> {
  const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', { instId, ordId }, { lane: 'order_read' });
  const row = response.data[0];
  if (!row || String(row.ordId || '') !== ordId) throw new Error(`OKX funding order ${ordId} state unavailable`);
  return row;
}

async function terminalFilled(instId: string, ordId: string): Promise<{ filled: boolean; quantity: number; row: any | null }> {
  const row = await queryOrder(instId, ordId);
  const state = String(row.state || '').toLowerCase();
  const quantity = Number(row.accFillSz || 0);
  return { filled: state === 'filled' && quantity > 0, quantity, row };
}

async function emergencyNeutralize(input: { plan: OkxFundingExecutionPlan; spotFilled: boolean; perpFilled: boolean }): Promise<void> {
  const operations: Promise<unknown>[] = [];
  if (input.spotFilled) operations.push(placeOrder({ instId: input.plan.okx.spotInstId, tdMode: 'cash', side: 'sell', size: input.plan.okx.baseQuantity, ordType: 'market' }));
  if (input.perpFilled) operations.push(placeOrder({ instId: input.plan.okx.swapInstId, tdMode: 'cross', side: 'buy', size: input.plan.okx.contracts, ordType: 'market', reduceOnly: true }));
  await Promise.allSettled(operations);
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
    venue: 'okx',
    orderId: input.orderId,
    symbol: input.plan.symbol,
    side: input.side,
    status: 'filled',
    terminal: true,
    requestedQuantity: filled,
    filledQuantity: filled,
    remainingQuantity: 0,
    averageFillPrice: Number.isFinite(avgPx) && avgPx > 0 ? avgPx : null,
    fills: [],
    feeAmount: null,
    feeAsset: null,
    submittedAt: input.submittedAt,
    terminalAt: Date.now(),
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
  const response = await okxPrivateRequest('/api/v5/trade/fills', 'GET', { instType: input.instType, instId: input.instId, ordId: input.ordId, limit: '100' }, { lane: 'account_read' });
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
  const response = await okxPrivateRequest('/api/v5/account/bills', 'GET', { instType: 'SWAP', instId: input.instId, type: '8', limit: '100' }, { lane: 'account_read' });
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

async function applyDerivativeFundingOwnership(input: {
  plan: OkxFundingExecutionPlan;
  lifecycleId: string;
  exactQuoteDelta: string;
}): Promise<void> {
  if (Number(input.exactQuoteDelta) === 0) return;
  const evidence: ExactCexOrderAssetDeltaEvidence = {
    venue: 'okx',
    orderId: `funding:${input.lifecycleId}`,
    symbol: input.plan.symbol,
    side: 'sell',
    baseAsset: input.plan.okx.baseAsset,
    quoteAsset: input.plan.okx.quoteAsset,
    terminalState: 'funding_lifecycle_closed',
    accumulatedFillDecimal: '0',
    fills: [],
    assetDeltas: { [input.plan.okx.quoteAsset]: input.exactQuoteDelta },
    settlementReference: `okx-funding:${input.lifecycleId}`,
    provenance: [
      'okx_authenticated_swap_fills',
      'okx_authenticated_funding_bills:type_8',
      'exact_decimal_derivative_and_funding_quote_delta',
      'spot_asset_transforms_recorded_separately',
      'synthetic_evidence:false',
    ],
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
  receipt: Parameters<NonNullable<FundingLifecycleAdapter['closeAndSettle']>>[1];
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
    lifecycleId: receipt.lifecycleId,
    terminal: true,
    settlementConfirmed: true,
    spotClosed: true,
    perpClosed: true,
    spotCloseOrderId: input.spotCloseOrderId,
    perpCloseOrderId: input.perpCloseOrderId,
    fundingPaymentUsd,
    realizedEntryExitPnlUsd: grossPnlUsd,
    realizedFeesUsd,
    realizedNetProfitUsd,
    settledAt: input.closedAt,
    provenance: [
      'okx_authenticated_spot_and_swap_fills',
      'okx_authenticated_funding_bills:type_8',
      'okx_terminal_both_legs_closed',
      'cex_system_owned_lot_ledger:exact_spot_and_derivative_transforms',
      'coingecko_live_quote_currency_usd',
      'synthetic_evidence:false',
    ],
  };
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
    const holdUntil = Math.min(okx.fundingTimestamp + Math.max(60_000, Number(process.env.CRYPTOCRAWL_FUNDING_MAX_HOLD_MS || 8 * 60 * 60_000)), Date.now() + 24 * 60 * 60_000);
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
      placeOrder({ instId: okx.okx.swapInstId, tdMode: 'cross', side: 'sell', size: okx.okx.contracts, price: okx.okx.entry.perpEntryLimit, ordType: 'fok' }),
      placeOrder({ instId: okx.okx.spotInstId, tdMode: 'cash', side: 'buy', size: okx.okx.baseQuantity, price: okx.okx.entry.spotEntryLimit, ordType: 'fok' }),
    ]);
    const perpOrderId = perpSubmit.status === 'fulfilled' ? perpSubmit.value : null;
    const spotOrderId = spotSubmit.status === 'fulfilled' ? spotSubmit.value : null;
    const [perpState, spotState] = await Promise.all([
      perpOrderId ? terminalFilled(okx.okx.swapInstId, perpOrderId).catch(() => ({ filled: false, quantity: 0, row: null })) : Promise.resolve({ filled: false, quantity: 0, row: null }),
      spotOrderId ? terminalFilled(okx.okx.spotInstId, spotOrderId).catch(() => ({ filled: false, quantity: 0, row: null })) : Promise.resolve({ filled: false, quantity: 0, row: null }),
    ]);
    const perpBase = perpState.quantity > 0 ? perpState.quantity / okx.okx.contracts * okx.okx.baseQuantity : 0;
    const deltaNeutral = perpState.filled && spotState.filled && Math.abs(spotState.quantity - perpBase) <= Math.max(1e-10, okx.okx.baseQuantity * 1e-6);
    if (!deltaNeutral || !spotOrderId || !perpOrderId || !spotState.row) {
      await emergencyNeutralize({ plan: okx, spotFilled: spotState.filled, perpFilled: perpState.filled });
      await releaseFundingReservation(reserved.spotEntryReservationId).catch(() => undefined);
      await releaseFundingCapitalHold(reserved.hold).catch(() => undefined);
      lifecycleCapitalHolds.delete(lifecycleId);
      lifecyclePlanIds.delete(lifecycleId);
      throw new Error('OKX funding entry legs did not reach terminal delta-neutral fills; emergency neutralization invoked');
    }
    const spotEvidence = await applySpotOwnership({ plan: okx, lifecycleId, orderId: spotOrderId, side: 'buy', row: spotState.row, submittedAt });
    const acquiredBase = spotEvidence.assetDeltas[okx.okx.baseAsset];
    if (!acquiredBase || Number(acquiredBase) <= 0) throw new Error('OKX funding spot entry did not produce exact system-owned base inventory');
    const updatedHold = await replaceSpotEntryReservationWithBaseHold({ hold: reserved.hold, spotEntryReservationId: reserved.spotEntryReservationId, exactBaseAmount: acquiredBase });
    lifecycleCapitalHolds.set(lifecycleId, updatedHold);
    return {
      lifecycleId,
      spotOrderId,
      perpOrderId,
      openedAt: Date.now(),
      deltaNeutral: true,
      measuredSpotQuantity: spotState.quantity,
      measuredPerpQuantity: perpBase,
      capitalReservationIds: [updatedHold.marginReservationId, ...(updatedHold.baseReservationId ? [updatedHold.baseReservationId] : [])],
    };
  },

  async marginHealthy(receipt) {
    const opportunityId = lifecyclePlanIds.get(receipt.lifecycleId);
    const plan = opportunityId ? preparedPlans.get(opportunityId) ?? null : null;
    if (!plan) return false;
    const hold = lifecycleCapitalHolds.get(receipt.lifecycleId);
    if (!hold || !await renewFundingCapitalHold(hold)) return false;
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
    const fresh = await measureOkxFundingExecutionEvidence({ symbol: okx.okx.baseAsset + okx.okx.quoteAsset, swapInstId: okx.okx.swapInstId, targetNotionalUsd: okx.notionalUsd });
    if (!fresh) throw new Error('OKX funding close depth unavailable');
    const submittedAt = Date.now();
    const [perpClose, spotClose] = await Promise.allSettled([
      placeOrder({ instId: okx.okx.swapInstId, tdMode: 'cross', side: 'buy', size: okx.okx.contracts, price: fresh.perpExitLimit, ordType: 'fok', reduceOnly: true }),
      placeOrder({ instId: okx.okx.spotInstId, tdMode: 'cash', side: 'sell', size: receipt.measuredSpotQuantity, price: fresh.spotExitLimit, ordType: 'fok' }),
    ]);
    const perpCloseId = perpClose.status === 'fulfilled' ? perpClose.value : null;
    const spotCloseId = spotClose.status === 'fulfilled' ? spotClose.value : null;
    const [perpClosed, spotClosed] = await Promise.all([
      perpCloseId ? terminalFilled(okx.okx.swapInstId, perpCloseId).catch(() => ({ filled: false, quantity: 0, row: null })) : Promise.resolve({ filled: false, quantity: 0, row: null }),
      spotCloseId ? terminalFilled(okx.okx.spotInstId, spotCloseId).catch(() => ({ filled: false, quantity: 0, row: null })) : Promise.resolve({ filled: false, quantity: 0, row: null }),
    ]);
    if (!perpClosed.filled || !spotClosed.filled || !perpCloseId || !spotCloseId || !spotClosed.row) {
      await emergencyNeutralize({ plan: okx, spotFilled: !spotClosed.filled, perpFilled: !perpClosed.filled });
      throw new Error('OKX funding close did not terminally fill both legs');
    }
    await applySpotOwnership({ plan: okx, lifecycleId: receipt.lifecycleId, orderId: spotCloseId, side: 'sell', row: spotClosed.row, submittedAt });
    const closedAt = Date.now();
    const settlement = await terminalEconomics({ plan: okx, receipt, spotCloseOrderId: spotCloseId, perpCloseOrderId: perpCloseId, closedAt });
    const hold = lifecycleCapitalHolds.get(receipt.lifecycleId);
    if (hold) await releaseFundingCapitalHold(hold).catch(() => undefined);
    lifecycleCapitalHolds.delete(receipt.lifecycleId);
    lifecyclePlanIds.delete(receipt.lifecycleId);
    return settlement;
  },

  async reconcileSettlement(plan, receipt, prior) {
    const okx = asOkxPlan(plan);
    if (!okx || !prior.spotCloseOrderId || !prior.perpCloseOrderId) return prior;
    const settlement = await terminalEconomics({
      plan: okx,
      receipt,
      spotCloseOrderId: prior.spotCloseOrderId,
      perpCloseOrderId: prior.perpCloseOrderId,
      closedAt: Date.now(),
    });
    return settlement;
  },
};

export function ensureOkxFundingLifecycleAdapterRegistered(): void {
  if (registered) return;
  fundingPositionLifecycle.registerAdapter(adapter);
  registered = true;
  logger.info('[FundingLifecycle] OKX production funding adapter registered', {
    component: 'OkxFundingLifecycleAdapter',
    venue: 'okx',
    executionAuthority: 'funding_position_lifecycle',
    privateRequestAuthority: 'cex_private_authority',
    capitalAuthority: 'cex_inventory_ledger_min_physical_and_system_owned',
    terminalEvidence: 'authenticated_fills_plus_funding_bills',
    projectedProfitAuthority: false,
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
