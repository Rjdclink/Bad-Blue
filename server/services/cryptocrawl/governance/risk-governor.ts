/**
 * CryptoCrawler Risk Governor - Monte Carlo Consensus & Capital Management
 * 
 * PURPOSE: Manage risk through Monte Carlo consensus validation,
 * position sizing, and capital allocation with strict safety controls.
 * 
 * INTEGRATION: Works with Stage Governor to enforce stage-specific limits
 * 
 * KEY FEATURES:
 * 1. Monte Carlo consensus for trade validation
 * 2. Kelly Criterion position sizing
 * 3. Circuit breaker integration
 * 4. Capital partitioning by stage
 * 5. Real-time risk monitoring
 */

import { EventEmitter } from 'events';
import logger from '../../../logger.js';
import { stageGovernor, type StageNumber, type MonteCarloValidation } from './stage-governor.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface RiskGovernorConfig {
  // Capital limits by stage
  capitalLimits: Record<StageNumber, {
    maxCapitalAtRisk: number;      // USD
    maxPositionSize: number;       // USD per trade
    maxDailyDrawdown: number;      // Percentage
    maxHourlyDrawdown: number;     // Percentage
    maxConsecutiveLosses: number;
  }>;
  
  // Monte Carlo consensus requirements
  monteCarloRequirements: {
    minSimulations: number;
    minWinRate: number;
    minSharpeRatio: number;
    maxDrawdown: number;
    consensusThreshold: number;    // Percentage of validators that must approve
  };
  
  // Position sizing
  kellyFraction: number;           // Fraction of Kelly to use (0.25 = quarter Kelly)
  maxKellyMultiple: number;        // Cap on Kelly-derived position size
  
  // Circuit breaker
  circuitBreakerConfig: {
    maxDailyLoss: number;          // USD
    maxHourlyLoss: number;         // USD
    cooldownPeriod: number;        // milliseconds
    halfOpenAttempts: number;
  };
}

export interface TradeProposal {
  id: string;
  pair: string;
  exchange: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  proposedSize: number;           // USD
  expectedProfit: number;
  expectedFees: number;
  expectedSlippage: number;
  latencyMs: number;
  timestamp: number;
}

export interface TradeValidation {
  proposal: TradeProposal;
  approved: boolean;
  approvedSize: number;           // May be reduced
  monteCarloResult: MonteCarloValidation;
  riskScore: number;              // 0-100, lower is better
  reasons: string[];
  warnings: string[];
  constraints: string[];
}

export interface RiskMetrics {
  currentCapitalAtRisk: number;
  currentPositionCount: number;
  dailyPnL: number;
  hourlyPnL: number;
  consecutiveLosses: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  kellyRecommendedSize: number;
  utilizationPercent: number;
}

export interface CapitalAllocation {
  stage: StageNumber;
  totalCapital: number;
  allocatedCapital: number;
  availableCapital: number;
  reserveCapital: number;
  partitions: CapitalPartition[];
}

export interface CapitalPartition {
  name: string;
  purpose: string;
  amount: number;
  locked: boolean;
}

export interface CircuitBreakerState {
  status: 'closed' | 'half-open' | 'open';
  lastTriggered: number | null;
  triggerCount: number;
  cooldownEnds: number | null;
  halfOpenAttempts: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: RiskGovernorConfig = {
  capitalLimits: {
    1: { maxCapitalAtRisk: 1000, maxPositionSize: 100, maxDailyDrawdown: 0.05, maxHourlyDrawdown: 0.02, maxConsecutiveLosses: 3 },
    2: { maxCapitalAtRisk: 5000, maxPositionSize: 500, maxDailyDrawdown: 0.08, maxHourlyDrawdown: 0.03, maxConsecutiveLosses: 4 },
    3: { maxCapitalAtRisk: 20000, maxPositionSize: 2000, maxDailyDrawdown: 0.10, maxHourlyDrawdown: 0.04, maxConsecutiveLosses: 5 },
    4: { maxCapitalAtRisk: 75000, maxPositionSize: 7500, maxDailyDrawdown: 0.12, maxHourlyDrawdown: 0.05, maxConsecutiveLosses: 5 },
    5: { maxCapitalAtRisk: 150000, maxPositionSize: 15000, maxDailyDrawdown: 0.15, maxHourlyDrawdown: 0.06, maxConsecutiveLosses: 6 },
    6: { maxCapitalAtRisk: 300000, maxPositionSize: 30000, maxDailyDrawdown: 0.15, maxHourlyDrawdown: 0.06, maxConsecutiveLosses: 7 },
  },
  
  monteCarloRequirements: {
    minSimulations: 10000,
    minWinRate: 0.55,
    minSharpeRatio: 1.0,
    maxDrawdown: 0.20,
    consensusThreshold: 0.75,
  },
  
  kellyFraction: 0.25,  // Quarter Kelly for safety
  maxKellyMultiple: 2.0,
  
  circuitBreakerConfig: {
    maxDailyLoss: 5000,
    maxHourlyLoss: 1000,
    cooldownPeriod: 300000, // 5 minutes
    halfOpenAttempts: 3,
  },
};

// ============================================================================
// RISK GOVERNOR CLASS
// ============================================================================

export class RiskGovernor extends EventEmitter {
  private static instance: RiskGovernor;
  
  private config: RiskGovernorConfig;
  private metrics: RiskMetrics;
  private capitalAllocation: CapitalAllocation;
  private circuitBreaker: CircuitBreakerState;
  private tradeHistory: Array<{ proposal: TradeProposal; result: 'win' | 'loss' | 'pending'; pnl: number }> = [];
  private validators: MonteCarloValidator[] = [];
  
  private constructor(config: Partial<RiskGovernorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = this.initializeMetrics();
    this.capitalAllocation = this.initializeCapital();
    this.circuitBreaker = this.initializeCircuitBreaker();
    this.initializeValidators();
    
    logger.info('[RiskGovernor] Initialized', {
      stage: stageGovernor.getState().currentStage,
      capitalAtRisk: this.capitalAllocation.allocatedCapital,
    });
  }
  
  static getInstance(config?: Partial<RiskGovernorConfig>): RiskGovernor {
    if (!RiskGovernor.instance) {
      RiskGovernor.instance = new RiskGovernor(config);
    }
    return RiskGovernor.instance;
  }
  
  private initializeMetrics(): RiskMetrics {
    return {
      currentCapitalAtRisk: 0,
      currentPositionCount: 0,
      dailyPnL: 0,
      hourlyPnL: 0,
      consecutiveLosses: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      currentDrawdown: 0,
      kellyRecommendedSize: 0,
      utilizationPercent: 0,
    };
  }
  
  private initializeCapital(): CapitalAllocation {
    const stage = stageGovernor.getState().currentStage;
    const limits = this.config.capitalLimits[stage];
    
    return {
      stage,
      totalCapital: limits.maxCapitalAtRisk,
      allocatedCapital: 0,
      availableCapital: limits.maxCapitalAtRisk,
      reserveCapital: limits.maxCapitalAtRisk * 0.20, // 20% reserve
      partitions: [
        { name: 'Trading', purpose: 'Active trading capital', amount: limits.maxCapitalAtRisk * 0.60, locked: false },
        { name: 'Reserve', purpose: 'Emergency reserve', amount: limits.maxCapitalAtRisk * 0.20, locked: true },
        { name: 'Gas', purpose: 'Gas and fees', amount: limits.maxCapitalAtRisk * 0.10, locked: false },
        { name: 'Buffer', purpose: 'Slippage buffer', amount: limits.maxCapitalAtRisk * 0.10, locked: false },
      ],
    };
  }
  
  private initializeCircuitBreaker(): CircuitBreakerState {
    return {
      status: 'closed',
      lastTriggered: null,
      triggerCount: 0,
      cooldownEnds: null,
      halfOpenAttempts: 0,
    };
  }
  
  private initializeValidators(): void {
    // Create ensemble of Monte Carlo validators with different parameters
    this.validators = [
      new MonteCarloValidator('conservative', { minWinRate: 0.60, minSharpe: 1.2, maxDrawdown: 0.15 }),
      new MonteCarloValidator('balanced', { minWinRate: 0.55, minSharpe: 1.0, maxDrawdown: 0.20 }),
      new MonteCarloValidator('aggressive', { minWinRate: 0.50, minSharpe: 0.8, maxDrawdown: 0.25 }),
    ];
  }
  
  // ============================================================================
  // CORE VALIDATION METHODS
  // ============================================================================
  
  /**
   * Validate a trade proposal through Monte Carlo consensus
   * This is the MAIN gate for any trade execution
   */
  async validateTrade(proposal: TradeProposal): Promise<TradeValidation> {
    const stage = stageGovernor.getState().currentStage;
    const stageConfig = stageGovernor.getConfig();
    
    // Check if execution is allowed
    const canExecute = stageGovernor.canExecute();
    if (!canExecute.allowed) {
      return this.rejectProposal(proposal, `Stage Governor: ${canExecute.reason}`);
    }
    
    // Check circuit breaker
    if (this.circuitBreaker.status === 'open') {
      return this.rejectProposal(proposal, 'Circuit breaker is OPEN');
    }
    
    // Check capital availability
    const limits = this.config.capitalLimits[stage];
    if (proposal.proposedSize > limits.maxPositionSize) {
      return this.rejectProposal(proposal, 
        `Position size $${proposal.proposedSize} exceeds stage limit $${limits.maxPositionSize}`);
    }
    
    if (proposal.proposedSize > this.capitalAllocation.availableCapital) {
      return this.rejectProposal(proposal, 
        `Insufficient capital. Available: $${this.capitalAllocation.availableCapital}`);
    }
    
    // Check consecutive losses
    if (this.metrics.consecutiveLosses >= limits.maxConsecutiveLosses) {
      return this.rejectProposal(proposal, 
        `Consecutive losses (${this.metrics.consecutiveLosses}) at limit`);
    }
    
    // Run Monte Carlo consensus
    const monteCarloResult = await this.runMonteCarloConsensus(proposal);
    
    // Check Monte Carlo approval
    if (monteCarloResult.approval === 'rejected') {
      return this.rejectProposal(proposal, 'Monte Carlo consensus: REJECTED', monteCarloResult);
    }
    
    // Calculate risk-adjusted position size
    const kellySize = this.calculateKellySize(proposal, monteCarloResult);
    const approvedSize = Math.min(
      proposal.proposedSize,
      kellySize,
      limits.maxPositionSize,
      this.capitalAllocation.availableCapital
    );
    
    // Calculate risk score
    const riskScore = this.calculateRiskScore(proposal, monteCarloResult);
    
    // Build validation result
    const validation: TradeValidation = {
      proposal,
      approved: true,
      approvedSize,
      monteCarloResult,
      riskScore,
      reasons: [
        `Monte Carlo consensus: ${monteCarloResult.approval}`,
        `Expected profit: $${proposal.expectedProfit.toFixed(2)}`,
        `Win rate: ${(monteCarloResult.winRate * 100).toFixed(1)}%`,
        `Sharpe ratio: ${monteCarloResult.sharpeRatio.toFixed(2)}`,
      ],
      warnings: this.generateWarnings(proposal, monteCarloResult),
      constraints: monteCarloResult.conditions || [],
    };
    
    // Apply conditions if conditionally approved
    if (monteCarloResult.approval === 'conditional') {
      validation.approvedSize = Math.min(approvedSize, approvedSize * 0.5); // Reduce to 50%
      validation.constraints.push('Conditional approval: reduced position size');
    }
    
    this.emit('trade_validated', validation);
    
    logger.info('[RiskGovernor] Trade validated', {
      proposalId: proposal.id,
      approved: validation.approved,
      approvedSize: validation.approvedSize,
      riskScore: validation.riskScore,
    });
    
    return validation;
  }
  
  private rejectProposal(
    proposal: TradeProposal, 
    reason: string,
    monteCarloResult?: MonteCarloValidation
  ): TradeValidation {
    return {
      proposal,
      approved: false,
      approvedSize: 0,
      monteCarloResult: monteCarloResult || this.getDefaultMonteCarloResult('rejected'),
      riskScore: 100,
      reasons: [reason],
      warnings: [],
      constraints: [],
    };
  }
  
  // ============================================================================
  // MONTE CARLO CONSENSUS
  // ============================================================================
  
  /**
   * Run Monte Carlo consensus across multiple validators
   */
  async runMonteCarloConsensus(proposal: TradeProposal): Promise<MonteCarloValidation> {
    const validatorResults = await Promise.all(
      this.validators.map(v => v.validate(proposal))
    );
    
    // Count approvals
    const approvals = validatorResults.filter(r => r.approval === 'approved').length;
    const conditionals = validatorResults.filter(r => r.approval === 'conditional').length;
    const rejections = validatorResults.filter(r => r.approval === 'rejected').length;
    
    const totalValidators = this.validators.length;
    const approvalRate = (approvals + conditionals * 0.5) / totalValidators;
    
    // Aggregate results
    const avgWinRate = validatorResults.reduce((sum, r) => sum + r.winRate, 0) / totalValidators;
    const avgSharpe = validatorResults.reduce((sum, r) => sum + r.sharpeRatio, 0) / totalValidators;
    const maxDrawdown = Math.max(...validatorResults.map(r => r.maxDrawdown));
    const avgExpectedProfit = validatorResults.reduce((sum, r) => sum + r.expectedProfit, 0) / totalValidators;
    
    // Determine consensus approval
    let approval: MonteCarloValidation['approval'];
    const conditions: string[] = [];
    
    if (approvalRate >= this.config.monteCarloRequirements.consensusThreshold) {
      if (rejections === 0) {
        approval = 'approved';
      } else {
        approval = 'conditional';
        conditions.push(`${rejections}/${totalValidators} validators rejected`);
      }
    } else {
      approval = 'rejected';
    }
    
    // Additional checks against requirements
    if (avgWinRate < this.config.monteCarloRequirements.minWinRate) {
      if (approval === 'approved') approval = 'conditional';
      conditions.push(`Win rate ${(avgWinRate * 100).toFixed(1)}% below minimum`);
    }
    
    if (avgSharpe < this.config.monteCarloRequirements.minSharpeRatio) {
      if (approval === 'approved') approval = 'conditional';
      conditions.push(`Sharpe ratio ${avgSharpe.toFixed(2)} below minimum`);
    }
    
    if (maxDrawdown > this.config.monteCarloRequirements.maxDrawdown) {
      if (approval === 'approved') approval = 'conditional';
      conditions.push(`Max drawdown ${(maxDrawdown * 100).toFixed(1)}% exceeds limit`);
    }
    
    const result: MonteCarloValidation = {
      simulations: this.config.monteCarloRequirements.minSimulations,
      expectedProfit: avgExpectedProfit,
      confidenceInterval: this.calculateConfidenceInterval(validatorResults),
      winRate: avgWinRate,
      maxDrawdown,
      sharpeRatio: avgSharpe,
      approval,
      conditions: conditions.length > 0 ? conditions : undefined,
    };
    
    logger.info('[RiskGovernor] Monte Carlo consensus', {
      proposalId: proposal.id,
      approval,
      approvalRate: (approvalRate * 100).toFixed(1) + '%',
      avgWinRate: (avgWinRate * 100).toFixed(1) + '%',
      avgSharpe: avgSharpe.toFixed(2),
    });
    
    return result;
  }
  
  private calculateConfidenceInterval(
    results: MonteCarloValidation[]
  ): [number, number] {
    const profits = results.map(r => r.expectedProfit);
    const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
    const variance = profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length;
    const stdDev = Math.sqrt(variance);
    const margin = 1.96 * stdDev; // 95% confidence
    
    return [mean - margin, mean + margin];
  }
  
  private getDefaultMonteCarloResult(approval: MonteCarloValidation['approval']): MonteCarloValidation {
    return {
      simulations: 0,
      expectedProfit: 0,
      confidenceInterval: [0, 0],
      winRate: 0,
      maxDrawdown: 1,
      sharpeRatio: 0,
      approval,
    };
  }
  
  // ============================================================================
  // KELLY CRITERION POSITION SIZING
  // ============================================================================
  
  /**
   * Calculate Kelly-optimal position size
   */
  calculateKellySize(proposal: TradeProposal, monteCarlo: MonteCarloValidation): number {
    const winProb = monteCarlo.winRate;
    const lossProb = 1 - winProb;
    
    const winAmount = proposal.expectedProfit;
    const lossAmount = proposal.proposedSize * (proposal.stopLoss / proposal.entryPrice);
    
    if (lossAmount === 0) return proposal.proposedSize;
    
    const odds = winAmount / lossAmount;
    const kellyFraction = (winProb * odds - lossProb) / odds;
    
    // Apply safety fraction
    const safeKelly = kellyFraction * this.config.kellyFraction;
    
    // Calculate position size
    let kellySize = this.capitalAllocation.availableCapital * Math.max(0, safeKelly);
    
    // Cap at max Kelly multiple
    kellySize = Math.min(kellySize, proposal.proposedSize * this.config.maxKellyMultiple);
    
    this.metrics.kellyRecommendedSize = kellySize;
    
    return kellySize;
  }
  
  // ============================================================================
  // RISK SCORING
  // ============================================================================
  
  /**
   * Calculate comprehensive risk score (0-100, lower is better)
   */
  calculateRiskScore(proposal: TradeProposal, monteCarlo: MonteCarloValidation): number {
    let score = 0;
    
    // Win rate component (0-25 points)
    score += Math.max(0, (0.70 - monteCarlo.winRate) * 100);
    
    // Sharpe ratio component (0-25 points)
    score += Math.max(0, (1.5 - monteCarlo.sharpeRatio) * 16.67);
    
    // Drawdown component (0-25 points)
    score += monteCarlo.maxDrawdown * 125;
    
    // Slippage component (0-15 points)
    score += (proposal.expectedSlippage / 0.02) * 15;
    
    // Latency component (0-10 points)
    score += Math.min(10, proposal.latencyMs / 100);
    
    return Math.min(100, Math.max(0, score));
  }
  
  private generateWarnings(proposal: TradeProposal, monteCarlo: MonteCarloValidation): string[] {
    const warnings: string[] = [];
    
    if (monteCarlo.winRate < 0.55) {
      warnings.push('Win rate below 55% threshold');
    }
    
    if (monteCarlo.sharpeRatio < 1.0) {
      warnings.push('Sharpe ratio below 1.0');
    }
    
    if (proposal.expectedSlippage > 0.01) {
      warnings.push(`High slippage expected: ${(proposal.expectedSlippage * 100).toFixed(2)}%`);
    }
    
    if (proposal.latencyMs > 200) {
      warnings.push(`High latency: ${proposal.latencyMs}ms`);
    }
    
    if (this.metrics.consecutiveLosses > 0) {
      warnings.push(`${this.metrics.consecutiveLosses} consecutive losses`);
    }
    
    return warnings;
  }
  
  // ============================================================================
  // CIRCUIT BREAKER
  // ============================================================================
  
  /**
   * Check and update circuit breaker state
   */
  checkCircuitBreaker(): void {
    const dailyLoss = Math.abs(Math.min(0, this.metrics.dailyPnL));
    const hourlyLoss = Math.abs(Math.min(0, this.metrics.hourlyPnL));
    
    // Check if we should trip the breaker
    if (this.circuitBreaker.status === 'closed') {
      if (dailyLoss >= this.config.circuitBreakerConfig.maxDailyLoss) {
        this.tripCircuitBreaker('Daily loss limit exceeded');
      } else if (hourlyLoss >= this.config.circuitBreakerConfig.maxHourlyLoss) {
        this.tripCircuitBreaker('Hourly loss limit exceeded');
      }
    }
    
    // Check if we can transition from half-open to closed
    if (this.circuitBreaker.status === 'half-open') {
      // Will be handled by successful trades
    }
    
    // Check if cooldown has ended for open breaker
    if (this.circuitBreaker.status === 'open' && this.circuitBreaker.cooldownEnds) {
      if (Date.now() >= this.circuitBreaker.cooldownEnds) {
        this.circuitBreaker.status = 'half-open';
        this.circuitBreaker.halfOpenAttempts = 0;
        
        logger.info('[RiskGovernor] Circuit breaker entering half-open state');
      }
    }
  }
  
  private tripCircuitBreaker(reason: string): void {
    this.circuitBreaker.status = 'open';
    this.circuitBreaker.lastTriggered = Date.now();
    this.circuitBreaker.triggerCount++;
    this.circuitBreaker.cooldownEnds = Date.now() + this.config.circuitBreakerConfig.cooldownPeriod;
    
    // Pause the stage governor
    stageGovernor.pause(`Circuit breaker: ${reason}`, 'risk_governor');
    
    this.emit('circuit_breaker_tripped', { reason, triggerCount: this.circuitBreaker.triggerCount });
    
    logger.warn('[RiskGovernor] Circuit breaker TRIPPED', {
      reason,
      triggerCount: this.circuitBreaker.triggerCount,
      cooldownEnds: new Date(this.circuitBreaker.cooldownEnds).toISOString(),
    });
  }
  
  /**
   * Record a trade result
   */
  recordTradeResult(proposalId: string, result: 'win' | 'loss', pnl: number): void {
    const trade = this.tradeHistory.find(t => t.proposal.id === proposalId);
    if (trade) {
      trade.result = result;
      trade.pnl = pnl;
    }
    
    // Update metrics
    this.metrics.dailyPnL += pnl;
    this.metrics.hourlyPnL += pnl;
    
    if (result === 'loss') {
      this.metrics.consecutiveLosses++;
    } else {
      this.metrics.consecutiveLosses = 0;
    }
    
    // Update win rate
    const completedTrades = this.tradeHistory.filter(t => t.result !== 'pending');
    const wins = completedTrades.filter(t => t.result === 'win').length;
    this.metrics.winRate = completedTrades.length > 0 ? wins / completedTrades.length : 0;
    
    // Record profit with stage governor
    if (pnl > 0) {
      stageGovernor.recordProfit(pnl);
    }
    
    // Check circuit breaker
    this.checkCircuitBreaker();
    
    // Handle half-open state
    if (this.circuitBreaker.status === 'half-open') {
      if (result === 'win') {
        this.circuitBreaker.halfOpenAttempts++;
        if (this.circuitBreaker.halfOpenAttempts >= this.config.circuitBreakerConfig.halfOpenAttempts) {
          this.circuitBreaker.status = 'closed';
          logger.info('[RiskGovernor] Circuit breaker CLOSED after successful trades');
        }
      } else {
        this.tripCircuitBreaker('Failed trade in half-open state');
      }
    }
    
    this.emit('trade_result', { proposalId, result, pnl });
    
    logger.info('[RiskGovernor] Trade result recorded', {
      proposalId,
      result,
      pnl,
      dailyPnL: this.metrics.dailyPnL,
      consecutiveLosses: this.metrics.consecutiveLosses,
    });
  }
  
  // ============================================================================
  // CAPITAL MANAGEMENT
  // ============================================================================
  
  /**
   * Allocate capital for a trade
   */
  allocateCapital(amount: number): boolean {
    if (amount > this.capitalAllocation.availableCapital) {
      return false;
    }
    
    this.capitalAllocation.allocatedCapital += amount;
    this.capitalAllocation.availableCapital -= amount;
    this.metrics.currentCapitalAtRisk += amount;
    this.metrics.currentPositionCount++;
    this.updateUtilization();
    
    return true;
  }
  
  /**
   * Release capital after trade closes
   */
  releaseCapital(amount: number): void {
    this.capitalAllocation.allocatedCapital -= amount;
    this.capitalAllocation.availableCapital += amount;
    this.metrics.currentCapitalAtRisk -= amount;
    this.metrics.currentPositionCount = Math.max(0, this.metrics.currentPositionCount - 1);
    this.updateUtilization();
  }
  
  private updateUtilization(): void {
    this.metrics.utilizationPercent = 
      (this.capitalAllocation.allocatedCapital / this.capitalAllocation.totalCapital) * 100;
  }
  
  /**
   * Update capital allocation for new stage
   */
  updateStageCapital(): void {
    this.capitalAllocation = this.initializeCapital();
    
    logger.info('[RiskGovernor] Capital allocation updated for stage', {
      stage: this.capitalAllocation.stage,
      totalCapital: this.capitalAllocation.totalCapital,
    });
  }
  
  // ============================================================================
  // RESET & STATUS
  // ============================================================================
  
  /**
   * Reset hourly metrics (call every hour)
   */
  resetHourlyMetrics(): void {
    this.metrics.hourlyPnL = 0;
    
    logger.info('[RiskGovernor] Hourly metrics reset');
  }
  
  /**
   * Reset daily metrics (call at day boundary)
   */
  resetDailyMetrics(): void {
    this.metrics.dailyPnL = 0;
    this.metrics.currentDrawdown = 0;
    this.tradeHistory = [];
    
    logger.info('[RiskGovernor] Daily metrics reset');
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): Readonly<RiskMetrics> {
    return { ...this.metrics };
  }
  
  /**
   * Get capital allocation
   */
  getCapitalAllocation(): Readonly<CapitalAllocation> {
    return { 
      ...this.capitalAllocation,
      partitions: this.capitalAllocation.partitions.map(p => ({ ...p })),
    };
  }
  
  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): Readonly<CircuitBreakerState> {
    return { ...this.circuitBreaker };
  }
  
  /**
   * Get comprehensive risk status
   */
  getStatus(): {
    metrics: RiskMetrics;
    capital: CapitalAllocation;
    circuitBreaker: CircuitBreakerState;
    validatorCount: number;
    canTrade: boolean;
    tradingRestrictions: string[];
  } {
    const restrictions: string[] = [];
    
    if (this.circuitBreaker.status !== 'closed') {
      restrictions.push(`Circuit breaker: ${this.circuitBreaker.status}`);
    }
    
    if (this.metrics.consecutiveLosses >= 3) {
      restrictions.push(`Consecutive losses: ${this.metrics.consecutiveLosses}`);
    }
    
    if (this.metrics.utilizationPercent > 80) {
      restrictions.push(`High capital utilization: ${this.metrics.utilizationPercent.toFixed(1)}%`);
    }
    
    return {
      metrics: this.getMetrics(),
      capital: this.getCapitalAllocation(),
      circuitBreaker: this.getCircuitBreakerState(),
      validatorCount: this.validators.length,
      canTrade: restrictions.length === 0 && this.circuitBreaker.status !== 'open',
      tradingRestrictions: restrictions,
    };
  }
}

// ============================================================================
// MONTE CARLO VALIDATOR CLASS
// ============================================================================

class MonteCarloValidator {
  private name: string;
  private params: { minWinRate: number; minSharpe: number; maxDrawdown: number };
  
  constructor(
    name: string, 
    params: { minWinRate: number; minSharpe: number; maxDrawdown: number }
  ) {
    this.name = name;
    this.params = params;
  }
  
  async validate(proposal: TradeProposal): Promise<MonteCarloValidation> {
    // Simulate Monte Carlo validation
    // In production, this would run actual simulations
    
    const simulations = 10000;
    
    // Calculate win probability based on expected profit vs risk
    const riskRewardRatio = proposal.expectedProfit / (proposal.proposedSize * 0.05); // 5% stop loss
    const baseWinRate = 0.5 + Math.min(0.3, riskRewardRatio * 0.1);
    
    // Add some variance based on validator type
    const variance = this.name === 'conservative' ? -0.05 : 
                     this.name === 'aggressive' ? 0.05 : 0;
    const winRate = Math.min(0.95, Math.max(0.3, baseWinRate + variance + (Math.random() - 0.5) * 0.1));
    
    // Calculate Sharpe ratio
    const expectedReturn = winRate * proposal.expectedProfit - (1 - winRate) * proposal.proposedSize * 0.05;
    const volatility = proposal.proposedSize * 0.1 * (1 + proposal.expectedSlippage);
    const sharpeRatio = volatility > 0 ? expectedReturn / volatility : 0;
    
    // Calculate max drawdown
    const maxDrawdown = (1 - winRate) * 0.3 + Math.random() * 0.1;
    
    // Determine approval
    let approval: MonteCarloValidation['approval'];
    if (winRate >= this.params.minWinRate && sharpeRatio >= this.params.minSharpe && maxDrawdown <= this.params.maxDrawdown) {
      approval = 'approved';
    } else if (winRate >= this.params.minWinRate * 0.9 && sharpeRatio >= this.params.minSharpe * 0.8) {
      approval = 'conditional';
    } else {
      approval = 'rejected';
    }
    
    return {
      simulations,
      expectedProfit: proposal.expectedProfit * winRate - proposal.proposedSize * 0.05 * (1 - winRate),
      confidenceInterval: [proposal.expectedProfit * 0.8, proposal.expectedProfit * 1.2],
      winRate,
      maxDrawdown,
      sharpeRatio,
      approval,
    };
  }
}

// Export singleton instance
export const riskGovernor = RiskGovernor.getInstance();
