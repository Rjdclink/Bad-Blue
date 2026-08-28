import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';
import { RuntimeJsonStateStore } from '../integration/runtime-json-state-store.js';

export interface MeasuredExecutionSample {
  eventId: string;
  opportunityId?: string;
  chain: string;
  symbol: string;
  strategy: string;
  success: boolean;
  expectedProfitUsd: number;
  realizedProfitUsd: number | null;
  feeUsd: number | null;
  slippageBps: number | null;
  latencyMs: number;
  timestamp: number;
  provenance: string[];
}

export interface MeasuredEvolutionSnapshot {
  version: 1;
  samples: MeasuredExecutionSample[];
  updatedAt: number;
}

const store = new RuntimeJsonStateStore<MeasuredEvolutionSnapshot>('measured_evolution_feedback');
let state: MeasuredEvolutionSnapshot = { version: 1, samples: [], updatedAt: Date.now() };
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();
const MAX_SAMPLES = 500;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sampleKey(sample: Pick<MeasuredExecutionSample, 'eventId'>): string {
  return sample.eventId;
}

function normalizeSample(feedback: CryptaraExecutionFeedback): MeasuredExecutionSample {
  const eventId = terminalFeedbackIdentity(feedback);
  return {
    eventId,
    opportunityId: feedback.opportunityId,
    chain: feedback.chain,
    symbol: feedback.symbol,
    strategy: feedback.strategy,
    success: feedback.success,
    expectedProfitUsd: Number.isFinite(feedback.expectedProfitUsd) ? feedback.expectedProfitUsd : 0,
    realizedProfitUsd: finiteOrNull(feedback.realizedProfitUsd),
    feeUsd: finiteOrNull(feedback.feeUsd),
    slippageBps: finiteOrNull(feedback.slippageBps),
    latencyMs: Number.isFinite(feedback.latencyMs) ? Math.max(0, feedback.latencyMs) : 0,
    timestamp: feedback.settlement?.settledAt ?? feedback.settlement?.submittedAt ?? feedback.timestamp,
    provenance: [...new Set([...(feedback.provenance || []), `terminal_feedback:${eventId}`])],
  };
}

/**
 * Hydrate both current samples and version-1 samples written before eventId was
 * added. Older valid measured evidence is migrated instead of silently dropped.
 */
function normalizePersistedSample(input: unknown): MeasuredExecutionSample | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<MeasuredExecutionSample>;
  if (typeof value.chain !== 'string' || typeof value.symbol !== 'string' ||
      typeof value.strategy !== 'string' || typeof value.success !== 'boolean' ||
      typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return null;

  const eventId = typeof value.eventId === 'string' && value.eventId.length > 0
    ? value.eventId
    : [
        'legacy-measured',
        value.opportunityId || 'unknown-opportunity',
        value.chain,
        value.symbol,
        value.strategy,
        value.success ? 'success' : 'failure',
        String(value.timestamp),
      ].join(':');

  return {
    eventId,
    opportunityId: typeof value.opportunityId === 'string' ? value.opportunityId : undefined,
    chain: value.chain,
    symbol: value.symbol,
    strategy: value.strategy,
    success: value.success,
    expectedProfitUsd: Number.isFinite(value.expectedProfitUsd) ? Number(value.expectedProfitUsd) : 0,
    realizedProfitUsd: finiteOrNull(value.realizedProfitUsd),
    feeUsd: finiteOrNull(value.feeUsd),
    slippageBps: finiteOrNull(value.slippageBps),
    latencyMs: Number.isFinite(value.latencyMs) ? Math.max(0, Number(value.latencyMs)) : 0,
    timestamp: value.timestamp,
    provenance: [
      ...new Set([
        ...(Array.isArray(value.provenance) ? value.provenance.filter((entry): entry is string => typeof entry === 'string') : []),
        ...(value.eventId ? [] : ['migrated_legacy_measured_sample']),
      ]),
    ],
  };
}

function validSnapshot(input: MeasuredEvolutionSnapshot | null): input is MeasuredEvolutionSnapshot {
  return !!input && input.version === 1 && Array.isArray(input.samples);
}

function mergeSamples(...groups: unknown[][]): MeasuredExecutionSample[] {
  const merged = new Map<string, MeasuredExecutionSample>();
  for (const group of groups) {
    for (const input of group) {
      const sample = normalizePersistedSample(input);
      if (!sample) continue;
      merged.set(sampleKey(sample), { ...sample, provenance: [...sample.provenance] });
    }
  }
  return [...merged.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-MAX_SAMPLES);
}

export function ensureMeasuredEvolutionFeedbackHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const persisted = await store.load();
      if (validSnapshot(persisted)) {
        state = {
          version: 1,
          samples: mergeSamples(persisted.samples, state.samples),
          updatedAt: Math.max(Number.isFinite(persisted.updatedAt) ? persisted.updatedAt : 0, state.updatedAt, Date.now()),
        };
      }
      // Save the normalized snapshot so pre-eventId samples are durably migrated.
      await store.save(state);
      hydrated = true;
      logger.info('Measured evolution feedback restored', {
        component: 'MeasuredEvolutionFeedback',
        samples: state.samples.length,
        legacySamplesMigrated: state.samples.filter(sample => sample.provenance.includes('migrated_legacy_measured_sample')).length,
      });
    } catch (error) {
      logger.warn('Measured evolution feedback persistence unavailable; continuing in memory', {
        component: 'MeasuredEvolutionFeedback',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

function persistSoon(): Promise<void> {
  if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return Promise.resolve();
  const snapshot: MeasuredEvolutionSnapshot = {
    version: 1,
    samples: state.samples.slice(-MAX_SAMPLES),
    updatedAt: state.updatedAt,
  };
  const write = persistTail.catch(() => undefined).then(() => store.save(snapshot));
  persistTail = write;
  return write.catch(error => {
    logger.warn('Measured evolution feedback persistence failed', {
      component: 'MeasuredEvolutionFeedback',
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function measuredStats(samples: MeasuredExecutionSample[]) {
  const realized = samples.filter(sample => sample.realizedProfitUsd !== null);
  const wins = realized.filter(sample => sample.success && (sample.realizedProfitUsd || 0) > 0);
  const positive = realized.map(sample => sample.realizedProfitUsd || 0).filter(value => value > 0);
  const negative = realized.map(sample => sample.realizedProfitUsd || 0).filter(value => value < 0);
  const totalProfit = realized.reduce((sum, sample) => sum + (sample.realizedProfitUsd || 0), 0);
  const mean = realized.length > 0 ? totalProfit / realized.length : 0;
  const variance = realized.length > 1
    ? realized.reduce((sum, sample) => sum + Math.pow((sample.realizedProfitUsd || 0) - mean, 2), 0) / realized.length
    : 0;
  return {
    sampleCount: realized.length,
    successRate: realized.length > 0 ? wins.length / realized.length : 0,
    totalProfitUsd: totalProfit,
    averageProfitUsd: mean,
    profitFactor: negative.length > 0
      ? positive.reduce((sum, value) => sum + value, 0) / Math.abs(negative.reduce((sum, value) => sum + value, 0))
      : positive.length > 0 ? Number.POSITIVE_INFINITY : 0,
    sharpeRatio: variance > 0 ? mean / Math.sqrt(variance) : 0,
    averageLatencyMs: realized.length > 0 ? realized.reduce((sum, sample) => sum + sample.latencyMs, 0) / realized.length : null,
    averageSlippageBps: (() => {
      const measured = realized.filter(sample => sample.slippageBps !== null);
      return measured.length > 0 ? measured.reduce((sum, sample) => sum + (sample.slippageBps || 0), 0) / measured.length : null;
    })(),
  };
}

export async function recordMeasuredEvolutionFeedback(feedback: CryptaraExecutionFeedback): Promise<void> {
  if (!feedback.settlement || feedback.settlement.terminal !== true) return;
  await ensureMeasuredEvolutionFeedbackHydrated();
  const sample = normalizeSample(feedback);
  const key = sampleKey(sample);
  if (state.samples.some(existing => sampleKey(existing) === key)) {
    logger.debug('Duplicate measured terminal execution ignored by evolution bridge', {
      component: 'MeasuredEvolutionFeedback',
      key,
    });
    return;
  }

  state.samples = mergeSamples(state.samples, [sample]);
  state.updatedAt = Date.now();
  await persistSoon();

  const stats = measuredStats(state.samples);
  logger.info('Measured terminal execution fed to canonical evolution memory', {
    component: 'MeasuredEvolutionFeedback',
    eventId: sample.eventId,
    symbol: sample.symbol,
    strategy: sample.strategy,
    sampleCount: stats.sampleCount,
    successRate: stats.successRate,
    totalProfitUsd: stats.totalProfitUsd,
    averageLatencyMs: stats.averageLatencyMs,
    averageSlippageBps: stats.averageSlippageBps,
    persistentMemoryAllowed: getCryptocrawlGovernance().isLongTermMemoryAllowed(),
    legacyHyperEvolutionAuthority: false,
  });
}

export function getMeasuredEvolutionMetrics() {
  const stats = measuredStats(state.samples);
  return {
    ...stats,
    mode: stats.sampleCount > 0 ? 'terminal_calibrated' as const : 'bootstrap_no_terminal_samples' as const,
    terminalEvidenceRequired: true,
    syntheticSamplesAllowed: false,
    legacyHyperEvolutionAuthority: false,
    updatedAt: state.updatedAt,
  };
}

export function getMeasuredEvolutionSamples(limit = 100): MeasuredExecutionSample[] {
  return state.samples.slice(-Math.max(1, limit)).map(sample => ({ ...sample, provenance: [...sample.provenance] }));
}
