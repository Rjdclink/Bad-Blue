import logger from '../../../logger.js';
import {
  measuredCandidateRegistry,
  type MeasuredCandidate,
  type MeasuredCandidateStatus,
} from '../discovery/measured-candidate-registry.js';

let installed = false;

const PROMOTION_STATUSES = new Set<MeasuredCandidateStatus>(['deterministic_positive', 'eligible']);
const MAX_RECENT_SCAN = 4096;

function isFreshCandidate(candidate: MeasuredCandidate, now: number): boolean {
  return candidate.expiresAt > now && candidate.status !== 'expired';
}

export function ensureMeasuredCandidateExpiryGuardWiring(): void {
  if (installed) return;
  installed = true;

  const target = measuredCandidateRegistry as typeof measuredCandidateRegistry & {
    get: (opportunityId: string) => MeasuredCandidate | null;
    getRecent: (limit?: number) => MeasuredCandidate[];
    updateStatus: (
      opportunityId: string,
      status: MeasuredCandidateStatus,
      patch?: Parameters<typeof measuredCandidateRegistry.updateStatus>[2],
    ) => MeasuredCandidate | null;
  };
  const originalGet = target.get.bind(target);
  const originalGetRecent = target.getRecent.bind(target);
  const originalUpdateStatus = target.updateStatus.bind(target);

  target.get = (opportunityId: string) => {
    const candidate = originalGet(opportunityId);
    if (!candidate) return null;
    if (candidate.expiresAt <= Date.now() && candidate.status !== 'expired') {
      return { ...candidate, status: 'expired' };
    }
    return candidate;
  };

  target.getRecent = (limit = 256) => {
    const boundedLimit = Math.max(1, Math.min(MAX_RECENT_SCAN, Math.trunc(Number(limit) || 256)));
    const now = Date.now();
    return originalGetRecent(MAX_RECENT_SCAN)
      .filter(candidate => isFreshCandidate(candidate, now))
      .slice(0, boundedLimit);
  };

  target.updateStatus = (opportunityId, status, patch) => {
    const current = originalGet(opportunityId);
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

  logger.info('[MeasuredCandidateExpiryGuard] Freshness-bound candidate promotion and read filtering installed', {
    component: 'MeasuredCandidateExpiryGuardWiring',
    guardedTransitions: [...PROMOTION_STATUSES],
    stalePromotionAllowed: false,
    staleRecentReadAllowed: false,
    freshnessAuthority: 'candidate_expires_at',
    executionAuthority: false,
  });
}
