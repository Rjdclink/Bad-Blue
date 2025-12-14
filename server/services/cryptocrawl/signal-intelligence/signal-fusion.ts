/**
 * Signal Fusion (offline, signal-only)
 *
 * Purpose:
 * - Combine multiple independent validation layers into a single binary decision.
 * - Moves only when the math converges.
 *
 * Scope constraints:
 * - Does NOT execute trades
 * - Does NOT modify base signal generation logic
 * - Output ONLY: 'SIGNAL' | 'NO SIGNAL'
 */

import type { Decision as MonteCarloDecision } from './monte-carlo-scorer';

export type BaseDecision = 'SIGNAL' | 'NO SIGNAL';
export type FinalDecision = 'SIGNAL' | 'NO SIGNAL';

export interface FusionInputs {
  baseDecision: BaseDecision;
  monteCarloDecision: MonteCarloDecision;
  governorDecision: MonteCarloDecision;
}

export function fuseDecisions(input: FusionInputs): FinalDecision {
  // If base signal says no, we do nothing.
  if (input.baseDecision !== 'SIGNAL') return 'NO SIGNAL';

  // If either layer vetoes, we do nothing.
  if (input.monteCarloDecision === 'NO SIGNAL') return 'NO SIGNAL';
  if (input.governorDecision === 'NO SIGNAL') return 'NO SIGNAL';

  // Converged: base says signal and both independent layers allow it.
  return 'SIGNAL';
}

