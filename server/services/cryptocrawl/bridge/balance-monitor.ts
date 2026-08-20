import { ethers, providers, Contract } from 'ethers';
import { ChainId, TokenBalance } from './types';
import { SUPPORTED_CHAINS, ERC20_ABI, USER_WALLET, FALLBACK_PRICES } from './chain-config';
import { coinGeckoPriceClient } from './coingecko-client';

const { JsonRpcProvider } = providers;
const { formatEther, formatUnits } = ethers.utils;

class BalanceMonitor {
  private providers: Map<ChainId, providers.JsonRpcProvider> = new Map();
  private prices: Map<string, number> = new Map();
  private cache: Map<ChainId, TokenBalance> = new Map();
  private running: boolean = false;

  constructor() {
    // Do NOT auto-initialize - wait for manual start
    console.log('[BalanceMonitor] Created (inactive - waiting for manual start)');
  }

  private initializeProviders(): void {
    Object.entries(SUPPORTED_CHAINS).forEach(([chainId, config]) => {
      try {
        const provider = new JsonRpcProvider(config.rpcUrl);
        this.providers.set(chainId as ChainId, provider);
      } catch (error) {
        console.error(`Failed to initialize provider for ${chainId}:`, error);
      }
    });
  }

  private async updatePrices(): Promise<void> {
    try {
      const prices = await coinGeckoPriceClient.getSymbolPrices(
        ['POL', 'ETH', 'AVAX', 'BNB', 'USDT', 'USDC'],
        FALLBACK_PRICES,
      );

      prices.forEach((value, symbol) => {
        this.prices.set(symbol, value);
      });
    } catch (error) {
      console.error('Failed to update prices:', error);
      // Use fallback prices if API fails
      if (this.prices.size === 0) {
        Object.entries(FALLBACK_PRICES).forEach(([key, value]) => {
          this.prices.set(key, value);
        });
      }
    }
  }

  async getBalance(chain: ChainId): Promise<TokenBalance> {
    try {
      const provider = this.providers.get(chain);
      if (!provider) {
        throw new Error(`Provider not initialized for ${chain}`);
      }

      await this.updatePrices();

      const config = SUPPORTED_CHAINS[chain];
      
      // Get native balance
      const nativeBalanceWei = await provider.getBalance(USER_WALLET);
      const native = parseFloat(formatEther(nativeBalanceWei));
      const nativePrice = this.prices.get(config.currency) || 0;
      const nativeUsd = native * nativePrice;

      // Get USDT balance
      const usdtContract = new Contract(config.usdt, ERC20_ABI, provider);
      const usdtBalanceRaw = await usdtContract.balanceOf(USER_WALLET);
      const usdtDecimals = await usdtContract.decimals();
      const usdt = parseFloat(formatUnits(usdtBalanceRaw, usdtDecimals));

      // Get USDC balance
      const usdcContract = new Contract(config.usdc, ERC20_ABI, provider);
      const usdcBalanceRaw = await usdcContract.balanceOf(USER_WALLET);
      const usdcDecimals = await usdcContract.decimals();
      const usdc = parseFloat(formatUnits(usdcBalanceRaw, usdcDecimals));

      const totalUsd = nativeUsd + usdt + usdc;

      const balance: TokenBalance = {
        chain,
        native,
        nativeUsd,
        usdt,
        usdc,
        totalUsd
      };

      this.cache.set(chain, balance);
      return balance;
    } catch (error) {
      console.error(`Error fetching balance for ${chain}:`, error);
      
      // Return cached data if available
      if (this.cache.has(chain)) {
        return this.cache.get(chain)!;
      }

      // Return zero balance on error
      return {
        chain,
        native: 0,
        nativeUsd: 0,
        usdt: 0,
        usdc: 0,
        totalUsd: 0
      };
    }
  }

  async getAllBalances(): Promise<TokenBalance[]> {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
    const balances = await Promise.all(
      chains.map(chain => this.getBalance(chain))
    );
    return balances;
  }

  async getTotalPortfolioValue(): Promise<number> {
    const balances = await this.getAllBalances();
    return balances.reduce((sum, balance) => sum + balance.totalUsd, 0);
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('[BalanceMonitor] Already running');
      return;
    }
    
    console.log('[BalanceMonitor] Starting...');
    this.running = true;
    
    // Initialize providers
    this.initializeProviders();
    
    console.log('[BalanceMonitor] ✓ Started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      console.log('[BalanceMonitor] Already stopped');
      return;
    }
    
    console.log('[BalanceMonitor] Stopping...');
    this.running = false;
    
    // Clear cache
    this.cache.clear();
    
    console.log('[BalanceMonitor] ✓ Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const balanceMonitor = new BalanceMonitor();
