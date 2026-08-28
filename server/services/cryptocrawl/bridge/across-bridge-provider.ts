import { ethers } from 'ethers';
import { SUPPORTED_CHAINS } from './chain-config.js';
import type { ChainId } from './types.js';

export interface AcrossTokenIdentity {
  chainId: number;
  address: string;
  symbol: 'USDC' | 'USDT';
  decimals: number;
  observedAt: number;
  source: 'across_swap_tokens';
}

export interface AcrossBridgeQuote {
  provider: 'across';
  quoteId: string | null;
  originChain: ChainId;
  destinationChain: ChainId;
  token: 'USDC' | 'USDT';
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  expectedOutputAmount: string;
  minOutputAmount: string | null;
  /** Backward-compatible alias for the origin/input token decimals. */
  tokenDecimals: number;
  inputTokenDecimals: number;
  outputTokenDecimals: number;
  tokenCatalogObservedAt: number;
  expectedFillTimeSec: number;
  quoteExpiryTimestamp: number;
  simulationSuccess: boolean;
  originGasUsd: number | null;
  destinationGasUsd: number | null;
  lpFeeUsd: number | null;
  relayerCapitalFeeUsd: number | null;
  bridgeFeeUsd: number | null;
  totalFeeUsd: number | null;
  totalMaxFeeUsd: number | null;
  approvalTransactions: number;
  swapTransactionPresent: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface AcrossReadiness {
  configured: boolean;
  reason: string;
}

interface AcrossCatalogToken {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}

interface TokenCatalogCache {
  expiresAt: number;
  observedAt: number;
  tokens: AcrossCatalogToken[];
}

let tokenCatalogCache: TokenCatalogCache | null = null;
let tokenCatalogInFlight: Promise<TokenCatalogCache | null> | null = null;

function config(): { apiKey: string; integratorId: string; depositor: string } | null {
  const apiKey = process.env.ACROSS_API_KEY?.trim();
  const integratorId = process.env.ACROSS_INTEGRATOR_ID?.trim();
  const depositor = (process.env.CRYPTOCRAWL_ACROSS_DEPOSITOR_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || '').trim();
  if (!apiKey || !integratorId || !/^0x[0-9a-fA-F]{4}$/.test(integratorId) || !/^0x[0-9a-fA-F]{40}$/.test(depositor)) return null;
  return { apiKey, integratorId, depositor };
}

function amountUsd(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validCatalogToken(value: unknown): value is AcrossCatalogToken {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<AcrossCatalogToken>;
  return Number.isInteger(Number(token.chainId))
    && Number(token.chainId) > 0
    && typeof token.address === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(token.address)
    && typeof token.symbol === 'string'
    && token.symbol.trim().length > 0
    && Number.isInteger(Number(token.decimals))
    && Number(token.decimals) >= 0
    && Number(token.decimals) <= 36;
}

function parseTokenCatalog(payload: unknown): AcrossCatalogToken[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as any).tokens)
      ? (payload as any).tokens
      : [];
  return rows.filter(validCatalogToken).map(token => ({
    chainId: Number(token.chainId),
    address: token.address,
    symbol: token.symbol.toUpperCase(),
    decimals: Number(token.decimals),
  }));
}

async function fetchAcrossTokenCatalog(credentials: { apiKey: string }): Promise<TokenCatalogCache | null> {
  const now = Date.now();
  if (tokenCatalogCache && tokenCatalogCache.expiresAt > now) return tokenCatalogCache;
  if (tokenCatalogInFlight) return tokenCatalogInFlight;

  tokenCatalogInFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, Number(process.env.ACROSS_TOKEN_CATALOG_TIMEOUT_MS || 8_000)));
    try {
      const response = await fetch('https://app.across.to/api/swap/tokens', {
        method: 'GET',
        headers: { accept: 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
      if (!response.ok) throw new Error(`Across token catalog failed (${response.status})`);
      const tokens = parseTokenCatalog(payload);
      if (tokens.length === 0) throw new Error('Across token catalog returned no valid token identities');
      const observedAt = Date.now();
      const ttlMs = Math.max(30_000, Math.min(30 * 60_000, Number(process.env.ACROSS_TOKEN_CATALOG_TTL_MS || 5 * 60_000)));
      tokenCatalogCache = { tokens, observedAt, expiresAt: observedAt + ttlMs };
      return tokenCatalogCache;
    } finally {
      clearTimeout(timeout);
    }
  })().catch(() => null).finally(() => {
    tokenCatalogInFlight = null;
  });
  return tokenCatalogInFlight;
}

async function resolveAcrossToken(
  credentials: { apiKey: string },
  chain: ChainId,
  symbol: 'USDC' | 'USDT',
): Promise<AcrossTokenIdentity | null> {
  const catalog = await fetchAcrossTokenCatalog(credentials);
  if (!catalog) return null;
  const chainId = SUPPORTED_CHAINS[chain].chainId;
  const matches = catalog.tokens.filter(token => token.chainId === chainId && token.symbol.toUpperCase() === symbol);
  const unique = new Map(matches.map(token => [token.address.toLowerCase(), token]));
  if (unique.size !== 1) return null;
  const token = [...unique.values()][0];
  return {
    chainId,
    address: token.address,
    symbol,
    decimals: token.decimals,
    observedAt: catalog.observedAt,
    source: 'across_swap_tokens',
  };
}

function quoteFeeUsd(payload: any): number | null {
  return amountUsd(payload?.fees?.total?.amountUsd)
    ?? amountUsd(payload?.fees?.totalFeeUsd)
    ?? null;
}

function bridgeDetails(payload: any): any {
  return payload?.fees?.total?.details?.bridge?.details
    ?? payload?.steps?.bridge?.fees?.details
    ?? null;
}

function bridgeFeeUsd(payload: any): number | null {
  return amountUsd(payload?.fees?.total?.details?.bridge?.amountUsd)
    ?? amountUsd(payload?.steps?.bridge?.fees?.amountUsd)
    ?? null;
}

export function getAcrossBridgeReadiness(): AcrossReadiness {
  return config()
    ? { configured: true, reason: 'Across API key, 2-byte integrator ID, and depositor address are visible' }
    : { configured: false, reason: 'Across remains optional until ACROSS_API_KEY, ACROSS_INTEGRATOR_ID, and a depositor address are configured' };
}

export async function getAcrossBridgeQuote(input: {
  originChain: ChainId;
  destinationChain: ChainId;
  token: 'USDC' | 'USDT';
  amountHuman: number;
}): Promise<AcrossBridgeQuote | null> {
  const credentials = config();
  if (!credentials) return null;
  if (input.originChain === input.destinationChain) return null;
  if (!(input.amountHuman > 0) || !Number.isFinite(input.amountHuman)) return null;

  // Across explicitly publishes current chain-specific token identities through
  // /swap/tokens. Static local bridge addresses are never used as quote truth.
  const [inputToken, outputToken] = await Promise.all([
    resolveAcrossToken(credentials, input.originChain, input.token),
    resolveAcrossToken(credentials, input.destinationChain, input.token),
  ]);
  if (!inputToken || !outputToken) return null;

  const amount = ethers.utils.parseUnits(
    input.amountHuman.toFixed(Math.min(inputToken.decimals, 8)),
    inputToken.decimals,
  ).toString();
  const origin = SUPPORTED_CHAINS[input.originChain];
  const destination = SUPPORTED_CHAINS[input.destinationChain];
  const params = new URLSearchParams({
    tradeType: 'exactInput',
    amount,
    inputToken: inputToken.address,
    outputToken: outputToken.address,
    originChainId: String(origin.chainId),
    destinationChainId: String(destination.chainId),
    depositor: credentials.depositor,
    recipient: credentials.depositor,
    refundAddress: credentials.depositor,
    integratorId: credentials.integratorId,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3_000, Number(process.env.ACROSS_QUOTE_TIMEOUT_MS || 8_000)));
  try {
    // Approval quotes intentionally are never cached: they contain fresh fee,
    // route, simulation, balance/allowance, and expiry evidence.
    const response = await fetch(`https://app.across.to/api/swap/approval?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
    if (!response.ok) throw new Error(`Across quote failed (${response.status})${payload?.message ? `: ${payload.message}` : ''}`);
    const expectedOutputAmount = typeof payload?.expectedOutputAmount === 'string' ? payload.expectedOutputAmount : null;
    const expectedFillTimeSec = Number(payload?.expectedFillTime);
    const quoteExpiryTimestamp = Number(payload?.quoteExpiryTimestamp);
    if (!expectedOutputAmount || !Number.isFinite(expectedFillTimeSec) || expectedFillTimeSec < 0 || !Number.isFinite(quoteExpiryTimestamp)) {
      throw new Error('Across quote response missing required output/fill/expiry evidence');
    }
    const observedAt = Date.now();
    const expiresAt = quoteExpiryTimestamp * 1000;
    if (expiresAt <= observedAt) return null;
    const details = bridgeDetails(payload);
    return {
      provider: 'across',
      quoteId: typeof payload?.id === 'string' ? payload.id : null,
      originChain: input.originChain,
      destinationChain: input.destinationChain,
      token: input.token,
      inputToken: inputToken.address,
      outputToken: outputToken.address,
      inputAmount: amount,
      expectedOutputAmount,
      minOutputAmount: typeof payload?.minOutputAmount === 'string' ? payload.minOutputAmount : null,
      tokenDecimals: inputToken.decimals,
      inputTokenDecimals: inputToken.decimals,
      outputTokenDecimals: outputToken.decimals,
      tokenCatalogObservedAt: Math.min(inputToken.observedAt, outputToken.observedAt),
      expectedFillTimeSec,
      quoteExpiryTimestamp,
      simulationSuccess: payload?.swapTx?.simulationSuccess === true,
      originGasUsd: amountUsd(payload?.fees?.originGas?.amountUsd),
      destinationGasUsd: amountUsd(details?.destinationGas?.amountUsd),
      lpFeeUsd: amountUsd(details?.lp?.amountUsd),
      relayerCapitalFeeUsd: amountUsd(details?.relayerCapital?.amountUsd),
      bridgeFeeUsd: bridgeFeeUsd(payload),
      totalFeeUsd: quoteFeeUsd(payload),
      totalMaxFeeUsd: amountUsd(payload?.fees?.totalMax?.amountUsd),
      approvalTransactions: Array.isArray(payload?.approvalTxns) ? payload.approvalTxns.length : 0,
      swapTransactionPresent: !!(payload?.swapTx?.to && payload?.swapTx?.data),
      observedAt,
      expiresAt,
      provenance: [
        'across_swap_tokens:current_chain_token_identity',
        'across_swap_api',
        'swap_approval_quote:fresh_uncached',
        `input_token:${origin.chainId}:${inputToken.address}:${inputToken.decimals}`,
        `output_token:${destination.chainId}:${outputToken.address}:${outputToken.decimals}`,
        'fresh_cross_chain_fee_and_fill_time',
        'provider_simulation_status',
      ],
    };
  } finally {
    clearTimeout(timeout);
  }
}
