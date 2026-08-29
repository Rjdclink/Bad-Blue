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
    /** Measured or explicitly bounded notional used to convert realized P&L into realized BPS. */
    notionalUsd?: number | null;
    /** Optional BPS decomposition. Populated where the topology has measured all-in economics. */
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
    /** Net BPS of the same measured opportunity before execution-path transformations. */
    baselineNetProfitBps?: number | null;
    /** Net BPS after verified execution-path transformations and exact all-in repricing. */
    optimizedNetProfitBps?: number | null;
    /** optimizedNetProfitBps - baselineNetProfitBps. Telemetry only; never an execution floor. */
    executionEfficiencyDeltaBps?: number | null;
    /** Aspirational optimization target used for telemetry/learning only. */
    executionEfficiencyTargetBps?: number | null;
    /** Measured monetary gas avoided by a verified sponsored execution path, in BPS. */
    sponsoredGasSavingsBps?: number | null;
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
  const net = candidate.economics.netProfitBps;
  if (candidate.topology !== 'ZERO_CAPITAL_ATOMIC' || net === null || net === undefined || !Number.isFinite(net) || net > 0) return false;
  const floor = candidate.economics.discoveryFloorBps;
  return floor === null || floor === undefined || !Number.isFinite(floor) || net >= floor;
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
      .filter(candidate => candidate.expiresAt > now)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(1, Math.min(this.maxEntries, limit)))
      .map(clone);
  }

  metrics(windowMs = 15 * 60_000): MeasuredCandidateMetrics {
    const now = Date.now();
    const cutoff = now - Math.max(1_000, windowMs);
    const candidates = [...this.candidates.values()].filter(candidate => candidate.updatedAt >= cutoff);
    const byTopology = emptyTopologyMetrics();
    const blockedReasons: string[] = [];
    const missingInformation: string[] = [];
    const zeroCapitalNetBps: number[] = [];
    const zeroCapitalBreakEven: number[] = [];
    const zeroCapitalCosts: number[] = [];
    let observed = 0;
    let enriched = 0;
    let deterministicPositive = 0;
    let eligible = 0;
    let blocked = 0;
    let activeBacklog = 0;

    for (const candidate of candidates) {
      observed += 1;
      byTopology[candidate.topology].observed += 1;
      if (candidate.status === 'enriched') enriched += 1;
      if (candidate.status === 'deterministic_positive' || candidate.status === 'eligible') {
        deterministicPositive += 1;
        byTopology[candidate.topology].deterministicPositive += 1;
      }
      if (candidate.status === 'eligible') {
        eligible += 1;
        byTopology[candidate.topology].eligible += 1;
      }
      if (candidate.status === 'blocked') blocked += 1;
      if (candidate.expiresAt > now && candidate.status !== 'expired') {
        activeBacklog += 1;
        byTopology[candidate.topology].activeBacklog += 1;
      }
      if (isNearBreakEven(candidate)) byTopology[candidate.topology].nearBreakEven += 1;
      if (candidate.status === 'blocked') blockedReasons.push(candidate.executionCapabilityReason);
      missingInformation.push(...candidate.missingInformation);
      if (candidate.topology === 'ZERO_CAPITAL_ATOMIC') {
        const net = Number(candidate.economics.netProfitBps);
        if (Number.isFinite(net)) zeroCapitalNetBps.push(net);
        const breakEven = Number(candidate.economics.bpsToBreakEven);
        if (Number.isFinite(breakEven)) zeroCapitalBreakEven.push(breakEven);
        const cost = Number(candidate.economics.allInCostBps);
        if (Number.isFinite(cost)) zeroCapitalCosts.push(cost);
      }
    }

    const blockedFrequency = boundedFrequency(blockedReasons, 'reason', 12) as Array<{ reason: string; count: number }>;
    const missingFrequency = boundedFrequency(missingInformation, 'item', 12) as Array<{ item: string; count: number }>;
    const positiveZeroCapital = zeroCapitalNetBps.filter(value => value > 0);
    return {
      windowMs,
      observed,
      enriched,
      deterministicPositive,
      eligible,
      blocked,
      activeBacklog,
      blockedReasons: blockedFrequency,
      missingInformationFrequency: missingFrequency,
      byTopology,
      zeroCapitalBps: {
        observedWithBps: zeroCapitalNetBps.length,
        nearBreakEven: byTopology.ZERO_CAPITAL_ATOMIC.nearBreakEven,
        positive: positiveZeroCapital.length,
        bestNetProfitBps: positiveZeroCapital.length > 0 ? Math.max(...positiveZeroCapital) : null,
        averageBpsToBreakEven: average(zeroCapitalBreakEven),
        averageAllInCostBps: average(zeroCapitalCosts),
      },
    };
  }

  private prune(): void {
    if (this.candidates.size <= this.maxEntries) return;
    const sorted = [...this.candidates.values()].sort((left, right) => left.updatedAt - right.updatedAt);
    for (let index = 0; index < sorted.length - this.maxEntries; index += 1) {
      this.candidates.delete(sorted[index].opportunityId);
    }
  }
}

export const measuredCandidateRegistry = new MeasuredCandidateRegistry();
