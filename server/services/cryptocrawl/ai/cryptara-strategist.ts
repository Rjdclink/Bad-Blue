/**
 * CRYPTARA - AI Strategist (Analysis Only)
 * 
 * HARD RULES:
 * - Analysis ONLY (current stage) - NO execution authority
 * - No timers, no background loops, no execution authority
 * - Cognition gated by stage (active only at stage 8+ for final dry run)
 * - Must be isolated from influencing outcomes or introducing new variables
 * - After Stage 9 completion + stable cycles: advisory only, NO EXECUTION
 * 
 * Stage 8 Condition: signal -> decision -> visualization report = pass
 * 
 * Cryptara Goal: Improvement of market analysis, market fluctuations, 
 * and market predictions outputs (NON-BINDING)
 */

import logger from '../../../logger.js';
import { composer, type StageNumber } from '../governance/composer';

// ============================================
// TYPE DEFINITIONS
// ============================================

export type CryptaraMode = 'SILENT' | 'ANALYSIS' | 'ADVISORY' | 'SURVEILLANCE';

export interface MarketAnalysis {
  timestamp: number;
  asset: string;
  chain: string;
  analysis: {
    trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    trendStrength: number;          // 0-1
    volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    momentumScore: number;          // -100 to 100
    supportLevel: number;
    resistanceLevel: number;
    riskScore: number;              // 0-100 (higher = more risk)
  };
  predictions: {
    shortTerm: MarketPrediction;    // 1-4 hours
    mediumTerm: MarketPrediction;   // 1-7 days
    confidence: number;             // 0-1
  };
  nonBindingRecommendation: string;
}

export interface MarketPrediction {
  direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  magnitude: number;                 // Expected % change
  confidence: number;                // 0-1
  timeframe: string;
}

export interface CryptaraReport {
  reportId: string;
  timestamp: number;
  mode: CryptaraMode;
  stageAtGeneration: StageNumber;
  signalToDecisionFlow: boolean;
  decisionToVisualizationFlow: boolean;
  visualizationToReportFlow: boolean;
  overallFlowPass: boolean;
  analyses: MarketAnalysis[];
  advisoryNotes: string[];
  disclaimer: string;
}

export interface SurveillanceCycle {
  cycleId: string;
  startTime: number;
  endTime: number | null;
  observations: SurveillanceObservation[];
  anomaliesDetected: number;
  marketConditionChanges: number;
}

export interface SurveillanceObservation {
  timestamp: number;
  type: 'TREND_CHANGE' | 'VOLATILITY_SPIKE' | 'LIQUIDITY_DROP' | 'PATTERN_DETECTED' | 'ANOMALY';
  description: string;
  severity: 'INFO' | 'WARNING' | 'ALERT';
  nonBindingAction: string;
}

// ============================================
// CRYPTARA CLASS
// ============================================

export class CryptaraStrategist {
  private static instance: CryptaraStrategist;
  
  private mode: CryptaraMode = 'SILENT';
  private reports: CryptaraReport[] = [];
  private surveillanceCycles: SurveillanceCycle[] = [];
  private currentSurveillance: SurveillanceCycle | null = null;
  private reportIdCounter: number = 0;
  
  // HARD RULE: Never execute, always advisory
  private readonly EXECUTION_BLOCKED = true;
  private readonly DISCLAIMER = 'CRYPTARA ANALYSIS IS NON-BINDING. NO EXECUTION AUTHORITY. ADVISORY ONLY.';
  
  private constructor() {
    this.updateModeBasedOnStage();
    
    logger.info('[Cryptara] AI Strategist initialized', {
      mode: this.mode,
      executionBlocked: this.EXECUTION_BLOCKED
    });
  }
  
  static getInstance(): CryptaraStrategist {
    if (!CryptaraStrategist.instance) {
      CryptaraStrategist.instance = new CryptaraStrategist();
    }
    return CryptaraStrategist.instance;
  }
  
  // ============================================
  // MODE MANAGEMENT (STAGE-GATED)
  // ============================================
  
  /**
   * Update Cryptara mode based on current stage
   * HARD RULE: Cognition gated by stage
   */
  private updateModeBasedOnStage(): void {
    const stage = composer.getCurrentStage();
    
    if (stage < 8) {
      // Before Stage 8: Silent watcher only
      this.mode = 'SILENT';
    } else if (stage === 8) {
      // Stage 8: Analysis for dry run validation
      this.mode = 'ANALYSIS';
    } else if (stage === 9) {
      // Stage 9: Can provide advisory (still no execution)
      this.mode = 'ADVISORY';
    } else {
      // Post Stage 9 with stable cycles: Surveillance mode
      this.mode = 'SURVEILLANCE';
    }
    
    logger.info('[Cryptara] Mode updated based on stage', {
      stage,
      mode: this.mode
    });
  }
  
  /**
   * Get current mode
   */
  getMode(): CryptaraMode {
    this.updateModeBasedOnStage();
    return this.mode;
  }
  
  /**
   * Check if Cryptara is active (not silent)
   */
  isActive(): boolean {
    this.updateModeBasedOnStage();
    return this.mode !== 'SILENT';
  }
  
  // ============================================
  // ANALYSIS METHODS (NON-BINDING)
  // ============================================
  
  /**
   * Analyze market conditions for an asset
   * Returns non-binding analysis only
   */
  analyzeMarket(asset: string, chain: string, marketData: {
    price: number;
    volume24h: number;
    priceChange24h: number;
    volatility: number;
    liquidity: number;
  }): MarketAnalysis | null {
    // HARD RULE: Only analyze when mode permits
    if (this.mode === 'SILENT') {
      logger.debug('[Cryptara] Analysis blocked - mode is SILENT');
      return null;
    }
    
    // Perform analysis (no execution, just observation)
    const trendDirection = this.determineTrend(marketData.priceChange24h);
    const trendStrength = Math.min(1, Math.abs(marketData.priceChange24h) / 10);
    const volatilityLevel = this.categorizeVolatility(marketData.volatility);
    const momentumScore = this.calculateMomentum(marketData);
    const riskScore = this.assessRisk(marketData);
    
    // Generate non-binding predictions
    const shortTermPrediction = this.predictShortTerm(marketData, trendDirection);
    const mediumTermPrediction = this.predictMediumTerm(marketData, trendDirection);
    
    const analysis: MarketAnalysis = {
      timestamp: Date.now(),
      asset,
      chain,
      analysis: {
        trendDirection,
        trendStrength,
        volatilityLevel,
        momentumScore,
        supportLevel: marketData.price * 0.95,
        resistanceLevel: marketData.price * 1.05,
        riskScore
      },
      predictions: {
        shortTerm: shortTermPrediction,
        mediumTerm: mediumTermPrediction,
        confidence: Math.max(0.3, 1 - marketData.volatility)
      },
      nonBindingRecommendation: this.generateRecommendation(riskScore, trendDirection, volatilityLevel)
    };
    
    logger.info('[Cryptara] Market analysis generated', {
      asset,
      chain,
      trend: trendDirection,
      riskScore,
      mode: this.mode,
      disclaimer: 'NON-BINDING'
    });
    
    return analysis;
  }
  
  private determineTrend(priceChange: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    if (priceChange > 2) return 'BULLISH';
    if (priceChange < -2) return 'BEARISH';
    return 'NEUTRAL';
  }
  
  private categorizeVolatility(volatility: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
    if (volatility < 0.3) return 'LOW';
    if (volatility < 0.6) return 'MEDIUM';
    if (volatility < 1.0) return 'HIGH';
    return 'EXTREME';
  }
  
  private calculateMomentum(data: { priceChange24h: number; volume24h: number }): number {
    // Simple momentum calculation
    const priceMomentum = data.priceChange24h * 5;
    const volumeFactor = Math.log10(data.volume24h + 1) / 10;
    return Math.max(-100, Math.min(100, priceMomentum * volumeFactor));
  }
  
  private assessRisk(data: { volatility: number; liquidity: number }): number {
    const volatilityRisk = data.volatility * 50;
    const liquidityRisk = (1 - data.liquidity) * 30;
    const baseRisk = 20;
    return Math.min(100, baseRisk + volatilityRisk + liquidityRisk);
  }
  
  private predictShortTerm(data: { priceChange24h: number; volatility: number }, trend: string): MarketPrediction {
    const trendFactor = trend === 'BULLISH' ? 1 : trend === 'BEARISH' ? -1 : 0;
    return {
      direction: trendFactor > 0 ? 'UP' : trendFactor < 0 ? 'DOWN' : 'SIDEWAYS',
      magnitude: Math.abs(data.priceChange24h * 0.3),
      confidence: Math.max(0.2, 0.7 - data.volatility),
      timeframe: '1-4 hours'
    };
  }
  
  private predictMediumTerm(data: { priceChange24h: number; volatility: number }, trend: string): MarketPrediction {
    return {
      direction: trend === 'BULLISH' ? 'UP' : trend === 'BEARISH' ? 'DOWN' : 'SIDEWAYS',
      magnitude: Math.abs(data.priceChange24h * 0.5),
      confidence: Math.max(0.1, 0.5 - data.volatility),
      timeframe: '1-7 days'
    };
  }
  
  private generateRecommendation(risk: number, trend: string, volatility: string): string {
    if (risk > 70) {
      return 'HIGH RISK - Consider reducing exposure or waiting for stability';
    }
    if (volatility === 'EXTREME') {
      return 'EXTREME VOLATILITY - Exercise extreme caution';
    }
    if (trend === 'BULLISH' && risk < 40) {
      return 'Conditions may favor cautious entry points (non-binding)';
    }
    if (trend === 'BEARISH' && risk < 50) {
      return 'Monitor for potential reversal signals (non-binding)';
    }
    return 'Neutral conditions - Continue monitoring (non-binding)';
  }
  
  // ============================================
  // STAGE 8 DRY RUN VALIDATION
  // ============================================
  
  /**
   * Generate Stage 8 dry run report
   * Validates: signal -> decision -> visualization -> report flow
   */
  generateDryRunReport(
    signalData: { signals: number; valid: boolean },
    decisionData: { decisions: number; valid: boolean },
    visualizationData: { rendered: boolean; valid: boolean }
  ): CryptaraReport {
    const stage = composer.getCurrentStage();
    
    // Validate flow
    const signalToDecisionFlow = signalData.valid && decisionData.decisions > 0;
    const decisionToVisualizationFlow = decisionData.valid && visualizationData.rendered;
    const visualizationToReportFlow = visualizationData.valid;
    
    const overallFlowPass = signalToDecisionFlow && 
                            decisionToVisualizationFlow && 
                            visualizationToReportFlow;
    
    const report: CryptaraReport = {
      reportId: `CRYPTARA-${++this.reportIdCounter}-${Date.now()}`,
      timestamp: Date.now(),
      mode: this.mode,
      stageAtGeneration: stage,
      signalToDecisionFlow,
      decisionToVisualizationFlow,
      visualizationToReportFlow,
      overallFlowPass,
      analyses: [],
      advisoryNotes: this.generateAdvisoryNotes(overallFlowPass, stage),
      disclaimer: this.DISCLAIMER
    };
    
    this.reports.push(report);
    
    logger.info('[Cryptara] Dry run report generated', {
      reportId: report.reportId,
      overallFlowPass,
      stage,
      disclaimer: 'NON-BINDING ADVISORY ONLY'
    });
    
    return report;
  }
  
  private generateAdvisoryNotes(flowPass: boolean, stage: StageNumber): string[] {
    const notes: string[] = [];
    
    notes.push(`Analysis generated at Stage ${stage}`);
    notes.push(this.DISCLAIMER);
    
    if (flowPass) {
      notes.push('Signal-to-report flow validated successfully');
      notes.push('System ready for next stage (advisory only)');
    } else {
      notes.push('Flow validation incomplete - review required');
      notes.push('Do not proceed until flow is validated');
    }
    
    if (stage >= 9) {
      notes.push('Post-Stage 9: Cryptara in surveillance mode');
      notes.push('Continuous monitoring active - NO EXECUTION AUTHORITY');
    }
    
    return notes;
  }
  
  // ============================================
  // SURVEILLANCE MODE (POST STAGE 9)
  // ============================================
  
  /**
   * Start a surveillance cycle
   * Only available after Stage 9 completion with stable cycles
   */
  startSurveillanceCycle(): string | null {
    if (this.mode !== 'SURVEILLANCE') {
      logger.warn('[Cryptara] Cannot start surveillance - mode not SURVEILLANCE');
      return null;
    }
    
    if (this.currentSurveillance) {
      logger.warn('[Cryptara] Surveillance cycle already active');
      return this.currentSurveillance.cycleId;
    }
    
    const cycle: SurveillanceCycle = {
      cycleId: `SURV-${Date.now()}`,
      startTime: Date.now(),
      endTime: null,
      observations: [],
      anomaliesDetected: 0,
      marketConditionChanges: 0
    };
    
    this.currentSurveillance = cycle;
    this.surveillanceCycles.push(cycle);
    
    logger.info('[Cryptara] Surveillance cycle started', {
      cycleId: cycle.cycleId,
      mode: 'ADVISORY ONLY - NO EXECUTION'
    });
    
    return cycle.cycleId;
  }
  
  /**
   * Record surveillance observation
   */
  recordObservation(observation: Omit<SurveillanceObservation, 'timestamp'>): void {
    if (!this.currentSurveillance) {
      return;
    }
    
    const obs: SurveillanceObservation = {
      ...observation,
      timestamp: Date.now()
    };
    
    this.currentSurveillance.observations.push(obs);
    
    if (obs.type === 'ANOMALY') {
      this.currentSurveillance.anomaliesDetected++;
    }
    if (obs.type === 'TREND_CHANGE' || obs.type === 'VOLATILITY_SPIKE') {
      this.currentSurveillance.marketConditionChanges++;
    }
    
    logger.info('[Cryptara] Surveillance observation recorded', {
      type: obs.type,
      severity: obs.severity,
      action: 'NON-BINDING ADVISORY'
    });
  }
  
  /**
   * End surveillance cycle
   */
  endSurveillanceCycle(): SurveillanceCycle | null {
    if (!this.currentSurveillance) {
      return null;
    }
    
    this.currentSurveillance.endTime = Date.now();
    const cycle = this.currentSurveillance;
    this.currentSurveillance = null;
    
    logger.info('[Cryptara] Surveillance cycle ended', {
      cycleId: cycle.cycleId,
      duration: `${(cycle.endTime - cycle.startTime) / 1000}s`,
      observations: cycle.observations.length,
      anomalies: cycle.anomaliesDetected
    });
    
    return cycle;
  }
  
  // ============================================
  // REPORTING
  // ============================================
  
  /**
   * Generate Cryptara status report
   */
  generateStatusReport(): string {
    const stage = composer.getCurrentStage();
    this.updateModeBasedOnStage();
    
    let report = '\n╔════════════════════════════════════════════════════════════════════╗\n';
    report += '║                    CRYPTARA AI STRATEGIST                          ║\n';
    report += '║                   (ANALYSIS ONLY - NON-BINDING)                    ║\n';
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += `║ Current Stage:   ${String(stage).padEnd(51)}║\n`;
    report += `║ Mode:            ${this.mode.padEnd(51)}║\n`;
    report += `║ Execution Auth:  ${'BLOCKED (HARD RULE)'.padEnd(51)}║\n`;
    report += `║ Reports Generated: ${String(this.reports.length).padEnd(49)}║\n`;
    report += `║ Surveillance Cycles: ${String(this.surveillanceCycles.length).padEnd(47)}║\n`;
    report += '╠════════════════════════════════════════════════════════════════════╣\n';
    report += '║ HARD RULES:                                                        ║\n';
    report += '║ • Analysis ONLY - NO execution authority                           ║\n';
    report += '║ • No timers, no background loops                                   ║\n';
    report += '║ • Isolated from influencing outcomes                               ║\n';
    report += '║ • Cognition gated by stage (active at Stage 8+)                    ║\n';
    report += '║ • All outputs are NON-BINDING ADVISORY                             ║\n';
    report += '╚════════════════════════════════════════════════════════════════════╝\n';
    
    return report;
  }
  
  /**
   * Get all reports
   */
  getReports(): CryptaraReport[] {
    return [...this.reports];
  }
  
  /**
   * Get latest report
   */
  getLatestReport(): CryptaraReport | null {
    return this.reports[this.reports.length - 1] || null;
  }
}

// Export singleton instance
export const cryptara = CryptaraStrategist.getInstance();
