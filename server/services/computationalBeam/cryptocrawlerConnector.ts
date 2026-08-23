/**
 * Computational Beam → Cryptocrawler Connector
 * 
 * Purpose: Supply generous computational power to the cryptocrawler system
 * for arbitrage and zero-initial-capital strategy optimization
 * 
 * ONE FILE AT A TIME APPROACH
 */

import { computationalBeam, ComputationalBeamOrchestrator } from './index';
import { WorkloadRouter } from './workloadRouter';
import { CrawlerStrategy, Task, TaskPriority, TaskType, TaskIntensity } from './types';
import { createLogger } from '../../logger';
import { 
  SAFETY_RULES, 
  LEGAL_STRATEGIES,
  verifySafetyCompliance,
  enforceStoragySafety,
  tripleVerifyNoBypass,
} from './safetyRules';

const log = createLogger('CryptoBeamConnector');

/**
 * Cryptocurrency strategy types for admin financial gain
 */
export enum CryptoStrategyType {
  ARBITRAGE = 'arbitrage',
  ZERO_CAPITAL = 'zero-capital',
  MEV_FRONTRUN = 'mev-frontrun',
  LIQUIDITY_SNIPE = 'liquidity-snipe',
  FLASH_LOAN = 'flash-loan',
  MOMENTUM = 'momentum',
  MICRO_TRIANGULATION = 'micro-triangulation',
}

/**
 * Strategy execution parameters
 */
export interface StrategyExecutionParams {
  strategyType: CryptoStrategyType;
  symbols?: string[];
  exchanges?: string[];
  minProfitThreshold?: number; // in USD
  maxSlippage?: number; // percentage
  timeframe?: string;
  chains?: string[]; // blockchain networks
}

/**
 * Strategy execution result
 */
export interface StrategyExecutionResult {
  success: boolean;
  error?: string;
  strategyType: CryptoStrategyType;
  opportunities: OpportunityDetail[];
  profitEstimate: number; // USD
  executionTime: number; // ms
  computePowerUsed: number; // abstract units
}

/**
 * Opportunity detail
 */
export interface OpportunityDetail {
  type: string;
  pair?: string;
  buyExchange?: string;
  sellExchange?: string;
  buyPrice?: number;
  sellPrice?: number;
  profitPotential: number; // USD
  confidence: number; // 0-1
  actionRequired?: string;
}

/**
 * Cryptocrawler Computational Beam Connector
 * 
 * Provides generous computational power to cryptocrawler for:
 * 1. Arbitrage detection across exchanges
 * 2. Zero-initial-capital opportunities
 * 3. Admin financial gain strategies
 */
export class CryptoBeamConnector {
  private static initialized = false;
  private static beamInstance: ComputationalBeamOrchestrator;
  private static workloadRouter: WorkloadRouter;
  
  /**
   * Initialize the connector
   */
  static async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn('CryptoBeamConnector already initialized');
      return;
    }
    
    log.info('🔗 Initializing Cryptocrawler Computational Beam Connector...');
    
    // CRITICAL: Enforce safety rules before initialization
    enforceStoragySafety('cryptocrawler-initialization');
    
    // Verify triple safety (300% certainty)
    const safetyCheck = tripleVerifyNoBypass();
    if (!safetyCheck.allPassed) {
      throw new Error('SAFETY VIOLATION: Triple verification failed during initialization');
    }
    
    log.info('✅ Safety rules verified (300% certainty)');
    log.info('   - NO_MALICIOUS_ACTIVITIES: ' + SAFETY_RULES.NO_MALICIOUS_ACTIVITIES);
    log.info('   - NO_RULE_EVASION: ' + SAFETY_RULES.NO_RULE_EVASION);
    log.info('   - U_S_FEDERAL_LAW_ONLY: ' + SAFETY_RULES.U_S_FEDERAL_LAW_ONLY);
    
    // Initialize computational beam (no credentials required)
    await computationalBeam.initialize();
    
    this.beamInstance = computationalBeam;
    this.workloadRouter = new WorkloadRouter();
    
    this.initialized = true;
    
    log.info('✅ Cryptocrawler connected to Computational Beam');
    log.info('   Purpose: Supply generous computational power for crypto strategies');
    log.info('   Strategies: Arbitrage, Zero-Capital, MEV, Liquidity Snipe (ALL LEGAL)');
  }
  
  /**
   * Execute cryptocurrency strategy with computational beam power
   * 
   * ONE FILE AT A TIME: This is the first integration point
   * SAFETY: All strategies verified against hardcoded safety rules
   */
  static async executeStrategy(
    params: StrategyExecutionParams
  ): Promise<StrategyExecutionResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // CRITICAL: Verify strategy is legal before execution
    const safetyCheck = verifySafetyCompliance(params.strategyType);
    if (!safetyCheck.allowed) {
      log.error('🚫 Strategy execution BLOCKED by safety rules', {
        strategy: params.strategyType,
        reason: safetyCheck.reason,
      });
      
      return {
        success: false,
        strategyType: params.strategyType,
        opportunities: [],
        profitEstimate: 0,
        executionTime: 0,
        computePowerUsed: 0,
      };
    }
    
    log.info('✅ Strategy safety verified: ' + safetyCheck.reason);
    
    const startTime = Date.now();
    
    log.info('🚀 Executing crypto strategy with computational beam', {
      strategy: params.strategyType,
      symbols: params.symbols,
      exchanges: params.exchanges,
      legalStatus: 'PERMITTED',
    });
    
    try {
      // Map crypto strategy to task type
      const taskType = this.mapToTaskType(params.strategyType);
      const crawlerStrategy = this.mapToCrawlerStrategy(params.strategyType);
      
      void taskType;
      void crawlerStrategy;
      throw new Error('No verified CryptoCrawler workload is registered with the Computational Beam; refusing to fabricate an opportunity or execution result');
      
    } catch (error) {
      log.error('❌ Crypto strategy execution failed', {
        strategy: params.strategyType,
        error: error instanceof Error ? error.message : String(error),
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        strategyType: params.strategyType,
        opportunities: [],
        profitEstimate: 0,
        executionTime: Date.now() - startTime,
        computePowerUsed: 0,
      };
    }
  }
  
  /**
   * Execute arbitrage detection (most common strategy)
   */
  static async executeArbitrage(
    symbols?: string[],
    exchanges?: string[]
  ): Promise<StrategyExecutionResult> {
    return this.executeStrategy({
      strategyType: CryptoStrategyType.ARBITRAGE,
      symbols,
      exchanges,
      minProfitThreshold: 10, // $10 minimum
    });
  }
  
  /**
   * Execute zero-capital strategy detection
   */
  static async executeZeroCapital(
    chains?: string[]
  ): Promise<StrategyExecutionResult> {
    return this.executeStrategy({
      strategyType: CryptoStrategyType.ZERO_CAPITAL,
      chains,
      minProfitThreshold: 5, // $5 minimum for zero-capital
    });
  }
  
  /**
   * Map crypto strategy type to task type
   */
  private static mapToTaskType(strategyType: CryptoStrategyType): TaskType {
    switch (strategyType) {
      case CryptoStrategyType.ARBITRAGE:
        return TaskType.ARBITRAGE_SCAN;
      case CryptoStrategyType.ZERO_CAPITAL:
        return TaskType.ARBITRAGE_SCAN; // Use arbitrage for zero-capital
      case CryptoStrategyType.MEV_FRONTRUN:
        return TaskType.ML_PREDICTION;
      case CryptoStrategyType.MOMENTUM:
        return TaskType.MOMENTUM_STRATEGY;
      case CryptoStrategyType.MICRO_TRIANGULATION:
        return TaskType.MICRO_TRIANGULATION;
      default:
        return TaskType.MARKET_AGGREGATION;
    }
  }

  /**
   * Map crypto strategy type to crawler strategy (deprecated - use mapToTaskType)
   */
  private static mapToCrawlerStrategy(strategyType: CryptoStrategyType): CrawlerStrategy {
    switch (strategyType) {
      case CryptoStrategyType.ARBITRAGE:
        return CrawlerStrategy.ARBITRAGE;
      case CryptoStrategyType.ZERO_CAPITAL:
        return CrawlerStrategy.ARBITRAGE; // Use arbitrage for zero-capital
      case CryptoStrategyType.MEV_FRONTRUN:
        return CrawlerStrategy.PREDICTIVE_ML;
      case CryptoStrategyType.LIQUIDITY_SNIPE:
        return CrawlerStrategy.MICRO_TRIANGULATION;
      case CryptoStrategyType.FLASH_LOAN:
        return CrawlerStrategy.ALPHA_DRIFT;
      default:
        return CrawlerStrategy.MOMENTUM;
    }
  }
  
  /**
   * Get connector status
   */
  static getStatus(): {
    initialized: boolean;
    purpose: string;
    supportedStrategies: string[];
  } {
    return {
      initialized: this.initialized,
      purpose: 'Supply generous computational power for cryptocurrency strategies',
      supportedStrategies: Object.values(CryptoStrategyType),
    };
  }
}

export default CryptoBeamConnector;
