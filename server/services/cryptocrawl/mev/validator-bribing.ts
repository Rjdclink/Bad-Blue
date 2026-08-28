import type { Opportunity } from './flashbots-engine';

const DISABLED_REASON = 'Legacy validator tipping strategy is quarantined: mock block/proposal data and unverified profit-share arithmetic are not execution evidence.';

class ValidatorTippingStrategy {
  async calculateOptimalTip(_opportunity: Opportunity, _competition: CompetitionData): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async proposeRevenueShare(_validatorAddress: string): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async coordinateMultiBlockBundle(_opportunities: Opportunity[]): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async recordBidOutcome(
    _opportunity: Opportunity,
    _bidAmount: number,
    _won: boolean,
    _actualWinningBid: number,
  ): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  async adjustStrategy(): Promise<never> {
    throw new Error(DISABLED_REASON);
  }
}

interface CompetitionData {
  activeBots: number;
  avgResponseTime: number;
  recentSuccessRate: number;
}

interface MultiBlockBundle {
  block1: unknown;
  block2: unknown;
  block3: unknown;
}

export { ValidatorTippingStrategy, type CompetitionData, type MultiBlockBundle };
export { ValidatorTippingStrategy as ValidatorBribingStrategy };
