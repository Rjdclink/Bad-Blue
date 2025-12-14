// Circuit Breaker - Advanced Risk Management System
// Implements multi-level protection with automatic recovery
// Research-backed: Based on institutional trading safeguards

import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

// Supported chains - must match ChainId type
const SUPPORTED_CHAINS: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];

export interface CircuitBreakerConfig {
  // Loss limits
  maxDailyLoss: number;           // Maximum daily loss before halt (ETH)
  maxHourlyLoss: number;          // Maximum hourly loss before pause
  maxConsecutiveLosses: number;   // Max consecutive losses before pause
  
  // Position limits
  maxPositionSize: number;        // Maximum single position size (ETH)
  maxTotalExposure: number;       // Maximum total exposure (ETH)
  maxPositionsPerChain: number;   // Max concurrent positions per chain
  
  // Execution limits
  maxExecutionsPerMinute: number; // Rate limit on executions
  maxSlippage: number;            // Max allowed slippage (percentage)
  minProfitThreshold: number;     // Minimum profit to execute (ETH)
  
  // Recovery settings
  recoveryPeriodMs: number;       // Cooldown period after trigger
  gradualRecoverySteps: number;   // Steps to full capacity
  
  // === NEW: PROFIT CAP LADDER ===
  // Daily profit caps for controlled scaling ($200 → $400 → $800 → $1600)
  profitCapLadder: {
    tier1Cap: number;             // $200 equivalent in ETH
    tier2Cap: number;             // $400 equivalent in ETH
    tier3Cap: number;             // $800 equivalent in ETH
    tier4Cap: number;             // $1600 equivalent in ETH
  };
  stableDaysRequiredPerTier: number; // Days of stable operation before tier upgrade (3-5)
  
  // === NEW: DATA DESYNC DETECTION ===
  desyncDetection: {
    maxPriceDeviationPercent: number;  // Max allowed price deviation between sources
    minAgreementSources: number;        // Minimum sources that must agree
    staleDataThresholdMs: number;       // Max age of price data before considered stale
  };
}

export interface BreakerState {
  status: 'active' | 'paused' | 'halted' | 'recovering';
  level: BreakerLevel;
  triggeredAt?: number;
  triggerReason?: string;
  recoveryProgress: number;       // 0-100%
  metrics: BreakerMetrics;
}

export interface BreakerMetrics {
  dailyPnL: number;
  hourlyPnL: number;
  consecutiveLosses: number;
  totalExposure: number;
  executionsLastMinute: number;
  executionsLastHour: number;
  lastExecutionTime: number;
  positionsPerChain: Record<ChainId, number>;
  
  // === NEW: PROFIT CAP TRACKING ===
  dailyProfit: number;            // Total profit today (positive PnL only)
  currentProfitTier: number;      // Current tier (1-4)
  consecutiveStableDays: number;  // Days meeting tier requirements without violations
  lastTierUpgrade: number;        // Timestamp of last tier upgrade
  
  // === NEW: DESYNC TRACKING ===
  lastDesyncCheck: number;        // Timestamp of last desync check
  desyncViolations: number;       // Count of desync violations today
  priceSourceAgreement: number;   // 0-1 agreement score
}

export type BreakerLevel = 'green' | 'yellow' | 'orange' | 'red';

interface ExecutionRecord {
  timestamp: number;
  pnl: number;
  chain: ChainId;
  size: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxDailyLoss: 1.0,              // 1 ETH daily loss limit
  maxHourlyLoss: 0.2,             // 0.2 ETH hourly loss limit
  maxConsecutiveLosses: 5,        // 5 consecutive losses
  maxPositionSize: 0.5,           // 0.5 ETH max position
  maxTotalExposure: 2.0,          // 2 ETH total exposure
  maxPositionsPerChain: 3,        // 3 concurrent positions per chain
  maxExecutionsPerMinute: 10,     // 10 executions per minute
  maxSlippage: 0.02,              // 2% max slippage
  minProfitThreshold: 0.001,      // 0.001 ETH minimum profit
  recoveryPeriodMs: 300000,       // 5 minutes recovery
  gradualRecoverySteps: 5,        // 5 steps to full capacity
  
  // === PROFIT CAP LADDER (assuming $2000/ETH) ===
  profitCapLadder: {
    tier1Cap: 0.1,                // $200 = 0.1 ETH
    tier2Cap: 0.2,                // $400 = 0.2 ETH
    tier3Cap: 0.4,                // $800 = 0.4 ETH
    tier4Cap: 0.8,                // $1600 = 0.8 ETH
  },
  stableDaysRequiredPerTier: 3,   // 3 stable days before tier upgrade
  
  // === DATA DESYNC DETECTION ===
  desyncDetection: {
    maxPriceDeviationPercent: 2.0, // Max 2% price deviation allowed
    minAgreementSources: 3,        // Need at least 3 sources to agree
    staleDataThresholdMs: 30000,   // Data older than 30s is stale
  },
};

class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: BreakerState;
  private executionHistory: ExecutionRecord[] = [];
  private recoveryTimer?: NodeJS.Timeout;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    // Validate and merge config with defaults
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Validate all numeric values are positive
    if (mergedConfig.maxDailyLoss <= 0) throw new Error('maxDailyLoss must be positive');
    if (mergedConfig.maxHourlyLoss <= 0) throw new Error('maxHourlyLoss must be positive');
    if (mergedConfig.maxConsecutiveLosses <= 0) throw new Error('maxConsecutiveLosses must be positive');
    if (mergedConfig.maxPositionSize <= 0) throw new Error('maxPositionSize must be positive');
    if (mergedConfig.maxTotalExposure <= 0) throw new Error('maxTotalExposure must be positive');
    if (mergedConfig.maxPositionsPerChain <= 0) throw new Error('maxPositionsPerChain must be positive');
    if (mergedConfig.maxExecutionsPerMinute <= 0) throw new Error('maxExecutionsPerMinute must be positive');
    if (mergedConfig.maxSlippage < 0 || mergedConfig.maxSlippage > 1) throw new Error('maxSlippage must be between 0 and 1');
    if (mergedConfig.recoveryPeriodMs <= 0) throw new Error('recoveryPeriodMs must be positive');
    if (mergedConfig.gradualRecoverySteps <= 0) throw new Error('gradualRecoverySteps must be positive');
    
    // Ensure logical constraints
    if (mergedConfig.maxHourlyLoss > mergedConfig.maxDailyLoss) {
      mergedConfig.maxHourlyLoss = mergedConfig.maxDailyLoss;
    }
    if (mergedConfig.maxPositionSize > mergedConfig.maxTotalExposure) {
      mergedConfig.maxPositionSize = mergedConfig.maxTotalExposure;
    }
    
    this.config = mergedConfig;
    this.state = this.initializeState();
  }

  private initializeState(): BreakerState {
    return {
      status: 'active',
      level: 'green',
      recoveryProgress: 100,
      metrics: {
        dailyPnL: 0,
        hourlyPnL: 0,
        consecutiveLosses: 0,
        totalExposure: 0,
        executionsLastMinute: 0,
        executionsLastHour: 0,
        lastExecutionTime: 0,
        // Initialize positions for all supported chains
        positionsPerChain: SUPPORTED_CHAINS.reduce((acc, chain) => {
          acc[chain] = 0;
          return acc;
        }, {} as Record<ChainId, number>),
        
        // === NEW: PROFIT CAP TRACKING ===
        dailyProfit: 0,
        currentProfitTier: 1,             // Start at tier 1
        consecutiveStableDays: 0,
        lastTierUpgrade: Date.now(),
        
        // === NEW: DESYNC TRACKING ===
        lastDesyncCheck: 0,
        desyncViolations: 0,
        priceSourceAgreement: 1.0,        // Start assuming full agreement
      }
    };
  }

  /**
   * Check if execution is allowed
   */
  canExecute(params: {
    chain: ChainId;
    size: number;
    expectedProfit: number;
    expectedSlippage: number;
  }): { allowed: boolean; reason?: string } {
    // Check if breaker is tripped
    if (this.state.status === 'halted') {
      return { allowed: false, reason: 'System halted due to risk limits' };
    }

    if (this.state.status === 'paused') {
      return { allowed: false, reason: 'System paused, awaiting recovery' };
    }

    // Update metrics before checks
    this.updateMetrics();

    // === NEW: PROFIT CAP CHECK ===
    const currentCap = this.getCurrentProfitCap();
    if (this.state.metrics.dailyProfit >= currentCap) {
      return { 
        allowed: false, 
        reason: `Daily profit cap reached (${this.state.metrics.dailyProfit.toFixed(4)} ETH >= ${currentCap} ETH at tier ${this.state.metrics.currentProfitTier}). Wait for tier upgrade or next day.` 
      };
    }

    // Check if this trade would exceed the cap
    if (this.state.metrics.dailyProfit + params.expectedProfit > currentCap) {
      return { 
        allowed: false, 
        reason: `Trade would exceed daily profit cap. Current: ${this.state.metrics.dailyProfit.toFixed(4)}, Expected: ${params.expectedProfit.toFixed(4)}, Cap: ${currentCap} ETH` 
      };
    }

    // === NEW: DATA DESYNC CHECK ===
    if (this.state.metrics.priceSourceAgreement < (1 - this.config.desyncDetection.maxPriceDeviationPercent / 100)) {
      return {
        allowed: false,
        reason: `Price source desync detected (agreement: ${(this.state.metrics.priceSourceAgreement * 100).toFixed(1)}%). Waiting for price convergence.`
      };
    }

    // Check position size
    if (params.size > this.getAdjustedLimit('maxPositionSize')) {
      return { allowed: false, reason: `Position size ${params.size} exceeds limit ${this.getAdjustedLimit('maxPositionSize')}` };
    }

    // Check total exposure
    if (this.state.metrics.totalExposure + params.size > this.getAdjustedLimit('maxTotalExposure')) {
      return { allowed: false, reason: 'Total exposure limit would be exceeded' };
    }

    // Check positions per chain
    if (this.state.metrics.positionsPerChain[params.chain] >= this.config.maxPositionsPerChain) {
      return { allowed: false, reason: `Max positions on ${params.chain} reached` };
    }

    // Check execution rate
    if (this.state.metrics.executionsLastMinute >= this.config.maxExecutionsPerMinute) {
      return { allowed: false, reason: 'Execution rate limit reached' };
    }

    // Check slippage
    if (params.expectedSlippage > this.config.maxSlippage) {
      return { allowed: false, reason: `Slippage ${params.expectedSlippage} exceeds limit ${this.config.maxSlippage}` };
    }

    // Check minimum profit
    if (params.expectedProfit < this.config.minProfitThreshold) {
      return { allowed: false, reason: `Expected profit ${params.expectedProfit} below threshold ${this.config.minProfitThreshold}` };
    }

    // Check consecutive losses
    if (this.state.metrics.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      return { allowed: false, reason: 'Maximum consecutive losses reached' };
    }

    return { allowed: true };
  }

  /**
   * Get current profit cap based on tier
   */
  private getCurrentProfitCap(): number {
    const tier = this.state.metrics.currentProfitTier;
    switch (tier) {
      case 1: return this.config.profitCapLadder.tier1Cap;
      case 2: return this.config.profitCapLadder.tier2Cap;
      case 3: return this.config.profitCapLadder.tier3Cap;
      case 4: return this.config.profitCapLadder.tier4Cap;
      default: return this.config.profitCapLadder.tier1Cap;
    }
  }

  /**
   * Check and potentially upgrade profit tier
   * Called at end of each day
   */
  checkTierUpgrade(): { upgraded: boolean; newTier: number; reason: string } {
    const currentTier = this.state.metrics.currentProfitTier;
    const stableDays = this.state.metrics.consecutiveStableDays;
    const requiredDays = this.config.stableDaysRequiredPerTier;

    // Can't upgrade past tier 4
    if (currentTier >= 4) {
      return { upgraded: false, newTier: 4, reason: 'Already at maximum tier' };
    }

    // Check if enough stable days
    if (stableDays >= requiredDays) {
      this.state.metrics.currentProfitTier = currentTier + 1;
      this.state.metrics.consecutiveStableDays = 0;
      this.state.metrics.lastTierUpgrade = Date.now();

      logger.info('Profit tier upgraded', {
        component: 'CircuitBreaker',
        previousTier: currentTier,
        newTier: currentTier + 1,
        newCap: this.getCurrentProfitCap()
      });

      return { 
        upgraded: true, 
        newTier: currentTier + 1, 
        reason: `Upgraded after ${stableDays} stable days` 
      };
    }

    return { 
      upgraded: false, 
      newTier: currentTier, 
      reason: `Need ${requiredDays - stableDays} more stable days` 
    };
  }

  /**
   * Update price source agreement score
   * Call this with price data from multiple sources
   */
  updatePriceAgreement(prices: { source: string; price: number; timestamp: number }[]): void {
    const now = Date.now();
    const freshPrices = prices.filter(
      p => (now - p.timestamp) < this.config.desyncDetection.staleDataThresholdMs
    );

    // Need minimum sources
    if (freshPrices.length < this.config.desyncDetection.minAgreementSources) {
      this.state.metrics.priceSourceAgreement = 0;
      this.state.metrics.desyncViolations++;
      
      logger.warn('Insufficient price sources', {
        component: 'CircuitBreaker',
        required: this.config.desyncDetection.minAgreementSources,
        available: freshPrices.length
      });
      return;
    }

    // Calculate price deviation
    const priceValues = freshPrices.map(p => p.price);
    const avgPrice = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;
    const maxDeviation = Math.max(...priceValues.map(p => Math.abs(p - avgPrice) / avgPrice));

    // Convert deviation to agreement score (0-1)
    const agreement = Math.max(0, 1 - (maxDeviation / (this.config.desyncDetection.maxPriceDeviationPercent / 100)));
    
    this.state.metrics.priceSourceAgreement = agreement;
    this.state.metrics.lastDesyncCheck = now;

    if (maxDeviation * 100 > this.config.desyncDetection.maxPriceDeviationPercent) {
      this.state.metrics.desyncViolations++;
      
      logger.warn('Price desync detected', {
        component: 'CircuitBreaker',
        maxDeviation: (maxDeviation * 100).toFixed(2) + '%',
        threshold: this.config.desyncDetection.maxPriceDeviationPercent + '%',
        agreement: (agreement * 100).toFixed(1) + '%'
      });
    }
  }

  /**
   * Record end of day and update stable day tracking
   */
  recordEndOfDay(): void {
    const hadViolations = this.state.metrics.desyncViolations > 0 || 
                          this.state.metrics.dailyPnL < 0 ||
                          this.state.status !== 'active';

    if (!hadViolations) {
      this.state.metrics.consecutiveStableDays++;
      logger.info('Stable day recorded', {
        component: 'CircuitBreaker',
        consecutiveStableDays: this.state.metrics.consecutiveStableDays,
        currentTier: this.state.metrics.currentProfitTier
      });
    } else {
      this.state.metrics.consecutiveStableDays = 0;
      logger.info('Stable day streak reset due to violations', {
        component: 'CircuitBreaker',
        desyncViolations: this.state.metrics.desyncViolations,
        dailyPnL: this.state.metrics.dailyPnL,
        status: this.state.status
      });
    }

    // Reset daily metrics
    this.state.metrics.dailyProfit = 0;
    this.state.metrics.desyncViolations = 0;

    // Check for tier upgrade
    this.checkTierUpgrade();
  }

  /**
   * Open a new position (called before execution)
   * Returns a position ID for tracking
   */
  openPosition(chain: ChainId, size: number): string {
    const positionId = `${chain}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Track position opening
    this.state.metrics.totalExposure += size;
    this.state.metrics.positionsPerChain[chain]++;
    
    logger.debug('Position opened', {
      component: 'CircuitBreaker',
      positionId,
      chain,
      size,
      totalExposure: this.state.metrics.totalExposure
    });
    
    return positionId;
  }

  /**
   * Record execution result (called after trade completes)
   */
  recordExecution(result: {
    chain: ChainId;
    size: number;
    pnl: number;
    success: boolean;
  }): void {
    const record: ExecutionRecord = {
      timestamp: Date.now(),
      pnl: result.pnl,
      chain: result.chain,
      size: result.size
    };

    this.executionHistory.push(record);

    // Update PnL metrics
    this.state.metrics.dailyPnL += result.pnl;
    this.state.metrics.hourlyPnL += result.pnl;
    this.state.metrics.lastExecutionTime = record.timestamp;

    // === NEW: Track daily profit for cap enforcement ===
    if (result.pnl > 0) {
      this.state.metrics.dailyProfit += result.pnl;
      this.state.metrics.consecutiveLosses = 0;
      
      // Log profit cap progress
      const currentCap = this.getCurrentProfitCap();
      const capUtilization = (this.state.metrics.dailyProfit / currentCap) * 100;
      
      logger.info('Daily profit updated', {
        component: 'CircuitBreaker',
        dailyProfit: this.state.metrics.dailyProfit.toFixed(4),
        currentCap: currentCap.toFixed(4),
        capUtilization: capUtilization.toFixed(1) + '%',
        tier: this.state.metrics.currentProfitTier
      });
      
      // Warning when approaching cap
      if (capUtilization >= 80) {
        logger.warn('Approaching daily profit cap', {
          component: 'CircuitBreaker',
          utilization: capUtilization.toFixed(1) + '%',
          remaining: (currentCap - this.state.metrics.dailyProfit).toFixed(4) + ' ETH'
        });
      }
    } else if (result.pnl < 0) {
      this.state.metrics.consecutiveLosses++;
    }
    // Note: pnl === 0 (break-even) doesn't reset or increment consecutive losses

    // Check for breaker triggers
    this.evaluateState();

    logger.debug('Execution recorded', {
      component: 'CircuitBreaker',
      chain: result.chain,
      pnl: result.pnl,
      consecutiveLosses: this.state.metrics.consecutiveLosses,
      status: this.state.status
    });
  }

  /**
   * Close/release position (when trade closes, regardless of outcome)
   */
  closePosition(chain: ChainId, size: number): void {
    this.state.metrics.totalExposure = Math.max(0, this.state.metrics.totalExposure - size);
    this.state.metrics.positionsPerChain[chain] = Math.max(0, this.state.metrics.positionsPerChain[chain] - 1);
    
    logger.debug('Position closed', {
      component: 'CircuitBreaker',
      chain,
      size,
      totalExposure: this.state.metrics.totalExposure
    });
  }

  /**
   * @deprecated Use closePosition instead
   * Release position (when trade closes)
   */
  releasePosition(chain: ChainId, size: number): void {
    this.closePosition(chain, size);
  }

  /**
   * Update time-based metrics
   */
  private updateMetrics(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    // Clean old records
    this.executionHistory = this.executionHistory.filter(r => r.timestamp > oneDayAgo);

    // Calculate execution counts
    this.state.metrics.executionsLastMinute = this.executionHistory.filter(r => r.timestamp > oneMinuteAgo).length;
    this.state.metrics.executionsLastHour = this.executionHistory.filter(r => r.timestamp > oneHourAgo).length;

    // Calculate hourly PnL
    this.state.metrics.hourlyPnL = this.executionHistory
      .filter(r => r.timestamp > oneHourAgo)
      .reduce((sum, r) => sum + r.pnl, 0);

    // Calculate daily PnL
    this.state.metrics.dailyPnL = this.executionHistory
      .filter(r => r.timestamp > oneDayAgo)
      .reduce((sum, r) => sum + r.pnl, 0);
  }

  /**
   * Evaluate and update breaker state
   */
  private evaluateState(): void {
    const prevStatus = this.state.status;

    // Check for halt conditions (red)
    if (this.state.metrics.dailyPnL <= -this.config.maxDailyLoss) {
      this.triggerBreaker('halted', 'red', 'Daily loss limit exceeded');
      return;
    }

    // Check for pause conditions (orange)
    if (this.state.metrics.hourlyPnL <= -this.config.maxHourlyLoss) {
      this.triggerBreaker('paused', 'orange', 'Hourly loss limit exceeded');
      return;
    }

    if (this.state.metrics.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.triggerBreaker('paused', 'orange', 'Maximum consecutive losses');
      return;
    }

    // Check for warning conditions (yellow)
    const isWarning = 
      this.state.metrics.hourlyPnL <= -this.config.maxHourlyLoss * 0.7 ||
      this.state.metrics.consecutiveLosses >= this.config.maxConsecutiveLosses - 2 ||
      this.state.metrics.totalExposure >= this.config.maxTotalExposure * 0.8;

    if (isWarning && this.state.status === 'active') {
      this.state.level = 'yellow';
      logger.warn('Circuit breaker warning', {
        component: 'CircuitBreaker',
        level: 'yellow',
        metrics: this.state.metrics
      });
    } else if (!isWarning && this.state.status === 'active') {
      this.state.level = 'green';
    }

    // Log status change
    if (prevStatus !== this.state.status) {
      logger.info('Circuit breaker status changed', {
        component: 'CircuitBreaker',
        from: prevStatus,
        to: this.state.status,
        level: this.state.level
      });
    }
  }

  /**
   * Trigger circuit breaker
   */
  private triggerBreaker(status: 'paused' | 'halted', level: BreakerLevel, reason: string): void {
    this.state.status = status;
    this.state.level = level;
    this.state.triggeredAt = Date.now();
    this.state.triggerReason = reason;
    this.state.recoveryProgress = 0;

    logger.error('Circuit breaker triggered', {
      component: 'CircuitBreaker',
      status,
      level,
      reason,
      metrics: this.state.metrics
    });

    // Start recovery timer for pause (not halt)
    if (status === 'paused') {
      this.startRecovery();
    }
  }

  /**
   * Start gradual recovery
   */
  private startRecovery(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }

    const stepTime = this.config.recoveryPeriodMs / this.config.gradualRecoverySteps;
    const progressPerStep = 100 / this.config.gradualRecoverySteps;

    this.state.status = 'recovering';

    this.recoveryTimer = setInterval(() => {
      this.state.recoveryProgress = Math.min(100, this.state.recoveryProgress + progressPerStep);

      logger.info('Circuit breaker recovering', {
        component: 'CircuitBreaker',
        progress: `${this.state.recoveryProgress}%`
      });

      if (this.state.recoveryProgress >= 100) {
        this.completeRecovery();
      }
    }, stepTime);
  }

  /**
   * Complete recovery
   */
  private completeRecovery(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }

    this.state.status = 'active';
    this.state.level = 'yellow'; // Start cautiously
    this.state.recoveryProgress = 100;
    this.state.metrics.consecutiveLosses = 0;

    logger.info('Circuit breaker recovered', {
      component: 'CircuitBreaker',
      status: this.state.status
    });
  }

  /**
   * Get adjusted limit based on recovery progress
   */
  private getAdjustedLimit(limit: keyof CircuitBreakerConfig): number {
    const baseValue = this.config[limit] as number;
    const adjustment = this.state.recoveryProgress / 100;
    return baseValue * adjustment;
  }

  /**
   * Manual reset (requires confirmation)
   */
  reset(confirm: boolean): boolean {
    if (!confirm) {
      logger.warn('Circuit breaker reset requires confirmation', {
        component: 'CircuitBreaker'
      });
      return false;
    }

    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }

    this.state = this.initializeState();
    this.executionHistory = [];

    logger.info('Circuit breaker manually reset', {
      component: 'CircuitBreaker'
    });

    return true;
  }

  /**
   * Get current state
   */
  getState(): Readonly<BreakerState> {
    return { ...this.state };
  }

  /**
   * Get execution history
   */
  getHistory(hours: number = 24): ExecutionRecord[] {
    const cutoff = Date.now() - (hours * 3600000);
    return this.executionHistory.filter(r => r.timestamp > cutoff);
  }
}

export { CircuitBreaker, type ExecutionRecord };
export default CircuitBreaker;
