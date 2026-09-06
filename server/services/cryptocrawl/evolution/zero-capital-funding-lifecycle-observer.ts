import { getCryptaraZeroInitialCapitalFundingLearning, type ZeroCapitalFundingObservationOutcome, type ZeroCapitalFundingObservationStage } from '../../cryptara/zero-capital-funding-learning.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';

let installed = false;
const lastFingerprint = new Map<string, string>();
const MAX_FINGERPRINTS = 4096;

function providerFrom(candidate: MeasuredCandidate): string {
  for (const entry of candidate.provenance) {
    const match = /^flash_loan_provider:([^\s]+)$/i.exec(entry.trim());
    if (match?.[1]) return match[1].toLowerCase();
  }
  if (candidate.provenance.some(entry => entry.includes('aave_balancer_dual'))) return 'aave_balancer_dual';
  return 'unresolved';
}

function estimatedCostUsd(candidate: MeasuredCandidate): number | undefined {
  const direct = candidate.economics.feeUsd;
  const gas = candidate.economics.gasUsd;
  const bridge = candidate.economics.bridgeUsd;
  const known = [direct, gas, bridge].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (known.length > 0) return Math.max(0, known.reduce((sum, value) => sum + value, 0));
  const notional = candidate.canonicalBps.notionalUsd;
  const allIn = candidate.canonicalBps.allInCostBps;
  if (typeof notional === 'number' && Number.isFinite(notional) && notional > 0 && typeof allIn === 'number' && Number.isFinite(allIn)) {
    return Math.max(0, allIn / 10_000 * notional);
  }
  return undefined;
}

function classify(candidate: MeasuredCandidate): { stage: ZeroCapitalFundingObservationStage; outcome: ZeroCapitalFundingObservationOutcome } {
  if (candidate.status === 'eligible' && candidate.executableCapability === true) {
    return { stage: 'prepare', outcome: 'success' };
  }
  if (candidate.status === 'expired' || candidate.expiresAt <= Date.now()) {
    return { stage: 'probe', outcome: 'stale' };
  }
  if (candidate.missingInformation.includes('fresh_quote_after_provider_receiver_permissions')) {
    return { stage: 'prepare', outcome: 'stale' };
  }
  if (candidate.missingInformation.some(item => item.includes('receiver') || item.includes('permission'))) {
    return { stage: 'prepare', outcome: 'unavailable' };
  }
  if (candidate.missingInformation.some(item => item.includes('flash_loan_provider') || item.includes('flash_loan'))) {
    return { stage: 'probe', outcome: 'unavailable' };
  }
  if (candidate.status === 'blocked') {
    return { stage: 'probe', outcome: 'rejected' };
  }
  return { stage: 'probe', outcome: 'success' };
}

function pruneFingerprints(): void {
  if (lastFingerprint.size <= MAX_FINGERPRINTS) return;
  const remove = lastFingerprint.size - MAX_FINGERPRINTS;
  for (const key of lastFingerprint.keys()) {
    lastFingerprint.delete(key);
    if (lastFingerprint.size <= MAX_FINGERPRINTS || lastFingerprint.size <= remove) break;
  }
}

function observe(candidate: MeasuredCandidate): void {
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return;
  const chain = candidate.chains[0]?.trim().toLowerCase();
  if (!chain) return;
  const provider = providerFrom(candidate);
  const classification = classify(candidate);
  const fingerprint = [
    candidate.updatedAt,
    candidate.status,
    candidate.executableCapability ? '1' : '0',
    provider,
    classification.stage,
    classification.outcome,
    candidate.executionCapabilityReason,
    candidate.missingInformation.join('|'),
  ].join(':');
  if (lastFingerprint.get(candidate.opportunityId) === fingerprint) return;
  lastFingerprint.set(candidate.opportunityId, fingerprint);
  pruneFingerprints();

  const deterministicNetProfitUsd = candidate.economics.deterministicNetProfitUsd;
  getCryptaraZeroInitialCapitalFundingLearning().record({
    opportunityId: candidate.opportunityId,
    chain,
    strategy: candidate.topology,
    laneId: `${chain}:${provider}`,
    provider,
    stage: classification.stage,
    outcome: classification.outcome,
    latencyMs: Math.max(0, candidate.updatedAt - candidate.observedAt),
    retryOrdinal: 0,
    redundancyDepth: provider === 'aave_balancer_dual' ? 2 : provider === 'unresolved' ? 0 : 1,
    estimatedCostUsd: estimatedCostUsd(candidate),
    guaranteedResidualProfitUsd:
      typeof deterministicNetProfitUsd === 'number' && Number.isFinite(deterministicNetProfitUsd) && deterministicNetProfitUsd > 0
        ? deterministicNetProfitUsd
        : undefined,
    observedAt: candidate.updatedAt,
    reason: candidate.executionCapabilityReason,
  });
}

/**
 * Installs a read-only observation bridge from the canonical measured-candidate
 * registry into zero-capital funding learning. It never changes candidate state,
 * provider selection, scheduling, economics or execution authority.
 */
export function ensureZeroCapitalFundingLifecycleObserver(): void {
  if (installed) return;
  installed = true;
  measuredCandidateRegistry.onUpdate(observe);
  for (const candidate of measuredCandidateRegistry.getRecent(512)) observe(candidate);
}

export const zeroCapitalFundingLifecycleObserverAuthority = Object.freeze({
  executionAuthority: false as const,
  settlementAuthority: false as const,
  canonicalEconomicsAuthority: false as const,
  candidateMutationAuthority: false as const,
  source: 'canonical_measured_candidate_updates' as const,
});
