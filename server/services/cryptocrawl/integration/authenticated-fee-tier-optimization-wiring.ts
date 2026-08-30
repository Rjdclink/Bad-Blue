import logger from '../../../logger.js';
import {
  arbitrageVerifier,
  type QuoteVenue,
  type VerifiedArbitragePlan,
  type VerifyManyRequest,
} from '../arbitrage/arbitrage-verifier.js';
import type { ScanCapacityDecision } from '../discovery/scan-capacity-policy.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { isMakerRecoveryPlan } from '../execution/stablecoin-maker-strategy.js';
import { isHybridCexRecoveryPlan, type HybridCexLegMode } from '../runtime/hybrid-cex-execution-wiring.js';
import { coinbasePrivateRequest, assertCoinbaseSpotTradeReady } from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCexSpotProductSupport } from '../intelligence/cex-fee-resolver.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';

export interface AuthenticatedFeeTierSnapshot {
  venue: QuoteVenue;
  symbol: string;
  takerFeeBps: number;
  makerFeeBps: number;
  makerRebateActive: boolean;
  tierLabel: string | null;
  currentQualificationValueUsd: number | null;
  nextTierThresholdUsd: number | null;
  observedAt: number;
  source: 'kraken_trade_volume' | 'okx_trade_fee' | 'coinbase_transaction_summary';
}

let installed = false;
let timer: NodeJS.Timeout | null = null;
let scanInFlight: Promise<void> | null = null;
let lastScanAt = 0;
const latest = new Map<string, AuthenticatedFeeTierSnapshot>();

function refreshMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_AUTHENTICATED_FEE_REFRESH_MS || 60_000);
  return Number.isFinite(parsed) ? Math.max(30_000, Math.min(300_000, Math.trunc(parsed))) : 60_000;
}

function maxAgeMs(): number {
  return Math.max(refreshMs() * 2, 90_000);
}

function key(venue: QuoteVenue, symbol: string): string {
  return `${venue}:${symbol.trim().toUpperCase()}`;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalKrakenResponseSymbol(value: string): string {
  let compact = value.toUpperCase().replace(/[\/_-]/g, '');
  compact = compact
    .replace(/^XXBT/, 'BTC')
    .replace(/^XBT/, 'BTC')
    .replace(/^XETH/, 'ETH')
    .replace(/^XXDG/, 'DOGE')
    .replace(/^XDG/, 'DOGE')
    .replace(/ZUSD$/, 'USD')
    .replace(/ZGBP$/, 'GBP')
    .replace(/ZEUR$/, 'EUR')
    .replace(/ZJPY$/, 'JPY');
  return compact;
}

function store(snapshot: AuthenticatedFeeTierSnapshot): void {
  latest.set(key(snapshot.venue, snapshot.symbol), snapshot);
}

function fresh(venue: QuoteVenue, symbol: string): AuthenticatedFeeTierSnapshot | null {
  const value = latest.get(key(venue, symbol));
  if (!value || Date.now() - value.observedAt > maxAgeMs()) return null;
  return { ...value };
}

async function supportedSymbols(venue: 'kraken' | 'okx', symbols: readonly string[]): Promise<string[]> {
  const settled = await Promise.all(symbols.map(async symbol => {
    const support = await getCexSpotProductSupport(venue, symbol).catch(() => null);
    return support?.supported ? support.symbol : null;
  }));
  return settled.filter((value): value is string => Boolean(value));
}

async function scanKraken(symbols: readonly string[]): Promise<void> {
  const supported = await supportedSymbols('kraken', symbols);
  if (supported.length === 0) return;
  const result = await krakenPrivateRequest('/0/private/TradeVolume', {
    pair: supported.join(','),
    'fee-info': 'true',
  }, { timeoutMs: 30_000 });
  const takerRows = result?.fees && typeof result.fees === 'object' ? result.fees : {};
  const makerRows = result?.fees_maker && typeof result.fees_maker === 'object' ? result.fees_maker : {};
  const makerByCanonical = new Map(Object.entries(makerRows).map(([responseKey, row]) => [canonicalKrakenResponseSymbol(responseKey), row as any]));
  const observedAt = Date.now();
  const volume = finite(result?.volume);

  for (const [responseKey, raw] of Object.entries(takerRows)) {
    const symbol = canonicalKrakenResponseSymbol(responseKey);
    const row = raw as any;
    const maker = makerByCanonical.get(symbol);
    const takerPct = finite(row?.fee);
    const makerPct = finite(maker?.fee);
    if (takerPct === null || makerPct === null) continue;
    store({
      venue: 'kraken',
      symbol,
      takerFeeBps: Math.max(0, takerPct * 100),
      makerFeeBps: makerPct * 100,
      makerRebateActive: makerPct < 0,
      tierLabel: null,
      currentQualificationValueUsd: volume,
      nextTierThresholdUsd: finite(maker?.nextvolume ?? row?.nextvolume),
      observedAt,
      source: 'kraken_trade_volume',
    });
  }
}

function okxRateToCostBps(raw: unknown): number | null {
  const rate = finite(raw);
  return rate === null ? null : -rate * 10_000;
}

async function scanOkx(symbols: readonly string[]): Promise<void> {
  const supported = await supportedSymbols('okx', symbols);
  const concurrency = 3;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, supported.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= supported.length) return;
      const symbol = supported[index];
      const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
      if (!match) continue;
      const instId = `${match[1]}-${match[2]}`;
      try {
        const { data } = await okxPrivateRequest('/api/v5/account/trade-fee', 'GET', {
          instType: 'SPOT',
          instId,
        }, { timeoutMs: 30_000, lane: 'trade_fee' });
        const row = data[0];
        const onlyGroup = Array.isArray(row?.feeGroup) && row.feeGroup.length === 1 ? row.feeGroup[0] : null;
        const takerFeeBps = okxRateToCostBps(onlyGroup?.taker ?? row?.taker);
        const makerFeeBps = okxRateToCostBps(onlyGroup?.maker ?? row?.maker);
        if (takerFeeBps === null || makerFeeBps === null) continue;
        store({
          venue: 'okx',
          symbol,
          takerFeeBps,
          makerFeeBps,
          makerRebateActive: makerFeeBps < 0,
          tierLabel: typeof row?.level === 'string' ? row.level : null,
          currentQualificationValueUsd: null,
          nextTierThresholdUsd: null,
          observedAt: Date.now(),
          source: 'okx_trade_fee',
        });
      } catch (error) {
        logger.debug('[AuthenticatedFeeTier] OKX instrument fee refresh degraded', {
          component: 'AuthenticatedFeeTierOptimizationWiring',
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }));
}

async function scanCoinbase(symbols: readonly string[]): Promise<void> {
  if (symbols.length === 0) return;
  await assertCoinbaseSpotTradeReady();
  const payload = await coinbasePrivateRequest('/api/v3/brokerage/transaction_summary', 'GET', {
    query: { product_type: 'SPOT' },
    timeoutMs: 30_000,
  });
  const tier = payload?.fee_tier;
  const takerRate = finite(tier?.taker_fee_rate);
  const makerRate = finite(tier?.maker_fee_rate);
  if (takerRate === null || makerRate === null) return;
  const current = finite(payload?.fee_tier_without_promotion?.current_value ?? payload?.advanced_trade_only_volume);
  const next = finite(payload?.fee_tier_without_promotion?.next_tier_threshold);
  const observedAt = Date.now();
  for (const symbol of symbols) {
    store({
      venue: 'coinbase',
      symbol,
      takerFeeBps: takerRate * 10_000,
      makerFeeBps: makerRate * 10_000,
      makerRebateActive: makerRate < 0,
      tierLabel: typeof tier?.pricing_tier === 'string' ? tier.pricing_tier : null,
      currentQualificationValueUsd: current,
      nextTierThresholdUsd: next,
      observedAt,
      source: 'coinbase_transaction_summary',
    });
  }
}

async function scanOnce(symbolsInput?: readonly string[]): Promise<void> {
  if (scanInFlight) return scanInFlight;
  const work = (async () => {
    const configured = (process.env.CRYPTO_ARBITRAGE_SYMBOL || 'ETHUSDT').trim().toUpperCase();
    const symbols = [...new Set([
      configured,
      ...(symbolsInput || getLastOrderedMarketUniverseSymbols()).map(symbol => symbol.trim().toUpperCase()).filter(Boolean),
    ])].slice(0, 24);
    const settled = await Promise.allSettled([
      scanKraken(symbols),
      scanOkx(symbols),
      scanCoinbase(symbols),
    ]);
    lastScanAt = Date.now();
    const failures = settled
      .map((result, index) => ({ result, venue: ['kraken', 'okx', 'coinbase'][index] }))
      .filter(item => item.result.status === 'rejected')
      .map(item => ({
        venue: item.venue,
        error: item.result.status === 'rejected'
          ? (item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason))
          : '',
      }));
    const rebates = [...latest.values()].filter(value => value.makerRebateActive && Date.now() - value.observedAt <= maxAgeMs());
    logger.info('[AuthenticatedFeeTier] Authenticated fee/rebate scan refreshed', {
      component: 'AuthenticatedFeeTierOptimizationWiring',
      symbols: symbols.length,
      freshSnapshots: [...latest.values()].filter(value => Date.now() - value.observedAt <= maxAgeMs()).length,
      activeMakerRebates: rebates.map(item => ({ venue: item.venue, symbol: item.symbol, makerFeeBps: item.makerFeeBps })),
      failures,
      refreshMs: refreshMs(),
      modeSelectionAuthority: 'expected_realized_net_value_not_rebate_alone',
      minimumOrderNotionalTierAssumed: false,
    });
  })().finally(() => { scanInFlight = null; });
  scanInFlight = work;
  return work;
}

function feeFor(plan: VerifiedArbitragePlan, venue: QuoteVenue, side: 'buy' | 'sell'): number | null {
  const snapshot = fresh(venue, plan.symbol);
  if (!snapshot) return null;
  if (isHybridCexRecoveryPlan(plan)) {
    const mode: HybridCexLegMode = side === 'buy' ? plan.hybridExecution.buyMode : plan.hybridExecution.sellMode;
    return mode === 'maker' ? snapshot.makerFeeBps : snapshot.takerFeeBps;
  }
  if (isMakerRecoveryPlan(plan)) return snapshot.makerFeeBps;
  return snapshot.takerFeeBps;
}

function reprice(plan: VerifiedArbitragePlan): VerifiedArbitragePlan {
  const buyFeeBps = feeFor(plan, plan.buyVenue, 'buy');
  const sellFeeBps = feeFor(plan, plan.sellVenue, 'sell');
  if (buyFeeBps === null || sellFeeBps === null) return plan;
  const buyNotional = plan.baseQty * plan.buyAsk;
  const sellNotional = plan.baseQty * plan.sellBid;
  const buyFeeUsd = buyNotional * buyFeeBps / 10_000;
  const sellFeeUsd = sellNotional * sellFeeBps / 10_000;
  const grossProfitUsd = sellNotional - buyNotional;
  const fixed = plan.costs.gasUsd + plan.costs.bridgeFeeUsd + (plan.costs.transferFeeUsd ?? 0);
  const totalCostsUsd = buyFeeUsd + sellFeeUsd + fixed;
  const netProfitUsd = grossProfitUsd - totalCostsUsd;
  return {
    ...plan,
    grossProfitUsd,
    netProfitUsd,
    costs: { ...plan.costs, buyFeeUsd, sellFeeUsd, totalCostsUsd },
    feeEvidence: {
      buy: {
        takerFeeBps: fresh(plan.buyVenue, plan.symbol)?.takerFeeBps ?? plan.feeEvidence?.buy.takerFeeBps ?? 0,
        makerFeeBps: buyFeeBps >= 0 ? buyFeeBps : null,
        makerRebateBps: buyFeeBps < 0 ? Math.abs(buyFeeBps) : null,
        source: plan.buyVenue === 'kraken' ? 'kraken_account_trade_volume' : plan.buyVenue === 'okx' ? 'okx_account_trade_fee' : 'coinbase_transaction_summary',
        observedAt: fresh(plan.buyVenue, plan.symbol)?.observedAt ?? Date.now(),
      },
      sell: {
        takerFeeBps: fresh(plan.sellVenue, plan.symbol)?.takerFeeBps ?? plan.feeEvidence?.sell.takerFeeBps ?? 0,
        makerFeeBps: sellFeeBps >= 0 ? sellFeeBps : null,
        makerRebateBps: sellFeeBps < 0 ? Math.abs(sellFeeBps) : null,
        source: plan.sellVenue === 'kraken' ? 'kraken_account_trade_volume' : plan.sellVenue === 'okx' ? 'okx_account_trade_fee' : 'coinbase_transaction_summary',
        observedAt: fresh(plan.sellVenue, plan.symbol)?.observedAt ?? Date.now(),
      },
    },
  };
}

export function getAuthenticatedFeeTierSnapshot(): AuthenticatedFeeTierSnapshot[] {
  const cutoff = Date.now() - maxAgeMs();
  return [...latest.values()].filter(item => item.observedAt >= cutoff).map(item => ({ ...item }));
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  timer = setTimeout(async () => {
    timer = null;
    await scanOnce().catch(() => undefined);
    scheduleNext();
  }, refreshMs());
  timer.unref?.();
}

export function ensureAuthenticatedFeeTierOptimizationWiring(): void {
  if (installed) return;
  installed = true;

  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    evaluateMany: (
      request: VerifyManyRequest,
      symbols: readonly string[],
      capacity?: ScanCapacityDecision,
    ) => Promise<Map<string, VerifiedArbitragePlan | null>>;
  };
  const originalEvaluateOnce = verifier.evaluateOnce.bind(verifier);
  const originalEvaluateMany = verifier.evaluateMany.bind(verifier);

  verifier.evaluateOnce = async request => {
    const symbol = String(request?.symbol || '').trim().toUpperCase();
    if (Date.now() - lastScanAt >= refreshMs()) await scanOnce(symbol ? [symbol] : undefined).catch(() => undefined);
    const plan = await originalEvaluateOnce(request);
    if (!plan) return null;
    const repriced = reprice(plan);
    return Number.isFinite(repriced.netProfitUsd) && repriced.netProfitUsd > 0 ? repriced : null;
  };

  verifier.evaluateMany = async (request, symbols, capacity) => {
    if (Date.now() - lastScanAt >= refreshMs()) await scanOnce(symbols).catch(() => undefined);
    const plans = await originalEvaluateMany(request, symbols, capacity);
    for (const [symbol, plan] of plans.entries()) {
      if (!plan) continue;
      const repriced = reprice(plan);
      plans.set(symbol, Number.isFinite(repriced.netProfitUsd) && repriced.netProfitUsd > 0 ? repriced : null);
    }
    return plans;
  };

  void scanOnce().finally(scheduleNext);
  logger.info('[AuthenticatedFeeTier] Dynamic authenticated fee-tier overlay installed', {
    component: 'AuthenticatedFeeTierOptimizationWiring',
    refreshMs: refreshMs(),
    krakenAuthority: 'POST_/0/private/TradeVolume_batched_pairs',
    okxAuthority: 'GET_/api/v5/account/trade-fee_exact_instId_rate_governed',
    coinbaseAuthority: 'GET_/api/v3/brokerage/transaction_summary',
    signedMakerEconomics: true,
    negativeNormalizedMakerFeeMeansRebate: true,
    rebateAloneCanForceMakerMode: false,
    modeSelectionRule: 'highest_positive_expected_realized_net_after_fill_queue_and_cost_risk',
    configuredFeeFallbackStillPreserved: true,
    executionAuthority: false,
  });
}
