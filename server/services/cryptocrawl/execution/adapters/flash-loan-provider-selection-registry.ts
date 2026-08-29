import type { FlashLoanProviderEconomics, FlashLoanProviderKind } from './flash-loan-provider-economics.js';
import type { VerifiedFlashLoanReceiverCapability } from './flash-loan-receiver-capability.js';

export interface FlashLoanProviderSelection {
  opportunityId: string;
  provider: FlashLoanProviderKind;
  receiver: string;
  economics: FlashLoanProviderEconomics;
  receiverCapability: VerifiedFlashLoanReceiverCapability;
  selectedAt: number;
  expiresAt: number;
  provenance: string[];
}

function cloneSelection(value: FlashLoanProviderSelection): FlashLoanProviderSelection {
  return {
    ...value,
    economics: {
      ...value.economics,
      missingEvidence: [...value.economics.missingEvidence],
      provenance: [...value.economics.provenance],
    },
    receiverCapability: {
      ...value.receiverCapability,
      provenance: [...value.receiverCapability.provenance],
    },
    provenance: [...value.provenance],
  };
}

class FlashLoanProviderSelectionRegistry {
  private readonly entries = new Map<string, FlashLoanProviderSelection>();
  private readonly maxEntries = Math.max(64, Math.min(4096, Number(process.env.ZERO_CAPITAL_PROVIDER_SELECTION_MAX || 1024)));

  record(selection: FlashLoanProviderSelection): void {
    if (!selection.opportunityId || selection.expiresAt <= selection.selectedAt) return;
    this.entries.set(selection.opportunityId, cloneSelection(selection));
    this.prune();
  }

  get(opportunityId: string, now = Date.now()): FlashLoanProviderSelection | null {
    const selection = this.entries.get(opportunityId);
    if (!selection || selection.expiresAt <= now) {
      if (selection) this.entries.delete(opportunityId);
      return null;
    }
    return cloneSelection(selection);
  }

  remove(opportunityId: string): void {
    this.entries.delete(opportunityId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, selection] of this.entries) if (selection.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.selectedAt - right.selectedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(oldest[index].opportunityId);
  }
}

export const flashLoanProviderSelectionRegistry = new FlashLoanProviderSelectionRegistry();
