import { okxPrivateRequest } from './cex-private-authority.js';

export type OkxTradeFeeInstrumentType = 'SPOT' | 'MARGIN' | 'SWAP' | 'FUTURES' | 'OPTION';

export interface OkxAccountFeeRates {
  instType: OkxTradeFeeInstrumentType;
  selector: 'groupId' | 'instId' | 'instFamily';
  selectorValue: string;
  groupId: string | null;
  taker: number;
  maker: number | null;
  rpiMaker: number | null;
  observedAt: number;
  source: 'okx_authenticated_account_fee';
}

export interface ResolveOkxAccountFeeOptions {
  instType: OkxTradeFeeInstrumentType;
  groupId?: string | null;
  instId?: string | null;
  instFamily?: string | null;
  expectedGroupId?: string | null;
  forceRefresh?: boolean;
  timeoutMs?: number;
}

const CACHE_TTL_MS = Math.max(
  10_000,
  Math.min(600_000, Number(process.env.CRYPTO_OKX_ACCOUNT_FEE_CACHE_MS || 300_000)),
);
const DEFAULT_TIMEOUT_MS = Math.max(
  3_000,
  Math.min(15_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000)),
);
const feeCache = new Map<string, { expiresAt: number; value: OkxAccountFeeRates }>();
const feeInFlight = new Map<string, Promise<OkxAccountFeeRates>>();
let requestCount = 0;
let cacheHitCount = 0;
let coalescedCount = 0;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedSelector(options: ResolveOkxAccountFeeOptions): {
  name: 'groupId' | 'instId' | 'instFamily';
  value: string;
} {
  const selectors = ([
    ['groupId', options.groupId],
    ['instId', options.instId],
    ['instFamily', options.instFamily],
  ] as const).flatMap(([name, raw]) => {
    const value = String(raw || '').trim();
    return value ? [{ name, value }] : [];
  });
  if (selectors.length !== 1) {
    throw new Error('OKX account-fee authority requires exactly one of groupId, instId, or instFamily');
  }
  return selectors[0];
}

function cacheKey(options: ResolveOkxAccountFeeOptions, selector: { name: string; value: string }): string {
  return `${options.instType}:${selector.name}:${selector.value}:${String(options.expectedGroupId || '')}`;
}

function clone(value: OkxAccountFeeRates): OkxAccountFeeRates {
  return { ...value };
}

function selectRates(row: any, expectedGroupId: string | null): {
  groupId: string | null;
  taker: number;
  maker: number | null;
  rpiMaker: number | null;
} | null {
  const groups = Array.isArray(row?.feeGroup) ? row.feeGroup : [];
  const group = expectedGroupId
    ? groups.find((candidate: any) => String(candidate?.groupId ?? '') === expectedGroupId)
    : groups.length === 1 ? groups[0] : null;
  const taker = finite(group?.taker ?? row?.taker);
  if (taker === null) return null;
  return {
    groupId: group?.groupId === undefined || group?.groupId === null
      ? expectedGroupId
      : String(group.groupId),
    taker,
    maker: finite(group?.maker ?? row?.maker),
    rpiMaker: finite(group?.rpiMaker ?? group?.elpMaker ?? row?.rpiMaker ?? row?.elpMaker),
  };
}

/**
 * Sole semantic authority for authenticated OKX account fee reads.
 *
 * The transport authority owns user-wide pacing. This layer owns product/group
 * identity, response selection, TTL caching and in-flight coalescing so SPOT,
 * RPI and funding consumers cannot independently fan out the same private read.
 */
export async function resolveOkxAccountFeeRates(
  options: ResolveOkxAccountFeeOptions,
): Promise<OkxAccountFeeRates> {
  const selector = normalizedSelector(options);
  const key = cacheKey(options, selector);
  const cached = feeCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    cacheHitCount += 1;
    return clone(cached.value);
  }

  const existing = feeInFlight.get(key);
  if (existing) {
    coalescedCount += 1;
    return clone(await existing);
  }

  const promise = (async (): Promise<OkxAccountFeeRates> => {
    requestCount += 1;
    const { data } = await okxPrivateRequest(
      '/api/v5/account/trade-fee',
      'GET',
      {
        instType: options.instType,
        [selector.name]: selector.value,
      },
      { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, lane: 'trade_fee' },
    );
    const selected = selectRates(data[0], String(options.expectedGroupId || '').trim() || null);
    if (!selected) {
      throw new Error('OKX trade-fee response did not contain the requested fee-group evidence');
    }
    const value: OkxAccountFeeRates = {
      instType: options.instType,
      selector: selector.name,
      selectorValue: selector.value,
      groupId: selected.groupId,
      taker: selected.taker,
      maker: selected.maker,
      rpiMaker: selected.rpiMaker,
      observedAt: Date.now(),
      source: 'okx_authenticated_account_fee',
    };
    feeCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    if (feeCache.size > 256) {
      const now = Date.now();
      for (const [candidateKey, entry] of feeCache.entries()) {
        if (entry.expiresAt <= now) feeCache.delete(candidateKey);
      }
    }
    return value;
  })().finally(() => feeInFlight.delete(key));

  feeInFlight.set(key, promise);
  return clone(await promise);
}

export function getOkxAccountFeeAuthoritySnapshot(): {
  cacheTtlMs: number;
  cacheEntries: number;
  inFlight: number;
  requestCount: number;
  cacheHitCount: number;
  coalescedCount: number;
} {
  return {
    cacheTtlMs: CACHE_TTL_MS,
    cacheEntries: feeCache.size,
    inFlight: feeInFlight.size,
    requestCount,
    cacheHitCount,
    coalescedCount,
  };
}
