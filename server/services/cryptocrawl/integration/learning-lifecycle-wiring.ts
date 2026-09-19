import logger from '../../../logger.js';
import { normalizeLegacySupabaseLearningEnvironment } from '../learning/supabase-compatibility.js';
import { isCryptoCrawlerDatabaseAccessAllowed } from '../runtime/manual-power-state.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { deepLearningStore } from '../learning/deep-learning-store.js';
import { instantLearningEngine } from '../learning/instant-learning-engine.js';
import type { ExecutionOutcomeObservation } from '../learning/execution-outcome.js';
import { recordSettlementProfitCalibration } from '../learning/settlement-profit-calibrator.js';
import { adaptiveTopologyOptimizer } from '../optimization/adaptive-topology-optimizer.js';
import {
  hydrateOverflowLearningState,
  persistOverflowLearningState,
} from './overflow-learning-persistence.js';

const installed = new WeakSet<object>();

type DeepLearningRuntime = {
  isInitialized: boolean;
  initialize: () => Promise<void>;
  activateSupabaseMirror: () => void;
  deactivateSupabaseMirror: () => void;
  stop: () => Promise<void>;
};

type InstantLearningRuntime = {
  state: { isInitialized: boolean };
  initialize: () => Promise<void>;
  activateSupabaseMirror: () => void;
  deactivateSupabaseMirror: () => void;
  recordExecutionOutcome: (outcome: ExecutionOutcomeObservation) => Promise<unknown>;
};

export function ensureLearningLifecycleWiring(): void {
  if (!isCryptoCrawlerDatabaseAccessAllowed()) {
    throw new Error('CRYPTOCRAWLER_MASTER_POWER_OFF');
  }

  normalizeLegacySupabaseLearningEnvironment();
  const deep = deepLearningStore as unknown as DeepLearningRuntime;
  const instant = instantLearningEngine as unknown as InstantLearningRuntime;
  deep.activateSupabaseMirror();
  instant.activateSupabaseMirror();

  if (installed.has(deepLearningStore)) return;
  installed.add(deepLearningStore);
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
    await hydrateOverflowLearningState();
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
    await hydrateOverflowLearningState();
    await instantInitialize();
  };

  instant.recordExecutionOutcome = async (outcome: ExecutionOutcomeObservation): Promise<unknown> => {
    const result = await instantRecordExecutionOutcome(outcome);
    // Optimization and calibration consume only terminal realized outcomes. Both
    // are downstream of the canonical learning write and cannot rewrite or grant
    // execution authority.
    adaptiveTopologyOptimizer.recordTerminalOutcome(outcome);
    recordSettlementProfitCalibration(outcome);
    if (getCryptocrawlGovernance().isLongTermMemoryAllowed()) {
      await persistOverflowLearningState();
    }
    return result;
  };

  logger.info('Stage-aware learning lifecycle wiring installed', {
    component: 'LearningLifecycleWiring',
    stagesOneToThree: 'bounded_runtime_feedback_only',
    stageFourPlus: 'overflow_runtime_database_hydration_plus_legacy_optional_store',
    measuredOutcomePersistence: 'overflow_runtime_database',
    directPrimaryIoAuthority: false,
    primaryFallbackAuthority: false,
    legacySupabaseMirrorEnvironmentNormalizedBeforeStoreImport: true,
    adaptiveTopologyFeedback: 'terminal_realized_bps_only',
    settlementProfitCalibration: 'terminal_confirmed_expected_vs_realized_only',
    settlementCalibrationExecutionAuthority: false,
    adaptiveTopologyExecutionAuthority: false,
  });
}


export async function stopLearningLifecycleWiring(): Promise<void> {
  const deep = deepLearningStore as unknown as DeepLearningRuntime;
  const instant = instantLearningEngine as unknown as InstantLearningRuntime;
  // STOPPING is a no-new-I/O phase. Do not perform a final Supabase persistence
  // write while shutting down; detach the mirrors immediately.
  deep.deactivateSupabaseMirror();
  instant.deactivateSupabaseMirror();
}
