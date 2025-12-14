/**
 * MAXIMAL DECISION ENGINE + MONTE CARLO GATE
 * 
 * Stage 4 Implementation: Unified decision engine with three critical gates:
 * 1. Signal Fusion Gate (multi-source agreement)
 * 2. Monte Carlo Stress Gate (simulation: volatility, fees, slippage, latency)
 * 3. Risk Governor Gate (hard ceilings, anomaly rejection)
 * 
 * Hard Rule: If any gate fails → NO SIGNAL OUTPUT
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { SignalFusionGate, type SignalSource, type FusedSignal } from './signal-fusion-gate';
import { MonteCarloStressGate, type StressTestResult, type StressTestConfig } from './monte-carlo-stress-gate';
import { RiskGovernorGate, type RiskAssessment, type RiskLimits } from './risk-governor-gate';

const log = createLogger('DecisionEngine');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface DecisionEngineConfig {
  signalFusion: {
    minSourceAgreement: number;      // Minimum number of sources that must agree (default: 2)
    agreementThreshold: number;       // Minimum confidence for agreement (0-1, default: 0.6)
    enableWeightedFusion: boolean;    // Use weighted fusion vs simple majority
  };
  monteCarlo: StressTestConfig & {
    enableEarlyAbort?: boolean;
    earlyAbortDrawdownThreshold?: number;
    earlyAbortCheckInterval?: number;
  };
  riskGovernor: RiskLimits;
  killSwitch: {
    enabled: boolean;
    pauseOnFailure: boolean;          // Pause (not crash) on gate failure
    maxConsecutiveFailures: number;   // Kill switch after N consecutive failures
  };
}

export interface SignalInput {
  sourceId: string;
  sourceType: 'cryptara' | 'cryptocrawl' | 'geoconsole' | 'computational-beam' | 'lux-swarm' | 'master-pipeline';
  signal: {
    opportunity?: {
      asset: string;
      pair?: string;
      chain: string;
      profitEstimate: number;
      confidence: number;
      timestamp: number;
    };
    pattern?: {
      type: string;
      confidence: number;
      description: string;
    };
    prediction?: {
      asset: string;
      direction: 'bullish' | 'bearish' | 'neutral';
      confidence: number;
      timeframe: string;
    };
    marketData?: {
      volatility: number;
      liquidityScore: number;
      gasVolatility: number;
      competitorDensity: number;
      networkCongestion: number;
    };
  };
  metadata?: Record<string, unknown>;
}

export interface GateVerdict {
  gateName: 'signal-fusion' | 'monte-carlo-stress' | 'risk-governor';
  passed: boolean;
  confidence: number;
  reason: string;
  details?: Record<string, unknown>;
  thresholds?: {
    required: number;
    actual: number;
  };
}

export interface DecisionResult {
  decisionId: string;
  timestamp: Date;
  verdict: 'PASS' | 'FAIL';
  gates: {
    signalFusion: GateVerdict;
    monteCarloStress: GateVerdict;
    riskGovernor: GateVerdict;
  };
  fusedSignal?: FusedSignal;
  stressTestResult?: StressTestResult;
  riskAssessment?: RiskAssessment;
  killSwitchTriggered: boolean;
  recommendedCapTier?: 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'tier5' | 'tier6' | 'tier7' | 'tier8';
  outputSignal?: {
    tradeable: boolean;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    recommendedAction: 'execute' | 'hold' | 'reject';
  };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: DecisionEngineConfig = {
  signalFusion: {
    minSourceAgreement: 2,
    agreementThreshold: 0.6,
    enableWeightedFusion: true,
  },
  monteCarlo: {
    simulations: 3000,              // Reduced for live path (1k-5k range)
    confidenceLevel: 0.95,
    stressTestVolatility: true,
    stressTestFees: true,
    stressTestSlippage: true,
    stressTestLatency: true,
    minPassThreshold: 0.7,
    enableEarlyAbort: true,          // Enable early abort for live path
    earlyAbortDrawdownThreshold: 0.3, // Abort if drawdown exceeds 30%
    earlyAbortCheckInterval: 100,    // Check every 100 simulations
  },
  riskGovernor: {
    maxPositionSize: 10000,           // USD
    maxDrawdown: 0.15,                // 15%
    maxLeverage: 3.0,
    minLiquidity: 100000,             // USD
    maxSlippage: 0.05,                // 5%
    maxLatency: 500,                  // ms
    anomalyThreshold: 3.0,            // Standard deviations
    varianceCeiling: 0.25,            // 25%
  },
  killSwitch: {
    enabled: true,
    pauseOnFailure: true,
    maxConsecutiveFailures: 5,
  },
};

// ============================================================================
// DECISION ENGINE CLASS
// ============================================================================

export class DecisionEngine extends EventEmitter {
  private config: DecisionEngineConfig;
  private signalFusionGate: SignalFusionGate;
  private monteCarloStressGate: MonteCarloStressGate;
  private riskGovernorGate: RiskGovernorGate;
  private consecutiveFailures: number = 0;
  private killSwitchActive: boolean = false;
  private initialized: boolean = false;

  constructor(config?: Partial<DecisionEngineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.signalFusionGate = new SignalFusionGate(this.config.signalFusion);
    this.monteCarloStressGate = new MonteCarloStressGate(this.config.monteCarlo);
    this.riskGovernorGate = new RiskGovernorGate(this.config.riskGovernor);
    
    log.info('Decision Engine created', {
      signalFusion: this.config.signalFusion,
      monteCarlo: this.config.monteCarlo,
      riskGovernor: this.config.riskGovernor,
    });
  }

  /**
   * Initialize the decision engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn('Decision Engine already initialized');
      return;
    }

    log.info('Initializing Decision Engine...');
    
    await this.signalFusionGate.initialize();
    await this.monteCarloStressGate.initialize();
    await this.riskGovernorGate.initialize();
    
    this.initialized = true;
    this.killSwitchActive = false;
    this.consecutiveFailures = 0;
    
    this.emit('initialized', { timestamp: new Date() });
    log.info('Decision Engine initialized successfully');
  }

  /**
   * Process signals through all gates and make decision
   * 
   * Hard Rule: If any gate fails → NO SIGNAL OUTPUT
   */
  async processSignals(signals: SignalInput[]): Promise<DecisionResult> {
    if (!this.initialized) {
      throw new Error('Decision Engine not initialized. Call initialize() first.');
    }

    if (this.killSwitchActive) {
      log.warn('Decision Engine kill switch is active - rejecting all signals');
      return this.createFailResult('Kill switch active', signals);
    }

    const decisionId = `dec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date();

    log.info('Processing signals through decision gates', {
      decisionId,
      signalCount: signals.length,
    });

    // ========================================================================
    // GATE 1: SIGNAL FUSION GATE
    // ========================================================================
    const signalFusionResult = await this.signalFusionGate.fuseSignals(signals);
    const signalFusionVerdict: GateVerdict = {
      gateName: 'signal-fusion',
      passed: signalFusionResult.passed,
      confidence: signalFusionResult.confidence,
      reason: signalFusionResult.reason,
      details: {
        sourceCount: signals.length,
        agreementCount: signalFusionResult.agreementCount,
        minRequired: this.config.signalFusion.minSourceAgreement,
      },
      thresholds: {
        required: this.config.signalFusion.agreementThreshold,
        actual: signalFusionResult.confidence,
      },
    };

    if (!signalFusionResult.passed) {
      log.warn('Signal Fusion Gate FAILED', { decisionId, reason: signalFusionResult.reason });
      this.recordFailure();
      return this.createFailResult('Signal Fusion Gate failed', signals, {
        signalFusion: signalFusionVerdict,
      });
    }

    // ========================================================================
    // GATE 2: MONTE CARLO STRESS GATE
    // ========================================================================
    const stressTestResult = await this.monteCarloStressGate.stressTest(
      signalFusionResult.fusedSignal!
    );
    const monteCarloVerdict: GateVerdict = {
      gateName: 'monte-carlo-stress',
      passed: stressTestResult.passed,
      confidence: stressTestResult.confidence,
      reason: stressTestResult.reason,
      details: {
        valueAtRisk95: stressTestResult.valueAtRisk95,
        valueAtRisk99: stressTestResult.valueAtRisk99,
        maxDrawdown: stressTestResult.maxDrawdown,
        worstCasePath: stressTestResult.worstCasePath,
        passFailThreshold: stressTestResult.passFailThreshold,
      },
      thresholds: {
        required: this.config.monteCarlo.minPassThreshold,
        actual: stressTestResult.confidence,
      },
    };

    if (!stressTestResult.passed) {
      log.warn('Monte Carlo Stress Gate FAILED', { decisionId, reason: stressTestResult.reason });
      this.recordFailure();
      return this.createFailResult('Monte Carlo Stress Gate failed', signals, {
        signalFusion: signalFusionVerdict,
        monteCarloStress: monteCarloVerdict,
      });
    }

    // ========================================================================
    // GATE 3: RISK GOVERNOR GATE
    // ========================================================================
    const riskAssessment = await this.riskGovernorGate.assessRisk(
      signalFusionResult.fusedSignal!,
      stressTestResult
    );
    const riskGovernorVerdict: GateVerdict = {
      gateName: 'risk-governor',
      passed: riskAssessment.passed,
      confidence: riskAssessment.confidence,
      reason: riskAssessment.reason,
      details: {
        positionSize: riskAssessment.positionSize,
        drawdownRisk: riskAssessment.drawdownRisk,
        liquidityAdequacy: riskAssessment.liquidityAdequacy,
        slippageTolerance: riskAssessment.slippageTolerance,
        latencyTolerance: riskAssessment.latencyTolerance,
        anomalyRate: riskAssessment.anomalyRate,
      },
      thresholds: {
        required: 1.0, // Risk governor uses multiple thresholds
        actual: riskAssessment.confidence,
      },
    };

    if (!riskAssessment.passed) {
      log.warn('Risk Governor Gate FAILED', { decisionId, reason: riskAssessment.reason });
      this.recordFailure();
      return this.createFailResult('Risk Governor Gate failed', signals, {
        signalFusion: signalFusionVerdict,
        monteCarloStress: monteCarloVerdict,
        riskGovernor: riskGovernorVerdict,
      });
    }

    // ========================================================================
    // ALL GATES PASSED - CREATE OUTPUT SIGNAL
    // ========================================================================
    this.consecutiveFailures = 0; // Reset failure counter
    
    const overallConfidence = (
      signalFusionResult.confidence * 0.3 +
      stressTestResult.confidence * 0.4 +
      riskAssessment.confidence * 0.3
    );

    const recommendedCapTier = this.determineCapTier(
      overallConfidence,
      stressTestResult,
      riskAssessment
    );

    const outputSignal = {
      tradeable: true,
      confidence: overallConfidence,
      riskLevel: this.determineRiskLevel(riskAssessment),
      recommendedAction: overallConfidence > 0.8 ? 'execute' as const : 'hold' as const,
    };

    const result: DecisionResult = {
      decisionId,
      timestamp,
      verdict: 'PASS',
      gates: {
        signalFusion: signalFusionVerdict,
        monteCarloStress: monteCarloVerdict,
        riskGovernor: riskGovernorVerdict,
      },
      fusedSignal: signalFusionResult.fusedSignal,
      stressTestResult,
      riskAssessment,
      killSwitchTriggered: false,
      recommendedCapTier,
      outputSignal,
    };

    log.info('Decision Engine PASSED - Signal output approved', {
      decisionId,
      overallConfidence,
      recommendedCapTier,
      recommendedAction: outputSignal.recommendedAction,
    });

    this.emit('decision-passed', result);
    return result;
  }

  /**
   * Create a FAIL result
   */
  private createFailResult(
    reason: string,
    signals: SignalInput[],
    gates?: Partial<DecisionResult['gates']>
  ): DecisionResult {
    const decisionId = `dec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      decisionId,
      timestamp: new Date(),
      verdict: 'FAIL',
      gates: {
        signalFusion: gates?.signalFusion || {
          gateName: 'signal-fusion',
          passed: false,
          confidence: 0,
          reason: 'Not evaluated',
        },
        monteCarloStress: gates?.monteCarloStress || {
          gateName: 'monte-carlo-stress',
          passed: false,
          confidence: 0,
          reason: 'Not evaluated',
        },
        riskGovernor: gates?.riskGovernor || {
          gateName: 'risk-governor',
          passed: false,
          confidence: 0,
          reason: 'Not evaluated',
        },
      },
      killSwitchTriggered: this.killSwitchActive,
      outputSignal: {
        tradeable: false,
        confidence: 0,
        riskLevel: 'high',
        recommendedAction: 'reject',
      },
    };
  }

  /**
   * Record a gate failure
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    
    if (this.config.killSwitch.enabled && 
        this.consecutiveFailures >= this.config.killSwitch.maxConsecutiveFailures) {
      this.killSwitchActive = true;
      log.error('KILL SWITCH ACTIVATED', {
        consecutiveFailures: this.consecutiveFailures,
        maxAllowed: this.config.killSwitch.maxConsecutiveFailures,
      });
      this.emit('kill-switch-activated', {
        consecutiveFailures: this.consecutiveFailures,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Determine recommended cap tier based on confidence and risk metrics
   */
  private determineCapTier(
    confidence: number,
    stressTest: StressTestResult,
    riskAssessment: RiskAssessment
  ): DecisionResult['recommendedCapTier'] {
    // Tier ladder: $200 → $400 → $800 → $1,600 → $5,000 → $10,000 → $20,000 → $35,000
    
    if (confidence < 0.5 || stressTest.maxDrawdown > 0.2 || riskAssessment.drawdownRisk > 0.15) {
      return 'tier1'; // $200
    }
    
    if (confidence < 0.6 || stressTest.maxDrawdown > 0.15 || riskAssessment.drawdownRisk > 0.12) {
      return 'tier2'; // $400
    }
    
    if (confidence < 0.7 || stressTest.maxDrawdown > 0.12 || riskAssessment.drawdownRisk > 0.10) {
      return 'tier3'; // $800
    }
    
    if (confidence < 0.75 || stressTest.maxDrawdown > 0.10 || riskAssessment.drawdownRisk > 0.08) {
      return 'tier4'; // $1,600
    }
    
    if (confidence < 0.8 || stressTest.maxDrawdown > 0.08 || riskAssessment.drawdownRisk > 0.06) {
      return 'tier5'; // $5,000
    }
    
    if (confidence < 0.85 || stressTest.maxDrawdown > 0.06 || riskAssessment.drawdownRisk > 0.05) {
      return 'tier6'; // $10,000
    }
    
    if (confidence < 0.9 || stressTest.maxDrawdown > 0.05 || riskAssessment.drawdownRisk > 0.04) {
      return 'tier7'; // $20,000
    }
    
    return 'tier8'; // $35,000
  }

  /**
   * Determine risk level from risk assessment
   */
  private determineRiskLevel(riskAssessment: RiskAssessment): 'low' | 'medium' | 'high' {
    if (riskAssessment.drawdownRisk < 0.05 && 
        riskAssessment.anomalyRate < 0.01 &&
        riskAssessment.confidence > 0.8) {
      return 'low';
    }
    
    if (riskAssessment.drawdownRisk < 0.10 && 
        riskAssessment.anomalyRate < 0.03 &&
        riskAssessment.confidence > 0.6) {
      return 'medium';
    }
    
    return 'high';
  }

  /**
   * Reset kill switch (requires explicit call)
   */
  resetKillSwitch(): void {
    if (this.killSwitchActive) {
      log.info('Kill switch reset', {
        previousFailures: this.consecutiveFailures,
      });
      this.killSwitchActive = false;
      this.consecutiveFailures = 0;
      this.emit('kill-switch-reset', { timestamp: new Date() });
    }
  }

  /**
   * Get decision engine status
   */
  getStatus(): {
    initialized: boolean;
    killSwitchActive: boolean;
    consecutiveFailures: number;
    config: DecisionEngineConfig;
  } {
    return {
      initialized: this.initialized,
      killSwitchActive: this.killSwitchActive,
      consecutiveFailures: this.consecutiveFailures,
      config: { ...this.config },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DecisionEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info('Decision Engine configuration updated', { updates });
  }

  /**
   * Shutdown decision engine
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Decision Engine...');
    this.initialized = false;
    this.killSwitchActive = false;
    this.consecutiveFailures = 0;
    this.removeAllListeners();
    log.info('Decision Engine shutdown complete');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let decisionEngineInstance: DecisionEngine | null = null;

export function getDecisionEngine(config?: Partial<DecisionEngineConfig>): DecisionEngine {
  if (!decisionEngineInstance) {
    decisionEngineInstance = new DecisionEngine(config);
  }
  return decisionEngineInstance;
}

export async function initializeDecisionEngine(config?: Partial<DecisionEngineConfig>): Promise<DecisionEngine> {
  const engine = getDecisionEngine(config);
  await engine.initialize();
  return engine;
}

export default DecisionEngine;
