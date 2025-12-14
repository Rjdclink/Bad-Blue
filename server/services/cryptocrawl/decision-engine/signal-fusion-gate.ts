/**
 * SIGNAL FUSION GATE
 * 
 * Multi-source agreement mechanism for signal fusion.
 * Ensures signals from multiple sources agree before proceeding.
 */

import { createLogger } from '../../../logger';
import type { SignalInput } from './index';

const log = createLogger('SignalFusionGate');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface SignalFusionConfig {
  minSourceAgreement: number;      // Minimum number of sources that must agree
  agreementThreshold: number;      // Minimum confidence for agreement (0-1)
  enableWeightedFusion: boolean;    // Use weighted fusion vs simple majority
}

export interface FusedSignal {
  opportunity?: {
    asset: string;
    pair?: string;
    chain: string;
    profitEstimate: number;
    confidence: number;
    timestamp: number;
    sources: string[];
  };
  pattern?: {
    type: string;
    confidence: number;
    description: string;
    sources: string[];
  };
  prediction?: {
    asset: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    timeframe: string;
    sources: string[];
  };
  marketData?: {
    volatility: number;
    liquidityScore: number;
    gasVolatility: number;
    competitorDensity: number;
    networkCongestion: number;
    sources: string[];
  };
  fusedConfidence: number;
  sourceCount: number;
  agreementCount: number;
}

export interface SignalFusionResult {
  passed: boolean;
  confidence: number;
  reason: string;
  agreementCount: number;
  fusedSignal?: FusedSignal;
}

// ============================================================================
// SIGNAL FUSION GATE CLASS
// ============================================================================

export class SignalFusionGate {
  private config: SignalFusionConfig;
  private initialized: boolean = false;

  constructor(config: SignalFusionConfig) {
    this.config = config;
    log.info('Signal Fusion Gate created', { config });
  }

  /**
   * Initialize the gate
   */
  async initialize(): Promise<void> {
    this.initialized = true;
    log.info('Signal Fusion Gate initialized');
  }

  /**
   * Fuse signals from multiple sources and check for agreement
   */
  async fuseSignals(signals: SignalInput[]): Promise<SignalFusionResult> {
    if (!this.initialized) {
      throw new Error('Signal Fusion Gate not initialized');
    }

    if (signals.length === 0) {
      return {
        passed: false,
        confidence: 0,
        reason: 'No signals provided',
        agreementCount: 0,
      };
    }

    if (signals.length < this.config.minSourceAgreement) {
      return {
        passed: false,
        confidence: 0,
        reason: `Insufficient sources: ${signals.length} < ${this.config.minSourceAgreement}`,
        agreementCount: signals.length,
      };
    }

    // Group signals by type and find agreements
    const opportunitySignals = signals.filter(s => s.signal.opportunity);
    const patternSignals = signals.filter(s => s.signal.pattern);
    const predictionSignals = signals.filter(s => s.signal.prediction);
    const marketDataSignals = signals.filter(s => s.signal.marketData);

    let fusedSignal: FusedSignal | undefined;
    let agreementCount = 0;
    let overallConfidence = 0;

    // Fuse opportunities
    if (opportunitySignals.length >= this.config.minSourceAgreement) {
      const fused = this.fuseOpportunities(opportunitySignals);
      if (fused.confidence >= this.config.agreementThreshold) {
        fusedSignal = { ...fusedSignal, opportunity: fused.opportunity };
        agreementCount += fused.agreementCount;
        overallConfidence += fused.confidence;
      }
    }

    // Fuse patterns
    if (patternSignals.length >= this.config.minSourceAgreement) {
      const fused = this.fusePatterns(patternSignals);
      if (fused.confidence >= this.config.agreementThreshold) {
        fusedSignal = { ...fusedSignal, pattern: fused.pattern };
        agreementCount += fused.agreementCount;
        overallConfidence += fused.confidence;
      }
    }

    // Fuse predictions
    if (predictionSignals.length >= this.config.minSourceAgreement) {
      const fused = this.fusePredictions(predictionSignals);
      if (fused.confidence >= this.config.agreementThreshold) {
        fusedSignal = { ...fusedSignal, prediction: fused.prediction };
        agreementCount += fused.agreementCount;
        overallConfidence += fused.confidence;
      }
    }

    // Fuse market data
    if (marketDataSignals.length >= this.config.minSourceAgreement) {
      const fused = this.fuseMarketData(marketDataSignals);
      if (fused.confidence >= this.config.agreementThreshold) {
        fusedSignal = { ...fusedSignal, marketData: fused.marketData };
        agreementCount += fused.agreementCount;
        overallConfidence += fused.confidence;
      }
    }

    // Calculate overall confidence
    const signalTypeCount = [
      opportunitySignals.length > 0 ? 1 : 0,
      patternSignals.length > 0 ? 1 : 0,
      predictionSignals.length > 0 ? 1 : 0,
      marketDataSignals.length > 0 ? 1 : 0,
    ].reduce((a, b) => a + b, 0);

    const finalConfidence = signalTypeCount > 0 ? overallConfidence / signalTypeCount : 0;

    // Check if we have minimum agreement
    const passed = agreementCount >= this.config.minSourceAgreement && 
                   finalConfidence >= this.config.agreementThreshold;

    if (fusedSignal) {
      fusedSignal.fusedConfidence = finalConfidence;
      fusedSignal.sourceCount = signals.length;
      fusedSignal.agreementCount = agreementCount;
    }

    return {
      passed,
      confidence: finalConfidence,
      reason: passed 
        ? `Agreement reached: ${agreementCount} sources agree with confidence ${finalConfidence.toFixed(3)}`
        : `Insufficient agreement: ${agreementCount} sources agree (need ${this.config.minSourceAgreement}), confidence ${finalConfidence.toFixed(3)} (need ${this.config.agreementThreshold})`,
      agreementCount,
      fusedSignal,
    };
  }

  /**
   * Fuse opportunity signals
   */
  private fuseOpportunities(signals: SignalInput[]): {
    opportunity: FusedSignal['opportunity'];
    confidence: number;
    agreementCount: number;
  } {
    const opportunities = signals.map(s => s.signal.opportunity!);
    
    // Group by asset and chain
    const grouped = new Map<string, typeof opportunities>();
    for (const opp of opportunities) {
      const key = `${opp.chain}:${opp.asset}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(opp);
    }

    // Find the group with most agreement
    let bestGroup: typeof opportunities = [];
    let maxAgreement = 0;

    for (const [key, group] of grouped.entries()) {
      if (group.length >= this.config.minSourceAgreement) {
        // Check if profit estimates are similar (within 20%)
        const avgProfit = group.reduce((sum, o) => sum + o.profitEstimate, 0) / group.length;
        const agreeing = group.filter(o => 
          Math.abs(o.profitEstimate - avgProfit) / avgProfit < 0.2
        );

        if (agreeing.length > maxAgreement) {
          maxAgreement = agreeing.length;
          bestGroup = agreeing;
        }
      }
    }

    if (bestGroup.length < this.config.minSourceAgreement) {
      return { opportunity: undefined, confidence: 0, agreementCount: 0 };
    }

    // Weighted average fusion
    const totalWeight = bestGroup.reduce((sum, o) => sum + o.confidence, 0);
    const weightedProfit = bestGroup.reduce((sum, o) => 
      sum + o.profitEstimate * o.confidence, 0
    ) / totalWeight;
    const weightedConfidence = totalWeight / bestGroup.length;

    return {
      opportunity: {
        asset: bestGroup[0].asset,
        pair: bestGroup[0].pair,
        chain: bestGroup[0].chain,
        profitEstimate: weightedProfit,
        confidence: weightedConfidence,
        timestamp: Math.max(...bestGroup.map(o => o.timestamp)),
        sources: signals.filter(s => bestGroup.includes(s.signal.opportunity!)).map(s => s.sourceId),
      },
      confidence: weightedConfidence,
      agreementCount: bestGroup.length,
    };
  }

  /**
   * Fuse pattern signals
   */
  private fusePatterns(signals: SignalInput[]): {
    pattern: FusedSignal['pattern'];
    confidence: number;
    agreementCount: number;
  } {
    const patterns = signals.map(s => s.signal.pattern!);
    
    // Group by pattern type
    const grouped = new Map<string, typeof patterns>();
    for (const pattern of patterns) {
      if (!grouped.has(pattern.type)) {
        grouped.set(pattern.type, []);
      }
      grouped.get(pattern.type)!.push(pattern);
    }

    // Find pattern type with most agreement
    let bestPattern: typeof patterns[0] | undefined;
    let maxAgreement = 0;

    for (const [type, group] of grouped.entries()) {
      if (group.length >= this.config.minSourceAgreement) {
        const avgConfidence = group.reduce((sum, p) => sum + p.confidence, 0) / group.length;
        
        if (group.length > maxAgreement) {
          maxAgreement = group.length;
          bestPattern = {
            type,
            confidence: avgConfidence,
            description: group[0].description,
            sources: signals.filter(s => s.signal.pattern?.type === type).map(s => s.sourceId),
          };
        }
      }
    }

    if (!bestPattern || maxAgreement < this.config.minSourceAgreement) {
      return { pattern: undefined, confidence: 0, agreementCount: 0 };
    }

    return {
      pattern: bestPattern,
      confidence: bestPattern.confidence,
      agreementCount: maxAgreement,
    };
  }

  /**
   * Fuse prediction signals
   */
  private fusePredictions(signals: SignalInput[]): {
    prediction: FusedSignal['prediction'];
    confidence: number;
    agreementCount: number;
  } {
    const predictions = signals.map(s => s.signal.prediction!);
    
    // Group by asset and direction
    const grouped = new Map<string, typeof predictions>();
    for (const pred of predictions) {
      const key = `${pred.asset}:${pred.direction}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(pred);
    }

    // Find prediction with most agreement
    let bestPrediction: typeof predictions[0] | undefined;
    let maxAgreement = 0;

    for (const [key, group] of grouped.entries()) {
      if (group.length >= this.config.minSourceAgreement) {
        const avgConfidence = group.reduce((sum, p) => sum + p.confidence, 0) / group.length;
        
        if (group.length > maxAgreement) {
          maxAgreement = group.length;
          bestPrediction = {
            asset: group[0].asset,
            direction: group[0].direction,
            confidence: avgConfidence,
            timeframe: group[0].timeframe,
            sources: signals.filter(s => {
              const p = s.signal.prediction;
              return p && p.asset === group[0].asset && p.direction === group[0].direction;
            }).map(s => s.sourceId),
          };
        }
      }
    }

    if (!bestPrediction || maxAgreement < this.config.minSourceAgreement) {
      return { prediction: undefined, confidence: 0, agreementCount: 0 };
    }

    return {
      prediction: bestPrediction,
      confidence: bestPrediction.confidence,
      agreementCount: maxAgreement,
    };
  }

  /**
   * Fuse market data signals
   */
  private fuseMarketData(signals: SignalInput[]): {
    marketData: FusedSignal['marketData'];
    confidence: number;
    agreementCount: number;
  } {
    const marketDataArray = signals.map(s => s.signal.marketData!);
    
    // Weighted average fusion
    const totalWeight = marketDataArray.length;
    const fused = {
      volatility: marketDataArray.reduce((sum, m) => sum + m.volatility, 0) / totalWeight,
      liquidityScore: marketDataArray.reduce((sum, m) => sum + m.liquidityScore, 0) / totalWeight,
      gasVolatility: marketDataArray.reduce((sum, m) => sum + m.gasVolatility, 0) / totalWeight,
      competitorDensity: marketDataArray.reduce((sum, m) => sum + m.competitorDensity, 0) / totalWeight,
      networkCongestion: marketDataArray.reduce((sum, m) => sum + m.networkCongestion, 0) / totalWeight,
      sources: signals.map(s => s.sourceId),
    };

    // Confidence based on agreement (variance check)
    const volatilityVariance = this.calculateVariance(marketDataArray.map(m => m.volatility));
    const liquidityVariance = this.calculateVariance(marketDataArray.map(m => m.liquidityScore));
    const confidence = Math.max(0, 1 - (volatilityVariance + liquidityVariance) / 2);

    return {
      marketData: fused,
      confidence,
      agreementCount: marketDataArray.length,
    };
  }

  /**
   * Calculate variance of an array
   */
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return variance;
  }
}
