import type { CryptaraOpportunityContext } from '../../cryptara/index.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { ComputeLayer, TaskIntensity, TaskPriority, TaskType, type Task } from '../../computationalBeam/types.js';
import { getAdaptiveProfitOperatingEnvelope } from '../governance/adaptive-profit-operating-envelope.js';
import { getAntennaProviderQualitySummary } from '../intelligence/sovereign-antenna-quality.js';
import { getComputationalProfitAdvisory } from '../optimization/computational-profit-advisory-state.js';
import {
  ensureCryptaraAdaptiveStrategyHydrated,
  getCryptaraAdaptiveStrategySnapshot,
} from '../optimization/cryptara-adaptive-strategy-state.js';
import type { CryptaraPriorityDecisionVector } from '../optimization/cryptara-decision-priority.js';
import { getCryptaraProviderConsensusSnapshot } from './cryptara-provider-consensus-wiring.js';

export interface CryptaraParallelCognitionFrame {
  opportunityId: string;
  observedAt: number;
  completedAt: number;
  marketTruth: {
    ready: boolean;
    score: number;
    quoteFresh: boolean;
    measuredDepth: boolean;
    authenticatedFees: boolean;
    criticalMissingInformation: number;
    antennaQuality: number | null;
    providerConsensusQuality: number | null;
    providerConsensusState: string | null;
    reasons: string[];
  };
  optimization: {
    deterministicNetProfitUsd: number | null;
    netProfitBps: number | null;
    bpsToBreakEven: number | null;
    expectedSlippageBps: number | null;
    quoteAgeMs: number | null;
    requestedNotionalUsd: number | null;
    executableNotionalUsd: number | null;
    profitLadderMaxNotionalUsd: number;
    cryptaraBoundedTargetNotionalUsd: number;
    adaptiveNotionalBias: number;
    refinementDensity: number;
    prefetchAggression: number;
  };
  decisionVector: CryptaraPriorityDecisionVector;
  helpers: {
    marketTruth: 'cryptara_market_truth_helper';
    optimization: 'cryptara_profit_efficiency_helper';
    writeAuthority: false;
    executionAuthority: false;
  };
  authority: 'parallel_read_only_cognition';
  hotPathNetworkRequestsAdded: false;
}

type MarketTruthInput = {
  opportunityId: string;
  observedAt: number;
  quoteAgeMs: number | null;
  maxQuoteAgeMs: number;
  hasPlan: boolean;
  measuredDepth: boolean;
  authenticatedFees: boolean;
  executableNotionalUsd: number | null;
  criticalMissingInformation: string[];
  antennaQuality: Array<{ quality: number; samples: number }>;
  providerConsensusQuality: number | null;
  providerConsensusState: string | null;
};

type OptimizationInput = {
  deterministicNetProfitUsd: number | null;
  notionalUsd: number | null;
  requestedNotionalUsd: number | null;
  executableNotionalUsd: number | null;
  expectedSlippageBps: number | null;
  quoteAgeMs: number | null;
  profitLadderMaxNotionalUsd: number;
  notionalBias: number;
  refinementDensity: number;
  prefetchAggression: number;
};

const frames = new Map<string, CryptaraParallelCognitionFrame>();
const inFlight = new Map<string, Promise<void>>();
const MAX_FRAMES = Math.max(64, Math.min(4096, Number(process.env.CRYPTARA_PARALLEL_COGNITION_FRAMES || 512)));

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function keyOf(context: Pick<CryptaraOpportunityContext, 'opportunityId' | 'observedAt'>): string {
  return `${context.opportunityId}:${context.observedAt}`;
}

function helperDeadlineAt(context: CryptaraOpportunityContext): number {
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  return context.observedAt + maxQuoteAgeMs;
}

function marketTruthHelper(input: MarketTruthInput) {
  const quoteFresh = input.hasPlan && input.quoteAgeMs !== null && input.quoteAgeMs <= input.maxQuoteAgeMs;
  const antennaQuality = input.antennaQuality.length > 0
    ? input.antennaQuality.reduce((sum, item) => sum + item.quality, 0) / input.antennaQuality.length
    : null;
  const providerQuality = input.providerConsensusQuality;
  const coreEvidenceReady = input.hasPlan
    && quoteFresh
    && input.measuredDepth
    && input.authenticatedFees
    && input.criticalMissingInformation.length === 0
    && input.executableNotionalUsd !== null
    && input.executableNotionalUsd > 0;

  // Provider consensus/antenna quality strengthens confidence but cannot replace
  // direct executable books, authenticated fees or measured depth.
  const qualitySupport = antennaQuality === null && providerQuality === null
    ? 0.5
    : Math.max(0, Math.min(1, ((antennaQuality ?? 0.5) + (providerQuality ?? 0.5)) / 2));
  const score = clamp01(
    (quoteFresh ? 0.25 : 0)
    + (input.measuredDepth ? 0.25 : 0)
    + (input.authenticatedFees ? 0.20 : 0)
    + (input.criticalMissingInformation.length === 0 ? 0.15 : 0)
    + qualitySupport * 0.15,
  );
  const reasons: string[] = [];
  if (!input.hasPlan) reasons.push('verified_plan_missing');
  if (!quoteFresh) reasons.push('fresh_quote_missing');
  if (!input.measuredDepth) reasons.push('measured_depth_missing');
  if (!input.authenticatedFees) reasons.push('authenticated_fee_evidence_missing');
  if (input.criticalMissingInformation.length > 0) reasons.push(...input.criticalMissingInformation.map(item => `missing:${item}`));
  if (!(input.executableNotionalUsd !== null && input.executableNotionalUsd > 0)) reasons.push('executable_notional_missing');

  return {
    ready: coreEvidenceReady,
    score: Number(score.toFixed(6)),
    quoteFresh,
    measuredDepth: input.measuredDepth,
    authenticatedFees: input.authenticatedFees,
    criticalMissingInformation: input.criticalMissingInformation.length,
    antennaQuality: antennaQuality === null ? null : Number(antennaQuality.toFixed(6)),
    providerConsensusQuality: providerQuality,
    providerConsensusState: input.providerConsensusState,
    reasons,
  };
}

function optimizationHelper(input: OptimizationInput) {
  const notional = input.notionalUsd !== null && input.notionalUsd > 0 ? input.notionalUsd : null;
  const net = input.deterministicNetProfitUsd;
  const netProfitBps = notional !== null && net !== null && Number.isFinite(net)
    ? net / notional * 10_000
    : null;
  const bpsToBreakEven = netProfitBps === null ? null : Math.max(0, -netProfitBps);
  const ladderMax = Math.max(0, input.profitLadderMaxNotionalUsd);
  const executable = Math.max(0, input.executableNotionalUsd ?? input.requestedNotionalUsd ?? input.notionalUsd ?? 0);
  const target = ladderMax > 0
    ? Math.min(executable, ladderMax * Math.max(0.10, Math.min(1, input.notionalBias)))
    : 0;
  return {
    deterministicNetProfitUsd: net,
    netProfitBps: netProfitBps === null ? null : Number(netProfitBps.toFixed(8)),
    bpsToBreakEven: bpsToBreakEven === null ? null : Number(bpsToBreakEven.toFixed(8)),
    expectedSlippageBps: input.expectedSlippageBps,
    quoteAgeMs: input.quoteAgeMs,
    requestedNotionalUsd: input.requestedNotionalUsd,
    executableNotionalUsd: input.executableNotionalUsd,
    profitLadderMaxNotionalUsd: ladderMax,
    cryptaraBoundedTargetNotionalUsd: Math.max(0, target),
    adaptiveNotionalBias: input.notionalBias,
    refinementDensity: input.refinementDensity,
    prefetchAggression: input.prefetchAggression,
  };
}

async function runBeamHelper<Input, Output>(
  task: Task,
  input: Input,
  execute: (input: Input) => Output,
): Promise<Output> {
  return new Promise<Output>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      workloadRouter.off('task-completed', completed);
      workloadRouter.off('task-failed', failed);
    };
    const completed = (event: { taskId: string; result?: unknown }) => {
      if (settled || event.taskId !== task.id) return;
      settled = true;
      cleanup();
      const outcome = event.result ?? workloadRouter.consumeTaskOutcome(task.id)?.result;
      resolve(outcome as Output);
    };
    const failed = (event: { taskId: string; error?: string }) => {
      if (settled || event.taskId !== task.id) return;
      settled = true;
      cleanup();
      reject(new Error(event.error || `CRYPTARA_HELPER_FAILED:${task.id}`));
    };
    task.workload = {
      id: `cryptara-helper:${task.id}`,
      type: String(task.payload?.helper || 'cryptara_helper'),
      input,
      timeoutMs: Math.max(25, Math.min(500, Number(process.env.CRYPTARA_HELPER_TIMEOUT_MS || 150))),
      execute: immutableInput => execute(immutableInput as Input),
      validate: result => result !== null && result !== undefined,
    };
    workloadRouter.on('task-completed', completed);
    workloadRouter.on('task-failed', failed);
    void workloadRouter.routeTask(task).catch(error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function buildInputs(context: CryptaraOpportunityContext): { market: MarketTruthInput; optimization: OptimizationInput } {
  const plan = context.plan;
  const maxQuoteAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const antenna = getAntennaProviderQualitySummary();
  const consensus = getCryptaraProviderConsensusSnapshot(context.opportunityId);
  const envelope = getAdaptiveProfitOperatingEnvelope();
  const advisory = getComputationalProfitAdvisory();
  const adaptive = getCryptaraAdaptiveStrategySnapshot();
  const criticalMissing = context.missingInformation.filter(item => !item.startsWith('optional:'));
  return {
    market: {
      opportunityId: context.opportunityId,
      observedAt: context.observedAt,
      quoteAgeMs: plan && Number.isFinite(plan.quoteAgeMs) ? Math.max(0, plan.quoteAgeMs) : null,
      maxQuoteAgeMs,
      hasPlan: !!plan,
      measuredDepth: plan?.liquidity.status === 'measured',
      authenticatedFees: !!plan?.feeEvidence?.buy && !!plan?.feeEvidence?.sell,
      executableNotionalUsd: plan && Number.isFinite(plan.executableNotionalUsd) ? plan.executableNotionalUsd : null,
      criticalMissingInformation: [...criticalMissing],
      antennaQuality: antenna.map(item => ({
        quality: item.confidenceAdjustedQualityScore,
        samples: item.requests,
      })),
      providerConsensusQuality: consensus?.qualityScore ?? null,
      providerConsensusState: consensus?.state ?? null,
    },
    optimization: {
      deterministicNetProfitUsd: plan && Number.isFinite(plan.netProfitUsd) ? plan.netProfitUsd : null,
      notionalUsd: plan && Number.isFinite(plan.notionalUsd) ? plan.notionalUsd : null,
      requestedNotionalUsd: plan && Number.isFinite(plan.requestedNotionalUsd) ? plan.requestedNotionalUsd : null,
      executableNotionalUsd: plan && Number.isFinite(plan.executableNotionalUsd) ? plan.executableNotionalUsd : null,
      expectedSlippageBps: plan?.expectedSlippageBps !== null && Number.isFinite(plan?.expectedSlippageBps) ? plan!.expectedSlippageBps : null,
      quoteAgeMs: plan && Number.isFinite(plan.quoteAgeMs) ? Math.max(0, plan.quoteAgeMs) : null,
      profitLadderMaxNotionalUsd: Math.max(
        0,
        Number(envelope.recommendedMaxNotionalUsd) || 0,
        Number(advisory.profitLadderMaxNotionalUsd) || 0,
      ),
      notionalBias: adaptive.notionalBias,
      refinementDensity: adaptive.refinementDensity,
      prefetchAggression: adaptive.prefetchAggression,
    },
  };
}

async function calculateFrame(context: CryptaraOpportunityContext): Promise<void> {
  await ensureCryptaraAdaptiveStrategyHydrated().catch(() => undefined);
  const immutable = structuredClone(context);
  const deadlineAt = helperDeadlineAt(immutable);
  if (Date.now() >= deadlineAt) return;
  const inputs = buildInputs(immutable);

  const marketTask = workloadRouter.createTask(TaskType.ML_PREDICTION, {
    helper: 'cryptara_market_truth_helper',
    quantiDeadlineAt: deadlineAt,
    quantiParallelismHint: 1,
    quantiUsefulWorkUnits: 1,
  }, {
    intensity: TaskIntensity.HEAVY,
    priority: TaskPriority.CRITICAL,
    requiredLayer: ComputeLayer.BEAM,
  });
  const optimizationTask = workloadRouter.createTask(TaskType.ML_PREDICTION, {
    helper: 'cryptara_profit_efficiency_helper',
    quantiDeadlineAt: deadlineAt,
    quantiParallelismHint: 1,
    quantiUsefulWorkUnits: 1,
  }, {
    intensity: TaskIntensity.HEAVY,
    priority: TaskPriority.HIGH,
    requiredLayer: ComputeLayer.BEAM,
  });

  const [marketResult, optimizationResult] = await Promise.allSettled([
    runBeamHelper(marketTask, inputs.market, marketTruthHelper),
    runBeamHelper(optimizationTask, inputs.optimization, optimizationHelper),
  ]);
  if (marketResult.status !== 'fulfilled' || optimizationResult.status !== 'fulfilled') return;
  const marketTruth = marketResult.value;
  const optimization = optimizationResult.value;
  const frame: CryptaraParallelCognitionFrame = {
    opportunityId: immutable.opportunityId,
    observedAt: immutable.observedAt,
    completedAt: Date.now(),
    marketTruth,
    optimization,
    decisionVector: {
      marketTruthReady: marketTruth.ready,
      marketTruthScore: marketTruth.score,
      deterministicNetProfitUsd: optimization.deterministicNetProfitUsd,
      netProfitBps: optimization.netProfitBps,
      bpsToBreakEven: optimization.bpsToBreakEven,
      latencyMs: optimization.quoteAgeMs,
      slippageBps: optimization.expectedSlippageBps,
      executableNotionalUsd: optimization.cryptaraBoundedTargetNotionalUsd,
      profitLadderMaxNotionalUsd: optimization.profitLadderMaxNotionalUsd,
    },
    helpers: {
      marketTruth: 'cryptara_market_truth_helper',
      optimization: 'cryptara_profit_efficiency_helper',
      writeAuthority: false,
      executionAuthority: false,
    },
    authority: 'parallel_read_only_cognition',
    hotPathNetworkRequestsAdded: false,
  };
  frames.set(keyOf(immutable), frame);
  while (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value as string);
}

/**
 * Starts the two Cryptara helper lanes without awaiting them. They execute in
 * parallel with Monte Carlo/assessment work and are deadline-bound to the same
 * quote lifetime. This function adds no market/network requests.
 */
export function prewarmCryptaraParallelCognition(context: CryptaraOpportunityContext): void {
  const key = keyOf(context);
  if (frames.has(key) || inFlight.has(key)) return;
  const work = calculateFrame(context).finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  void work;
}

export function getCryptaraParallelCognitionFrame(
  opportunityId: string,
  observedAt?: number,
): CryptaraParallelCognitionFrame | null {
  if (observedAt !== undefined) {
    const exact = frames.get(`${opportunityId}:${observedAt}`);
    return exact ? structuredClone(exact) : null;
  }
  const candidates = [...frames.values()]
    .filter(frame => frame.opportunityId === opportunityId)
    .sort((left, right) => right.observedAt - left.observedAt);
  return candidates[0] ? structuredClone(candidates[0]) : null;
}

export function getCryptaraParallelCognitionStatus() {
  return {
    cachedFrames: frames.size,
    inFlight: inFlight.size,
    helperCount: 2,
    helpers: ['cryptara_market_truth_helper', 'cryptara_profit_efficiency_helper'],
    executionAuthority: false,
    writeAuthority: false,
    hotPathNetworkRequestsAdded: false,
  };
}
