import {
  PAYOUT_QUOTES, MAX_CONVERSION_SLIPPAGE_PCT,
  type Secrets, type EthRoute,
  bool, finite, positive, sleep, deterministicId,
} from './shared.ts';

const OKX_BASE_URL = 'https://us.okx.com';

export class OkxApiError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) {
    super(['58207', '58239'].includes(code) ? `Withdrawal permission requires manual review: ${message}` : message);
    this.name = 'OkxApiError';
  }
}

async function hmacBase64(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function okxRequest(
  secrets: Secrets,
  path: string,
  method: 'GET' | 'POST',
  query: Record<string, string> = {},
  body?: Record<string, unknown>,
): Promise<any[]> {
  const search = new URLSearchParams(query).toString();
  const requestPath = `${path}${search ? `?${search}` : ''}`;
  const bodyText = body ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const sign = await hmacBase64(secrets.apiSecret, `${timestamp}${method}${requestPath}${bodyText}`);
  const result = await fetch(`${OKX_BASE_URL}${requestPath}`, {
    method,
    headers: {
      'OK-ACCESS-KEY': secrets.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': secrets.passphrase,
      'Content-Type': 'application/json',
    },
    body: bodyText || undefined,
  });
  const json = await result.json().catch(() => ({}));
  const code = String(json?.code ?? (result.ok ? '0' : result.status));
  if (!result.ok || code !== '0') {
    throw new OkxApiError(code, path, `OKX ${method} ${path} failed (${result.status}/${code}): ${String(json?.msg ?? 'unknown error')}`);
  }
  return Array.isArray(json?.data) ? json.data : [];
}

export async function okxPublic(path: string, query: Record<string, string>): Promise<any[]> {
  const result = await fetch(`${OKX_BASE_URL}${path}?${new URLSearchParams(query).toString()}`);
  const json = await result.json().catch(() => ({}));
  const code = String(json?.code ?? (result.ok ? '0' : result.status));
  if (!result.ok || code !== '0') throw new Error(`OKX public ${path} failed (${result.status}/${code})`);
  return Array.isArray(json?.data) ? json.data : [];
}

export async function getTickerPrice(instId: string): Promise<number> {
  const rows = await okxPublic('/api/v5/market/ticker', { instId });
  const price = positive(rows[0]?.last) ?? positive(rows[0]?.askPx) ?? positive(rows[0]?.bidPx);
  if (price === null) throw new Error(`No fresh price for ${instId}`);
  return price;
}

export async function getTradingBalances(secrets: Secrets, currencies?: string[]): Promise<Record<string, number>> {
  const rows = await okxRequest(secrets, '/api/v5/account/balance', 'GET', currencies?.length ? { ccy: currencies.join(',') } : {});
  const details = Array.isArray(rows[0]?.details) ? rows[0].details : [];
  return Object.fromEntries(details
    .map((row: any) => [String(row.ccy || '').toUpperCase(), finite(row.availBal ?? row.cashBal ?? row.eq)])
    .filter(([ccy]: [string, number]) => Boolean(ccy)));
}

export async function getFundingBalances(secrets: Secrets, currencies?: string[]): Promise<Record<string, number>> {
  const rows = await okxRequest(secrets, '/api/v5/asset/balances', 'GET', currencies?.length ? { ccy: currencies.join(',') } : {});
  return Object.fromEntries(rows
    .map((row: any) => [String(row.ccy || '').toUpperCase(), finite(row.availBal ?? row.bal)])
    .filter(([ccy]: [string, number]) => Boolean(ccy)));
}

function ethereumMainnetChain(chain: string): boolean {
  const normalized = chain.trim().toLowerCase();
  if (!normalized) return false;
  if (['arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'zksync', 'linea', 'scroll'].some(name => normalized.includes(name))) return false;
  return normalized.includes('erc20') || normalized.includes('ethereum');
}

export async function getEthRoute(secrets: Secrets): Promise<EthRoute> {
  const rows = await okxRequest(secrets, '/api/v5/asset/currencies', 'GET', { ccy: 'ETH' });
  const candidates = rows.map((row: any) => ({
    chain: String(row.chain || ''),
    canWithdraw: bool(row.canWd),
    mainNet: row.mainNet === undefined || row.mainNet === '' ? null : bool(row.mainNet),
    feeEth: finite(row.fee),
    minWithdrawalEth: finite(row.minWd),
    maxWithdrawalEth: finite(row.maxWd),
    precision: Math.max(0, Math.min(12, Math.trunc(finite(row.wdTickSz)))),
  }))
    .filter(route => route.canWithdraw && ethereumMainnetChain(route.chain) && route.mainNet !== false)
    .filter(route => route.feeEth >= 0 && route.minWithdrawalEth >= 0)
    .sort((a, b) => a.feeEth - b.feeEth);
  if (!candidates[0]) throw new Error('No authenticated OKX ETH Ethereum-mainnet withdrawal route is currently available');
  return candidates[0];
}

export async function getTakerCostFraction(secrets: Secrets, instId: string): Promise<number> {
  const rows = await okxRequest(secrets, '/api/v5/account/trade-fee', 'GET', { instType: 'SPOT', instId });
  const row = rows[0] || {};
  let raw: number | null = null;
  if (Array.isArray(row.feeGroup)) {
    const group = row.feeGroup.find((item: any) => Number.isFinite(Number(item?.taker)));
    raw = group ? Number(group.taker) : null;
  }
  if (raw === null && Number.isFinite(Number(row.taker))) raw = Number(row.taker);
  if (raw === null) throw new Error(`Authenticated taker fee unavailable for ${instId}`);
  // OKX: negative is commission, positive is rebate. Rebate is never prepaid funding.
  return Math.max(0, -raw);
}

export async function findOrder(secrets: Secrets, instId: string, ordId: string | null, clOrdId: string | null): Promise<any | null> {
  if (!ordId && !clOrdId) return null;
  try {
    const rows = await okxRequest(secrets, '/api/v5/trade/order', 'GET', ordId ? { instId, ordId } : { instId, clOrdId: clOrdId! });
    return rows[0] || null;
  } catch (error) {
    if (error instanceof OkxApiError && ['51603', '51400'].includes(error.code)) return null;
    throw error;
  }
}

export async function waitOrderTerminal(secrets: Secrets, instId: string, ordId: string): Promise<any | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const order = await findOrder(secrets, instId, ordId, null);
    if (!order) return null;
    const state = String(order.state || '').toLowerCase();
    if (['filled', 'canceled', 'mmp_canceled'].includes(state)) return order;
    if (attempt < 5) await sleep(250 + attempt * 150);
  }
  return null;
}

export function orderNetEth(order: any): number {
  const filled = finite(order.accFillSz ?? order.fillSz);
  const fee = finite(order.fee);
  return Math.max(0, String(order.feeCcy || '').toUpperCase() === 'ETH' ? filled + fee : filled);
}

export function orderQuoteSpent(order: any, quote: string): number {
  const baseCost = Math.max(0, finite(order.accFillSz ?? order.fillSz) * finite(order.avgPx ?? order.fillPx));
  const fee = finite(order.fee);
  return Math.max(0, String(order.feeCcy || '').toUpperCase() === quote ? baseCost - fee : baseCost);
}

export async function placeMarketOrder(
  secrets: Secrets,
  instId: string,
  side: 'buy' | 'sell',
  amount: number,
  tgtCcy: 'base_ccy' | 'quote_ccy',
  clientId: string,
): Promise<string> {
  const slippageApplies = (side === 'buy' && tgtCcy === 'base_ccy') || (side === 'sell' && tgtCcy === 'quote_ccy');
  const rows = await okxRequest(secrets, '/api/v5/trade/order', 'POST', {}, {
    instId, tdMode: 'cash', side, ordType: 'market', tgtCcy, sz: amount.toFixed(12), clOrdId: clientId,
    ...(slippageApplies ? { slippagePct: String(MAX_CONVERSION_SLIPPAGE_PCT) } : {}),
  });
  const row = rows[0] || {};
  if (String(row.sCode ?? '0') !== '0' || !row.ordId) throw new Error(`OKX market order rejected for ${instId}: ${String(row.sMsg || 'missing order id')}`);
  return String(row.ordId);
}

export async function spotInstrumentExists(instId: string): Promise<boolean> {
  try {
    const rows = await okxPublic('/api/v5/public/instruments', { instType: 'SPOT', instId });
    return rows.some((row: any) => String(row.instId || '') === instId && String(row.state || 'live') === 'live');
  } catch { return false; }
}

export async function transferState(secrets: Secrets, transferId: string | null, clientId: string): Promise<any | null> {
  try {
    const rows = await okxRequest(secrets, '/api/v5/asset/transfer-state', 'GET', transferId ? { transId: transferId, type: '0' } : { clientId, type: '0' });
    return rows[0] || null;
  } catch { return null; }
}

export async function ensureTransfer(
  secrets: Secrets,
  key: string,
  ccy: string,
  amount: number,
  from: '6' | '18',
  to: '6' | '18',
  knownTransferId: string | null = null,
): Promise<{ done: boolean; clientId: string; transferId: string | null }> {
  const clientId = await deterministicId(key);
  let state = await transferState(secrets, knownTransferId, clientId);
  let transferId = String(state?.transId || knownTransferId || '');
  if (!state && !transferId) {
    const rows = await okxRequest(secrets, '/api/v5/asset/transfer', 'POST', {}, {
      ccy, amt: amount.toFixed(12), from, to, type: '0', clientId,
    });
    transferId = String(rows[0]?.transId || '');
    if (!transferId) throw new Error(`OKX ${ccy} transfer returned no transfer id`);
    state = await transferState(secrets, transferId, clientId);
  }
  const status = String(state?.state || '').toLowerCase();
  if (status === 'failed') throw new Error(`OKX ${ccy} transfer failed`);
  return { done: status === 'success', clientId, transferId: transferId || null };
}

export async function findWithdrawal(secrets: Secrets, withdrawalId: string | null, clientId: string | null): Promise<any | null> {
  if (!withdrawalId && !clientId) return null;
  try {
    const rows = await okxRequest(secrets, '/api/v5/asset/withdrawal-history', 'GET', withdrawalId ? { wdId: withdrawalId } : { clientId: clientId! });
    return rows.find((row: any) => withdrawalId ? String(row?.wdId || '') === withdrawalId : String(row?.clientId || '') === clientId) || rows[0] || null;
  } catch { return null; }
}

export async function submitEthWithdrawal(
  secrets: Secrets,
  route: EthRoute,
  amountEth: number,
  clientId: string,
  destination: string = secrets.destination,
): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error('ETH withdrawal destination is missing or invalid');
  const rows = await okxRequest(secrets, '/api/v5/asset/withdrawal', 'POST', {}, {
    amt: amountEth.toFixed(route.precision),
    fee: route.feeEth.toFixed(route.precision),
    dest: '4', ccy: 'ETH', chain: route.chain, toAddr: destination, clientId,
    rcvrInfo: { walletType: 'private' },
  });
  const withdrawalId = String(rows[0]?.wdId || '');
  if (!withdrawalId) throw new Error('OKX accepted ETH withdrawal without withdrawal id');
  return withdrawalId;
}

export function quotePreference(current: string | null): Array<typeof PAYOUT_QUOTES[number]> {
  return current && PAYOUT_QUOTES.includes(current as any)
    ? [current as typeof PAYOUT_QUOTES[number], ...PAYOUT_QUOTES.filter(item => item !== current)]
    : [...PAYOUT_QUOTES];
}
