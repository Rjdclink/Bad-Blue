import { providers } from 'ethers';
import { ChainId, NetworkHealth } from './types';
import { SUPPORTED_CHAINS, NETWORK_HEALTH_THRESHOLD_MS } from './chain-config';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';

class NetworkHealthMonitor {
  private healthStatus: Map<ChainId, NetworkHealth> = new Map();
  private inFlightChecks: Map<ChainId, Promise<NetworkHealth>> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private readonly HEALTH_CACHE_TTL_MS = 5000;

  constructor() {
    // Do NOT auto-initialize - wait for manual start
    console.log('[NetworkHealth] Created (inactive - waiting for manual start)');
  }

  private async initializeProviders(): Promise<void> {
    await multiProviderRpcManager.initialize(Object.keys(SUPPORTED_CHAINS) as ChainId[]);
  }

  async checkNetwork(chain: ChainId): Promise<NetworkHealth> {
    const cached = this.healthStatus.get(chain);
    if (cached && Date.now() - cached.lastUpdate < this.HEALTH_CACHE_TTL_MS) {
      return cached;
    }

    const inFlight = this.inFlightChecks.get(chain);
    if (inFlight) {
      return inFlight;
    }

    const checkPromise = (async () => {
      try {
        const startTime = Date.now();

        // Get block height to check connectivity
        const { result: blockHeight, provenance } = await multiProviderRpcManager.execute(chain, 'blocks', provider => provider.getBlockNumber());

        const latency = Date.now() - startTime;

        // Consider network healthy based on configurable threshold
        const isHealthy = latency < NETWORK_HEALTH_THRESHOLD_MS && blockHeight > 0;

        const health: NetworkHealth = {
          chain,
          latency,
          blockHeight,
          isHealthy,
          lastUpdate: Date.now(),
          provenance,
        };

        this.healthStatus.set(chain, health);
        return health;
      } catch (error) {
        console.error(`Error checking network health for ${chain}:`, error);

        // Return cached data if available
        if (this.healthStatus.has(chain)) {
          const previous = this.healthStatus.get(chain)!;
          return {
            ...previous,
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
    })().finally(() => {
      this.inFlightChecks.delete(chain);
    });

    this.inFlightChecks.set(chain, checkPromise);
    return checkPromise;
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
        console.error('[NetworkHealth] Auto-update failed:', error);
      });
    }, 30000);
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('[NetworkHealth] Already running');
      return;
    }
    
    console.log('[NetworkHealth] Starting...');
    this.running = true;
    
    // Initialize providers
    await this.initializeProviders();
    
    // Do initial health check
    await this.checkAllNetworks();
    
    // Start update interval
    this.startAutoUpdate();
    
    console.log('[NetworkHealth] ✓ Started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      console.log('[NetworkHealth] Already stopped');
      return;
    }
    
    console.log('[NetworkHealth] Stopping...');
    this.running = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    console.log('[NetworkHealth] ✓ Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const networkHealth = new NetworkHealthMonitor();
