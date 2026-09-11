import type { SupportedChain } from '../core/zero-capital-engine.js';

export interface ZeroCapitalCompositeEvidence {
  evidenceId: string;
  opportunityIds: string[];
  chain: SupportedChain;
  inputToken: string;
  inputTokenDecimals: number;
  sharedPrincipal: bigint;
  individualExpectedProfitSum: bigint;
  measuredCompositionGain: bigint;
  combinedExpectedProfit: bigint;
  combinedGrossProfit: bigint;
  combinedAllInCost: bigint;
  flashLoanFeeInInputToken: bigint;
  gasCostInInputToken: bigint;
  relayFeeInInputToken: bigint;
  targetNetProfitBps: number;
  targetNetProfitBaseUnits: bigint;
  requiredOnchainResidual: bigint;
  compositionGainUsd: number;
  minProfitSum: bigint;
  sharedPrincipalStackedBps: number;
  stepCount: number;
  estimatedGas: bigint;
  /** Exact eth_call outcome for the target-bound composite payload. */
  simulated: boolean;
  simulationAdvisoryError?: string;
  simulatedAt: number;
  expiresAt: number;
  provenance: string[];
}

function key(ids: readonly string[]): string {
  return [...ids].sort().join('|');
}

function clone(value: ZeroCapitalCompositeEvidence): ZeroCapitalCompositeEvidence {
  return {
    ...value,
    opportunityIds: [...value.opportunityIds],
    provenance: [...value.provenance],
  };
}

class ZeroCapitalCompositeEvidenceRegistry {
  private readonly entries = new Map<string, ZeroCapitalCompositeEvidence>();
  private readonly maxEntries = Math.max(32, Math.min(1024, Number(process.env.CRYPTOCRAWL_MULTILEG_COMPOSITE_EVIDENCE_MAX || 256)));

  record(input: ZeroCapitalCompositeEvidence): void {
    if (input.opportunityIds.length < 2 || input.measuredCompositionGain <= 0n || input.combinedExpectedProfit <= input.individualExpectedProfitSum) return;
    if (input.sharedPrincipal <= 0n || input.combinedAllInCost < 0n || input.combinedGrossProfit < input.combinedExpectedProfit) return;
    if (input.targetNetProfitBaseUnits <= 0n || input.requiredOnchainResidual < input.targetNetProfitBaseUnits) return;
    if (!Number.isFinite(input.targetNetProfitBps) || input.targetNetProfitBps <= 0) return;
    if (input.combinedExpectedProfit < input.targetNetProfitBaseUnits) return;
    this.entries.set(key(input.opportunityIds), clone(input));
    this.prune();
  }

  get(opportunityIds: readonly string[]): ZeroCapitalCompositeEvidence | null {
    const value = this.entries.get(key(opportunityIds));
    if (!value || value.expiresAt <= Date.now()) return null;
    return clone(value);
  }

  getRecent(limit = 32): ZeroCapitalCompositeEvidence[] {
    const now = Date.now();
    return [...this.entries.values()]
      .filter(value => value.expiresAt > now)
      .sort((left, right) => right.combinedExpectedProfit > left.combinedExpectedProfit ? 1 : right.combinedExpectedProfit < left.combinedExpectedProfit ? -1 : right.simulatedAt - left.simulatedAt)
      .slice(0, Math.max(1, Math.min(256, limit)))
      .map(clone);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.simulatedAt - right.simulatedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(key(oldest[index].opportunityIds));
  }
}

export const zeroCapitalCompositeEvidenceRegistry = new ZeroCapitalCompositeEvidenceRegistry();