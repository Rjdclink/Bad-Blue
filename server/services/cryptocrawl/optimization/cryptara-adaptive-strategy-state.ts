import logger from '../../../logger.js';
import { RuntimeJsonStateStore } from '../integration/runtime-json-state-store.js';

export type CryptaraAdaptiveRank = 'observer' | 'analyst' | 'strategist' | 'sovereign';

export interface CryptaraAdaptiveOutcome {
  eventId: string;
  success: boolean;
  realizedProfitUsd: number;
  expectedProfitUsd: number;
  latencyMs: number;
  slippageBps: number | null;
  timestamp: number;
  rank: CryptaraAdaptiveRank;
}

export type CryptaraEditableStrategyParameter = 'prefetchAggression';

export interface CryptaraMicroEditEvidence {
  editId: string;
  parameter: CryptaraEditableStrategyParameter;
  before: number;
  after: number;
  hypothesis: string;
  trigger: 'objective_failure_repair' | 'rank_authorized_optimization';
  rankAtEdit: CryptaraAdaptiveRank;
  baselineQualityScore: number;
  validationSamples: number;
  validationScoreSum: number;
  startedAt: number;
  status: 'probation' | 'accepted' | 'rolled_back';
}

export interface CryptaraAdaptiveStrategySnapshot {
  version: 4;
  updatedAt: number;
  terminalObservations: number;
  strategyGeneration: number;
  qualityEwma: number | null;
  prefetchAggression: number;
  pendingEdit: CryptaraMicroEditEvidence | null;
  lastEdit: CryptaraMicroEditEvidence | null;
  lastEventId: string | null;
  authority: 'bounded_persistent_prefetch_tuning';
  editPolicy: 'strategist_minimum_one_prefetch_micro_edit_terminal_proof_then_accept_or_rollback';
  rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only';
  sourceCodeWriteAuthority: false;
  executionAuthority: false;
}

const store = new RuntimeJsonStateStore<CryptaraAdaptiveStrategySnapshot>('cryptara_adaptive_strategy');
const DEFAULT_STATE: CryptaraAdaptiveStrategySnapshot = {
  version: 4,
  updatedAt: 0,
  terminalObservations: 0,
  strategyGeneration: 0,
  qualityEwma: null,
  prefetchAggression: 0.5,
  pendingEdit: null,
  lastEdit: null,
  lastEventId: null,
  authority: 'bounded_persistent_prefetch_tuning',
  editPolicy: 'strategist_minimum_one_prefetch_micro_edit_terminal_proof_then_accept_or_rollback',
  rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
  sourceCodeWriteAuthority: false,
  executionAuthority: false,
};

let state: CryptaraAdaptiveStrategySnapshot = { ...DEFAULT_STATE };
let hydrated = false;
let hydration: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function finiteOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEdit(value: unknown): CryptaraMicroEditEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CryptaraMicroEditEvidence> & { parameter?: unknown };
  if (raw.parameter !== 'prefetchAggression') return null;
  if (raw.before === null || raw.before === undefined || raw.after === null || raw.after === undefined) return null;
  const before = Number(raw.before);
  const after = Number(raw.after);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const rankAtEdit: CryptaraAdaptiveRank = raw.rankAtEdit === 'sovereign' || raw.rankAtEdit === 'strategist' || raw.rankAtEdit === 'analyst'
    ? raw.rankAtEdit
    : 'observer';
  return {
    editId: typeof raw.editId === 'string' && raw.editId ? raw.editId : `legacy:${Date.now()}`,
    parameter: 'prefetchAggression',
    before: clamp(before, 0.25, 1),
    after: clamp(after, 0.25, 1),
    hypothesis: typeof raw.hypothesis === 'string' ? raw.hypothesis : 'bounded_prefetch_micro_edit',
    trigger: raw.trigger === 'rank_authorized_optimization' ? 'rank_authorized_optimization' : 'objective_failure_repair',
    rankAtEdit,
    baselineQualityScore: finiteOrDefault(raw.baselineQualityScore, 0),
    validationSamples: Math.max(0, Math.trunc(finiteOrDefault(raw.validationSamples, 0))),
    validationScoreSum: finiteOrDefault(raw.validationScoreSum, 0),
    startedAt: finiteOrDefault(raw.startedAt, 0),
    status: raw.status === 'accepted' || raw.status === 'rolled_back' ? raw.status : 'probation',
  };
}

function normalize(input: CryptaraAdaptiveStrategySnapshot | null): CryptaraAdaptiveStrategySnapshot {
  if (!input || ![1, 2, 3, 4].includes(Number((input as any).version))) return { ...DEFAULT_STATE };
  const raw = input as any;
  const normalized: CryptaraAdaptiveStrategySnapshot = {
    version: 4,
    updatedAt: Math.max(0, finiteOrDefault(raw.updatedAt, 0)),
    terminalObservations: Math.max(0, Math.trunc(finiteOrDefault(raw.terminalObservations, 0))),
    strategyGeneration: Math.max(0, Math.trunc(finiteOrDefault(raw.strategyGeneration, 0))),
    qualityEwma: raw.qualityEwma === null || raw.qualityEwma === undefined
      ? null
      : Number.isFinite(Number(raw.qualityEwma)) ? Number(raw.qualityEwma) : null,
    // Missing fields from older snapshots restore to the historical neutral
    // default, never to the minimum clamp boundary.
    prefetchAggression: clamp(finiteOrDefault(raw.prefetchAggression, DEFAULT_STATE.prefetchAggression), 0.25, 1),
    pendingEdit: normalizeEdit(raw.pendingEdit),
    lastEdit: normalizeEdit(raw.lastEdit),
    lastEventId: typeof raw.lastEventId === 'string' ? raw.lastEventId : null,
    authority: 'bounded_persistent_prefetch_tuning',
    editPolicy: 'strategist_minimum_one_prefetch_micro_edit_terminal_proof_then_accept_or_rollback',
    rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
    sourceCodeWriteAuthority: false,
    executionAuthority: false,
  };

  // A legacy pending shared edit authored below Strategist is not allowed to
  // survive restart. Restore its pre-edit cadence and retain rollback evidence.
  const pending = normalized.pendingEdit;
  if (pending && pending.rankAtEdit !== 'strategist' && pending.rankAtEdit !== 'sovereign') {
    normalized.prefetchAggression = clamp(pending.before, 0.25, 1);
    normalized.lastEdit = { ...pending, status: 'rolled_back' };
    normalized.pendingEdit = null;
  }
  return normalized;
}

export function ensureCryptaraAdaptiveStrategyHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = store.load()
    .then(snapshot => {
      state = normalize(snapshot);
      hydrated = true;
      logger.info('Cryptara adaptive strategy restored', {
        component: 'CryptaraAdaptiveStrategyState',
        terminalObservations: state.terminalObservations,
        strategyGeneration: state.strategyGeneration,
        qualityEwma: state.qualityEwma,
        prefetchAggression: state.prefetchAggression,
        pendingEdit: state.pendingEdit,
        editPolicy: state.editPolicy,
        sharedEditMinimumRank: 'strategist',
        editableParameters: ['prefetchAggression'],
        sourceCodeWriteAuthority: false,
        executionAuthority: false,
      });
    })
    .catch(error => {
      logger.warn('Cryptara adaptive strategy persistence unavailable; using bounded defaults', {
        component: 'CryptaraAdaptiveStrategyState',
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => { hydration = null; });
  return hydration;
}

function persist(): Promise<void> {
  const snapshot = structuredClone(state);
  const write = persistTail.catch(() => undefined).then(() => store.save(snapshot));
  persistTail = write;
  return write.catch(error => {
    logger.warn('Cryptara adaptive strategy persistence failed', {
      component: 'CryptaraAdaptiveStrategyState',
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function qualityScore(outcome: CryptaraAdaptiveOutcome): number {
  const expectedScale = Math.max(0.10, Math.abs(outcome.expectedProfitUsd));
  const realizedEfficiency = clamp(outcome.realizedProfitUsd / expectedScale, -2, 2);
  const slippage = outcome.slippageBps !== null && Number.isFinite(outcome.slippageBps) ? Math.max(0, outcome.slippageBps) : 0;
  const latency = Math.max(0, outcome.latencyMs);
  return Number((realizedEfficiency - Math.min(1, slippage / 20) * 0.25 - Math.min(1, latency / 2_000) * 0.15).toFixed(8));
}

function objectivelyFailed(outcome: CryptaraAdaptiveOutcome): boolean {
  return outcome.success !== true || outcome.realizedProfitUsd <= 0;
}

function proposedMicroEdit(outcome: CryptaraAdaptiveOutcome): {
  next: number;
  hypothesis: string;
  trigger: 'objective_failure_repair' | 'rank_authorized_optimization';
} | null {
  // The adaptive surface intentionally tunes only Cryptara's own predictive
  // prefetch cadence. It does not rewrite execution strategies, notional, risk,
  // settlement, inventory, or governance state.
  if (outcome.rank !== 'strategist' && outcome.rank !== 'sovereign') return null;
  const failed = objectivelyFailed(outcome);
  const latencyThreshold = failed ? 1_000 : 750;
  if (outcome.latencyMs <= latencyThreshold) return null;
  return {
    next: state.prefetchAggression + (failed ? 0.025 : 0.015),
    hypothesis: failed
      ? 'repair_terminal_latency_failure_with_bounded_prefetch_increase'
      : 'rank_authorized_prefetch_micro_optimization_of_profitable_latency',
    trigger: failed ? 'objective_failure_repair' : 'rank_authorized_optimization',
  };
}

function startMicroEdit(
  proposal: NonNullable<ReturnType<typeof proposedMicroEdit>>,
  outcome: CryptaraAdaptiveOutcome,
  baselineQualityScore: number,
): void {
  const before = state.prefetchAggression;
  state.prefetchAggression = clamp(proposal.next, 0.25, 1);
  const after = state.prefetchAggression;
  if (Math.abs(after - before) <= 1e-12) return;
  state.pendingEdit = {
    editId: `cryptara-edit:prefetchAggression:${outcome.timestamp}:${state.terminalObservations}`,
    parameter: 'prefetchAggression',
    before,
    after,
    hypothesis: proposal.hypothesis,
    trigger: proposal.trigger,
    rankAtEdit: outcome.rank,
    baselineQualityScore,
    validationSamples: 0,
    validationScoreSum: 0,
    startedAt: outcome.timestamp,
    status: 'probation',
  };
  logger.info('Cryptara bounded prefetch micro-edit entered probation', {
    component: 'CryptaraAdaptiveStrategyState',
    editId: state.pendingEdit.editId,
    before,
    after,
    trigger: proposal.trigger,
    rankAtEdit: outcome.rank,
    hypothesis: proposal.hypothesis,
    validationSamplesRequired: 3,
    sharedEditMinimumRank: 'strategist',
    executionStrategyMutation: false,
    sourceCodeWriteAuthority: false,
  });
}

function validatePendingEdit(score: number): void {
  const edit = state.pendingEdit;
  if (!edit) return;
  edit.validationSamples += 1;
  edit.validationScoreSum += score;
  if (edit.validationSamples < 3) return;
  const average = edit.validationScoreSum / edit.validationSamples;
  const requiredImprovementMargin = 0.01;
  const improved = average >= edit.baselineQualityScore + requiredImprovementMargin && average > 0;
  if (!improved) {
    state.prefetchAggression = clamp(edit.before, 0.25, 1);
    edit.status = 'rolled_back';
    state.lastEdit = { ...edit };
    logger.warn('Cryptara bounded prefetch micro-edit rolled back because terminal evidence did not prove improvement', {
      component: 'CryptaraAdaptiveStrategyState',
      editId: edit.editId,
      baselineQualityScore: edit.baselineQualityScore,
      validationAverageQualityScore: average,
      requiredImprovementMargin,
      validationSamples: edit.validationSamples,
    });
  } else {
    edit.status = 'accepted';
    state.lastEdit = { ...edit };
    state.strategyGeneration += 1;
    logger.info('Cryptara bounded prefetch micro-edit accepted from proven terminal improvement', {
      component: 'CryptaraAdaptiveStrategyState',
      editId: edit.editId,
      baselineQualityScore: edit.baselineQualityScore,
      validationAverageQualityScore: average,
      requiredImprovementMargin,
      validationSamples: edit.validationSamples,
      strategyGeneration: state.strategyGeneration,
    });
  }
  state.pendingEdit = null;
}

export async function recordCryptaraAdaptiveOutcome(outcome: CryptaraAdaptiveOutcome): Promise<void> {
  if (!Number.isFinite(outcome.realizedProfitUsd) || !Number.isFinite(outcome.expectedProfitUsd) || !Number.isFinite(outcome.latencyMs)) return;
  await ensureCryptaraAdaptiveStrategyHydrated();
  if (state.lastEventId === outcome.eventId) return;

  const score = qualityScore(outcome);
  const priorEwma = state.qualityEwma;
  const hadPendingEdit = state.pendingEdit !== null;
  if (hadPendingEdit) validatePendingEdit(score);

  state.terminalObservations += 1;
  state.qualityEwma = priorEwma === null ? score : Number((priorEwma * 0.85 + score * 0.15).toFixed(8));
  state.lastEventId = outcome.eventId;
  state.updatedAt = Date.now();

  if (!hadPendingEdit && state.pendingEdit === null && state.terminalObservations >= 3) {
    const proposal = proposedMicroEdit(outcome);
    if (proposal) startMicroEdit(proposal, outcome, priorEwma ?? score);
  }
  await persist();
}

export function getCryptaraAdaptiveStrategySnapshot(): CryptaraAdaptiveStrategySnapshot {
  return structuredClone(state);
}
