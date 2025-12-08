import { ethers } from 'ethers';
import { ChainId, GasPrice } from './types';
import { SUPPORTED_CHAINS, FALLBACK_PRICES, DEFAULT_GAS_LIMIT } from './chain-config';

class GasOracle {
  private providers: Map<ChainId, ethers.JsonRpcProvider> = new Map();
  private gasPrices: Map<ChainId, GasPrice> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private nativePrices: Map<string, number> = new Map();
  private running: boolean = false;

  constructor() {
    // Do NOT auto-initialize - wait for manual start
    console.log('[GasOracle] Created (inactive - waiting for manual start)');
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

  private async updateNativePrices(): Promise<void> {
    try {
      const coinIds = 'matic-network,ethereum,avalanche-2,binancecoin';
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      
      this.nativePrices.set('POL', data['matic-network']?.usd || 0.5);
      this.nativePrices.set('ETH', data['ethereum']?.usd || 2000);
      this.nativePrices.set('AVAX', data['avalanche-2']?.usd || 20);
      this.nativePrices.set('BNB', data['binancecoin']?.usd || 300);
    } catch (error) {
      console.error('Failed to update native prices:', error);
      // Use fallback prices
      if (this.nativePrices.size === 0) {
        this.nativePrices.set('POL', 0.5);
        this.nativePrices.set('ETH', 2000);
        this.nativePrices.set('AVAX', 20);
        this.nativePrices.set('BNB', 300);
      }
    }
  }

  private getCongestionLevel(chain: ChainId, gweiPrice: number): 'low' | 'medium' | 'high' {
    const thresholds: Record<ChainId, { low: number; medium: number }> = {
      polygon: { low: 50, medium: 100 },
      arbitrum: { low: 0.1, medium: 0.5 },
      avalanche: { low: 25, medium: 50 },
      bsc: { low: 5, medium: 10 }
    };

    const threshold = thresholds[chain];
    if (gweiPrice <= threshold.low) return 'low';
    if (gweiPrice <= threshold.medium) return 'medium';
    return 'high';
  }

  async getGasPrice(chain: ChainId): Promise<GasPrice> {
    try {
      const provider = this.providers.get(chain);
      if (!provider) {
        throw new Error(`Provider not initialized for ${chain}`);
      }

      await this.updateNativePrices();

      const config = SUPPORTED_CHAINS[chain];
      const feeData = await provider.getFeeData();
      
      // Use maxFeePerGas if available (EIP-1559), otherwise use gasPrice
      const gasPriceWei = feeData.maxFeePerGas || feeData.gasPrice || BigInt(0);
      const gweiPrice = parseFloat(ethers.formatUnits(gasPriceWei, 'gwei'));

      // Estimate transaction cost using configurable gas limit
      const gasLimit = DEFAULT_GAS_LIMIT;
      const nativePrice = this.nativePrices.get(config.currency) || 0;
      const gasCostEth = parseFloat(ethers.formatEther(gasPriceWei * BigInt(gasLimit)));
      const usdCost = gasCostEth * nativePrice;

      const congestionLevel = this.getCongestionLevel(chain, gweiPrice);

      const gasPrice: GasPrice = {
        chain,
        gweiPrice,
        usdCost,
        congestionLevel,
        timestamp: Date.now()
      };

      this.gasPrices.set(chain, gasPrice);
      return gasPrice;
    } catch (error) {
      console.error(`Error fetching gas price for ${chain}:`, error);
      
      // Return cached data if available
      if (this.gasPrices.has(chain)) {
        return this.gasPrices.get(chain)!;
      }

      // Return default gas price on error
      return {
        chain,
        gweiPrice: 0,
        usdCost: 0,
        congestionLevel: 'low',
        timestamp: Date.now()
      };
    }
  }

  async updateAllGasPrices(): Promise<void> {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
    await Promise.all(chains.map(chain => this.getGasPrice(chain)));
  }

  async getCheapestChain(): Promise<ChainId | null> {
    await this.updateAllGasPrices();
    
    let cheapestChain: ChainId | null = null;
    let lowestCost = Infinity;

    this.gasPrices.forEach((gasPrice, chain) => {
      if (gasPrice.usdCost < lowestCost) {
        lowestCost = gasPrice.usdCost;
        cheapestChain = chain;
      }
    });

    return cheapestChain;
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('[GasOracle] Already running');
      return;
    }
    
    console.log('[GasOracle] Starting...');
    this.running = true;
    
    // Initialize providers
    this.initializeProviders();
    
    // Do initial update
    await this.updateAllGasPrices();
    
    // Start update interval (60 seconds instead of 15)
    this.updateInterval = setInterval(() => {
      this.updateAllGasPrices().catch(error => {
        console.error('[GasOracle] Auto-update failed:', error);
      });
    }, 60000);
    
    console.log('[GasOracle] ✓ Started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      console.log('[GasOracle] Already stopped');
      return;
    }
    
    console.log('[GasOracle] Stopping...');
    this.running = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    console.log('[GasOracle] ✓ Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const gasOracle = new GasOracle();
