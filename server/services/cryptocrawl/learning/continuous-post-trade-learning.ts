import { createHash } from 'node:crypto';
import { isDatabaseConfigured, pool } from '../../../db.js';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { canonicalOpportunityState, type CanonicalOpportunitySnapshot } from '../intelligence/canonical-opportunity-state.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { endToEndLatencyHarness } from '../runtime/end-to-end-latency-harness.js';

export interface LearnedRanking {
  kind: 'strategy' | 'provider' | 'pair' | 'chain';
  subjectKey: string;
  score: number;
  evidenceCount: number;
  uncertainty: number;
  decayWeight: number;
  expiresAt: number;
  topology?: string;
  regime?: string;
  provenance: string[];
}

export interface ContinuousLearningHealth {
  running: boolean;
  preTradeObservations: number;
  terminalLabels: number;
  rankingCount: number;
  lastSweepAt: number | null;
  lastError: string | null;
  terminalLabelsOnly: true;
  preTradeLabelsAllowed: false;
  liveRlAuthority: false;
  executionAuthority: false;
}

type Aggregate = {
  kind: LearnedRanking['kind'];
  subjectKey: string;
  topology: string;
  regime: string;
  samples: number;
  weightedProfitUsd: number;
  weightedSuccess: number;
  weight: number;
  latestAt: number;
  sourceEventIds: string[];
};

const CHAINS: SupportedChain[] = ['ethereum','polygon','arbitrum','optimism','base','avalanche','bsc'];
const WINDOW_MS = Math.max(60_000, Math.min(90 * 24 * 60 * 60_000, Number(process.env.CRYPTO_LEARNING_WINDOW_MS || 14 * 24 * 60 * 60_000)));
const HALF_LIFE_MS = Math.max(60_000, Math.min(WINDOW_MS, Number(process.env.CRYPTO_LEARNING_DECAY_HALF_LIFE_MS || 3 * 24 * 60 * 60_000)));
const SWEEP_MS = Math.max(5_000, Number(process.env.CRYPTO_CONTINUOUS_LEARNING_SWEEP_MS || 60_000));
const processedPreTrade = new Set<string>();
const processedTerminal = new Set<string>();
const latestRankings = new Map<string, LearnedRanking>();
let timer: NodeJS.Timeout | null = null;
let sweepInFlight = false;
let lastSweepAt: number | null = null;
let lastError: string | null = null;

function modelVersion(): string {
  return process.env.CRYPTARA_MODEL_VERSION?.trim() || 'continuous-terminal-learning-v1';
}
function configVersion(): string {
  return process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim()
    || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
    || process.env.GIT_COMMIT?.trim()
    || 'runtime-config-v1';
}
function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40)}`;
}
function terminalIdentity(snapshot: CanonicalOpportunitySnapshot): string {
  const settlement = snapshot.settlement;
  return stableId('terminal-learning', {
    opportunityId: snapshot.opportunityId,
    status: settlement?.status || snapshot.status,
    submittedAt: settlement?.submittedAt || null,
    settledAt: settlement?.settledAt || snapshot.updatedAt,
    realizedProfitUsd: snapshot.realized.realizedProfitUsd,
    settlementConfirmed: snapshot.realized.settlementConfirmed,
  });
}
function topology(snapshot: CanonicalOpportunitySnapshot): string {
  if (snapshot.plan?.bridge) return 'CROSS_CHAIN';
  if (snapshot.chain.toLowerCase() === 'cex' || (snapshot.plan && ['coinbase','kraken','okx'].includes(snapshot.plan.buyVenue))) return 'CEX_CEX';
  return snapshot.chain || 'UNKNOWN';
}
function regime(snapshot: CanonicalOpportunitySnapshot): string {
  return snapshot.assessment?.monteCarlo?.marketRegime || snapshot.assessment?.riskLevel || 'unknown';
}
function strategy(snapshot: CanonicalOpportunitySnapshot): string {
  if (snapshot.plan?.bridge) return 'cross_chain_arbitrage';
  if (snapshot.chain.toLowerCase() === 'cex') return 'verified_cex_arbitrage';
  return `canonical_${snapshot.chain || 'unknown'}_opportunity`;
}
function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function decayWeight(observedAt: number, now: number): number {
  return Math.pow(0.5, Math.max(0, now - observedAt) / HALF_LIFE_MS);
}
function boundedSet(set: Set<string>, id: string, max = 4096): void {
  set.add(id);
  while (set.size > max) set.delete(set.values().next().value as string);
}
function rankingKey(kind: LearnedRanking['kind'], subjectKey: string, topologyName: string, regimeName: string): string {
  return `${kind}|${subjectKey}|${topologyName}|${regimeName}`;
}

async function persistPreTrade(snapshot: CanonicalOpportunitySnapshot): Promise<void> {
  if (!isDatabaseConfigured || processedPreTrade.has(snapshot.opportunityId)) return;
  const eventId = stableId('pre-trade', { opportunityId: snapshot.opportunityId, observedAt: snapshot.observedAt });
  await pool.query(
    `insert into private.cryptara_decision_events (
       event_id, opportunity_id, observed_at, decision_kind, decision,
       model_version, config_version, provenance, source_event_ids, payload
     ) values ($1,$2,to_timestamp($3/1000.0),'pre_trade_feature_observation','unlabeled',$4,$5,$6,$7,$8::jsonb)
     on conflict (event_id) do nothing`,
    [
      eventId,
      snapshot.opportunityId,
      snapshot.observedAt,
      modelVersion(),
      configVersion(),
      [...new Set([...snapshot.provenance, 'pre_trade_unlabeled', 'not_success_label'])],
      [snapshot.opportunityId],
      JSON.stringify({
        topology: topology(snapshot),
        regime: regime(snapshot),
        symbol: snapshot.symbol,
        chain: snapshot.chain,
        statusAtObservation: snapshot.status,
        plan: snapshot.plan ? {
          buyVenue: snapshot.plan.buyVenue,
          sellVenue: snapshot.plan.sellVenue,
          notionalUsd: snapshot.plan.notionalUsd,
          executableNotionalUsd: snapshot.plan.executableNotionalUsd,
          grossProfitUsd: snapshot.plan.grossProfitUsd,
          netProfitUsd: snapshot.plan.netProfitUsd,
          quoteAgeMs: snapshot.plan.quoteAgeMs,
          expectedSlippageBps: snapshot.plan.expectedSlippageBps ?? null,
          expectedPriceImpactBps: snapshot.plan.expectedPriceImpactBps ?? null,
          costs: snapshot.plan.costs,
        } : null,
        assessment: snapshot.assessment ? {
          recommendation: snapshot.assessment.recommendation,
          rankScore: snapshot.assessment.rankScore,
          executionConfidence: snapshot.assessment.executionConfidence,
          probabilityOfProfitableExecution: snapshot.assessment.probabilityOfProfitableExecution,
          riskLevel: snapshot.assessment.riskLevel,
          marketRegime: snapshot.assessment.monteCarlo?.marketRegime ?? null,
        } : null,
        terminalLabel: null,
        authoritativeSuccessLabel: false,
      }),
    ],
  );
  boundedSet(processedPreTrade, snapshot.opportunityId);
}

async function persistMetric(input: {
  eventId: string;
  observedAt: number;
  metricName: string;
  metricValue: number;
  provider?: string | null;
  strategy?: string | null;
  pair?: string | null;
  chain?: string | null;
  timingBucket?: string | null;
  costBucket?: string | null;
  competitionBucket?: string | null;
  provenance: string[];
  sourceEventIds: string[];
  payload?: unknown;
}): Promise<void> {
  if (!isDatabaseConfigured || !Number.isFinite(input.metricValue)) return;
  await pool.query(
    `insert into private.cryptara_metric_samples (
       event_id, observed_at, metric_name, metric_value, provider, strategy, pair, chain,
       timing_bucket, cost_bucket, competition_bucket, model_version, config_version,
       provenance, source_event_ids, payload
     ) values ($1,to_timestamp($2/1000.0),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     on conflict (event_id) do nothing`,
    [input.eventId,input.observedAt,input.metricName,input.metricValue,input.provider || null,input.strategy || null,input.pair || null,input.chain || null,input.timingBucket || null,input.costBucket || null,input.competitionBucket || null,modelVersion(),configVersion(),input.provenance,input.sourceEventIds,JSON.stringify(input.payload || {})],
  );
}

async function persistTerminal(snapshot: CanonicalOpportunitySnapshot): Promise<string | null> {
  if (!snapshot.settlement || snapshot.settlement.terminal !== true) return null;
  const id = terminalIdentity(snapshot);
  if (processedTerminal.has(id)) return id;
  const observedAt = snapshot.settlement.settledAt || snapshot.updatedAt;
  const source = [id, snapshot.opportunityId];
  const prov = [...new Set([...snapshot.provenance, ...snapshot.settlement.provenance, 'normalized_terminal_settlement_label'])];
  const plan = snapshot.plan;
  const realizedNet = finite(snapshot.realized.realizedProfitUsd, 0);
  const success = snapshot.realized.success === true && realizedNet > 0 ? 1 : 0;
  const lifecycleMs = Math.max(0, observedAt - snapshot.observedAt);
  const fees = finite(snapshot.realized.feeUsd, 0);
  const slippageBps = finite(snapshot.realized.slippageBps, 0);
  const gross = plan ? finite(plan.grossProfitUsd, 0) : 0;
  const costPayload = plan ? {
    buyFeeUsd: finite(plan.costs.buyFeeUsd, 0),
    sellFeeUsd: finite(plan.costs.sellFeeUsd, 0),
    gasUsd: finite(plan.costs.gasUsd, 0),
    bridgeFeeUsd: finite(plan.costs.bridgeFeeUsd, 0),
    transferFeeUsd: finite(plan.costs.transferFeeUsd, 0),
    totalCostsUsd: finite(plan.costs.totalCostsUsd, 0),
    expectedSlippageBps: finite(plan.expectedSlippageBps, 0),
    expectedPriceImpactBps: finite(plan.expectedPriceImpactBps, 0),
  } : null;
  const dimensions = {
    provider: null,
    strategy: strategy(snapshot),
    pair: snapshot.symbol,
    chain: snapshot.chain,
    timingBucket: regime(snapshot),
    costBucket: topology(snapshot),
    competitionBucket: null,
  };
  const metrics: Array<[string, number, unknown]> = [
    ['terminal_success', success, { settlementStatus: snapshot.realized.settlementStatus }],
    ['realized_net_profit_usd', realizedNet, { grossProfitUsd: gross, costs: costPayload }],
    ['realized_fee_usd', fees, { costs: costPayload }],
    ['realized_slippage_bps', slippageBps, { expectedSlippageBps: plan?.expectedSlippageBps ?? null }],
    ['terminal_latency_ms', finite(snapshot.realized.latencyMs, lifecycleMs), { lifecycleMs }],
    ['observed_opportunity_lifetime_ms', lifecycleMs, { interpretation: 'observed lifecycle proxy for timing/half-life learning' }],
  ];
  for (const [metricName, metricValue, payload] of metrics) {
    await persistMetric({
      eventId: stableId(`terminal-metric:${metricName}`, { id, metricValue }),
      observedAt,
      metricName,
      metricValue,
      ...dimensions,
      provenance: prov,
      sourceEventIds: source,
      payload,
    });
  }
  boundedSet(processedTerminal, id);
  return id;
}

function addAggregate(map: Map<string, Aggregate>, input: {
  kind: LearnedRanking['kind'];
  subjectKey: string;
  snapshot: CanonicalOpportunitySnapshot;
  eventId: string;
  now: number;
}): void {
  const topologyName = topology(input.snapshot);
  const regimeName = regime(input.snapshot);
  const key = rankingKey(input.kind, input.subjectKey, topologyName, regimeName);
  const weight = decayWeight(input.snapshot.settlement?.settledAt || input.snapshot.updatedAt, input.now);
  const profit = finite(input.snapshot.realized.realizedProfitUsd, 0);
  const success = input.snapshot.realized.success === true && profit > 0 ? 1 : 0;
  const current = map.get(key) || {
    kind: input.kind,
    subjectKey: input.subjectKey,
    topology: topologyName,
    regime: regimeName,
    samples: 0,
    weightedProfitUsd: 0,
    weightedSuccess: 0,
    weight: 0,
    latestAt: 0,
    sourceEventIds: [],
  };
  current.samples += 1;
  current.weightedProfitUsd += profit * weight;
  current.weightedSuccess += success * weight;
  current.weight += weight;
  current.latestAt = Math.max(current.latestAt, input.snapshot.settlement?.settledAt || input.snapshot.updatedAt);
  if (current.sourceEventIds.length < 64) current.sourceEventIds.push(input.eventId);
  map.set(key, current);
}

async function persistRanking(aggregate: Aggregate, now: number): Promise<void> {
  const meanProfit = aggregate.weight > 0 ? aggregate.weightedProfitUsd / aggregate.weight : 0;
  const successRate = aggregate.weight > 0 ? aggregate.weightedSuccess / aggregate.weight : 0;
  const uncertainty = 1 / Math.sqrt(Math.max(1, aggregate.samples));
  const score = meanProfit * successRate * Math.max(0, 1 - uncertainty);
  const expiry = now + HALF_LIFE_MS;
  const key = rankingKey(aggregate.kind, aggregate.subjectKey, aggregate.topology, aggregate.regime);
  const ranking: LearnedRanking = {
    kind: aggregate.kind,
    subjectKey: aggregate.subjectKey,
    score,
    evidenceCount: aggregate.samples,
    uncertainty,
    decayWeight: aggregate.weight,
    expiresAt: expiry,
    topology: aggregate.topology,
    regime: aggregate.regime,
    provenance: ['terminal_settlement_only','decayed_segmented_ranking','advisory_only'],
  };
  latestRankings.set(key, ranking);
  if (!isDatabaseConfigured) return;
  const eventId = stableId('ranking', { key, bucket: Math.floor(now / SWEEP_MS) });
  await pool.query(
    `insert into private.cryptara_rankings (
       event_id, observed_at, ranking_kind, subject_key, rank_score,
       model_version, config_version, provenance, source_event_ids, payload
     ) values ($1,to_timestamp($2/1000.0),$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     on conflict (event_id) do update set rank_score=excluded.rank_score, provenance=excluded.provenance,
       source_event_ids=excluded.source_event_ids, payload=excluded.payload`,
    [eventId,now,aggregate.kind,aggregate.subjectKey,score,modelVersion(),configVersion(),ranking.provenance,aggregate.sourceEventIds,JSON.stringify({
      evidenceCount: aggregate.samples,
      uncertainty,
      decayWeight: aggregate.weight,
      expiresAt: expiry,
      topology: aggregate.topology,
      regime: aggregate.regime,
      meanRealizedNetProfitUsd: meanProfit,
      terminalSuccessRate: successRate,
      executionAuthority: false,
    })],
  );
}

async function persistLatencyMetrics(now: number): Promise<void> {
  const recent = endToEndLatencyHarness.getRecentSamples(512).filter(sample => sample.observedAt >= now - WINDOW_MS);
  for (const sample of recent.slice(-128)) {
    await persistMetric({
      eventId: stableId('latency-metric', sample),
      observedAt: sample.observedAt,
      metricName: `latency_${sample.kind}_${sample.stage}_ms`,
      metricValue: sample.durationMs,
      provider: sample.provider || null,
      strategy: sample.strategy || null,
      pair: sample.symbol || null,
      chain: sample.chain || null,
      timingBucket: sample.outcome,
      costBucket: null,
      competitionBucket: null,
      provenance: ['monotonic_runtime_latency','queue_compute_network_separated','advisory_learning_only'],
      sourceEventIds: sample.traceId ? [sample.traceId] : [],
      payload: { backend: sample.backend || null, venue: sample.venue || null, worker: sample.worker || null },
    });
  }
}

async function persistProviderMetrics(now: number): Promise<void> {
  for (const status of marketDataProviders.getProviderStatuses()) {
    if (status.observedAt === null) continue;
    await persistMetric({
      eventId: stableId('provider-state', { provider: status.provider, observedAt: status.observedAt, state: status.state }),
      observedAt: status.observedAt,
      metricName: 'provider_success_observation',
      metricValue: ['live','cached','stale'].includes(status.state) ? 1 : 0,
      provider: status.provider,
      provenance: ['measured_provider_state','head_lag_unknown_unless_observed','request_cost_unknown_unless_observed'],
      sourceEventIds: [],
      payload: { state: status.state, detail: status.detail || null, headLagBlocks: null, requestCostUsd: null },
    });
  }
  for (const chain of CHAINS) {
    for (const provider of multiProviderRpcManager.getHealth(chain)) {
      const observedAt = provider.http.observedAt || now;
      await persistMetric({
        eventId: stableId('rpc-provider-latency', { chain, provider: provider.provider, observedAt, latency: provider.http.latencyMs, success: provider.http.success }),
        observedAt,
        metricName: 'provider_rpc_latency_ms',
        metricValue: finite(provider.http.latencyMs, 0),
        provider: provider.provider,
        chain,
        provenance: ['measured_rpc_health','chain_identity_validated_provider','head_lag_unknown_unless_observed','request_cost_unknown_unless_observed'],
        sourceEventIds: [],
        payload: { success: provider.http.success, state: provider.http.state, lastError: provider.http.lastError || null, headLagBlocks: null, requestCostUsd: null },
      });
    }
  }
}

async function sweep(): Promise<void> {
  if (sweepInFlight) return;
  sweepInFlight = true;
  const now = Date.now();
  try {
    const snapshots = canonicalOpportunityState.getRecent(512).filter(snapshot => snapshot.updatedAt >= now - WINDOW_MS);
    for (const snapshot of snapshots) {
      if (!snapshot.settlement?.terminal) await persistPreTrade(snapshot);
    }

    const aggregates = new Map<string, Aggregate>();
    const terminalSnapshots = snapshots.filter(snapshot => snapshot.settlement?.terminal === true);
    for (const snapshot of terminalSnapshots) {
      const id = await persistTerminal(snapshot);
      if (!id) continue;
      addAggregate(aggregates, { kind: 'strategy', subjectKey: strategy(snapshot), snapshot, eventId: id, now });
      addAggregate(aggregates, { kind: 'pair', subjectKey: snapshot.symbol, snapshot, eventId: id, now });
      addAggregate(aggregates, { kind: 'chain', subjectKey: snapshot.chain, snapshot, eventId: id, now });
      if (snapshot.plan) {
        addAggregate(aggregates, { kind: 'provider', subjectKey: snapshot.plan.buyVenue, snapshot, eventId: id, now });
        addAggregate(aggregates, { kind: 'provider', subjectKey: snapshot.plan.sellVenue, snapshot, eventId: id, now });
      }
    }
    for (const aggregate of aggregates.values()) await persistRanking(aggregate, now);
    await persistLatencyMetrics(now);
    await persistProviderMetrics(now);
    lastSweepAt = now;
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    logger.warn('[ContinuousLearning] sweep degraded; execution remains independent', {
      component: 'ContinuousPostTradeLearning', error: lastError, executionBlocked: false,
    });
  } finally {
    sweepInFlight = false;
  }
}

export function ensureContinuousPostTradeLearning(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  void sweep();
  timer = setInterval(() => void sweep(), SWEEP_MS);
  timer.unref();
  logger.info('[ContinuousLearning] terminal post-trade learning installed', {
    component: 'ContinuousPostTradeLearning',
    sweepMs: SWEEP_MS,
    terminalLabelsOnly: true,
    preTradeLabelsAllowed: false,
    rankingDimensions: ['strategy','provider','pair','chain'],
    segmentation: ['topology','regime'],
    latencyDimensions: ['queue','compute','network'],
    optimizationTarget: 'expected_realized_net_profit_per_job',
    providerUnknownsFailUnknown: ['head_lag_blocks','request_cost_usd'],
    liveRlAuthority: false,
    causalExperiments: 'disabled_offline_or_shadow_only',
    executionAuthority: false,
  });
}

export function getContinuousPostTradeLearningHealth(): ContinuousLearningHealth {
  return {
    running: timer !== null,
    preTradeObservations: processedPreTrade.size,
    terminalLabels: processedTerminal.size,
    rankingCount: latestRankings.size,
    lastSweepAt,
    lastError,
    terminalLabelsOnly: true,
    preTradeLabelsAllowed: false,
    liveRlAuthority: false,
    executionAuthority: false,
  };
}

export function getContinuousLearnedRankings(): LearnedRanking[] {
  return [...latestRankings.values()].sort((a,b) => b.score - a.score).map(item => ({ ...item, provenance: [...item.provenance] }));
}

export function stopContinuousPostTradeLearning(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
