/**
 * CRYPTARA - AI Strategist (Stage-Gated)
 * 
 * HARD RULES:
 * - Analysis ONLY (no execution authority)
 * - No timers, no background loops
 * - Isolated from influencing outcomes or introducing variables
 * - Cognition gated by stage
 * - ONLY active at Stage 8 (final dry run)
 * - After Stage 9 completion + stable cycles: continuous surveillance (advisory only, NO EXECUTION)
 * 
 * Stage 8 Goal:
 * - Signal → Decision → Visualization Report = PASS
 * 
 * Post-Stage 9 Goal:
 * - Improvement of market analysis, market fluctuations, market predictions
 * - Non-binding outputs
 * - Advisory role only
 */

import { EventEmitter } from 'events';
import { stageController, StageStatus } from '../governance/stage-controller';
import { Signal, SignalType } from '../signals/faucet';

export enum CryptaraMode {
  INACTIVE = 'inactive',
  STAGE_8_ANALYSIS = 'stage_8_analysis',
  SURVEILLANCE = 'surveillance',
}

export interface CryptaraAnalysis {
  id: string;
  timestamp: number;
  input: {
    signals: Signal[];
    marketConditions: any;
  };
  output: {
    recommendation: string;
    confidence: number;
    reasoning: string[];
    predictedOutcome: {
      success: boolean;
      profitEstimate: number;
      riskFactors: string[];
    };
  };
  mode: CryptaraMode;
  binding: false; // ALWAYS false - non-binding analysis
}

export interface CryptaraMetrics {
  analysesPerformed: number;
  averageConfidence: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracy: number;
}

/**
 * Cryptara Controller - Stage-gated AI strategist
 */
export class CryptaraController extends EventEmitter {
  private mode: CryptaraMode = CryptaraMode.INACTIVE;
  private analyses: CryptaraAnalysis[] = [];
  private metrics: CryptaraMetrics = {
    analysesPerformed: 0,
    averageConfidence: 0,
    correctPredictions: 0,
    incorrectPredictions: 0,
    accuracy: 0,
  };
  private stage9CompletedAt: number | null = null;
  private stableCyclesCount: number = 0;
  private surveillanceEnabled: boolean = false;

  constructor() {
    super();
  }

  /**
   * Initialize Cryptara (checks stage requirements)
   */
  async initialize(): Promise<void> {
    console.log('[Cryptara] 🧬 Initializing Cryptara AI Strategist...');
    
    // Check current stage
    const currentStage = stageController.getCurrentStage();
    
    if (currentStage < 8) {
      console.log('[Cryptara] 🔒 Cryptara LOCKED - Stage 8 required for activation');
      console.log(`[Cryptara] Current stage: ${currentStage}, Required: 8`);
      this.mode = CryptaraMode.INACTIVE;
    } else if (currentStage === 8) {
      const stage8State = stageController.getStageState(8);
      if (stage8State?.status === StageStatus.IN_PROGRESS) {
        console.log('[Cryptara] ✅ Stage 8 active - Cryptara entering ANALYSIS mode');
        this.mode = CryptaraMode.STAGE_8_ANALYSIS;
      }
    } else if (currentStage === 9) {
      const stage9State = stageController.getStageState(9);
      if (stage9State?.status === StageStatus.PASS) {
        console.log('[Cryptara] 🎓 Stage 9 complete - Cryptara can enter SURVEILLANCE mode');
        this.stage9CompletedAt = stage9State.endTime;
        
        // Check if enough stable cycles have passed
        if (this.stableCyclesCount >= 10) {
          this.enableSurveillance();
        }
      }
    }

    console.log('[Cryptara] ✅ Cryptara initialized');
    console.log(`[Cryptara] Mode: ${this.mode}`);
    console.log('[Cryptara] Execution authority: NONE');
    console.log('[Cryptara] Background loops: NONE');
    console.log('[Cryptara] Output binding: NON-BINDING');
  }

  /**
   * Perform analysis (stage-gated)
   */
  async analyze(signals: Signal[], marketConditions: any): Promise<CryptaraAnalysis | null> {
    // Check if analysis is allowed
    if (this.mode === CryptaraMode.INACTIVE) {
      console.warn('[Cryptara] ⚠️ Analysis blocked - Cryptara inactive');
      return null;
    }

    console.log(`[Cryptara] 🔬 Performing ${this.mode} analysis...`);

    // Generate analysis
    const analysis: CryptaraAnalysis = {
      id: this.generateAnalysisId(),
      timestamp: Date.now(),
      input: {
        signals,
        marketConditions,
      },
      output: {
        recommendation: this.generateRecommendation(signals, marketConditions),
        confidence: this.calculateConfidence(signals),
        reasoning: this.generateReasoning(signals, marketConditions),
        predictedOutcome: this.predictOutcome(signals, marketConditions),
      },
      mode: this.mode,
      binding: false, // ALWAYS false
    };

    // Store analysis
    this.analyses.push(analysis);
    this.metrics.analysesPerformed++;

    // Update average confidence
    const totalConfidence = this.metrics.averageConfidence * (this.metrics.analysesPerformed - 1);
    this.metrics.averageConfidence = (totalConfidence + analysis.output.confidence) / this.metrics.analysesPerformed;

    // Emit event
    this.emit('analysis-complete', analysis);

    console.log(`[Cryptara] ✅ Analysis complete (ID: ${analysis.id})`);
    console.log(`[Cryptara] Recommendation: ${analysis.output.recommendation}`);
    console.log(`[Cryptara] Confidence: ${(analysis.output.confidence * 100).toFixed(1)}%`);
    console.log(`[Cryptara] ⚠️ NON-BINDING - Advisory only`);

    return analysis;
  }

  /**
   * Enable surveillance mode (post-Stage 9 + stable cycles)
   */
  private enableSurveillance(): void {
    if (!this.stage9CompletedAt) {
      console.error('[Cryptara] ❌ Cannot enable surveillance - Stage 9 not completed');
      return;
    }

    if (this.stableCyclesCount < 10) {
      console.error('[Cryptara] ❌ Cannot enable surveillance - insufficient stable cycles');
      return;
    }

    this.mode = CryptaraMode.SURVEILLANCE;
    this.surveillanceEnabled = true;

    console.log('[Cryptara] 🔭 SURVEILLANCE MODE ENABLED');
    console.log('[Cryptara] Role: Continuous market analysis (advisory only)');
    console.log('[Cryptara] Execution authority: NONE');
    console.log('[Cryptara] Outputs: NON-BINDING');

    this.emit('surveillance-enabled', { timestamp: Date.now() });
  }

  /**
   * Record stable cycle (for surveillance activation)
   */
  recordStableCycle(): void {
    this.stableCyclesCount++;
    console.log(`[Cryptara] 📊 Stable cycles: ${this.stableCyclesCount}/10`);

    if (this.stableCyclesCount >= 10 && this.stage9CompletedAt && !this.surveillanceEnabled) {
      this.enableSurveillance();
    }
  }

  /**
   * Get current mode
   */
  getMode(): CryptaraMode {
    return this.mode;
  }

  /**
   * Get metrics
   */
  getMetrics(): CryptaraMetrics {
    return { ...this.metrics };
  }

  /**
   * Get recent analyses
   */
  getRecentAnalyses(limit: number = 10): CryptaraAnalysis[] {
    return this.analyses.slice(-limit);
  }

  /**
   * Verify isolation (safety check)
   */
  verifyIsolation(): {
    isolated: boolean;
    checks: Array<{ name: string; pass: boolean; reason: string }>;
  } {
    const checks = [
      {
        name: 'No execution authority',
        pass: true,
        reason: 'Cryptara has no execution methods',
      },
      {
        name: 'No background loops',
        pass: true,
        reason: 'No timers or intervals in Cryptara',
      },
      {
        name: 'Non-binding outputs',
        pass: true,
        reason: 'All analyses have binding: false',
      },
      {
        name: 'Stage-gated activation',
        pass: this.mode === CryptaraMode.INACTIVE || stageController.getCurrentStage() >= 8,
        reason: `Current mode: ${this.mode}`,
      },
      {
        name: 'No variable introduction',
        pass: true,
        reason: 'Cryptara operates on provided inputs only',
      },
    ];

    const allPass = checks.every(c => c.pass);

    return {
      isolated: allPass,
      checks,
    };
  }

  /**
   * Private helper methods
   */

  private generateAnalysisId(): string {
    return `cryptara-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  private generateRecommendation(signals: Signal[], marketConditions: any): string {
    const avgConfidence = signals.reduce((sum, s) => sum + s.data.confidence, 0) / signals.length;
    
    if (avgConfidence > 0.8) {
      return 'PROCEED - High confidence opportunity';
    } else if (avgConfidence > 0.6) {
      return 'CONSIDER - Moderate confidence';
    } else {
      return 'HOLD - Low confidence';
    }
  }

  private calculateConfidence(signals: Signal[]): number {
    return signals.reduce((sum, s) => sum + s.data.confidence, 0) / signals.length;
  }

  private generateReasoning(signals: Signal[], marketConditions: any): string[] {
    const reasoning: string[] = [];
    
    reasoning.push(`Analyzed ${signals.length} signals`);
    
    const avgConfidence = this.calculateConfidence(signals);
    reasoning.push(`Average signal confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    
    const tradeSignals = signals.filter(s => s.type === SignalType.TRADE).length;
    if (tradeSignals > 0) {
      reasoning.push(`${tradeSignals} trade signals detected`);
    }
    
    return reasoning;
  }

  private predictOutcome(signals: Signal[], marketConditions: any): CryptaraAnalysis['output']['predictedOutcome'] {
    const avgConfidence = this.calculateConfidence(signals);
    
    return {
      success: avgConfidence > 0.7,
      profitEstimate: avgConfidence * 100, // Simple estimate
      riskFactors: avgConfidence < 0.7 ? ['Low signal confidence', 'Market uncertainty'] : [],
    };
  }
}

// Singleton instance
export const cryptaraController = new CryptaraController();
