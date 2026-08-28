import logger from '../../../logger.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export type TokenContractChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'avalanche' | 'bsc';

export interface TokenContractIdentity {
  symbol: string;
  coinGeckoId: string;
  chain: TokenContractChain;
  address: string;
  observedAt: number;
  source: 'coingecko_platform_directory';
}

interface DirectorySnapshot {
  expiresAt: number;
  observedAt: number;
  byKey: Map<string, TokenContractIdentity[]>;
}

const PLATFORM_TO_CHAIN: Readonly<Record<string, TokenContractChain>> = Object.freeze({
  ethereum: 'ethereum',
  'polygon-pos': 'polygon',
  'arbitrum-one': 'arbitrum',
  'optimistic-ethereum': 'optimism',
  base: 'base',
  avalanche: 'avalanche',
  'binance-smart-chain': 'bsc',
});

const DIRECTORY_TTL_MS = Math.max(300_000, Number.isFinite(Number(process.env.COINGECKO_PLATFORM_DIRECTORY_TTL_MS))
  ? Number(process.env.COINGECKO_PLATFORM_DIRECTORY_TTL_MS)
  : 3_600_000);

let snapshot: DirectorySnapshot | null = null;
let inFlight: Promise<DirectorySnapshot> | null = null;

function validEvmAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : null;
}

function directoryKey(symbol: string, chain: TokenContractChain): string {
  return `${symbol.trim().toUpperCase()}:${chain}`;
}

async function fetchDirectory(): Promise<DirectorySnapshot> {
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  const headers: HeadersInit = { accept: 'application/json' };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
  const rows = await fetchJsonWithRetry<any[]>(
    'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
    { init: { headers }, maxRetries: 2, baseDelayMs: 500, maxDelayMs: 4_000, timeoutMs: 10_000 },
  );
  const observedAt = Date.now();
  const byKey = new Map<string, TokenContractIdentity[]>();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.id !== 'string' || typeof row?.symbol !== 'string' || !row?.platforms || typeof row.platforms !== 'object') continue;
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9]{2,15}$/.test(symbol)) continue;
    for (const [platform, rawAddress] of Object.entries(row.platforms as Record<string, unknown>)) {
      const chain = PLATFORM_TO_CHAIN[platform];
      if (!chain) continue;
      const address = validEvmAddress(rawAddress);
      if (!address) continue;
      const key = directoryKey(symbol, chain);
      const identities = byKey.get(key) || [];
      if (!identities.some(identity => identity.address === address && identity.coinGeckoId === row.id)) {
        identities.push({ symbol, coinGeckoId: row.id, chain, address, observedAt, source: 'coingecko_platform_directory' });
      }
      byKey.set(key, identities);
    }
  }

  const next = { expiresAt: observedAt + DIRECTORY_TTL_MS, observedAt, byKey };
  snapshot = next;
  logger.info('[TokenContractDirectory] CoinGecko platform directory refreshed', {
    component: 'TokenContractDirectory',
    keys: byKey.size,
    identities: [...byKey.values()].reduce((sum, identities) => sum + identities.length, 0),
    ambiguousKeys: [...byKey.values()].filter(identities => new Set(identities.map(identity => identity.address)).size > 1).length,
    addressesLogged: false,
  });
  return next;
}

export async function ensureTokenContractDirectory(): Promise<void> {
  if (snapshot && snapshot.expiresAt > Date.now()) return;
  if (!inFlight) inFlight = fetchDirectory().finally(() => { inFlight = null; });
  await inFlight;
}

export async function resolveTokenContract(symbol: string, chain: TokenContractChain): Promise<TokenContractIdentity | null> {
  await ensureTokenContractDirectory();
  const identities = snapshot?.byKey.get(directoryKey(symbol, chain)) || [];
  const addresses = new Set(identities.map(identity => identity.address));
  if (addresses.size !== 1) return null;
  const address = [...addresses][0];
  const candidates = identities.filter(identity => identity.address === address);
  const ids = new Set(candidates.map(identity => identity.coinGeckoId));
  if (ids.size !== 1) return null;
  return { ...candidates[0] };
}

export function getTokenContractDirectoryStatus(): {
  ready: boolean;
  observedAt: number | null;
  keys: number;
  ambiguousKeys: number;
} {
  return {
    ready: Boolean(snapshot && snapshot.expiresAt > Date.now()),
    observedAt: snapshot?.observedAt || null,
    keys: snapshot?.byKey.size || 0,
    ambiguousKeys: snapshot ? [...snapshot.byKey.values()].filter(identities => new Set(identities.map(identity => identity.address)).size > 1).length : 0,
  };
}
