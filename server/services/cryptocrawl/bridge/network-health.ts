import { ethers } from 'ethers';
import { ChainId, NetworkHealth } from './types';
import { SUPPORTED_CHAINS } from './chain-config';

class NetworkHealthMonitor {
  private providers: Map<ChainId, ethers.JsonRpcProvider> = new Map();
  private healthStatus: Map<ChainId, NetworkHealth> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeProviders();
    this.startAutoUpdate();
  }

  private initializeProviders(): void {
    Object.entries(SUPPORTED_CHAINS).forEach(([chainId, config]) => {
      try {
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.providers.set(chainId as ChainId, provider);
      } catch (error) {
        console.error(`Failed to initialize provider for ${chainId}:`, error);
      }
    });
  }

  async checkNetwork(chain: ChainId): Promise<NetworkHealth> {
    try {
      const provider = this.providers.get(chain);
      if (!provider) {
        throw new Error(`Provider not initialized for ${chain}`);
      }

      const startTime = Date.now();
      
      // Get block height to check connectivity
      const blockHeight = await provider.getBlockNumber();
      
      const latency = Date.now() - startTime;

      // Consider network healthy if latency < 5 seconds
      const isHealthy = latency < 5000 && blockHeight > 0;

      const health: NetworkHealth = {
        chain,
        latency,
        blockHeight,
        isHealthy,
        lastUpdate: Date.now()
      };

      this.healthStatus.set(chain, health);
      return health;
    } catch (error) {
      console.error(`Error checking network health for ${chain}:`, error);
      
      // Return cached data if available
      if (this.healthStatus.has(chain)) {
        const cached = this.healthStatus.get(chain)!;
        return {
          ...cached,
          isHealthy: false,
          lastUpdate: Date.now()
        };
      }

      // Return unhealthy status on error
      return {
        chain,
        latency: -1,
        blockHeight: 0,
        isHealthy: false,
        lastUpdate: Date.now()
      };
    }
  }

  async checkAllNetworks(): Promise<NetworkHealth[]> {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
    const healthChecks = await Promise.all(
      chains.map(chain => this.checkNetwork(chain))
    );
    return healthChecks;
  }

  async getHealthyChains(): Promise<ChainId[]> {
    const healthChecks = await this.checkAllNetworks();
    return healthChecks
      .filter(health => health.isHealthy)
      .map(health => health.chain);
  }

  async getBestPerformingChain(): Promise<ChainId | null> {
    const healthChecks = await this.checkAllNetworks();
    
    const healthyChains = healthChecks.filter(health => health.isHealthy);
    if (healthyChains.length === 0) {
      return null;
    }

    // Sort by latency (ascending) and return the chain with lowest latency
    healthyChains.sort((a, b) => a.latency - b.latency);
    return healthyChains[0].chain;
  }

  private startAutoUpdate(): void {
    // Update network health every 30 seconds
    this.updateInterval = setInterval(() => {
      this.checkAllNetworks().catch(error => {
        console.error('Auto-update network health failed:', error);
      });
    }, 30000);
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

export const networkHealth = new NetworkHealthMonitor();
