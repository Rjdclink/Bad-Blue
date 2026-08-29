import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

export interface ZeroCapitalRouteEvidence {
  opportunityId: string;
  chain: SupportedChain;
  inputToken: string;
  inputTokenDecimals: number;
  flashLoanAmount: bigint;
  expectedProfit: bigint;
  route: ZeroCapitalOpportunity['route'];
  observedAt: number;
  expiresAt: number;
}

function clone(evidence: ZeroCapitalRouteEvidence): ZeroCapitalRouteEvidence {
  return {
    ...evidence,
    route: evidence.route.map(step => ({ ...step })),
  };
}

class ZeroCapitalRouteEvidenceRegistry {
  private readonly entries = new Map<string, ZeroCapitalRouteEvidence>();
  private readonly maxEntries = Math.max(128, Math.min(4096, Number(process.env.CRYPTOCRAWL_MULTILEG_ROUTE_EVIDENCE_MAX || 1024)));

  record(opportunity: ZeroCapitalOpportunity): void {
    if (opportunity.chain === 'europa') return;
    this.entries.set(opportunity.id, {
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      inputToken: opportunity.inputToken,
      inputTokenDecimals: opportunity.inputTokenDecimals,
      flashLoanAmount: opportunity.flashLoanAmount,
      expectedProfit: opportunity.expectedProfit,
      route: opportunity.route.map(step => ({ ...step })),
      observedAt: opportunity.timestamp,
      expiresAt: opportunity.expiresAt,
    });
    this.prune();
  }

  get(opportunityId: string): ZeroCapitalRouteEvidence | null {
    const value = this.entries.get(opportunityId);
    if (!value || value.expiresAt <= Date.now()) return null;
    return clone(value);
  }

  getCompatible(input: { chain: SupportedChain; inputToken: string; now?: number }): ZeroCapitalRouteEvidence[] {
    const now = input.now ?? Date.now();
    return [...this.entries.values()]
      .filter(value =>
        value.expiresAt > now &&
        value.chain === input.chain &&
        value.inputToken.toLowerCase() === input.inputToken.toLowerCase() &&
        value.expectedProfit > 0n,
      )
      .sort((left, right) => Number(right.expectedProfit - left.expectedProfit))
      .map(clone);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.observedAt - right.observedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(oldest[index].opportunityId);
  }
}

export const zeroCapitalRouteEvidenceRegistry = new ZeroCapitalRouteEvidenceRegistry();
