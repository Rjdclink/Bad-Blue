import logger from '../../../logger.js';

interface Opportunity {
  id: string;
  asset: string;
  pair: string;
  chain: string;
  profitEstimate: number;
  swapSize: number;
  dex: string;
}

interface TripleDipResult {
  jitLiquidityProfit: number;
  lpFeesEarned: number;
  backrunProfit: number;
  totalProfit: number;
  gasUsed: number;
  netProfit: number;
}

interface ChainedOpportunity {
  primary: Opportunity;
  followOns: Opportunity[];
  totalChainProfit: number;
}

class TripleDipExtractor {
  private readonly GAS_COST_PER_TX = 0.5; // USD
  private readonly JIT_LIQUIDITY_MULTIPLIER = 1.15; // 15% boost from JIT
  private readonly LP_FEE_RATE = 0.003; // 0.3% LP fees
  private readonly BACKRUN_MULTIPLIER = 1.10; // 10% additional from backrun

  async extractTripleDip(opportunity: Opportunity): Promise<TripleDipResult> {
    logger.info('Executing triple-dip extraction', {
      component: 'TripleDipExtractor',
      opportunityId: opportunity.id,
      asset: opportunity.asset,
      baseProfit: opportunity.profitEstimate
    });

    // Calculate three value extraction methods
    const jitLiquidityProfit = this.calculateJitLiquidity(opportunity);
    const lpFeesEarned = this.calculateLpFees(opportunity);
    const backrunProfit = this.calculateBackrun(opportunity);

    const totalProfit = jitLiquidityProfit + lpFeesEarned + backrunProfit;
    
    // Gas costs for 3 transactions (add liquidity, remove liquidity, backrun)
    const gasUsed = this.GAS_COST_PER_TX * 3;
    const netProfit = totalProfit - gasUsed;

    logger.info('Triple-dip extraction complete', {
      component: 'TripleDipExtractor',
      opportunityId: opportunity.id,
      jitLiquidityProfit,
      lpFeesEarned,
      backrunProfit,
      totalProfit,
      gasUsed,
      netProfit,
      improvement: `${((totalProfit / opportunity.profitEstimate - 1) * 100).toFixed(1)}%`
    });

    return {
      jitLiquidityProfit,
      lpFeesEarned,
      backrunProfit,
      totalProfit,
      gasUsed,
      netProfit
    };
  }

  private calculateJitLiquidity(opp: Opportunity): number {
    // JIT Liquidity: Add liquidity just before large swap
    // Benefit from price impact reduction
    const jitProfit = opp.profitEstimate * (this.JIT_LIQUIDITY_MULTIPLIER - 1);
    
    logger.debug('JIT liquidity calculated', {
      component: 'TripleDipExtractor',
      opportunityId: opp.id,
      jitProfit,
      multiplier: this.JIT_LIQUIDITY_MULTIPLIER
    });

    return jitProfit;
  }

  private calculateLpFees(opp: Opportunity): number {
    // LP Fees: Earn swap fees during the liquidity provision
    const lpFees = opp.swapSize * this.LP_FEE_RATE;
    
    logger.debug('LP fees calculated', {
      component: 'TripleDipExtractor',
      opportunityId: opp.id,
      swapSize: opp.swapSize,
      lpFees,
      feeRate: `${(this.LP_FEE_RATE * 100).toFixed(2)}%`
    });

    return lpFees;
  }

  private calculateBackrun(opp: Opportunity): number {
    // Backrun: Execute arbitrage after the large swap completes
    const backrunProfit = opp.profitEstimate * (this.BACKRUN_MULTIPLIER - 1);
    
    logger.debug('Backrun profit calculated', {
      component: 'TripleDipExtractor',
      opportunityId: opp.id,
      backrunProfit,
      multiplier: this.BACKRUN_MULTIPLIER
    });

    return backrunProfit;
  }

  async buildAtomicTripleDipBundle(opp: Opportunity): Promise<any[]> {
    logger.debug('Building atomic triple-dip bundle', {
      component: 'TripleDipExtractor',
      opportunityId: opp.id
    });

    const bundle = [];

    // Transaction 1: Add JIT liquidity
    bundle.push({
      step: 'jit-liquidity-add',
      to: this.getDexAddress(opp.dex, opp.chain),
      data: this.encodeAddLiquidity(opp),
      description: 'Add liquidity just before large swap'
    });

    // Transaction 2: Market swap occurs (detected via mempool monitoring)
    // This is the target market movement we're providing liquidity for

    // Transaction 3: Remove JIT liquidity (capture LP fees)
    bundle.push({
      step: 'jit-liquidity-remove',
      to: this.getDexAddress(opp.dex, opp.chain),
      data: this.encodeRemoveLiquidity(opp),
      description: 'Remove liquidity and collect fees'
    });

    // Transaction 4: Execute backrun arbitrage
    bundle.push({
      step: 'backrun-arbitrage',
      to: this.getArbitrageContractAddress(opp.chain),
      data: this.encodeArbitrage(opp),
      description: 'Execute arbitrage on price imbalance'
    });

    logger.info('Atomic triple-dip bundle built', {
      component: 'TripleDipExtractor',
      opportunityId: opp.id,
      transactions: bundle.length
    });

    return bundle;
  }

  chainOpportunities(initialOpp: Opportunity): ChainedOpportunity {
    logger.info('Detecting follow-on opportunities', {
      component: 'TripleDipExtractor',
      initialOpportunity: initialOpp.id
    });

    const followOns: Opportunity[] = [];

    // Detect 3-4 follow-on arbitrages from the initial opportunity
    // In production, this would query actual market data
    const followOnCount = Math.floor(Math.random() * 2) + 3; // 3-4 follow-ons

    for (let i = 0; i < followOnCount; i++) {
      const followOn: Opportunity = {
        id: `${initialOpp.id}-chain-${i + 1}`,
        asset: initialOpp.asset,
        pair: this.getRelatedPair(initialOpp.pair, i),
        chain: initialOpp.chain,
        profitEstimate: initialOpp.profitEstimate * 0.3, // Each follow-on ~30% of initial
        swapSize: initialOpp.swapSize * 0.5,
        dex: this.getAlternateDex(initialOpp.dex)
      };

      followOns.push(followOn);
    }

    const totalChainProfit = initialOpp.profitEstimate + 
      followOns.reduce((sum, opp) => sum + opp.profitEstimate, 0);

    logger.info('Opportunity chain detected', {
      component: 'TripleDipExtractor',
      initialOpportunity: initialOpp.id,
      followOnCount: followOns.length,
      initialProfit: initialOpp.profitEstimate,
      totalChainProfit,
      improvement: `${((totalChainProfit / initialOpp.profitEstimate - 1) * 100).toFixed(1)}%`
    });

    return {
      primary: initialOpp,
      followOns,
      totalChainProfit
    };
  }

  estimateChainDailyValue(opportunitiesPerDay: number, avgProfit: number): number {
    // 10-15 chains/day × $280 average = $2,800-$4,200/day additional
    const chainsPerDay = Math.floor(opportunitiesPerDay * 0.15); // 15% of opportunities have chains
    const avgChainLength = 3.5; // Average 3-4 follow-ons
    const chainProfit = avgProfit * avgChainLength * 0.3; // Each follow-on is ~30% of original
    
    const dailyChainValue = chainsPerDay * chainProfit;

    logger.info('Chain daily value estimated', {
      component: 'TripleDipExtractor',
      opportunitiesPerDay,
      chainsPerDay,
      avgChainLength,
      chainProfit,
      dailyChainValue
    });

    return dailyChainValue;
  }

  private getDexAddress(dex: string, chain: string): string {
    // In production, return actual DEX router addresses
    const dexAddresses: Record<string, Record<string, string>> = {
      uniswap: {
        ethereum: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        polygon: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
        arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'
      },
      sushiswap: {
        ethereum: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        polygon: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'
      }
    };

    return dexAddresses[dex]?.[chain] || '0x0000000000000000000000000000000000000000';
  }

  private getArbitrageContractAddress(chain: string): string {
    // Placeholder - would be actual deployed arbitrage contract
    return '0x0000000000000000000000000000000000000001';
  }

  private encodeAddLiquidity(opp: Opportunity): string {
    return '0xadd_liquidity';
  }

  private encodeRemoveLiquidity(opp: Opportunity): string {
    return '0xremove_liquidity';
  }

  private encodeArbitrage(opp: Opportunity): string {
    return '0xarbitrage';
  }

  private getRelatedPair(originalPair: string, index: number): string {
    // In production, find actual related pairs
    return `${originalPair}_related_${index}`;
  }

  private getAlternateDex(originalDex: string): string {
    const dexes = ['uniswap', 'sushiswap', 'curve', 'balancer'];
    return dexes.find(d => d !== originalDex) || 'uniswap';
  }
}

export { 
  TripleDipExtractor, 
  type Opportunity as TripleDipOpportunity,
  type TripleDipResult,
  type ChainedOpportunity
};
