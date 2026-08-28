import { ethers } from 'ethers';
import { ChainId, GasPrice } from './types';
import { SUPPORTED_CHAINS, FALLBACK_PRICES, DEFAULT_GAS_LIMIT } from './chain-config';
import { coinGeckoPriceClient } from './coingecko-client';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';

const { formatUnits, formatEther } = ethers.utils;

class GasOracle {
  private gasPrices: Map<ChainId, GasPrice> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private nativePrices: Map<string, number> = new Map();
  private running: boolean = false;

  constructor() {
    // Do NOT auto-initialize - wait for manual start
    console.log('[GasOracle] Created (inactive - waiting for manual start)');
  }

  private async initializeProviders(): Promise<void> {
    await multiProviderRpcManager.initialize(Object.keys(SUPPORTED_CHAINS) as ChainId[]);
  }

  private async updateNativePrices(): Promise<void> {
    try {
      const prices = await coinGeckoPriceClient.getSymbolPrices(
        ['POL', 'ETH', 'AVAX', 'BNB'],
        FALLBACK_PRICES,
      );

      this.nativePrices.set('POL', prices.get('POL') || FALLBACK_PRICES.POL);
      this.nativePrices.set('ETH', prices.get('ETH') || FALLBACK_PRICES.ETH);
      this.nativePrices.set('AVAX', prices.get('AVAX') || FALLBACK_PRICES.AVAX);
      this.nativePrices.set('BNB', prices.get('BNB') || FALLBACK_PRICES.BNB);
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
      // Lazy provider initialization so callers don't have to remember to call start().
      // This keeps the faucet/arbitrage verifier deterministic and avoids a "null cheapest chain" trap.
      await this.initializeProviders();

      await this.updateNativePrices();

      const config = SUPPORTED_CHAINS[chain];
      const { result: feeData, provenance } = await multiProviderRpcManager.execute(chain, 'gas', provider => provider.getFeeData());
      
      // Use maxFeePerGas if available (EIP-1559), otherwise use gasPrice
      const gasPriceWei = feeData.maxFeePerGas || feeData.gasPrice || ethers.BigNumber.from(0);
      const gweiPrice = parseFloat(formatUnits(gasPriceWei, 'gwei'));

      // Estimate transaction cost using configurable gas limit
      const gasLimit = DEFAULT_GAS_LIMIT;
      const nativePrice = this.nativePrices.get(config.currency) || 0;
      const gasCostEth = parseFloat(formatEther(gasPriceWei.mul(gasLimit)));
      const usdCost = gasCostEth * nativePrice;

      const congestionLevel = this.getCongestionLevel(chain, gweiPrice);

      const gasPrice: GasPrice = {
        chain,
        gweiPrice,
        usdCost,
        congestionLevel,
        timestamp: Date.now(),
        provenance,
      };

      this.gasPrices.set(chain, gasPrice);
      return gasPrice;
    } catch (error) {
      console.error(`Error fetching gas price for ${chain}:`, error);
      
      // An unavailable estimate must not be represented by stale or free gas.
      throw error;
    }
  }

  async checkChainConnectivity(chain: ChainId): Promise<boolean> {
    try {
      await this.initializeProviders();
      await multiProviderRpcManager.execute(chain, 'network', async provider => {
        await provider.getNetwork();
        await provider.getBlockNumber();
      });
      return true;
    } catch {
      return false;
    }
  }

  async updateAllGasPrices(): Promise<void> {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
    const results = await Promise.allSettled(chains.map(chain => this.getGasPrice(chain)));
    const unavailable = results.flatMap((result, index) => result.status === 'rejected'
      ? [{
          chain: chains[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }]
      : []);

    if (unavailable.length > 0) {
      console.warn('[GasOracle] Chain-local gas telemetry unavailable; healthy chains remain active', {
        unavailable,
        availableChains: chains.filter(chain => this.gasPrices.has(chain)),
      });
    }

    if (this.gasPrices.size === 0) {
      throw new Error('GasOracle has no live gas evidence from any supported chain');
    }
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
    const startNonce = Date.now();
    
    // Initialize providers
    await this.initializeProviders();
    
    // Do initial update. Individual chain failures are topology-local; at least one
    // chain must still provide live gas evidence before the oracle is considered running.
    await this.updateAllGasPrices();

    // If stop() was called while we were awaiting the initial update, abort cleanly.
    if (!this.running) {
      console.log('[GasOracle] Start aborted (stopped during initialization)', { startNonce });
      return;
    }
    
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
