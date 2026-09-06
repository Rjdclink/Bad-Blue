import type { FlashLoanProviderEconomics, FlashLoanProviderKind } from './flash-loan-provider-economics.js';
import type { VerifiedFlashLoanReceiverCapability } from './flash-loan-receiver-capability.js';
import type { VerifiedDualFlashLoanReceiverCapability } from './dual-flashloan-receiver-capability.js';

export interface SingleFlashLoanProviderSelection {
  kind: 'single';
  opportunityId: string;
  provider: FlashLoanProviderKind;
  receiver: string;
  economics: FlashLoanProviderEconomics;
  receiverCapability: VerifiedFlashLoanReceiverCapability;
  selectedAt: number;
  expiresAt: number;
  provenance: string[];
}

export interface DualFlashLoanProviderSelection {
  kind: 'dual';
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

export type FlashLoanProviderSelection = SingleFlashLoanProviderSelection | DualFlashLoanProviderSelection;
export type FlashLoanProviderSelectionInput =
  | FlashLoanProviderSelection
  | Omit<SingleFlashLoanProviderSelection, 'kind'>
  | Omit<DualFlashLoanProviderSelection, 'kind'>;
export type FlashLoanProviderSelectionListener = (selection: FlashLoanProviderSelection) => void;

function cloneEconomics(value: FlashLoanProviderEconomics): FlashLoanProviderEconomics {
  return {
    ...value,
    missingEvidence: [...value.missingEvidence],
    provenance: [...value.provenance],
  };
}

function cloneSelection(value: FlashLoanProviderSelection): FlashLoanProviderSelection {
  if (value.kind === 'dual') {
    return {
      ...value,
      balancerEconomics: cloneEconomics(value.balancerEconomics),
      aaveEconomics: cloneEconomics(value.aaveEconomics),
      receiverCapability: {
        ...value.receiverCapability,
        provenance: [...value.receiverCapability.provenance],
      },
      provenance: [...value.provenance],
    };
  }
  return {
    ...value,
    economics: cloneEconomics(value.economics),
    receiverCapability: {
      ...value.receiverCapability,
      provenance: [...value.receiverCapability.provenance],
    },
    provenance: [...value.provenance],
  };
}

function normalizeSelection(input: FlashLoanProviderSelectionInput): FlashLoanProviderSelection {
  if ('kind' in input) return input;
  return input.provider === 'aave_balancer_dual'
    ? { ...input, kind: 'dual' } as DualFlashLoanProviderSelection
    : { ...input, kind: 'single' } as SingleFlashLoanProviderSelection;
}

class FlashLoanProviderSelectionRegistry {
  private readonly entries = new Map<string, FlashLoanProviderSelection>();
  private readonly listeners = new Set<FlashLoanProviderSelectionListener>();
  private readonly maxEntries = Math.max(64, Math.min(4096, Number(process.env.ZERO_CAPITAL_PROVIDER_SELECTION_MAX || 1024)));

  record(input: FlashLoanProviderSelectionInput): void {
    const selection = normalizeSelection(input);
    if (!selection.opportunityId || selection.expiresAt <= selection.selectedAt) return;
    if (selection.kind === 'dual' && (selection.balancerAmount <= 0n || selection.aaveAmount <= 0n)) return;
    const stored = cloneSelection(selection);
    this.entries.set(selection.opportunityId, stored);
    this.prune();
    for (const listener of this.listeners) {
      try {
        listener(cloneSelection(stored));
      } catch {
        // Advisory observers must never interfere with canonical provider selection.
      }
    }
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

  onSelection(listener: FlashLoanProviderSelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, selection] of this.entries) if (selection.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size <= this.maxEntries) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.selectedAt - right.selectedAt);
    for (let index = 0; index < oldest.length - this.maxEntries; index++) this.entries.delete(oldest[index].opportunityId);
  }
}

/**
 * Sole flash-provider selection authority for ZERO_CAPITAL_ATOMIC. Single-provider
 * and combined-provider choices share one opportunity-keyed registry so execution,
 * pre-broadcast validation, settlement attribution, and provider repricing cannot
 * disagree about which provider plan is current. onSelection() is read-only
 * telemetry; observer failure cannot alter selection or execution.
 */
export const flashLoanProviderSelectionRegistry = new FlashLoanProviderSelectionRegistry();