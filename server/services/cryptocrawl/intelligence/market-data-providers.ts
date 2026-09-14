import logger from '../../../logger.js';
import { orderMeasuredMarketUniverse, rankMeasuredMarketUniverse } from '../discovery/market-universe-controller.js';
import { canonicalizeCexSymbol, isUsefulArbitrageSymbol } from '../discovery/symbol-registry.js';
import { getLiveSpotProductDirectory } from '../execution/cex-spot-product-policy.js';
import {
  adoptResolvedEnvironmentVariable,
  resolveCoinStatsEnvironment,
} from '../runtime/environment-contract.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { getCoinbaseAdvancedSpotProductDirectory } from './coinbase-advanced-market-data.js';
import { getCachedOkxExecutionRestBaseUrl } from './cex-private-authority.js';
import { getHedgedDexQuote } from './dex-quote-provider-mesh.js';
import { zeroXRequestBudget } from './zerox-request-budget.js';
import { resolveZeroXRequestPolicy, type ZeroXRequestPurpose } from './zerox-request-policy.js';

export type MarketUniverseSource = 'coincap' | 'coingecko' | 'coinstats' | 'cex_product_directory';

export interface MarketUniverseAsset {
  symbol: string;
  coinGeckoId?: string;
  marketCapRank?: number;
  priceUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  priceChange24hPct?: number;
  priceHistory?: number[];
  source: MarketUniverseSource;
  sources?: MarketUniverseSource[];
  observedAt: number;
}

export interface DexQuoteObservation {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount?: string;
  maxSellAmount?: string;
  minBuyAmount?: string;
  amountMode: 'exact_in' | 'exact_out';
  slippagePpmApplied?: number;
  tradeSurplusRequested: boolean;
  tradeSurplusRecipient?: string;
  tradeSurplusMaxBps?: number;
  price?: number;
  guaranteedPrice?: number;
  liquidityAvailable: boolean;
  route?: Array<{
    source?: string;
    proportionBps?: number;
    fromToken?: string;
    toToken?: string;
  }>;
  priceImpact?: number;
  estimatedGas?: string;
  gasPrice?: string;
  fees?: Record<string, unknown>;
  allowanceTarget?: string;
  allowanceSpender?: string;
  requiresAllowance?: boolean;
  simulationIncomplete?: boolean;
  balanceIssue?: {
    token?: string;
    actual?: string;
    expected?: string;
  };
  transaction?: {
    to?: string;
    data?: string;
    value?: string;
    gas?: string;
    gasPrice?: string;
  };
  quoteKind: 'price' | 'quote';
  executable: boolean;
  observedAt: number;
  source: '0x';
}

export type MarketDataProviderName = 'coincap' | 'coingecko' | 'coinstats' | '0x';
export type MarketDataProviderState = 'not_queried' | 'live' | 'cached' | 'stale' | 'throttled' | 'unavailable' | 'failed';

export interface MarketDataProviderStatus {
  provider: MarketDataProviderName;
  state: MarketDataProviderState;
  observedAt: number | null;
  detail?: string;
}

const COINCAP_TTL_MS = Math.max(10_000, Number(process.env.COINCAP_MARKET_TTL_MS || 60_000));
const COINGECKO_TTL_MS = Math.max(30_000, Number(process.env.COINGECKO_MARKET_TTL_MS || 300_000));
const COINSTATS_TTL_MS = Math.max(30_000, Number(process.env.COINSTATS_MARKET_TTL_MS || 300_000));
const ZEROX_TTL_MS = Math.max(100, Math.min(5_000, Number(process.env.ZEROX_QUOTE_TTL_MS || 750)));
const ZEROX_AUTH_FAILURE_COOLDOWN_MS = Math.max(5_000, Math.min(60_000, Number(process.env.ZEROX_AUTH_FAILURE_COOLDOWN_MS || 15_000)));
const MAX_UNIVERSE_SIZE = Math.min(50, Math.max(3, Number(process.env.CRYPTO_MARKET_UNIVERSE_SIZE || 12)));
const CEX_PRODUCT_DISCOVERY_EXPANSION = Math.max(0, Math.min(100, Math.floor(Number(process.env.CRYPTO_CEX_PRODUCT_DISCOVERY_EXPANSION || 24))));
const CEX_PRODUCT_DISCOVERY_CACHE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.CRYPTO_CEX_PRODUCT_DISCOVERY_CACHE_MS || 60_000)));
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

interface CacheEntry<T> { value: T; expiresAt: number; }

type ProductDirectoryVenue = 'coinbase' | 'kraken' | 'okx';
type ProductDirectoryObservation = { venue: ProductDirectoryVenue; observedAt: number; symbols: string[] };

function getCoinStatsApiKey(): { apiKey: string | undefined; sourceName: string | null; state: string } {
  const resolution = resolveCoinStatsEnvironment();
  adoptResolvedEnvironmentVariable(resolution);
  const apiKey = process.env.COINSTATS_API_KEY?.trim() || undefined;
  return { apiKey, sourceName: resolution.sourceName, state: resolution.state };
}

const ZEROX_CREDENTIAL_SOURCES = [
  'ZEROX_API_KEY',
  'ZERO_EX_API_KEY',
  'ZERO_CAPITAL_ZEROX_API_KEY',
  '0X_API_KEY',
  'OX_API_KEY',
  'ZERO_X_API_KEY',
  'ZERO_X_KEY',
  'ZEROX_KEY',
  '0X_KEY',
] as const;
let activeZeroXCredentialSource: typeof ZEROX_CREDENTIAL_SOURCES[number] | null = null;

function zeroXCredentialCandidates(): Array<{ sourceName: typeof ZEROX_CREDENTIAL_SOURCES[number]; apiKey: string }> {
  const seen = new Set<string>();
  const ordered = activeZeroXCredentialSource
    ? [activeZeroXCredentialSource, ...ZEROX_CREDENTIAL_SOURCES]
    : [...ZEROX_CREDENTIAL_SOURCES];
  return [...new Set(ordered)].flatMap(sourceName => {
    const apiKey = process.env[sourceName]?.trim();
    if (!apiKey || seen.has(apiKey)) return [];
    seen.add(apiKey);
    return [{ sourceName, apiKey }];
  });
}

function isZeroXAuthenticationOrEntitlementFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s+(401|403)\b|cannot consume this service|unauthorized|forbidden|authentication or product entitlement rejected|product entitlement/i.test(message);
}

function positiveIntegerString(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return /^\d+$/.test(raw) && BigInt(raw) > 0n ? raw : null;
}

function optionalBoundedInteger(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : Number.NaN;
}

async function fetchZeroXPayload(url: string): Promise<{ payload: any; sourceName: string }> {
  const candidates = zeroXCredentialCandidates();
  if (candidates.length === 0) throw new Error('No supported 0x API credential is visible');
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const payload = await fetchJsonWithRetry<any>(url, {
        init: { headers: { accept: 'application/json', 'cache-control': 'no-cache', '0x-api-key': candidate.apiKey, '0x-version': 'v2' } },
        maxRetries: activeZeroXCredentialSource === candidate.sourceName ? 2 : 0,
        baseDelayMs: 250,
        maxDelayMs: 2_000,
        timeoutMs: 4_000,
      });
      activeZeroXCredentialSource = candidate.sourceName;
      return { payload, sourceName: candidate.sourceName };
    } catch (error) {
      if (!isZeroXAuthenticationOrEntitlementFailure(error)) throw error;
      failures.push(candidate.sourceName);
      if (activeZeroXCredentialSource === candidate.sourceName) activeZeroXCredentialSource = null;
    }
  }
  throw new Error(`0x authentication or product entitlement rejected for ${failures.length} visible credential source(s): ${failures.join(', ')}`);
}

class MarketDataProviders {
  private universeCache: CacheEntry<MarketUniverseAsset[]> | null = null;
  private lastUniverse: MarketUniverseAsset[] = [];
  private coinCapCache: CacheEntry<MarketUniverseAsset[]> | null = null;
  private coinStatsCache: CacheEntry<MarketUniverseAsset[]> | null = null;
  private quoteCache = new Map<string, CacheEntry<DexQuoteObservation | null>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private productDiscoveryCursor = 0;
  private zeroXUnavailableUntil = 0;
  private zeroXUnavailableReason: string | null = null;
  private providerStatuses: Record<MarketDataProviderName, MarketDataProviderStatus> = {
    coincap: { provider: 'coincap', state: 'not_queried', observedAt: null, detail: 'not queried' },
    coingecko: { provider: 'coingecko', state: 'not_queried', observedAt: null, detail: 'not queried' },
    coinstats: { provider: 'coinstats', state: 'not_queried', observedAt: null, detail: 'not queried' },
    '0x': { provider: '0x', state: 'not_queried', observedAt: null, detail: 'legacy 0x network path retired; hedged DEX mesh is authoritative' },
  };

  getProviderStatuses(): MarketDataProviderStatus[] {
    return Object.values(this.providerStatuses).map(status => ({ ...status }));
  }

  getZeroXRequestBudgetSnapshot() {
    return zeroXRequestBudget.getSnapshot();
  }

  private setProviderStatus(provider: MarketDataProviderName, state: MarketDataProviderState, detail?: string): void {
    this.providerStatuses[provider] = {
      provider,
      state,
      observedAt: Date.now(),
      ...(detail ? { detail } : {}),
    };
  }

  private async discoverCrossVenueProductCandidates(): Promise<MarketUniverseAsset[]> {
    if (CEX_PRODUCT_DISCOVERY_EXPANSION <= 0) return [];
    const tasks: Array<Promise<ProductDirectoryObservation | null>> = [
      getCoinbaseAdvancedSpotProductDirectory().then(directory => ({ ...directory } as ProductDirectoryObservation)).catch(error => {
        logger.debug('[MarketUniverse] Coinbase product-directory expansion unavailable', { component: 'MarketDataProviders', error: error instanceof Error ? error.message : String(error) });
        return null;
      }),
      getLiveSpotProductDirectory('kraken').then(directory => ({ ...directory } as ProductDirectoryObservation)).catch(error => {
        logger.debug('[MarketUniverse] Kraken product-directory expansion unavailable', { component: 'MarketDataProviders', error: error instanceof Error ? error.message : String(error) });
        return null;
      }),
    ];
    if (getCachedOkxExecutionRestBaseUrl()) {
      tasks.push(getLiveSpotProductDirectory('okx').then(directory => ({ ...directory } as ProductDirectoryObservation)).catch(error => {
        logger.debug('[MarketUniverse] OKX product-directory expansion unavailable', { component: 'MarketDataProviders', error: error instanceof Error ? error.message : String(error) });
        return null;
      }));
    }
    const directories = (await Promise.all(tasks)).filter((value): value is ProductDirectoryObservation => value !== null);
    const support = new Map<string, { venues: Set<ProductDirectoryVenue>; observedAt: number }>();
    for (const directory of directories) {
      for (const raw of directory.symbols) {
        const canonical = canonicalizeCexSymbol(raw);
        if (!canonical || !isUsefulArbitrageSymbol(canonical.symbol)) continue;
        const current = support.get(canonical.symbol) || { venues: new Set<ProductDirectoryVenue>(), observedAt: 0 };
        current.venues.add(directory.venue);
        current.observedAt = Math.max(current.observedAt, directory.observedAt);
        support.set(canonical.symbol, current);
      }
    }
    const eligible = [...support.entries()].filter(([, value]) => value.venues.size >= 2)
      .sort((left, right) => right[1].venues.size - left[1].venues.size || left[0].localeCompare(right[0]));
    if (eligible.length === 0) return [];
    const budget = Math.min(CEX_PRODUCT_DISCOVERY_EXPANSION, eligible.length);
    const start = this.productDiscoveryCursor % eligible.length;
    const selected = Array.from({ length: budget }, (_, offset) => eligible[(start + offset) % eligible.length]);
    this.productDiscoveryCursor = (start + Math.max(1, budget)) % eligible.length;
    logger.info('[MarketUniverse] Live cross-venue product discovery expanded search coverage', {
      component: 'MarketDataProviders', directories: directories.map(directory => ({ venue: directory.venue, products: directory.symbols.length, observedAt: directory.observedAt })),
      crossVenueProducts: eligible.length, expansionBudget: budget, selectedProducts: selected.length,
      okxIncluded: directories.some(directory => directory.venue === 'okx'), privateFeeRequestsIssuedByProductDiscovery: false,
      minimumVenueSupport: 2, executionAuthorityChanged: false,
    });
    return selected.map(([symbol, value]) => ({ symbol, source: 'cex_product_directory' as const, sources: ['cex_product_directory' as const], observedAt: value.observedAt || Date.now() }));
  }

  async discoverUniverse(): Promise<MarketUniverseAsset[]> {
    if (this.universeCache && this.universeCache.expiresAt > Date.now()) {
      for (const provider of ['coincap', 'coingecko', 'coinstats'] as const) {
        if (this.providerStatuses[provider].state === 'live') this.setProviderStatus(provider, 'cached', 'served from the market-universe cache');
      }
      return orderMeasuredMarketUniverse(this.universeCache.value);
    }
    const [coinCapAssets, coinGeckoAssets, coinStatsAssets, productCandidates] = await Promise.all([
      this.fetchCoinCapUniverse(), this.fetchCoinGeckoUniverse(), this.fetchCoinStatsUniverse(), this.discoverCrossVenueProductCandidates(),
    ]);
    const bySymbol = new Map<string, MarketUniverseAsset>();
    for (const asset of [...coinCapAssets, ...coinGeckoAssets, ...coinStatsAssets]) {
      const existing = bySymbol.get(asset.symbol);
      bySymbol.set(asset.symbol, existing ? { ...existing, sources: [...new Set([...(existing.sources || [existing.source]), asset.source])] } : { ...asset, sources: [asset.source] });
    }
    const primary = rankMeasuredMarketUniverse([...bySymbol.values()]).slice(0, MAX_UNIVERSE_SIZE);
    const primarySymbols = new Set(primary.map(asset => asset.symbol));
    const expansion = productCandidates.filter(asset => !primarySymbols.has(asset.symbol));
    const combined = [...primary, ...expansion];
    if (combined.length > 0) {
      this.lastUniverse = combined;
      const externalTtl = coinCapAssets.length > 0 ? COINCAP_TTL_MS : COINGECKO_TTL_MS;
      this.universeCache = { value: combined, expiresAt: Date.now() + Math.min(externalTtl, CEX_PRODUCT_DISCOVERY_CACHE_MS) };
      return orderMeasuredMarketUniverse(combined);
    }
    if (this.lastUniverse.length > 0) {
      if (this.providerStatuses.coincap.state !== 'unavailable') this.setProviderStatus('coincap', 'stale', 'live universe refresh failed; serving the last successful universe');
      this.setProviderStatus('coingecko', 'stale', 'live universe refresh failed; serving the last successful universe');
      if (this.providerStatuses.coinstats.state !== 'unavailable') this.setProviderStatus('coinstats', 'stale', 'live universe refresh failed; serving the last successful universe');
      this.universeCache = { value: this.lastUniverse, expiresAt: Date.now() + Math.min(COINCAP_TTL_MS, COINGECKO_TTL_MS, CEX_PRODUCT_DISCOVERY_CACHE_MS, 30_000) };
      return orderMeasuredMarketUniverse(this.lastUniverse);
    }
    return [];
  }

  async getDexQuote(request: {
    chainId: number;
    sellToken: string;
    buyToken: string;
    sellAmount?: string;
    buyAmount?: string;
    takerAddress?: string;
    purpose?: ZeroXRequestPurpose;
    forceRefresh?: boolean;
    slippagePpm?: number;
    tradeSurplusRecipient?: string;
    tradeSurplusMaxBps?: number;
  }): Promise<DexQuoteObservation | null> {
    // The hedged mesh is now the sole live DEX quote path. The historical 0x
    // implementation below remains syntactically present only to preserve
    // compatibility telemetry and make rollback local/reversible; it is not
    // reachable from production quote requests.
    return getHedgedDexQuote(request);

    const now = Date.now();
    const bypassUnavailableCooldown = request.purpose === 'execution' || request.forceRefresh === true;
    if (this.zeroXUnavailableUntil > now && !bypassUnavailableCooldown) {
      this.setProviderStatus('0x', 'unavailable', `${this.zeroXUnavailableReason || '0x credential/product entitlement unavailable'}; retry after ${new Date(this.zeroXUnavailableUntil).toISOString()}`);
      return null;
    }
    if (this.zeroXUnavailableUntil > 0 && this.zeroXUnavailableUntil <= now) {
      this.zeroXUnavailableUntil = 0;
      this.zeroXUnavailableReason = null;
    }

    const sellAmount = positiveIntegerString(request.sellAmount);
    const exactBuyAmount = positiveIntegerString(request.buyAmount);
    if ((sellAmount === null) === (exactBuyAmount === null)) {
      this.setProviderStatus('0x', 'failed', '0x quote requires exactly one positive sellAmount or buyAmount');
      return null;
    }
    const amountMode: 'exact_in' | 'exact_out' = sellAmount !== null ? 'exact_in' : 'exact_out';

    const slippagePpm = optionalBoundedInteger(request.slippagePpm, 0, 1_000_000);
    if (Number.isNaN(slippagePpm)) {
      this.setProviderStatus('0x', 'failed', 'slippagePpm must be an integer from 0 through 1000000');
      return null;
    }

    const credentialCandidates = zeroXCredentialCandidates();
    if (credentialCandidates.length === 0) {
      this.setProviderStatus('0x', 'unavailable', `No supported 0x credential is configured; checked ${ZEROX_CREDENTIAL_SOURCES.join(', ')}`);
      return null;
    }
    const policy = resolveZeroXRequestPolicy({ purpose: request.purpose, takerAddress: request.takerAddress });
    if (!policy.allowed) {
      this.setProviderStatus('0x', 'unavailable', policy.reason);
      return null;
    }

    const requestedSurplusRecipient = request.tradeSurplusRecipient?.trim() || '';
    if (requestedSurplusRecipient && !EVM_ADDRESS.test(requestedSurplusRecipient)) {
      this.setProviderStatus('0x', 'failed', 'tradeSurplusRecipient must be a valid EVM address');
      return null;
    }
    const tradeSurplusPlanEnabled = process.env.ZEROX_TRADE_SURPLUS_CUSTOM_PLAN_ENABLED?.trim().toLowerCase() === 'true';
    const tradeSurplusRequested = policy.endpoint === 'quote' && tradeSurplusPlanEnabled && Boolean(requestedSurplusRecipient);
    const tradeSurplusMaxBps = optionalBoundedInteger(request.tradeSurplusMaxBps, 1, 10_000);
    if (Number.isNaN(tradeSurplusMaxBps)) {
      this.setProviderStatus('0x', 'failed', 'tradeSurplusMaxBps must be an integer from 1 through 10000');
      return null;
    }

    const amountIdentity = sellAmount !== null ? `sell:${sellAmount}` : `buy:${exactBuyAmount}`;
    const key = [
      request.chainId,
      request.sellToken.toLowerCase(),
      request.buyToken.toLowerCase(),
      amountIdentity,
      policy.purpose,
      policy.takerAddress || '',
      slippagePpm ?? 'default',
      tradeSurplusRequested ? requestedSurplusRecipient.toLowerCase() : 'no-surplus',
      tradeSurplusRequested ? (tradeSurplusMaxBps ?? 10_000) : 'none',
    ].join(':');
    const cacheAllowed = policy.purpose === 'discovery' && request.forceRefresh !== true;
    const cached = cacheAllowed ? this.quoteCache.get(key) : undefined;
    if (cached && cached.expiresAt > Date.now()) {
      this.setProviderStatus('0x', 'cached', `served from the DEX ${policy.endpoint} cache`);
      return cached.value;
    }
    const existing = this.inFlight.get(key) as Promise<DexQuoteObservation | null> | undefined;
    if (existing) return existing;
    const admission = zeroXRequestBudget.tryAcquire(policy.purpose);
    if (!admission.allowed) {
      this.setProviderStatus('0x', 'throttled', admission.reason);
      return null;
    }

    const query = new URLSearchParams({
      chainId: String(request.chainId),
      sellToken: request.sellToken,
      buyToken: request.buyToken,
    });
    if (sellAmount !== null) query.set('sellAmount', sellAmount);
    else query.set('buyAmount', exactBuyAmount!);
    if (policy.includeTaker) query.set('taker', policy.takerAddress!);
    if (slippagePpm !== null) query.set('slippagePpm', String(slippagePpm));
    if (tradeSurplusRequested) {
      query.set('tradeSurplusRecipient', requestedSurplusRecipient);
      query.set('tradeSurplusMaxBps', String(tradeSurplusMaxBps ?? 10_000));
    }
    const requestUrl = `https://api.0x.org/swap/allowance-holder/${policy.endpoint}?${query.toString()}`;

    const promise = fetchZeroXPayload(requestUrl).then(({ payload, sourceName }) => {
      this.zeroXUnavailableUntil = 0;
      this.zeroXUnavailableReason = null;
      const resolvedSellAmount = positiveIntegerString(payload?.sellAmount)
        || positiveIntegerString(payload?.maxSellAmount)
        || sellAmount;
      const resolvedBuyAmount = positiveIntegerString(payload?.buyAmount) || exactBuyAmount;
      const sellAmountNumber = Number(resolvedSellAmount);
      const buyAmountNumber = Number(resolvedBuyAmount);
      const route = Array.isArray(payload?.route?.fills) ? payload.route.fills.map((fill: any) => ({
        source: typeof fill?.source === 'string' ? fill.source : undefined,
        proportionBps: Number.isFinite(Number(fill?.proportionBps)) ? Number(fill.proportionBps) : undefined,
        fromToken: typeof fill?.from === 'string' ? fill.from : undefined,
        toToken: typeof fill?.to === 'string' ? fill.to : undefined,
      })).filter((fill: { source?: string; proportionBps?: number; fromToken?: string; toToken?: string }) => fill.source || fill.proportionBps !== undefined || fill.fromToken || fill.toToken) : undefined;
      const priceImpact = Number(payload?.priceImpact);
      const allowanceIssue = payload?.issues?.allowance && typeof payload.issues.allowance === 'object' ? payload.issues.allowance : null;
      const balanceIssue = payload?.issues?.balance && typeof payload.issues.balance === 'object' ? payload.issues.balance : null;
      const observation: DexQuoteObservation | null = resolvedSellAmount && resolvedBuyAmount && Number.isFinite(buyAmountNumber) && buyAmountNumber > 0 ? {
        chainId: request.chainId,
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        sellAmount: resolvedSellAmount,
        buyAmount: resolvedBuyAmount,
        maxSellAmount: positiveIntegerString(payload?.maxSellAmount) || undefined,
        minBuyAmount: positiveIntegerString(payload?.minBuyAmount) || undefined,
        amountMode,
        slippagePpmApplied: slippagePpm ?? undefined,
        tradeSurplusRequested,
        tradeSurplusRecipient: tradeSurplusRequested ? requestedSurplusRecipient : undefined,
        tradeSurplusMaxBps: tradeSurplusRequested ? (tradeSurplusMaxBps ?? 10_000) : undefined,
        price: Number.isFinite(sellAmountNumber) && sellAmountNumber > 0 ? buyAmountNumber / sellAmountNumber : undefined,
        guaranteedPrice: Number(payload?.guaranteedPrice) || undefined,
        liquidityAvailable: payload?.liquidityAvailable === undefined ? buyAmountNumber > 0 : payload.liquidityAvailable === true,
        route,
        priceImpact: Number.isFinite(priceImpact) ? priceImpact : undefined,
        estimatedGas: typeof payload?.estimatedGas === 'string' ? payload.estimatedGas : undefined,
        gasPrice: typeof payload?.gasPrice === 'string' ? payload.gasPrice : undefined,
        fees: payload?.fees && typeof payload.fees === 'object' ? payload.fees : undefined,
        allowanceTarget: typeof payload?.allowanceTarget === 'string' ? payload.allowanceTarget : undefined,
        allowanceSpender: typeof allowanceIssue?.spender === 'string' ? allowanceIssue.spender : undefined,
        requiresAllowance: allowanceIssue !== null,
        simulationIncomplete: payload?.issues?.simulationIncomplete === true,
        balanceIssue: balanceIssue ? {
          token: typeof balanceIssue.token === 'string' ? balanceIssue.token : undefined,
          actual: typeof balanceIssue.actual === 'string' ? balanceIssue.actual : undefined,
          expected: typeof balanceIssue.expected === 'string' ? balanceIssue.expected : undefined,
        } : undefined,
        transaction: policy.endpoint === 'quote' && payload?.transaction && typeof payload.transaction === 'object' ? {
          to: typeof payload.transaction.to === 'string' ? payload.transaction.to : undefined,
          data: typeof payload.transaction.data === 'string' ? payload.transaction.data : undefined,
          value: typeof payload.transaction.value === 'string' ? payload.transaction.value : undefined,
          gas: typeof payload.transaction.gas === 'string' ? payload.transaction.gas : undefined,
          gasPrice: typeof payload.transaction.gasPrice === 'string' ? payload.transaction.gasPrice : undefined,
        } : undefined,
        quoteKind: policy.endpoint,
        executable: policy.endpoint === 'quote' && typeof payload?.transaction?.to === 'string' && typeof payload?.transaction?.data === 'string',
        observedAt: Date.now(),
        source: '0x',
      } : null;
      if (policy.purpose === 'discovery') {
        this.quoteCache.set(key, { value: observation, expiresAt: Date.now() + ZEROX_TTL_MS });
      }
      const features = [
        amountMode === 'exact_out' ? 'exact-out' : 'exact-in',
        slippagePpm !== null ? `slippagePpm=${slippagePpm}` : null,
        policy.purpose === 'execution' ? 'execution-cache-bypass' : null,
        request.forceRefresh === true ? 'forced-refresh' : null,
        tradeSurplusRequested ? 'trade-surplus-custom-plan' : null,
      ].filter(Boolean).join(',');
      this.setProviderStatus('0x', observation ? 'live' : 'failed', observation ? `${policy.reason}; ${features}; authenticated via ${sourceName}` : '0x returned no usable buy amount');
      return observation;
    }).catch((error: unknown) => {
      if (policy.purpose === 'discovery') {
        this.quoteCache.set(key, { value: null, expiresAt: Date.now() + ZEROX_TTL_MS });
      }
      const detail = error instanceof Error ? error.message : String(error);
      if (isZeroXAuthenticationOrEntitlementFailure(error)) {
        this.zeroXUnavailableUntil = Date.now() + ZEROX_AUTH_FAILURE_COOLDOWN_MS;
        this.zeroXUnavailableReason = detail;
        this.setProviderStatus('0x', 'unavailable', `${detail}; bounded retry cooldown ${ZEROX_AUTH_FAILURE_COOLDOWN_MS}ms; execution/forced refresh bypass enabled`);
      } else {
        this.setProviderStatus('0x', 'failed', detail);
      }
      return null;
    }).finally(() => {
      admission.release();
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchCoinCapUniverse(): Promise<MarketUniverseAsset[]> {
    const apiKey = process.env.COINCAP_API_KEY?.trim();
    if (!apiKey) {
      this.setProviderStatus('coincap', 'unavailable', 'COINCAP_API_KEY is not configured');
      return [];
    }
    if (this.coinCapCache && this.coinCapCache.expiresAt > Date.now()) {
      this.setProviderStatus('coincap', 'cached', 'served from the authenticated CoinCap cache');
      return this.coinCapCache.value;
    }
    try {
      const baseUrl = (process.env.COINCAP_API_BASE_URL?.trim() || 'https://rest.coincap.io/v3').replace(/\/$/, '');
      const payload = await fetchJsonWithRetry<any>(`${baseUrl}/assets?limit=${MAX_UNIVERSE_SIZE}`, {
        init: { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } }, maxRetries: 2, baseDelayMs: 250, maxDelayMs: 2_000, timeoutMs: 5_000,
      });
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      const observedAt = Number.isFinite(Number(payload?.timestamp)) ? Number(payload.timestamp) : Date.now();
      const assets = rows.filter((row: any) => typeof row?.symbol === 'string' && row.symbol.trim()).map((row: any) => ({
        symbol: `${row.symbol.trim().toUpperCase()}USDT`, marketCapRank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : undefined,
        priceUsd: Number.isFinite(Number(row.priceUsd)) ? Number(row.priceUsd) : undefined,
        volume24hUsd: Number.isFinite(Number(row.volumeUsd24Hr)) ? Number(row.volumeUsd24Hr) : undefined,
        marketCapUsd: Number.isFinite(Number(row.marketCapUsd)) ? Number(row.marketCapUsd) : undefined,
        priceChange24hPct: Number.isFinite(Number(row.changePercent24Hr)) ? Number(row.changePercent24Hr) : undefined,
        source: 'coincap' as const, sources: ['coincap' as const], observedAt,
      }));
      this.coinCapCache = { value: assets, expiresAt: Date.now() + COINCAP_TTL_MS };
      this.setProviderStatus('coincap', 'live', 'authenticated CoinCap v3 market feed is primary');
      return assets;
    } catch (error) {
      this.setProviderStatus('coincap', this.coinCapCache ? 'stale' : 'failed', error instanceof Error ? error.message : String(error));
      return this.coinCapCache?.value || [];
    }
  }

  private async fetchCoinGeckoUniverse(): Promise<MarketUniverseAsset[]> {
    try {
      const apiKey = process.env.COINGECKO_API_KEY?.trim();
      const headers: HeadersInit = { accept: 'application/json' };
      if (apiKey) headers['x-cg-demo-api-key'] = apiKey;
      const rows = await fetchJsonWithRetry<any[]>(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MAX_UNIVERSE_SIZE}&page=1&sparkline=true`, { init: { headers }, maxRetries: 2, baseDelayMs: 500, maxDelayMs: 4_000, timeoutMs: 6_000 });
      const assets = rows.filter(row => typeof row?.symbol === 'string').map(row => ({
        symbol: `${row.symbol.toUpperCase()}USDT`, coinGeckoId: row.id, marketCapRank: Number(row.market_cap_rank) || undefined,
        priceUsd: Number.isFinite(Number(row.current_price)) ? Number(row.current_price) : undefined,
        volume24hUsd: Number.isFinite(Number(row.total_volume)) ? Number(row.total_volume) : undefined,
        marketCapUsd: Number.isFinite(Number(row.marketCap || row.market_cap)) ? Number(row.marketCap || row.market_cap) : undefined,
        priceChange24hPct: Number.isFinite(Number(row.price_change_percentage_24h)) ? Number(row.price_change_percentage_24h) : undefined,
        priceHistory: Array.isArray(row.sparkline_in_7d?.price) ? row.sparkline_in_7d.price.filter((price: unknown) => Number.isFinite(Number(price)) && Number(price) > 0).map((price: unknown) => Number(price)) : undefined,
        source: 'coingecko' as const, sources: ['coingecko' as const], observedAt: Date.now(),
      }));
      this.setProviderStatus('coingecko', 'live');
      return assets;
    } catch (error) {
      this.setProviderStatus('coingecko', this.lastUniverse.length > 0 ? 'stale' : 'failed', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async fetchCoinStatsUniverse(): Promise<MarketUniverseAsset[]> {
    const credential = getCoinStatsApiKey();
    if (!credential.apiKey) {
      this.setProviderStatus('coinstats', 'unavailable', `optional CoinStats credential ${credential.state.toLowerCase()} after checking canonical and supported aliases`);
      return [];
    }
    if (this.coinStatsCache && this.coinStatsCache.expiresAt > Date.now()) {
      this.setProviderStatus('coinstats', 'cached', `served from the CoinStats cache; credential source=${credential.sourceName || 'canonical'}`);
      return this.coinStatsCache.value;
    }
    try {
      const rows = await fetchJsonWithRetry<any>(`https://openapiv1.coinstats.app/coins?currency=USD&limit=${MAX_UNIVERSE_SIZE}`, { init: { headers: { accept: 'application/json', 'X-API-KEY': credential.apiKey } }, maxRetries: 2, timeoutMs: 6_000 });
      const assets = (Array.isArray(rows) ? rows : rows?.result || rows?.coins || []).filter((row: any) => typeof row?.symbol === 'string').map((row: any) => ({
        symbol: `${row.symbol.toUpperCase()}USDT`, priceUsd: Number.isFinite(Number(row.price)) ? Number(row.price) : undefined,
        volume24hUsd: Number.isFinite(Number(row.volume)) ? Number(row.volume) : undefined,
        marketCapUsd: Number.isFinite(Number(row.marketCap || row.market_cap)) ? Number(row.marketCap || row.market_cap) : undefined,
        priceChange24hPct: Number.isFinite(Number(row.priceChange1d || row.price_change_percentage_24h)) ? Number(row.priceChange1d || row.price_change_percentage_24h) : undefined,
        source: 'coinstats' as const, sources: ['coinstats' as const], observedAt: Date.now(),
      }));
      this.coinStatsCache = { value: assets, expiresAt: Date.now() + COINSTATS_TTL_MS };
      this.setProviderStatus('coinstats', 'live', `authenticated via ${credential.sourceName || 'COINSTATS_API_KEY'}`);
      return assets;
    } catch (error) {
      this.setProviderStatus('coinstats', this.coinStatsCache ? 'stale' : 'failed', error instanceof Error ? error.message : String(error));
      return [];
    }
  }
}

export const marketDataProviders = new MarketDataProviders();