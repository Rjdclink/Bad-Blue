const DISABLED_REASON = 'Legacy advanced validator builder is quarantined: placeholder contract/calldata and unverified expected-profit tipping are forbidden.';

interface Opportunity {
  id: string;
  expectedProfit: number;
  chain: string;
  asset: string;
}

interface BundleTransaction {
  to: string;
  value: string;
  data: string;
  gasLimit: number;
}

interface CascadingBundle {
  transactions: BundleTransaction[];
  totalProfit: number;
  validatorTip: number;
  opportunityCount: number;
}

interface TipCalculation {
  baseTip: number;
  adjustedTip: number;
  tipPercentage: number;
  competitionAdjustment: number;
}

class ValidatorTippingAdvanced {
  calculateOptimalTip(_opportunity: Opportunity, _targetBlock: number, _competitionLevel?: number): never {
    throw new Error(DISABLED_REASON);
  }

  buildCascadingBundle(_opportunities: Opportunity[]): never {
    throw new Error(DISABLED_REASON);
  }

  async executeZeroETHCompetition(_opportunity: Opportunity): Promise<never> {
    throw new Error(DISABLED_REASON);
  }

  validateTipAmount(_profit: number, _tip: number): false {
    return false;
  }

  estimateBundleValue(_opportunities: Opportunity[]): never {
    throw new Error(DISABLED_REASON);
  }

  getOptimalBundleSize(_opportunities: Opportunity[]): never {
    throw new Error(DISABLED_REASON);
  }
}

export {
  ValidatorTippingAdvanced,
  type Opportunity as ValidatorOpportunity,
  type CascadingBundle,
  type TipCalculation,
  type BundleTransaction,
};
export { ValidatorTippingAdvanced as ValidatorBribingAdvanced };
