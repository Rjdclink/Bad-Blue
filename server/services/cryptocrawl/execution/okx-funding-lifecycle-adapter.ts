import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { getOkxExecutionRestBaseUrl, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexDecimalString } from './cex-order-serialization.js';
import {
  fundingPositionLifecycle,
  type FundingExecutionPlan,
  type FundingLifecycleAdapter,
  type FundingTerminalSettlement,
} from './funding-position-lifecycle.js';
import { measureOkxFundingExecutionEvidence, type OkxFundingExecutionEvidence } from './okx-funding-evidence.js';

export type OkxFundingExecutionPlan = FundingExecutionPlan & {
  okx: {
    spotInstId: string;
    swapInstId: string;
    baseAsset: string;
    quoteAsset: string;
    contracts: number;
    baseQuantity: number;
    lockedFundingRate: number;
    evidenceMeasuredAt: number;
    evidenceExpiresAt: number;
    entry: Pick<OkxFundingExecutionEvidence, 'spotEntryLimit' | 'perpEntryLimit'>;
  };
};

const preparedPlans = new Map<string, OkxFundingExecutionPlan>();
const lifecyclePlanIds = new Map<string, string>();
let registered = false;

function asOkxPlan(plan: FundingExecutionPlan): OkxFundingExecutionPlan | null {
  const candidate = plan as Partial<OkxFundingExecutionPlan>;
  return candidate.okx ? plan as OkxFundingExecutionPlan : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function terminalFilled(instId: string, ordId: string): Promise<{ filled: boolean; quantity: number }> {
  const row = await queryOrder(instId, ordId);
  const state = String(row.state || '').toLowerCase();
  const quantity = Number(row.accFillSz || 0);
  return { filled: state === 'filled' && quantity > 0, quantity };
}

async function emergencyNeutralize(input: { plan: OkxFundingExecutionPlan; spotFilled: boolean; perpFilled: boolean }): Promise<void> {
  const operations: Promise<unknown>[] = [];
  if (input.spotFilled) operations.push(placeOrder({ instId: input.plan.okx.spotInstId, tdMode: 'cash', side: 'sell', size: input.plan.okx.baseQuantity, ordType: 'market' }));
  if (input.perpFilled) operations.push(placeOrder({ instId: input.plan.okx.swapInstId, tdMode: 'cross', side: 'buy', size: input.plan.okx.contracts, ordType: 'market', reduceOnly: true }));
  await Promise.allSettled(operations);
}

async function orderFillEconomics(input: { instType: 'SPOT' | 'SWAP'; instId: string; ordId: string; side: 'buy' | 'sell'; baseAsset: string; quoteAsset: string }): Promise<{ quoteCashflow: number; pnl: number; feeDeltaQuote: number; fills: number }> {
  const response = await okxPrivateRequest('/api/v5/trade/fills', 'GET', { instType: input.instType, instId: input.instId, ordId: input.ordId, limit: '100' }, { lane: 'account_read' });
  let quoteCashflow = 0;
  let pnl = 0;
  let feeDeltaQuote = 0;
  let fills = 0;
  for (const row of response.data) {
    if (String(row.ordId || '') !== input.ordId) continue;
    const size = finite(row.fillSz);
    const price = finite(row.fillPx);
    if (size === null || size <= 0 || price === null || price <= 0) continue;
    fills += 1;
    if (input.instType === 'SPOT') quoteCashflow += (input.side === 'sell' ? 1 : -1) * size * price;
    const fillPnl = finite(row.fillPnl);
    if (fillPnl !== null) pnl += fillPnl;
    const fee = finite(row.fee);
    const feeCcy = String(row.feeCcy || '').trim().toUpperCase();
    if (fee !== null && fee !== 0) {
      if (feeCcy === input.quoteAsset) feeDeltaQuote += fee;
      else if (feeCcy === input.baseAsset) feeDeltaQuote += fee * price;
      else throw new Error(`OKX funding fill fee currency ${feeCcy || 'missing'} cannot be valued canonically`);
    }
  }
  if (fills === 0) throw new Error(`OKX funding order ${input.ordId} has no authenticated fills`);
  return { quoteCashflow, pnl, feeDeltaQuote, fills };
}

async function fundingPaymentQuote(input: { instId: string; openedAt: number; closedAt: number }): Promise<number> {
  const response = await okxPrivateRequest('/api/v5/account/bills', 'GET', { instType: 'SWAP', instId: input.instId, type: '8', limit: '100' }, { lane: 'account_read' });
  let total = 0;
  for (const row of response.data) {
    const ts = Number(row.ts || 0);
    if (!Number.isFinite(ts) || ts < input.openedAt - 5_000 || ts > input.closedAt + 5_000) continue;
    const subType = String(row.subType || '');
    if (subType !== '173' && subType !== '174') continue;
    const change = finite(row.balChg) ?? finite(row.pnl);
    if (change !== null) total += change;
  }
  return total;
}

const adapter: FundingLifecycleAdapter = {
  venue: 'okx',
  async verifyCurrentPlan(plan) {
    const okx = asOkxPlan(plan);
    if (!okx || okx.expiresAt <= Date.now() || okx.okx.evidenceExpiresAt <= Date.now()) return false;
    const baseUrl = await getOkxExecutionRestBaseUrl();
    const response = await fetch(`${baseUrl}/api/v5/public/funding-rate?instId=${encodeURIComponent(okx.okx.swapInstId)}`).then(r => r.json()).catch(() => null);
    const row = response?.code === '0' ? response?.data?.[0] : null;
    if (!row || String(row.settState || '').toLowerCase() !== 'processing') return false;
    const locked = Number(row.settFundingRate);
    return Number.isFinite(locked) && Math.abs(locked - okx.okx.lockedFundingRate) <= 1e-12;
  },
  async openDeltaNeutral(plan, lifecycleId) {
    const okx = asOkxPlan(plan);
    if (!okx) throw new Error('OKX funding plan extension missing');
    lifecyclePlanIds.set(lifecycleId, okx.opportunityId);
    const [perpSubmit, spotSubmit] = await Promise.allSettled([
      placeOrder({ instId: okx.okx.swapInstId, tdMode: 'cross', side: 'sell', size: okx.okx.contracts, price: okx.okx.entry.perpEntryLimit, ordType: 'fok' }),
      placeOrder({ instId: okx.okx.spotInstId, tdMode: 'cash', side: 'buy', size: okx.okx.baseQuantity, price: okx.okx.entry.spotEntryLimit, ordType: 'fok' }),
    ]);
    const perpOrderId = perpSubmit.status === 'fulfilled' ? perpSubmit.value : null;
    const spotOrderId = spotSubmit.status === 'fulfilled' ? spotSubmit.value : null;
    const [perpState, spotState] = await Promise.all([
      perpOrderId ? terminalFilled(okx.okx.swapInstId, perpOrderId).catch(() => ({ filled: false, quantity: 0 })) : Promise.resolve({ filled: false, quantity: 0 }),
      spotOrderId ? terminalFilled(okx.okx.spotInstId, spotOrderId).catch(() => ({ filled: false, quantity: 0 })) : Promise.resolve({ filled: false, quantity: 0 }),
    ]);
    const perpBase = perpState.quantity > 0 ? perpState.quantity / okx.okx.contracts * okx.okx.baseQuantity : 0;
    const deltaNeutral = perpState.filled && spotState.filled && Math.abs(spotState.quantity - perpBase) <= Math.max(1e-10, okx.okx.baseQuantity * 1e-6);
    if (!deltaNeutral) {
      await emergencyNeutralize({ plan: okx, spotFilled: spotState.filled, perpFilled: perpState.filled });
      lifecyclePlanIds.delete(lifecycleId);
      throw new Error('OKX funding entry legs did not reach terminal delta-neutral fills; emergency neutralization invoked');
    }
    return { lifecycleId, spotOrderId: spotOrderId!, perpOrderId: perpOrderId!, openedAt: Date.now(), deltaNeutral: true, measuredSpotQuantity: spotState.quantity, measuredPerpQuantity: perpBase };
  },
  async marginHealthy(receipt) {
    const opportunityId = lifecyclePlanIds.get(receipt.lifecycleId);
    const plan = opportunityId ? preparedPlans.get(opportunityId) ?? null : null;
    if (!plan) return false;
    const response = await okxPrivateRequest('/api/v5/account/positions', 'GET', { instId: plan.okx.swapInstId }, { lane: 'account_read' });
    const row = response.data.find(item => String(item?.instId || '').toUpperCase() === plan.okx.swapInstId) || response.data[0];
    if (!row) return false;
    const pos = Math.abs(Number(row.pos || 0));
    const mgnRatio = Number(row.mgnRatio || Number.POSITIVE_INFINITY);
    const minimumRatio = Math.max(1.01, Number(process.env.CRYPTOCRAWL_FUNDING_MIN_MARGIN_RATIO || 1.20));
    return Number.isFinite(pos) && pos >= plan.okx.contracts * 0.999999 && Number.isFinite(mgnRatio) && mgnRatio >= minimumRatio;
  },
  async closeAndSettle(plan, receipt) {
    const okx = asOkxPlan(plan);
    if (!okx) throw new Error('OKX funding plan extension missing at close');
    const fresh = await measureOkxFundingExecutionEvidence({ symbol: okx.okx.baseAsset + okx.okx.quoteAsset, swapInstId: okx.okx.swapInstId, targetNotionalUsd: okx.notionalUsd });
    if (!fresh) throw new Error('OKX funding close depth unavailable');
    const [perpClose, spotClose] = await Promise.allSettled([
      placeOrder({ instId: okx.okx.swapInstId, tdMode: 'cross', side: 'buy', size: okx.okx.contracts, price: fresh.perpExitLimit, ordType: 'fok', reduceOnly: true }),
      placeOrder({ instId: okx.okx.spotInstId, tdMode: 'cash', side: 'sell', size: receipt.measuredSpotQuantity, price: fresh.spotExitLimit, ordType: 'fok' }),
    ]);
    const perpCloseId = perpClose.status === 'fulfilled' ? perpClose.value : null;
    const spotCloseId = spotClose.status === 'fulfilled' ? spotClose.value : null;
    const [perpClosed, spotClosed] = await Promise.all([
      perpCloseId ? terminalFilled(okx.okx.swapInstId, perpCloseId).catch(() => ({ filled: false, quantity: 0 })) : Promise.resolve({ filled: false, quantity: 0 }),
      spotCloseId ? terminalFilled(okx.okx.spotInstId, spotCloseId).catch(() => ({ filled: false, quantity: 0 })) : Promise.resolve({ filled: false, quantity: 0 }),
    ]);
    if (!perpClosed.filled || !spotClosed.filled) {
      await emergencyNeutralize({ plan: okx, spotFilled: !spotClosed.filled, perpFilled: !perpClosed.filled });
      throw new Error('OKX funding close did not terminally fill both legs');
    }
    const closedAt = Date.now();
    const [spotOpenEcon, spotCloseEcon, perpOpenEcon, perpCloseEcon, fundingQuote, prices] = await Promise.all([
      orderFillEconomics({ instType: 'SPOT', instId: okx.okx.spotInstId, ordId: receipt.spotOrderId, side: 'buy', baseAsset: okx.okx.baseAsset, quoteAsset: okx.okx.quoteAsset }),
      orderFillEconomics({ instType: 'SPOT', instId: okx.okx.spotInstId, ordId: spotCloseId!, side: 'sell', baseAsset: okx.okx.baseAsset, quoteAsset: okx.okx.quoteAsset }),
      orderFillEconomics({ instType: 'SWAP', instId: okx.okx.swapInstId, ordId: receipt.perpOrderId, side: 'sell', baseAsset: okx.okx.baseAsset, quoteAsset: okx.okx.quoteAsset }),
      orderFillEconomics({ instType: 'SWAP', instId: okx.okx.swapInstId, ordId: perpCloseId!, side: 'buy', baseAsset: okx.okx.baseAsset, quoteAsset: okx.okx.quoteAsset }),
      fundingPaymentQuote({ instId: okx.okx.swapInstId, openedAt: receipt.openedAt, closedAt }),
      coinGeckoPriceClient.getLiveSymbolPrices([okx.okx.quoteAsset]),
    ]);
    const quoteUsd = prices.get(okx.okx.quoteAsset);
    if (!Number.isFinite(quoteUsd) || Number(quoteUsd) <= 0) throw new Error('OKX funding terminal quote-currency USD price unavailable');
    const grossPnlUsd = (spotOpenEcon.quoteCashflow + spotCloseEcon.quoteCashflow + perpOpenEcon.pnl + perpCloseEcon.pnl) * Number(quoteUsd);
    const fundingPaymentUsd = fundingQuote * Number(quoteUsd);
    const signedFees = spotOpenEcon.feeDeltaQuote + spotCloseEcon.feeDeltaQuote + perpOpenEcon.feeDeltaQuote + perpCloseEcon.feeDeltaQuote;
    const realizedFeesUsd = -signedFees * Number(quoteUsd);
    const realizedNetProfitUsd = grossPnlUsd + fundingPaymentUsd - realizedFeesUsd;
    lifecyclePlanIds.delete(receipt.lifecycleId);
    return {
      lifecycleId: receipt.lifecycleId,
      terminal: true,
      settlementConfirmed: true,
      spotClosed: true,
      perpClosed: true,
      fundingPaymentUsd,
      realizedEntryExitPnlUsd: grossPnlUsd,
      realizedFeesUsd,
      realizedNetProfitUsd,
      settledAt: closedAt,
      provenance: ['okx_authenticated_spot_and_swap_fills', 'okx_authenticated_funding_bills:type_8', 'okx_terminal_both_legs_closed', 'coingecko_live_quote_currency_usd', 'synthetic_evidence:false'],
    } satisfies FundingTerminalSettlement;
  },
};

export function ensureOkxFundingLifecycleAdapterRegistered(): void {
  if (registered) return;
  fundingPositionLifecycle.registerAdapter(adapter);
  registered = true;
  logger.info('[FundingLifecycle] OKX production funding adapter registered', { component: 'OkxFundingLifecycleAdapter', venue: 'okx', executionAuthority: 'funding_position_lifecycle', privateRequestAuthority: 'cex_private_authority', terminalEvidence: 'authenticated_fills_plus_funding_bills' });
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
