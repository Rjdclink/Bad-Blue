/**
 * RISK GOVERNOR
 * 
 * Manages all risk controls and Monte Carlo consensus requirements
 * Gates every execution with multi-layer safety checks
 * 
 * Features:
 * - Monte Carlo consensus validation (3+ simulations)
 * - Real-time risk assessment
 * - Drawdown monitoring and circuit breakers
 * - Position sizing with Kelly Criterion
 * - Anomaly detection integration
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { stageManager, StageConfig } from './stage-management';
import { MonteCarloEngine, StrategyProfile, MarketCondition, MARKET_CONDITIONS } from '../validation/monte-carlo-engine';

const log = createLogger('RiskGovernor');

// ============================================================================
// TYPES
// ============================================================================

export interface TradeProposal {
  id: string;
  strategy: string;
  chain: string;
  pair: string;
  venue: string;
  positionSizeUSD: number;
  estimatedProfitUSD: number;
  estimatedRiskPercent: number;
  timestamp: number;
}

export interface RiskAssessment {
  proposalId: string;
  approved: boolean;
  reason: string;
  
  // Risk metrics
  riskScore: number; // 0-100 (higher = riskier)
  confidenceScore: number; // 0-1
  
  // Monte Carlo validation
  monteCarloApproved: boolean;
  monteCarloSimulations: number;
  monteCarloConsensus: number; // 0-1 (fraction agreeing)
  
  // Position sizing
  recommendedPositionUSD: number;
  kellyFraction: number;
  
  // Checks passed
  checksPass: {
    stageCheck: boolean;
    pauseCheck: boolean;
    drawdownCheck: boolean;
    dailyLimitCheck: boolean;
    positionSizeCheck: boolean;
    monteCarloCheck: boolean;
    anomalyCheck: boolean;
  };
  
  timestamp: number;
}

export interface CircuitBreaker {
  id: string;
  name: string;
  enabled: boolean;
  threshold: number;
  currentValue: number;
  isTripped: boolean;
  tripTime?: number;
  resetTime?: number;
}

// ============================================================================
// RISK GOVERNOR
// ============================================================================

export class RiskGovernor extends EventEmitter {
  private static instance: RiskGovernor | null = null;
  private monteCarloEngine: MonteCarloEngine;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private assessmentHistory: RiskAssessment[] = [];
  
  private constructor() {
    super();
    
    this.monteCarloEngine = new MonteCarloEngine({
      simulations: 10000,
      timeHorizonDays: 1,
      enableRegimeDetection: true,
      enableKellySizing: true,
      enableFatTails: true,
      enableEnsemble: true,
      ensembleCount: 3,
      learningEnabled: true,
    });
    
    this.initializeCircuitBreakers();
    
    log.info('Risk Governor initialized');
  }
  
  static getInstance(): RiskGovernor {
    if (!RiskGovernor.instance) {
      RiskGovernor.instance = new RiskGovernor();
    }
    return RiskGovernor.instance;
  }
  
  // ============================================================================
  // TRADE APPROVAL GATING
  // ============================================================================
  
  /**
   * Gate every trade execution with comprehensive risk assessment
   * Returns approval decision with detailed reasoning
   */
  async assessTradeProposal(proposal: TradeProposal): Promise<RiskAssessment> {
    log.debug('Assessing trade proposal', { proposalId: proposal.id });
    
    const assessment: RiskAssessment = {
      proposalId: proposal.id,
      approved: false,
      reason: '',
      riskScore: 0,
      confidenceScore: 0,
      monteCarloApproved: false,
      monteCarloSimulations: 0,
      monteCarloConsensus: 0,
      recommendedPositionUSD: 0,
      kellyFraction: 0,
      checksPass: {
        stageCheck: false,
        pauseCheck: false,
        drawdownCheck: false,
        dailyLimitCheck: false,
        positionSizeCheck: false,
        monteCarloCheck: false,
        anomalyCheck: false,
      },
      timestamp: Date.now(),
    };
    
    // ========================================
    // CHECK 1: Stage Configuration
    // ========================================
    const stageConfig = stageManager.getStageConfig();
    
    if (!stageConfig.canExecuteTrades) {
      assessment.reason = `Stage ${stageConfig.stageName} does not allow trade execution`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.stageCheck = true;
    
    // ========================================
    // CHECK 2: System Pause State
    // ========================================
    const canProceed = stageManager.canProceed();
    if (!canProceed.allowed) {
      assessment.reason = canProceed.reason || 'System paused';
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.pauseCheck = true;
    
    // ========================================
    // CHECK 3: Circuit Breakers
    // ========================================
    const trippedBreakers = this.getTrippedCircuitBreakers();
    if (trippedBreakers.length > 0) {
      assessment.reason = `Circuit breaker tripped: ${trippedBreakers.map(b => b.name).join(', ')}`;
      this.recordAssessment(assessment);
      return assessment;
    }
    
    // ========================================
    // CHECK 4: Drawdown Limit
    // ========================================
    const state = stageManager.getState();
    if (state.currentDrawdownPercent > stageConfig.maxDrawdownPercent) {
      assessment.reason = `Drawdown limit exceeded: ${state.currentDrawdownPercent.toFixed(2)}% > ${stageConfig.maxDrawdownPercent}%`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.drawdownCheck = true;
    
    // ========================================
    // CHECK 5: Daily Profit Limit
    // ========================================
    const currentDailyProfit = stageManager.getCurrentDailyProfit();
    const maxDailyProfit = stageManager.getMaxDailyProfit();
    
    if (currentDailyProfit >= maxDailyProfit) {
      assessment.reason = `Daily profit limit reached: $${currentDailyProfit.toFixed(2)} >= $${maxDailyProfit}`;
      this.recordAssessment(assessment);
      return assessment;
    }
    
    // Check if this trade would exceed limit
    if (currentDailyProfit + proposal.estimatedProfitUSD > maxDailyProfit) {
      assessment.reason = `Trade would exceed daily profit limit`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.dailyLimitCheck = true;
    
    // ========================================
    // CHECK 6: Position Size Limit
    // ========================================
    if (proposal.positionSizeUSD > stageConfig.maxPositionSizeUSD) {
      assessment.reason = `Position size exceeds limit: $${proposal.positionSizeUSD} > $${stageConfig.maxPositionSizeUSD}`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.positionSizeCheck = true;
    
    // ========================================
    // CHECK 7: Monte Carlo Consensus
    // ========================================
    if (stageConfig.requiresMonteCarloConsensus) {
      const monteCarloResult = await this.runMonteCarloConsensus(proposal);
      
      assessment.monteCarloApproved = monteCarloResult.approved;
      assessment.monteCarloSimulations = monteCarloResult.simulations;
      assessment.monteCarloConsensus = monteCarloResult.consensus;
      assessment.recommendedPositionUSD = monteCarloResult.recommendedPositionUSD;
      assessment.kellyFraction = monteCarloResult.kellyFraction;
      assessment.confidenceScore = monteCarloResult.confidenceScore;
      
      if (!monteCarloResult.approved) {
        assessment.reason = `Monte Carlo consensus failed: ${monteCarloResult.reason}`;
        this.recordAssessment(assessment);
        return assessment;
      }
      assessment.checksPass.monteCarloCheck = true;
    } else {
      assessment.checksPass.monteCarloCheck = true;
      assessment.confidenceScore = 0.8; // Default confidence
    }
    
    // ========================================
    // CHECK 8: Anomaly Detection
    // ========================================
    if (stageConfig.anomalyDetectionRequired) {
      const anomalyResult = this.detectAnomalies(proposal);
      
      if (!anomalyResult.passed) {
        assessment.reason = `Anomaly detected: ${anomalyResult.reason}`;
        stageManager.reportAnomaly(anomalyResult.reason, anomalyResult.severity);
        this.recordAssessment(assessment);
        return assessment;
      }
      assessment.checksPass.anomalyCheck = true;
    } else {
      assessment.checksPass.anomalyCheck = true;
    }
    
    // ========================================
    // Calculate Risk Score
    // ========================================
    assessment.riskScore = this.calculateRiskScore(proposal, assessment);
    
    // ========================================
    // FINAL APPROVAL
    // ========================================
    const allChecksPass = Object.values(assessment.checksPass).every(check => check);
    
    if (allChecksPass && assessment.riskScore < 70) {
      assessment.approved = true;
      assessment.reason = 'Trade approved - all risk checks passed';
      
      log.info('Trade APPROVED', {
        proposalId: proposal.id,
        strategy: proposal.strategy,
        positionUSD: proposal.positionSizeUSD,
        riskScore: assessment.riskScore,
        confidence: assessment.confidenceScore,
      });
    } else if (allChecksPass) {
      assessment.reason = `Risk score too high: ${assessment.riskScore.toFixed(2)}`;
    }
    
    this.recordAssessment(assessment);
    
    this.emit('assessment-completed', assessment);
    
    return assessment;
  }
  
  // ============================================================================
  // MONTE CARLO CONSENSUS
  // ============================================================================
  
  /**
   * Run Monte Carlo consensus validation
   * Requires agreement from multiple simulations
   */
  private async runMonteCarloConsensus(proposal: TradeProposal): Promise<{
    approved: boolean;
    reason: string;
    simulations: number;
    consensus: number;
    recommendedPositionUSD: number;
    kellyFraction: number;
    confidenceScore: number;
  }> {
    // Create strategy profile from proposal
    const strategy: StrategyProfile = {
      name: proposal.strategy,
      baseSuccessRate: 0.7, // Default, should come from historical data
      avgProfitPerTrade: proposal.estimatedProfitUSD / proposal.positionSizeUSD,
      avgLossPerTrade: proposal.estimatedRiskPercent,
      tradesPerDay: 100, // Estimated
      gasPerTrade: 0.002,
      slippageTolerance: 0.003,
      executionLatency: 20,
      strategyType: 'arbitrage',
      mlFilterEnabled: true,
      multiChainEnabled: true,
      mempoolMonitoring: true,
    };
    
    // Determine market conditions
    const marketCondition = MARKET_CONDITIONS.normal; // Should be dynamic
    
    // Run simulation
    const result = await this.monteCarloEngine.runSimulation(strategy, marketCondition);
    
    // Calculate consensus (using ensemble confidence)
    const consensus = result.ensembleConfidence;
    
    // Check approval criteria
    const approved = 
      result.expectedProfit > 0 &&
      result.sharpeRatio > 1.0 &&
      result.winRate > 0.6 &&
      result.performanceBreakdown.tradingApproval === 'approved' &&
      consensus >= 0.7;
    
    // Calculate recommended position size using Kelly
    const kellyFraction = result.kellyCriterion.halfKellyFraction; // Use half-Kelly for safety
    const recommendedPositionUSD = proposal.positionSizeUSD * kellyFraction;
    
    const reason = approved 
      ? 'Monte Carlo consensus achieved'
      : `Monte Carlo rejection: Sharpe=${result.sharpeRatio.toFixed(2)}, WinRate=${(result.winRate * 100).toFixed(1)}%, Approval=${result.performanceBreakdown.tradingApproval}`;
    
    return {
      approved,
      reason,
      simulations: 10000,
      consensus,
      recommendedPositionUSD,
      kellyFraction,
      confidenceScore: result.ensembleConfidence,
    };
  }
  
  // ============================================================================
  // ANOMALY DETECTION
  // ============================================================================
  
  /**
   * Detect anomalies in trade proposal
   */
  private detectAnomalies(proposal: TradeProposal): {
    passed: boolean;
    reason: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  } {
    // Check for suspicious position sizes
    const stageConfig = stageManager.getStageConfig();
    const positionRatio = proposal.positionSizeUSD / stageConfig.maxPositionSizeUSD;
    
    if (positionRatio > 0.95) {
      return {
        passed: false,
        reason: 'Position size near maximum limit - suspicious',
        severity: 'medium',
      };
    }
    
    // Check for unrealistic profit estimates
    const profitRatio = proposal.estimatedProfitUSD / proposal.positionSizeUSD;
    if (profitRatio > 0.5) {
      return {
        passed: false,
        reason: `Unrealistic profit estimate: ${(profitRatio * 100).toFixed(1)}% ROI`,
        severity: 'high',
      };
    }
    
    // Check for rapid-fire proposals (potential bot malfunction)
    const recentAssessments = this.assessmentHistory.slice(-10);
    if (recentAssessments.length >= 10) {
      const timeSinceFirst = Date.now() - recentAssessments[0].timestamp;
      if (timeSinceFirst < 1000) {
        return {
          passed: false,
          reason: 'Too many proposals in short time - potential malfunction',
          severity: 'critical',
        };
      }
    }
    
    return {
      passed: true,
      reason: 'No anomalies detected',
      severity: 'low',
    };
  }
  
  // ============================================================================
  // RISK SCORING
  // ============================================================================
  
  /**
   * Calculate comprehensive risk score (0-100, higher = riskier)
   */
  private calculateRiskScore(proposal: TradeProposal, assessment: RiskAssessment): number {
    let score = 0;
    
    // Position size component (0-25 points)
    const stageConfig = stageManager.getStageConfig();
    const positionRatio = proposal.positionSizeUSD / stageConfig.maxPositionSizeUSD;
    score += positionRatio * 25;
    
    // Risk percentage component (0-25 points)
    score += proposal.estimatedRiskPercent * 25;
    
    // Confidence component (0-25 points)
    score += (1 - assessment.confidenceScore) * 25;
    
    // Monte Carlo component (0-25 points)
    if (assessment.monteCarloConsensus > 0) {
      score += (1 - assessment.monteCarloConsensus) * 25;
    } else {
      score += 25; // Maximum risk if no Monte Carlo
    }
    
    return Math.min(100, Math.max(0, score));
  }
  
  // ============================================================================
  // CIRCUIT BREAKERS
  // ============================================================================
  
  /**
   * Initialize circuit breakers
   */
  private initializeCircuitBreakers(): void {
    this.circuitBreakers.set('max-drawdown', {
      id: 'max-drawdown',
      name: 'Maximum Drawdown',
      enabled: true,
      threshold: 20, // 20%
      currentValue: 0,
      isTripped: false,
    });
    
    this.circuitBreakers.set('consecutive-losses', {
      id: 'consecutive-losses',
      name: 'Consecutive Losses',
      enabled: true,
      threshold: 5,
      currentValue: 0,
      isTripped: false,
    });
    
    this.circuitBreakers.set('daily-loss', {
      id: 'daily-loss',
      name: 'Daily Loss Limit',
      enabled: true,
      threshold: -1000, // -$1000
      currentValue: 0,
      isTripped: false,
    });
    
    this.circuitBreakers.set('rapid-loss-rate', {
      id: 'rapid-loss-rate',
      name: 'Rapid Loss Rate',
      enabled: true,
      threshold: 5, // 5 losses in 1 minute
      currentValue: 0,
      isTripped: false,
    });
    
    log.info('Circuit breakers initialized', {
      count: this.circuitBreakers.size,
    });
  }
  
  /**
   * Update circuit breaker value
   */
  updateCircuitBreaker(id: string, value: number): void {
    const breaker = this.circuitBreakers.get(id);
    if (!breaker || !breaker.enabled) return;
    
    breaker.currentValue = value;
    
    // Check if threshold exceeded
    if (id === 'daily-loss') {
      // For daily loss, trip if value is LESS than threshold (more negative)
      if (value < breaker.threshold) {
        this.tripCircuitBreaker(id);
      }
    } else {
      // For other breakers, trip if value EXCEEDS threshold
      if (value >= breaker.threshold) {
        this.tripCircuitBreaker(id);
      }
    }
  }
  
  /**
   * Trip circuit breaker
   */
  private tripCircuitBreaker(id: string): void {
    const breaker = this.circuitBreakers.get(id);
    if (!breaker || breaker.isTripped) return;
    
    breaker.isTripped = true;
    breaker.tripTime = Date.now();
    
    log.error('CIRCUIT BREAKER TRIPPED', {
      id: breaker.id,
      name: breaker.name,
      threshold: breaker.threshold,
      currentValue: breaker.currentValue,
    });
    
    this.emit('circuit-breaker-tripped', {
      id: breaker.id,
      name: breaker.name,
      threshold: breaker.threshold,
      currentValue: breaker.currentValue,
      timestamp: Date.now(),
    });
    
    // Pause system on critical circuit breaker
    stageManager.pause(`Circuit breaker tripped: ${breaker.name}`);
  }
  
  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(id: string): void {
    const breaker = this.circuitBreakers.get(id);
    if (!breaker) return;
    
    breaker.isTripped = false;
    breaker.currentValue = 0;
    breaker.resetTime = Date.now();
    
    log.info('Circuit breaker reset', { id, name: breaker.name });
    
    this.emit('circuit-breaker-reset', {
      id,
      name: breaker.name,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Get all tripped circuit breakers
   */
  getTrippedCircuitBreakers(): CircuitBreaker[] {
    return Array.from(this.circuitBreakers.values()).filter(b => b.isTripped);
  }
  
  /**
   * Get all circuit breakers
   */
  getAllCircuitBreakers(): CircuitBreaker[] {
    return Array.from(this.circuitBreakers.values());
  }
  
  // ============================================================================
  // UTILITIES
  // ============================================================================
  
  private recordAssessment(assessment: RiskAssessment): void {
    this.assessmentHistory.push(assessment);
    
    // Keep last 1000 assessments
    if (this.assessmentHistory.length > 1000) {
      this.assessmentHistory.shift();
    }
  }
  
  getAssessmentHistory(): RiskAssessment[] {
    return [...this.assessmentHistory];
  }
  
  getApprovalRate(): number {
    if (this.assessmentHistory.length === 0) return 0;
    
    const approvedCount = this.assessmentHistory.filter(a => a.approved).length;
    return approvedCount / this.assessmentHistory.length;
  }
  
  /**
   * Export state for monitoring
   */
  exportState(): any {
    return {
      circuitBreakers: Array.from(this.circuitBreakers.values()),
      assessmentHistory: this.assessmentHistory.slice(-100),
      approvalRate: this.getApprovalRate(),
      timestamp: Date.now(),
    };
  }
}

// Singleton instance
export const riskGovernor = RiskGovernor.getInstance();
