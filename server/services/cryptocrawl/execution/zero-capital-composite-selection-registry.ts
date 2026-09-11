import type { SupportedChain } from '../core/zero-capital-engine.js';

export interface ZeroCapitalCompositePreparedSelection {
  opportunityId: string;
  memberOpportunityIds: string[];
  chain: SupportedChain;
  asset: string;
  inputTokenDecimals: number;
  receiver: string;
  principal: bigint;
  expectedGrossProfit: bigint;
  expectedNetProfit: bigint;
  targetNetProfitBps: number;
  targetNetProfitBaseUnits: bigint;
  flashLoanFeeInInputToken: bigint;
  estimatedGasCostInInputToken: bigint;
  relayFeeInInputToken: bigint;
  estimatedGasUnits: bigint;
  expectedGasPriceWei: bigint;
  prepared: {
    to: string;
    data: string;
    value: string;
  };
  expiresAt: number;
  measuredAt: number;
  provenance: string[];
}

function clone(selection: ZeroCapitalCompositePreparedSelection): ZeroCapitalCompositePreparedSelection {
  return {
    ...selection,
    memberOpportunityIds: [...selection.memberOpportunityIds],
    prepared: { ...selection.prepared },
    provenance: [...selection.provenance],
  };
}

class ZeroCapitalCompositeSelectionRegistry {
  private readonly entries = new Map<string, ZeroCapitalCompositePreparedSelection>();
  private readonly maxEntries = Math.max(16, Math.min(512, Number(process.env.ZERO_CAPITAL_COMPOSITE_SELECTION_MAX || 128)));

  record(selection: ZeroCapitalCompositePreparedSelection): void {
    if (!selection.opportunityId.trim() || selection.memberOpportunityIds.length < 2) return;
    if (selection.principal <= 0n || selection.expectedNetProfit <= 0n || selection.targetNetProfitBaseUnits <= 0n) return;
    if (!Number.isFinite(selection.targetNetProfitBps) || selection.targetNetProfitBps <= 0) return;
    if (selection.expectedNetProfit < selection.targetNetProfitBaseUnits || selection.expiresAt <= Date.now()) return;
    this.entries.set(selection.opportunityId, clone(selection));
    this.prune();
  }

  get(opportunityId: string): ZeroCapitalCompositePreparedSelection | null {
    const selection = this.entries.get(opportunityId);
    if (!selection) return null;
    if (selection.expiresAt <= Date.now()) {
      this.entries.delete(opportunityId);
      return null;
    }
    return clone(selection);
  }

  remove(opportunityId: string): void {
    this.entries.delete(opportunityId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, selection] of this.entries) if (selection.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.measuredAt - right.measuredAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index += 1) {
      this.entries.delete(oldest[index].opportunityId);
    }
  }
}

export const zeroCapitalCompositeSelectionRegistry = new ZeroCapitalCompositeSelectionRegistry();
