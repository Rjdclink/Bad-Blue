import { createHash } from 'node:crypto';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { krakenPrivateRequest, OkxPrivateApiError, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import {
  getExactSystemCapitalOrderAssetDeltas,
  type ExactCexOrderAssetDeltaEvidence,
} from './cex-system-capital-settlement-evidence.js';
import {
  applyExactCexSystemOwnedSettlement,
  type CexSystemCapitalSettlementAuthority,
} from './cex-system-owned-lot-ledger.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type ExecutableCexVenue,
} from './cex-settlement.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';

export type KalshiFundingHedgeVenue = 'kraken' | 'okx';

export interface KalshiFundingCexOrderIntent {
  venue: KalshiFundingHedgeVenue;
  lifecycleId: string;
  leg: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  ordType?: 'fok' | 'market';
}

function clientOrderId(lifecycleId: string, leg: string): string {
  return createHash('sha256').update(`kalshi-funding:${lifecycleId}:${leg}`).digest('hex').slice(0, 32);
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function recoverKrakenOrder(clientId: string): Promise<string | null> {
  const responses = await Promise.all([
    krakenPrivateRequest('/0/private/OpenOrders', { trades: 'true' }),
    krakenPrivateRequest('/0/private/ClosedOrders', { trades: 'true' }),
  ]);
  const normalizedClientId = clientId.replace(/-/g, '').toLowerCase();
  const matches: string[] = [];
  for (const response of responses) {
    for (const collectionName of ['open', 'closed']) {
      const collection = response?.[collectionName] || {};
      for (const [orderId, value] of Object.entries(collection)) {
        const order: any = value;
        const observed = String(order?.cl_ord_id || order?.clOrdId || '').replace(/-/g, '').toLowerCase();
        if (observed && observed === normalizedClientId) matches.push(orderId);
      }
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) throw new Error(`Multiple Kraken orders match Kalshi funding client id ${clientId}`);
  return unique[0] || null;
}

async function recoverOkxOrder(symbol: string, clientId: string): Promise<string | null> {
  const constraints = await getSpotProductConstraints('okx', symbol, true);
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', {
      instId: constraints.exchangeSymbol,
      clOrdId: clientId,
    }, { lane: 'order_read' });
    const row = response.data?.[0];
    if (!row || String(row.clOrdId || '') !== clientId) {
      throw new Error(`OKX Kalshi hedge client-order lookup identity mismatch ${clientId}`);
    }
    return row.ordId ? String(row.ordId) : null;
  } catch (error) {
    if (error instanceof OkxPrivateApiError && String(error.code) === '51603') return null;
    const message = error instanceof Error ? error.message : String(error);
    if (/51603|order.*does not exist|order.*not exist/i.test(message)) return null;
    throw error;
  }
}

export async function recoverKalshiFundingCexOrder(input: {
  venue: KalshiFundingHedgeVenue;
  lifecycleId: string;
  leg: string;
  symbol: string;
}): Promise<string | null> {
  const id = clientOrderId(input.lifecycleId, input.leg);
  return input.venue === 'kraken'
    ? recoverKrakenOrder(id)
    : recoverOkxOrder(input.symbol, id);
}

export async function placeOrRecoverKalshiFundingCexOrder(input: KalshiFundingCexOrderIntent): Promise<{
  orderId: string;
  submittedAt: number;
}> {
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
    throw new Error('Kalshi funding CEX hedge quantity must be finite and positive');
  }
  if ((input.ordType || 'fok') === 'fok' && (!(input.price! > 0) || !Number.isFinite(input.price))) {
    throw new Error('Kalshi funding CEX FOK hedge requires a finite positive limit price');
  }
  const constraints = await getSpotProductConstraints(input.venue, input.symbol, true);
  const id = clientOrderId(input.lifecycleId, input.leg);
  const recovered = await recoverKalshiFundingCexOrder(input);
  if (recovered) return { orderId: recovered, submittedAt: Date.now() };

  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', {
    chain: `cex:${input.venue}`,
    venue: input.venue,
    pair: input.symbol,
  });
  const submittedAt = Date.now();
  try {
    if (input.venue === 'kraken') {
      const response = await krakenPrivateRequest('/0/private/AddOrder', {
        pair: constraints.exchangeSymbol,
        type: input.side,
        ordertype: input.ordType === 'market' ? 'market' : 'limit',
        volume: cexDecimalString(input.quantity),
        ...(input.ordType === 'market' ? {} : { price: cexDecimalString(input.price!) }),
        ...(input.ordType === 'market' ? {} : { timeinforce: 'FOK' }),
        cl_ord_id: id,
      });
      const orderId = String(response?.txid?.[0] || '').trim();
      if (!orderId) throw new Error('Kraken Kalshi funding hedge returned no order id');
      return { orderId, submittedAt };
    }

    const response = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
      instId: constraints.exchangeSymbol,
      tdMode: 'cash',
      side: input.side,
      ordType: input.ordType === 'market' ? 'market' : 'fok',
      sz: cexDecimalString(input.quantity),
      ...(input.ordType === 'market' ? {} : { px: cexDecimalString(input.price!) }),
      clOrdId: id,
    }, { lane: 'order_write' });
    const row = response.data?.[0];
    if (!row || String(row.sCode || '0') !== '0' || !row.ordId) {
      throw new Error(`OKX Kalshi funding hedge rejected: ${String(row?.sMsg || 'missing order id')}`);
    }
    return { orderId: String(row.ordId), submittedAt };
  } catch (error) {
    // Ambiguous write outcomes are recovered by the deterministic client id before
    // any new submission is considered.
    const after = await recoverKalshiFundingCexOrder(input).catch(() => null);
    if (after) return { orderId: after, submittedAt };
    throw error;
  }
}

export async function queryKalshiFundingCexOrder(input: {
  venue: KalshiFundingHedgeVenue;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  requestedQuantity: number;
  submittedAt: number;
}): Promise<NormalizedOrderSettlement> {
  const adapter = createProductionCexSettlementAdapters()[input.venue as ExecutableCexVenue];
  const receipt: CexOrderReceipt = {
    venue: input.venue,
    orderId: input.orderId,
    symbol: input.symbol,
    side: input.side,
    requestedQuantity: input.requestedQuantity,
    submittedAt: input.submittedAt,
  };
  return adapter.query(receipt);
}

export async function requireTerminalKalshiFundingCexFill(input: {
  venue: KalshiFundingHedgeVenue;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  requestedQuantity: number;
  submittedAt: number;
}): Promise<NormalizedOrderSettlement> {
  const timeoutMs = Math.max(1_000, Math.min(30_000, Number(process.env.CRYPTOCRAWL_KALSHI_HEDGE_SETTLEMENT_TIMEOUT_MS || 12_000)));
  const pollMs = Math.max(100, Math.min(2_000, Number(process.env.CRYPTOCRAWL_KALSHI_HEDGE_POLL_MS || 500)));
  const deadline = Date.now() + timeoutMs;
  let settlement = await queryKalshiFundingCexOrder(input);
  while (!settlement.terminal && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    settlement = await queryKalshiFundingCexOrder(input);
  }
  const filled = finite(settlement.filledQuantity) ?? 0;
  if (!settlement.terminal || filled < input.requestedQuantity * (1 - 1e-8)) {
    throw new Error('KALSHI_FUNDING_CEX_FOK_TERMINAL_FULL_FILL_UNPROVEN');
  }
  return settlement;
}

export async function applyKalshiFundingCexSpotOwnership(input: {
  lifecycleId: string;
  opportunityId: string;
  settlement: NormalizedOrderSettlement;
  authority: CexSystemCapitalSettlementAuthority;
}): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (input.settlement.venue !== 'kraken' && input.settlement.venue !== 'okx') {
    throw new Error(`Unsupported Kalshi funding hedge ownership venue ${input.settlement.venue}`);
  }
  const evidence = await getExactSystemCapitalOrderAssetDeltas(input.settlement);
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: input.opportunityId,
    strategy: 'kalshi_cex_spot_perp_funding',
    authority: input.authority,
  });
  return evidence;
}

function canonicalFeeAsset(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper === 'ZUSD') return 'USD';
  if (upper === 'XXBT' || upper === 'XBT') return 'BTC';
  if (upper === 'XETH') return 'ETH';
  return upper;
}

/** Returns gross cashflow before fees plus the separately normalized economic fee cost. */
export function summarizeKalshiFundingCexSpotEconomics(input: {
  settlement: NormalizedOrderSettlement;
  baseAsset: string;
  quoteAsset: string;
}): { grossQuoteCashflow: number; feeCostQuote: number; filledQuantity: number; averageFillPrice: number } {
  const settlement = input.settlement;
  const quantity = finite(settlement.filledQuantity);
  const price = finite(settlement.averageFillPrice);
  if (quantity === null || quantity <= 0 || price === null || price <= 0) {
    throw new Error('Kalshi funding CEX hedge terminal fill economics incomplete');
  }
  const grossQuoteCashflow = (settlement.side === 'sell' ? 1 : -1) * quantity * price;
  const rawFee = finite(settlement.feeAmount);
  if (rawFee === null) throw new Error('Kalshi funding CEX hedge fee amount unavailable');
  let feeCostQuote = 0;
  if (rawFee !== 0) {
    if (!settlement.feeAsset) throw new Error('Kalshi funding CEX hedge fee asset unavailable');
    const feeAsset = canonicalFeeAsset(settlement.feeAsset);
    const base = canonicalFeeAsset(input.baseAsset);
    const quote = canonicalFeeAsset(input.quoteAsset);
    const economicFee = settlement.venue === 'okx' ? -rawFee : rawFee;
    if (feeAsset === quote) feeCostQuote = economicFee;
    else if (feeAsset === base) feeCostQuote = economicFee * price;
    else throw new Error(`Kalshi funding CEX hedge third-asset fee ${feeAsset} cannot be valued canonically`);
  }
  if (!Number.isFinite(feeCostQuote)) throw new Error('Kalshi funding CEX hedge normalized fee is invalid');
  return { grossQuoteCashflow, feeCostQuote, filledQuantity: quantity, averageFillPrice: price };
}