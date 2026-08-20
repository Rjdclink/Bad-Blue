import { createHmac, createHash, randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';

export interface ExchangeOrderReceipt {
  venue: QuoteVenue;
  orderId: string;
}

export interface ArbitrageExecutionResult {
  success: boolean;
  buyOrder?: ExchangeOrderReceipt;
  sellOrder?: ExchangeOrderReceipt;
  error?: string;
}

interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
}

const ORDER_SUBMIT_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.CRYPTO_ARBITRAGE_ORDER_TIMEOUT_MS || 12000),
);

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live exchange execution`);
  return value;
}

function toDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Order values must be finite and positive');
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function splitSymbol(symbol: string): { base: string; quote: string } {
  const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported spot symbol: ${symbol}`);
  return { base: match[1], quote: match[2] };
}

async function readJson(response: Response): Promise<any> {
  const body = await response.text();
  let json: any;
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Exchange returned a non-JSON response (${response.status})`);
  }
  if (!response.ok) throw new Error(`Exchange request failed (${response.status}): ${JSON.stringify(json)}`);
  return json;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function submitKrakenOrder(request: OrderRequest): Promise<string> {
  const apiKey = requireEnvironment('KRAKEN_API_KEY');
  const apiSecret = requireEnvironment('KRAKEN_API_SECRET');
  const nonce = Date.now().toString();
  const body = new URLSearchParams({
    nonce,
    pair: request.symbol,
    type: request.side,
    ordertype: 'limit',
    price: toDecimal(request.price),
    volume: toDecimal(request.quantity),
    timeinforce: 'IOC',
  }).toString();
  const path = '/0/private/AddOrder';
  const hash = createHash('sha256').update(nonce + body).digest();
  const signature = createHmac('sha512', Buffer.from(apiSecret, 'base64'))
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64');
  const response = await fetchWithTimeout(`https://api.kraken.com${path}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  }, ORDER_SUBMIT_TIMEOUT_MS);
  const payload = await readJson(response);
  if (payload.error?.length) throw new Error(`Kraken rejected order: ${payload.error.join(', ')}`);
  const orderId = payload.result?.txid?.[0];
  if (!orderId) throw new Error('Kraken did not return an order id');
  return orderId;
}

async function submitOkxOrder(request: OrderRequest): Promise<string> {
  const apiKey = requireEnvironment('OKX_API_KEY');
  const apiSecret = requireEnvironment('OKX_API_SECRET');
  const passphrase = requireEnvironment('OKX_API_PASSPHRASE');
  const { base, quote } = splitSymbol(request.symbol);
  const path = '/api/v5/trade/order';
  const body = JSON.stringify({
    instId: `${base}-${quote}`,
    tdMode: 'cash',
    side: request.side,
    ordType: 'limit',
    px: toDecimal(request.price),
    sz: toDecimal(request.quantity),
    clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
  });
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', apiSecret)
    .update(`${timestamp}POST${path}${body}`)
    .digest('base64');
  const response = await fetchWithTimeout(`https://www.okx.com${path}`, {
    method: 'POST',
    headers: {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
    },
    body,
  }, ORDER_SUBMIT_TIMEOUT_MS);
  const payload = await readJson(response);
  const order = payload.data?.[0];
  if (payload.code !== '0' || order?.sCode !== '0') {
    throw new Error(`OKX rejected order: ${order?.sMsg || payload.msg || 'unknown error'}`);
  }
  if (!order.ordId) throw new Error('OKX did not return an order id');
  return order.ordId;
}

async function submitOrder(venue: QuoteVenue, request: OrderRequest): Promise<ExchangeOrderReceipt> {
  switch (venue) {
    case 'kraken':
      return { venue, orderId: await submitKrakenOrder(request) };
    case 'okx':
      return { venue, orderId: await submitOkxOrder(request) };
    default:
      throw new Error(`Live execution is not configured for ${venue}`);
  }
}

export class CentralizedExchangeExecutor {
  async execute(plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> {
    getCryptocrawlGovernance().requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol });
    if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_EXECUTION=true is required for live orders');
    }
    if (process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK is required for live orders');
    }
    if (plan.bridge) throw new Error('Cross-chain plans require settlement orchestration and cannot be submitted as spot orders');

    const buy = { symbol: plan.symbol, side: 'buy' as const, quantity: plan.baseQty, price: plan.buyAsk };
    const sell = { symbol: plan.symbol, side: 'sell' as const, quantity: plan.baseQty, price: plan.sellBid };
    const [buyResult, sellResult] = await Promise.allSettled([
      submitOrder(plan.buyVenue, buy),
      submitOrder(plan.sellVenue, sell),
    ]);

    if (buyResult.status === 'fulfilled' && sellResult.status === 'fulfilled') {
      logger.info('[CEX Executor] IOC orders accepted', {
        component: 'CentralizedExchangeExecutor',
        symbol: plan.symbol,
        buyVenue: plan.buyVenue,
        sellVenue: plan.sellVenue,
        buyOrderId: buyResult.value.orderId,
        sellOrderId: sellResult.value.orderId,
      });
      return { success: true, buyOrder: buyResult.value, sellOrder: sellResult.value };
    }

    const errors = [buyResult, sellResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
    const acceptedOrders = [buyResult, sellResult]
      .filter((result): result is PromiseFulfilledResult<ExchangeOrderReceipt> => result.status === 'fulfilled')
      .map(result => `${result.value.venue}:${result.value.orderId}`);
    const error = `Order pair was not fully accepted: ${errors.join('; ')}`;
    logger.error('[CEX Executor] Partial or failed order pair', {
      component: 'CentralizedExchangeExecutor',
      symbol: plan.symbol,
      acceptedOrders,
      errors,
    });
    return {
      success: false,
      buyOrder: buyResult.status === 'fulfilled' ? buyResult.value : undefined,
      sellOrder: sellResult.status === 'fulfilled' ? sellResult.value : undefined,
      error,
    };
  }
}

export const centralizedExchangeExecutor = new CentralizedExchangeExecutor();