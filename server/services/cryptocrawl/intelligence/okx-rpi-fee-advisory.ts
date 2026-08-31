import logger from '../../../logger.js';
import { okxPrivateRequest } from './cex-private-authority.js';
import { getOkxExecutionRestBaseUrl } from './okx-region-authority.js';
import { getCexFourModeSnapshot } from '../integration/cex-four-mode-observability-wiring.js';
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

export interface OkxRpiFeeOpportunity extends OkxRpiExecutionCapability {
  minimumNotionalRuleEffectiveDate: '2026-08-18';
  feeSource: 'okx_authenticated_trade_fee';
  authority: 'fee_opportunity_advisory_only';
  executionAuthority: false;
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

let latest: OkxRpiFeeOpportunity[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;
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

function minimumRpiNotionalUsd(): number {
  // OKX production rule effective 2026-08-18: SPOT RPI maker orders require
  // at least $1,000 notional independently of the instrument minSz constraint.
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

function visibleRpiPrice(levels: unknown, side: 'bid' | 'ask'): number | null {
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
  const visibleRpiBid = visibleRpiPrice(book?.bids, 'bid');
  const visibleRpiAsk = visibleRpiPrice(book?.asks, 'ask');
  return {
    rpiMinLevel: finiteNonNegative(instrument?.rpiMinLevel),
    rpiMinPxBandBps: finiteNonNegative(instrument?.rpiMinPxBand),
    visibleRpiBid,
    visibleRpiAsk,
    rpiLiquidityVisible: visibleRpiBid !== null || visibleRpiAsk !== null,
  };
}

async function observeCapability(symbolInput: string, forceFresh = false): Promise<OkxRpiExecutionCapability | null> {
  const constraints = await getSpotProductConstraints('okx', symbolInput, forceFresh).catch(() => null);
  if (!constraints) return null;
  const symbol = constraints.symbol;
  const cacheKey = `${symbol}:${constraints.exchangeSymbol}`;
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
      symbol,
      exchangeSymbol: constraints.exchangeSymbol,
      observedAt: Date.now(),
      permissionState,
      makerPermission: permissionState === '2',
      takerFeeBps,
      standardMakerFeeBps,
      rpiMakerFeeBps,
      rpiSavingsVsTakerBps: takerFeeBps - rpiMakerFeeBps,
      rpiSavingsVsStandardMakerBps,
      minimumRpiNotionalUsd: minimumRpiNotionalUsd(),
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

export async function getOkxRpiExecutionCapability(
  symbol: string,
  forceFresh = false,
): Promise<OkxRpiExecutionCapability | null> {
  return observeCapability(symbol, forceFresh);
}

/**
 * RPI admission helper. This does not grant execution authority: it only proves
 * that the account/product can place an RPI maker order and that the requested
 * price satisfies the currently published organic-price-band and visible-RPI
 * spacing constraints. The normal product, inventory, governance, profitability,
 * fill-probability, and terminal-settlement gates remain downstream.
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
    if (side === 'buy' && capability.visibleRpiAsk !== null) {
      if (price > capability.visibleRpiAsk - levels * tickSize + tickSize * 1e-8) return false;
    }
    if (side === 'sell' && capability.visibleRpiBid !== null) {
      if (price < capability.visibleRpiBid + levels * tickSize - tickSize * 1e-8) return false;
    }
  }
  return true;
}

function toOpportunity(capability: OkxRpiExecutionCapability): OkxRpiFeeOpportunity {
  return {
    ...capability,
    minimumNotionalRuleEffectiveDate: '2026-08-18',
    feeSource: 'okx_authenticated_trade_fee',
    authority: 'fee_opportunity_advisory_only',
    executionAuthority: false,
  };
}

async function refresh(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const symbols = [...new Set(getCexFourModeSnapshot()
      .sort((a, b) => Number(b.economicallyPositive) - Number(a.economicallyPositive)
        || a.riskAdjustedBpsToBreakEven - b.riskAdjustedBpsToBreakEven)
      .map(mode => mode.symbol))]
      .slice(0, Math.max(1, Math.min(24, Number(process.env.CRYPTO_OKX_RPI_ADVISORY_SYMBOLS || 12))));
    if (symbols.length === 0) return;

    const observed = await Promise.all(symbols.map(symbol => observeCapability(symbol).catch(() => null)));
    latest = observed.filter((item): item is OkxRpiExecutionCapability => item !== null)
      .map(toOpportunity)
      .sort((a, b) => Number(b.executableFeeAdvantage) - Number(a.executableFeeAdvantage)
        || b.rpiSavingsVsTakerBps - a.rpiSavingsVsTakerBps);

    logger.info('[OKX RPI] Authenticated RPI capability and fee savings refreshed', {
      component: 'OkxRpiFeeAdvisory',
      observedSymbols: symbols.length,
      rpiFeeRowsObserved: latest.length,
      makerPermitted: latest.filter(item => item.makerPermission).length,
      executableFeeAdvantages: latest.filter(item => item.executableFeeAdvantage).length,
      visibleRpiLiquidity: latest.filter(item => item.rpiLiquidityVisible).length,
      best: latest[0] ?? null,
      productIdentityAuthority: 'cex_spot_product_policy',
      quoteCurrencyAllowlistUsed: false,
      spotRpiMinimumNotionalUsd: minimumRpiNotionalUsd(),
      rpiMakerPermissionRequired: true,
      executionAuthority: false,
    });
  } finally {
    running = false;
  }
}

export function getOkxRpiFeeOpportunities(): OkxRpiFeeOpportunity[] {
  return latest.map(item => ({ ...item }));
}

export function ensureOkxRpiFeeAdvisory(): void {
  if (timer || process.env.CRYPTO_OKX_RPI_FEE_ADVISORY_ENABLED === 'false') return;
  void refresh();
  if (process.env.NO_INTERVALS !== 'true') {
    const intervalMs = Math.max(15_000, Math.min(30 * 60_000, Number(process.env.CRYPTO_OKX_RPI_FEE_ADVISORY_INTERVAL_MS || 120_000)));
    timer = setInterval(() => void refresh(), intervalMs);
    timer.unref?.();
  }
}
