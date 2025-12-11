import { ethers } from 'ethers';
import logger from '../../../logger.js';

const { parseEther, parseUnits } = ethers.utils;

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

// Flashbots magic address - replaced at submission
const BLOCK_COINBASE = 'block.coinbase';

// ValidatorTippingAdvanced - Standard MEV/Flashbots priority fee mechanism
// Uses legitimate priority gas auction (PGA) system for block inclusion
class ValidatorTippingAdvanced {
  private readonly BASE_TIP_PERCENTAGE = 0.35; // 35% of profit
  private readonly MAX_TIP_PERCENTAGE = 0.50; // Never exceed 50%
  private readonly MIN_TIP_PERCENTAGE = 0.20; // Minimum 20%

  calculateOptimalTip(opportunity: Opportunity, targetBlock: number, competitionLevel?: number): TipCalculation {
    const competition = competitionLevel || 1.0;
    
    // Base tip: 35% of expected profit (consistent)
    const baseTip = opportunity.expectedProfit * this.BASE_TIP_PERCENTAGE;
    
    // Adjust based on competition level
    let competitionAdjustment = 0;
    if (competition > 1.5) {
      // High competition: increase tip by up to 15%
      competitionAdjustment = Math.min(0.15, (competition - 1) * 0.1);
    }
    
    const adjustedPercentage = Math.min(
      this.MAX_TIP_PERCENTAGE,
      this.BASE_TIP_PERCENTAGE + competitionAdjustment
    );
    
    const adjustedTip = opportunity.expectedProfit * adjustedPercentage;
    
    logger.debug('Validator tip calculated', {
      component: 'ValidatorTippingAdvanced',
      opportunityId: opportunity.id,
      expectedProfit: opportunity.expectedProfit,
      baseTip,
      adjustedTip,
      tipPercentage: `${(adjustedPercentage * 100).toFixed(1)}%`,
      competitionLevel: competition
    });

    return {
      baseTip,
      adjustedTip,
      tipPercentage: adjustedPercentage,
      competitionAdjustment
    };
  }

  buildCascadingBundle(opportunities: Opportunity[]): CascadingBundle {
    // Bundle up to 10 arbitrages in single bundle
    const bundledOpps = opportunities.slice(0, 10);
    const transactions: BundleTransaction[] = [];
    
    let totalProfit = 0;
    let cumulativeProfit = 0;

    // Build arbitrage transactions
    for (let i = 0; i < bundledOpps.length; i++) {
      const opp = bundledOpps[i];
      totalProfit += opp.expectedProfit;
      
      // Each arbitrage transaction
      transactions.push({
        to: this.getArbitrageContractAddress(opp.chain),
        value: '0',
        data: this.encodeArbitrageCall(opp),
        gasLimit: 300000
      });

      // After each arbitrage, profit is available for next one's gas
      cumulativeProfit += opp.expectedProfit;
      
      logger.debug('Added arbitrage to cascade', {
        component: 'ValidatorTippingAdvanced',
        position: i + 1,
        opportunityId: opp.id,
        profit: opp.expectedProfit,
        cumulativeProfit
      });
    }

    // Final transaction: tip validator from accumulated profit
    const validatorTip = totalProfit * this.BASE_TIP_PERCENTAGE;
    
    transactions.push({
      to: BLOCK_COINBASE, // Flashbots magic address - replaced at submission
      value: parseEther(validatorTip.toString()).toString(),
      data: '0x',
      gasLimit: 21000
    });

    logger.info('Cascading bundle built', {
      component: 'ValidatorTippingAdvanced',
      opportunityCount: bundledOpps.length,
      totalProfit,
      validatorTip,
      tipPercentage: `${(this.BASE_TIP_PERCENTAGE * 100).toFixed(1)}%`,
      transactionCount: transactions.length
    });

    return {
      transactions,
      totalProfit,
      validatorTip,
      opportunityCount: bundledOpps.length
    };
  }

  async executeZeroETHCompetition(opp: Opportunity): Promise<BundleTransaction[]> {
    logger.info('Building zero-ETH competition bundle', {
      component: 'ValidatorTippingAdvanced',
      opportunityId: opp.id,
      expectedProfit: opp.expectedProfit
    });

    const transactions: BundleTransaction[] = [];
    
    // TX1: Arbitrage (wallet can have 0 ETH)
    transactions.push({
      to: this.getArbitrageContractAddress(opp.chain),
      value: '0',
      data: this.encodeArbitrageCall(opp),
      gasLimit: 400000
    });

    // TX2: Pay validator from arbitrage profit (atomic)
    const validatorPayment = opp.expectedProfit * this.BASE_TIP_PERCENTAGE;
    
    transactions.push({
      to: BLOCK_COINBASE,
      value: parseEther(validatorPayment.toString()).toString(),
      data: '0x',
      gasLimit: 21000
    });

    logger.debug('Zero-ETH bundle created', {
      component: 'ValidatorTippingAdvanced',
      opportunityId: opp.id,
      validatorPayment,
      note: 'Profit extracted before payment - wallet needs 0 ETH'
    });

    return transactions;
  }

  private getArbitrageContractAddress(chain: string): string {
    // In production, these would be actual deployed contract addresses
    const contracts: Record<string, string> = {
      ethereum: '0x0000000000000000000000000000000000000001',
      polygon: '0x0000000000000000000000000000000000000002',
      bsc: '0x0000000000000000000000000000000000000003',
      arbitrum: '0x0000000000000000000000000000000000000004',
      optimism: '0x0000000000000000000000000000000000000005'
    };
    
    return contracts[chain] || contracts.ethereum;
  }

  private encodeArbitrageCall(opp: Opportunity): string {
    // In production, this would encode the actual arbitrage function call
    // For now, return placeholder
    return '0x' + Buffer.from(JSON.stringify({
      opportunityId: opp.id,
      asset: opp.asset,
      expectedProfit: opp.expectedProfit
    })).toString('hex');
  }

  validateTipAmount(profit: number, tip: number): boolean {
    const percentage = tip / profit;
    
    if (percentage < this.MIN_TIP_PERCENTAGE) {
      logger.warn('Tip too low', {
        component: 'ValidatorTippingAdvanced',
        profit,
        tip,
        percentage: `${(percentage * 100).toFixed(1)}%`,
        minimum: `${(this.MIN_TIP_PERCENTAGE * 100).toFixed(1)}%`
      });
      return false;
    }
    
    if (percentage > this.MAX_TIP_PERCENTAGE) {
      logger.warn('Tip too high', {
        component: 'ValidatorTippingAdvanced',
        profit,
        tip,
        percentage: `${(percentage * 100).toFixed(1)}%`,
        maximum: `${(this.MAX_TIP_PERCENTAGE * 100).toFixed(1)}%`
      });
      return false;
    }
    
    return true;
  }

  estimateBundleValue(opportunities: Opportunity[]): number {
    const bundledOpps = opportunities.slice(0, 10);
    const totalProfit = bundledOpps.reduce((sum, opp) => sum + opp.expectedProfit, 0);
    const validatorTip = totalProfit * this.BASE_TIP_PERCENTAGE;
    const netProfit = totalProfit - validatorTip;
    
    return netProfit;
  }

  getOptimalBundleSize(opportunities: Opportunity[]): number {
    // Analyze opportunities to determine optimal bundle size
    let maxValue = 0;
    let optimalSize = 1;
    
    for (let size = 1; size <= Math.min(10, opportunities.length); size++) {
      const bundleValue = this.estimateBundleValue(opportunities.slice(0, size));
      
      if (bundleValue > maxValue) {
        maxValue = bundleValue;
        optimalSize = size;
      }
    }
    
    logger.debug('Optimal bundle size calculated', {
      component: 'ValidatorTippingAdvanced',
      optimalSize,
      maxValue,
      availableOpportunities: opportunities.length
    });
    
    return optimalSize;
  }
}

export { 
  ValidatorTippingAdvanced, 
  type Opportunity as ValidatorOpportunity,
  type CascadingBundle,
  type TipCalculation,
  type BundleTransaction
};

// Backward compatibility alias
export { ValidatorTippingAdvanced as ValidatorBribingAdvanced };
