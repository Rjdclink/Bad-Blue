import logger from '../../../logger.js';
import { ensureCanonicalCryptoCrawlerRuntimeWiring } from './canonical-runtime-wiring.js';

let compatibilityNoticeEmitted = false;

/**
 * @deprecated Compatibility shim for historical imports.
 *
 * The legacy MasterOrchestrator no longer owns CryptoCrawler runtime startup or
 * measured runtime authority. New code should import
 * ensureCanonicalCryptoCrawlerRuntimeWiring() directly.
 */
export function ensureMasterOrchestratorMeasuredWiring(): void {
  ensureCanonicalCryptoCrawlerRuntimeWiring();

  if (compatibilityNoticeEmitted) return;
  compatibilityNoticeEmitted = true;
  logger.info('Legacy MasterOrchestrator runtime-wiring shim invoked', {
    component: 'MasterOrchestratorMeasuredWiring',
    authority: 'compatibility_only',
    canonicalAuthority: 'CanonicalCryptoCrawlerRuntimeWiring',
    legacyMasterOrchestratorRequired: false,
  });
}
