import logger from '../../../logger.js';
import { getZeroInitialCapitalDynamicOrchestrator } from '../capital-free/zero-initial-capital-dynamic-orchestrator.js';

const installed = new WeakSet<object>();

/**
 * Strict cold-start policy for the user's Zero Initial Capital requirement.
 *
 * Ordinary hosted sponsorship can still create a bill for the application owner.
 * That is useful infrastructure, but it is not strict zero-operator-cost funding.
 * The dynamic executor keeps that legacy lane defined for backward compatibility;
 * this admission wrapper removes it from the strict cold-start candidate set.
 *
 * Opportunity-backed ERC20 postOp funding remains eligible because its provider
 * charge is bounded and paid from execution-created token output. Proven
 * system-native gas remains eligible only after the capital provenance layer has
 * established SELF_FUNDED ownership.
 */
export function ensureStrictZeroInitialCapitalPolicyWiring(): void {
  const orchestrator = getZeroInitialCapitalDynamicOrchestrator() as any;
  if (installed.has(orchestrator)) return;
  installed.add(orchestrator);

  const originalRun = orchestrator.run.bind(orchestrator);
  orchestrator.run = async (input: any) => {
    const strict = process.env.ZERO_INITIAL_CAPITAL_STRICT_OPERATOR_ZERO_COST?.trim().toLowerCase() !== 'false';
    if (!strict) return originalRun(input);

    const originalLanes = Array.isArray(input?.lanes) ? input.lanes : [];
    const admittedLanes = originalLanes.filter((lane: any) => {
      const id = String(lane?.id || '').toLowerCase();
      // Current ordinary Alchemy sponsorship can be policy/budget billed to the
      // application. It therefore cannot prove zero operator monetary input.
      if (id.includes('external-sponsor')) return false;
      if (id.includes('operator-billed')) return false;
      return true;
    });

    const excluded = originalLanes.length - admittedLanes.length;
    if (excluded > 0) {
      logger.debug('[ZeroInitialCapital] Operator-billed sponsorship excluded from strict cold-start admission', {
        component: 'StrictZeroInitialCapitalPolicyWiring',
        opportunityId: input?.opportunityId,
        chain: input?.chain,
        excludedLaneCount: excluded,
        admittedLaneIds: admittedLanes.map((lane: any) => lane.id),
        opportunityBackedPostOpEligible: true,
        provenSystemNativeEligibleAfterSelfFunded: true,
        ordinaryHostedSponsorBillingAuthority: false,
        operatorPrincipalRequired: false,
        operatorNativeGasRequired: false,
        executionAuthority: false,
      });
    }

    return originalRun({ ...input, lanes: admittedLanes });
  };

  logger.info('[ZeroInitialCapital] Strict zero-operator-cost funding admission installed', {
    component: 'StrictZeroInitialCapitalPolicyWiring',
    strictByDefault: true,
    ordinaryOperatorBilledSponsorshipColdStartEligible: false,
    opportunityBackedErc20PostOpColdStartEligible: true,
    provenSystemNativeAfterSelfFundedEligible: true,
    executionAuthority: false,
    globalHaltAuthority: false,
  });
}
