import type { CryptaraOpportunityContext } from '../../cryptara/index.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { ComputeLayer, TaskIntensity, TaskPriority, TaskType, type Task } from '../../computationalBeam/types.js';
import { getAdaptiveProfitOperatingEnvelope } from '../governance/adaptive-profit-operating-envelope.js';
import { getAntennaProviderQualitySummary } from '../intelligence/sovereign-antenna-quality.js';
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
    deterministicNetProfitUsd: number;
    netProfitBps: number | null;
    bpsToBreakEven: number | null;
    expectedSlippageBps: number | null;
    quoteAgeMs: number;
    requestedNotionalUsd: number | null;
    executableNotionalUsd: number | null;
    profitLadderMaxNotionalUsd: number;
    boundedTargetNotionalUsd: number;
  };
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
  quoteAgeMs: number;
  maxQuoteAgeMs: number;
  measuredDepth: boolean;
  authenticatedFees: boolean;
  executableNotionalUsd: number | null;
  criticalMissingInformation: string[];
  antennaQuality: Array<{ quality: number; samples: number }>;
  providerConsensusQuality: number | null;
  providerConsensusState: string | null;
};

type OptimizationInput = {
  deterministicNetProfitUsd: number;
  notionalUsd: number | null;
  requestedNotionalUsd: number | null;
  executableNotionalUsd: number | null;
  expectedSlippageBps: number | null;
  quoteAgeMs: number;
  profitLadderMaxNotionalUsd: number;
};

type PendingHelper = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const frames = new Map<string, CryptaraParallelCognitionFrame>();
const inFlight = new Map<string, Promise<void>>();
const pendingHelpers = new Map<string, PendingHelper>();
const MAX_FRAMES = Math.max(64, Math.min(4096, Number(process.env.CRYPTARA_PARALLEL_COGNITION_FRAMES || 512)));
let helperEventBridgeInstalled = false;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function keyOf(context: Pick<CryptaraOpportunityContext, 'opportunityId' | 'observedAt'>): string {
  return `${context.opportunityId}:${context.observedAt}`;
}

function maxQuoteAgeMs(): number {
  const configured = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(250, Math.min(15_000, configured)) : 5_000;
}

function currentQuoteAgeMs(context: CryptaraOpportunityContext, now = Date.now()): number | null {
  const plan = context.plan;
  if (!plan || !Number.isFinite(plan.quoteAgeMs)) return null;
  return Math.max(0, plan.quoteAgeMs + Math.max(0, now - context.observedAt));
}

function helperDeadlineAt(context: CryptaraOpportunityContext): number | null {
  const currentAge = currentQuoteAgeMs(context);
  if (currentAge === null) return null;
  const remainingMs = maxQuoteAgeMs() - currentAge;
  return remainingMs > 0 ? Date.now() + remainingMs : null;
}

function isOptionalEnrichment(item: string, context: CryptaraOpportunityContext): boolean {
  if (item.startsWith('optional:')) return true;
  if (item.startsWith('provider_coinstats_')) return true;
  if (context.chain !== 'cex') return false;
  return item.startsWith('provider_coincap_') || item.startsWith('provider_0x_');
}

function marketTruthHelper(input: MarketTruthInput) {
  const quoteFresh = input.quoteAgeMs <= input.maxQuoteAgeMs;
  const antennaQuality = input.antennaQuality.length > 0
    ? input.antennaQuality.reduce((sum, item) => sum + item.quality, 0) / input.antennaQuality.length
    : null;
  const providerQuality = input.providerConsensusQuality;
  const ready = quoteFresh
    && input.measuredDepth
    && input.authenticatedFees
    && input.criticalMissingInformation.length === 0
    && input.executableNotionalUsd !== null
    && input.executableNotionalUsd > 0;

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
  if (!quoteFresh) reasons.push('fresh_quote_missing');
  if (!input.measuredDepth) reasons.push('measured_depth_missing');
  if (!input.authenticatedFees) reasons.push('authenticated_fee_evidence_missing');
  if (input.criticalMissingInformation.length > 0) reasons.push(...input.criticalMissingInformation.map(item => `missing:${item}`));
  if (!(input.executableNotionalUsd !== null && input.executableNotionalUsd > 0)) reasons.push('executable_notional_missing');

  return {
    ready,
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
  const netProfitBps = notional !== null
    ? input.deterministicNetProfitUsd / notional * 10_000
    : null;
  const bpsToBreakEven = netProfitBps === null ? null : Math.max(0, -netProfitBps);
  const ladderMax = Math.max(0, input.profitLadderMaxNotionalUsd);
  const executable = Math.max(0, input.executableNotionalUsd ?? input.requestedNotionalUsd ?? input.notionalUsd ?? 0);
  return {
    deterministicNetProfitUsd: input.deterministicNetProfitUsd,
    netProfitBps: netProfitBps === null ? null : Number(netProfitBps.toFixed(8)),
    bpsToBreakEven: bpsToBreakEven === null ? null : Number(bpsToBreakEven.toFixed(8)),
    expectedSlippageBps: input.expectedSlippageBps,
    quoteAgeMs: input.quoteAgeMs,
    requestedNotionalUsd: input.requestedNotionalUsd,
    executableNotionalUsd: input.executableNotionalUsd,
    profitLadderMaxNotionalUsd: ladderMax,
    boundedTargetNotionalUsd: ladderMax > 0 ? Math.min(executable, ladderMax) : 0,
  };
}

function ensureHelperEventBridge(): void {
  if (helperEventBridgeInstalled) return;
  helperEventBridgeInstalled = true;
  workloadRouter.on('task-completed', (event: { taskId: string; result?: unknown }) => {
    const pending = pendingHelpers.get(event.taskId);
    if (!pending) return;
    pendingHelpers.delete(event.taskId);
    const outcome = event.result ?? workloadRouter.consumeTaskOutcome(event.taskId)?.result;
    if (outcome === null || outcome === undefined) {
      pending.reject(new Error(`CRYPTARA_HELPER_INVALID_RESULT:${event.taskId}`));
      return;
    }
    pending.resolve(outcome);
  });
  workloadRouter.on('task-failed', (event: { taskId: string; error?: string }) => {
    const pending = pendingHelpers.get(event.taskId);
    if (!pending) return;
    pendingHelpers.delete(event.taskId);
    pending.reject(new Error(event.error || `CRYPTARA_HELPER_FAILED:${event.taskId}`));
  });
}

async function runBeamHelper<Input, Output>(
  task: Task,
  input: Input,
  execute: (input: Input) => Output,
): Promise<Output> {
  ensureHelperEventBridge();
  return new Promise<Output>((resolve, reject) => {
    task.workload = {
      id: `cryptara-helper:${task.id}`,
      type: String(task.payload?.helper || 'cryptara_helper'),
      input,
      timeoutMs: Math.max(25, Math.min(500, Number(process.env.CRYPTARA_HELPER_TIMEOUT_MS || 150))),
      execute: immutableInput => execute(immutableInput as Input),
      validate: result => result !== null && result !== undefined,
    };
    pendingHelpers.set(task.id, {
      resolve: value => resolve(value as Output),
      reject,
    });
    void workloadRouter.routeTask(task).catch(error => {
      const pending = pendingHelpers.get(task.id);
      if (!pending) return;
      pendingHelpers.delete(task.id);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function buildInputs(context: CryptaraOpportunityContext): { market: MarketTruthInput; optimization: OptimizationInput } | null {
  const plan = context.plan;
  if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) return null;
  const quoteAgeMs = currentQuoteAgeMs(context);
  if (quoteAgeMs === null) return null;
  const antenna = getAntennaProviderQualitySummary();
  const consensus = getCryptaraProviderConsensusSnapshot(context.opportunityId);
  const envelope = getAdaptiveProfitOperatingEnvelope();
  const criticalMissing = context.missingInformation.filter(item => !isOptionalEnrichment(item, context));
  const expectedSlippageBps = plan.expectedSlippageBps !== null && Number.isFinite(plan.expectedSlippageBps)
    ? plan.expectedSlippageBps
    : null;
  return {
    market: {
      quoteAgeMs,
      maxQuoteAgeMs: maxQuoteAgeMs(),
      measuredDepth: plan.liquidity.status === 'measured',
      authenticatedFees: !!plan.feeEvidence?.buy && !!plan.feeEvidence?.sell,
      executableNotionalUsd: Number.isFinite(plan.executableNotionalUsd) ? plan.executableNotionalUsd : null,
      criticalMissingInformation: [...criticalMissing],
      antennaQuality: antenna.map(item => ({
        quality: item.confidenceAdjustedQualityScore,
        samples: item.requests,
      })),
      providerConsensusQuality: consensus?.qualityScore ?? null,
      providerConsensusState: consensus?.state ?? null,
    },
    optimization: {
      deterministicNetProfitUsd: plan.netProfitUsd,
      notionalUsd: Number.isFinite(plan.notionalUsd) ? plan.notionalUsd : null,
      requestedNotionalUsd: Number.isFinite(plan.requestedNotionalUsd) ? plan.requestedNotionalUsd : null,
      executableNotionalUsd: Number.isFinite(plan.executableNotionalUsd) ? plan.executableNotionalUsd : null,
      expectedSlippageBps,
      quoteAgeMs,
      profitLadderMaxNotionalUsd: Math.max(0, Number(envelope.recommendedMaxNotionalUsd) || 0),
    },
  };
}

async function calculateFrame(context: CryptaraOpportunityContext): Promise<void> {
  const immutable = structuredClone(context);
  const deadlineAt = helperDeadlineAt(immutable);
  const inputs = buildInputs(immutable);
  if (deadlineAt === null || inputs === null || Date.now() >= deadlineAt) return;

  const marketTask = workloadRouter.createTask(TaskType.ML_PREDICTION, {
    helper: 'cryptara_market_truth_helper',
    quantiDeadlineAt: deadlineAt,
    quantiParallelismHint: 1,
    quantiUsefulWorkUnits: 1,
  }, {
    intensity: TaskIntensity.MODERATE,
    priority: TaskPriority.HIGH,
    requiredLayer: ComputeLayer.BEAM,
  });
  const optimizationTask = workloadRouter.createTask(TaskType.ML_PREDICTION, {
    helper: 'cryptara_profit_efficiency_helper',
    quantiDeadlineAt: deadlineAt,
    quantiParallelismHint: 1,
    quantiUsefulWorkUnits: 1,
  }, {
    intensity: TaskIntensity.MODERATE,
    priority: TaskPriority.MEDIUM,
    requiredLayer: ComputeLayer.BEAM,
  });

  // Quote-bound helper work is never retried. If it misses its first deadline,
  // the evidence is stale and a retry would only waste compute or resurrect old truth.
  marketTask.metadata.maxRetries = 0;
  optimizationTask.metadata.maxRetries = 0;

  const [marketResult, optimizationResult] = await Promise.allSettled([
    runBeamHelper(marketTask, inputs.market, marketTruthHelper),
    runBeamHelper(optimizationTask, inputs.optimization, optimizationHelper),
  ]);
  if (marketResult.status !== 'fulfilled' || optimizationResult.status !== 'fulfilled') return;

  const frame: CryptaraParallelCognitionFrame = {
    opportunityId: immutable.opportunityId,
    observedAt: immutable.observedAt,
    completedAt: Date.now(),
    marketTruth: marketResult.value,
    optimization: optimizationResult.value,
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

export function prewarmCryptaraParallelCognition(context: CryptaraOpportunityContext): void {
  if (!context.plan || !Number.isFinite(context.plan.netProfitUsd) || context.plan.netProfitUsd <= 0) return;
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
    pendingHelpers: pendingHelpers.size,
    helperCount: 2,
    helpers: ['cryptara_market_truth_helper', 'cryptara_profit_efficiency_helper'],
    helperEventListeners: 2,
    helperComputeLane: 'quanti_warm_below_authoritative_monte_carlo',
    helperRetries: 0,
    executionAuthority: false,
    writeAuthority: false,
    staleFrameSubstitutionAllowed: false,
    hotPathNetworkRequestsAdded: false,
  };
}
