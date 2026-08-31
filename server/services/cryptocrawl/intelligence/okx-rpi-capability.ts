import { okxPrivateRequest } from './cex-private-authority.js';
import { getOkxExecutionRestBaseUrl } from './okx-region-authority.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

export interface OkxRpiExecutionCapability {
  symbol: string;
  exchangeSymbol: string;
  observedAt: number;
  permissionState: '0' | '1' | '2' | null;
  makerPermission: boolean;
  takerFeeBps: number;
  standardMakerFeeBps: number | null;
  rpiMakerFeeBps: number;
  rpiSavingsVsTakerBps: number;
  rpiSavingsVsStandardMakerBps: number | null;
  minimumRpiNotionalUsd: number;
  rpiMinLevel: number | null;
  rpiMinPxBandBps: number | null;
  visibleRpiBid: number | null;
  visibleRpiAsk: number | null;
  rpiLiquidityVisible: boolean;
  executableFeeAdvantage: boolean;
  source: 'okx_authenticated_rpi_capability';
}

type AccountInstrumentSnapshot = {
  expiresAt: number;
  byInstId: Map<string, any>;
};

type RpiPublicMetadata = {
  rpiMinLevel: number | null;
  rpiMinPxBandBps: number | null;
  visibleRpiBid: number | null;
  visibleRpiAsk: number | null;
  rpiLiquidityVisible: boolean;
};

let accountSnapshot: AccountInstrumentSnapshot | null = null;
let accountSnapshotInFlight: Promise<AccountInstrumentSnapshot> | null = null;
const capabilityCache = new Map<string, { expiresAt: number; value: OkxRpiExecutionCapability }>();
const capabilityInFlight = new Map<string, Promise<OkxRpiExecutionCapability | null>>();

const CACHE_TTL_MS = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTO_OKX_RPI_CAPABILITY_TTL_MS || 30_000)));
const REQUEST_TIMEOUT_MS = Math.max(1_000, Math.min(8_000, Number(process.env.CRYPTO_OKX_RPI_REQUEST_TIMEOUT_MS || 3_000)));

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function finitePositive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function rateToBps(rate: number): number {
  // OKX rates are signed decimals: negative = charged fee, positive = rebate.
  // Convert to signed BPS cost so rebates remain economically negative costs.
  return -rate * 10_000;
}

function selectFeeRow(row: any, groupId: string | null): { taker: number; maker: number | null; rpiMaker: number | null } | null {
  const groups = Array.isArray(row?.feeGroup) ? row.feeGroup : [];
  const group = groupId
    ? groups.find((candidate: any) => String(candidate?.groupId ?? '') === groupId)
    : groups.length === 1 ? groups[0] : null;
  const taker = finite(group?.taker ?? row?.taker);
  if (taker === null) return null;
  const maker = finite(group?.maker ?? row?.maker);
  const rpiMaker = finite(group?.rpiMaker ?? group?.elpMaker ?? row?.rpiMaker ?? row?.elpMaker);
  return { taker, maker, rpiMaker };
}

export function getOkxSpotRpiMinimumNotionalUsd(): number {
  // Production rule effective 2026-08-18. This is independent of minSz.
  return Math.max(1_000, Number(process.env.CRYPTO_OKX_RPI_MIN_NOTIONAL_USD || 1_000));
}

async function getAccountInstrumentSnapshot(forceFresh = false): Promise<AccountInstrumentSnapshot> {
  if (!forceFresh && accountSnapshot && accountSnapshot.expiresAt > Date.now()) return accountSnapshot;
  if (accountSnapshotInFlight) return accountSnapshotInFlight;
  accountSnapshotInFlight = (async () => {
    const { data } = await okxPrivateRequest('/api/v5/account/instruments', 'GET', { instType: 'SPOT' }, { lane: 'account_read' });
    const byInstId = new Map<string, any>();
    for (const row of Array.isArray(data) ? data : []) {
      const instId = String(row?.instId || '').trim().toUpperCase();
      if (instId) byInstId.set(instId, row);
    }
    const snapshot = { expiresAt: Date.now() + CACHE_TTL_MS, byInstId };
    accountSnapshot = snapshot;
    return snapshot;
  })().finally(() => { accountSnapshotInFlight = null; });
  return accountSnapshotInFlight;
}

function visibleRpiPrice(levels: unknown): number | null {
  if (!Array.isArray(levels)) return null;
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 3) continue;
    const price = finitePositive(level[0]);
    const totalQty = finiteNonNegative(level[1]);
    const nonRpiQty = finiteNonNegative(level[2]);
    if (price === null || totalQty === null || nonRpiQty === null) continue;
    if (totalQty - nonRpiQty > 0) return price;
  }
  return null;
}

async function getPublicRpiMetadata(exchangeSymbol: string): Promise<RpiPublicMetadata> {
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const [instrumentPayload, bookPayload] = await Promise.all([
    fetchJsonWithRetry<any>(`${baseUrl}/api/v5/public/instruments?instType=SPOT&instId=${encodeURIComponent(exchangeSymbol)}`, {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 400,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }),
    fetchJsonWithRetry<any>(`${baseUrl}/api/v5/market/books-rpi?instId=${encodeURIComponent(exchangeSymbol)}&sz=5`, {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 400,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).catch(() => null),
  ]);
  const instrument = String(instrumentPayload?.code) === '0' ? instrumentPayload?.data?.[0] : null;
  const book = bookPayload && String(bookPayload?.code) === '0' ? bookPayload?.data?.[0] : null;
  const visibleRpiBid = visibleRpiPrice(book?.bids);
  const visibleRpiAsk = visibleRpiPrice(book?.asks);
  return {
    rpiMinLevel: finiteNonNegative(instrument?.rpiMinLevel),
    rpiMinPxBandBps: finiteNonNegative(instrument?.rpiMinPxBand),
    visibleRpiBid,
    visibleRpiAsk,
    rpiLiquidityVisible: visibleRpiBid !== null || visibleRpiAsk !== null,
  };
}

export async function getOkxRpiExecutionCapability(
  symbolInput: string,
  forceFresh = false,
): Promise<OkxRpiExecutionCapability | null> {
  const constraints = await getSpotProductConstraints('okx', symbolInput, forceFresh).catch(() => null);
  if (!constraints) return null;
  const cacheKey = `${constraints.symbol}:${constraints.exchangeSymbol}`;
  const cached = capabilityCache.get(cacheKey);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) return { ...cached.value };
  const existing = capabilityInFlight.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<OkxRpiExecutionCapability | null> => {
    const [account, publicMeta, feeResponse] = await Promise.all([
      getAccountInstrumentSnapshot(forceFresh),
      getPublicRpiMetadata(constraints.exchangeSymbol),
      okxPrivateRequest('/api/v5/account/trade-fee', 'GET', {
        instType: 'SPOT',
        ...(constraints.feeGroupId ? { groupId: constraints.feeGroupId } : { instId: constraints.exchangeSymbol }),
      }, { lane: 'trade_fee' }),
    ]);
    const accountRow = account.byInstId.get(constraints.exchangeSymbol) || null;
    const rawPermission = String(accountRow?.rpi ?? accountRow?.elp ?? '').trim();
    const permissionState = rawPermission === '0' || rawPermission === '1' || rawPermission === '2'
      ? rawPermission
      : null;
    const selected = selectFeeRow(feeResponse.data?.[0], constraints.feeGroupId);
    if (!selected || selected.rpiMaker === null) return null;

    const takerFeeBps = rateToBps(selected.taker);
    const standardMakerFeeBps = selected.maker === null ? null : rateToBps(selected.maker);
    const rpiMakerFeeBps = rateToBps(selected.rpiMaker);
    const rpiSavingsVsStandardMakerBps = standardMakerFeeBps === null
      ? null
      : standardMakerFeeBps - rpiMakerFeeBps;
    const value: OkxRpiExecutionCapability = {
      symbol: constraints.symbol,
      exchangeSymbol: constraints.exchangeSymbol,
      observedAt: Date.now(),
      permissionState,
      makerPermission: permissionState === '2',
      takerFeeBps,
      standardMakerFeeBps,
      rpiMakerFeeBps,
      rpiSavingsVsTakerBps: takerFeeBps - rpiMakerFeeBps,
      rpiSavingsVsStandardMakerBps,
      minimumRpiNotionalUsd: getOkxSpotRpiMinimumNotionalUsd(),
      ...publicMeta,
      executableFeeAdvantage: permissionState === '2'
        && (standardMakerFeeBps === null || rpiMakerFeeBps < standardMakerFeeBps),
      source: 'okx_authenticated_rpi_capability',
    };
    capabilityCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return { ...value };
  })().finally(() => capabilityInFlight.delete(cacheKey));

  capabilityInFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Evidence-only RPI admission predicate. The result never grants trade authority;
 * it proves the requested order still satisfies exact account permission, the
 * SPOT minimum notional, organic price-band and visible-RPI level spacing.
 */
export function isOkxRpiMakerPriceAdmissible(input: {
  capability: OkxRpiExecutionCapability;
  side: 'buy' | 'sell';
  price: number;
  oppositeOrganicPrice: number;
  tickSize: number;
  notionalUsd: number;
}): boolean {
  const { capability, side, price, oppositeOrganicPrice, tickSize, notionalUsd } = input;
  if (!capability.makerPermission || !capability.executableFeeAdvantage) return false;
  if (!(notionalUsd >= capability.minimumRpiNotionalUsd)) return false;
  if (!(price > 0) || !(oppositeOrganicPrice > 0) || !(tickSize > 0)) return false;
  const nonCrossing = side === 'buy' ? price < oppositeOrganicPrice : price > oppositeOrganicPrice;
  if (!nonCrossing) return false;

  if (capability.rpiMinPxBandBps !== null) {
    const bandBps = side === 'buy'
      ? (oppositeOrganicPrice - price) / oppositeOrganicPrice * 10_000
      : (price - oppositeOrganicPrice) / oppositeOrganicPrice * 10_000;
    if (bandBps + 1e-9 < capability.rpiMinPxBandBps) return false;
  }

  const levels = capability.rpiMinLevel ?? 0;
  if (levels > 0) {
    if (side === 'buy' && capability.visibleRpiAsk !== null
        && price > capability.visibleRpiAsk - levels * tickSize + tickSize * 1e-8) return false;
    if (side === 'sell' && capability.visibleRpiBid !== null
        && price < capability.visibleRpiBid + levels * tickSize - tickSize * 1e-8) return false;
  }
  return true;
}
