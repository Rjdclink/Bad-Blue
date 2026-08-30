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

export type CryptaraEditableStrategyParameter = 'refinementDensity' | 'prefetchAggression' | 'notionalBias';

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
  version: 3;
  updatedAt: number;
  terminalObservations: number;
  strategyGeneration: number;
  qualityEwma: number | null;
  notionalBias: number;
  refinementDensity: number;
  prefetchAggression: number;
  evidenceRefreshFactor: number;
  pendingEdit: CryptaraMicroEditEvidence | null;
  lastEdit: CryptaraMicroEditEvidence | null;
  lastEventId: string | null;
  authority: 'bounded_persistent_strategy_tuning';
  editPolicy: 'rank_gated_one_micro_edit_terminal_proof_then_accept_or_rollback';
  rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only';
  sourceCodeWriteAuthority: false;
  executionAuthority: false;
}

const store = new RuntimeJsonStateStore<CryptaraAdaptiveStrategySnapshot>('cryptara_adaptive_strategy');
const DEFAULT_STATE: CryptaraAdaptiveStrategySnapshot = {
  version: 3,
  updatedAt: 0,
  terminalObservations: 0,
  strategyGeneration: 0,
  qualityEwma: null,
  notionalBias: 1,
  refinementDensity: 0.5,
  prefetchAggression: 0.5,
  evidenceRefreshFactor: 1,
  pendingEdit: null,
  lastEdit: null,
  lastEventId: null,
  authority: 'bounded_persistent_strategy_tuning',
  editPolicy: 'rank_gated_one_micro_edit_terminal_proof_then_accept_or_rollback',
  rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
  sourceCodeWriteAuthority: false,
  executionAuthority: false,
};

let state: CryptaraAdaptiveStrategySnapshot = { ...DEFAULT_STATE };
let hydrated = false;
let hydration: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function normalizeEdit(value: unknown): CryptaraMicroEditEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CryptaraMicroEditEvidence>;
  if (!['refinementDensity', 'prefetchAggression', 'notionalBias'].includes(String(raw.parameter))) return null;
  if (!Number.isFinite(Number(raw.before)) || !Number.isFinite(Number(raw.after))) return null;
  const status = raw.status === 'accepted' || raw.status === 'rolled_back' ? raw.status : 'probation';
  const rankAtEdit: CryptaraAdaptiveRank = raw.rankAtEdit === 'sovereign' || raw.rankAtEdit === 'strategist' || raw.rankAtEdit === 'analyst'
    ? raw.rankAtEdit
    : 'observer';
  return {
    editId: typeof raw.editId === 'string' && raw.editId ? raw.editId : `legacy:${Date.now()}`,
    parameter: raw.parameter as CryptaraEditableStrategyParameter,
    before: Number(raw.before),
    after: Number(raw.after),
    hypothesis: typeof raw.hypothesis === 'string' ? raw.hypothesis : 'bounded_strategy_micro_edit',
    trigger: raw.trigger === 'rank_authorized_optimization' ? 'rank_authorized_optimization' : 'objective_failure_repair',
    rankAtEdit,
    baselineQualityScore: Number.isFinite(Number(raw.baselineQualityScore)) ? Number(raw.baselineQualityScore) : 0,
    validationSamples: Math.max(0, Math.trunc(Number(raw.validationSamples) || 0)),
    validationScoreSum: Number.isFinite(Number(raw.validationScoreSum)) ? Number(raw.validationScoreSum) : 0,
    startedAt: Number.isFinite(Number(raw.startedAt)) ? Number(raw.startedAt) : 0,
    status,
  };
}

function normalize(input: CryptaraAdaptiveStrategySnapshot | null): CryptaraAdaptiveStrategySnapshot {
  if (!input || ![1, 2, 3].includes(Number((input as any).version))) return { ...DEFAULT_STATE };
  const raw = input as any;
  const normalized: CryptaraAdaptiveStrategySnapshot = {
    version: 3,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    terminalObservations: Math.max(0, Math.trunc(Number(raw.terminalObservations) || 0)),
    strategyGeneration: Math.max(0, Math.trunc(Number(raw.strategyGeneration) || 0)),
    qualityEwma: Number.isFinite(Number(raw.qualityEwma)) ? Number(raw.qualityEwma) : null,
    notionalBias: clamp(Number(raw.notionalBias), 0.10, 1),
    refinementDensity: clamp(Number(raw.refinementDensity), 0.25, 1),
    prefetchAggression: clamp(Number(raw.prefetchAggression), 0.25, 1),
    evidenceRefreshFactor: clamp(Number(raw.evidenceRefreshFactor), 0.50, 1.50),
    pendingEdit: normalizeEdit(raw.pendingEdit),
    lastEdit: normalizeEdit(raw.lastEdit),
    lastEventId: typeof raw.lastEventId === 'string' ? raw.lastEventId : null,
    authority: 'bounded_persistent_strategy_tuning',
    editPolicy: 'rank_gated_one_micro_edit_terminal_proof_then_accept_or_rollback',
    rankEvidenceAuthority: 'terminal_confirmed_external_settlement_only',
    sourceCodeWriteAuthority: false,
    executionAuthority: false,
  };

  // Shared knobs affect more than one route. A persisted edit authored below the
  // second-highest rank is therefore invalid even if it was originally triggered
  // by a failed trade: restoring it could alter unrelated strategies that work.
  const pending = normalized.pendingEdit;
  if (pending && pending.rankAtEdit !== 'strategist' && pending.rankAtEdit !== 'sovereign') {
    if (pending.parameter === 'notionalBias') normalized.notionalBias = clamp(pending.before, 0.10, 1);
    if (pending.parameter === 'refinementDensity') normalized.refinementDensity = clamp(pending.before, 0.25, 1);
    if (pending.parameter === 'prefetchAggression') normalized.prefetchAggression = clamp(pending.before, 0.25, 1);
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
        notionalBias: state.notionalBias,
        refinementDensity: state.refinementDensity,
        prefetchAggression: state.prefetchAggression,
        pendingEdit: state.pendingEdit,
        editPolicy: state.editPolicy,
        sharedEditMinimumRank: 'strategist',
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
  // Realized profit dominates; latency/slippage can only subtract. A losing trade
  // can never become "good" merely because it was fast or low-slippage.
  return Number((realizedEfficiency - Math.min(1, slippage / 20) * 0.25 - Math.min(1, latency / 2_000) * 0.15).toFixed(8));
}

function parameterValue(parameter: CryptaraEditableStrategyParameter): number { return state[parameter]; }
function setParameter(parameter: CryptaraEditableStrategyParameter, value: number): void {
  if (parameter === 'notionalBias') state.notionalBias = clamp(value, 0.10, 1);
  if (parameter === 'refinementDensity') state.refinementDensity = clamp(value, 0.25, 1);
  if (parameter === 'prefetchAggression') state.prefetchAggression = clamp(value, 0.25, 1);
}

function objectivelyFailed(outcome: CryptaraAdaptiveOutcome): boolean {
  // "Not working" is intentionally narrow and measurable. Relative underperformance,
  // rank ambition, simulations, or "could be better" are not failures.
  return outcome.success !== true || outcome.realizedProfitUsd <= 0;
}

function failureRepair(outcome: CryptaraAdaptiveOutcome): {
  parameter: CryptaraEditableStrategyParameter;
  next: number;
  hypothesis: string;
  trigger: 'objective_failure_repair';
} {
  const slippage = outcome.slippageBps !== null && Number.isFinite(outcome.slippageBps) ? Math.max(0, outcome.slippageBps) : null;
  if (outcome.latencyMs > 1_000 && (slippage === null || slippage < 8)) {
    return {
      parameter: 'prefetchAggression',
      next: state.prefetchAggression + 0.025,
      hypothesis: 'repair_terminal_failure_with_bounded_prefetch_latency_adjustment',
      trigger: 'objective_failure_repair',
    };
  }
  return {
    parameter: 'refinementDensity',
    next: state.refinementDensity + 0.025,
    hypothesis: 'repair_terminal_failure_with_bounded_size_route_refinement',
    trigger: 'objective_failure_repair',
  };
}

function healthyOptimization(outcome: CryptaraAdaptiveOutcome): {
  parameter: CryptaraEditableStrategyParameter;
  next: number;
  hypothesis: string;
  trigger: 'rank_authorized_optimization';
} | null {
  // Only Strategist (second-highest) or Sovereign may touch a strategy that is
  // objectively working. These are still micro-edits, one at a time, on probation.
  if (outcome.rank !== 'strategist' && outcome.rank !== 'sovereign') return null;
  const slippage = outcome.slippageBps !== null && Number.isFinite(outcome.slippageBps) ? Math.max(0, outcome.slippageBps) : null;
  if (slippage !== null && slippage > 4) {
    return {
      parameter: 'refinementDensity',
      next: state.refinementDensity + 0.015,
      hypothesis: 'rank_authorized_micro_refinement_of_profitable_slippage',
      trigger: 'rank_authorized_optimization',
    };
  }
  if (outcome.latencyMs > 750) {
    return {
      parameter: 'prefetchAggression',
      next: state.prefetchAggression + 0.015,
      hypothesis: 'rank_authorized_micro_prefetch_optimization_of_profitable_latency',
      trigger: 'rank_authorized_optimization',
    };
  }
  return {
    parameter: 'notionalBias',
    next: state.notionalBias + 0.01,
    hypothesis: 'rank_authorized_profit_ladder_bounded_notional_micro_scale',
    trigger: 'rank_authorized_optimization',
  };
}

function proposedMicroEdit(outcome: CryptaraAdaptiveOutcome) {
  // These knobs are shared across routes. Observer and Analyst may learn,
  // diagnose and propose repairs, but cannot mutate shared strategy state.
  // Strategist (second-highest) is the first rank with bounded edit authority.
  if (outcome.rank !== 'strategist' && outcome.rank !== 'sovereign') return null;
  if (objectivelyFailed(outcome)) return failureRepair(outcome);
  return healthyOptimization(outcome);
}

function startMicroEdit(
  proposal: NonNullable<ReturnType<typeof proposedMicroEdit>>,
  outcome: CryptaraAdaptiveOutcome,
  baselineQualityScore: number,
): void {
  const before = parameterValue(proposal.parameter);
  setParameter(proposal.parameter, proposal.next);
  const after = parameterValue(proposal.parameter);
  if (Math.abs(after - before) <= 1e-12) return;
  state.pendingEdit = {
    editId: `cryptara-edit:${proposal.parameter}:${outcome.timestamp}:${state.terminalObservations}`,
    parameter: proposal.parameter,
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
  logger.info('Cryptara bounded micro-edit entered probation', {
    component: 'CryptaraAdaptiveStrategyState',
    editId: state.pendingEdit.editId,
    parameter: proposal.parameter,
    before,
    after,
    trigger: proposal.trigger,
    rankAtEdit: outcome.rank,
    hypothesis: proposal.hypothesis,
    validationSamplesRequired: 3,
    sharedEditMinimumRank: 'strategist',
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
  const degraded = average + 0.02 < edit.baselineQualityScore;
  if (degraded) {
    setParameter(edit.parameter, edit.before);
    edit.status = 'rolled_back';
    state.lastEdit = { ...edit };
    logger.warn('Cryptara bounded micro-edit rolled back from terminal evidence', {
      component: 'CryptaraAdaptiveStrategyState', editId: edit.editId, parameter: edit.parameter,
      baselineQualityScore: edit.baselineQualityScore, validationAverageQualityScore: average,
      validationSamples: edit.validationSamples,
    });
  } else {
    edit.status = 'accepted';
    state.lastEdit = { ...edit };
    state.strategyGeneration += 1;
    logger.info('Cryptara bounded micro-edit accepted from terminal evidence', {
      component: 'CryptaraAdaptiveStrategyState', editId: edit.editId, parameter: edit.parameter,
      baselineQualityScore: edit.baselineQualityScore, validationAverageQualityScore: average,
      validationSamples: edit.validationSamples, strategyGeneration: state.strategyGeneration,
    });
  }
  state.pendingEdit = null;
}

/**
 * Only canonical terminal-settlement callers write here. One micro-edit may be
 * active at a time and must prove itself over three later terminal observations.
 * Observer/Analyst: learn and diagnose only; no shared edits. Strategist/Sovereign:
 * bounded repair of objective failures plus bounded optimization of healthy work.
 * "Could be better" is never edit authority below Strategist, and simulations or
 * shadow trades never count as edit/rank evidence.
 */
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

  // Never stack edits. After an edit resolves, require a clean terminal interval
  // before proposing another so the before/after evidence remains attributable.
  if (!hadPendingEdit && state.pendingEdit === null && state.terminalObservations >= 3) {
    const proposal = proposedMicroEdit(outcome);
    if (proposal) startMicroEdit(proposal, outcome, priorEwma ?? score);
  }
  await persist();
}

export function getCryptaraAdaptiveStrategySnapshot(): CryptaraAdaptiveStrategySnapshot {
  return structuredClone(state);
}
