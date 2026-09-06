import {
  flashLoanProviderSelectionRegistry,
  type DualFlashLoanProviderSelection,
} from './flash-loan-provider-selection-registry.js';

export type { DualFlashLoanProviderSelection } from './flash-loan-provider-selection-registry.js';

/**
 * Compatibility facade only. ZERO_CAPITAL_ATOMIC now has exactly one underlying
 * provider-selection authority: flashLoanProviderSelectionRegistry. This module
 * owns no map, TTL, pruning, or selection state of its own.
 */
class DualFlashLoanProviderSelectionCompatibilityFacade {
  record(selection: Omit<DualFlashLoanProviderSelection, 'kind'> & { kind?: 'dual' }): void {
    flashLoanProviderSelectionRegistry.record({ ...selection, kind: 'dual' });
  }

  get(opportunityId: string, now = Date.now()): DualFlashLoanProviderSelection | null {
    const selection = flashLoanProviderSelectionRegistry.get(opportunityId, now);
    return selection?.kind === 'dual' ? selection : null;
  }

  remove(opportunityId: string): void {
    const selection = flashLoanProviderSelectionRegistry.get(opportunityId);
    if (selection?.kind === 'dual') flashLoanProviderSelectionRegistry.remove(opportunityId);
  }
}

export const dualFlashLoanProviderSelectionRegistry = new DualFlashLoanProviderSelectionCompatibilityFacade();