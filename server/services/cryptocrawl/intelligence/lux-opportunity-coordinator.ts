import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { executionResourceScheduler } from '../execution/resource-scheduler.js';
import { predictiveCainPreparation } from './predictive-cain-preparation.js';

export type LuxLifecycle = 'predicted' | 'observed' | 'measured' | 'deterministic_positive' | 'assessed' | 'eligible' | 'leased' | 'executing' | 'terminal';
export interface LuxOpportunityProjection {
  opportunityId: string;
  lifecycle: LuxLifecycle;
  priority: number;
  predicted: boolean;
  executable: boolean;
  topology: string;
  updatedAt: number;
  ownershipHint: string | null;
  provenance: string[];
}

const executionHints = new Map<string, { lifecycle: 'leased'|'executing'|'terminal'; updatedAt: number; owner: string }>();

export function recordLuxExecutionProjection(opportunityId: string, lifecycle: 'leased'|'executing'|'terminal'): void {
  executionHints.set(opportunityId, { lifecycle, updatedAt: Date.now(), owner: executionResourceScheduler.getOwnerId() });
  if (executionHints.size > 4096) {
    const oldest = [...executionHints.entries()].sort((a,b)=>a[1].updatedAt-b[1].updatedAt);
    for (let index=0; index<oldest.length-4096; index++) executionHints.delete(oldest[index][0]);
  }
}

export function getLuxOpportunityQueue(limit = 256): LuxOpportunityProjection[] {
  const predictions = predictiveCainPreparation.getPreparationRecords(4096);
  const predictedByOpportunity = new Map(predictions.map(record => [record.opportunityId, record]));
  const verified = measuredCandidateRegistry.getRecent(4096);
  const rows: LuxOpportunityProjection[] = [];
  const seen = new Set<string>();

  for (const candidate of verified) {
    seen.add(candidate.opportunityId);
    const hint = executionHints.get(candidate.opportunityId);
    const lifecycle: LuxLifecycle = hint?.lifecycle
      || (candidate.status === 'eligible' ? 'eligible'
        : candidate.status === 'deterministic_positive' ? 'deterministic_positive'
        : candidate.status === 'enriched' ? 'measured'
        : candidate.status === 'observed' ? 'observed'
        : candidate.status === 'blocked' || candidate.status === 'expired' ? 'terminal'
        : 'observed');
    const prediction = predictedByOpportunity.get(candidate.opportunityId);
    const net = candidate.economics.deterministicNetProfitUsd ?? 0;
    const freshness = candidate.quoteAgeMs === null ? 0 : Math.max(0, 1 - candidate.quoteAgeMs / Math.max(1, candidate.expiresAt-candidate.observedAt));
    rows.push({
      opportunityId:candidate.opportunityId, lifecycle,
      priority: Math.max(0, net) + freshness + (prediction?.probability || 0),
      predicted:Boolean(prediction), executable:candidate.status==='eligible' && candidate.executableCapability,
      topology:candidate.topology, updatedAt:Math.max(candidate.updatedAt,hint?.updatedAt||0),
      ownershipHint:hint?.owner||null,
      provenance:[...new Set([...candidate.provenance,'lux_canonical_projection','priority_does_not_change_eligibility'])],
    });
  }
  for (const prediction of predictions) {
    if (seen.has(prediction.opportunityId)) continue;
    rows.push({ opportunityId:prediction.opportunityId,lifecycle:'predicted',priority:prediction.probability,predicted:true,executable:false,
      topology:prediction.topology,updatedAt:prediction.observedAt,ownershipHint:null,
      provenance:[...prediction.provenance,'predicted_distinct_from_verified'] });
  }
  return rows.sort((a,b)=>b.priority-a.priority||b.updatedAt-a.updatedAt).slice(0,Math.max(1,Math.min(4096,limit)));
}

export function getLuxCoordinationHealth() {
  return {
    queueDepth:getLuxOpportunityQueue(4096).length,
    executionHints:executionHints.size,
    scheduler:canonicalExecutionScheduler.getStats(),
    resourceOwner:executionResourceScheduler.getOwnerId(),
    candidateAuthority:'measured_candidate_registry' as const,
    claimAuthority:'execution_resource_scheduler' as const,
    executionAuthority:'canonical_execution_scheduler' as const,
    priorityChangesEligibility:false as const,
    processLocalClaimsAuthoritative:false as const,
  };
}
