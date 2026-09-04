import { createHash, randomUUID } from 'node:crypto';
import {
  createCoinbaseRestJwt,
  getCoinbaseKeyPermissions,
} from './coinbase-advanced-trade-authority.js';

const COINBASE_ORIGIN = 'https://api.coinbase.com';
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_COINBASE_TRANSFER_TIMEOUT_MS || 15_000));
const READ_RETRIES = Math.max(0, Math.min(4, Math.floor(Number(process.env.CRYPTO_COINBASE_TRANSFER_READ_RETRIES || 2))));

export type CoinbaseTransferNetwork = 'ethereum' | 'base' | 'polygon' | 'bitcoin' | 'solana' | string;

export interface CoinbaseTransferAccount {
  accountId: string;
  asset: string;
  balance: string;
}

export interface CoinbaseReceiveAddress {
  accountId: string;
  addressId: string;
  address: string;
  network: string;
}

export interface CoinbaseCryptoTransactionResult {
  accountId: string;
  transactionId: string;
  status: string;
  networkStatus: string | null;
  transactionHash: string | null;
  network: string | null;
  debitAmount: string;
  debitAsset: string;
  networkFeeAmount: string;
  networkFeeAsset: string | null;
  transactionAmount: string | null;
  transactionAmountAsset: string | null;
  destinationAddress: string | null;
  idempotencyKey: string | null;
  raw: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function finitePositiveDecimal(value: unknown, label: string): string {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw new Error(`${label} must be a positive decimal string`);
  return raw;
}

function absoluteDecimal(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return '0';
  return raw.startsWith('-') ? raw.slice(1) : raw;
}

export function deterministicCoinbaseTransferIdempotencyKey(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`.toLowerCase();
}

async function request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<any> {
  if (!path.startsWith('/v2/')) throw new Error(`Unsupported Coinbase App transfer path: ${path}`);
  const attempts = method === 'GET' ? READ_RETRIES + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const jwt = createCoinbaseRestJwt(method, path.split('?')[0]);
      const response = await fetch(new URL(path, COINBASE_ORIGIN), {
        method,
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${jwt}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: any = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
      if (response.status === 429 && method === 'GET' && attempt + 1 < attempts) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(10_000, retryAfter * 1_000) : 250 * (2 ** attempt));
        continue;
      }
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.message || payload?.error || payload?.message || `HTTP ${response.status}`;
        throw new Error(`Coinbase App transfer request failed ${method} ${path}: ${String(detail)}`);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Coinbase App transfer request exhausted retries: ${method} ${path}`);
}

async function requirePermissions(required: { transfer?: boolean; receive?: boolean }): Promise<void> {
  const permissions = await getCoinbaseKeyPermissions(true);
  if (!permissions.canView) throw new Error('Coinbase transfer key lacks view permission');
  if (required.transfer && !permissions.canTransfer) throw new Error('Coinbase transfer key lacks transfer permission');
  if (required.receive && !permissions.canReceive) throw new Error('Coinbase transfer key lacks receive permission');
}

function normalizeTransaction(accountId: string, row: any): CoinbaseCryptoTransactionResult {
  const network = row?.network || {};
  const fee = network?.transaction_fee || {};
  const txAmount = network?.transaction_amount || {};
  const debitAsset = String(row?.amount?.currency || '').trim().toUpperCase();
  return {
    accountId,
    transactionId: String(row?.id || '').trim(),
    status: String(row?.status || '').trim().toLowerCase(),
    networkStatus: network?.status ? String(network.status).trim().toLowerCase() : null,
    transactionHash: String(network?.hash || row?.hash || '').trim() || null,
    network: String(network?.network_name || network?.name || '').trim().toLowerCase() || null,
    debitAmount: absoluteDecimal(row?.amount?.amount),
    debitAsset,
    networkFeeAmount: absoluteDecimal(fee?.amount),
    networkFeeAsset: String(fee?.currency || '').trim().toUpperCase() || null,
    transactionAmount: txAmount?.amount == null ? null : absoluteDecimal(txAmount.amount),
    transactionAmountAsset: String(txAmount?.currency || '').trim().toUpperCase() || null,
    destinationAddress: String(row?.to?.address || '').trim() || null,
    idempotencyKey: String(row?.idem || '').trim().toLowerCase() || null,
    raw: row || {},
  };
}

export async function resolveCoinbaseTransferAccount(assetInput: string): Promise<CoinbaseTransferAccount> {
  await requirePermissions({});
  const asset = assetInput.trim().toUpperCase();
  if (!asset) throw new Error('Coinbase transfer asset is required');
  let path = '/v2/accounts?limit=100';
  for (let page = 0; page < 10; page += 1) {
    const payload = await request(path, 'GET');
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    let candidates = rows.filter((row: any) => String(row?.currency?.code || row?.balance?.currency || '').trim().toUpperCase() === asset);
    if (candidates.length > 1) {
      const wallet = candidates.filter((row: any) => String(row?.type || '').toLowerCase() === 'wallet');
      if (wallet.length === 1) candidates = wallet;
    }
    if (candidates.length === 1) {
      const row = candidates[0];
      return { accountId: String(row.id), asset, balance: String(row?.balance?.amount ?? '0') };
    }
    const next = String(payload?.pagination?.next_uri || '').trim();
    if (!next) break;
    const url = new URL(next, COINBASE_ORIGIN);
    path = `${url.pathname}${url.search}`;
  }
  throw new Error(`Coinbase transfer account could not be resolved uniquely for ${asset}`);
}

export async function createCoinbaseReceiveAddress(input: {
  asset: string;
  network: CoinbaseTransferNetwork;
  name?: string;
}): Promise<CoinbaseReceiveAddress> {
  await requirePermissions({ receive: true });
  const account = await resolveCoinbaseTransferAccount(input.asset);
  const payload = await request(`/v2/accounts/${encodeURIComponent(account.accountId)}/addresses`, 'POST', {
    name: input.name || 'CryptoCrawler system-capital receive',
    network: input.network,
  });
  const row = payload?.data;
  const address = String(row?.address || '').trim();
  const network = String(row?.network || '').trim().toLowerCase();
  if (!address || !network || network !== String(input.network).trim().toLowerCase()) {
    throw new Error(`Coinbase receive address did not prove requested network ${input.network}`);
  }
  return { accountId: account.accountId, addressId: String(row?.id || ''), address, network };
}

export async function listCoinbaseAddressTransactions(input: {
  accountId: string;
  addressId: string;
}): Promise<CoinbaseCryptoTransactionResult[]> {
  await requirePermissions({});
  const payload = await request(`/v2/accounts/${encodeURIComponent(input.accountId)}/addresses/${encodeURIComponent(input.addressId)}/transactions`, 'GET');
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map((row: any) => normalizeTransaction(input.accountId, row))
    .filter(item => Boolean(item.transactionId));
}

export async function sendCoinbaseCrypto(input: {
  asset: string;
  amount: string;
  to: string;
  network: CoinbaseTransferNetwork;
  idempotencyKey?: string;
  destinationTag?: string;
}): Promise<CoinbaseCryptoTransactionResult> {
  await requirePermissions({ transfer: true });
  const account = await resolveCoinbaseTransferAccount(input.asset);
  const amount = finitePositiveDecimal(input.amount, 'Coinbase send amount');
  const idem = (input.idempotencyKey || randomUUID()).toLowerCase();
  const payload = await request(`/v2/accounts/${encodeURIComponent(account.accountId)}/transactions`, 'POST', {
    type: 'send', to: input.to, amount, currency: account.asset, network: input.network, idem,
    ...(input.destinationTag ? { destination_tag: input.destinationTag } : {}),
  });
  const result = normalizeTransaction(account.accountId, payload?.data);
  if (!result.transactionId) throw new Error('Coinbase send returned no durable transaction id');
  if (result.idempotencyKey && result.idempotencyKey !== idem) throw new Error('Coinbase send returned a different idempotency key');
  return result;
}

export async function getCoinbaseCryptoTransaction(accountId: string, transactionId: string): Promise<CoinbaseCryptoTransactionResult> {
  await requirePermissions({});
  const payload = await request(`/v2/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(transactionId)}`, 'GET');
  const result = normalizeTransaction(accountId, payload?.data);
  if (!result.transactionId) throw new Error(`Coinbase transaction ${transactionId} was not found`);
  return result;
}
