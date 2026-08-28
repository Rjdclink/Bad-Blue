import logger from '../../../logger.js';
import { opportunityMlRanker, type OpportunityMlRankerState } from '../../cryptara/opportunity-ml-ranker.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { recordModelMetric, registerModelCheckpoint } from '../intelligence/model-registry.js';
import { RuntimeJsonStateStore } from './runtime-json-state-store.js';

const store = new RuntimeJsonStateStore<OpportunityMlRankerState>('cryptara_ml_ranker');
const MODEL_ID = 'cryptara-opportunity-logistic-active';
const MODEL_KIND = 'opportunity_ranker';
const MODEL_VERSION = 'opportunity-logistic-v1';
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();

async function checkpointCurrentState(provenance: string[]): Promise<void> {
  const state = opportunityMlRanker.exportState();
  await registerModelCheckpoint({
    modelId: MODEL_ID,
    modelKind: MODEL_KIND,
    modelVersion: MODEL_VERSION,
    status: 'promoted',
    state,
    observedAt: Date.now(),
    provenance: [...provenance, 'typescript_native_inference', 'advisory_only'],
  });
  const weightL2 = Math.sqrt(state.weights.reduce((sum, weight) => sum + weight * weight, 0));
  const now = Date.now();
  await Promise.all([
    recordModelMetric({ modelId: MODEL_ID, metricName: 'sample_count', metricValue: state.sampleCount, evaluationScope: 'online_terminal_calibration', observedAt: now, provenance }, MODEL_VERSION),
    recordModelMetric({ modelId: MODEL_ID, metricName: 'weight_l2', metricValue: weightL2, evaluationScope: 'checkpoint', observedAt: now, provenance }, MODEL_VERSION),
    recordModelMetric({ modelId: MODEL_ID, metricName: 'bias', metricValue: state.bias, evaluationScope: 'checkpoint', observedAt: now, provenance }, MODEL_VERSION),
  ]);
}

export function ensureCryptaraMlRankerHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const current = opportunityMlRanker.exportState();
      const state = await store.load();
      if (current.sampleCount > 0) {
        await store.save(current);
        hydrated = true;
        await checkpointCurrentState(['promoted_current_measured_state']);
        logger.info('Cryptara ML ranker promoted current measured state to durable memory', {
          component: 'CryptaraMlPersistence', sampleCount: current.sampleCount, modelId: MODEL_ID, modelVersion: MODEL_VERSION,
        });
        return;
      }
      if (!state) {
        await store.save(current);
        hydrated = true;
        await checkpointCurrentState(['initialized_default_typescript_model']);
        logger.info('Cryptara ML ranker persistence initialized', {
          component: 'CryptaraMlPersistence', sampleCount: current.sampleCount, modelId: MODEL_ID, modelVersion: MODEL_VERSION,
        });
        return;
      }
      const restored = opportunityMlRanker.importState(state);
      hydrated = restored;
      if (restored) await checkpointCurrentState(['restored_export_import_checkpoint']);
      logger.info('Cryptara ML ranker persistence restored', {
        component: 'CryptaraMlPersistence', restored,
        sampleCount: opportunityMlRanker.getState().sampleCount,
        modelId: MODEL_ID, modelVersion: MODEL_VERSION,
      });
    } catch (error) {
      logger.warn('Cryptara ML ranker persistence unavailable; continuing with bounded in-memory state', {
        component: 'CryptaraMlPersistence', error: error instanceof Error ? error.message : String(error), executionBlocked: false,
      });
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export async function persistCryptaraMlRanker(): Promise<void> {
  if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return;
  const state = opportunityMlRanker.exportState();
  const write = persistTail.catch(() => undefined).then(async () => {
    await store.save(state);
    await checkpointCurrentState(['terminal_measured_online_calibration']);
  });
  persistTail = write;
  try {
    await write;
  } catch (error) {
    logger.warn('Cryptara ML ranker state persistence failed', {
      component: 'CryptaraMlPersistence', error: error instanceof Error ? error.message : String(error), executionBlocked: false,
    });
  }
}

export function getCryptaraMlModelIdentity() {
  return {
    modelId: MODEL_ID,
    modelKind: MODEL_KIND,
    modelVersion: MODEL_VERSION,
    inferenceRuntime: 'typescript' as const,
    advisoryOnly: true as const,
    executionAuthority: false as const,
  };
}
