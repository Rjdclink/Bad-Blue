/**
 * RISK GOVERNOR
 *
 * Manages execution risk controls and Monte Carlo consensus requirements.
 * Profit magnitude is never an execution ceiling: deterministic all-in positive
 * economics is an upstream eligibility requirement, while this governor owns
 * loss/drawdown, profit-ladder position-size, current Monte Carlo, anomaly, and
 * circuit-breaker safety only.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { getCryptara } from '../../cryptara/index.js';
import { getProfitLadderNotionalAuthority } from './profit-ladder-notional-authority.js';
import { stageManager } from './stage-management';

const log = createLogger('RiskGovernor');

export interface TradeProposal {
  id: string;
  opportunityId?: string;
  strategy: string;
  chain: string;
  pair: string;
  venue: string;
  positionSizeUSD: number;
  estimatedProfitUSD: number;
  estimatedRiskPercent: number;
  measuredFeeUSD?: number;
  measuredGasUSD?: number;
  measuredSlippageUSD?: number;
  timestamp: number;
}

export interface RiskAssessment {
  proposalId: string;
  approved: boolean;
  reason: string;
  riskScore: number;
  confidenceScore: number;
  monteCarloApproved: boolean;
  monteCarloSimulations: number;
  monteCarloConsensus: number;
  recommendedPositionUSD: number;
  kellyFraction: number;
  checksPass: {
    stageCheck: boolean;
    pauseCheck: boolean;
    drawdownCheck: boolean;
    /** Compatibility field. Profit ceilings are retired, so this is always true. */
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

type RuntimeConfidenceEvidence = {
  confidenceEnabled?: boolean;
  confidenceState?: 'bootstrap' | 'calibrated';
  runtimeSuccessfulTrades?: number;
  runtimeRequiredSuccessfulTrades?: number;
};

export class RiskGovernor extends EventEmitter {
  private static instance: RiskGovernor | null = null;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private assessmentHistory: RiskAssessment[] = [];

  private constructor() {
    super();
    this.initializeCircuitBreakers();
    log.info('Risk Governor initialized');
  }

  static getInstance(): RiskGovernor {
    if (!RiskGovernor.instance) RiskGovernor.instance = new RiskGovernor();
    return RiskGovernor.instance;
  }

  /**
   * Gate every trade execution with canonical risk assessment.
   * No daily/hourly/aggregate profit target or ceiling participates in approval.
   */
  async assessTradeProposal(proposal: TradeProposal): Promise<RiskAssessment> {
    log.debug('Assessing trade proposal', { proposalId: proposal.id });
    let confidenceEnabledForRisk = true;

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
        dailyLimitCheck: true,
        positionSizeCheck: false,
        monteCarloCheck: false,
        anomalyCheck: false,
      },
      timestamp: Date.now(),
    };

    // CHECK 1: Stage execution authority.
    const stageConfig = stageManager.getStageConfig();
    if (!stageConfig.canExecuteTrades) {
      assessment.reason = `Stage ${stageConfig.stageName} does not allow trade execution`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.stageCheck = true;

    // CHECK 2: Pause/kill-switch control state.
    const canProceed = stageManager.canProceed();
    if (!canProceed.allowed) {
      assessment.reason = canProceed.reason || 'System paused';
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.pauseCheck = true;

    // CHECK 3: Loss/drawdown/malfunction circuit breakers.
    const trippedBreakers = this.getTrippedCircuitBreakers();
    if (trippedBreakers.length > 0) {
      assessment.reason = `Circuit breaker tripped: ${trippedBreakers.map(b => b.name).join(', ')}`;
      this.recordAssessment(assessment);
      return assessment;
    }

    // CHECK 4: Drawdown limit remains a StageManager safety responsibility.
    const state = stageManager.getState();
    if (state.currentDrawdownPercent > stageConfig.maxDrawdownPercent) {
      assessment.reason = `Drawdown limit exceeded: ${state.currentDrawdownPercent.toFixed(2)}% > ${stageConfig.maxDrawdownPercent}%`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.drawdownCheck = true;

    // CHECK 5: Profit ceiling intentionally retired.
    assessment.checksPass.dailyLimitCheck = true;

    // CHECK 6: Profit Ladder is the single new-exposure notional ceiling.
    // The legacy StageManager maxPositionSizeUSD remains compatibility telemetry;
    // it cannot impose a second smaller position cap beneath the active ladder rung.
    const notionalAuthority = getProfitLadderNotionalAuthority();
    if (!(notionalAuthority.maxNotionalUsd > 0)) {
      assessment.reason = 'Profit ladder does not currently authorize positive execution notional';
      this.recordAssessment(assessment);
      return assessment;
    }
    if (proposal.positionSizeUSD > notionalAuthority.maxNotionalUsd) {
      assessment.reason = `Position size exceeds profit-ladder limit: $${proposal.positionSizeUSD} > $${notionalAuthority.maxNotionalUsd}`;
      this.recordAssessment(assessment);
      return assessment;
    }
    assessment.checksPass.positionSizeCheck = true;

    // CHECK 7: Current opportunity-bound Monte Carlo evidence.
    if (stageConfig.requiresMonteCarloConsensus) {
      const monteCarloResult = await this.runMonteCarloConsensus(proposal);
      assessment.monteCarloApproved = monteCarloResult.approved;
      assessment.monteCarloSimulations = monteCarloResult.simulations;
      assessment.monteCarloConsensus = monteCarloResult.consensus;
      assessment.recommendedPositionUSD = monteCarloResult.recommendedPositionUSD;
      assessment.kellyFraction = monteCarloResult.kellyFraction;
      assessment.confidenceScore = monteCarloResult.confidenceScore;
      confidenceEnabledForRisk = monteCarloResult.confidenceEnabled;

      if (!monteCarloResult.approved) {
        assessment.reason = `Monte Carlo consensus failed: ${monteCarloResult.reason}`;
        this.recordAssessment(assessment);
        return assessment;
      }
      assessment.checksPass.monteCarloCheck = true;
    } else {
      assessment.checksPass.monteCarloCheck = true;
      assessment.confidenceScore = 0;
    }

    // CHECK 8: Malfunction/anomaly detection. It may not create a second profit
    // or position ceiling; those responsibilities are already owned above.
    if (stageConfig.anomalyDetectionRequired) {
      const anomalyResult = this.detectAnomalies();
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

    assessment.riskScore = this.calculateRiskScore(proposal, assessment, confidenceEnabledForRisk);
    const allChecksPass = Object.values(assessment.checksPass).every(check => check);

    if (allChecksPass && assessment.riskScore < 70) {
      assessment.approved = true;
      assessment.reason = 'Trade approved - all risk checks passed';
      log.info('Trade APPROVED', {
        proposalId: proposal.id,
        strategy: proposal.strategy,
        positionUSD: proposal.positionSizeUSD,
        profitLadderMaxNotionalUsd: notionalAuthority.maxNotionalUsd,
        riskScore: assessment.riskScore,
        confidence: assessment.confidenceScore,
        confidenceEnabled: confidenceEnabledForRisk,
      });
    } else if (allChecksPass) {
      assessment.reason = `Risk score too high: ${assessment.riskScore.toFixed(2)}`;
    }

    this.recordAssessment(assessment);
    this.emit('assessment-completed', assessment);
    return assessment;
  }

  private async runMonteCarloConsensus(proposal: TradeProposal): Promise<{
    approved: boolean;
    reason: string;
    simulations: number;
    consensus: number;
    recommendedPositionUSD: number;
    kellyFraction: number;
    confidenceScore: number;
    confidenceEnabled: boolean;
  }> {
    const evidence = getCryptara().getLatestMonteCarloEvidence();
    const runtimeEvidence = evidence as (NonNullable<typeof evidence> & RuntimeConfidenceEvidence) | null;
    const sourceOpportunityId = proposal.opportunityId || proposal.id;
    const maxAgeMs = Math.max(60_000, Number(process.env.CRYPTARA_MONTE_CARLO_TTL_MS || 900_000));
    const evidenceIsCurrent = evidence !== null &&
      evidence.sourceOpportunityId === sourceOpportunityId &&
      evidence.evaluatedAt <= Date.now() &&
      Date.now() - evidence.evaluatedAt <= maxAgeMs;
    const consensus = evidenceIsCurrent ? evidence!.probabilityOfProfit : 0;
    const confidenceScore = evidenceIsCurrent ? evidence!.confidence : 0;
    const confidenceEnabled = evidenceIsCurrent ? runtimeEvidence?.confidenceEnabled !== false : true;
    const confidencePass = !confidenceEnabled || confidenceScore >= 0.7;
    const approved = evidenceIsCurrent &&
      evidence!.expectedProfit > 0 &&
      consensus >= 0.7 &&
      confidencePass;
    const successfulTrades = runtimeEvidence?.runtimeSuccessfulTrades ?? 0;
    const requiredSuccessfulTrades = runtimeEvidence?.runtimeRequiredSuccessfulTrades ?? 0;
    const reason = !evidenceIsCurrent
      ? 'Current Cryptara Monte Carlo evidence is unavailable for this opportunity'
      : !confidenceEnabled
        ? approved
          ? `Cryptara Monte Carlo bootstrap validated; learned confidence is disabled until ${requiredSuccessfulTrades} successful settled trades after restart (${successfulTrades}/${requiredSuccessfulTrades})`
          : `Cryptara Monte Carlo profitability/consensus is below threshold during confidence bootstrap (${successfulTrades}/${requiredSuccessfulTrades})`
        : approved
          ? 'Cryptara Monte Carlo evidence validated'
          : 'Cryptara Monte Carlo evidence is below threshold';

    return {
      approved,
      reason,
      simulations: evidenceIsCurrent ? 1 : 0,
      consensus,
      recommendedPositionUSD: approved ? proposal.positionSizeUSD : 0,
      kellyFraction: 0,
      confidenceScore,
      confidenceEnabled,
    };
  }

  /**
   * Anomaly detection is restricted to operational malfunction evidence. It does
   * not second-guess already-authorized position size or reject high profit merely
   * for being high.
   */
  private detectAnomalies(): {
    passed: boolean;
    reason: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  } {
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
      reason: 'No operational anomalies detected',
      severity: 'low',
    };
  }

  private calculateRiskScore(
    proposal: TradeProposal,
    assessment: RiskAssessment,
    confidenceEnabled: boolean = true,
  ): number {
    let score = 0;
    const ladderMaxNotionalUsd = getProfitLadderNotionalAuthority().maxNotionalUsd;
    const positionRatio = ladderMaxNotionalUsd > 0
      ? proposal.positionSizeUSD / ladderMaxNotionalUsd
      : 1;
    score += Math.max(0, Math.min(1, positionRatio)) * 25;
    score += Math.max(0, Math.min(1, proposal.estimatedRiskPercent)) * 25;

    if (confidenceEnabled) score += (1 - assessment.confidenceScore) * 25;
    if (assessment.monteCarloConsensus > 0) score += (1 - assessment.monteCarloConsensus) * 25;
    else score += 25;

    return Math.min(100, Math.max(0, score));
  }

  private initializeCircuitBreakers(): void {
    this.circuitBreakers.set('max-drawdown', {
      id: 'max-drawdown',
      name: 'Maximum Drawdown',
      enabled: true,
      threshold: 20,
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
      threshold: -1000,
      currentValue: 0,
      isTripped: false,
    });
    this.circuitBreakers.set('rapid-loss-rate', {
      id: 'rapid-loss-rate',
      name: 'Rapid Loss Rate',
      enabled: true,
      threshold: 5,
      currentValue: 0,
      isTripped: false,
    });
    log.info('Circuit breakers initialized', { count: this.circuitBreakers.size });
  }

  updateCircuitBreaker(id: string, value: number): void {
    const breaker = this.circuitBreakers.get(id);
    if (!breaker || !breaker.enabled) return;
    breaker.currentValue = value;
    if (id === 'daily-loss') {
      if (value < breaker.threshold) this.tripCircuitBreaker(id);
    } else if (value >= breaker.threshold) {
      this.tripCircuitBreaker(id);
    }
  }

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
    stageManager.pause(`Circuit breaker tripped: ${breaker.name}`);
  }

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

  getTrippedCircuitBreakers(): CircuitBreaker[] {
    return Array.from(this.circuitBreakers.values()).filter(b => b.isTripped);
  }

  getAllCircuitBreakers(): CircuitBreaker[] {
    return Array.from(this.circuitBreakers.values());
  }

  private recordAssessment(assessment: RiskAssessment): void {
    this.assessmentHistory.push(assessment);
    if (this.assessmentHistory.length > 1000) this.assessmentHistory.shift();
  }

  getAssessmentHistory(): RiskAssessment[] {
    return [...this.assessmentHistory];
  }

  getApprovalRate(): number {
    if (this.assessmentHistory.length === 0) return 0;
    const approvedCount = this.assessmentHistory.filter(a => a.approved).length;
    return approvedCount / this.assessmentHistory.length;
  }

  exportState(): any {
    return {
      circuitBreakers: Array.from(this.circuitBreakers.values()),
      assessmentHistory: this.assessmentHistory.slice(-100),
      approvalRate: this.getApprovalRate(),
      profitCeilingAuthority: false,
      positionSizeAuthority: 'profit_ladder_capital_allowance',
      legacyStagePositionCapAuthoritative: false,
      timestamp: Date.now(),
    };
  }
}

export const riskGovernor = RiskGovernor.getInstance();