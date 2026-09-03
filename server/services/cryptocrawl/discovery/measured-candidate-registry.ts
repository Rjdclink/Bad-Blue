export type MeasuredOpportunityTopology =
  | 'CEX_CEX'
  | 'DEX_ATOMIC'
  | 'ZERO_CAPITAL_ATOMIC'
  | 'CROSS_CHAIN'
  | 'MEMPOOL_BACKRUN'
  | 'LIQUIDATION'
  | 'MAKER_CEX'
  | 'FUNDING_ARBITRAGE';

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

export interface CanonicalBpsEconomics {
  measuredAt: number;
  notionalUsd: number | null;
  grossBps: number | null;
  exchangeFeeBps: number | null;
  slippageBps: number | null;
  impactBps: number | null;
  gasBps: number | null;
  bridgeBps: number | null;
  flashLoanFeeBps: number | null;
  relayBps: number | null;
  allInCostBps: number | null;
  breakEvenBps: number | null;
  netBps: number | null;
  bpsToBreakEven: number | null;
  realizedNetBps: number | null;
  source: 'measured_candidate_registry';
  syntheticEconomicsAllowed: false;
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
    notionalUsd?: number | null;
    grossProfitBps?: number | null;
    flashLoanFeeBps?: number | null;
    gasCostBps?: number | null;
    relayCostBps?: number | null;
    allInCostBps?: number | null;
    breakEvenBps?: number | null;
    netProfitBps?: number | null;
    discoveryFloorBps?: number | null;
    bpsToBreakEven?: number | null;
    realizedNetProfitBps?: number | null;
  };
  canonicalBps: CanonicalBpsEconomics;
  quoteAgeMs: number | null;
  executableCapability: boolean;
  executionCapabilityReason: string;
  missingInformation: string[];
  provenance: string[];
}

export type MeasuredCandidateUpdatePatch = Partial<Pick<MeasuredCandidate,
  'economics' | 'missingInformation' | 'provenance' | 'executableCapability' | 'executionCapabilityReason' | 'quoteAgeMs' | 'depth'>> & {
  replaceMissingInformation?: boolean;
  resolvedMissingInformation?: readonly string[];
};

export interface MeasuredCandidateMetrics {
  windowMs: number;
  observed: number;
  enriched: number;
  deterministicPositive: number;
  eligible: number;
  blocked: number;
  activeBacklog: number;
  blockedReasons: Array<{ reason: string; count: number }>;
  missingInformationFrequency: Array<{ item: string; count: number }>;
  byTopology: Record<MeasuredOpportunityTopology, {
    observed: number;
    deterministicPositive: number;
    eligible: number;
    activeBacklog: number;
    nearBreakEven: number;
  }>;
  zeroCapitalBps: {
    observedWithBps: number;
    nearBreakEven: number;
    positive: number;
    bestNetProfitBps: number | null;
    averageBpsToBreakEven: number | null;
    averageAllInCostBps: number | null;
  };
}

type EligibleCandidateListener = (candidate: MeasuredCandidate) => void;
type CandidateUpdateListener = (candidate: MeasuredCandidate) => void;

type CandidateRecordInput = Omit<MeasuredCandidate, 'updatedAt' | 'canonicalBps'>;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function measuredNotionalUsd(economics: MeasuredCandidate['economics']): number | null {
  const direct = finite(economics.notionalUsd);
  if (direct !== null && direct > 0) return direct;
  const grossBps = finite(economics.grossProfitBps);
  const grossUsd = finite(economics.grossProfitUsd);
  if (grossBps !== null && grossBps !== 0 && grossUsd !== null) {
    const inferred = grossUsd / grossBps * 10_000;
    return Number.isFinite(inferred) && inferred > 0 ? inferred : null;
  }
  return null;
}

function measuredUsdToBps(valueUsd: unknown, notionalUsd: number | null): number | null {
  const value = finite(valueUsd);
  if (value === null || notionalUsd === null || notionalUsd <= 0) return null;
  return Math.max(0, value) / notionalUsd * 10_000;
}

function buildCanonicalBps(economics: MeasuredCandidate['economics'], measuredAt: number): CanonicalBpsEconomics {
  const notionalUsd = measuredNotionalUsd(economics);
  return {
    measuredAt,
    notionalUsd,
    grossBps: finite(economics.grossProfitBps),
    exchangeFeeBps: measuredUsdToBps(economics.feeUsd, notionalUsd),
    slippageBps: finite(economics.expectedSlippageBps),
    impactBps: finite(economics.expectedPriceImpactBps),
    gasBps: finite(economics.gasCostBps) ?? measuredUsdToBps(economics.gasUsd, notionalUsd),
    bridgeBps: measuredUsdToBps(economics.bridgeUsd, notionalUsd),
    flashLoanFeeBps: finite(economics.flashLoanFeeBps),
    relayBps: finite(economics.relayCostBps),
    allInCostBps: finite(economics.allInCostBps),
    breakEvenBps: finite(economics.breakEvenBps),
    netBps: finite(economics.netProfitBps),
    bpsToBreakEven: finite(economics.bpsToBreakEven),
    realizedNetBps: finite(economics.realizedNetProfitBps),
    source: 'measured_candidate_registry',
    syntheticEconomicsAllowed: false,
  };
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
    canonicalBps: { ...candidate.canonicalBps },
    missingInformation: [...candidate.missingInformation],
    provenance: [...candidate.provenance],
  };
}

function topologyMetric() {
  return { observed: 0, deterministicPositive: 0, eligible: 0, activeBacklog: 0, nearBreakEven: 0 };
}

function emptyTopologyMetrics() {
  return {
    CEX_CEX: topologyMetric(),
    DEX_ATOMIC: topologyMetric(),
    ZERO_CAPITAL_ATOMIC: topologyMetric(),
    CROSS_CHAIN: topologyMetric(),
    MEMPOOL_BACKRUN: topologyMetric(),
    LIQUIDATION: topologyMetric(),
    MAKER_CEX: topologyMetric(),
    FUNDING_ARBITRAGE: topologyMetric(),
  } satisfies MeasuredCandidateMetrics['byTopology'];
}

function boundedFrequency(
  values: readonly string[],
  keyName: 'reason' | 'item',
  limit = 12,
): Array<{ reason: string; count: number }> | Array<{ item: string; count: number }> {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map(([value, count]) => keyName === 'reason'
      ? { reason: value, count }
      : { item: value, count }) as Array<{ reason: string; count: number }> | Array<{ item: string; count: number }>;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNearBreakEven(candidate: MeasuredCandidate): boolean {
  const net = candidate.canonicalBps.netBps;
  if (net === null || !Number.isFinite(net) || net > 0) return false;
  const floor = finite(candidate.economics.discoveryFloorBps);
  return floor === null || net >= floor;
}

class MeasuredCandidateRegistry {
  private readonly candidates = new Map<string, MeasuredCandidate>();
  private readonly eligibleListeners = new Set<EligibleCandidateListener>();
  private readonly updateListeners = new Set<CandidateUpdateListener>();
  private readonly maxEntries = Math.max(512, Math.min(20_000, Number(process.env.CRYPTOCRAWL_CANDIDATE_REGISTRY_MAX || 4096)));

  onEligible(listener: EligibleCandidateListener): () => void {
    this.eligibleListeners.add(listener);
    return () => this.eligibleListeners.delete(listener);
  }

  onUpdate(listener: CandidateUpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  record(input: CandidateRecordInput): MeasuredCandidate {
    if (!input.opportunityId.trim()) throw new Error('Measured candidate requires opportunityId');
    if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) throw new Error('Measured candidate requires observedAt');
    if (!Number.isFinite(input.expiresAt) || input.expiresAt < input.observedAt) throw new Error('Measured candidate requires a valid expiration');
    const previous = this.candidates.get(input.opportunityId);
    const updatedAt = Date.now();
    const economics = { ...input.economics };
    const next: MeasuredCandidate = {
      ...input,
      updatedAt,
      assets: [...new Set(input.assets.map(value => value.trim()).filter(Boolean))],
      venues: [...new Set(input.venues.map(value => value.trim()).filter(Boolean))],
      chains: [...new Set(input.chains.map(value => value.trim()).filter(Boolean))],
      rawQuotes: input.rawQuotes.map(quote => ({ ...quote, provenance: quote.provenance ? [...quote.provenance] : undefined })),
      depth: { ...input.depth },
      economics,
      canonicalBps: buildCanonicalBps(economics, updatedAt),
      missingInformation: [...new Set(input.missingInformation)],
      provenance: [...new Set([...input.provenance, 'canonical_bps:measured_candidate_registry'])],
      status: previous && previous.observedAt === input.observedAt &&
        previous.status === 'eligible' && !['blocked', 'expired'].includes(input.status)
        ? 'eligible'
        : input.status,
    };
    this.candidates.set(next.opportunityId, next);
    this.prune();
    this.notifyUpdate(next);
    this.notifyEligible(previous, next);
    return clone(next);
  }

  updateStatus(
    opportunityId: string,
    status: MeasuredCandidateStatus,
    patch?: MeasuredCandidateUpdatePatch,
  ): MeasuredCandidate | null {
    const previous = this.candidates.get(opportunityId);
    if (!previous) return null;
    const next = clone(previous);
    next.status = status;
    next.updatedAt = Date.now();
    if (patch?.economics) next.economics = { ...patch.economics };
    next.canonicalBps = buildCanonicalBps(next.economics, next.updatedAt);
    if (patch?.replaceMissingInformation) {
      next.missingInformation = [...new Set((patch.missingInformation || []).map(item => item.trim()).filter(Boolean))];
    } else if (patch?.missingInformation) {
      next.missingInformation = [...new Set([...previous.missingInformation, ...patch.missingInformation])];
    }
    if (patch?.resolvedMissingInformation?.length) {
      const resolved = new Set(patch.resolvedMissingInformation.map(item => item.trim()).filter(Boolean));
      next.missingInformation = next.missingInformation.filter(item => !resolved.has(item));
    }
    if (patch?.provenance) next.provenance = [...new Set([...previous.provenance, ...patch.provenance])];
    next.provenance = [...new Set([...next.provenance, 'canonical_bps:measured_candidate_registry'])];
    if (patch?.executableCapability !== undefined) next.executableCapability = patch.executableCapability;
    if (patch?.executionCapabilityReason !== undefined) next.executionCapabilityReason = patch.executionCapabilityReason;
    if (patch?.quoteAgeMs !== undefined) next.quoteAgeMs = patch.quoteAgeMs;
    if (patch?.depth) next.depth = { ...patch.depth };
    this.candidates.set(opportunityId, next);
    this.notifyUpdate(next);
    this.notifyEligible(previous, next);
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
      if (isNearBreakEven(candidate)) metrics.nearBreakEven++;
      if (candidate.expiresAt >= now && ['observed', 'enriched', 'deterministic_positive', 'eligible'].includes(candidate.status)) metrics.activeBacklog++;
    }

    const blockedCandidates = recent.filter(candidate => candidate.status === 'blocked');
    const blockedReasons = boundedFrequency(
      blockedCandidates.map(candidate => candidate.executionCapabilityReason || 'unspecified_blocker'),
      'reason',
    ) as Array<{ reason: string; count: number }>;
    const missingInformationFrequency = boundedFrequency(
      recent.flatMap(candidate => candidate.missingInformation),
      'item',
    ) as Array<{ item: string; count: number }>;
    const zeroCapitalWithBps = recent.filter(candidate =>
      candidate.topology === 'ZERO_CAPITAL_ATOMIC' &&
      candidate.canonicalBps.netBps !== null &&
      Number.isFinite(candidate.canonicalBps.netBps),
    );
    const nearBreakEven = zeroCapitalWithBps.filter(isNearBreakEven);
    const positiveBps = zeroCapitalWithBps.filter(candidate => Number(candidate.canonicalBps.netBps) > 0);
    const bpsToBreakEven = nearBreakEven
      .map(candidate => candidate.canonicalBps.bpsToBreakEven)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const allInCostBps = zeroCapitalWithBps
      .map(candidate => candidate.canonicalBps.allInCostBps)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    return {
      windowMs,
      observed: recent.length,
      enriched: recent.filter(candidate => candidate.status === 'enriched').length,
      deterministicPositive: recent.filter(candidate => candidate.status === 'deterministic_positive' || candidate.status === 'eligible').length,
      eligible: recent.filter(candidate => candidate.status === 'eligible').length,
      blocked: blockedCandidates.length,
      activeBacklog: Object.values(byTopology).reduce((sum, metrics) => sum + metrics.activeBacklog, 0),
      blockedReasons,
      missingInformationFrequency,
      byTopology,
      zeroCapitalBps: {
        observedWithBps: zeroCapitalWithBps.length,
        nearBreakEven: nearBreakEven.length,
        positive: positiveBps.length,
        bestNetProfitBps: zeroCapitalWithBps.length > 0
          ? Math.max(...zeroCapitalWithBps.map(candidate => Number(candidate.canonicalBps.netBps)))
          : null,
        averageBpsToBreakEven: average(bpsToBreakEven),
        averageAllInCostBps: average(allInCostBps),
      },
    };
  }

  private notifyUpdate(next: MeasuredCandidate): void {
    if (this.updateListeners.size === 0) return;
    const snapshot = clone(next);
    queueMicrotask(() => {
      for (const listener of this.updateListeners) {
        try { listener(clone(snapshot)); } catch { /* acquisition listeners cannot corrupt candidate state */ }
      }
    });
  }

  private notifyEligible(previous: MeasuredCandidate | undefined, next: MeasuredCandidate): void {
    if (next.status !== 'eligible') return;
    if (previous?.status === 'eligible' && previous.updatedAt === next.updatedAt) return;
    const snapshot = clone(next);
    queueMicrotask(() => {
      for (const listener of this.eligibleListeners) {
        try { listener(clone(snapshot)); } catch { /* listener failures cannot corrupt candidate state */ }
      }
    });
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
