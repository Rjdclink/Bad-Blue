/**
 * RISK GOVERNOR GATE
 * 
 * Enforces hard ceilings and anomaly rejection:
 * - Position size limits
 * - Drawdown ceilings
 * - Liquidity adequacy checks
 * - Slippage tolerance
 * - Latency tolerance
 * - Anomaly rate ceiling
 */

import { createLogger } from '../../../logger';
import type { FusedSignal } from './signal-fusion-gate';
import type { StressTestResult } from './monte-carlo-stress-gate';

const log = createLogger('RiskGovernorGate');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface RiskLimits {
  maxPositionSize: number;          // USD
  maxDrawdown: number;               // 0-1 (e.g., 0.15 = 15%)
  maxLeverage: number;               // e.g., 3.0 = 3x
  minLiquidity: number;               // USD
  maxSlippage: number;                // 0-1 (e.g., 0.05 = 5%)
  maxLatency: number;                 // ms
  anomalyThreshold: number;           // Standard deviations
  varianceCeiling: number;            // 0-1 (e.g., 0.25 = 25%)
}

export interface RiskAssessment {
  passed: boolean;
  confidence: number;
  reason: string;
  
  // Risk metrics
  positionSize: number;
  drawdownRisk: number;
  liquidityAdequacy: number;          // 0-1, 1 = fully adequate
  slippageTolerance: number;          // 0-1, 1 = within tolerance
  latencyTolerance: number;            // 0-1, 1 = within tolerance
  anomalyRate: number;                 // 0-1, 0 = no anomalies
  
  // Ceiling checks
  positionSizeWithinLimit: boolean;
  drawdownWithinCeiling: boolean;
  liquidityAdequate: boolean;
  slippageWithinTolerance: boolean;
  latencyWithinTolerance: boolean;
  anomalyRateWithinCeiling: boolean;
  
  // Anomaly detection
  anomaliesDetected: Anomaly[];
}

export interface Anomaly {
  type: 'position_size' | 'drawdown' | 'liquidity' | 'slippage' | 'latency' | 'variance' | 'pattern';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  value: number;
  threshold: number;
}

// ============================================================================
// RISK GOVERNOR GATE CLASS
// ============================================================================

export class RiskGovernorGate {
  private config: RiskLimits;
  private initialized: boolean = false;
  private recentAssessments: RiskAssessment[] = [];

  constructor(config: RiskLimits) {
    this.config = config;
    log.info('Risk Governor Gate created', { config });
  }

  /**
   * Initialize the gate
   */
  async initialize(): Promise<void> {
    this.initialized = true;
    log.info('Risk Governor Gate initialized');
  }

  /**
   * Assess risk and enforce hard ceilings
   */
  async assessRisk(
    fusedSignal: FusedSignal,
    stressTestResult: StressTestResult
  ): Promise<RiskAssessment> {
    if (!this.initialized) {
      throw new Error('Risk Governor Gate not initialized');
    }

    if (!fusedSignal.opportunity) {
      return {
        passed: false,
        confidence: 0,
        reason: 'No opportunity signal to assess',
        positionSize: 0,
        drawdownRisk: 0,
        liquidityAdequacy: 0,
        slippageTolerance: 0,
        latencyTolerance: 0,
        anomalyRate: 0,
        positionSizeWithinLimit: false,
        drawdownWithinCeiling: false,
        liquidityAdequate: false,
        slippageWithinTolerance: false,
        latencyWithinTolerance: false,
        anomalyRateWithinCeiling: false,
        anomaliesDetected: [],
      };
    }

    const opportunity = fusedSignal.opportunity;
    const marketData = fusedSignal.marketData;

    log.info('Assessing risk for opportunity', {
      asset: opportunity.asset,
      profitEstimate: opportunity.profitEstimate,
    });

    // Calculate risk metrics
    const positionSize = this.estimatePositionSize(opportunity);
    const drawdownRisk = stressTestResult.maxDrawdown;
    const liquidityAdequacy = this.assessLiquidityAdequacy(marketData, positionSize);
    const slippageTolerance = this.assessSlippageTolerance(marketData, stressTestResult);
    const latencyTolerance = this.assessLatencyTolerance(stressTestResult);
    const anomalyRate = this.detectAnomalies(fusedSignal, stressTestResult);

    // Check against hard ceilings
    const positionSizeWithinLimit = positionSize <= this.config.maxPositionSize;
    const drawdownWithinCeiling = drawdownRisk <= this.config.maxDrawdown;
    const liquidityAdequate = liquidityAdequacy >= 0.7; // At least 70% adequate
    const slippageWithinTolerance = slippageTolerance >= 0.8; // At least 80% within tolerance
    const latencyWithinTolerance = latencyTolerance >= 0.8; // At least 80% within tolerance
    const anomalyRateWithinCeiling = anomalyRate <= this.config.varianceCeiling;

    // Detect specific anomalies
    const anomaliesDetected = this.detectSpecificAnomalies(
      positionSize,
      drawdownRisk,
      liquidityAdequacy,
      slippageTolerance,
      latencyTolerance,
      anomalyRate,
      fusedSignal,
      stressTestResult
    );

    // Calculate overall confidence
    const checks = [
      positionSizeWithinLimit ? 1 : 0,
      drawdownWithinCeiling ? 1 : 0,
      liquidityAdequate ? 1 : 0,
      slippageWithinTolerance ? 1 : 0,
      latencyWithinTolerance ? 1 : 0,
      anomalyRateWithinCeiling ? 1 : 0,
    ];
    const passedChecks = checks.reduce((sum, check) => sum + check, 0);
    const confidence = passedChecks / checks.length;

    // All checks must pass for overall pass
    const passed = positionSizeWithinLimit &&
                  drawdownWithinCeiling &&
                  liquidityAdequate &&
                  slippageWithinTolerance &&
                  latencyWithinTolerance &&
                  anomalyRateWithinCeiling &&
                  anomaliesDetected.filter(a => a.severity === 'critical' || a.severity === 'high').length === 0;

    const reason = passed
      ? `All risk checks passed: position=${positionSize.toFixed(2)}, drawdown=${(drawdownRisk * 100).toFixed(1)}%, liquidity=${(liquidityAdequacy * 100).toFixed(1)}%`
      : `Risk checks failed: ${[
          !positionSizeWithinLimit ? 'position size exceeds limit' : null,
          !drawdownWithinCeiling ? 'drawdown exceeds ceiling' : null,
          !liquidityAdequate ? 'liquidity inadequate' : null,
          !slippageWithinTolerance ? 'slippage exceeds tolerance' : null,
          !latencyWithinTolerance ? 'latency exceeds tolerance' : null,
          !anomalyRateWithinCeiling ? 'anomaly rate exceeds ceiling' : null,
          anomaliesDetected.filter(a => a.severity === 'critical' || a.severity === 'high').length > 0 ? 'critical/high anomalies detected' : null,
        ].filter(Boolean).join(', ')}`;

    const assessment: RiskAssessment = {
      passed,
      confidence,
      reason,
      positionSize,
      drawdownRisk,
      liquidityAdequacy,
      slippageTolerance,
      latencyTolerance,
      anomalyRate,
      positionSizeWithinLimit,
      drawdownWithinCeiling,
      liquidityAdequate,
      slippageWithinTolerance,
      latencyWithinTolerance,
      anomalyRateWithinCeiling,
      anomaliesDetected,
    };

    // Store recent assessment for anomaly detection
    this.recentAssessments.push(assessment);
    if (this.recentAssessments.length > 100) {
      this.recentAssessments.shift();
    }

    return assessment;
  }

  /**
   * Estimate position size from opportunity
   */
  private estimatePositionSize(opportunity: FusedSignal['opportunity']!): number {
    // Estimate position size based on profit estimate and confidence
    // Higher confidence = larger position, but capped by maxPositionSize
    const baseSize = opportunity.profitEstimate * 10; // Assume 10% profit margin
    const confidenceMultiplier = opportunity.confidence;
    const estimatedSize = baseSize * confidenceMultiplier;
    return Math.min(estimatedSize, this.config.maxPositionSize);
  }

  /**
   * Assess liquidity adequacy
   */
  private assessLiquidityAdequacy(
    marketData: FusedSignal['marketData'] | undefined,
    positionSize: number
  ): number {
    if (!marketData) {
      return 0.5; // Unknown liquidity, conservative estimate
    }

    const liquidityScore = marketData.liquidityScore;
    const requiredLiquidity = this.config.minLiquidity;
    const adequacyRatio = Math.min(1, (liquidityScore * requiredLiquidity * 2) / positionSize);
    
    return adequacyRatio;
  }

  /**
   * Assess slippage tolerance
   */
  private assessSlippageTolerance(
    marketData: FusedSignal['marketData'] | undefined,
    stressTestResult: StressTestResult
  ): number {
    if (!marketData) {
      return 0.5; // Unknown slippage, conservative estimate
    }

    // Slippage increases with volatility and decreases with liquidity
    const estimatedSlippage = marketData.volatility * (1 - marketData.liquidityScore) * 0.1;
    const toleranceRatio = 1 - (estimatedSlippage / this.config.maxSlippage);
    
    // Also consider stress test slippage impact
    const stressSlippageImpact = stressTestResult.slippageStress.impact / 100;
    const combinedTolerance = toleranceRatio * (1 - stressSlippageImpact);
    
    return Math.max(0, Math.min(1, combinedTolerance));
  }

  /**
   * Assess latency tolerance
   */
  private assessLatencyTolerance(stressTestResult: StressTestResult): number {
    const worstCaseLatency = stressTestResult.latencyStress.worstCase;
    const toleranceRatio = 1 - (worstCaseLatency / this.config.maxLatency);
    return Math.max(0, Math.min(1, toleranceRatio));
  }

  /**
   * Detect anomalies in signal and stress test results
   */
  private detectAnomalies(
    fusedSignal: FusedSignal,
    stressTestResult: StressTestResult
  ): number {
    let anomalyCount = 0;
    let totalChecks = 0;

    // Check for extreme values (beyond threshold standard deviations)
    const checks = [
      { value: stressTestResult.valueAtRisk99, mean: stressTestResult.percentiles.p50, threshold: this.config.anomalyThreshold },
      { value: stressTestResult.maxDrawdown, mean: 0.1, threshold: this.config.anomalyThreshold },
      { value: stressTestResult.percentiles.p5, mean: stressTestResult.percentiles.p50, threshold: this.config.anomalyThreshold },
    ];

    for (const check of checks) {
      totalChecks++;
      const deviation = Math.abs(check.value - check.mean) / (check.mean || 1);
      if (deviation > check.threshold) {
        anomalyCount++;
      }
    }

    // Check variance ceiling
    const variance = this.calculateVariance([
      stressTestResult.percentiles.p5,
      stressTestResult.percentiles.p25,
      stressTestResult.percentiles.p50,
      stressTestResult.percentiles.p75,
      stressTestResult.percentiles.p95,
    ]);
    totalChecks++;
    if (variance > this.config.varianceCeiling) {
      anomalyCount++;
    }

    return totalChecks > 0 ? anomalyCount / totalChecks : 0;
  }

  /**
   * Detect specific anomalies with severity levels
   */
  private detectSpecificAnomalies(
    positionSize: number,
    drawdownRisk: number,
    liquidityAdequacy: number,
    slippageTolerance: number,
    latencyTolerance: number,
    anomalyRate: number,
    fusedSignal: FusedSignal,
    stressTestResult: StressTestResult
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Position size anomaly
    if (positionSize > this.config.maxPositionSize * 0.9) {
      anomalies.push({
        type: 'position_size',
        severity: positionSize > this.config.maxPositionSize ? 'critical' : 'high',
        description: `Position size (${positionSize.toFixed(2)}) approaches/exceeds limit (${this.config.maxPositionSize})`,
        value: positionSize,
        threshold: this.config.maxPositionSize,
      });
    }

    // Drawdown anomaly
    if (drawdownRisk > this.config.maxDrawdown * 0.8) {
      anomalies.push({
        type: 'drawdown',
        severity: drawdownRisk > this.config.maxDrawdown ? 'critical' : 'high',
        description: `Drawdown risk (${(drawdownRisk * 100).toFixed(1)}%) approaches/exceeds ceiling (${(this.config.maxDrawdown * 100).toFixed(1)}%)`,
        value: drawdownRisk,
        threshold: this.config.maxDrawdown,
      });
    }

    // Liquidity anomaly
    if (liquidityAdequacy < 0.5) {
      anomalies.push({
        type: 'liquidity',
        severity: liquidityAdequacy < 0.3 ? 'critical' : 'medium',
        description: `Liquidity adequacy (${(liquidityAdequacy * 100).toFixed(1)}%) is low`,
        value: liquidityAdequacy,
        threshold: 0.7,
      });
    }

    // Slippage anomaly
    if (slippageTolerance < 0.5) {
      anomalies.push({
        type: 'slippage',
        severity: slippageTolerance < 0.3 ? 'critical' : 'medium',
        description: `Slippage tolerance (${(slippageTolerance * 100).toFixed(1)}%) is low`,
        value: slippageTolerance,
        threshold: 0.8,
      });
    }

    // Latency anomaly
    if (latencyTolerance < 0.5) {
      anomalies.push({
        type: 'latency',
        severity: latencyTolerance < 0.3 ? 'critical' : 'medium',
        description: `Latency tolerance (${(latencyTolerance * 100).toFixed(1)}%) is low`,
        value: latencyTolerance,
        threshold: 0.8,
      });
    }

    // Variance anomaly
    if (anomalyRate > this.config.varianceCeiling * 0.8) {
      anomalies.push({
        type: 'variance',
        severity: anomalyRate > this.config.varianceCeiling ? 'critical' : 'high',
        description: `Anomaly rate (${(anomalyRate * 100).toFixed(1)}%) approaches/exceeds ceiling (${(this.config.varianceCeiling * 100).toFixed(1)}%)`,
        value: anomalyRate,
        threshold: this.config.varianceCeiling,
      });
    }

    // Pattern anomaly (if confidence is very low)
    if (fusedSignal.fusedConfidence < 0.3) {
      anomalies.push({
        type: 'pattern',
        severity: 'medium',
        description: `Signal confidence (${(fusedSignal.fusedConfidence * 100).toFixed(1)}%) is very low`,
        value: fusedSignal.fusedConfidence,
        threshold: 0.6,
      });
    }

    return anomalies;
  }

  /**
   * Calculate variance of an array
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return variance;
  }
}
