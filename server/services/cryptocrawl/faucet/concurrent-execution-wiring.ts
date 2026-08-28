import logger from '../../../logger.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';

let installed = false;

/**
 * Compatibility entry point retained for older bootstrap callers.
 *
 * The historical implementation monkey-patched private fields and decision methods
 * on AutonomousFaucet. That state machine has been retired. Execution admission is
 * now owned directly by canonicalExecutionScheduler and its governed/resource-leased
 * executors, so there is nothing to patch.
 */
export function ensureConcurrentExecutionWiring(): void {
  if (installed) return;
  installed = true;
  logger.info('[CryptoCrawler] Legacy faucet concurrency patch retired', {
    component: 'ConcurrentExecutionWiring',
    executionAuthority: 'canonical_execution_scheduler',
    lifecycleOwner: 'CryptoCoreRuntime',
    legacyFaucetMonkeyPatch: false,
    scheduler: canonicalExecutionScheduler.getStats(),
  });
}
