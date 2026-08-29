import logger from '../../../logger.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { zeroCapitalResourceScheduler } from '../execution/zero-capital-resource-scheduler.js';

const installed = new WeakSet<object>();

type Runtime = {
  opportunityQueue: ZeroCapitalOpportunity[];
  state: { gasFundingDecisions: Array<{ chain?: string; mode?: string }> };
  dispatchExecutableOpportunities: () => Promise<void>;
};

function fundingMode(target: Runtime, opportunity: ZeroCapitalOpportunity): string {
  return target.state.gasFundingDecisions.find(item => item.chain === opportunity.chain)?.mode || 'native';
}

/**
 * Reorders already-positive, already-admitted zero-capital work by expected
 * profit per currently scarce execution resource and expiry urgency. This is a
 * scheduling objective only: it never subtracts a synthetic shadow price from
 * settlement economics and never changes admission, Cryptara, governance or
 * lease acquisition.
 */
export function ensureZeroCapitalShadowPriorityWiring(): void {
  const target = zeroCapitalEngine as unknown as Runtime;
  if (installed.has(target)) return;
  installed.add(target);
  const originalDispatch = target.dispatchExecutableOpportunities.bind(target);

  target.dispatchExecutableOpportunities = async (): Promise<void> => {
    if (target.opportunityQueue.length > 1) {
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
      logger.debug('[ZeroCapitalScheduler] Resource-shadow work ordering applied', {
        component: 'ZeroCapitalShadowPriorityWiring',
        queued: target.opportunityQueue.length,
        topPriority: top || null,
        schedulingAuthorityOnly: true,
        settlementEconomicsChanged: false,
        admissionChanged: false,
      });
    }
    return originalDispatch();
  };

  logger.info('[ZeroCapitalScheduler] Resource-shadow priority wiring installed', {
    component: 'ZeroCapitalShadowPriorityWiring',
    objective: 'expected_net_profit_per_scarcity_unit_with_expiry_urgency',
    settlementEconomicsChanged: false,
    cryptaraAuthorityChanged: false,
    governanceAuthorityChanged: false,
    resourceLeaseAuthorityChanged: false,
  });
}
