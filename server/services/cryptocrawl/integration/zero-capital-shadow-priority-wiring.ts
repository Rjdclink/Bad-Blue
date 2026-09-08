import logger from '../../../logger.js';

let installed = false;

/**
 * Compatibility lifecycle hook only.
 *
 * ZERO_CAPITAL_ATOMIC ordering and dispatch are owned by the canonical parent
 * scheduler. Runtime reassignment of the zero-capital engine dispatch method is
 * deliberately forbidden: advisory optimizers publish scheduling evidence to
 * their canonical registries and never wrap or replace an executor/scheduler.
 */
export function ensureZeroCapitalShadowPriorityWiring(): void {
  if (installed) return;
  installed = true;

  logger.info('[ZeroCapitalScheduler] Legacy shadow dispatch wrapper retired', {
    component: 'ZeroCapitalShadowPriorityWiring',
    schedulingAuthority: 'CanonicalExecutionScheduler',
    executionAuthority: 'CanonicalZeroCapitalExecutor',
    runtimeMethodMutation: false,
    dispatchMutation: false,
    advisoryOrderingAuthority: false,
    executionAuthorityChanged: false,
  });
}
