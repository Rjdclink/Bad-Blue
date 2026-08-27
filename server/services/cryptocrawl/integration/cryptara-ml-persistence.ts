import logger from '../../../logger.js';
import { opportunityMlRanker, type OpportunityMlRankerState } from '../../cryptara/opportunity-ml-ranker.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { RuntimeJsonStateStore } from './runtime-json-state-store.js';

const store = new RuntimeJsonStateStore<OpportunityMlRankerState>('cryptara_ml_ranker');
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTail: Promise<void> = Promise.resolve();

export function ensureCryptaraMlRankerHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return Promise.resolve();
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const current = opportunityMlRanker.exportState();
      const state = await store.load();
      if (current.sampleCount > 0) {
        // Stage 1-3 may legitimately accumulate bounded in-process observations.
        // When Stage 4 first enables durable memory, never overwrite those fresher
        // observations with an older persisted model from a prior process.
        await store.save(current);
        hydrated = true;
        logger.info('Cryptara ML ranker promoted current measured state to durable memory', {
          component: 'CryptaraMlPersistence',
          sampleCount: current.sampleCount,
        });
        return;
      }
      if (!state) {
        await store.save(current);
        hydrated = true;
        logger.info('Cryptara ML ranker persistence initialized', {
          component: 'CryptaraMlPersistence',
          sampleCount: current.sampleCount,
        });
        return;
      }
      const restored = opportunityMlRanker.importState(state);
      hydrated = restored;
      logger.info('Cryptara ML ranker persistence restored', {
        component: 'CryptaraMlPersistence',
        restored,
        sampleCount: opportunityMlRanker.getState().sampleCount,
      });
    } catch (error) {
      logger.warn('Cryptara ML ranker persistence unavailable; continuing with bounded in-memory state', {
        component: 'CryptaraMlPersistence',
        error: error instanceof Error ? error.message : String(error),
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
  const write = persistTail
    .catch(() => undefined)
    .then(() => store.save(state));
  persistTail = write;
  try {
    await write;
  } catch (error) {
    logger.warn('Cryptara ML ranker state persistence failed', {
      component: 'CryptaraMlPersistence',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
