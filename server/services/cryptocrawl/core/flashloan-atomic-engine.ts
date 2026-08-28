// Legacy compatibility surface only.
//
// This module previously fabricated flash-loan swap outputs, simulation results,
// execution success, and profit with hard-coded/randomized placeholders. It is not a
// valid CryptoCrawler execution authority. Canonical zero-capital execution is owned by
// core/zero-capital-engine.ts plus governed receiver/payload/settlement adapters.

export interface LegacyOpportunityScore {
  opportunity?: unknown;
  successProbability?: number;
  expectedValue?: number;
  tier?: unknown;
}

export interface FlashLoanProvider {
  name: string;
  chain: string;
  address: string;
  fee: number;
  maxLoan: number;
  priority: number;
}

export interface AtomicBundle {
  transactions: Array<{
    step: string;
    provider?: string;
    dex?: string;
    amount?: number;
    amountIn?: number;
    expectedOut?: number;
  }>;
  expectedProfit: number;
  provider: string;
}

/** @deprecated Synthetic provider catalog retired from runtime authority. */
export const PROVIDERS: FlashLoanProvider[] = [];

/**
 * @deprecated Compatibility shell. All execution-like methods fail closed.
 */
export class FlashLoanAtomicEngine {
  selectProvider(_chain: string, _amount: number): FlashLoanProvider | undefined {
    return undefined;
  }

  calculateRepayment(amount: number, fee: number): number {
    if (!Number.isFinite(amount) || !Number.isFinite(fee) || amount < 0 || fee < 0) {
      throw new Error('Invalid flash-loan repayment inputs');
    }
    return amount * (1 + fee);
  }

  async buildAtomicBundle(_opportunity: LegacyOpportunityScore, _loanSize: number): Promise<AtomicBundle> {
    throw new Error('Legacy synthetic FlashLoanAtomicEngine is retired; use canonical governed zero-capital execution');
  }

  async validateBundle(_bundle: AtomicBundle): Promise<{ valid: boolean; reason?: string }> {
    return { valid: false, reason: 'Legacy synthetic FlashLoanAtomicEngine is retired' };
  }

  async execute(_opportunity: LegacyOpportunityScore, _loanSize: number): Promise<{ success: boolean; profit: number }> {
    return { success: false, profit: 0 };
  }
}

export default FlashLoanAtomicEngine;
