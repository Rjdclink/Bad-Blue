import logger from '../../../logger.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

const LIGHTER_FUNDING_URL = 'https://mainnet.zklighter.elliot.ai/api/v1/funding-rates';
const LIGHTER_DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];

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
  authority: 'measured_total_cost_frontier_and_external_discovery_only';
  executionAuthority: false;
  syntheticSavingsAllowed: false;
}

let installed = false;
let timer: NodeJS.Timeout | null = null;
let frontierTimer: NodeJS.Timeout | null = null;
let lighterInFlight: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
let latestGroups: MeasuredBpsFrontierGroup[] = [];
let lastLighterPollAt: number | null = null;
let lastLighterObservations = 0;
let lastLighterSymbols: string[] = [];
let lastLighterError: string | null = null;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pollIntervalMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_FRONTIER_POLL_MS || 30_000);
  return Number.isFinite(parsed) ? Math.max(10_000, Math.min(120_000, Math.trunc(parsed))) : 30_000;
}

function candidateTtlMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_LIGHTER_BENCHMARK_TTL_MS || 45_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(120_000, Math.trunc(parsed))) : 45_000;
}

function comparisonSkewMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_BPS_ROUTE_COMPARISON_MAX_SKEW_MS || 2_000);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(10_000, Math.trunc(parsed))) : 2_000;
}

function referenceNotionalUsd(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_FUNDING_REFERENCE_NOTIONAL_USD || 250);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 250;
}

function splitCanonicalSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
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

    // The official Lighter SDK documents code=200 for this successful response.
    if (!payload || (payload.code !== undefined && payload.code !== 200) || !Array.isArray(payload.funding_rates)) {
      throw new Error(`Lighter public funding response unavailable${payload?.message ? `: ${payload.message}` : ''}`);
    }

    const now = Date.now();
    const ttlMs = candidateTtlMs();
    const notionalUsd = referenceNotionalUsd();
    const rows = payload.funding_rates.filter(row => String(row.exchange || '').trim().toLowerCase() === 'lighter');
    const matchedSymbols = new Set<string>();
    let recorded = 0;

    for (const row of rows) {
      const symbol = canonicalLighterSymbol(row.symbol, requested);
      const rate = finite(row.rate);
      if (!symbol || rate === null) continue;
      const split = splitCanonicalSymbol(symbol);
      if (!split) continue;
      const marketId = Number.isFinite(Number(row.market_id)) ? Number(row.market_id) : -1;
      matchedSymbols.add(symbol);

      measuredCandidateRegistry.record({
        opportunityId: `funding:lighter_public:${marketId}:${symbol}`,
        topology: 'FUNDING_ARBITRAGE',
        observedAt: now,
        expiresAt: now + ttlMs,
        status: 'enriched',
        assets: [split.base, split.quote],
        venues: ['lighter'],
        chains: ['lighter_zk_rollup'],
        rawQuotes: [{
          source: 'lighter:public_funding_rates',
          venue: 'lighter',
          symbol,
          observedAt: now,
          price: null,
          executable: false,
          provenance: [
            'lighter_official_public_rest:/api/v1/funding-rates',
            'lighter_official_rate_normalization:8h_equivalent',
            `lighter_market_id:${marketId}`,
            `lighter_funding_rate:${rate}`,
            'public_no_auth',
          ],
        }],
        depth: {
          status: 'unavailable',
          detail: 'Lighter public funding is a keyless frontier input only; executable entry/exit depth, account tier, latency and margin capacity are not inferred',
        },
        economics: {
          // A single venue funding rate is not itself arbitrage profit. The
          // counter-leg, basis, fees, depth, latency and settlement must be
          // measured before canonical gross/net economics exist.
          grossProfitUsd: null,
          deterministicNetProfitUsd: null,
          feeUsd: null,
          gasUsd: null,
          bridgeUsd: null,
          expectedSlippageBps: null,
          expectedPriceImpactBps: null,
          notionalUsd,
          netProfitBps: null,
        },
        quoteAgeMs: 0,
        executableCapability: false,
        executionCapabilityReason: 'Lighter public data is admitted only as a BPS/funding benchmark. Execution requires authenticated signing, exact account-tier fees, measured counter-leg/depth/latency and provenance-backed system-owned margin/collateral; no user-funded collateral path is admitted.',
        missingInformation: [
          'lighter_authenticated_execution_account',
          'lighter_exact_account_tier_fee_evidence',
          'lighter_measured_counter_leg',
          'lighter_measured_entry_exit_depth',
          'lighter_measured_execution_latency_cost',
          'lighter_system_owned_margin_collateral_provenance',
          'lighter_terminal_settlement_adapter',
        ],
        provenance: [
          'bps_frontier_wave3:external_zero_fee_low_fee_venue_benchmark',
          'lighter_public_funding_discovery:keyless',
          'execution_promotion:false',
          'personal_capital_allowed:false',
          'personal_collateral_allowed:false',
          'single_funding_rate_is_not_profit',
          'unknown_cost_is_not_zero',
          'synthetic_bps_savings:false',
        ],
      });
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

  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void pollLighterFundingBenchmark(), pollIntervalMs());
    timer.unref?.();
  }

  logger.info('[BpsFrontierWave3] Measured total-cost frontier installed', {
    component: 'BpsFrontierWave3Wiring',
    smartOrderRoutingUpgrade: 'compare_only_like_notional_contemporaneous_fresh_canonical_net_outcomes_then_explicit_costs',
    routeComparisonMaxSkewMs: comparisonSkewMs(),
    quoteEmbeddedCostPolicy: 'canonical_net_outcome_wins_before_explicit_cost_field_tiebreak_so_embedded_fees_are_not_ignored_or_double_subtracted',
    externalVenueBenchmark: 'lighter_public_funding_keyless_discovery_only',
    directVsAggregatorPolicy: 'only_measured_canonical_net_outcomes_and_costs_may_report_route_advantage',
    uniswapV4Policy: 'dynamic_fee_hook_flash_accounting_surface_requires_exact_pool_quote_before_economic_credit',
    intentSolverPolicy: 'cow_uniswapx_style_solver_surfaces_require_exact_executable_quote_and_zero_personal_resource_proof_before_admission',
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
  timer = null;
  frontierTimer = null;
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
}
