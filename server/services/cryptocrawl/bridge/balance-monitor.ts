import { ethers } from 'ethers';
import { ChainId, TokenBalance } from './types';
import { SUPPORTED_CHAINS, ERC20_ABI, USER_WALLET, FALLBACK_PRICES } from './chain-config';

class BalanceMonitor {
  private providers: Map<ChainId, ethers.JsonRpcProvider> = new Map();
  private prices: Map<string, number> = new Map();
  private cache: Map<ChainId, TokenBalance> = new Map();
  private lastPriceUpdate: number = 0;
  private readonly PRICE_CACHE_TTL = 60000; // 1 minute
  private running: boolean = false;

  constructor() {
    // Do NOT auto-initialize - wait for manual start
    console.log('[BalanceMonitor] Created (inactive - waiting for manual start)');
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

  private async updatePrices(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPriceUpdate < this.PRICE_CACHE_TTL) {
      return; // Use cached prices
    }

    try {
      const coinIds = 'matic-network,ethereum,avalanche-2,binancecoin,tether,usd-coin';
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      
      this.prices.set('POL', data['matic-network']?.usd || 0);
      this.prices.set('ETH', data['ethereum']?.usd || 0);
      this.prices.set('AVAX', data['avalanche-2']?.usd || 0);
      this.prices.set('BNB', data['binancecoin']?.usd || 0);
      this.prices.set('USDT', data['tether']?.usd || 1);
      this.prices.set('USDC', data['usd-coin']?.usd || 1);
      
      this.lastPriceUpdate = now;
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
      const native = parseFloat(ethers.formatEther(nativeBalanceWei));
      const nativePrice = this.prices.get(config.currency) || 0;
      const nativeUsd = native * nativePrice;

      // Get USDT balance
      const usdtContract = new ethers.Contract(config.usdt, ERC20_ABI, provider);
      const usdtBalanceRaw = await usdtContract.balanceOf(USER_WALLET);
      const usdtDecimals = await usdtContract.decimals();
      const usdt = parseFloat(ethers.formatUnits(usdtBalanceRaw, usdtDecimals));

      // Get USDC balance
      const usdcContract = new ethers.Contract(config.usdc, ERC20_ABI, provider);
      const usdcBalanceRaw = await usdcContract.balanceOf(USER_WALLET);
      const usdcDecimals = await usdcContract.decimals();
      const usdc = parseFloat(ethers.formatUnits(usdcBalanceRaw, usdcDecimals));

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
