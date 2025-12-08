// Master Pipeline - Integration with Stealth Superiority System
// Connects Starburst Snake, Lux Swarm, and Stealth systems for crushing performance

import { Wallet, JsonRpcProvider } from 'ethers';
import { LuxSwarm, type Opportunity } from '../core/lux-swarm';
import { StealthSuperiority } from '../stealth';
import type { ExecutionResult, StealthMetrics } from '../stealth/types';

class MasterPipeline {
  private running = false;
  private stealthSystem?: StealthSuperiority;
  private providers = new Map<string, JsonRpcProvider>();
  private wallet?: Wallet;
  private executionInterval?: NodeJS.Timeout;

  /**
   * Initialize the pipeline with stealth systems
   */
  async initialize(): Promise<void> {
    console.log('🚀 Master Pipeline initializing with Stealth Superiority...');

    // Initialize stealth system
    this.stealthSystem = new StealthSuperiority();

    // In production, initialize wallet and providers from WalletManager
    // For now, create placeholder
    if (process.env.PRIVATE_KEY) {
      this.wallet = new Wallet(process.env.PRIVATE_KEY);
    }

    // Initialize providers for supported chains
    const chains = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      const rpcUrl = process.env[`${chain.toUpperCase()}_RPC_URL`] || `https://rpc.${chain}.network`;
      this.providers.set(chain, new JsonRpcProvider(rpcUrl));
    }

    // Initialize stealth system if wallet is available
    if (this.wallet && this.providers.size > 0) {
      await this.stealthSystem.initialize(this.wallet, this.providers);
    }

    console.log('✅ Master Pipeline initialized with stealth systems');
  }

  /**
   * Start the main pipeline loop
   */
  async run(): Promise<void> {
    if (!this.stealthSystem) {
      await this.initialize();
    }

    this.running = true;
    console.log('🚀 Master Pipeline started with Stealth Superiority enabled');

    // Main execution loop
    this.executionInterval = setInterval(async () => {
      if (!this.running) return;

      try {
        // Get current opportunities from LuxSwarm
        const opportunities = await this.getCurrentOpportunities();

        if (opportunities.length > 0) {
          // Execute with stealth superiority
          await this.executeOpportunitiesWithStealth(opportunities);
        }
      } catch (error) {
        console.error('[PIPELINE] Error in execution loop:', error);
      }
    }, 1000); // Check every second
  }

  /**
   * Execute opportunities using stealth system
   */
  private async executeOpportunitiesWithStealth(opportunities: Opportunity[]): Promise<void> {
    if (!this.stealthSystem) return;

    // Filter high-priority opportunities
    const highPriority = opportunities
      .filter(opp => opp.priority >= 7 && opp.profitEstimate > 50)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10); // Top 10 opportunities

    if (highPriority.length > 0) {
      console.log(`[PIPELINE] Executing ${highPriority.length} high-priority opportunities with stealth...`);
      
      // Execute batch with stealth superiority
      const results = await this.stealthSystem.executeBatch(highPriority);
      
      // Log results (invisibly)
      const successful = results.filter(r => r.success).length;
      if (successful > 0) {
        console.log(`[PIPELINE] Completed processing: ${successful}/${results.length} successful`);
      }
    }
  }

  /**
   * Get current opportunities from LuxSwarm
   */
  async getCurrentOpportunities(): Promise<Opportunity[]> {
    // Observe current state from LuxSwarm
    const state = LuxSwarm.observe();
    return state.opportunities;
  }

  /**
   * Get stealth metrics for monitoring
   */
  getStealthMetrics(): StealthMetrics | null {
    return this.stealthSystem?.getMetrics() || null;
  }

  /**
   * Get full system status
   */
  getSystemStatus(): any {
    if (!this.stealthSystem) {
      return { error: 'Stealth system not initialized' };
    }

    const status = this.stealthSystem.getSystemStatus();
    const comparison = this.stealthSystem.getComparisonToBaseline();

    return {
      running: this.running,
      stealth: status,
      comparison,
      timestamp: Date.now()
    };
  }

  /**
   * Check if pipeline is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Stop the pipeline
   */
  stop(): void {
    this.running = false;
    
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = undefined;
    }

    console.log('🛑 Master Pipeline stopped');
  }
}

export const pipeline = new MasterPipeline();
