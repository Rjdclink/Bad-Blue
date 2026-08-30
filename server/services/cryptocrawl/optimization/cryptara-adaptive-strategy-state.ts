import logger from '../../../logger.js';
import { RuntimeJsonStateStore } from '../integration/runtime-json-state-store.js';

export interface CryptaraAdaptiveOutcome {
  eventId: string;
  realizedProfitUsd: number;
  expectedProfitUsd: number;
  latencyMs: number;
  slippageBps: number | null;
  timestamp: number;
}

export interface CryptaraAdaptiveStrategySnapshot {
  version: 1;
  updatedAt: number;
  terminalObservations: number;
  notionalBias: number;
  refinementDensity: number;
  prefetchAggression: number;
  evidenceRefreshFactor: number;
  lastEventId: string | null;
  authority: 'bounded_persistent_strategy_tuning';
  sourceCodeWriteAuthority: false;
  executionAuthority: false;
}

const store = new RuntimeJsonStateStore<CryptaraAdaptiveStrategySnapshot>('cryptara_adaptive_strategy');
const DEFAULT_STATE: CryptaraAdaptiveStrategySnapshot = {
  version: 1,
  updatedAt: 0,
  terminalObservations: 0,
  notionalBias: 1,
  refinementDensity: 0.5,
  prefetchAggression: 0.5,
  evidenceRefreshFactor: 1,
  lastEventId: null,
  authority: 'bounded_persistent_strategy_tuning',
  sourceCodeWriteAuthority: false,
  executionAuthority: false,
};

let state: CryptaraAdaptiveStrategySnapshot = { ...DEFAULT_STATE };
let hydrated = false;
let hydration: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function normalize(input: CryptaraAdaptiveStrategySnapshot | null): CryptaraAdaptiveStrategySnapshot {
  if (!input || input.version !== 1) return { ...DEFAULT_STATE };
  return {
    version: 1,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : 0,
    terminalObservations: Math.max(0, Math.trunc(Number(input.terminalObservations) || 0)),
    notionalBias: clamp(Number(input.notionalBias), 0.10, 1),
    refinementDensity: clamp(Number(input.refinementDensity), 0.25, 1),
    prefetchAggression: clamp(Number(input.prefetchAggression), 0.25, 1),
    evidenceRefreshFactor: clamp(Number(input.evidenceRefreshFactor), 0.50, 1.50),
    lastEventId: typeof input.lastEventId === 'string' ? input.lastEventId : null,
    authority: 'bounded_persistent_strategy_tuning',
    sourceCodeWriteAuthority: false,
    executionAuthority: false,
  };
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
        notionalBias: state.notionalBias,
        refinementDensity: state.refinementDensity,
        prefetchAggression: state.prefetchAggression,
        evidenceRefreshFactor: state.evidenceRefreshFactor,
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
    .finally(() => {
      hydration = null;
    });
  return hydration;
}

function persist(): Promise<void> {
  const snapshot = { ...state };
  const write = persistTail.catch(() => undefined).then(() => store.save(snapshot));
  persistTail = write;
  return write.catch(error => {
    logger.warn('Cryptara adaptive strategy persistence failed', {
      component: 'CryptaraAdaptiveStrategyState',
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Terminal-confirmed execution outcomes are the only write input. Cryptara may
 * adapt bounded search/sizing/prefetch parameters, but cannot rewrite source,
 * profitability gates, governance, settlement, inventory, or kill-switch logic.
 */
export async function recordCryptaraAdaptiveOutcome(outcome: CryptaraAdaptiveOutcome): Promise<void> {
  if (!Number.isFinite(outcome.realizedProfitUsd) || !Number.isFinite(outcome.expectedProfitUsd) || !Number.isFinite(outcome.latencyMs)) return;
  await ensureCryptaraAdaptiveStrategyHydrated();
  if (state.lastEventId === outcome.eventId) return;

  const win = outcome.realizedProfitUsd > 0;
  const miss = outcome.realizedProfitUsd - outcome.expectedProfitUsd;
  const slippage = outcome.slippageBps !== null && Number.isFinite(outcome.slippageBps) ? Math.max(0, outcome.slippageBps) : null;
  const latency = Math.max(0, outcome.latencyMs);
  const cleanExecution = win && (slippage === null || slippage <= 3) && latency <= 1_000;
  const stressedExecution = !win || (slippage !== null && slippage >= 8) || miss < -Math.max(0.10, Math.abs(outcome.expectedProfitUsd) * 0.50);

  let notionalBias = state.notionalBias;
  let refinementDensity = state.refinementDensity;
  let prefetchAggression = state.prefetchAggression;
  let evidenceRefreshFactor = state.evidenceRefreshFactor;

  if (cleanExecution) {
    notionalBias += 0.025;
    refinementDensity = Math.max(0.35, refinementDensity - 0.01);
  } else if (stressedExecution) {
    notionalBias *= 0.90;
    refinementDensity += 0.05;
  }

  if (slippage !== null && slippage > 4) {
    notionalBias *= Math.max(0.75, 1 - Math.min(0.20, slippage / 100));
    refinementDensity += 0.04;
  }

  if (latency > 1_000) {
    prefetchAggression += 0.05;
    evidenceRefreshFactor -= 0.05;
  } else if (latency < 350 && cleanExecution) {
    prefetchAggression = Math.max(0.25, prefetchAggression - 0.01);
    evidenceRefreshFactor = Math.min(1.25, evidenceRefreshFactor + 0.01);
  }

  state = {
    version: 1,
    updatedAt: Date.now(),
    terminalObservations: state.terminalObservations + 1,
    notionalBias: clamp(notionalBias, 0.10, 1),
    refinementDensity: clamp(refinementDensity, 0.25, 1),
    prefetchAggression: clamp(prefetchAggression, 0.25, 1),
    evidenceRefreshFactor: clamp(evidenceRefreshFactor, 0.50, 1.50),
    lastEventId: outcome.eventId,
    authority: 'bounded_persistent_strategy_tuning',
    sourceCodeWriteAuthority: false,
    executionAuthority: false,
  };
  await persist();
}

export function getCryptaraAdaptiveStrategySnapshot(): CryptaraAdaptiveStrategySnapshot {
  return { ...state };
}
