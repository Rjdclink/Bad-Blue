export type MeasuredOpportunityTopology =
  | 'CEX_CEX'
  | 'DEX_ATOMIC'
  | 'ZERO_CAPITAL_ATOMIC'
  | 'CROSS_CHAIN'
  | 'MEMPOOL_BACKRUN'
  | 'MAKER_CEX';

export type MeasuredCandidateStatus =
  | 'observed'
  | 'enriched'
  | 'deterministic_positive'
  | 'eligible'
  | 'blocked'
  | 'expired';

export interface MeasuredQuoteEvidence {
  source: string;
  venue?: string;
  chain?: string;
  symbol?: string;
  observedAt: number;
  bid?: number | null;
  ask?: number | null;
  price?: number | null;
  amountIn?: string | null;
  amountOut?: string | null;
  executable?: boolean;
  provenance?: string[];
}

export interface MeasuredCandidate {
  opportunityId: string;
  topology: MeasuredOpportunityTopology;
  observedAt: number;
  updatedAt: number;
  expiresAt: number;
  status: MeasuredCandidateStatus;
  assets: string[];
  venues: string[];
  chains: string[];
  rawQuotes: MeasuredQuoteEvidence[];
  depth: {
    status: 'measured' | 'unavailable' | 'not_applicable';
    detail?: string;
  };
  economics: {
    grossProfitUsd: number | null;
    deterministicNetProfitUsd: number | null;
    feeUsd: number | null;
    gasUsd: number | null;
    bridgeUsd: number | null;
    expectedSlippageBps: number | null;
    expectedPriceImpactBps: number | null;
  };
  quoteAgeMs: number | null;
  executableCapability: boolean;
  executionCapabilityReason: string;
  missingInformation: string[];
  provenance: string[];
}

export interface MeasuredCandidateMetrics {
  windowMs: number;
  observed: number;
  enriched: number;
  deterministicPositive: number;
  eligible: number;
  blocked: number;
  activeBacklog: number;
  byTopology: Record<MeasuredOpportunityTopology, {
    observed: number;
    deterministicPositive: number;
    eligible: number;
    activeBacklog: number;
  }>;
}

function clone(candidate: MeasuredCandidate): MeasuredCandidate {
  return {
    ...candidate,
    assets: [...candidate.assets],
    venues: [...candidate.venues],
    chains: [...candidate.chains],
    rawQuotes: candidate.rawQuotes.map(quote => ({ ...quote, provenance: quote.provenance ? [...quote.provenance] : undefined })),
    depth: { ...candidate.depth },
    economics: { ...candidate.economics },
    missingInformation: [...candidate.missingInformation],
    provenance: [...candidate.provenance],
  };
}

function emptyTopologyMetrics() {
  return {
    CEX_CEX: { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0 },
    DEX_ATOMIC: { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0 },
    ZERO_CAPITAL_ATOMIC: { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0 },
    CROSS_CHAIN: { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0 },
    MEMPOOL_BACKRUN: { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0 },
    MAKER_CEX: { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0 },
  } satisfies MeasuredCandidateMetrics['byTopology'];
}

class MeasuredCandidateRegistry {
  private readonly candidates = new Map<string, MeasuredCandidate>();
  private readonly maxEntries = Math.max(512, Math.min(20_000, Number(process.env.CRYPTOCRAWL_CANDIDATE_REGISTRY_MAX || 4096)));

  record(input: Omit<MeasuredCandidate, 'updatedAt'>): MeasuredCandidate {
    if (!input.opportunityId.trim()) throw new Error('Measured candidate requires opportunityId');
    if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) throw new Error('Measured candidate requires observedAt');
    if (!Number.isFinite(input.expiresAt) || input.expiresAt < input.observedAt) throw new Error('Measured candidate requires a valid expiration');
    const previous = this.candidates.get(input.opportunityId);
    const next: MeasuredCandidate = {
      ...input,
      updatedAt: Date.now(),
      assets: [...new Set(input.assets.map(value => value.trim()).filter(Boolean))],
      venues: [...new Set(input.venues.map(value => value.trim()).filter(Boolean))],
      chains: [...new Set(input.chains.map(value => value.trim()).filter(Boolean))],
      rawQuotes: input.rawQuotes.map(quote => ({ ...quote, provenance: quote.provenance ? [...quote.provenance] : undefined })),
      depth: { ...input.depth },
      economics: { ...input.economics },
      missingInformation: [...new Set(input.missingInformation)],
      provenance: [...new Set(input.provenance)],
      status: previous && previous.observedAt === input.observedAt &&
        previous.status === 'eligible' && !['blocked', 'expired'].includes(input.status)
        ? 'eligible'
        : input.status,
    };
    this.candidates.set(next.opportunityId, next);
    this.prune();
    return clone(next);
  }

  updateStatus(opportunityId: string, status: MeasuredCandidateStatus, patch?: Partial<Pick<MeasuredCandidate,
    'economics' | 'missingInformation' | 'provenance' | 'executableCapability' | 'executionCapabilityReason' | 'quoteAgeMs' | 'depth'>>): MeasuredCandidate | null {
    const previous = this.candidates.get(opportunityId);
    if (!previous) return null;
    const next = clone(previous);
    next.status = status;
    next.updatedAt = Date.now();
    if (patch?.economics) next.economics = { ...patch.economics };
    if (patch?.missingInformation) next.missingInformation = [...new Set([...previous.missingInformation, ...patch.missingInformation])];
    if (patch?.provenance) next.provenance = [...new Set([...previous.provenance, ...patch.provenance])];
    if (patch?.executableCapability !== undefined) next.executableCapability = patch.executableCapability;
    if (patch?.executionCapabilityReason !== undefined) next.executionCapabilityReason = patch.executionCapabilityReason;
    if (patch?.quoteAgeMs !== undefined) next.quoteAgeMs = patch.quoteAgeMs;
    if (patch?.depth) next.depth = { ...patch.depth };
    this.candidates.set(opportunityId, next);
    return clone(next);
  }

  get(opportunityId: string): MeasuredCandidate | null {
    const candidate = this.candidates.get(opportunityId);
    return candidate ? clone(candidate) : null;
  }

  getRecent(limit = 256): MeasuredCandidate[] {
    const now = Date.now();
    return [...this.candidates.values()]
      .map(candidate => candidate.expiresAt < now && !['blocked', 'expired'].includes(candidate.status)
        ? { ...candidate, status: 'expired' as const }
        : candidate)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(1, Math.min(limit, 4096)))
      .map(clone);
  }

  getMetrics(windowMs = 60_000): MeasuredCandidateMetrics {
    const now = Date.now();
    const cutoff = now - Math.max(1, windowMs);
    const recent = [...this.candidates.values()].filter(candidate => candidate.observedAt >= cutoff);
    const byTopology = emptyTopologyMetrics();
    for (const candidate of recent) {
      const metrics = byTopology[candidate.topology];
      metrics.observed++;
      if (candidate.status === 'deterministic_positive' || candidate.status === 'eligible') metrics.deterministicPositive++;
      if (candidate.status === 'eligible') metrics.eligible++;
      if (candidate.expiresAt >= now && ['observed', 'enriched', 'deterministic_positive', 'eligible'].includes(candidate.status)) metrics.activeBacklog++;
    }
    return {
      windowMs,
      observed: recent.length,
      enriched: recent.filter(candidate => candidate.status === 'enriched').length,
      deterministicPositive: recent.filter(candidate => candidate.status === 'deterministic_positive' || candidate.status === 'eligible').length,
      eligible: recent.filter(candidate => candidate.status === 'eligible').length,
      blocked: recent.filter(candidate => candidate.status === 'blocked').length,
      activeBacklog: Object.values(byTopology).reduce((sum, metrics) => sum + metrics.activeBacklog, 0),
      byTopology,
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, candidate] of this.candidates) {
      if (candidate.expiresAt < now - 10 * 60_000) this.candidates.delete(id);
    }
    if (this.candidates.size <= this.maxEntries) return;
    const oldest = [...this.candidates.values()].sort((left, right) => left.updatedAt - right.updatedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.candidates.delete(oldest[index].opportunityId);
  }
}

export const measuredCandidateRegistry = new MeasuredCandidateRegistry();
