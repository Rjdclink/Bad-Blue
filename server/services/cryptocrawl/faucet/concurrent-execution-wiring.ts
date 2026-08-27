import logger from '../../../logger.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { autonomousFaucet } from './autonomous-faucet.js';

const installed = new WeakSet<object>();

type FaucetRuntime = {
  state: {
    executionMode: 'disabled' | 'live';
    lastArbitrageDecision: 'EXECUTE' | 'PENDING' | 'SKIP' | 'ERROR' | 'NONE';
  };
  executeWithStealth: () => Promise<void>;
};

/**
 * Compatibility bridge for the legacy faucet state machine.
 *
 * Execution authority is no longer a faucet-local hourly/day/window counter or a
 * coarse process-wide concurrency integer. The canonical execution scheduler owns
 * admission from measured eligible opportunities and obtains distributed resource,
 * venue, nonce, inventory-domain, settlement, and opportunity-idempotency leases.
 *
 * Scheduler lifecycle is owned by CryptoCoreRuntime. This bridge only delegates
 * the faucet's compatibility dispatch method; it does not start or stop the
 * scheduler itself.
 */
export function ensureConcurrentExecutionWiring(): void {
  const target = autonomousFaucet as unknown as FaucetRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  target.executeWithStealth = async (): Promise<void> => {
    if (target.state.executionMode !== 'live') {
      target.state.lastArbitrageDecision = 'SKIP';
      return;
    }

    const before = canonicalExecutionScheduler.getStats();
    await canonicalExecutionScheduler.dispatchOnce();
    const after = canonicalExecutionScheduler.getStats();

    target.state.lastArbitrageDecision = after.settled > before.settled
      ? 'EXECUTE'
      : after.pending > before.pending
        ? 'PENDING'
        : after.failed > before.failed
          ? 'ERROR'
          : 'SKIP';
  };

  logger.info('[FAUCET] Canonical execution scheduler wiring installed', {
    component: 'ConcurrentExecutionWiring',
    authority: 'canonical_resource_leased_scheduler',
    lifecycleOwner: 'CryptoCoreRuntime',
    legacyBusinessCapsAuthoritative: false,
    coarseGlobalConcurrencyCapAuthoritative: false,
    distributedOpportunityIdempotency: true,
    distributedResourceLeases: true,
    settlementSemantics: 'terminal_realized_only',
    scheduler: canonicalExecutionScheduler.getStats(),
  });
}
