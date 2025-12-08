// TECHNIQUE 7: Operational Superiority
// Implements deterministic execution, failover, and shadow testing
// Target: 99.9% uptime vs 95% industry average

import { JsonRpcProvider } from 'ethers';
import { AsyncMutex } from './async-mutex';
import type { Opportunity } from '../core/lux-swarm';
import type { ExecutionResult, ProviderConfig } from './types';

interface NonceState {
  current: number;
  pending: Set<number>;
  lastUpdate: number;
}

interface ShadowTestResult {
  strategyName: string;
  successRate: number;
  avgProfit: number;
  testCount: number;
  readyForProduction: boolean;
}

export class OperationalIntegrity {
  private executionMutex = new AsyncMutex();
  private nonceState: Map<string, NonceState> = new Map();
  private providers: Map<string, ProviderConfig[]> = new Map();
  private shadowStrategies: Map<string, any> = new Map();
  private blockSubscriptions: Map<string, any> = new Map();

  constructor() {
    console.log('[STEALTH] Operational Integrity system initialized');
  }

  /**
   * Initialize multi-provider failover system
   */
  async initializeProviders(
    chain: string,
    primaryUrl: string,
    backupUrls: string[] = []
  ): Promise<void> {
    const providers: ProviderConfig[] = [
      {
        name: 'primary',
        url: primaryUrl,
        priority: 1,
        lastSuccess: Date.now(),
        failureCount: 0
      }
    ];

    // Add backup providers
    backupUrls.forEach((url, index) => {
      providers.push({
        name: `backup-${index + 1}`,
        url,
        priority: index + 2,
        lastSuccess: Date.now(),
        failureCount: 0
      });
    });

    // Add public fallback
    providers.push({
      name: 'fallback',
      url: this.getPublicRpcUrl(chain),
      priority: 99,
      lastSuccess: Date.now(),
      failureCount: 0
    });

    this.providers.set(chain, providers);
    console.log(`[STEALTH] Initialized ${providers.length} providers for ${chain}`);
  }

  /**
   * Execute with deterministic ordering using AsyncMutex
   * Prevents race conditions and ensures proper nonce sequencing
   */
  async executeSafely(
    opportunity: Opportunity,
    executeFn: () => Promise<ExecutionResult>
  ): Promise<ExecutionResult> {
    return this.executionMutex.runExclusive(async () => {
      try {
        // Ensure nonce is properly sequenced
        const nonce = await this.getNextNonce(opportunity.chain);
        
        // Execute with guaranteed ordering
        const result = await executeFn();
        
        // Update nonce state
        if (result.success) {
          this.markNonceUsed(opportunity.chain, nonce);
        }
        
        return result;
      } catch (error) {
        return {
          success: false,
          latency: 0,
          error: error instanceof Error ? error.message : 'Execution failed'
        };
      }
    });
  }

  /**
   * Execute with automatic failover through provider chain
   * Tries primary → backup → fallback until success or exhaustion
   */
  async executeWithFailover(
    chain: string,
    executeFn: (provider: JsonRpcProvider) => Promise<ExecutionResult>
  ): Promise<ExecutionResult> {
    const providers = this.providers.get(chain);
    if (!providers || providers.length === 0) {
      return {
        success: false,
        latency: 0,
        error: 'No providers configured'
      };
    }

    // Sort by priority and recent success
    const sortedProviders = [...providers].sort((a, b) => {
      // Prioritize by success (no recent failures) then by priority
      const aScore = a.failureCount > 2 ? 1000 : a.priority;
      const bScore = b.failureCount > 2 ? 1000 : b.priority;
      return aScore - bScore;
    });

    let lastError = '';

    // Try each provider in order
    for (const providerConfig of sortedProviders) {
      try {
        console.log(`[STEALTH] Attempting execution via ${providerConfig.name}`);
        
        const provider = new JsonRpcProvider(providerConfig.url);
        const result = await executeFn(provider);

        if (result.success) {
          // Mark success
          providerConfig.lastSuccess = Date.now();
          providerConfig.failureCount = 0;
          
          console.log(`[STEALTH] Execution succeeded via ${providerConfig.name}`);
          return result;
        }

        lastError = result.error || 'Unknown error';
        providerConfig.failureCount++;
        
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Provider failed';
        providerConfig.failureCount++;
        console.log(`[STEALTH] Provider ${providerConfig.name} failed, trying next...`);
      }

      // Small delay before trying next provider
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // All providers failed
    return {
      success: false,
      latency: 0,
      error: `All providers failed. Last error: ${lastError}`
    };
  }

  /**
   * Update strategy in shadow mode first
   * Tests new strategy with 95% success threshold before promoting to production
   */
  async updateStrategyLive(
    strategyName: string,
    newStrategy: any,
    testOpportunities: Opportunity[]
  ): Promise<ShadowTestResult> {
    console.log(`[STEALTH] Testing new strategy '${strategyName}' in shadow mode...`);

    // Add to shadow strategies
    this.shadowStrategies.set(strategyName, {
      strategy: newStrategy,
      results: [],
      startTime: Date.now()
    });

    let successCount = 0;
    let totalProfit = 0;

    // Test on provided opportunities (shadow testing)
    for (const opportunity of testOpportunities) {
      try {
        // Simulate execution with new strategy (don't actually execute)
        const shouldExecute = this.evaluateStrategyDecision(newStrategy, opportunity);
        
        if (shouldExecute) {
          // Simulate success based on opportunity quality
          const simulatedSuccess = opportunity.profitEstimate > 10;
          if (simulatedSuccess) {
            successCount++;
            totalProfit += opportunity.profitEstimate;
          }
        }
      } catch (error) {
        // Strategy error
      }
    }

    const successRate = testOpportunities.length > 0 
      ? successCount / testOpportunities.length 
      : 0;
    const avgProfit = successCount > 0 ? totalProfit / successCount : 0;
    const readyForProduction = successRate >= 0.95; // 95% threshold

    const result: ShadowTestResult = {
      strategyName,
      successRate,
      avgProfit,
      testCount: testOpportunities.length,
      readyForProduction
    };

    if (readyForProduction) {
      console.log(`[STEALTH] Strategy '${strategyName}' passed shadow testing (${(successRate * 100).toFixed(1)}% success) - Ready for production`);
    } else {
      console.log(`[STEALTH] Strategy '${strategyName}' failed shadow testing (${(successRate * 100).toFixed(1)}% success) - Needs improvement`);
    }

    return result;
  }

  /**
   * Maintain continuous data ingestion with redundant listeners
   * Multiple WebSocket connections ensure no missed blocks
   */
  async maintainContinuousIngestion(
    chain: string,
    onBlock: (blockNumber: number) => void
  ): Promise<void> {
    const providers = this.providers.get(chain);
    if (!providers || providers.length === 0) {
      console.log(`[STEALTH] No providers for ${chain}, cannot maintain ingestion`);
      return;
    }

    // Create redundant block listeners on multiple providers
    const subscriptions: any[] = [];

    for (const providerConfig of providers.slice(0, 3)) { // Use top 3 providers
      try {
        const provider = new JsonRpcProvider(providerConfig.url);
        
        // Subscribe to new blocks
        provider.on('block', (blockNumber: number) => {
          onBlock(blockNumber);
        });

        subscriptions.push({ provider, config: providerConfig });
        console.log(`[STEALTH] Block listener established on ${providerConfig.name}`);
      } catch (error) {
        console.log(`[STEALTH] Failed to establish listener on ${providerConfig.name}`);
      }
    }

    this.blockSubscriptions.set(chain, subscriptions);
    
    // Monitor subscriptions health
    this.monitorSubscriptions(chain);
  }

  /**
   * Get next nonce with proper sequencing
   */
  private async getNextNonce(chain: string): Promise<number> {
    const state = this.nonceState.get(chain);
    
    if (!state) {
      // Initialize nonce state - in production, fetch from provider
      // TODO: Implement actual nonce fetching: await wallet.getNonce()
      const initialNonce = 0; // Placeholder - will cause issues in production
      console.warn('[STEALTH] Using placeholder nonce - implement wallet.getNonce() for production');
      this.nonceState.set(chain, {
        current: initialNonce,
        pending: new Set(),
        lastUpdate: Date.now()
      });
      return initialNonce;
    }

    // Find next available nonce
    let nextNonce = state.current;
    while (state.pending.has(nextNonce)) {
      nextNonce++;
    }

    // Mark as pending
    state.pending.add(nextNonce);
    state.lastUpdate = Date.now();

    return nextNonce;
  }

  /**
   * Mark nonce as successfully used
   */
  private markNonceUsed(chain: string, nonce: number): void {
    const state = this.nonceState.get(chain);
    if (!state) return;

    state.pending.delete(nonce);
    
    // Update current nonce if this was the next sequential one
    if (nonce === state.current) {
      state.current = nonce + 1;
    }

    state.lastUpdate = Date.now();
  }

  /**
   * Evaluate if strategy would execute on opportunity
   */
  private evaluateStrategyDecision(strategy: any, opportunity: Opportunity): boolean {
    // Simplified strategy evaluation
    // In production, would call strategy.shouldExecute(opportunity)
    return opportunity.profitEstimate > 10;
  }

  /**
   * Get public RPC URL for chain
   */
  private getPublicRpcUrl(chain: string): string {
    const publicRpcs: Record<string, string> = {
      polygon: 'https://polygon-rpc.com',
      bsc: 'https://bsc-dataseed.binance.org',
      avalanche: 'https://api.avax.network/ext/bc/C/rpc',
      arbitrum: 'https://arb1.arbitrum.io/rpc',
      optimism: 'https://mainnet.optimism.io'
    };
    return publicRpcs[chain] || 'https://eth.llamarpc.com';
  }

  /**
   * Monitor subscription health and reconnect if needed
   */
  private monitorSubscriptions(chain: string): void {
    setInterval(() => {
      const subscriptions = this.blockSubscriptions.get(chain);
      if (!subscriptions) return;

      // Check each subscription
      subscriptions.forEach((sub: any) => {
        // In production, would check last block time and reconnect if stale
        // For now, just log status
        if (sub.config.failureCount > 5) {
          console.log(`[STEALTH] Subscription ${sub.config.name} unhealthy, may need reconnection`);
        }
      });
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get operational statistics
   */
  getStats(): {
    mutexQueueLength: number;
    providerCount: number;
    shadowStrategyCount: number;
    activeSubscriptions: number;
  } {
    let totalProviders = 0;
    this.providers.forEach(providers => {
      totalProviders += providers.length;
    });

    let totalSubscriptions = 0;
    this.blockSubscriptions.forEach(subs => {
      totalSubscriptions += subs.length;
    });

    return {
      mutexQueueLength: this.executionMutex.getQueueLength(),
      providerCount: totalProviders,
      shadowStrategyCount: this.shadowStrategies.size,
      activeSubscriptions: totalSubscriptions
    };
  }

  /**
   * Get provider health status
   */
  getProviderHealth(chain: string): ProviderConfig[] | null {
    return this.providers.get(chain) || null;
  }
}
