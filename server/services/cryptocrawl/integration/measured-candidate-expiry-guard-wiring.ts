import logger from '../../../logger.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
  type MeasuredCandidateStatus,
} from '../discovery/measured-candidate-registry.js';

let installed = false;

const PROMOTION_STATUSES = new Set<MeasuredCandidateStatus>(['deterministic_positive', 'eligible']);

export function ensureMeasuredCandidateExpiryGuardWiring(): void {
  if (installed) return;
  installed = true;

  const target = measuredCandidateRegistry as typeof measuredCandidateRegistry & {
    updateStatus: (
      opportunityId: string,
      status: MeasuredCandidateStatus,
      patch?: Parameters<typeof measuredCandidateRegistry.updateStatus>[2],
    ) => MeasuredCandidate | null;
  };
  const originalUpdateStatus = target.updateStatus.bind(target);
  target.updateStatus = (opportunityId, status, patch) => {
    const current = measuredCandidateRegistry.get(opportunityId);
    if (current && PROMOTION_STATUSES.has(status) && current.expiresAt <= Date.now()) {
      logger.info('[MeasuredCandidateExpiryGuard] Expired evidence rejected before positive/eligible promotion', {
        component: 'MeasuredCandidateExpiryGuardWiring',
        opportunityId,
        requestedStatus: status,
        expiresAt: current.expiresAt,
        agePastExpiryMs: Math.max(0, Date.now() - current.expiresAt),
        executionAuthorityGranted: false,
      });
      return originalUpdateStatus(opportunityId, 'expired', {
        ...(patch || {}),
        provenance: [...(patch?.provenance || []), 'candidate_expiry_guard:promotion_rejected'],
        executionCapabilityReason: 'expired measured evidence cannot be promoted to execution eligibility',
      });
    }
    return originalUpdateStatus(opportunityId, status, patch);
  };

  logger.info('[MeasuredCandidateExpiryGuard] Freshness-bound candidate promotion installed', {
    component: 'MeasuredCandidateExpiryGuardWiring',
    guardedTransitions: [...PROMOTION_STATUSES],
    stalePromotionAllowed: false,
    executionAuthority: false,
  });
}
