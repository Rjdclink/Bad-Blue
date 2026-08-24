// Deep Learning Store - Persistent Storage for Monte Carlo Learning
// Stores simulation results, learned parameters, and evolutionary adaptations in Supabase
// Implements dynamic deep learning from Monte Carlo simulations with full persistence

import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import logger from '../../../logger.js';
import { EDEN_CONFIG } from '../eden/config';
import { getCryptocrawlGovernance } from '../governance/index.js';
import type { MarketConditionLevel } from '../core/market-condition-detector.js';
import type { SimulationResult, StrategyProfile, MarketCondition } from '../validation/monte-carlo-engine';
import type { ExecutionOutcomeObservation } from './execution-outcome.js';
import { getExecutionOutcomeKey } from './execution-outcome.js';

// ============================================
// DEEP LEARNING DATA TYPES
// ============================================

export interface LearnedParameter {
  id: string;
  name: string;
  value: number;
  previousValue: number;
  confidence: number;
  sampleSize: number;
  lastUpdated: number;
  marketCondition: MarketConditionLevel;
  source: 'monte_carlo' | 'reinforcement' | 'evolution' | 'manual';
}

export interface StrategyPerformance {
  id: string;
  strategyName: string;
  marketCondition: MarketConditionLevel;
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  expectedProfit: number;
  sampleSize: number;
  timestamp: number;
  simulationConfig: Record<string, any>;
}

export interface EvolutionRecord {
  id: string;
  generation: number;
  parentId: string | null;
  fitness: number;
  parameters: Record<string, number>;
  mutations: string[];
  marketCondition: MarketConditionLevel;
  timestamp: number;
  survived: boolean;
}

export interface FailedStrategyRecord {
  id: string;
  strategyName: string;
  parameters: Record<string, number>;
  failureReason: string;
  marketCondition: MarketConditionLevel;
  winRate: number;
  loss: number;
  timestamp: number;
  blacklisted: boolean;
}

export interface AdaptiveThreshold {
  id: string;
  name: string;
  idealValue: number;
  averageValue: number;
  poorValue: number;
  autoAdjusted: boolean;
  adjustmentFactor: number;
  lastUpdated: number;
}

export interface LearningState {
  learnedParameters: Map<string, LearnedParameter>;
  strategyPerformance: Map<string, StrategyPerformance[]>;
  failedStrategies: Map<string, FailedStrategyRecord>;
  evolutionHistory: EvolutionRecord[];
  adaptiveThresholds: Map<string, AdaptiveThreshold>;
  totalSimulations: number;
  lastLearningCycle: number;
}

// ============================================
// DEEP LEARNING STORE CLASS
// ============================================

class DeepLearningStore {
  private supabase: SupabaseClient | null = null;
  private state: LearningState;
  private persistInterval: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;
  private pendingUpdates: number = 0;
  private readonly maxPendingUpdates = 50;
  private executionOutcomes: ExecutionOutcomeObservation[] = [];
  private executionOutcomeKeys = new Set<string>();

  constructor() {
    this.state = this.createInitialState();
    this.initializeSupabase();
  }

  private createInitialState(): LearningState {
    return {
      learnedParameters: new Map(),
      strategyPerformance: new Map(),
      failedStrategies: new Map(),
      evolutionHistory: [],
      adaptiveThresholds: new Map(),
      totalSimulations: 0,
      lastLearningCycle: Date.now(),
    };
  }

  private initializeSupabase(): void {
    const supabaseUrl = process.env.SUPABASE_URL || EDEN_CONFIG.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || EDEN_CONFIG.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        logger.info('Deep Learning Store connected to Supabase', {
          component: 'DeepLearningStore',
        });
      } catch (error) {
        logger.warn('Failed to connect to Supabase for learning storage', {
          component: 'DeepLearningStore',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.warn('Supabase credentials not available, learning will be in-memory only', {
        component: 'DeepLearningStore',
      });
    }
  }

  /**
   * Initialize the store and load existing data from Supabase
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Stage 1–3: no long-term accumulation or persistence.
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) {
      logger.warn('Deep Learning Store disabled by governance (no long-term memory in Stage 1–3)', {
        component: 'DeepLearningStore',
        governance: getCryptocrawlGovernance().getState(),
      });
      this.isInitialized = true;
      return;
    }

    logger.info('Initializing Deep Learning Store...', {
      component: 'DeepLearningStore',
    });

    // Load existing data from Supabase
    await this.loadLearnedParameters();
    await this.loadStrategyPerformance();
    await this.loadFailedStrategies();
    await this.loadAdaptiveThresholds();

    // Start periodic persistence
    this.startPeriodicPersistence();

    this.isInitialized = true;
    logger.info('Deep Learning Store initialized', {
      component: 'DeepLearningStore',
      learnedParams: this.state.learnedParameters.size,
      strategyRecords: this.state.strategyPerformance.size,
      failedStrategies: this.state.failedStrategies.size,
    });
  }

  /**
   * Record Monte Carlo simulation results for learning
   */
  async recordSimulationResult(
    strategy: StrategyProfile,
    marketCondition: MarketCondition,
    conditionLevel: MarketConditionLevel,
    result: SimulationResult
  ): Promise<void> {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return;
    const performance: StrategyPerformance = {
      id: `perf-${randomUUID()}`,
      strategyName: strategy.name,
      marketCondition: conditionLevel,
      winRate: result.winRate,
      sharpeRatio: result.sharpeRatio,
      profitFactor: result.profitFactor,
      maxDrawdown: result.maxDrawdown,
      expectedProfit: result.expectedProfit,
      sampleSize: 1,
      timestamp: Date.now(),
      simulationConfig: {
        baseSuccessRate: strategy.baseSuccessRate,
        avgProfitPerTrade: strategy.avgProfitPerTrade,
        avgLossPerTrade: strategy.avgLossPerTrade,
        tradesPerDay: strategy.tradesPerDay,
        volatility: marketCondition.volatility,
        liquidityScore: marketCondition.liquidityScore,
        competitorDensity: marketCondition.competitorDensity,
      },
    };

    // Store in memory
    if (!this.state.strategyPerformance.has(strategy.name)) {
      this.state.strategyPerformance.set(strategy.name, []);
    }
    this.state.strategyPerformance.get(strategy.name)!.push(performance);

    // Limit history per strategy
    const history = this.state.strategyPerformance.get(strategy.name)!;
    if (history.length > 100) {
      this.state.strategyPerformance.set(strategy.name, history.slice(-50));
    }

    this.state.totalSimulations++;

    // Update learned parameters based on results
    await this.updateLearnedParameters(strategy, conditionLevel, result);

    // Check for failed strategies
    if (result.winRate < 0.3 || result.sharpeRatio < -1) {
      await this.recordFailedStrategy(strategy, conditionLevel, result);
    }

    // Persist to Supabase
    await this.persistStrategyPerformance(performance);

    // Trigger learning cycle if enough data accumulated
    this.pendingUpdates++;
    if (this.pendingUpdates >= this.maxPendingUpdates) {
      await this.runLearningCycle();
      this.pendingUpdates = 0;
    }

    logger.debug('Simulation result recorded', {
      component: 'DeepLearningStore',
      strategy: strategy.name,
      condition: conditionLevel,
      winRate: result.winRate,
      sharpeRatio: result.sharpeRatio,
    });
  }

  async recordExecutionOutcome(outcome: ExecutionOutcomeObservation): Promise<boolean> {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return false;
    try {
      getCryptocrawlGovernance().requireAllowed('PERSIST_LONG_TERM_MEMORY');
    } catch {
      return false;
    }

    const key = getExecutionOutcomeKey(outcome);
    if (this.executionOutcomeKeys.has(key)) return false;
    this.executionOutcomeKeys.add(key);
    this.executionOutcomes.push({
      ...outcome,
      provenance: [...outcome.provenance],
      settlement: outcome.settlement ? {
        ...outcome.settlement,
        receipts: outcome.settlement.receipts.map(receipt => ({ ...receipt })),
        provenance: [...outcome.settlement.provenance],
      } : undefined,
    });
    if (this.executionOutcomes.length > 500) {
      const removed = this.executionOutcomes.splice(0, this.executionOutcomes.length - 500);
      for (const item of removed) this.executionOutcomeKeys.delete(getExecutionOutcomeKey(item));
    }
    logger.debug('Realized execution outcome recorded for learning', {
      component: 'DeepLearningStore',
      eventId: outcome.eventId,
      opportunityId: outcome.opportunityId,
      success: outcome.success,
      provenance: outcome.provenance,
    });
    return true;
  }

  getExecutionOutcomes(): ExecutionOutcomeObservation[] {
    return this.executionOutcomes.map(outcome => ({
      ...outcome,
      provenance: [...outcome.provenance],
      prediction: outcome.prediction ? { ...outcome.prediction } : undefined,
      settlement: outcome.settlement ? {
        ...outcome.settlement,
        receipts: outcome.settlement.receipts.map(receipt => ({ ...receipt })),
        provenance: [...outcome.settlement.provenance],
      } : undefined,
    }));
  }

  /**
   * Update learned parameters based on simulation results
   */
  private async updateLearnedParameters(
    strategy: StrategyProfile,
    conditionLevel: MarketConditionLevel,
    result: SimulationResult
  ): Promise<void> {
    // Learn optimal success rate threshold
    const successRateKey = `optimal_success_rate_${conditionLevel}`;
    await this.updateParameter(
      successRateKey,
      strategy.baseSuccessRate,
      result.winRate > 0.5 ? 0.8 : 0.3,
      conditionLevel,
      'monte_carlo'
    );

    // Learn optimal profit threshold
    const profitThresholdKey = `optimal_profit_threshold_${conditionLevel}`;
    await this.updateParameter(
      profitThresholdKey,
      strategy.avgProfitPerTrade,
      result.expectedProfit > 0 ? 0.7 : 0.2,
      conditionLevel,
      'monte_carlo'
    );

    // Learn optimal slippage tolerance
    const slippageKey = `optimal_slippage_${conditionLevel}`;
    await this.updateParameter(
      slippageKey,
      strategy.slippageTolerance,
      result.maxDrawdown < 0.1 ? 0.8 : 0.3,
      conditionLevel,
      'monte_carlo'
    );

    // Learn position sizing for condition
    const positionKey = `position_multiplier_${conditionLevel}`;
    let positionMultiplier = 1.0;
    if (conditionLevel === 'poor') {
      positionMultiplier = result.winRate > 0.3 ? 0.3 : 0.1;
    } else if (conditionLevel === 'average') {
      positionMultiplier = result.winRate > 0.5 ? 0.6 : 0.3;
    }
    await this.updateParameter(
      positionKey,
      positionMultiplier,
      0.6,
      conditionLevel,
      'monte_carlo'
    );
  }

  /**
   * Update a single learned parameter with exponential smoothing
   */
  private async updateParameter(
    name: string,
    value: number,
    confidence: number,
    conditionLevel: MarketConditionLevel,
    source: LearnedParameter['source']
  ): Promise<void> {
    const existing = this.state.learnedParameters.get(name);
    
    if (existing) {
      // Exponential smoothing: new = alpha * observed + (1-alpha) * previous
      const alpha = 0.2; // Learning rate
      const smoothedValue = alpha * value + (1 - alpha) * existing.value;
      const smoothedConfidence = alpha * confidence + (1 - alpha) * existing.confidence;
      
      const updated: LearnedParameter = {
        ...existing,
        previousValue: existing.value,
        value: smoothedValue,
        confidence: smoothedConfidence,
        sampleSize: existing.sampleSize + 1,
        lastUpdated: Date.now(),
      };
      
      this.state.learnedParameters.set(name, updated);
      await this.persistLearnedParameter(updated);
    } else {
      const param: LearnedParameter = {
        id: `param-${randomUUID()}`,
        name,
        value,
        previousValue: value,
        confidence,
        sampleSize: 1,
        lastUpdated: Date.now(),
        marketCondition: conditionLevel,
        source,
      };
      
      this.state.learnedParameters.set(name, param);
      await this.persistLearnedParameter(param);
    }
  }

  /**
   * Record a failed strategy to avoid repeating
   */
  private async recordFailedStrategy(
    strategy: StrategyProfile,
    conditionLevel: MarketConditionLevel,
    result: SimulationResult
  ): Promise<void> {
    const key = `${strategy.name}_${conditionLevel}`;
    
    const record: FailedStrategyRecord = {
      id: `failed-${randomUUID()}`,
      strategyName: strategy.name,
      parameters: {
        baseSuccessRate: strategy.baseSuccessRate,
        avgProfitPerTrade: strategy.avgProfitPerTrade,
        avgLossPerTrade: strategy.avgLossPerTrade,
        tradesPerDay: strategy.tradesPerDay,
        slippageTolerance: strategy.slippageTolerance,
      },
      failureReason: result.winRate < 0.1 ? 'extremely_low_win_rate' :
                     result.sharpeRatio < -2 ? 'very_negative_sharpe' :
                     result.maxDrawdown > 0.5 ? 'excessive_drawdown' :
                     'poor_overall_performance',
      marketCondition: conditionLevel,
      winRate: result.winRate,
      loss: Math.abs(result.expectedProfit),
      timestamp: Date.now(),
      blacklisted: result.winRate < 0.1 || result.sharpeRatio < -3,
    };

    this.state.failedStrategies.set(key, record);
    await this.persistFailedStrategy(record);

    logger.warn('Failed strategy recorded', {
      component: 'DeepLearningStore',
      strategy: strategy.name,
      condition: conditionLevel,
      reason: record.failureReason,
      blacklisted: record.blacklisted,
    });
  }

  /**
   * Record evolution generation
   */
  async recordEvolution(
    generation: number,
    parentId: string | null,
    fitness: number,
    parameters: Record<string, number>,
    mutations: string[],
    conditionLevel: MarketConditionLevel,
    survived: boolean
  ): Promise<void> {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return;
    const record: EvolutionRecord = {
      id: `evo-${randomUUID()}`,
      generation,
      parentId,
      fitness,
      parameters,
      mutations,
      marketCondition: conditionLevel,
      timestamp: Date.now(),
      survived,
    };

    this.state.evolutionHistory.push(record);
    
    // Limit history size
    if (this.state.evolutionHistory.length > 500) {
      this.state.evolutionHistory = this.state.evolutionHistory.slice(-250);
    }

    await this.persistEvolutionRecord(record);
  }

  /**
   * Run a learning cycle to update adaptive thresholds
   */
  async runLearningCycle(): Promise<void> {
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return;
    logger.info('Running deep learning cycle...', {
      component: 'DeepLearningStore',
      totalSimulations: this.state.totalSimulations,
    });

    this.state.lastLearningCycle = Date.now();

    // Update adaptive thresholds based on accumulated data
    await this.updateAdaptiveThresholds();

    // Persist all state
    await this.persistAllState();

    logger.info('Deep learning cycle completed', {
      component: 'DeepLearningStore',
      updatedParams: this.state.learnedParameters.size,
      updatedThresholds: this.state.adaptiveThresholds.size,
    });
  }

  /**
   * Update adaptive thresholds based on learned data
   */
  private async updateAdaptiveThresholds(): Promise<void> {
    // Calculate optimal thresholds per condition from performance data
    const conditions: MarketConditionLevel[] = ['ideal', 'average', 'poor'];
    
    for (const condition of conditions) {
      // Position size threshold
      const positionParam = this.state.learnedParameters.get(`position_multiplier_${condition}`);
      if (positionParam && positionParam.sampleSize >= 10) {
        const threshold: AdaptiveThreshold = {
          id: `threshold-position-${condition}`,
          name: `position_size_${condition}`,
          idealValue: condition === 'ideal' ? 1.0 : positionParam.value * 1.2,
          averageValue: condition === 'average' ? positionParam.value : positionParam.value * 0.8,
          poorValue: condition === 'poor' ? positionParam.value : positionParam.value * 0.5,
          autoAdjusted: true,
          adjustmentFactor: positionParam.confidence,
          lastUpdated: Date.now(),
        };
        this.state.adaptiveThresholds.set(threshold.name, threshold);
        await this.persistAdaptiveThreshold(threshold);
      }

      // Profit threshold
      const profitParam = this.state.learnedParameters.get(`optimal_profit_threshold_${condition}`);
      if (profitParam && profitParam.sampleSize >= 10) {
        const threshold: AdaptiveThreshold = {
          id: `threshold-profit-${condition}`,
          name: `min_profit_${condition}`,
          idealValue: profitParam.value,
          averageValue: profitParam.value * 1.5,
          poorValue: profitParam.value * 2.5,
          autoAdjusted: true,
          adjustmentFactor: profitParam.confidence,
          lastUpdated: Date.now(),
        };
        this.state.adaptiveThresholds.set(threshold.name, threshold);
        await this.persistAdaptiveThreshold(threshold);
      }
    }
  }

  /**
   * Check if a strategy should be avoided (blacklisted)
   */
  isStrategyBlacklisted(strategyName: string, conditionLevel: MarketConditionLevel): boolean {
    const key = `${strategyName}_${conditionLevel}`;
    const record = this.state.failedStrategies.get(key);
    return record?.blacklisted === true;
  }

  /**
   * Get optimal parameters for a market condition
   */
  getOptimalParameters(conditionLevel: MarketConditionLevel): Record<string, number> {
    const params: Record<string, number> = {};
    
    for (const [name, param] of this.state.learnedParameters) {
      if (param.marketCondition === conditionLevel && param.sampleSize >= 5) {
        const shortName = name.replace(`_${conditionLevel}`, '');
        params[shortName] = param.value;
      }
    }
    
    return params;
  }

  /**
   * Get adaptive threshold for a condition
   */
  getAdaptiveThreshold(name: string, conditionLevel: MarketConditionLevel): number | null {
    const threshold = this.state.adaptiveThresholds.get(`${name}_${conditionLevel}`);
    if (!threshold) return null;
    
    switch (conditionLevel) {
      case 'ideal': return threshold.idealValue;
      case 'average': return threshold.averageValue;
      case 'poor': return threshold.poorValue;
      default: return threshold.averageValue;
    }
  }

  /**
   * Get learning statistics
   */
  getStatistics(): {
    totalSimulations: number;
    learnedParameters: number;
    failedStrategies: number;
    evolutionGenerations: number;
    adaptiveThresholds: number;
    lastLearningCycle: number;
  } {
    return {
      totalSimulations: this.state.totalSimulations,
      learnedParameters: this.state.learnedParameters.size,
      failedStrategies: this.state.failedStrategies.size,
      evolutionGenerations: this.state.evolutionHistory.length,
      adaptiveThresholds: this.state.adaptiveThresholds.size,
      lastLearningCycle: this.state.lastLearningCycle,
    };
  }

  // ============================================
  // SUPABASE PERSISTENCE METHODS
  // ============================================

  private async loadLearnedParameters(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('cryptocrawler_learned_parameters')
        .select('*')
        .order('last_updated', { ascending: false });

      if (data && !error) {
        for (const row of data) {
          const param: LearnedParameter = {
            id: row.id,
            name: row.name,
            value: row.value,
            previousValue: row.previous_value,
            confidence: row.confidence,
            sampleSize: row.sample_size,
            lastUpdated: new Date(row.last_updated).getTime(),
            marketCondition: row.market_condition,
            source: row.source,
          };
          this.state.learnedParameters.set(param.name, param);
        }
        logger.info(`Loaded ${data.length} learned parameters from Supabase`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      logger.warn('Failed to load learned parameters from Supabase', {
        component: 'DeepLearningStore',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadStrategyPerformance(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('cryptocrawler_strategy_performance')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(500);

      if (data && !error) {
        for (const row of data) {
          const perf: StrategyPerformance = {
            id: row.id,
            strategyName: row.strategy_name,
            marketCondition: row.market_condition,
            winRate: row.win_rate,
            sharpeRatio: row.sharpe_ratio,
            profitFactor: row.profit_factor,
            maxDrawdown: row.max_drawdown,
            expectedProfit: row.expected_profit,
            sampleSize: row.sample_size,
            timestamp: new Date(row.timestamp).getTime(),
            simulationConfig: row.simulation_config,
          };
          
          if (!this.state.strategyPerformance.has(perf.strategyName)) {
            this.state.strategyPerformance.set(perf.strategyName, []);
          }
          this.state.strategyPerformance.get(perf.strategyName)!.push(perf);
        }
        logger.info(`Loaded ${data.length} strategy performance records from Supabase`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      logger.warn('Failed to load strategy performance from Supabase', {
        component: 'DeepLearningStore',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadFailedStrategies(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('cryptocrawler_failed_strategies')
        .select('*')
        .eq('blacklisted', true);

      if (data && !error) {
        for (const row of data) {
          const record: FailedStrategyRecord = {
            id: row.id,
            strategyName: row.strategy_name,
            parameters: row.parameters,
            failureReason: row.failure_reason,
            marketCondition: row.market_condition,
            winRate: row.win_rate,
            loss: row.loss,
            timestamp: new Date(row.timestamp).getTime(),
            blacklisted: row.blacklisted,
          };
          
          const key = `${record.strategyName}_${record.marketCondition}`;
          this.state.failedStrategies.set(key, record);
        }
        logger.info(`Loaded ${data.length} failed/blacklisted strategies from Supabase`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      logger.warn('Failed to load failed strategies from Supabase', {
        component: 'DeepLearningStore',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadAdaptiveThresholds(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase
        .from('cryptocrawler_adaptive_thresholds')
        .select('*');

      if (data && !error) {
        for (const row of data) {
          const threshold: AdaptiveThreshold = {
            id: row.id,
            name: row.name,
            idealValue: row.ideal_value,
            averageValue: row.average_value,
            poorValue: row.poor_value,
            autoAdjusted: row.auto_adjusted,
            adjustmentFactor: row.adjustment_factor,
            lastUpdated: new Date(row.last_updated).getTime(),
          };
          this.state.adaptiveThresholds.set(threshold.name, threshold);
        }
        logger.info(`Loaded ${data.length} adaptive thresholds from Supabase`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      logger.warn('Failed to load adaptive thresholds from Supabase', {
        component: 'DeepLearningStore',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persistLearnedParameter(param: LearnedParameter): Promise<void> {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase
        .from('cryptocrawler_learned_parameters')
        .upsert({
          id: param.id,
          name: param.name,
          value: param.value,
          previous_value: param.previousValue,
          confidence: param.confidence,
          sample_size: param.sampleSize,
          last_updated: new Date(param.lastUpdated),
          market_condition: param.marketCondition,
          source: param.source,
        }, { onConflict: 'name' });

      if (error && error.code !== '42P01') {
        logger.warn(`Failed to persist learned parameter: ${error.message}`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      // Silently ignore persistence errors
    }
  }

  private async persistStrategyPerformance(perf: StrategyPerformance): Promise<void> {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase
        .from('cryptocrawler_strategy_performance')
        .insert({
          id: perf.id,
          strategy_name: perf.strategyName,
          market_condition: perf.marketCondition,
          win_rate: perf.winRate,
          sharpe_ratio: perf.sharpeRatio,
          profit_factor: perf.profitFactor,
          max_drawdown: perf.maxDrawdown,
          expected_profit: perf.expectedProfit,
          sample_size: perf.sampleSize,
          timestamp: new Date(perf.timestamp),
          simulation_config: perf.simulationConfig,
        });

      if (error && error.code !== '42P01') {
        logger.warn(`Failed to persist strategy performance: ${error.message}`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      // Silently ignore persistence errors
    }
  }

  private async persistFailedStrategy(record: FailedStrategyRecord): Promise<void> {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase
        .from('cryptocrawler_failed_strategies')
        .upsert({
          id: record.id,
          strategy_name: record.strategyName,
          parameters: record.parameters,
          failure_reason: record.failureReason,
          market_condition: record.marketCondition,
          win_rate: record.winRate,
          loss: record.loss,
          timestamp: new Date(record.timestamp),
          blacklisted: record.blacklisted,
        }, { onConflict: 'id' });

      if (error && error.code !== '42P01') {
        logger.warn(`Failed to persist failed strategy: ${error.message}`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      // Silently ignore persistence errors
    }
  }

  private async persistEvolutionRecord(record: EvolutionRecord): Promise<void> {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase
        .from('cryptocrawler_evolution_records')
        .insert({
          id: record.id,
          generation: record.generation,
          parent_id: record.parentId,
          fitness: record.fitness,
          parameters: record.parameters,
          mutations: record.mutations,
          market_condition: record.marketCondition,
          timestamp: new Date(record.timestamp),
          survived: record.survived,
        });

      if (error && error.code !== '42P01') {
        logger.warn(`Failed to persist evolution record: ${error.message}`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      // Silently ignore persistence errors
    }
  }

  private async persistAdaptiveThreshold(threshold: AdaptiveThreshold): Promise<void> {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase
        .from('cryptocrawler_adaptive_thresholds')
        .upsert({
          id: threshold.id,
          name: threshold.name,
          ideal_value: threshold.idealValue,
          average_value: threshold.averageValue,
          poor_value: threshold.poorValue,
          auto_adjusted: threshold.autoAdjusted,
          adjustment_factor: threshold.adjustmentFactor,
          last_updated: new Date(threshold.lastUpdated),
        }, { onConflict: 'name' });

      if (error && error.code !== '42P01') {
        logger.warn(`Failed to persist adaptive threshold: ${error.message}`, {
          component: 'DeepLearningStore',
        });
      }
    } catch (error) {
      // Silently ignore persistence errors
    }
  }

  private async persistAllState(): Promise<void> {
    // Persist all learned parameters
    for (const param of this.state.learnedParameters.values()) {
      await this.persistLearnedParameter(param);
    }

    // Persist all adaptive thresholds
    for (const threshold of this.state.adaptiveThresholds.values()) {
      await this.persistAdaptiveThreshold(threshold);
    }

    logger.debug('All learning state persisted to Supabase', {
      component: 'DeepLearningStore',
    });
  }

  private startPeriodicPersistence(): void {
    if (this.persistInterval) return;
    if (!getCryptocrawlGovernance().isLongTermMemoryAllowed()) return;

    // Persist every 60 seconds
    this.persistInterval = setInterval(async () => {
      try {
        // Gate background persistence behind explicit envelope permission when available.
        getCryptocrawlGovernance().requireAllowed('PERSIST_LONG_TERM_MEMORY');
        await this.persistAllState();
      } catch {
        // If paused/no envelope, skip persistence (deny-by-default).
      }
    }, 60000);
  }

  /**
   * Stop the store and persist final state
   */
  async stop(): Promise<void> {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }

    await this.persistAllState();
    logger.info('Deep Learning Store stopped', {
      component: 'DeepLearningStore',
    });
  }

  /**
   * Reset the store (for testing)
   */
  reset(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }

    this.state = this.createInitialState();
    this.isInitialized = false;
    this.pendingUpdates = 0;

    logger.info('Deep Learning Store reset', {
      component: 'DeepLearningStore',
    });
  }
}

// Singleton instance
export const deepLearningStore = new DeepLearningStore();
export { DeepLearningStore };
