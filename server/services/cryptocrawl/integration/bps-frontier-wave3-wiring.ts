import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

const LIGHTER_FUNDING_URL = 'https://mainnet.zklighter.elliot.ai/api/v1/funding-rates';
const LIGHTER_DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
const UNISWAPX_ORDERS_URL = 'https://api.uniswap.org/v2/orders';
const GHO = '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const ANCHOR_TOKENS = new Set([GHO, USDC, USDT]);
const UNISWAPX_PUBLIC_LANES = [
  { chain: 'ethereum', chainId: 1, orderType: 'Dutch_V2' },
  { chain: 'arbitrum', chainId: 42161, orderType: 'Dutch_V3' },
  { chain: 'avalanche', chainId: 43114, orderType: 'Dutch_V3' },
  { chain: 'bsc', chainId: 56, orderType: 'Dutch_V3' },
] as const;

interface LighterFundingRow {
  market_id?: number;
  exchange?: string;
  symbol?: string;
  rate?: number | string;
}

interface LighterFundingResponse {
  code?: number;
  message?: string;
  funding_rates?: LighterFundingRow[];
}

interface UniswapXOrderToken {
  token?: string;
  startAmount?: string;
  endAmount?: string;
  amount?: string;
  recipient?: string;
  isFeeOutput?: boolean;
}

interface UniswapXOpenOrder {
  type?: string;
  encodedOrder?: string;
  signature?: string;
  orderStatus?: string;
  orderHash?: string;
  orderId?: string;
  chainId?: number;
  input?: UniswapXOrderToken;
  outputs?: UniswapXOrderToken[];
  cosignerData?: {
    decayStartTime?: number;
    decayEndTime?: number;
    exclusiveFiller?: string;
  };
}

interface UniswapXOrdersResponse {
  orders?: UniswapXOpenOrder[];
}

export interface MeasuredBpsFrontierRoute {
  routeKey: string;
  opportunityId: string;
  topology: MeasuredCandidate['topology'];
  venues: string[];
  chains: string[];
  notionalUsd: number;
  allInCostBps: number;
  netBps: number;
  observedAt: number;
  expiresAt: number;
}

export interface MeasuredBpsFrontierGroup {
  routeKey: string;
  winner: MeasuredBpsFrontierRoute;
  runnerUp: MeasuredBpsFrontierRoute | null;
  /** Difference between fresh canonical net outcomes; includes quote-embedded costs. */
  measuredNetAdvantageBps: number | null;
  /** Explicit canonical cost-field difference only; never substitutes for net outcome. */
  measuredSavingsBps: number | null;
  comparedRoutes: number;
  maximumObservationSkewMs: number;
}

export interface BpsFrontierWave3Snapshot {
  observedAt: number;
  groups: MeasuredBpsFrontierGroup[];
  lighter: {
    lastPollAt: number | null;
    observations: number;
    matchedSymbols: string[];
    lastError: string | null;
    executionAuthority: false;
  };
  uniswapX: {
    lastPollAt: number | null;
    lane: string | null;
    openOrders: number;
    anchorCompatibleOrders: number;
    standingTargetMarginBps: number;
    lastError: string | null;
    apiKeyRequired: false;
    candidateRowsCreated: 0;
    executionAuthority: false;
  };
  authority: 'measured_total_cost_frontier_and_external_discovery_only';
  executionAuthority: false;
  syntheticSavingsAllowed: false;
}

let installed = false;
let timer: NodeJS.Timeout | null = null;
let frontierTimer: NodeJS.Timeout | null = null;
let intentTimer: NodeJS.Timeout | null = null;
let lighterInFlight: Promise<void> | null = null;
let intentInFlight: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
let latestGroups: MeasuredBpsFrontierGroup[] = [];
let lastLighterPollAt: number | null = null;
let lastLighterObservations = 0;
let lastLighterSymbols: string[] = [];
let lastLighterError: string | null = null;
let uniswapLaneCursor = 0;
let lastUniswapPollAt: number | null = null;
let lastUniswapLane: string | null = null;
let lastUniswapOpenOrders = 0;
let lastUniswapAnchorCompatibleOrders = 0;
let lastUniswapError: string | null = null;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pollIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_FRONTIER_POLL_MS || 30_000);
  return Number.isFinite(parsed) ? Math.max(10_000, Math.min(120_000, Math.trunc(parsed))) : 30_000;
}

function intentPollIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_UNISWAPX_ORDER_POLL_MS || 1_000);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(10_000, Math.trunc(parsed))) : 1_000;
}

function standingTargetMarginBps(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_STANDING_MARGIN_TARGET_BPS || 25);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : 25;
}

function comparisonSkewMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_ROUTE_COMPARISON_MAX_SKEW_MS || 2_000);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(10_000, Math.trunc(parsed))) : 2_000;
}

function canonicalLighterSymbol(raw: unknown, wanted: Set<string>): string | null {
  const source = String(raw || '').trim().toUpperCase().replace(/[\/_-]/g, '');
  if (!source) return null;
  if (wanted.has(source)) return source;
  for (const quote of ['USDT', 'USDC', 'USD'] as const) {
    const candidate = `${source}${quote}`;
    if (wanted.has(candidate)) return candidate;
  }
  return null;
}

function routeIdentity(candidate: MeasuredCandidate): string | null {
  const notionalUsd = finite(candidate.canonicalBps.notionalUsd);
  const allInCostBps = finite(candidate.canonicalBps.allInCostBps);
  const netBps = finite(candidate.canonicalBps.netBps);
  if (notionalUsd === null || notionalUsd <= 0 || allInCostBps === null || netBps === null) return null;
  const assets = [...candidate.assets].map(value => value.trim().toUpperCase()).filter(Boolean).sort();
  if (!assets.length) return null;
  const chains = [...candidate.chains].map(value => value.trim().toLowerCase()).filter(Boolean).sort().join(',') || 'unknown';
  // Exact two-decimal notional bucketing deliberately prefers missing a comparison
  // over manufacturing savings from a size difference.
  return `${assets.join('/')}:${chains}:${notionalUsd.toFixed(2)}`;
}

function measuredRoute(candidate: MeasuredCandidate, routeKey: string): MeasuredBpsFrontierRoute | null {
  const notionalUsd = finite(candidate.canonicalBps.notionalUsd);
  const allInCostBps = finite(candidate.canonicalBps.allInCostBps);
  const netBps = finite(candidate.canonicalBps.netBps);
  if (notionalUsd === null || notionalUsd <= 0 || allInCostBps === null || netBps === null) return null;
  return {
    routeKey,
    opportunityId: candidate.opportunityId,
    topology: candidate.topology,
    venues: [...candidate.venues],
    chains: [...candidate.chains],
    notionalUsd,
    allInCostBps,
    netBps,
    observedAt: candidate.observedAt,
    expiresAt: candidate.expiresAt,
  };
}

function recomputeMeasuredFrontier(): void {
  const now = Date.now();
  const maxSkewMs = comparisonSkewMs();
  const grouped = new Map<string, MeasuredBpsFrontierRoute[]>();

  for (const candidate of measuredCandidateRegistry.getRecent(4096)) {
    if (candidate.expiresAt <= now || candidate.status === 'expired' || candidate.status === 'blocked') continue;
    const routeKey = routeIdentity(candidate);
    if (!routeKey) continue;
    const route = measuredRoute(candidate, routeKey);
    if (!route) continue;

    const routes = grouped.get(routeKey) || [];
    // Multiple snapshots of the same exact route must not manufacture a
    // smart-routing comparison. Only its freshest observation survives.
    const signature = `${route.topology}:${route.venues.slice().sort().join('>')}`;
    const prior = routes.findIndex(item => `${item.topology}:${item.venues.slice().sort().join('>')}` === signature);
    if (prior >= 0) {
      if (route.observedAt >= routes[prior].observedAt) routes[prior] = route;
    } else {
      routes.push(route);
    }
    grouped.set(routeKey, routes);
  }

  latestGroups = [...grouped.entries()].flatMap(([routeKey, routes]) => {
    if (routes.length < 2) return [];
    const freshestObservedAt = Math.max(...routes.map(route => route.observedAt));
    // SOR decisions must compare contemporaneous quotes. A stale-but-unexpired
    // candidate cannot win merely because its older price was better.
    const comparable = routes.filter(route => freshestObservedAt - route.observedAt <= maxSkewMs);
    if (comparable.length < 2) return [];
    const ordered = [...comparable].sort((left, right) =>
      right.netBps - left.netBps
      || left.allInCostBps - right.allInCostBps
      || right.observedAt - left.observedAt);
    const winner = ordered[0];
    const runnerUp = ordered[1] || null;
    const maximumObservationSkewMs = Math.max(...ordered.map(route => freshestObservedAt - route.observedAt));
    return [{
      routeKey,
      winner,
      runnerUp,
      measuredNetAdvantageBps: runnerUp ? Math.max(0, winner.netBps - runnerUp.netBps) : null,
      measuredSavingsBps: runnerUp && winner.allInCostBps <= runnerUp.allInCostBps
        ? Math.max(0, runnerUp.allInCostBps - winner.allInCostBps)
        : null,
      comparedRoutes: ordered.length,
      maximumObservationSkewMs,
    }];
  }).sort((left, right) =>
    (right.measuredNetAdvantageBps ?? -1) - (left.measuredNetAdvantageBps ?? -1)
    || (right.measuredSavingsBps ?? -1) - (left.measuredSavingsBps ?? -1)
    || right.winner.netBps - left.winner.netBps)
    .slice(0, 128);
}

function scheduleFrontierRefresh(): void {
  if (frontierTimer) return;
  frontierTimer = setTimeout(() => {
    frontierTimer = null;
    recomputeMeasuredFrontier();
  }, 250);
  frontierTimer.unref?.();
}

function normalizedToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function anchorCompatible(order: UniswapXOpenOrder): boolean {
  const input = normalizedToken(order.input?.token);
  const outputs = Array.isArray(order.outputs)
    ? order.outputs.filter(output => output.isFeeOutput !== true).map(output => normalizedToken(output.token)).filter(Boolean)
    : [];
  if (!ANCHOR_TOKENS.has(input) || outputs.length !== 1 || !ANCHOR_TOKENS.has(outputs[0])) return false;
  return input !== outputs[0] && (input === GHO || outputs[0] === GHO);
}

async function pollUniswapXIntentReservoir(): Promise<void> {
  if (intentInFlight || process.env.CRYPTOCRAWL_UNISWAPX_PUBLIC_DISCOVERY === 'false') {
    return intentInFlight || Promise.resolve();
  }

  const lane = UNISWAPX_PUBLIC_LANES[uniswapLaneCursor % UNISWAPX_PUBLIC_LANES.length];
  uniswapLaneCursor = (uniswapLaneCursor + 1) % UNISWAPX_PUBLIC_LANES.length;
  intentInFlight = (async () => {
    const url = `${UNISWAPX_ORDERS_URL}?orderStatus=open&chainId=${lane.chainId}&orderType=${lane.orderType}&limit=50`;
    const payload = await fetchJsonWithRetry<UniswapXOrdersResponse>(url, {
      maxRetries: 0,
      baseDelayMs: 100,
      maxDelayMs: 100,
      timeoutMs: 2_500,
    });
    if (!payload || !Array.isArray(payload.orders)) throw new Error('UniswapX public orders response is unavailable');

    const orders = payload.orders.filter(order => order?.orderStatus === undefined || order.orderStatus === 'open');
    const anchors = orders.filter(anchorCompatible);
    lastUniswapPollAt = Date.now();
    lastUniswapLane = `${lane.chain}:${lane.orderType}`;
    lastUniswapOpenOrders = orders.length;
    lastUniswapAnchorCompatibleOrders = anchors.length;
    lastUniswapError = null;

    logger.info('[BpsFrontierWave3] Permissionless UniswapX intent reservoir refreshed', {
      component: 'BpsFrontierWave3Wiring',
      lane: lastUniswapLane,
      openOrders: orders.length,
      anchorCompatibleOrders: anchors.length,
      standingTargetMarginBps: standingTargetMarginBps(),
      standingQuotePolicy: 'measured_execution_cost_plus_positive_target_margin',
      pollRatePolicy: 'one_lane_per_tick_below_public_4_rps_limit',
      apiKeyRequired: false,
      canonicalCandidateRowsCreated: 0,
      candidatePromotionPolicy: 'only_after_exact_current_order_resolution_plus_callback_execution_proof_plus_strict_positive_all_in_net',
      callbackExecutionModel: 'uniswapx_executeWithCallback_zero_prefund_capable_when_executor_proven',
      syntheticProfitAllowed: false,
      independentExecutionAuthority: false,
    });
  })().catch(error => {
    lastUniswapPollAt = Date.now();
    lastUniswapLane = `${lane.chain}:${lane.orderType}`;
    lastUniswapOpenOrders = 0;
    lastUniswapAnchorCompatibleOrders = 0;
    lastUniswapError = error instanceof Error ? error.message : String(error);
    logger.debug('[BpsFrontierWave3] UniswapX public intent lane unavailable; unrelated discovery continues', {
      component: 'BpsFrontierWave3Wiring',
      lane: lastUniswapLane,
      error: lastUniswapError,
      existingDiscoveryBlocked: false,
      executionAuthority: false,
    });
  }).finally(() => {
    intentInFlight = null;
  });

  return intentInFlight;
}

async function pollLighterFundingBenchmark(): Promise<void> {
  if (lighterInFlight || process.env.CRYPTOCRAWL_LIGHTER_PUBLIC_DISCOVERY === 'false') {
    return lighterInFlight || Promise.resolve();
  }

  lighterInFlight = (async () => {
    const universe = getLastOrderedMarketUniverseSymbols();
    const requested = new Set([...(universe.length ? universe : LIGHTER_DEFAULT_SYMBOLS), ...LIGHTER_DEFAULT_SYMBOLS]
      .map(value => value.trim().toUpperCase()).filter(Boolean));
    const payload = await fetchJsonWithRetry<LighterFundingResponse>(LIGHTER_FUNDING_URL, {
      maxRetries: 1,
      baseDelayMs: 200,
      maxDelayMs: 800,
      timeoutMs: 3_000,
    });

    if (!payload || (payload.code !== undefined && payload.code !== 200) || !Array.isArray(payload.funding_rates)) {
      throw new Error(`Lighter public funding response unavailable${payload?.message ? `: ${payload.message}` : ''}`);
    }

    const now = Date.now();
    const rows = payload.funding_rates.filter(row => String(row.exchange || '').trim().toLowerCase() === 'lighter');
    const matchedSymbols = new Set<string>();
    let recorded = 0;

    for (const row of rows) {
      const symbol = canonicalLighterSymbol(row.symbol, requested);
      const rate = finite(row.rate);
      if (!symbol || rate === null) continue;
      const marketId = Number.isFinite(Number(row.market_id)) ? Number(row.market_id) : -1;
      matchedSymbols.add(symbol);

      // Lighter's public funding endpoint is external search/BPS intelligence,
      // not an executable funding strategy in the present integration. Do not
      // register it as a canonical candidate carrying impossible authenticated
      // account/depth/settlement "missing information". That polluted the
      // funding backlog with 60 permanently incomplete candidates every poll.
      // The measured public row remains represented by this benchmark snapshot
      // and can become a candidate only after a real Lighter execution adapter
      // supplies authenticated account, fees, depth, margin and settlement.
      void marketId;
      void rate;
      recorded++;
    }

    lastLighterPollAt = now;
    lastLighterObservations = recorded;
    lastLighterSymbols = [...matchedSymbols].sort();
    lastLighterError = null;
    logger.info('[BpsFrontierWave3] Keyless Lighter public funding frontier refreshed', {
      component: 'BpsFrontierWave3Wiring',
      endpoint: LIGHTER_FUNDING_URL,
      responseCode: payload.code ?? null,
      sourceRows: rows.length,
      matchedObservations: recorded,
      matchedSymbols: lastLighterSymbols.slice(0, 24),
      apiKeyRequired: false,
      canonicalCandidateRowsCreated: 0,
      benchmarkClassification: 'external_advisory_only_until_authenticated_execution_adapter_exists',
      executionAuthority: false,
      accountTierFeeAssumed: false,
      hiddenLatencyBpsAssumed: false,
      fundingRateTreatedAsStandaloneProfit: false,
      userCollateralAllowed: false,
    });
  })().catch(error => {
    lastLighterPollAt = Date.now();
    lastLighterObservations = 0;
    lastLighterSymbols = [];
    lastLighterError = error instanceof Error ? error.message : String(error);
    logger.debug('[BpsFrontierWave3] Lighter public benchmark unavailable; existing discovery continues', {
      component: 'BpsFrontierWave3Wiring',
      error: lastLighterError,
      existingDiscoveryBlocked: false,
      executionAuthority: false,
    });
  }).finally(() => {
    lighterInFlight = null;
  });

  return lighterInFlight;
}

export function getBpsFrontierWave3Snapshot(): BpsFrontierWave3Snapshot {
  return {
    observedAt: Date.now(),
    groups: latestGroups.map(group => ({
      ...group,
      winner: { ...group.winner, venues: [...group.winner.venues], chains: [...group.winner.chains] },
      runnerUp: group.runnerUp
        ? { ...group.runnerUp, venues: [...group.runnerUp.venues], chains: [...group.runnerUp.chains] }
        : null,
    })),
    lighter: {
      lastPollAt: lastLighterPollAt,
      observations: lastLighterObservations,
      matchedSymbols: [...lastLighterSymbols],
      lastError: lastLighterError,
      executionAuthority: false,
    },
    uniswapX: {
      lastPollAt: lastUniswapPollAt,
      lane: lastUniswapLane,
      openOrders: lastUniswapOpenOrders,
      anchorCompatibleOrders: lastUniswapAnchorCompatibleOrders,
      standingTargetMarginBps: standingTargetMarginBps(),
      lastError: lastUniswapError,
      apiKeyRequired: false,
      candidateRowsCreated: 0,
      executionAuthority: false,
    },
    authority: 'measured_total_cost_frontier_and_external_discovery_only',
    executionAuthority: false,
    syntheticSavingsAllowed: false,
  };
}

export function ensureBpsFrontierWave3Wiring(): void {
  if (installed || process.env.CRYPTOCRAWL_BPS_FRONTIER_WAVE3_ENABLED === 'false') return;
  installed = true;
  recomputeMeasuredFrontier();
  unsubscribe = measuredCandidateRegistry.onUpdate(() => scheduleFrontierRefresh());
  void pollLighterFundingBenchmark();
  void pollUniswapXIntentReservoir();

  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void pollLighterFundingBenchmark(), pollIntervalMs());
    timer.unref?.();
    intentTimer = setInterval(() => void pollUniswapXIntentReservoir(), intentPollIntervalMs());
    intentTimer.unref?.();
  }

  logger.info('[BpsFrontierWave3] Measured total-cost frontier installed', {
    component: 'BpsFrontierWave3Wiring',
    smartOrderRoutingUpgrade: 'compare_only_like_notional_contemporaneous_fresh_canonical_net_outcomes_then_explicit_costs',
    routeComparisonMaxSkewMs: comparisonSkewMs(),
    quoteEmbeddedCostPolicy: 'canonical_net_outcome_wins_before_explicit_cost_field_tiebreak_so_embedded_fees_are_not_ignored_or_double_subtracted',
    externalVenueBenchmark: 'lighter_public_funding_keyless_discovery_only_no_candidate_backlog',
    directVsAggregatorPolicy: 'only_measured_canonical_net_outcomes_and_costs_may_report_route_advantage',
    uniswapV4Policy: 'active_liquidity_and_custom_accounting_are_standing_quote_surfaces_but_require_exact_pool_quote_before_economic_credit',
    intentSolverPolicy: 'uniswapx_permissionless_order_reservoir_continuous_plus_cow_erc7683_expansion; exact_executable_quote_and_zero_personal_resource_proof_before_admission',
    standingPositiveMarginPolicy: 'continuously_offer_or_search_for_measured_execution_cost_plus_positive_target_margin_without_fabricating_realized_profit',
    standingTargetMarginBps: standingTargetMarginBps(),
    uniswapXPublicOrderPolling: true,
    uniswapXPollingApiKeyRequired: false,
    uniswapXCallbackModel: 'input_tokens_arrive_before_callback_route_output_payment',
    realizedProfitStillRequiresCounterpartyFill: true,
    mevPolicy: 'private_builder_or_refund_value_requires_terminal_realized_evidence_before_bps_credit',
    syntheticSavingsAllowed: false,
    independentExecutionAuthority: false,
    personalCapitalAllowed: false,
    personalCollateralAllowed: false,
  });
}

export function stopBpsFrontierWave3WiringForTests(): void {
  if (timer) clearInterval(timer);
  if (frontierTimer) clearTimeout(frontierTimer);
  if (intentTimer) clearInterval(intentTimer);
  timer = null;
  frontierTimer = null;
  intentTimer = null;
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
}
