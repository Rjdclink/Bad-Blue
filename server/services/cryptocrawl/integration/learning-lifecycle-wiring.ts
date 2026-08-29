import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { deepLearningStore } from '../learning/deep-learning-store.js';
import { instantLearningEngine } from '../learning/instant-learning-engine.js';
import type { ExecutionOutcomeObservation } from '../learning/execution-outcome.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import { hydratePrimaryLearningState, persistPrimaryLearningState } from './primary-learning-persistence.js';

const installed = new WeakSet<object>();

type DeepLearningRuntime = {
  isInitialized: boolean;
  initialize: () => Promise<void>;
};

type InstantLearningRuntime = {
  state: { isInitialized: boolean };
  initialize: () => Promise<void>;
  recordExecutionOutcome: (outcome: ExecutionOutcomeObservation) => Promise<unknown>;
};

export function ensureLearningLifecycleWiring(): void {
  if (installed.has(deepLearningStore)) return;
  installed.add(deepLearningStore);

  const deep = deepLearningStore as unknown as DeepLearningRuntime;
  const instant = instantLearningEngine as unknown as InstantLearningRuntime;
  const deepInitialize = deep.initialize.bind(deep);
  const instantInitialize = instant.initialize.bind(instant);
  const instantRecordExecutionOutcome = instant.recordExecutionOutcome.bind(instant);

  deep.initialize = async (): Promise<void> => {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) {
      deep.isInitialized = false;
      logger.info('Deep Learning Store deferred by governance', {
        component: 'LearningLifecycleWiring',
        stage: getCryptocrawlGovernance().getState().stage,
      });
      return;
    }
    await hydratePrimaryLearningState();
    await deepInitialize();
  };

  instant.initialize = async (): Promise<void> => {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) {
      instant.state.isInitialized = false;
      logger.info('Instant Learning initialization deferred by governance', {
        component: 'LearningLifecycleWiring',
        stage: getCryptocrawlGovernance().getState().stage,
      });
      return;
    }
    await hydratePrimaryLearningState();
    await instantInitialize();
  };

  instant.recordExecutionOutcome = async (outcome: ExecutionOutcomeObservation): Promise<unknown> => {
    const result = await instantRecordExecutionOutcome(outcome);
    // Optimization consumes only terminal realized outcomes. It is intentionally
    // downstream of the canonical learning write so it can never authorize or
    // rewrite an execution result.
    adaptiveTopologyOptimizer.recordTerminalOutcome(outcome);
    if (getCryptocrawlGovernance().isLongTermMemoryAllowed()) {
      await persistPrimaryLearningState();
    }
    return result;
  };

  logger.info('Stage-aware learning lifecycle wiring installed', {
    component: 'LearningLifecycleWiring',
    stagesOneToThree: 'bounded_runtime_feedback_only',
    stageFourPlus: 'primary_postgresql_hydration_plus_legacy_optional_store',
    measuredOutcomePersistence: 'primary_postgresql',
    adaptiveTopologyFeedback: 'terminal_realized_bps_only',
    adaptiveTopologyExecutionAuthority: false,
  });
}
