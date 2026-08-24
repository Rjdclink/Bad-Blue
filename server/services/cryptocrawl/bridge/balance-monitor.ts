import { ethers, Contract } from 'ethers';
import { ChainId, TokenBalance } from './types';
import { SUPPORTED_CHAINS, ERC20_ABI, USER_WALLET, FALLBACK_PRICES } from './chain-config';
import { coinGeckoPriceClient } from './coingecko-client';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';

const { formatEther, formatUnits } = ethers.utils;

export interface VerifiedPortfolioValue {
  status: 'verified' | 'unavailable';
  totalUsd: number;
  balances: TokenBalance[];
  reason?: string;
}

class BalanceMonitor {
  private prices: Map<string, number> = new Map();
  private cache: Map<ChainId, TokenBalance> = new Map();
  private running: boolean = false;

  constructor() {
    // Do NOT auto-initialize - wait for manual start
    console.log('[BalanceMonitor] Created (inactive - waiting for manual start)');
  }

  private async initializeProviders(): Promise<void> {
    await multiProviderRpcManager.initialize(Object.keys(SUPPORTED_CHAINS) as ChainId[]);
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
      await this.initializeProviders();

      await this.updatePrices();

      const config = SUPPORTED_CHAINS[chain];
      const { result: observedBalance, provenance } = await multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
        const nativeBalanceWei = await provider.getBalance(USER_WALLET);
        const native = parseFloat(formatEther(nativeBalanceWei));
        const nativePrice = this.prices.get(config.currency) || 0;
        const nativeUsd = native * nativePrice;
        const usdtContract = new Contract(config.usdt, ERC20_ABI, provider);
        const usdtBalanceRaw = await usdtContract.balanceOf(USER_WALLET);
        const usdtDecimals = await usdtContract.decimals();
        const usdt = parseFloat(formatUnits(usdtBalanceRaw, usdtDecimals));
        const usdcContract = new Contract(config.usdc, ERC20_ABI, provider);
        const usdcBalanceRaw = await usdcContract.balanceOf(USER_WALLET);
        const usdcDecimals = await usdcContract.decimals();
        const usdc = parseFloat(formatUnits(usdcBalanceRaw, usdcDecimals));
        return { native, nativeUsd, usdt, usdc, totalUsd: nativeUsd + usdt + usdc };
      });

      const balance: TokenBalance = {
        chain,
        ...observedBalance,
        provenance,
      };

      this.cache.set(chain, balance);
      return balance;
    } catch (error) {
      console.error(`Error fetching balance for ${chain}:`, error);
      
      throw error;
    }
  }

  async getAllBalances(): Promise<TokenBalance[]> {
    const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
    const balances = await Promise.all(
      chains.map(chain => this.getBalance(chain))
    );
    return balances;
  }

  async getVerifiedPortfolioValue(): Promise<VerifiedPortfolioValue> {
    try {
      await this.initializeProviders();
      const balances = await Promise.all(
        (['polygon', 'arbitrum', 'avalanche', 'bsc'] as ChainId[]).map(chain => this.getBalanceStrict(chain)),
      );
      return {
        status: 'verified',
        totalUsd: balances.reduce((sum, balance) => sum + balance.totalUsd, 0),
        balances,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        totalUsd: 0,
        balances: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getBalanceStrict(chain: ChainId): Promise<TokenBalance> {
    await this.initializeProviders();
    await this.updatePrices();
    const config = SUPPORTED_CHAINS[chain];
    const { result, provenance } = await multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
      const native = parseFloat(formatEther(await provider.getBalance(USER_WALLET)));
      const nativeUsd = native * (this.prices.get(config.currency) || 0);
      const usdtContract = new Contract(config.usdt, ERC20_ABI, provider);
      const usdt = parseFloat(formatUnits(await usdtContract.balanceOf(USER_WALLET), await usdtContract.decimals()));
      const usdcContract = new Contract(config.usdc, ERC20_ABI, provider);
      const usdc = parseFloat(formatUnits(await usdcContract.balanceOf(USER_WALLET), await usdcContract.decimals()));
      return { native, nativeUsd, usdt, usdc, totalUsd: nativeUsd + usdt + usdc };
    });
    return { chain, ...result, provenance };
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
    await this.initializeProviders();
    
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
