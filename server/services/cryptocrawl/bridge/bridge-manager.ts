import { ChainId, TokenBalance, GasPrice, BridgeRoute, PositionRecommendation, NetworkHealth } from './types';
import { balanceMonitor } from './balance-monitor';
import { gasOracle } from './gas-oracle';
import { routeOptimizer } from './route-optimizer';
import { positionRecommender } from './position-recommender';
import { networkHealth } from './network-health';
import { withdrawDepositManager } from './withdraw-deposit';

export interface BridgeManagerState {
  running: boolean;
  balances: TokenBalance[];
  gasPrices: GasPrice[];
  recommendations: PositionRecommendation[];
  networkHealth: NetworkHealth[];
  totalPortfolioValue: number;
  lastUpdate: number;
}

export class BridgeManager {
  private running = false;
  private lastUpdate = 0;

  constructor() {
    console.log('[BridgeManager] Created (inactive - waiting for manual start)');
  }

  async start(): Promise<void> {
    if (this.running) return;
    console.log('[BridgeManager] Starting...');
    this.running = true;
    
    await Promise.all([
      balanceMonitor.start(),
      gasOracle.start(),
      networkHealth.start(),
      withdrawDepositManager.initialize()
    ]);
    
    this.lastUpdate = Date.now();
    console.log('[BridgeManager] ✓ Started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    console.log('[BridgeManager] Stopping...');
    this.running = false;
    
    await Promise.all([
      balanceMonitor.stop(),
      gasOracle.stop(),
      networkHealth.stop()
    ]);
    
    console.log('[BridgeManager] ✓ Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  async getFullState(): Promise<BridgeManagerState> {
    if (!this.running) {
      return { running: false, balances: [], gasPrices: [], recommendations: [], networkHealth: [], totalPortfolioValue: 0, lastUpdate: 0 };
    }

    const [balances, gasPricesMap, healthMap] = await Promise.all([
      balanceMonitor.getAllBalances(),
      gasOracle.getAllGasPrices(),
      networkHealth.getHealthStatus()
    ]);

    const gasPrices = Array.from(gasPricesMap.values());
    const health = Array.from(healthMap.values());
    const recommendations = await positionRecommender.getRecommendations(balances, gasPricesMap);
    const totalPortfolioValue = balances.reduce((sum, b) => sum + b.totalUsd, 0);
    this.lastUpdate = Date.now();

    return { running: true, balances, gasPrices, recommendations, networkHealth: health, totalPortfolioValue, lastUpdate: this.lastUpdate };
  }

  async getBalances(): Promise<TokenBalance[]> {
    return this.running ? balanceMonitor.getAllBalances() : [];
  }

  async getGasPrices(): Promise<GasPrice[]> {
    return this.running ? Array.from(gasOracle.getAllGasPrices().values()) : [];
  }

  async getRecommendations(): Promise<PositionRecommendation[]> {
    if (!this.running) return [];
    const balances = await balanceMonitor.getAllBalances();
    return positionRecommender.getRecommendations(balances, gasOracle.getAllGasPrices());
  }

  getBridgeRoutes(from: ChainId, to: ChainId, token: 'USDT' | 'USDC', amount: number): BridgeRoute[] {
    return routeOptimizer.getAvailableRoutes(from, to, token, amount);
  }

  recordTrade(chain: ChainId, profitUsd: number): void {
    positionRecommender.recordTradePerformance(chain, profitUsd);
  }

  getHealthyChains(): ChainId[] {
    return networkHealth.getHealthyChains();
  }
}

export const bridgeManager = new BridgeManager();
