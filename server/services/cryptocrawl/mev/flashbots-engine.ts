const DISABLED_REASON = 'Legacy FlashbotsEngine is quarantined: placeholder calldata, synthetic profit/tipping arithmetic, and non-canonical bundle construction are forbidden. Use canonical zero-capital execution and MultiRelaySubmitter.';

/**
 * Compatibility shell for the historical MEV engine.
 *
 * The former implementation could build transactions with mock calldata and
 * derive validator payments from unverified opportunity.profit values. Those
 * semantics violate deterministic all-in economics and settlement truth. Keep
 * the export so old imports fail closed instead of silently switching behavior.
 */
class FlashbotsEngine {
  async initialize(): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async buildCascadingBundle(_opportunities: Opportunity[]): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async executeWithZeroBalance(_opportunity: Opportunity): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async submitToAllBuilders(_bundle: unknown, _targetBlock: number): Promise<never> {
    throw new Error(DISABLED_REASON);
  }
}

interface Opportunity {
  id: string;
  asset: string;
  profit: number;
  contractAddress: string;
  path: string[];
  type?: string;
}

export { FlashbotsEngine, type Opportunity };
