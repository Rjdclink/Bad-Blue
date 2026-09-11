import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { dispatchKalshiAfterCexMiss } from '../execution/kalshi-post-cex-fallback.js';

let installed = false;
let wakeScheduled = false;
let inFlight: Promise<void> | null = null;

function globalLiveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

function freshCexExists(): boolean {
  const maxAgeMs = Math.max(250, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
  const now = Date.now();
  return canonicalOpportunityState.getRecent(128).some(row =>
    row.status === 'eligible'
      && row.plan
      && Number.isFinite(row.plan.netProfitUsd)
      && row.plan.netProfitUsd > 0
      && row.plan.quoteAgeMs <= maxAgeMs
      && now - row.observedAt <= maxAgeMs,
  );
}

async function runFallback(): Promise<void> {
  if (inFlight || !globalLiveExecutionEnabled() || freshCexExists()) return;
  inFlight = dispatchKalshiAfterCexMiss({ lifecycleMaintenance: Promise.resolve({ ok: true as const, error: null }) })
    .then(outcome => {
      if (outcome.submitted) {
        logger.info('[KalshiFallback] Canonical Kalshi opportunity submitted after CEX lane had no fresh candidate', {
          component: 'KalshiPostCexFallbackWiring',
          settlementConfirmed: outcome.settlementConfirmed,
          success: outcome.success,
          executionAuthority: 'kalshi_event_canonical_dispatch',
          duplicateSchedulerCreated: false,
        });
      }
    })
    .catch(error => logger.debug('[KalshiFallback] Event-driven fallback remained route-local', {
      component: 'KalshiPostCexFallbackWiring',
      error: error instanceof Error ? error.message : String(error),
      executionAuthorityChanged: false,
    }))
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureKalshiPostCexFallbackWiring(): void {
  if (installed) return;
  installed = true;
  measuredCandidateRegistry.onEligible(() => {
    if (wakeScheduled) return;
    wakeScheduled = true;
    queueMicrotask(() => {
      wakeScheduled = false;
      void runFallback();
    });
  });
  logger.info('[KalshiFallback] Event-driven Kalshi fallback wiring installed', {
    component: 'KalshiPostCexFallbackWiring',
    duplicateSchedulerCreated: false,
    freshCexPriorityPreserved: true,
  });
}
