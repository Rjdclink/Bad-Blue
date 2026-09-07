import { createHash, createHmac } from 'node:crypto';
import { Wallet, utils } from 'ethers';
import { normalizeEvmAddress, normalizePrivateKey } from '../core/wallet-identity.js';

const CLOB_BASE = 'https://clob.polymarket.com';
const CHAIN_ID = 137;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const EXCHANGE_V2 = '0xE111180000d2663C0091e4f400237545B87B996B';
const NEG_RISK_EXCHANGE_V2 = '0xe2222d279d744050d28e00520010520000310F59';
const EXCHANGE_V3 = '0xe3333700cA9d93003F00f0F71f8515005F6c00Aa';
const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'metadata', type: 'bytes32' },
    { name: 'builder', type: 'bytes32' },
  ],
} as const;

export interface PolymarketApiCredentials {
  key: string;
  secret: string;
  passphrase: string;
  source: 'environment' | 'derived';
}

export interface PolymarketAuthenticatedAccountSnapshot {
  signerAddress: string;
  funderAddress: string;
  collateralBalanceUsd: number;
  collateralAllowanceProven: boolean;
  closedOnly: boolean;
  observedAt: number;
  credentialsSource: PolymarketApiCredentials['source'];
  provenance: string[];
}

export interface PolymarketSignedOrderPayload {
  orderId: string;
  tokenId: string;
  conditionId: string;
  salt: string;
  timestamp: string;
  body: Record<string, unknown>;
  version: 2 | 3;
  negRisk: boolean;
  provenance: string[];
}

let credentialsCache: PolymarketApiCredentials | null = null;
let credentialsInFlight: Promise<PolymarketApiCredentials> | null = null;
let versionCache: { value: 2 | 3; observedAt: number } | null = null;
let serverTimeCache: { value: number; observedAt: number } | null = null;

function trim(value: string | undefined): string { return value?.trim() ?? ''; }
function timeoutMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_POLYMARKET_HTTP_TIMEOUT_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(15_000, Math.trunc(configured))) : 5_000;
}
function signerPrivateKey(): string | null {
  return normalizePrivateKey(process.env.CRYPTOCRAWL_POLYMARKET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY);
}
function signer(): Wallet | null {
  const key = signerPrivateKey();
  return key ? new Wallet(key) : null;
}
function funderAddress(wallet: Wallet): string | null {
  const configured = trim(process.env.CRYPTOCRAWL_POLYMARKET_FUNDER_ADDRESS || process.env.POLYMARKET_FUNDER_ADDRESS);
  if (!configured) return wallet.address;
  const normalized = normalizeEvmAddress('CRYPTOCRAWL_POLYMARKET_FUNDER_ADDRESS', configured);
  // This native authority deliberately supports EOA orders only. Proxy/safe/1271
  // modes require a different order-signing contract and must remain fail closed.
  return normalized && normalized.toLowerCase() === wallet.address.toLowerCase() ? normalized : null;
}
function configuredCredentials(): PolymarketApiCredentials | null {
  const key = trim(process.env.CRYPTOCRAWL_POLYMARKET_API_KEY || process.env.POLYMARKET_API_KEY);
  const secret = trim(process.env.CRYPTOCRAWL_POLYMARKET_API_SECRET || process.env.POLYMARKET_API_SECRET || process.env.POLYMARKET_SECRET);
  const passphrase = trim(process.env.CRYPTOCRAWL_POLYMARKET_API_PASSPHRASE || process.env.POLYMARKET_API_PASSPHRASE || process.env.POLYMARKET_PASSPHRASE);
  return key && secret && passphrase ? { key, secret, passphrase, source: 'environment' } : null;
}
function parseCredentials(payload: any, source: PolymarketApiCredentials['source']): PolymarketApiCredentials | null {
  const key = trim(payload?.apiKey ?? payload?.key);
  const secret = trim(payload?.secret);
  const passphrase = trim(payload?.passphrase);
  return key && secret && passphrase ? { key, secret, passphrase, source } : null;
}
function queryString(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}
async function rawRequest<T>(path: string, init?: RequestInit, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const response = await fetch(`${CLOB_BASE}${path}${queryString(query)}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) throw new Error(`POLYMARKET_HTTP_${response.status}:${path}`);
  return response.json() as Promise<T>;
}
async function serverTimestamp(): Promise<number> {
  if (serverTimeCache && Date.now() - serverTimeCache.observedAt < 2_000) return serverTimeCache.value;
  const payload = await rawRequest<any>('/time');
  const parsed = Number(payload?.timestamp ?? payload?.time ?? payload);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('POLYMARKET_SERVER_TIME_INVALID');
  const value = parsed > 10_000_000_000 ? Math.trunc(parsed / 1_000) : Math.trunc(parsed);
  serverTimeCache = { value, observedAt: Date.now() };
  return value;
}
async function l1Headers(wallet: Wallet, nonce = 0): Promise<Record<string, string>> {
  const timestamp = await serverTimestamp();
  const signature = await wallet._signTypedData(
    { name: 'ClobAuthDomain', version: '1', chainId: CHAIN_ID },
    { ClobAuth: [
      { name: 'address', type: 'address' },
      { name: 'timestamp', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'message', type: 'string' },
    ] },
    {
      address: wallet.address,
      timestamp: String(timestamp),
      nonce,
      message: 'This message attests that I control the given wallet',
    },
  );
  return {
    POLY_ADDRESS: wallet.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: String(timestamp),
    POLY_NONCE: String(nonce),
  };
}
function decodeSecret(secret: string): Buffer {
  const normalized = secret.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}
function hmacSignature(secret: string, timestamp: number, method: string, path: string, body?: string): string {
  const message = `${timestamp}${method.toUpperCase()}${path}${body ?? ''}`;
  return createHmac('sha256', decodeSecret(secret)).update(message).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
async function deriveCredentials(): Promise<PolymarketApiCredentials> {
  const wallet = signer();
  if (!wallet || !funderAddress(wallet)) throw new Error('POLYMARKET_EOA_SIGNER_UNAVAILABLE');
  const headers = await l1Headers(wallet, 0);
  let payload: any = null;
  try {
    payload = await rawRequest<any>('/auth/api-key', { method: 'POST', headers });
  } catch {
    payload = null;
  }
  const created = parseCredentials(payload, 'derived');
  if (created) return created;
  const derived = parseCredentials(await rawRequest<any>('/auth/derive-api-key', { method: 'GET', headers }), 'derived');
  if (!derived) throw new Error('POLYMARKET_API_CREDENTIAL_DERIVATION_FAILED');
  return derived;
}

export async function getPolymarketApiCredentials(forceRefresh = false): Promise<PolymarketApiCredentials> {
  if (!forceRefresh && credentialsCache) return credentialsCache;
  const configured = configuredCredentials();
  if (configured) {
    credentialsCache = configured;
    return configured;
  }
  if (credentialsInFlight) return credentialsInFlight;
  credentialsInFlight = deriveCredentials()
    .then(value => { credentialsCache = value; return value; })
    .finally(() => { credentialsInFlight = null; });
  return credentialsInFlight;
}

export async function polymarketAuthenticatedRequest<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string | number | boolean | undefined>; body?: unknown },
): Promise<T> {
  const wallet = signer();
  if (!wallet || !funderAddress(wallet)) throw new Error('POLYMARKET_EOA_SIGNER_UNAVAILABLE');
  const credentials = await getPolymarketApiCredentials();
  const method = options?.method ?? 'GET';
  const body = options?.body === undefined ? undefined : JSON.stringify(options.body);
  const timestamp = await serverTimestamp();
  const headers: Record<string, string> = {
    POLY_ADDRESS: wallet.address,
    POLY_SIGNATURE: hmacSignature(credentials.secret, timestamp, method, path, body),
    POLY_TIMESTAMP: String(timestamp),
    POLY_API_KEY: credentials.key,
    POLY_PASSPHRASE: credentials.passphrase,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return rawRequest<T>(path, { method, headers, body }, options?.query);
}

export async function polymarketPublicRequest<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  return rawRequest<T>(path, { method: 'GET', headers: { accept: 'application/json' } }, query);
}

export async function getPolymarketCLOBVersion(forceRefresh = false): Promise<2 | 3> {
  if (!forceRefresh && versionCache && Date.now() - versionCache.observedAt < 60_000) return versionCache.value;
  const payload = await polymarketPublicRequest<any>('/version');
  const parsed = Number(payload?.version ?? payload);
  if (parsed !== 2 && parsed !== 3) throw new Error(`POLYMARKET_UNSUPPORTED_CLOB_VERSION:${parsed}`);
  versionCache = { value: parsed, observedAt: Date.now() };
  return parsed;
}

function integerBaseUnits(value: unknown): bigint | null {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  try { return BigInt(text); } catch { return null; }
}
function toUsd(baseUnits: bigint): number | null {
  if (baseUnits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(baseUnits) / 1_000_000;
}

export async function getPolymarketAuthenticatedAccountSnapshot(): Promise<PolymarketAuthenticatedAccountSnapshot> {
  const wallet = signer();
  const funder = wallet ? funderAddress(wallet) : null;
  if (!wallet || !funder) throw new Error('POLYMARKET_EOA_SIGNER_UNAVAILABLE');
  const credentials = await getPolymarketApiCredentials();
  const [balance, ban] = await Promise.all([
    polymarketAuthenticatedRequest<any>('/balance-allowance', { query: { asset_type: 'COLLATERAL', signature_type: 0 } }),
    polymarketAuthenticatedRequest<any>('/auth/ban-status/closed-only').catch(() => null),
  ]);
  const baseUnits = integerBaseUnits(balance?.balance);
  const collateralBalanceUsd = baseUnits === null ? null : toUsd(baseUnits);
  if (collateralBalanceUsd === null || collateralBalanceUsd < 0) throw new Error('POLYMARKET_COLLATERAL_BALANCE_INVALID');
  const allowances = balance?.allowances && typeof balance.allowances === 'object' ? Object.values(balance.allowances) : [];
  const collateralAllowanceProven = allowances.some(value => {
    const parsed = integerBaseUnits(value);
    return parsed !== null && parsed > 0n;
  });
  return {
    signerAddress: wallet.address,
    funderAddress: funder,
    collateralBalanceUsd,
    collateralAllowanceProven,
    closedOnly: ban?.closed_only === true,
    observedAt: Date.now(),
    credentialsSource: credentials.source,
    provenance: [
      'polymarket_clob:l1_eip712_signer_proven',
      `polymarket_clob:l2_hmac_credentials_${credentials.source}`,
      'polymarket_clob:collateral_balance_authenticated',
      collateralAllowanceProven ? 'polymarket_clob:collateral_allowance_proven' : 'polymarket_clob:collateral_allowance_missing',
      ban?.closed_only === true ? 'polymarket_clob:closed_only' : 'polymarket_clob:trading_not_closed_only',
      'polymarket_signature_type:eoa_only',
      'personal_wallet_fallback:false',
    ],
  };
}

function tickAligned(price: number, tickSize: number): boolean {
  if (!(price > 0) || !(price < 1) || !(tickSize > 0)) return false;
  const units = price / tickSize;
  return Math.abs(units - Math.round(units)) <= 1e-8;
}
function deterministicSalt(clientOrderId: string, timestamp: string): string {
  const digest = createHash('sha256').update(`${clientOrderId}|${timestamp}`).digest('hex');
  const value = BigInt(`0x${digest.slice(0, 13)}`); // <= 52 bits, safe in JSON number form.
  return value === 0n ? '1' : value.toString();
}
function metadataFor(clientOrderId: string): string {
  return utils.keccak256(utils.toUtf8Bytes(clientOrderId));
}

export async function buildPolymarketSignedOrder(input: {
  clientOrderId: string;
  tokenId: string;
  conditionId: string;
  side: 'buy' | 'sell';
  contracts: number;
  limitPrice: number;
  timestamp: string;
  tickSize: number;
  negRisk: boolean;
  timeInForce: 'fill_or_kill' | 'immediate_or_cancel' | 'good_till_canceled';
  postOnly: boolean;
}): Promise<PolymarketSignedOrderPayload> {
  const wallet = signer();
  const funder = wallet ? funderAddress(wallet) : null;
  if (!wallet || !funder) throw new Error('POLYMARKET_EOA_SIGNER_UNAVAILABLE');
  if (!/^\d+$/.test(input.timestamp) || !(Number(input.timestamp) > 0)) throw new Error('POLYMARKET_ORDER_TIMESTAMP_INVALID');
  if (!/^\d+$/.test(input.tokenId)) throw new Error('POLYMARKET_TOKEN_ID_INVALID');
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.conditionId)) throw new Error('POLYMARKET_CONDITION_ID_INVALID');
  if (!Number.isInteger(input.contracts) || input.contracts <= 0) throw new Error('POLYMARKET_ORDER_CONTRACTS_MUST_BE_POSITIVE_INTEGER');
  if (!tickAligned(input.limitPrice, input.tickSize)) throw new Error('POLYMARKET_ORDER_PRICE_NOT_TICK_ALIGNED');
  if (input.postOnly && input.timeInForce !== 'good_till_canceled') throw new Error('POLYMARKET_POST_ONLY_REQUIRES_GTC');

  const version = await getPolymarketCLOBVersion();
  const exchange = version === 3 ? EXCHANGE_V3 : input.negRisk ? NEG_RISK_EXCHANGE_V2 : EXCHANGE_V2;
  const priceMicros = BigInt(Math.round(input.limitPrice * 1_000_000));
  if (priceMicros <= 0n || priceMicros >= 1_000_000n) throw new Error('POLYMARKET_ORDER_PRICE_INVALID');
  const contractUnits = BigInt(input.contracts) * 1_000_000n;
  const makerAmount = input.side === 'buy' ? BigInt(input.contracts) * priceMicros : contractUnits;
  const takerAmount = input.side === 'buy' ? contractUnits : BigInt(input.contracts) * priceMicros;
  const salt = deterministicSalt(input.clientOrderId, input.timestamp);
  const message = {
    salt,
    maker: funder,
    signer: wallet.address,
    tokenId: input.tokenId,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    side: input.side === 'buy' ? 0 : 1,
    signatureType: 0,
    timestamp: input.timestamp,
    metadata: metadataFor(input.clientOrderId),
    builder: ZERO_BYTES32,
  };
  const domain = {
    name: 'Polymarket CTF Exchange',
    version: String(version),
    chainId: CHAIN_ID,
    verifyingContract: exchange,
  };
  const signature = await wallet._signTypedData(domain, ORDER_TYPES as any, message);
  const orderId = utils._TypedDataEncoder.hash(domain, ORDER_TYPES as any, message);
  const credentials = await getPolymarketApiCredentials();
  const orderType = input.timeInForce === 'fill_or_kill' ? 'FOK' : input.timeInForce === 'immediate_or_cancel' ? 'FAK' : 'GTC';
  const body = {
    order: {
      salt: Number(salt),
      maker: funder,
      signer: wallet.address,
      tokenId: input.tokenId,
      makerAmount: makerAmount.toString(),
      takerAmount: takerAmount.toString(),
      side: input.side.toUpperCase(),
      signatureType: 0,
      timestamp: input.timestamp,
      expiration: '0',
      metadata: message.metadata,
      builder: ZERO_BYTES32,
      signature,
    },
    owner: credentials.key,
    orderType,
    deferExec: false,
    postOnly: input.postOnly,
  };
  return {
    orderId,
    tokenId: input.tokenId,
    conditionId: input.conditionId,
    salt,
    timestamp: input.timestamp,
    body,
    version,
    negRisk: input.negRisk,
    provenance: [
      'polymarket_order:eip712_signed_eoa',
      `polymarket_order:clob_v${version}`,
      `polymarket_order:tif_${orderType.toLowerCase()}`,
      'polymarket_order:deterministic_client_intent_salt',
      'polymarket_order:client_intent_bound_in_metadata',
      'polymarket_order:personal_wallet_fallback_false',
    ],
  };
}

export async function postPolymarketSignedOrder(body: Record<string, unknown>): Promise<any> {
  return polymarketAuthenticatedRequest<any>('/order', { method: 'POST', body });
}

export async function getPolymarketOrder(orderId: string): Promise<any> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(orderId)) throw new Error('POLYMARKET_ORDER_ID_INVALID');
  return polymarketAuthenticatedRequest<any>(`/data/order/${orderId}`);
}

export async function cancelPolymarketOrder(orderId: string): Promise<any> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(orderId)) throw new Error('POLYMARKET_ORDER_ID_INVALID');
  return polymarketAuthenticatedRequest<any>('/order', { method: 'DELETE', body: { orderID: orderId } });
}

export async function getPolymarketTrades(input: { id?: string; market?: string; assetId?: string } = {}): Promise<any[]> {
  const payload = await polymarketAuthenticatedRequest<any>('/data/trades', {
    query: { id: input.id, market: input.market, asset_id: input.assetId, next_cursor: 'MA==' },
  });
  return Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
}
