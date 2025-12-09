// Defensive Trading Mode - Adaptive Strategies for Non-Ideal Conditions
// Implements defensive strategies when market conditions are average or poor
// Research-backed: Based on institutional risk management and regime-switching models

import logger from '../../../logger.js';
import { 
  marketConditionDetector, 
  type MarketConditionLevel, 
  type MarketConditionResult,
  type MarketMetrics 
} from './market-condition-detector';

export interface DefensiveConfig {
  // Position sizing
  idealPositionMultiplier: number;
  averagePositionMultiplier: number;
  poorPositionMultiplier: number;
  
  // Profit thresholds
  idealMinProfit: number;
  averageMinProfit: number;
  poorMinProfit: number;
  
  // Confirmation requirements
  idealConfirmations: number;
  averageConfirmations: number;
  poorConfirmations: number;
  
  // Stop-loss settings
  idealStopLoss: number;
  averageStopLoss: number;
  poorStopLoss: number;
  
  // Win rate tracking for circuit breaker
  minWinRateThreshold: number;
  winRateWindow: number;
  consecutiveLossLimit: number;
  
  // Daily limits
  maxDailyLoss: number;
  maxDailyTrades: number;
  
  // Flash loan preference in defensive mode
  preferFlashLoans: boolean;
}

export interface TradeConfirmation {
  source: string;
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  timestamp: number;
}

export interface DefensiveTradeParams {
  positionSize: number;
  minProfitThreshold: number;
  stopLossPercent: number;
  useFlashLoan: boolean;
  confirmationsRequired: number;
  slippageTolerance: number;
  maxExecutionTime: number;
}

export interface TradeRecord {
  timestamp: number;
  success: boolean;
  profit: number;
  condition: MarketConditionLevel;
}

const DEFAULT_CONFIG: DefensiveConfig = {
  // Position sizing multipliers
  idealPositionMultiplier: 1.0,
  averagePositionMultiplier: 0.5,
  poorPositionMultiplier: 0.2,
  
  // Minimum profit thresholds (in ETH)
  idealMinProfit: 0.001,
  averageMinProfit: 0.002,
  poorMinProfit: 0.005,
  
  // Required confirmations
  idealConfirmations: 1,
  averageConfirmations: 2,
  poorConfirmations: 3,
  
  // Stop-loss percentages
  idealStopLoss: 0.05,
  averageStopLoss: 0.03,
  poorStopLoss: 0.02,
  
  // Circuit breaker settings
  minWinRateThreshold: 0.1,
  winRateWindow: 10,
  consecutiveLossLimit: 3,
  
  // Daily limits
  maxDailyLoss: 1.0,
  maxDailyTrades: 100,
  
  // Flash loan preference
  preferFlashLoans: true,
};

class DefensiveTradingMode {
  private config: DefensiveConfig;
  private isDefensiveActive: boolean = false;
  private tradeHistory: TradeRecord[] = [];
  private dailyPnL: number = 0;
  private dailyTradeCount: number = 0;
  private dailyResetTime: number = Date.now();
  private consecutiveLosses: number = 0;
  private isPaused: boolean = false;
  private pauseReason: string = '';
  private confirmations: Map<string, TradeConfirmation[]> = new Map();

  constructor(config: Partial<DefensiveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get adaptive trade parameters based on current market conditions
   */
  getTradeParams(
    basePositionSize: number, 
    baseMinProfit: number,
    marketMetrics?: MarketMetrics
  ): DefensiveTradeParams {
    // Update market condition if metrics provided
    let condition: MarketConditionResult;
    if (marketMetrics) {
      condition = marketConditionDetector.detect(marketMetrics);
    } else {
      condition = marketConditionDetector.getLastDetection() || {
        level: 'average',
        confidence: 0.5,
        score: 50,
        metrics: {} as MarketMetrics,
        factors: [],
        timestamp: Date.now(),
        recommendations: [],
      };
    }

    const level = condition.level;
    this.isDefensiveActive = level !== 'ideal';

    // Adaptive position sizing
    let positionMultiplier: number;
    let minProfitThreshold: number;
    let stopLossPercent: number;
    let confirmationsRequired: number;
    let slippageTolerance: number;
    let maxExecutionTime: number;

    switch (level) {
      case 'ideal':
        positionMultiplier = this.config.idealPositionMultiplier;
        minProfitThreshold = baseMinProfit * 1.0;
        stopLossPercent = this.config.idealStopLoss;
        confirmationsRequired = this.config.idealConfirmations;
        slippageTolerance = 0.02;
        maxExecutionTime = 5000;
        break;
        
      case 'average':
        positionMultiplier = this.config.averagePositionMultiplier;
        minProfitThreshold = baseMinProfit * 1.5;
        stopLossPercent = this.config.averageStopLoss;
        confirmationsRequired = this.config.averageConfirmations;
        slippageTolerance = 0.015;
        maxExecutionTime = 3000;
        break;
        
      case 'poor':
      default:
        positionMultiplier = this.config.poorPositionMultiplier;
        minProfitThreshold = baseMinProfit * 2.5;
        stopLossPercent = this.config.poorStopLoss;
        confirmationsRequired = this.config.poorConfirmations;
        slippageTolerance = 0.01;
        maxExecutionTime = 2000;
        break;
    }

    // Further reduce if consecutive losses
    if (this.consecutiveLosses >= 2) {
      positionMultiplier *= 0.5;
      minProfitThreshold *= 1.5;
    }

    // Prefer flash loans in defensive mode
    const useFlashLoan = this.isDefensiveActive && this.config.preferFlashLoans;

    logger.debug('Defensive trade params calculated', {
      component: 'DefensiveTradingMode',
      level,
      positionMultiplier,
      minProfitThreshold,
      useFlashLoan,
    });

    return {
      positionSize: basePositionSize * positionMultiplier,
      minProfitThreshold,
      stopLossPercent,
      useFlashLoan,
      confirmationsRequired,
      slippageTolerance,
      maxExecutionTime,
    };
  }

  /**
   * Add a confirmation signal for a trade
   */
  addConfirmation(tradeId: string, confirmation: TradeConfirmation): void {
    if (!this.confirmations.has(tradeId)) {
      this.confirmations.set(tradeId, []);
    }
    this.confirmations.get(tradeId)!.push(confirmation);
  }

  /**
   * Check if trade has enough confirmations
   */
  hasEnoughConfirmations(tradeId: string, required: number): boolean {
    const confirms = this.confirmations.get(tradeId) || [];
    
    // Count confirmations in same direction
    const buySignals = confirms.filter(c => c.signal === 'buy').length;
    const sellSignals = confirms.filter(c => c.signal === 'sell').length;
    
    return Math.max(buySignals, sellSignals) >= required;
  }

  /**
   * Get confirmation consensus
   */
  getConfirmationConsensus(tradeId: string): { direction: 'buy' | 'sell' | 'hold'; confidence: number } {
    const confirms = this.confirmations.get(tradeId) || [];
    
    if (confirms.length === 0) {
      return { direction: 'hold', confidence: 0 };
    }

    const buyCount = confirms.filter(c => c.signal === 'buy').length;
    const sellCount = confirms.filter(c => c.signal === 'sell').length;
    
    if (buyCount > sellCount) {
      return { 
        direction: 'buy', 
        confidence: buyCount / confirms.length,
      };
    } else if (sellCount > buyCount) {
      return { 
        direction: 'sell', 
        confidence: sellCount / confirms.length,
      };
    } else {
      return { direction: 'hold', confidence: 0 };
    }
  }

  /**
   * Clear confirmations for a trade
   */
  clearConfirmations(tradeId: string): void {
    this.confirmations.delete(tradeId);
  }

  /**
   * Check if trading should be allowed
   */
  canTrade(): { allowed: boolean; reason?: string } {
    // Check daily reset
    this.checkDailyReset();

    // Check if paused
    if (this.isPaused) {
      return { allowed: false, reason: this.pauseReason };
    }

    // Check daily trade limit
    if (this.dailyTradeCount >= this.config.maxDailyTrades) {
      return { allowed: false, reason: 'Daily trade limit reached' };
    }

    // Check daily loss limit
    if (this.dailyPnL <= -this.config.maxDailyLoss) {
      return { allowed: false, reason: 'Daily loss limit reached' };
    }

    // Check consecutive loss limit
    if (this.consecutiveLosses >= this.config.consecutiveLossLimit) {
      return { allowed: false, reason: 'Consecutive loss limit reached' };
    }

    // Check win rate over window
    const winRate = this.getRecentWinRate();
    if (this.tradeHistory.length >= this.config.winRateWindow && 
        winRate < this.config.minWinRateThreshold) {
      return { allowed: false, reason: `Win rate too low: ${(winRate * 100).toFixed(1)}%` };
    }

    // Check market condition detector recommendation
    if (marketConditionDetector.shouldPauseTrading()) {
      return { allowed: false, reason: 'Market conditions too poor' };
    }

    return { allowed: true };
  }

  /**
   * Record a trade result
   */
  recordTrade(success: boolean, profit: number): void {
    const condition = marketConditionDetector.getCurrentLevel();
    
    const record: TradeRecord = {
      timestamp: Date.now(),
      success,
      profit,
      condition,
    };

    this.tradeHistory.push(record);
    
    // Limit history size
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory = this.tradeHistory.slice(-500);
    }

    // Update daily stats
    this.dailyPnL += profit;
    this.dailyTradeCount++;

    // Update consecutive losses
    if (profit < 0) {
      this.consecutiveLosses++;
    } else if (profit > 0) {
      this.consecutiveLosses = 0;
    }

    // Check for pause conditions
    this.checkPauseConditions();

    logger.debug('Trade recorded', {
      component: 'DefensiveTradingMode',
      success,
      profit,
      condition,
      consecutiveLosses: this.consecutiveLosses,
      dailyPnL: this.dailyPnL,
    });
  }

  /**
   * Get recent win rate
   */
  getRecentWinRate(): number {
    const window = this.config.winRateWindow;
    const recentTrades = this.tradeHistory.slice(-window);
    
    if (recentTrades.length === 0) return 1.0;
    
    const wins = recentTrades.filter(t => t.success && t.profit > 0).length;
    return wins / recentTrades.length;
  }

  /**
   * Check if daily stats need reset
   */
  private checkDailyReset(): void {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    if (now - this.dailyResetTime > dayMs) {
      this.dailyPnL = 0;
      this.dailyTradeCount = 0;
      this.dailyResetTime = now;
      
      // Also reset pause if it was due to daily limits
      if (this.pauseReason.includes('Daily')) {
        this.unpause();
      }

      logger.info('Daily stats reset', {
        component: 'DefensiveTradingMode',
      });
    }
  }

  /**
   * Check if trading should be paused
   */
  private checkPauseConditions(): void {
    // Pause on consecutive losses
    if (this.consecutiveLosses >= this.config.consecutiveLossLimit) {
      this.pause(`${this.consecutiveLosses} consecutive losses`);
      return;
    }

    // Pause on daily loss
    if (this.dailyPnL <= -this.config.maxDailyLoss) {
      this.pause('Daily loss limit reached');
      return;
    }

    // Pause on low win rate
    if (this.tradeHistory.length >= this.config.winRateWindow) {
      const winRate = this.getRecentWinRate();
      if (winRate < this.config.minWinRateThreshold) {
        this.pause(`Win rate ${(winRate * 100).toFixed(1)}% below threshold`);
        return;
      }
    }
  }

  /**
   * Pause trading
   */
  pause(reason: string): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.pauseReason = reason;
      
      logger.warn('Trading paused', {
        component: 'DefensiveTradingMode',
        reason,
      });
    }
  }

  /**
   * Unpause trading (requires explicit call)
   */
  unpause(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.pauseReason = '';
      this.consecutiveLosses = 0;
      
      logger.info('Trading unpaused', {
        component: 'DefensiveTradingMode',
      });
    }
  }

  /**
   * Get current status
   */
  getStatus(): {
    isDefensiveActive: boolean;
    isPaused: boolean;
    pauseReason: string;
    dailyPnL: number;
    dailyTradeCount: number;
    consecutiveLosses: number;
    recentWinRate: number;
    currentCondition: MarketConditionLevel;
  } {
    return {
      isDefensiveActive: this.isDefensiveActive,
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
      dailyPnL: this.dailyPnL,
      dailyTradeCount: this.dailyTradeCount,
      consecutiveLosses: this.consecutiveLosses,
      recentWinRate: this.getRecentWinRate(),
      currentCondition: marketConditionDetector.getCurrentLevel(),
    };
  }

  /**
   * Get statistics by condition level
   */
  getStatsByCondition(): Record<MarketConditionLevel, { trades: number; wins: number; profit: number }> {
    const stats: Record<MarketConditionLevel, { trades: number; wins: number; profit: number }> = {
      ideal: { trades: 0, wins: 0, profit: 0 },
      average: { trades: 0, wins: 0, profit: 0 },
      poor: { trades: 0, wins: 0, profit: 0 },
    };

    for (const trade of this.tradeHistory) {
      stats[trade.condition].trades++;
      if (trade.success && trade.profit > 0) {
        stats[trade.condition].wins++;
      }
      stats[trade.condition].profit += trade.profit;
    }

    return stats;
  }

  /**
   * Reset defensive mode state
   */
  reset(): void {
    this.isDefensiveActive = false;
    this.tradeHistory = [];
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.dailyResetTime = Date.now();
    this.consecutiveLosses = 0;
    this.isPaused = false;
    this.pauseReason = '';
    this.confirmations.clear();

    logger.info('Defensive trading mode reset', {
      component: 'DefensiveTradingMode',
    });
  }
}

// Singleton instance
export const defensiveTradingMode = new DefensiveTradingMode();
export { DefensiveTradingMode };
