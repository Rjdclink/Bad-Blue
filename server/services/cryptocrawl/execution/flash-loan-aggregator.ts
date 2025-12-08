import logger from '../../../logger.js';

interface FlashLoanProvider {
  name: string;
  address: string;
  fee: number;
  limit: number;
}

interface AllocationPlan {
  provider: string;
  amount: number;
  fee: number;
}

interface ExecutionResult {
  success: boolean;
  totalFee: number;
  allocations: AllocationPlan[];
  profit?: number;
}

const PROVIDERS: FlashLoanProvider[] = [
  { 
    name: 'Aave', 
    address: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 
    fee: 0.0009, 
    limit: 50_000_000 
  },
  { 
    name: 'Balancer', 
    address: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', 
    fee: 0.0000, 
    limit: 30_000_000 
  },
  { 
    name: 'Uniswap', 
    address: 'FACTORY_BASED', 
    fee: 0.0000, 
    limit: 15_000_000 
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

    // Sort providers by fee (0% fee first) and then by limit (higher first)
    const sortedProviders = [...this.providers].sort((a, b) => {
      if (a.fee !== b.fee) return a.fee - b.fee;
      return b.limit - a.limit;
    });

    for (const provider of sortedProviders) {
      if (remaining <= 0) break;

      const allocation = Math.min(remaining, provider.limit);
      if (allocation > 0) {
        allocations.push({
          provider: provider.name,
          amount: allocation,
          fee: allocation * provider.fee
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
    
    // Strategic allocation based on amount
    if (amount <= 50_000_000) {
      // Simple: Use Aave only
      allocations = [{
        provider: 'Aave',
        amount: amount,
        fee: amount * 0.0009
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
          fee: 0
        },
        {
          provider: 'Aave',
          amount: aaveAmount,
          fee: aaveAmount * 0.0009
        }
      ];
      logger.debug('Split between Balancer and Aave', {
        component: 'FlashLoanAggregator',
        balancerAmount,
        aaveAmount
      });
    } else {
      // Use all providers with optimization
      allocations = this.optimizeAllocation(amount);
      logger.debug('Using all providers for flash loan', {
        component: 'FlashLoanAggregator',
        amount,
        providers: allocations.length
      });
    }

    const totalFee = allocations.reduce((sum, alloc) => sum + alloc.fee, 0);

    try {
      // Execute flash loan callback
      const profit = await callback(amount);
      
      // Validate profit covers fees
      if (profit <= totalFee) {
        logger.warn('Flash loan profit insufficient to cover fees', {
          component: 'FlashLoanAggregator',
          profit,
          totalFee,
          netLoss: totalFee - profit
        });
        
        return {
          success: false,
          totalFee,
          allocations
        };
      }

      logger.info('Flash loan executed successfully', {
        component: 'FlashLoanAggregator',
        amount,
        totalFee,
        profit,
        netProfit: profit - totalFee
      });

      return {
        success: true,
        totalFee,
        allocations,
        profit: profit - totalFee
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
        allocations
      };
    }
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
