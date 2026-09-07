import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { ComputeLayer, TaskIntensity, TaskPriority, TaskType, type Task } from '../../computationalBeam/types.js';
import type { CryptaraKalshiPredictionSnapshot } from './cryptara-kalshi-prediction-wiring.js';

export interface KalshiQuantiContext {
  opportunityId: string;
  observedAt: number;
  completedAt: number;
  signalCount: number;
  freshnessFraction: number;
  rulesCompletenessFraction: number;
  liquidityCoverageFraction: number;
  liquidityConcentration: number | null;
  meanBinaryEntropy: number | null;
  probabilityDispersion: number | null;
  nearestOccurrenceMs: number | null;
  medianSpreadBps: number | null;
  sourceQualityScore: number;
  directionalForecastProduced: false;
  economicAuthority: false;
  monteCarloAuthority: false;
  writeAuthority: false;
  executionAuthority: false;
  computeAuthority: 'quanticomp_beam';
  source: 'cached_kalshi_prediction_intelligence';
}

type Pending = { opportunityId: string; observedAt: number };
const contexts = new Map<string, KalshiQuantiContext>();
const pending = new Map<string, Pending>();
const inFlight = new Set<string>();
const MAX_CONTEXTS = Math.max(100, Math.min(10_000, Number(process.env.KALSHI_QUANTI_MAX_CONTEXTS || 2_000)));
let listenersInstalled = false;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function key(opportunityId: string, observedAt: number): string {
  return `${opportunityId}:${observedAt}`;
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function standardDeviation(values: number[]): number | null {
  const avg = mean(values);
  if (avg === null || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function binaryEntropy(probability: number): number {
  const p = Math.max(1e-12, Math.min(1 - 1e-12, probability));
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function analyze(snapshot: CryptaraKalshiPredictionSnapshot): KalshiQuantiContext {
  const probabilities = snapshot.signals
    .map(signal => signal.impliedProbability)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0 && value <= 1);
  const liquidities = snapshot.signals.map(signal => Math.max(0, signal.liquidityUsd ?? 0));
  const totalLiquidity = liquidities.reduce((sum, value) => sum + value, 0);
  const liquidityConcentration = totalLiquidity > 0
    ? liquidities.reduce((sum, value) => sum + (value / totalLiquidity) ** 2, 0)
    : null;
  const occurrenceHorizons = snapshot.signals
    .map(signal => signal.occurrenceAt === null ? null : Math.max(0, signal.occurrenceAt - snapshot.evaluatedAt))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const count = Math.max(1, snapshot.signalCount);
  return {
    opportunityId: snapshot.opportunityId,
    observedAt: snapshot.evaluatedAt,
    completedAt: Date.now(),
    signalCount: snapshot.signalCount,
    freshnessFraction: snapshot.signalCount ? clamp01(snapshot.freshSignalCount / count) : 0,
    rulesCompletenessFraction: snapshot.signalCount ? clamp01(snapshot.rulesCompleteCount / count) : 0,
    liquidityCoverageFraction: snapshot.signalCount ? clamp01(snapshot.liquidSignalCount / count) : 0,
    liquidityConcentration: liquidityConcentration === null ? null : Number(liquidityConcentration.toFixed(8)),
    meanBinaryEntropy: probabilities.length ? Number((mean(probabilities.map(binaryEntropy)) ?? 0).toFixed(8)) : null,
    probabilityDispersion: probabilities.length > 1 ? Number((standardDeviation(probabilities) ?? 0).toFixed(8)) : null,
    nearestOccurrenceMs: occurrenceHorizons.length ? Math.min(...occurrenceHorizons) : null,
    medianSpreadBps: snapshot.medianSpreadBps,
    sourceQualityScore: snapshot.qualityScore,
    directionalForecastProduced: false,
    economicAuthority: false,
    monteCarloAuthority: false,
    writeAuthority: false,
    executionAuthority: false,
    computeAuthority: 'quanticomp_beam',
    source: 'cached_kalshi_prediction_intelligence',
  };
}

function store(context: KalshiQuantiContext): void {
  contexts.delete(key(context.opportunityId, context.observedAt));
  contexts.set(key(context.opportunityId, context.observedAt), context);
  while (contexts.size > MAX_CONTEXTS) {
    const oldest = contexts.keys().next().value as string | undefined;
    if (!oldest) break;
    contexts.delete(oldest);
  }
}

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  workloadRouter.on('task-completed', (event: { taskId: string; result?: unknown }) => {
    const identity = pending.get(event.taskId);
    if (!identity) return;
    pending.delete(event.taskId);
    inFlight.delete(key(identity.opportunityId, identity.observedAt));
    const stored = workloadRouter.consumeTaskOutcome(event.taskId);
    const result = event.result ?? stored?.result;
    if (!result || typeof result !== 'object') return;
    const context = result as KalshiQuantiContext;
    if (context.opportunityId !== identity.opportunityId || context.observedAt !== identity.observedAt) return;
    store(context);
  });
  workloadRouter.on('task-failed', (event: { taskId: string }) => {
    const identity = pending.get(event.taskId);
    if (!identity) return;
    pending.delete(event.taskId);
    inFlight.delete(key(identity.opportunityId, identity.observedAt));
    workloadRouter.consumeTaskOutcome(event.taskId);
  });
}

/**
 * Routes a frozen, already-acquired Kalshi snapshot through the canonical Beam
 * compute layer. This performs structural feature extraction only; it produces no
 * directional forecast and cannot alter economics, Monte Carlo, governance or
 * execution admission.
 */
export function prewarmKalshiQuantiContext(snapshot: CryptaraKalshiPredictionSnapshot): void {
  if (snapshot.signalCount <= 0) return;
  const identity = key(snapshot.opportunityId, snapshot.evaluatedAt);
  if (contexts.has(identity) || inFlight.has(identity)) return;
  ensureListeners();
  inFlight.add(identity);
  const frozen = structuredClone(snapshot);
  const task = workloadRouter.createTask(TaskType.ML_PREDICTION, {
    helper: 'kalshi_market_structure_quanti_context',
    opportunityId: frozen.opportunityId,
    sourceObservedAt: frozen.evaluatedAt,
    sourceSignals: frozen.signalCount,
    cachedInputOnly: true,
    economicAuthority: false,
    executionAuthority: false,
  }, {
    intensity: TaskIntensity.HEAVY,
    priority: TaskPriority.LOW,
    requiredLayer: ComputeLayer.BEAM,
  });
  task.metadata.maxRetries = 0;
  task.workload = {
    id: `kalshi-quanti:${task.id}`,
    type: 'kalshi_market_structure_quanti_context',
    input: frozen,
    timeoutMs: Math.max(25, Math.min(500, Number(process.env.KALSHI_QUANTI_TIMEOUT_MS || 150))),
    execute: immutable => analyze(immutable as CryptaraKalshiPredictionSnapshot),
    validate: result => Boolean(result && typeof result === 'object'),
  };
  pending.set(task.id, { opportunityId: frozen.opportunityId, observedAt: frozen.evaluatedAt });
  void workloadRouter.routeTask(task).catch(() => {
    pending.delete(task.id);
    inFlight.delete(identity);
    workloadRouter.consumeTaskOutcome(task.id);
  });
}

export function getKalshiQuantiContext(opportunityId: string, observedAt?: number): KalshiQuantiContext | null {
  if (observedAt !== undefined) {
    const exact = contexts.get(key(opportunityId, observedAt));
    return exact ? structuredClone(exact) : null;
  }
  const latest = [...contexts.values()]
    .filter(context => context.opportunityId === opportunityId)
    .sort((left, right) => right.observedAt - left.observedAt)[0];
  return latest ? structuredClone(latest) : null;
}

export function getKalshiQuantiStatus() {
  return {
    cachedContexts: contexts.size,
    inFlight: inFlight.size,
    pendingTasks: pending.size,
    computeAuthority: 'quanticomp_beam' as const,
    directionalForecastProduced: false as const,
    economicAuthority: false as const,
    executionAuthority: false as const,
  };
}
