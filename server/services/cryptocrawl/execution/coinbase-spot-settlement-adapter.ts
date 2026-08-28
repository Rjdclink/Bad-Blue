import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import {
  assertCoinbaseSpotTradeReady,
  coinbasePrivateRequest,
} from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';
import { validateCoinbaseOrderAgainstProduct } from './coinbase-product-policy.js';
import type {
  ExecutionFill,
  ExecutionStatus,
  NormalizedOrderSettlement,
} from './settlement-types.js';

export interface CoinbaseOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
}

export interface CoinbaseOrderReceipt {
  venue: 'coinbase';
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  requestedQuantity: number;
  submittedAt: number;
}

export type CoinbasePrivateRequester = typeof coinbasePrivateRequest;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Serialize the already-validated numeric value without imposing a second,
 * undocumented decimal-place limit. Number#toString is canonical but may emit
 * exponent notation for small increments; Coinbase order amounts are sent as
 * plain decimal strings, so expand exponent notation exactly at this boundary.
 */
export function coinbaseDecimalString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Coinbase order values must be finite and positive');
  const canonical = value.toString().toLowerCase();
  if (!canonical.includes('e')) return canonical;

  const [coefficient, exponentText] = canonical.split('e');
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) throw new Error('Coinbase order value has an invalid numeric exponent');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) return `0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function coinbaseProductId(symbol: string): string {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported Coinbase spot symbol: ${symbol}`);
  return `${match[1]}-${match[2]}`;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classify(row: any, requestedQuantity: number): { status: ExecutionStatus; terminal: boolean } {
  const raw = String(row?.status || '').trim().toUpperCase();
  const filled = finite(row?.filled_size) ?? 0;
  const complete = requestedQuantity > 0 && filled >= requestedQuantity * (1 - 1e-8);
  if (raw.includes('REJECT') || raw === 'FAILED') return { status: 'rejected', terminal: true };
  if (complete && row?.settled === true) return { status: 'filled', terminal: true };
  if (row?.settled === true || ['FILLED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(raw)) {
    if (filled > 0) return { status: complete ? 'filled' : 'partially_filled', terminal: true };
    return { status: raw === 'FILLED' ? 'failed' : 'cancelled', terminal: true };
  }
  if (filled > 0) return { status: 'partially_filled', terminal: false };
  return { status: 'submitted', terminal: false };
}

export function parseCoinbaseFills(payload: any, orderId: string): ExecutionFill[] {
  return (Array.isArray(payload?.fills) ? payload.fills : [])
    .filter((fill: any) => String(fill?.order_id || '') === orderId)
    .map((fill: any) => ({
      quantity: positive(fill?.size) || 0,
      price: positive(fill?.price) || 0,
      // Advanced Trade commission is quoted in the product quote currency for
      // spot fills. Keep the asset explicit so realized economics can fail closed
      // if a future response changes currency semantics.
      feeAmount: finite(fill?.commission),
      feeAsset: typeof fill?.product_id === 'string'
        ? fill.product_id.trim().toUpperCase().split('-')[1] || null
        : null,
      timestamp: timestamp(fill?.trade_time),
      tradeId: typeof fill?.trade_id === 'string' ? fill.trade_id : undefined,
    }))
    .filter((fill: ExecutionFill) => fill.quantity > 0 && fill.price > 0);
}

function aggregateFee(fills: ExecutionFill[], fallback: unknown): number | null {
  if (fills.length === 0) return finite(fallback);
  if (fills.some(fill => fill.feeAmount === null)) return null;
  return fills.reduce((sum, fill) => sum + (fill.feeAmount || 0), 0);
}

function aggregateFeeAsset(fills: ExecutionFill[], productId: string): string | null {
  const assets = fills.map(fill => fill.feeAsset).filter((value): value is string => Boolean(value));
  if (assets.length === 0) return productId.split('-')[1] || null;
  const first = assets[0].toUpperCase();
  return assets.every(asset => asset.toUpperCase() === first) ? first : null;
}

export function parseCoinbaseOrderSettlement(input: {
  receipt: CoinbaseOrderReceipt;
  orderPayload: any;
  fillsPayload?: any;
  finalBalances?: Record<string, string>;
}): NormalizedOrderSettlement {
  const row = input.orderPayload?.order;
  if (!row) throw new Error(`Coinbase returned no order state for ${input.receipt.orderId}`);
  const requestedQuantity = positive(row?.order_configuration?.sor_limit_ioc?.base_size)
    ?? input.receipt.requestedQuantity;
  const filledQuantity = Math.max(0, finite(row?.filled_size) ?? 0);
  const averageFillPrice = positive(row?.average_filled_price);
  const productId = typeof row?.product_id === 'string' ? row.product_id.trim().toUpperCase() : coinbaseProductId(input.receipt.symbol);
  const fills = parseCoinbaseFills(input.fillsPayload || {}, input.receipt.orderId);
  const classification = classify(row, requestedQuantity);
  const totalFee = aggregateFee(fills, row?.total_fees);
  const createdAt = timestamp(row?.created_time) ?? input.receipt.submittedAt;
  const terminalAt = classification.terminal
    ? timestamp(row?.last_fill_time) ?? timestamp(row?.end_time) ?? Date.now()
    : null;
  const rejectMessage = typeof row?.reject_message === 'string' && row.reject_message.trim()
    ? row.reject_message.trim()
    : typeof row?.cancel_message === 'string' && row.cancel_message.trim()
      ? row.cancel_message.trim()
      : undefined;

  return {
    venue: 'coinbase',
    orderId: input.receipt.orderId,
    symbol: input.receipt.symbol,
    side: input.receipt.side,
    status: classification.status,
    terminal: classification.terminal,
    requestedQuantity,
    filledQuantity,
    remainingQuantity: Math.max(0, requestedQuantity - filledQuantity),
    averageFillPrice,
    fills,
    feeAmount: totalFee,
    feeAsset: aggregateFeeAsset(fills, productId),
    submittedAt: createdAt,
    terminalAt,
    finalBalances: input.finalBalances,
    error: rejectMessage,
  };
}

async function readCoinbaseBalances(requester: CoinbasePrivateRequester): Promise<Record<string, string>> {
  const payload = await requester('/api/v3/brokerage/accounts', 'GET', { query: { limit: '250' } });
  const output: Record<string, string> = {};
  for (const account of Array.isArray(payload?.accounts) ? payload.accounts : []) {
    const currency = typeof account?.currency === 'string' ? account.currency.trim().toUpperCase() : '';
    const available = account?.available_balance?.value;
    if (!currency || !Number.isFinite(Number(available))) continue;
    output[currency] = String(available);
  }
  return output;
}

/**
 * Settlement-safe Coinbase Advanced Trade spot adapter. Authenticated permission
 * checks happen before live submission, every terminal order is queried through
 * Advanced Trade, and balances are exposed to the canonical inventory ledger so
 * Coinbase can participate only when real spendable inventory is reconciled.
 */
export class CoinbaseSpotSettlementAdapter {
  constructor(private readonly requester: CoinbasePrivateRequester = coinbasePrivateRequest) {}

  async submit(request: CoinbaseOrderRequest): Promise<CoinbaseOrderReceipt> {
    if (this.requester === coinbasePrivateRequest) {
      await assertCoinbaseSpotTradeReady();
      // Re-read current public product constraints immediately before a live
      // authenticated order. The planning path already normalizes quantity;
      // this assertion protects against metadata/state changes between scan and
      // submission. Injected requesters remain deterministic for isolated tests.
      const constraints = await getCoinbaseAdvancedProductConstraints(request.symbol);
      const constraintCheck = validateCoinbaseOrderAgainstProduct(
        { quantity: request.quantity, price: request.price },
        constraints,
      );
      if (!constraintCheck.valid) {
        throw new Error(`Coinbase order violates current product constraints: ${constraintCheck.reason}`);
      }
    }
    const submittedAt = Date.now();
    const payload = await this.requester('/api/v3/brokerage/orders', 'POST', {
      body: {
        client_order_id: randomUUID(),
        product_id: coinbaseProductId(request.symbol),
        side: request.side.toUpperCase(),
        order_configuration: {
          sor_limit_ioc: {
            base_size: coinbaseDecimalString(request.quantity),
            limit_price: coinbaseDecimalString(request.price),
          },
        },
      },
    });
    if (payload?.success !== true || !payload?.success_response?.order_id) {
      const message = payload?.error_response?.message || payload?.error_response?.error_details || 'unknown Coinbase order rejection';
      throw new Error(`Coinbase rejected IOC order: ${String(message)}`);
    }
    return {
      venue: 'coinbase',
      orderId: String(payload.success_response.order_id),
      symbol: request.symbol,
      side: request.side,
      requestedQuantity: request.quantity,
      submittedAt,
    };
  }

  async query(receipt: CoinbaseOrderReceipt): Promise<NormalizedOrderSettlement> {
    const orderPayload = await this.requester(`/api/v3/brokerage/orders/historical/${encodeURIComponent(receipt.orderId)}`, 'GET');
    let fillsPayload: any = {};
    try {
      fillsPayload = await this.requester('/api/v3/brokerage/orders/historical/fills', 'GET', {
        query: { order_ids: [receipt.orderId], limit: '100' },
      });
    } catch (error) {
      logger.warn('[Coinbase] Fill details unavailable; aggregate terminal fee will be retained if present', {
        component: 'CoinbaseSpotSettlementAdapter',
        orderId: receipt.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const provisional = parseCoinbaseOrderSettlement({ receipt, orderPayload, fillsPayload });
    if (!provisional.terminal) return provisional;
    let finalBalances: Record<string, string> | undefined;
    try {
      finalBalances = await this.getBalances();
    } catch (error) {
      logger.warn('[Coinbase] Final balance snapshot unavailable after terminal order', {
        component: 'CoinbaseSpotSettlementAdapter',
        orderId: receipt.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return parseCoinbaseOrderSettlement({ receipt, orderPayload, fillsPayload, finalBalances });
  }

  async cancel(receipt: CoinbaseOrderReceipt): Promise<void> {
    const payload = await this.requester('/api/v3/brokerage/orders/batch_cancel', 'POST', {
      body: { order_ids: [receipt.orderId] },
    });
    const result = Array.isArray(payload?.results) ? payload.results.find((row: any) => row?.order_id === receipt.orderId) : null;
    if (result && result.success === false) {
      throw new Error(`Coinbase cancel rejected: ${result.failure_reason || 'unknown failure'}`);
    }
  }

  async getBalances(): Promise<Record<string, string>> {
    return readCoinbaseBalances(this.requester);
  }
}
