import logger from '../../../logger.js';
import { deepLearningStore } from '../learning/deep-learning-store.js';
import { instantLearningEngine } from '../learning/instant-learning-engine.js';
import { getExecutionOutcomeKey, type ExecutionOutcomeObservation } from '../learning/execution-outcome.js';
import { RuntimeJsonStateStore } from './runtime-json-state-store.js';

interface PrimaryLearningSnapshot {
  version: 1;
  deep: {
    learnedParameters: Array<[string, unknown]>;
    strategyPerformance: Array<[string, unknown[]]>;
    failedStrategies: Array<[string, unknown]>;
    evolutionHistory: unknown[];
    adaptiveThresholds: Array<[string, unknown]>;
    totalSimulations: number;
    lastLearningCycle: number;
    executionOutcomes: ExecutionOutcomeObservation[];
  };
  instant: {
    simulationsSinceLastPersist: number;
    currentOptimalParams: Array<[string, unknown]>;
    realtimeMetrics: Record<string, unknown>;
    lastAppliedParams: number;
  };
  updatedAt: number;
}

const store = new RuntimeJsonStateStore<PrimaryLearningSnapshot>('cryptocrawl_learning_state');
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();

type DeepRuntime = {
  state: {
    learnedParameters: Map<string, unknown>;
    strategyPerformance: Map<string, unknown[]>;
    failedStrategies: Map<string, unknown>;
    evolutionHistory: unknown[];
    adaptiveThresholds: Map<string, unknown>;
    totalSimulations: number;
    lastLearningCycle: number;
  };
  executionOutcomes: ExecutionOutcomeObservation[];
  executionOutcomeKeys: Set<string>;
};

type InstantRuntime = {
  state: {
    simulationsSinceLastPersist: number;
    currentOptimalParams: Map<string, unknown>;
    realtimeMetrics: Record<string, unknown>;
    lastAppliedParams: number;
  };
};

function snapshot(): PrimaryLearningSnapshot {
  const deep = deepLearningStore as unknown as DeepRuntime;
  const instant = instantLearningEngine as unknown as InstantRuntime;
  return {
    version: 1,
    deep: {
      learnedParameters: [...deep.state.learnedParameters.entries()],
      strategyPerformance: [...deep.state.strategyPerformance.entries()],
      failedStrategies: [...deep.state.failedStrategies.entries()],
      evolutionHistory: [...deep.state.evolutionHistory],
      adaptiveThresholds: [...deep.state.adaptiveThresholds.entries()],
      totalSimulations: deep.state.totalSimulations,
      lastLearningCycle: deep.state.lastLearningCycle,
      executionOutcomes: deep.executionOutcomes.map(outcome => ({
        ...outcome,
        provenance: [...outcome.provenance],
        settlement: outcome.settlement ? {
          ...outcome.settlement,
          receipts: outcome.settlement.receipts.map(receipt => ({ ...receipt })),
          provenance: [...outcome.settlement.provenance],
        } : undefined,
        prediction: outcome.prediction ? { ...outcome.prediction } : undefined,
      })),
    },
    instant: {
      simulationsSinceLastPersist: instant.state.simulationsSinceLastPersist,
      currentOptimalParams: [...instant.state.currentOptimalParams.entries()],
      realtimeMetrics: { ...instant.state.realtimeMetrics },
      lastAppliedParams: instant.state.lastAppliedParams,
    },
    updatedAt: Date.now(),
  };
}

function validExecutionOutcome(input: unknown): input is ExecutionOutcomeObservation {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<ExecutionOutcomeObservation>;
  return typeof value.eventId === 'string' && value.eventId.length > 0 &&
    typeof value.chain === 'string' && typeof value.symbol === 'string' &&
    typeof value.strategy === 'string' && typeof value.success === 'boolean' &&
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) &&
    Array.isArray(value.provenance);
}

function valid(input: PrimaryLearningSnapshot | null): input is PrimaryLearningSnapshot {
  return !!input && input.version === 1 && !!input.deep && !!input.instant &&
    Array.isArray(input.deep.learnedParameters) &&
    Array.isArray(input.deep.strategyPerformance) &&
    Array.isArray(input.deep.failedStrategies) &&
    Array.isArray(input.deep.evolutionHistory) &&
    Array.isArray(input.deep.adaptiveThresholds) &&
    Array.isArray(input.deep.executionOutcomes) &&
    Array.isArray(input.instant.currentOptimalParams);
}

export function hydratePrimaryLearningState(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const persisted = await store.load();
      if (!valid(persisted)) {
        await store.save(snapshot());
        hydrated = true;
        return;
      }
      const deep = deepLearningStore as unknown as DeepRuntime;
      const instant = instantLearningEngine as unknown as InstantRuntime;
      deep.state.learnedParameters = new Map(persisted.deep.learnedParameters);
      deep.state.strategyPerformance = new Map(persisted.deep.strategyPerformance);
      deep.state.failedStrategies = new Map(persisted.deep.failedStrategies);
      deep.state.evolutionHistory = persisted.deep.evolutionHistory.slice(-500);
      deep.state.adaptiveThresholds = new Map(persisted.deep.adaptiveThresholds);
      deep.state.totalSimulations = Number.isFinite(persisted.deep.totalSimulations) ? persisted.deep.totalSimulations : 0;
      deep.state.lastLearningCycle = Number.isFinite(persisted.deep.lastLearningCycle) ? persisted.deep.lastLearningCycle : Date.now();
      deep.executionOutcomes = persisted.deep.executionOutcomes.filter(validExecutionOutcome).slice(-500).map(outcome => ({
        ...outcome,
        provenance: [...outcome.provenance],
        settlement: outcome.settlement ? {
          ...outcome.settlement,
          receipts: Array.isArray(outcome.settlement.receipts) ? outcome.settlement.receipts.map(receipt => ({ ...receipt })) : [],
          provenance: Array.isArray(outcome.settlement.provenance) ? [...outcome.settlement.provenance] : [],
        } : undefined,
        prediction: outcome.prediction ? { ...outcome.prediction } : undefined,
      }));
      deep.executionOutcomeKeys.clear();
      for (const outcome of deep.executionOutcomes) {
        deep.executionOutcomeKeys.add(getExecutionOutcomeKey(outcome));
      }
      instant.state.simulationsSinceLastPersist = Number.isFinite(persisted.instant.simulationsSinceLastPersist)
        ? persisted.instant.simulationsSinceLastPersist : 0;
      instant.state.currentOptimalParams = new Map(persisted.instant.currentOptimalParams);
      instant.state.realtimeMetrics = { ...persisted.instant.realtimeMetrics };
      instant.state.lastAppliedParams = Number.isFinite(persisted.instant.lastAppliedParams) ? persisted.instant.lastAppliedParams : 0;
      hydrated = true;
      logger.info('Primary PostgreSQL learning snapshot restored', {
        component: 'PrimaryLearningPersistence',
        learnedParameters: deep.state.learnedParameters.size,
        strategyFamilies: deep.state.strategyPerformance.size,
        executionOutcomes: deep.executionOutcomes.length,
        dedupeKeys: deep.executionOutcomeKeys.size,
      });
    } catch (error) {
      logger.warn('Primary PostgreSQL learning snapshot unavailable', {
        component: 'PrimaryLearningPersistence',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export async function persistPrimaryLearningState(): Promise<void> {
  const current = snapshot();
  const write = persistTail.catch(() => undefined).then(() => store.save(current));
  persistTail = write;
  try {
    await write;
  } catch (error) {
    logger.warn('Primary PostgreSQL learning snapshot persistence failed', {
      component: 'PrimaryLearningPersistence',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
