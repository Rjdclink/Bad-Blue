import type { GhostWalletPreparedTransaction } from './ghost-wallet-builder.js';

export type GhostWalletAlternativeZeroCapitalSource =
  | 'permissionless_vault_capital'
  | 'aave_credit_delegation';

export interface GhostWalletAlternativeZeroCapitalSelection {
  opportunityId: string;
  chain: string;
  asset: string;
  intermediary: string;
  source: GhostWalletAlternativeZeroCapitalSource;
  sourceAddress: string;
  principal: bigint;
  sourceFee: bigint;
  prepared: GhostWalletPreparedTransaction;
  selectedAt: number;
  expiresAt: number;
  expectedNetProfit: bigint;
  expectedNetProfitBps: number;
  estimatedGasUnits: bigint;
  estimatedGasCostInInputToken: bigint;
  provenance: string[];
}

class GhostWalletAlternativeZeroCapitalSelectionRegistry {
  private readonly selections = new Map<string, GhostWalletAlternativeZeroCapitalSelection>();

  record(selection: GhostWalletAlternativeZeroCapitalSelection): void {
    if (!selection.opportunityId.trim()) throw new Error('alternative-capital opportunityId is required');
    if (selection.expiresAt <= Date.now()) throw new Error('alternative-capital selection is already expired');
    if (selection.principal <= 0n) throw new Error('alternative-capital principal must be positive');
    if (selection.expectedNetProfit <= 0n) throw new Error('alternative-capital net profit must be positive');
    this.selections.set(selection.opportunityId, {
      ...selection,
      prepared: { ...selection.prepared },
      provenance: [...selection.provenance],
    });
  }

  get(opportunityId: string, now = Date.now()): GhostWalletAlternativeZeroCapitalSelection | null {
    const selection = this.selections.get(opportunityId);
    if (!selection) return null;
    if (selection.expiresAt <= now) {
      this.selections.delete(opportunityId);
      return null;
    }
    return {
      ...selection,
      prepared: { ...selection.prepared },
      provenance: [...selection.provenance],
    };
  }

  remove(opportunityId: string): void {
    this.selections.delete(opportunityId);
  }

  prune(now = Date.now()): number {
    let removed = 0;
    for (const [opportunityId, selection] of this.selections) {
      if (selection.expiresAt > now) continue;
      this.selections.delete(opportunityId);
      removed += 1;
    }
    return removed;
  }

  snapshot(now = Date.now()) {
    this.prune(now);
    return [...this.selections.values()].map(selection => ({
      ...selection,
      prepared: { ...selection.prepared },
      provenance: [...selection.provenance],
    }));
  }
}

export const ghostWalletAlternativeZeroCapitalSelectionRegistry =
  new GhostWalletAlternativeZeroCapitalSelectionRegistry();