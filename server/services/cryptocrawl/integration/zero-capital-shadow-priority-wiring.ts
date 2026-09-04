import logger from '../../../logger.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { zeroCapitalResourceScheduler } from '../execution/zero-capital-resource-scheduler.js';
import { orderZeroCapitalOpportunitiesWithNixGen } from '../optimization/nix-gen/zero-capital-ordering.js';

const installed = new WeakSet<object>();

type Runtime = {
  opportunityQueue: ZeroCapitalOpportunity[];
  state: {
    gasFundingDecisions: Array<{ chain?: string; mode?: string }>;
    maxConcurrentExecutions?: number;
  };
  dispatchExecutableOpportunities: () => Promise<void>;
};

function fundingMode(target: Runtime, opportunity: ZeroCapitalOpportunity): 'sponsored' | 'native' {
  return target.state.gasFundingDecisions.find(item => item.chain === opportunity.chain)?.mode === 'sponsored'
    ? 'sponsored'
    : 'native';
}

function applyPreviousResourceShadowOrdering(target: Runtime): void {
  const now = Date.now();
  const scored = new Map(target.opportunityQueue.map(opportunity => [
    opportunity.id,
    zeroCapitalResourceScheduler.scoreOpportunity(opportunity, fundingMode(target, opportunity), now),
  ]));
  target.opportunityQueue.sort((left, right) => {
    const leftScore = scored.get(left.id)?.priorityScore ?? 0;
    const rightScore = scored.get(right.id)?.priorityScore ?? 0;
    if (rightScore !== leftScore) return rightScore - leftScore;
    if (left.expectedProfit === right.expectedProfit) return left.expiresAt - right.expiresAt;
    return left.expectedProfit > right.expectedProfit ? -1 : 1;
  });
  const top = target.opportunityQueue[0] ? scored.get(target.opportunityQueue[0].id) : null;
  logger.debug('[ZeroCapitalScheduler] Resource-shadow fallback ordering applied', {
    component: 'ZeroCapitalShadowPriorityWiring',
    queued: target.opportunityQueue.length,
    topPriority: top || null,
    schedulingAuthorityOnly: true,
    settlementEconomicsChanged: false,
    admissionChanged: false,
  });
}

/**
 * Reorders already-positive, already-admitted zero-capital work. Nix-Gen is the
 * preferred advisory portfolio ordering; the previous resource-shadow scorer is
 * retained as an exact fail-open fallback. Neither path changes admission,
 * Cryptara, governance, lease acquisition, execution, or settlement authority.
 */
export function ensureZeroCapitalShadowPriorityWiring(): void {
  const target = zeroCapitalEngine as unknown as Runtime;
  if (installed.has(target)) return;
  installed.add(target);
  const originalDispatch = target.dispatchExecutableOpportunities.bind(target);

  target.dispatchExecutableOpportunities = async (): Promise<void> => {
    if (target.opportunityQueue.length > 1) {
      const nix = orderZeroCapitalOpportunitiesWithNixGen({
        opportunities: target.opportunityQueue,
        now: Date.now(),
        dispatchCapacity: Math.max(1, Number(target.state.maxConcurrentExecutions) || 1),
        fundingModeForOpportunity: opportunity => fundingMode(target, opportunity),
      });
      if (nix.error) {
        logger.warn('[ZeroCapitalScheduler] Nix-Gen zero-capital ordering failed open', {
          component: 'ZeroCapitalShadowPriorityWiring',
          error: nix.error,
          admissionChanged: false,
          executionAuthorityChanged: false,
        });
      }
      if (nix.applied) {
        target.opportunityQueue.splice(0, target.opportunityQueue.length, ...nix.opportunities);
        logger.debug('[ZeroCapitalScheduler] Nix-Gen zero-capital ordering applied', {
          component: 'ZeroCapitalShadowPriorityWiring',
          queued: target.opportunityQueue.length,
          preparedCount: nix.preparedCount,
          schedulingAuthorityOnly: true,
          settlementEconomicsChanged: false,
          admissionChanged: false,
        });
      } else {
        applyPreviousResourceShadowOrdering(target);
      }
    }
    return originalDispatch();
  };

  logger.info('[ZeroCapitalScheduler] Nix-Gen zero-capital priority wiring installed', {
    component: 'ZeroCapitalShadowPriorityWiring',
    primaryObjective: 'nix_gen_global_resource_allocation',
    fallbackObjective: 'expected_net_profit_per_scarcity_unit_with_expiry_urgency',
    settlementEconomicsChanged: false,
    cryptaraAuthorityChanged: false,
    governanceAuthorityChanged: false,
    resourceLeaseAuthorityChanged: false,
    executionAuthorityChanged: false,
  });
}
