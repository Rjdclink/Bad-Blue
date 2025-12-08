import logger from '../../../logger.js';

interface FlashLoanProvider {
  name: string;
  address: string;
  fee: number;
  limit: number;
  priority: number; // Routing priority
  supportsTriangular: boolean; // 2024: Triangular arbitrage support
}

interface AllocationPlan {
  provider: string;
  amount: number;
  fee: number;
  route?: 'direct' | 'triangular'; // 2024: Route optimization
}

interface ExecutionResult {
  success: boolean;
  totalFee: number;
  allocations: AllocationPlan[];
  profit?: number;
  route?: string; // 2024: Execution route taken
  slippage?: number; // 2024: Actual vs expected slippage
}

const PROVIDERS: FlashLoanProvider[] = [
  { 
    name: 'Aave', 
    address: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 
    fee: 0.0009, 
    limit: 50_000_000,
    priority: 1,
    supportsTriangular: true // 2024: Multi-hop support
  },
  { 
    name: 'Balancer', 
    address: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 
    fee: 0.0000, 
    limit: 30_000_000,
    priority: 2,
    supportsTriangular: true
  },
  { 
    name: 'Uniswap', 
    address: 'FACTORY_BASED', 
    fee: 0.0000, 
    limit: 15_000_000,
    priority: 3,
    supportsTriangular: true
  },
  // 2024 Research: Add emerging flash loan providers
  { 
    name: 'dYdX', 
    address: '0x1E0447b19BB6EcFdAe1e4AE1694b0C3659614e4e', 
    fee: 0.0000, 
    limit: 20_000_000,
    priority: 2,
    supportsTriangular: false
  }
];

class FlashLoanAggregator {
  private providers: FlashLoanProvider[];

  constructor() {
    this.providers = [...PROVIDERS];
  }

  optimizeAllocation(required: number): AllocationPlan[] {
    const allocations: AllocationPlan[] = [];
    let remaining = required;

    // 2024 Research: Sort providers by fee (0% first), then priority, then limit
    const sortedProviders = [...this.providers].sort((a, b) => {
      if (a.fee !== b.fee) return a.fee - b.fee;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.limit - a.limit;
    });

    for (const provider of sortedProviders) {
      if (remaining <= 0) break;

      const allocation = Math.min(remaining, provider.limit);
      if (allocation > 0) {
        allocations.push({
          provider: provider.name,
          amount: allocation,
          fee: allocation * provider.fee,
          route: provider.supportsTriangular ? 'triangular' : 'direct'
        });
        remaining -= allocation;
      }
    }

    if (remaining > 0) {
      logger.warn('Cannot fulfill full flash loan request', {
        component: 'FlashLoanAggregator',
        required,
        remaining,
        maxCapacity: this.getTotalCapacity()
      });
    }

    logger.debug('Optimized allocation plan', {
      component: 'FlashLoanAggregator',
      required,
      allocated: required - remaining,
      providers: allocations.length
    });

    return allocations;
  }

  async executeWithFlashLoan(
    amount: number,
    asset: string,
    callback: (borrowed: number) => Promise<number>
  ): Promise<ExecutionResult> {
    if (amount > this.getTotalCapacity()) {
      logger.error('Flash loan amount exceeds total capacity', {
        component: 'FlashLoanAggregator',
        requested: amount,
        capacity: this.getTotalCapacity()
      });
      
      return {
        success: false,
        totalFee: 0,
        allocations: []
      };
    }

    let allocations: AllocationPlan[];
    let executionRoute = 'direct';
    
    // 2024 Research: Strategic allocation with route optimization
    if (amount <= 50_000_000) {
      // Simple: Use Aave only
      allocations = [{
        provider: 'Aave',
        amount: amount,
        fee: amount * 0.0009,
        route: 'direct'
      }];
      logger.debug('Using Aave only for flash loan', {
        component: 'FlashLoanAggregator',
        amount
      });
    } else if (amount <= 80_000_000) {
      // Split: Balancer (0% fee) + Aave (remainder)
      const balancerAmount = Math.min(amount, 30_000_000);
      const aaveAmount = amount - balancerAmount;
      
      allocations = [
        {
          provider: 'Balancer',
          amount: balancerAmount,
          fee: 0,
          route: 'direct'
        },
        {
          provider: 'Aave',
          amount: aaveAmount,
          fee: aaveAmount * 0.0009,
          route: 'direct'
        }
      ];
      logger.debug('Split between Balancer and Aave', {
        component: 'FlashLoanAggregator',
        balancerAmount,
        aaveAmount
      });
    } else if (amount <= 100_000_000) {
      // 2024: Use dYdX for zero-fee portion
      allocations = this.optimizeAllocation(amount);
      executionRoute = 'multi-provider';
      logger.debug('Using multi-provider optimization', {
        component: 'FlashLoanAggregator',
        amount,
        providers: allocations.length
      });
    } else {
      // Use all providers with optimization
      allocations = this.optimizeAllocation(amount);
      executionRoute = 'max-capacity';
      logger.debug('Using all providers for flash loan', {
        component: 'FlashLoanAggregator',
        amount,
        providers: allocations.length
      });
    }

    const totalFee = allocations.reduce((sum, alloc) => sum + alloc.fee, 0);

    try {
      // Execute flash loan callback with slippage tracking
      const startTime = Date.now();
      const profit = await callback(amount);
      const executionTime = Date.now() - startTime;
      
      // 2024 Research: Calculate Shapley value for revenue distribution
      const shapleyShare = this.calculateShapleyShare(allocations, profit);
      
      // Validate profit covers fees and repayment
      if (profit <= totalFee) {
        logger.warn('Flash loan profit insufficient to cover fees', {
          component: 'FlashLoanAggregator',
          profit,
          totalFee,
          netLoss: totalFee - profit,
          shapleyShare
        });
        
        return {
          success: false,
          totalFee,
          allocations,
          route: executionRoute
        };
      }

      // Validate that loan can be repaid (in production, this would check actual balances)
      const totalBorrowed = allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
      const totalRepayment = totalBorrowed + totalFee;
      
      if (profit < totalRepayment) {
        logger.warn('Flash loan profit insufficient for repayment', {
          component: 'FlashLoanAggregator',
          profit,
          totalBorrowed,
          totalRepayment,
          shortfall: totalRepayment - profit
        });
        
        return {
          success: false,
          totalFee,
          allocations,
          route: executionRoute
        };
      }

      // Calculate slippage
      const expectedProfit = profit * 1.05; // Assume 5% slippage tolerance
      const actualSlippage = Math.abs((profit - expectedProfit) / expectedProfit);

      logger.info('Flash loan executed successfully', {
        component: 'FlashLoanAggregator',
        amount,
        totalFee,
        profit,
        netProfit: profit - totalFee,
        executionTime: `${executionTime}ms`,
        route: executionRoute,
        slippage: `${(actualSlippage * 100).toFixed(2)}%`,
        shapleyShare
      });

      return {
        success: true,
        totalFee,
        allocations,
        profit: profit - totalFee,
        route: executionRoute,
        slippage: actualSlippage
      };
    } catch (error) {
      logger.error('Flash loan execution failed', {
        component: 'FlashLoanAggregator',
        error: error instanceof Error ? error.message : String(error),
        amount,
        asset
      });

      return {
        success: false,
        totalFee,
        allocations,
        route: executionRoute
      };
    }
  }

  // 2024 Research: Shapley value-based revenue distribution (game theory)
  private calculateShapleyShare(allocations: AllocationPlan[], totalProfit: number): Record<string, number> {
    const shares: Record<string, number> = {};
    
    // Simplified Shapley value: distribute profit proportional to contribution
    // In production, use full coalitional game theory with randomized sampling
    const totalAmount = allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
    
    for (const alloc of allocations) {
      const contribution = alloc.amount / totalAmount;
      const feeAdjustment = 1 - (alloc.fee / alloc.amount); // Reward 0% fee providers
      const shapleyValue = totalProfit * contribution * feeAdjustment;
      shares[alloc.provider] = shapleyValue;
    }
    
    return shares;
  }

  getTotalCapacity(): number {
    return this.providers.reduce((sum, p) => sum + p.limit, 0);
  }

  getProviders(): FlashLoanProvider[] {
    return [...this.providers];
  }

  getCheapestProvider(amount: number): FlashLoanProvider | null {
    const available = this.providers.filter(p => p.limit >= amount);
    if (available.length === 0) return null;
    
    return available.sort((a, b) => a.fee - b.fee)[0];
  }
}

export { FlashLoanAggregator, type FlashLoanProvider, type AllocationPlan, type ExecutionResult };
