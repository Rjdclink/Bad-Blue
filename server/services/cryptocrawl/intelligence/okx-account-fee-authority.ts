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
  zeroFeeGroup: boolean;
  observedAt: number;
  source: 'okx_authenticated_account_fee' | 'okx_live_spot_zero_fee_group';
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

// The CEX recovery/matrix path consumes authenticated fee evidence on a <=5s
// contract. Keep this sole semantic authority's default cache inside that same
// window so an outer strict-age miss cannot be refilled from a much older inner
// cache. Group-key caching and in-flight coalescing preserve request efficiency;
// OKX documents the trade-fee endpoint at 5 requests / 2 seconds per User ID.
const CACHE_TTL_MS = Math.max(
  5_000,
  Math.min(600_000, Number(process.env.CRYPTO_OKX_ACCOUNT_FEE_CACHE_MS || 5_000)),
);
const DEFAULT_TIMEOUT_MS = Math.max(
  3_000,
  Math.min(15_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000)),
);
const OKX_SPOT_ZERO_FEE_GROUP_ID = '11';
const feeCache = new Map<string, { expiresAt: number; value: OkxAccountFeeRates }>();
const feeInFlight = new Map<string, Promise<OkxAccountFeeRates>>();
let requestCount = 0;
let cacheHitCount = 0;
let coalescedCount = 0;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
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

function isLiveSpotZeroFeeGroup(options: ResolveOkxAccountFeeOptions, selectedGroupId: string | null): boolean {
  if (options.instType !== 'SPOT') return false;
  const expected = String(options.expectedGroupId || '').trim();
  return expected === OKX_SPOT_ZERO_FEE_GROUP_ID && selectedGroupId === OKX_SPOT_ZERO_FEE_GROUP_ID;
}

/**
 * Sole semantic authority for authenticated OKX account fee reads.
 *
 * The transport authority owns user-wide pacing. This layer owns product/group
 * identity, response selection, TTL caching and in-flight coalescing so SPOT,
 * RPI and funding consumers cannot independently fan out the same private read.
 *
 * OKX's account trade-fee endpoint does not represent promotional zero-fee spot
 * products. The canonical regional live-product directory supplies fee group 11
 * (Spot zero) as `expectedGroupId`; only that exact live group is allowed to
 * override ordinary account rates to zero. No symbol list or static promotion is
 * assumed, and other stablecoin groups remain account-fee priced.
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
    const zeroFeeGroup = isLiveSpotZeroFeeGroup(options, selected.groupId);
    const value: OkxAccountFeeRates = {
      instType: options.instType,
      selector: selector.name,
      selectorValue: selector.value,
      groupId: selected.groupId,
      taker: zeroFeeGroup ? 0 : selected.taker,
      maker: zeroFeeGroup ? 0 : selected.maker,
      rpiMaker: selected.rpiMaker,
      zeroFeeGroup,
      observedAt: Date.now(),
      source: zeroFeeGroup ? 'okx_live_spot_zero_fee_group' : 'okx_authenticated_account_fee',
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
  liveSpotZeroFeeGroupId: string;
} {
  return {
    cacheTtlMs: CACHE_TTL_MS,
    cacheEntries: feeCache.size,
    inFlight: feeInFlight.size,
    requestCount,
    cacheHitCount,
    coalescedCount,
    liveSpotZeroFeeGroupId: OKX_SPOT_ZERO_FEE_GROUP_ID,
  };
}
