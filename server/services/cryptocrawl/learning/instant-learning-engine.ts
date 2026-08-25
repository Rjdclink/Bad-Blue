// Instant Learning Integration
// Ensures every Monte Carlo simulation contributes to learning
// Learning is stored in Supabase and instantly accessible on system startup
// 
// KEY FEATURES:
// - Real-time learning from every simulation
// - Persistent storage in Supabase
// - Instant loading on system startup
// - Automatic parameter optimization
// - Continuous evolution based on results

import logger from '../../../logger.js';
import { randomUUID } from 'crypto';
import { deepLearningStore, type LearnedParameter } from './deep-learning-store';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EDEN_CONFIG } from '../eden/config';
import { getCryptocrawlGovernance } from '../governance/index.js';
import type { MarketConditionLevel } from '../core/market-condition-detector.js';
import type { SimulationResult, StrategyProfile, MarketCondition } from '../validation/monte-carlo-engine';
import type { ExecutionOutcomeObservation } from './execution-outcome.js';

// ============================================
// INSTANT LEARNING CONFIGURATION
// ============================================

const LEARNING_CONFIG = {
  // Learning rates for different scenarios
  LEARNING_RATE_HIGH_CONFIDENCE: 0.15,
  LEARNING_RATE_MEDIUM_CONFIDENCE: 0.10,
  LEARNING_RATE_LOW_CONFIDENCE: 0.05,
  
  // Thresholds
  HIGH_CONFIDENCE_SAMPLE_SIZE: 50,
  MEDIUM_CONFIDENCE_SAMPLE_SIZE: 20,
  
  // Persistence intervals
  IMMEDIATE_PERSIST_THRESHOLD: 10,  // Persist after every 10 simulations
  
  // Parameter bounds
  SUCCESS_RATE_MIN: 0.20,
  SUCCESS_RATE_MAX: 0.98,
  SLIPPAGE_MIN: 0.001,
  SLIPPAGE_MAX: 0.02,
  POSITION_MULTIPLIER_MIN: 0.1,
  POSITION_MULTIPLIER_MAX: 2.0,
} as const;

// ============================================
// INSTANT LEARNING STATE
// ============================================

interface InstantLearningState {
  isInitialized: boolean;
  simulationsSinceLastPersist: number;
  currentOptimalParams: Map<MarketConditionLevel, OptimalParams>;
  realtimeMetrics: RealtimeMetrics;
  lastAppliedParams: number;  // Timestamp
}

interface OptimalParams {
  successRateMultiplier: number;
  slippageTolerance: number;
  positionMultiplier: number;
  profitThreshold: number;
  volatilityDamping: number;
  confidenceScore: number;
  sampleCount: number;
}

interface RealtimeMetrics {
  totalSimulations: number;
  successfulSimulations: number;
  totalProfit: number;
  averageWinRate: number;
  averageSharpe: number;
  lastUpdateTime: number;
}

// ============================================
// INSTANT LEARNING ENGINE
// ============================================

class InstantLearningEngine {
  private state: InstantLearningState;
  private supabase: SupabaseClient | null = null;

  constructor() {
    this.state = this.createInitialState();
    this.initializeSupabase();
  }

  private createInitialState(): InstantLearningState {
    return {
      isInitialized: false,
      simulationsSinceLastPersist: 0,
      currentOptimalParams: new Map([
        ['ideal', this.createDefaultOptimalParams()],
        ['average', this.createDefaultOptimalParams()],
        ['poor', this.createDefaultOptimalParams()],
      ]),
      realtimeMetrics: {
        totalSimulations: 0,
        successfulSimulations: 0,
        totalProfit: 0,
        averageWinRate: 0,
        averageSharpe: 0,
        lastUpdateTime: Date.now(),
      },
      lastAppliedParams: 0,
    };
  }

  private createDefaultOptimalParams(): OptimalParams {
    return {
      successRateMultiplier: 1.0,
      slippageTolerance: 0.005,
      positionMultiplier: 1.0,
      profitThreshold: 0.01,
      volatilityDamping: 0.6,
      confidenceScore: 0,
      sampleCount: 0,
    };
  }

  private initializeSupabase(): void {
    const supabaseUrl = process.env.SUPABASE_URL || EDEN_CONFIG.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || EDEN_CONFIG.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
      } catch (error) {
        logger.warn('InstantLearningEngine: Supabase connection failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Initialize the engine - loads all learned parameters instantly
   * This is called on system startup
   */
  async initialize(): Promise<void> {
    if (this.state.isInitialized) return;

    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) {
      logger.warn('InstantLearningEngine disabled by governance (no long-term memory in Stage 1–3)', {
        component: 'InstantLearningEngine',
        governance: getCryptocrawlGovernance().getState(),
      });
      this.state.isInitialized = true;
      return;
    }

    logger.info('InstantLearningEngine: Initializing and loading learned parameters...', {
      component: 'InstantLearningEngine',
    });

    // Initialize the deep learning store first
    await deepLearningStore.initialize();

    // Load optimal parameters from Supabase
    await this.loadOptimalParamsFromSupabase();

    // Load from deep learning store as fallback
    this.loadFromDeepLearningStore();

    this.state.isInitialized = true;
    this.state.lastAppliedParams = Date.now();

    logger.info('InstantLearningEngine: Initialization complete', {
      component: 'InstantLearningEngine',
      idealParams: this.state.currentOptimalParams.get('ideal'),
      averageParams: this.state.currentOptimalParams.get('average'),
      poorParams: this.state.currentOptimalParams.get('poor'),
      totalHistoricalSims: this.state.realtimeMetrics.totalSimulations,
    });
  }

  /**
   * Load optimal parameters from Supabase - called on startup
   */
  private async loadOptimalParamsFromSupabase(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('cryptocrawler_optimal_params')
        .select('*')
        .order('updated_at', { ascending: false });

      if (data && !error) {
        for (const row of data) {
          const condition = row.market_condition as MarketConditionLevel;
          const params: OptimalParams = {
            successRateMultiplier: row.success_rate_multiplier || 1.0,
            slippageTolerance: row.slippage_tolerance || 0.005,
            positionMultiplier: row.position_multiplier || 1.0,
            profitThreshold: row.profit_threshold || 0.01,
            volatilityDamping: row.volatility_damping || 0.6,
            confidenceScore: row.confidence_score || 0,
            sampleCount: row.sample_count || 0,
          };
          this.state.currentOptimalParams.set(condition, params);
        }

        // Load metrics
        const { data: metricsData } = await this.supabase
          .from('cryptocrawler_realtime_metrics')
          .select('*')
          .single();

        if (metricsData) {
          this.state.realtimeMetrics = {
            totalSimulations: metricsData.total_simulations || 0,
            successfulSimulations: metricsData.successful_simulations || 0,
            totalProfit: metricsData.total_profit || 0,
            averageWinRate: metricsData.average_win_rate || 0,
            averageSharpe: metricsData.average_sharpe || 0,
            lastUpdateTime: new Date(metricsData.last_update_time || Date.now()).getTime(),
          };
        }

        logger.info('InstantLearningEngine: Loaded parameters from Supabase', {
          component: 'InstantLearningEngine',
          paramsLoaded: data.length,
          totalHistoricalSims: this.state.realtimeMetrics.totalSimulations,
        });
      }
    } catch (error) {
      logger.warn('InstantLearningEngine: Failed to load from Supabase', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load parameters from deep learning store as fallback
   */
  private loadFromDeepLearningStore(): void {
    const conditions: MarketConditionLevel[] = ['ideal', 'average', 'poor'];
    
    for (const condition of conditions) {
      const learnedParams = deepLearningStore.getOptimalParameters(condition);
      const currentParams = this.state.currentOptimalParams.get(condition) || this.createDefaultOptimalParams();
      
      if (learnedParams.optimal_success_rate) {
        currentParams.successRateMultiplier = learnedParams.optimal_success_rate;
      }
      if (learnedParams.optimal_slippage) {
        currentParams.slippageTolerance = learnedParams.optimal_slippage;
      }
      if (learnedParams.position_multiplier) {
        currentParams.positionMultiplier = learnedParams.position_multiplier;
      }
      
      this.state.currentOptimalParams.set(condition, currentParams);
    }
  }

  /**
   * GENEROUSLY learn from a single Monte Carlo simulation result
   * Called after EVERY simulation - extracts MAXIMUM learning value
   * Stores comprehensive intelligence for future optimization
   */
  async learnFromSimulation(
    strategy: StrategyProfile,
    marketCondition: MarketCondition,
    conditionLevel: MarketConditionLevel,
    result: SimulationResult
  ): Promise<void> {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return;
    // Deny-by-default: learning persistence/mutation requires explicit envelope permission.
    try {
      getCryptocrawlGovernance().requireAllowed('PERSIST_LONG_TERM_MEMORY');
    } catch {
      return;
    }
    // ============================================
    // PHASE 1: GENEROUS METRIC EXTRACTION
    // Extract every possible learning signal
    // ============================================
    
    // Update realtime metrics
    this.state.realtimeMetrics.totalSimulations++;
    if (result.winRate > 0.5) {
      this.state.realtimeMetrics.successfulSimulations++;
    }
    this.state.realtimeMetrics.totalProfit += result.expectedProfit;
    
    // Calculate running averages with full precision
    const n = this.state.realtimeMetrics.totalSimulations;
    this.state.realtimeMetrics.averageWinRate = 
      ((this.state.realtimeMetrics.averageWinRate * (n - 1)) + result.winRate) / n;
    this.state.realtimeMetrics.averageSharpe = 
      ((this.state.realtimeMetrics.averageSharpe * (n - 1)) + result.sharpeRatio) / n;
    this.state.realtimeMetrics.lastUpdateTime = Date.now();

    // ============================================
    // PHASE 2: GENEROUS PARAMETER LEARNING
    // Learn from EVERY aspect of the simulation
    // ============================================
    
    const currentParams = this.state.currentOptimalParams.get(conditionLevel) || this.createDefaultOptimalParams();
    
    // Dynamic learning rate - more generous for newer data
    const baseLearningRate = currentParams.sampleCount < 10 
      ? LEARNING_CONFIG.LEARNING_RATE_HIGH_CONFIDENCE * 1.5  // Extra generous for early learning
      : currentParams.sampleCount < LEARNING_CONFIG.MEDIUM_CONFIDENCE_SAMPLE_SIZE
        ? LEARNING_CONFIG.LEARNING_RATE_HIGH_CONFIDENCE
        : currentParams.sampleCount < LEARNING_CONFIG.HIGH_CONFIDENCE_SAMPLE_SIZE
          ? LEARNING_CONFIG.LEARNING_RATE_MEDIUM_CONFIDENCE
          : LEARNING_CONFIG.LEARNING_RATE_LOW_CONFIDENCE;

    // ============================================
    // GENEROUS LEARNING FROM WIN RATE
    // ============================================
    const winRateSignal = result.winRate - 0.5; // Positive if good, negative if bad
    const winRateAdjustment = winRateSignal * baseLearningRate * 0.5;
    
    currentParams.successRateMultiplier = this.clamp(
      currentParams.successRateMultiplier + winRateAdjustment,
      LEARNING_CONFIG.SUCCESS_RATE_MIN,
      LEARNING_CONFIG.SUCCESS_RATE_MAX
    );

    // ============================================
    // GENEROUS LEARNING FROM SHARPE RATIO
    // ============================================
    const sharpeSignal = result.sharpeRatio / 10; // Normalize
    const sharpeAdjustment = sharpeSignal * baseLearningRate * 0.3;
    
    currentParams.profitThreshold = this.clamp(
      currentParams.profitThreshold * (1 + sharpeAdjustment),
      0.001,
      0.1
    );

    // ============================================
    // GENEROUS LEARNING FROM PROFIT FACTOR
    // ============================================
    if (result.profitFactor > 0) {
      const profitFactorSignal = (result.profitFactor - 1) / 5; // 1.0 = break even
      currentParams.positionMultiplier = this.clamp(
        currentParams.positionMultiplier * (1 + profitFactorSignal * baseLearningRate),
        LEARNING_CONFIG.POSITION_MULTIPLIER_MIN,
        LEARNING_CONFIG.POSITION_MULTIPLIER_MAX
      );
    }

    // ============================================
    // GENEROUS LEARNING FROM MAX DRAWDOWN
    // ============================================
    if (result.maxDrawdown > 0.1) {
      // High drawdown - increase volatility damping
      currentParams.volatilityDamping = Math.min(0.95, 
        currentParams.volatilityDamping + baseLearningRate * result.maxDrawdown
      );
    } else if (result.maxDrawdown < 0.05 && result.winRate > 0.6) {
      // Low drawdown with good win rate - can reduce damping slightly
      currentParams.volatilityDamping = Math.max(0.3,
        currentParams.volatilityDamping - baseLearningRate * 0.05
      );
    }

    // ============================================
    // GENEROUS LEARNING FROM SLIPPAGE
    // ============================================
    // Learn optimal slippage from strategy performance
    if (result.winRate > 0.7) {
      // Good performance - current slippage is working
      currentParams.slippageTolerance = this.clamp(
        strategy.slippageTolerance,
        LEARNING_CONFIG.SLIPPAGE_MIN,
        LEARNING_CONFIG.SLIPPAGE_MAX
      );
    } else if (result.winRate < 0.3) {
      // Poor performance - tighten slippage
      currentParams.slippageTolerance = this.clamp(
        currentParams.slippageTolerance * 0.95,
        LEARNING_CONFIG.SLIPPAGE_MIN,
        LEARNING_CONFIG.SLIPPAGE_MAX
      );
    }

    // ============================================
    // GENEROUS CONFIDENCE SCORING
    // ============================================
    if (result.winRate > 0.6 && result.sharpeRatio > 1) {
      currentParams.confidenceScore = Math.min(1, currentParams.confidenceScore + 0.02);
    } else if (result.winRate < 0.4 || result.sharpeRatio < -1) {
      currentParams.confidenceScore = Math.max(0, currentParams.confidenceScore - 0.01);
    }

    // Update sample count
    currentParams.sampleCount++;
    this.state.currentOptimalParams.set(conditionLevel, currentParams);

    // ============================================
    // PHASE 3: GENEROUS STORAGE TO SUPABASE
    // Store comprehensive learning data
    // ============================================
    
    // Record in deep learning store with full details
    await deepLearningStore.recordSimulationResult(strategy, marketCondition, conditionLevel, result);

    // Store detailed learning record
    await this.storeDetailedLearningRecord(strategy, marketCondition, conditionLevel, result, currentParams);

    // Persist to Supabase frequently for generous data storage
    this.state.simulationsSinceLastPersist++;
    if (this.state.simulationsSinceLastPersist >= LEARNING_CONFIG.IMMEDIATE_PERSIST_THRESHOLD) {
      await this.persistToSupabase();
      this.state.simulationsSinceLastPersist = 0;
    }

    logger.debug('InstantLearningEngine: Generously learned from simulation', {
      component: 'InstantLearningEngine',
      condition: conditionLevel,
      winRate: result.winRate,
      sharpe: result.sharpeRatio,
      profitFactor: result.profitFactor,
      maxDrawdown: result.maxDrawdown,
      newSuccessMultiplier: currentParams.successRateMultiplier,
      newPositionMultiplier: currentParams.positionMultiplier,
      newVolatilityDamping: currentParams.volatilityDamping,
      confidenceScore: currentParams.confidenceScore,
      totalSims: this.state.realtimeMetrics.totalSimulations,
    });
  }

  async recordExecutionOutcome(outcome: ExecutionOutcomeObservation): Promise<boolean> {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return false;
    try {
      getCryptocrawlGovernance().requireAllowed('PERSIST_LONG_TERM_MEMORY');
    } catch {
      return false;
    }
    // Realized outcomes are kept separate from simulation statistics and only
    // forwarded to the deduplicated persistent learning boundary.
    return deepLearningStore.recordExecutionOutcome(outcome);
  }

  /**
   * Store detailed learning record to Supabase
   * Generously captures all simulation intelligence
   */
  private async storeDetailedLearningRecord(
    strategy: StrategyProfile,
    marketCondition: MarketCondition,
    conditionLevel: MarketConditionLevel,
    result: SimulationResult,
    learnedParams: OptimalParams
  ): Promise<void> {
    if (!this.supabase) return;

    try {
      await this.supabase
        .from('cryptocrawler_learning_records')
        .insert({
          id: `learn-${Date.now()}-${randomUUID()}`,
          timestamp: new Date(),
          market_condition: conditionLevel,
          
          // Strategy details
          strategy_name: strategy.name,
          strategy_base_success_rate: strategy.baseSuccessRate,
          strategy_profit_per_trade: strategy.avgProfitPerTrade,
          strategy_loss_per_trade: strategy.avgLossPerTrade,
          strategy_trades_per_day: strategy.tradesPerDay,
          strategy_slippage: strategy.slippageTolerance,
          
          // Market condition details
          market_volatility: marketCondition.volatility,
          market_liquidity: marketCondition.liquidityScore,
          market_competition: marketCondition.competitorDensity,
          market_congestion: marketCondition.networkCongestion,
          
          // Result details
          result_win_rate: result.winRate,
          result_sharpe_ratio: result.sharpeRatio,
          result_profit_factor: result.profitFactor,
          result_max_drawdown: result.maxDrawdown,
          result_expected_profit: result.expectedProfit,
          result_rating: result.strategyRating,
          
          // Learned parameters after this simulation
          learned_success_multiplier: learnedParams.successRateMultiplier,
          learned_position_multiplier: learnedParams.positionMultiplier,
          learned_volatility_damping: learnedParams.volatilityDamping,
          learned_slippage_tolerance: learnedParams.slippageTolerance,
          learned_profit_threshold: learnedParams.profitThreshold,
          learned_confidence_score: learnedParams.confidenceScore,
          learned_sample_count: learnedParams.sampleCount,
        });
    } catch (error) {
      // Silently ignore - don't block execution
    }
  }

  /**
   * Get optimal parameters for a market condition - INSTANTLY accessible
   */
  getOptimalParams(conditionLevel: MarketConditionLevel): OptimalParams {
    return this.state.currentOptimalParams.get(conditionLevel) || this.createDefaultOptimalParams();
  }

  /**
   * Apply learned parameters to a strategy
   * Called before every trade execution
   */
  applyLearnedParams(
    baseStrategy: StrategyProfile,
    conditionLevel: MarketConditionLevel
  ): StrategyProfile {
    const optimalParams = this.getOptimalParams(conditionLevel);
    
    // Apply learned multipliers
    return {
      ...baseStrategy,
      baseSuccessRate: this.clamp(
        baseStrategy.baseSuccessRate * optimalParams.successRateMultiplier,
        LEARNING_CONFIG.SUCCESS_RATE_MIN,
        LEARNING_CONFIG.SUCCESS_RATE_MAX
      ),
      slippageTolerance: this.clamp(
        optimalParams.slippageTolerance,
        LEARNING_CONFIG.SLIPPAGE_MIN,
        LEARNING_CONFIG.SLIPPAGE_MAX
      ),
      avgLossPerTrade: baseStrategy.avgLossPerTrade * optimalParams.positionMultiplier,
      tradesPerDay: Math.floor(baseStrategy.tradesPerDay * optimalParams.positionMultiplier),
    };
  }

  /**
   * Persist learned parameters to Supabase
   */
  private async persistToSupabase(): Promise<void> {
    if (!this.supabase) return;

    try {
      // Persist optimal params for each condition
      const conditions: MarketConditionLevel[] = ['ideal', 'average', 'poor'];
      
      for (const condition of conditions) {
        const params = this.state.currentOptimalParams.get(condition);
        if (!params) continue;

        await this.supabase
          .from('cryptocrawler_optimal_params')
          .upsert({
            market_condition: condition,
            success_rate_multiplier: params.successRateMultiplier,
            slippage_tolerance: params.slippageTolerance,
            position_multiplier: params.positionMultiplier,
            profit_threshold: params.profitThreshold,
            volatility_damping: params.volatilityDamping,
            confidence_score: params.confidenceScore,
            sample_count: params.sampleCount,
            updated_at: new Date(),
          }, { onConflict: 'market_condition' });
      }

      // Persist realtime metrics
      await this.supabase
        .from('cryptocrawler_realtime_metrics')
        .upsert({
          id: 'global',
          total_simulations: this.state.realtimeMetrics.totalSimulations,
          successful_simulations: this.state.realtimeMetrics.successfulSimulations,
          total_profit: this.state.realtimeMetrics.totalProfit,
          average_win_rate: this.state.realtimeMetrics.averageWinRate,
          average_sharpe: this.state.realtimeMetrics.averageSharpe,
          last_update_time: new Date(),
        }, { onConflict: 'id' });

      logger.debug('InstantLearningEngine: Persisted to Supabase', {
        component: 'InstantLearningEngine',
        totalSims: this.state.realtimeMetrics.totalSimulations,
      });
    } catch (error) {
      // Silently ignore persistence errors to not block execution
      logger.warn('InstantLearningEngine: Persistence error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get realtime learning metrics
   */
  getMetrics(): RealtimeMetrics {
    return { ...this.state.realtimeMetrics };
  }

  /**
   * Get learning state summary
   */
  getSummary(): {
    isInitialized: boolean;
    totalSimulations: number;
    averageWinRate: number;
    averageSharpe: number;
    paramsPerCondition: Record<MarketConditionLevel, OptimalParams>;
  } {
    return {
      isInitialized: this.state.isInitialized,
      totalSimulations: this.state.realtimeMetrics.totalSimulations,
      averageWinRate: this.state.realtimeMetrics.averageWinRate,
      averageSharpe: this.state.realtimeMetrics.averageSharpe,
      paramsPerCondition: {
        ideal: this.state.currentOptimalParams.get('ideal') || this.createDefaultOptimalParams(),
        average: this.state.currentOptimalParams.get('average') || this.createDefaultOptimalParams(),
        poor: this.state.currentOptimalParams.get('poor') || this.createDefaultOptimalParams(),
      },
    };
  }

  /**
   * Force persist all learned data
   */
  async forcePersist(): Promise<void> {
    await this.persistToSupabase();
    await deepLearningStore.runLearningCycle();
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

// Singleton instance - instantly accessible
export const instantLearningEngine = new InstantLearningEngine();
export { InstantLearningEngine, OptimalParams, RealtimeMetrics };
