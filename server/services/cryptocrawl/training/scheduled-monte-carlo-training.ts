/**
 * Scheduled Monte Carlo Training System
 * 
 * Purpose: Run Monte Carlo simulations daily at the lowest user traffic time
 * for IMPROVEMENT and PROFITABILITY OPTIMIZATION. This continuously improves
 * the cryptocrawler's trading strategies by learning from simulated scenarios.
 * 
 * Schedule: Runs at 3:00 AM UTC (typically lowest traffic time globally)
 * - Configurable via MONTE_CARLO_TRAINING_HOUR environment variable
 * 
 * Features:
 * - Automatic daily training at low traffic hours
 * - Strategy parameter optimization
 * - Profitability improvement through continuous learning
 * - Performance metric tracking
 * - Automatic application of optimized parameters
 */

import logger from '../../../logger.js';
import { createMonteCarloEngine, ELITE_STRATEGIES, MARKET_CONDITIONS, type SimulationResult, type StrategyProfile, type MarketCondition } from '../validation/monte-carlo-engine.js';

// ============================================
// TRAINING CONFIGURATION
// ============================================

/**
 * Training configuration
 * - LOW_TRAFFIC_HOUR: Hour in UTC when training runs (default: 3 AM)
 * - TRAINING_SIMULATIONS: Number of simulations per training session
 * - TRAINING_INTERVAL_CHECK: How often to check if training should run (ms)
 */
const TRAINING_CONFIG = {
  LOW_TRAFFIC_HOUR: parseInt(process.env.MONTE_CARLO_TRAINING_HOUR || '3', 10), // 3 AM UTC default
  TRAINING_SIMULATIONS: 10000,
  TRAINING_INTERVAL_CHECK: 60 * 1000, // Check every minute
  STRATEGIES_TO_TRAIN: ['quantumFlashArbitrage', 'neuralMEVHunter', 'deepLiquidityMiner', 'crossChainOptimizer'],
  MARKET_CONDITIONS_TO_TEST: ['normal', 'highVolatility', 'lowLiquidity', 'highCompetition', 'trending', 'ranging'],
  MAX_TRAINING_DURATION_MS: 30 * 60 * 1000, // 30 minutes max
} as const;

// ============================================
// OPTIMIZATION TYPES
// ============================================

export interface OptimizationResult {
  strategyName: string;
  marketCondition: string;
  originalWinRate: number;
  optimizedWinRate: number;
  originalSharpe: number;
  optimizedSharpe: number;
  profitImprovement: number; // Percentage improvement
  recommendedParameters: OptimizedParameters;
  timestamp: number;
}

export interface OptimizedParameters {
  successRateMultiplier: number;
  slippageTolerance: number;
  positionSizeMultiplier: number;
  gasOptimizationFactor: number;
  riskAdjustment: number;
}

export interface TrainingSession {
  sessionId: string;
  startTime: number;
  endTime: number | null;
  simulationsCompleted: number;
  strategiesTrained: string[];
  marketConditionsTested: string[];
  optimizationResults: OptimizationResult[];
  totalProfitImprovement: number;
  learningsApplied: boolean;
  status: 'running' | 'completed' | 'failed';
}

export interface TrainingMetrics {
  totalSessionsCompleted: number;
  lastTrainingTime: number;
  averageSessionDuration: number;
  totalSimulationsRun: number;
  cumulativeProfitImprovement: number;
  bestOptimizations: OptimizationResult[];
}

// ============================================
// SCHEDULED MONTE CARLO TRAINING ENGINE
// ============================================

class ScheduledMonteCarloTraining {
  private isRunning = false;
  private trainingInterval: ReturnType<typeof setInterval> | null = null;
  private lastTrainingDate: string | null = null;
  private currentSession: TrainingSession | null = null;
  private metrics: TrainingMetrics;
  private monteCarloEngine: ReturnType<typeof createMonteCarloEngine>;
  private optimizedParams: Map<string, OptimizedParameters> = new Map();

  constructor() {
    this.metrics = {
      totalSessionsCompleted: 0,
      lastTrainingTime: 0,
      averageSessionDuration: 0,
      totalSimulationsRun: 0,
      cumulativeProfitImprovement: 0,
      bestOptimizations: [],
    };
    
    // Create Monte Carlo engine with training configuration
    this.monteCarloEngine = createMonteCarloEngine({
      simulations: TRAINING_CONFIG.TRAINING_SIMULATIONS,
      timeHorizonDays: 30,
      confidenceLevel: 0.95,
      antithetic: true,
      controlVariate: true,
      enableRegimeDetection: true,
      enableKellySizing: true,
      enableFatTails: true,
      enableEnsemble: true,
      ensembleCount: 5,
      learningEnabled: true,
    });
  }

  /**
   * Start the scheduled training system
   * This will check every minute if it's time to run training
   */
  start(): void {
    if (this.isRunning) {
      logger.info('[MonteCarloTraining] Already running', { component: 'ScheduledMCTraining' });
      return;
    }

    this.isRunning = true;
    logger.info('[MonteCarloTraining] 🎓 Starting scheduled profitability optimization', {
      component: 'ScheduledMCTraining',
      lowTrafficHour: TRAINING_CONFIG.LOW_TRAFFIC_HOUR,
      timezone: 'UTC',
      purpose: 'Improvement and profitability optimization',
    });

    // Check immediately on start
    this.checkAndRunTraining();

    // Then check every minute
    this.trainingInterval = setInterval(() => {
      this.checkAndRunTraining();
    }, TRAINING_CONFIG.TRAINING_INTERVAL_CHECK);
  }

  /**
   * Stop the scheduled training system
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.trainingInterval) {
      clearInterval(this.trainingInterval);
      this.trainingInterval = null;
    }

    logger.info('[MonteCarloTraining] 🛑 Stopped profitability optimization system', {
      component: 'ScheduledMCTraining',
      totalSessions: this.metrics.totalSessionsCompleted,
      cumulativeImprovement: `${this.metrics.cumulativeProfitImprovement.toFixed(2)}%`,
    });
  }

  /**
   * Check if it's time to run training and execute if needed
   */
  private async checkAndRunTraining(): Promise<void> {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const todayDate = now.toISOString().split('T')[0];

    // Check if we should run training:
    // 1. It's the low traffic hour
    // 2. We haven't run training today
    // 3. We're not currently in a training session
    if (
      currentHour === TRAINING_CONFIG.LOW_TRAFFIC_HOUR &&
      this.lastTrainingDate !== todayDate &&
      !this.currentSession
    ) {
      logger.info('[MonteCarloTraining] 🌙 Low traffic hour - starting profitability optimization', {
        component: 'ScheduledMCTraining',
        hour: currentHour,
        date: todayDate,
      });

      this.lastTrainingDate = todayDate;
      await this.runTrainingSession();
    }
  }

  /**
   * Run a complete training session for profitability optimization
   * This is the main training function that:
   * 1. Runs Monte Carlo simulations for each strategy
   * 2. Tests against various market conditions
   * 3. Calculates optimal parameters for maximum profitability
   * 4. Applies the optimized parameters to the system
   */
  async runTrainingSession(): Promise<TrainingSession> {
    const sessionId = `training-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.currentSession = {
      sessionId,
      startTime: Date.now(),
      endTime: null,
      simulationsCompleted: 0,
      strategiesTrained: [],
      marketConditionsTested: [],
      optimizationResults: [],
      totalProfitImprovement: 0,
      learningsApplied: false,
      status: 'running',
    };

    logger.info('[MonteCarloTraining] 📊 Profitability optimization session started', {
      component: 'ScheduledMCTraining',
      sessionId,
      strategiesToOptimize: TRAINING_CONFIG.STRATEGIES_TO_TRAIN.length,
      conditionsToTest: TRAINING_CONFIG.MARKET_CONDITIONS_TO_TEST.length,
    });

    try {
      const startTime = Date.now();
      const allResults: SimulationResult[] = [];
      let totalImprovement = 0;

      // Run simulations for each strategy-condition combination
      for (const strategyName of TRAINING_CONFIG.STRATEGIES_TO_TRAIN) {
        const strategy = ELITE_STRATEGIES[strategyName];
        if (!strategy) continue;

        for (const conditionName of TRAINING_CONFIG.MARKET_CONDITIONS_TO_TEST) {
          const condition = MARKET_CONDITIONS[conditionName];
          if (!condition) continue;

          // Check if we've exceeded max training duration
          if (Date.now() - startTime > TRAINING_CONFIG.MAX_TRAINING_DURATION_MS) {
            logger.warn('[MonteCarloTraining] ⚠️ Max training duration reached', {
              component: 'ScheduledMCTraining',
              elapsed: Date.now() - startTime,
            });
            break;
          }

          try {
            // Run baseline simulation
            const baselineResult = await this.monteCarloEngine.runSimulation(strategy, condition);
            
            // Run optimized simulation with adjusted parameters
            const optimizedStrategy = this.createOptimizedStrategy(strategy, baselineResult);
            const optimizedResult = await this.monteCarloEngine.runSimulation(optimizedStrategy, condition);
            
            allResults.push(optimizedResult);
            this.currentSession.simulationsCompleted += 2; // Baseline + optimized

            // Calculate profit improvement
            const improvement = this.calculateProfitImprovement(baselineResult, optimizedResult);
            totalImprovement += improvement;

            // Store optimization result
            const optimizationResult: OptimizationResult = {
              strategyName,
              marketCondition: conditionName,
              originalWinRate: baselineResult.winRate,
              optimizedWinRate: optimizedResult.winRate,
              originalSharpe: baselineResult.sharpeRatio,
              optimizedSharpe: optimizedResult.sharpeRatio,
              profitImprovement: improvement,
              recommendedParameters: this.extractOptimizedParams(optimizedResult),
              timestamp: Date.now(),
            };
            this.currentSession.optimizationResults.push(optimizationResult);

            // Track which strategies and conditions we've tested
            if (!this.currentSession.strategiesTrained.includes(strategyName)) {
              this.currentSession.strategiesTrained.push(strategyName);
            }
            if (!this.currentSession.marketConditionsTested.includes(conditionName)) {
              this.currentSession.marketConditionsTested.push(conditionName);
            }

            logger.debug('[MonteCarloTraining] Optimization completed', {
              component: 'ScheduledMCTraining',
              strategy: strategyName,
              condition: conditionName,
              improvement: `${improvement.toFixed(2)}%`,
              newWinRate: optimizedResult.winRate.toFixed(3),
            });
          } catch (err) {
            logger.warn('[MonteCarloTraining] Optimization failed', {
              component: 'ScheduledMCTraining',
              strategy: strategyName,
              condition: conditionName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Calculate total profit improvement
      this.currentSession.totalProfitImprovement = totalImprovement / Math.max(1, this.currentSession.optimizationResults.length);

      // Apply optimized parameters to the system
      await this.applyOptimizations(this.currentSession.optimizationResults);
      this.currentSession.learningsApplied = true;

      // Complete the session
      this.currentSession.endTime = Date.now();
      this.currentSession.status = 'completed';

      // Update metrics
      this.updateMetrics(this.currentSession);

      logger.info('[MonteCarloTraining] ✅ Profitability optimization completed', {
        component: 'ScheduledMCTraining',
        sessionId,
        duration: `${((this.currentSession.endTime - this.currentSession.startTime) / 1000).toFixed(1)}s`,
        simulationsCompleted: this.currentSession.simulationsCompleted,
        avgProfitImprovement: `${this.currentSession.totalProfitImprovement.toFixed(2)}%`,
        strategiesOptimized: this.currentSession.strategiesTrained.length,
      });

      const completedSession = { ...this.currentSession };
      this.currentSession = null;
      return completedSession;

    } catch (error) {
      logger.error('[MonteCarloTraining] ❌ Optimization session failed', {
        component: 'ScheduledMCTraining',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (this.currentSession) {
        this.currentSession.status = 'failed';
        this.currentSession.endTime = Date.now();
      }

      const failedSession = this.currentSession ? { ...this.currentSession } : {
        sessionId,
        startTime: Date.now(),
        endTime: Date.now(),
        simulationsCompleted: 0,
        strategiesTrained: [],
        marketConditionsTested: [],
        optimizationResults: [],
        totalProfitImprovement: 0,
        learningsApplied: false,
        status: 'failed' as const,
      };
      
      this.currentSession = null;
      return failedSession;
    }
  }

  /**
   * Create an optimized version of a strategy based on simulation results
   */
  private createOptimizedStrategy(
    baseStrategy: StrategyProfile,
    baselineResult: SimulationResult
  ): StrategyProfile {
    // Apply Kelly Criterion sizing if available
    const kellySizing = baselineResult.kellyCriterion?.halfKellyFraction || 1.0;
    
    // Apply regime-based adjustments
    const regimeMultiplier = baselineResult.marketRegime?.regimeMultipliers?.successMultiplier || 1.0;
    
    // Apply learning adjustments
    const learningRate = baselineResult.learningAdjustments?.historicalSuccessRate || baseStrategy.baseSuccessRate;

    return {
      ...baseStrategy,
      name: `${baseStrategy.name} (Optimized)`,
      baseSuccessRate: Math.min(0.95, learningRate * regimeMultiplier),
      slippageTolerance: baseStrategy.slippageTolerance * (1 - baselineResult.maxDrawdown * 0.5),
      avgProfitPerTrade: baseStrategy.avgProfitPerTrade * kellySizing,
    };
  }

  /**
   * Calculate profit improvement between baseline and optimized results
   */
  private calculateProfitImprovement(
    baseline: SimulationResult,
    optimized: SimulationResult
  ): number {
    const baselineProfit = baseline.expectedProfit;
    const optimizedProfit = optimized.expectedProfit;
    
    if (baselineProfit <= 0) {
      return optimizedProfit > 0 ? 100 : 0;
    }
    
    return ((optimizedProfit - baselineProfit) / Math.abs(baselineProfit)) * 100;
  }

  /**
   * Extract optimized parameters from simulation result
   */
  private extractOptimizedParams(result: SimulationResult): OptimizedParameters {
    return {
      successRateMultiplier: result.marketRegime?.regimeMultipliers?.successMultiplier || 1.0,
      slippageTolerance: Math.max(0.001, 0.005 * (1 - result.maxDrawdown)),
      positionSizeMultiplier: result.kellyCriterion?.halfKellyFraction || 1.0,
      gasOptimizationFactor: 1 - (result.maxDrawdown * 0.3),
      riskAdjustment: result.marketRegime?.regimeMultipliers?.riskMultiplier || 1.0,
    };
  }

  /**
   * Apply optimized parameters to the trading system
   */
  private async applyOptimizations(results: OptimizationResult[]): Promise<void> {
    if (results.length === 0) return;

    // Store the best optimization for each strategy
    const bestByStrategy = new Map<string, OptimizationResult>();
    
    for (const result of results) {
      const existing = bestByStrategy.get(result.strategyName);
      if (!existing || result.profitImprovement > existing.profitImprovement) {
        bestByStrategy.set(result.strategyName, result);
      }
    }

    // Apply the best parameters
    for (const [strategyName, result] of bestByStrategy) {
      this.optimizedParams.set(strategyName, result.recommendedParameters);
      
      logger.info('[MonteCarloTraining] 💰 Applied optimized parameters', {
        component: 'ScheduledMCTraining',
        strategy: strategyName,
        improvement: `${result.profitImprovement.toFixed(2)}%`,
        newWinRate: result.optimizedWinRate.toFixed(3),
        newSharpe: result.optimizedSharpe.toFixed(3),
      });
    }

    // Log summary of applied optimizations
    const totalStrategies = bestByStrategy.size;
    const avgImprovement = results.reduce((sum, r) => sum + r.profitImprovement, 0) / results.length;
    
    logger.info('[MonteCarloTraining] 📈 Optimization summary', {
      component: 'ScheduledMCTraining',
      strategiesOptimized: totalStrategies,
      avgProfitImprovement: `${avgImprovement.toFixed(2)}%`,
      parametersUpdated: this.optimizedParams.size,
    });
  }

  /**
   * Update training metrics after a session
   */
  private updateMetrics(session: TrainingSession): void {
    this.metrics.totalSessionsCompleted++;
    this.metrics.lastTrainingTime = session.endTime || Date.now();
    this.metrics.totalSimulationsRun += session.simulationsCompleted;
    this.metrics.cumulativeProfitImprovement += session.totalProfitImprovement;

    // Update average session duration
    const sessionDuration = (session.endTime || Date.now()) - session.startTime;
    this.metrics.averageSessionDuration = 
      (this.metrics.averageSessionDuration * (this.metrics.totalSessionsCompleted - 1) + sessionDuration) 
      / this.metrics.totalSessionsCompleted;

    // Keep best optimizations (top 10)
    const allOptimizations = [...this.metrics.bestOptimizations, ...session.optimizationResults];
    this.metrics.bestOptimizations = allOptimizations
      .sort((a, b) => b.profitImprovement - a.profitImprovement)
      .slice(0, 10);
  }

  /**
   * Manually trigger a training session (for testing or on-demand optimization)
   */
  async triggerTraining(): Promise<TrainingSession> {
    if (this.currentSession) {
      throw new Error('Training session already in progress');
    }
    return this.runTrainingSession();
  }

  /**
   * Get current training metrics
   */
  getMetrics(): TrainingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current session status
   */
  getCurrentSession(): TrainingSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Get optimized parameters for a strategy
   */
  getOptimizedParams(strategyName: string): OptimizedParameters | null {
    return this.optimizedParams.get(strategyName) || null;
  }

  /**
   * Get all optimized parameters
   */
  getAllOptimizedParams(): Map<string, OptimizedParameters> {
    return new Map(this.optimizedParams);
  }

  /**
   * Check if training system is active
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const scheduledMonteCarloTraining = new ScheduledMonteCarloTraining();

// Export class for testing
export { ScheduledMonteCarloTraining };
