import type { FlashLoanProviderEconomics } from './flash-loan-provider-economics.js';
import type { VerifiedDualFlashLoanReceiverCapability } from './dual-flashloan-receiver-capability.js';

export interface DualFlashLoanProviderSelection {
  opportunityId: string;
  provider: 'aave_balancer_dual';
  receiver: string;
  balancerAmount: bigint;
  aaveAmount: bigint;
  balancerEconomics: FlashLoanProviderEconomics;
  aaveEconomics: FlashLoanProviderEconomics;
  receiverCapability: VerifiedDualFlashLoanReceiverCapability;
  totalMeasuredFlashFee: bigint;
  selectedAt: number;
  expiresAt: number;
  provenance: string[];
}

function clone(value: DualFlashLoanProviderSelection): DualFlashLoanProviderSelection {
  return {
    ...value,
    balancerEconomics: {
      ...value.balancerEconomics,
      missingEvidence: [...value.balancerEconomics.missingEvidence],
      provenance: [...value.balancerEconomics.provenance],
    },
    aaveEconomics: {
      ...value.aaveEconomics,
      missingEvidence: [...value.aaveEconomics.missingEvidence],
      provenance: [...value.aaveEconomics.provenance],
    },
    receiverCapability: {
      ...value.receiverCapability,
      provenance: [...value.receiverCapability.provenance],
    },
    provenance: [...value.provenance],
  };
}

class DualFlashLoanProviderSelectionRegistry {
  private readonly entries = new Map<string, DualFlashLoanProviderSelection>();
  private readonly maxEntries = Math.max(64, Math.min(4096, Number(process.env.ZERO_CAPITAL_DUAL_PROVIDER_SELECTION_MAX || 1024)));

  record(selection: DualFlashLoanProviderSelection): void {
    if (!selection.opportunityId || selection.expiresAt <= selection.selectedAt) return;
    if (selection.balancerAmount <= 0n || selection.aaveAmount <= 0n) return;
    this.entries.set(selection.opportunityId, clone(selection));
    this.prune();
  }

  get(opportunityId: string, now = Date.now()): DualFlashLoanProviderSelection | null {
    const selection = this.entries.get(opportunityId);
    if (!selection || selection.expiresAt <= now) {
      if (selection) this.entries.delete(opportunityId);
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
    const oldest = [...this.entries.values()].sort((a, b) => a.selectedAt - b.selectedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(oldest[index].opportunityId);
  }
}

export const dualFlashLoanProviderSelectionRegistry = new DualFlashLoanProviderSelectionRegistry();
