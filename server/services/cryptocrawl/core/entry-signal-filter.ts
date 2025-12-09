// Entry Signal Filter - Multi-Indicator Confirmation System
// Implements confirmation signals and threshold requirements before trade entry
// Research-backed: Based on signal processing and ensemble methods

import logger from '../../../logger.js';
import { marketConditionDetector, type MarketConditionLevel } from './market-condition-detector';

export interface SignalSource {
  name: string;
  weight: number;  // Relative importance (0-1)
  type: 'price' | 'volume' | 'momentum' | 'volatility' | 'liquidity';
  reliability: number;  // Historical accuracy (0-1)
}

export interface TradeSignal {
  source: string;
  direction: 'long' | 'short' | 'neutral';
  strength: number;  // 0-1
  confidence: number;  // 0-1
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface FilteredSignal {
  approved: boolean;
  direction: 'long' | 'short' | 'neutral';
  confidence: number;
  consensusStrength: number;
  agreementCount: number;
  requiredAgreement: number;
  reasons: string[];
  signals: TradeSignal[];
  adjustedThreshold: number;
}

export interface FilterConfig {
  // Minimum thresholds
  minConfidence: number;
  minStrength: number;
  minConsensus: number;
  
  // Agreement requirements by market condition
  idealRequiredAgreement: number;
  averageRequiredAgreement: number;
  poorRequiredAgreement: number;
  
  // Time constraints
  signalExpiryMs: number;
  minSignalAge: number;
  
  // Adaptive adjustments
  enableAdaptiveThresholds: boolean;
  volatilityAdjustmentFactor: number;
}

const DEFAULT_CONFIG: FilterConfig = {
  minConfidence: 0.6,
  minStrength: 0.5,
  minConsensus: 0.6,
  
  idealRequiredAgreement: 2,
  averageRequiredAgreement: 3,
  poorRequiredAgreement: 4,
  
  signalExpiryMs: 30000,  // 30 seconds
  minSignalAge: 500,  // Wait 500ms for confirmation
  
  enableAdaptiveThresholds: true,
  volatilityAdjustmentFactor: 0.5,
};

// Pre-defined signal sources
const DEFAULT_SIGNAL_SOURCES: SignalSource[] = [
  { name: 'price_momentum', weight: 0.25, type: 'momentum', reliability: 0.7 },
  { name: 'volume_surge', weight: 0.2, type: 'volume', reliability: 0.65 },
  { name: 'liquidity_depth', weight: 0.2, type: 'liquidity', reliability: 0.75 },
  { name: 'volatility_regime', weight: 0.15, type: 'volatility', reliability: 0.7 },
  { name: 'price_action', weight: 0.2, type: 'price', reliability: 0.65 },
];

class EntrySignalFilter {
  private config: FilterConfig;
  private signalSources: Map<string, SignalSource> = new Map();
  private pendingSignals: Map<string, TradeSignal[]> = new Map();
  private signalHistory: Array<{ signal: FilteredSignal; timestamp: number; outcome?: boolean }> = [];

  constructor(config: Partial<FilterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Register default sources
    for (const source of DEFAULT_SIGNAL_SOURCES) {
      this.signalSources.set(source.name, source);
    }
  }

  /**
   * Register a new signal source
   */
  registerSource(source: SignalSource): void {
    this.signalSources.set(source.name, source);
    logger.debug('Signal source registered', {
      component: 'EntrySignalFilter',
      source: source.name,
    });
  }

  /**
   * Add a signal for an opportunity
   */
  addSignal(opportunityId: string, signal: TradeSignal): void {
    if (!this.pendingSignals.has(opportunityId)) {
      this.pendingSignals.set(opportunityId, []);
    }
    
    // Validate signal source exists
    if (!this.signalSources.has(signal.source)) {
      logger.warn('Unknown signal source', {
        component: 'EntrySignalFilter',
        source: signal.source,
      });
    }
    
    this.pendingSignals.get(opportunityId)!.push(signal);
    
    // Clean expired signals
    this.cleanExpiredSignals(opportunityId);
  }

  /**
   * Evaluate signals for an opportunity
   */
  evaluate(opportunityId: string, marketVolatility?: number): FilteredSignal {
    const signals = this.pendingSignals.get(opportunityId) || [];
    const currentCondition = marketConditionDetector.getCurrentLevel();
    
    // Get required agreement based on market conditions
    const requiredAgreement = this.getRequiredAgreement(currentCondition);
    
    // Calculate adjusted thresholds
    const adjustedThreshold = this.calculateAdjustedThreshold(
      currentCondition, 
      marketVolatility
    );
    
    // Filter valid signals (not expired, meets minimum requirements)
    const validSignals = this.filterValidSignals(signals, adjustedThreshold);
    
    if (validSignals.length === 0) {
      return {
        approved: false,
        direction: 'neutral',
        confidence: 0,
        consensusStrength: 0,
        agreementCount: 0,
        requiredAgreement,
        reasons: ['No valid signals'],
        signals: [],
        adjustedThreshold,
      };
    }

    // Calculate consensus
    const consensus = this.calculateConsensus(validSignals);
    
    // Count agreements in consensus direction
    const agreementCount = validSignals.filter(
      s => s.direction === consensus.direction && s.strength >= adjustedThreshold
    ).length;
    
    // Generate approval reasons
    const reasons: string[] = [];
    
    if (agreementCount < requiredAgreement) {
      reasons.push(`Insufficient agreement: ${agreementCount}/${requiredAgreement}`);
    }
    
    if (consensus.strength < this.config.minStrength) {
      reasons.push(`Consensus strength too low: ${(consensus.strength * 100).toFixed(1)}%`);
    }
    
    if (consensus.confidence < this.config.minConfidence) {
      reasons.push(`Confidence too low: ${(consensus.confidence * 100).toFixed(1)}%`);
    }
    
    if (consensus.consensus < this.config.minConsensus) {
      reasons.push(`Consensus ratio too low: ${(consensus.consensus * 100).toFixed(1)}%`);
    }
    
    // Determine approval
    const approved = 
      agreementCount >= requiredAgreement &&
      consensus.strength >= this.config.minStrength &&
      consensus.confidence >= this.config.minConfidence &&
      consensus.consensus >= this.config.minConsensus;
    
    if (approved) {
      reasons.push('All criteria met');
    }

    const result: FilteredSignal = {
      approved,
      direction: consensus.direction,
      confidence: consensus.confidence,
      consensusStrength: consensus.strength,
      agreementCount,
      requiredAgreement,
      reasons,
      signals: validSignals,
      adjustedThreshold,
    };

    // Record for learning
    this.recordSignalEvaluation(result);

    logger.debug('Signal evaluation', {
      component: 'EntrySignalFilter',
      opportunityId,
      approved,
      direction: consensus.direction,
      agreement: `${agreementCount}/${requiredAgreement}`,
      condition: currentCondition,
    });

    return result;
  }

  /**
   * Get required agreement count based on market condition
   */
  private getRequiredAgreement(condition: MarketConditionLevel): number {
    switch (condition) {
      case 'ideal': return this.config.idealRequiredAgreement;
      case 'average': return this.config.averageRequiredAgreement;
      case 'poor': return this.config.poorRequiredAgreement;
      default: return this.config.averageRequiredAgreement;
    }
  }

  /**
   * Calculate adjusted threshold based on conditions
   */
  private calculateAdjustedThreshold(
    condition: MarketConditionLevel, 
    volatility?: number
  ): number {
    let threshold = this.config.minStrength;
    
    // Increase threshold in worse conditions
    switch (condition) {
      case 'ideal':
        threshold = this.config.minStrength;
        break;
      case 'average':
        threshold = this.config.minStrength * 1.2;
        break;
      case 'poor':
        threshold = this.config.minStrength * 1.5;
        break;
    }
    
    // Adjust for volatility if enabled
    if (this.config.enableAdaptiveThresholds && volatility !== undefined) {
      if (volatility > 0.8) {
        threshold *= (1 + this.config.volatilityAdjustmentFactor);
      }
    }
    
    return Math.min(0.95, threshold);
  }

  /**
   * Filter valid signals
   */
  private filterValidSignals(signals: TradeSignal[], minStrength: number): TradeSignal[] {
    const now = Date.now();
    
    return signals.filter(signal => {
      // Check expiry
      if (now - signal.timestamp > this.config.signalExpiryMs) {
        return false;
      }
      
      // Check minimum age
      if (now - signal.timestamp < this.config.minSignalAge) {
        return false;
      }
      
      // Check minimum strength
      if (signal.strength < minStrength * 0.8) {  // Allow some slack
        return false;
      }
      
      // Check minimum confidence
      if (signal.confidence < this.config.minConfidence * 0.8) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Calculate signal consensus
   */
  private calculateConsensus(signals: TradeSignal[]): {
    direction: 'long' | 'short' | 'neutral';
    strength: number;
    confidence: number;
    consensus: number;
  } {
    if (signals.length === 0) {
      return { direction: 'neutral', strength: 0, confidence: 0, consensus: 0 };
    }

    // Weighted voting
    let longWeight = 0;
    let shortWeight = 0;
    let totalWeight = 0;
    let totalStrength = 0;
    let totalConfidence = 0;

    for (const signal of signals) {
      const source = this.signalSources.get(signal.source);
      const weight = source?.weight || 0.1;
      const reliability = source?.reliability || 0.5;
      
      const effectiveWeight = weight * reliability * signal.confidence;
      
      if (signal.direction === 'long') {
        longWeight += effectiveWeight * signal.strength;
      } else if (signal.direction === 'short') {
        shortWeight += effectiveWeight * signal.strength;
      }
      
      totalWeight += effectiveWeight;
      totalStrength += signal.strength * effectiveWeight;
      totalConfidence += signal.confidence * effectiveWeight;
    }

    // Determine direction
    let direction: 'long' | 'short' | 'neutral' = 'neutral';
    if (longWeight > shortWeight * 1.2) {
      direction = 'long';
    } else if (shortWeight > longWeight * 1.2) {
      direction = 'short';
    }

    // Calculate consensus ratio
    const totalDirectional = longWeight + shortWeight;
    const maxDirectional = Math.max(longWeight, shortWeight);
    const consensus = totalDirectional > 0 ? maxDirectional / totalDirectional : 0;

    return {
      direction,
      strength: totalWeight > 0 ? totalStrength / totalWeight : 0,
      confidence: totalWeight > 0 ? totalConfidence / totalWeight : 0,
      consensus,
    };
  }

  /**
   * Clean expired signals for an opportunity
   */
  private cleanExpiredSignals(opportunityId: string): void {
    const signals = this.pendingSignals.get(opportunityId);
    if (!signals) return;

    const now = Date.now();
    const validSignals = signals.filter(
      s => now - s.timestamp <= this.config.signalExpiryMs
    );
    
    if (validSignals.length !== signals.length) {
      this.pendingSignals.set(opportunityId, validSignals);
    }
  }

  /**
   * Record signal evaluation for learning
   */
  private recordSignalEvaluation(signal: FilteredSignal): void {
    this.signalHistory.push({
      signal,
      timestamp: Date.now(),
    });
    
    // Limit history size
    if (this.signalHistory.length > 1000) {
      this.signalHistory = this.signalHistory.slice(-500);
    }
  }

  /**
   * Record trade outcome for learning
   */
  recordOutcome(opportunityId: string, success: boolean): void {
    // Find most recent signal for this opportunity
    const recentSignal = this.signalHistory
      .filter(h => h.outcome === undefined)
      .pop();
    
    if (recentSignal) {
      recentSignal.outcome = success;
    }

    // Update source reliability based on outcomes
    this.updateSourceReliability();
  }

  /**
   * Update source reliability based on historical performance
   */
  private updateSourceReliability(): void {
    const recentHistory = this.signalHistory.filter(h => h.outcome !== undefined).slice(-100);
    
    if (recentHistory.length < 20) return;  // Need enough data

    // Calculate success rate per source
    const sourcePerformance: Map<string, { correct: number; total: number }> = new Map();
    
    for (const record of recentHistory) {
      for (const signal of record.signal.signals) {
        if (!sourcePerformance.has(signal.source)) {
          sourcePerformance.set(signal.source, { correct: 0, total: 0 });
        }
        
        const perf = sourcePerformance.get(signal.source)!;
        perf.total++;
        
        // Signal was correct if trade was successful and it agreed with consensus
        if (record.outcome && signal.direction === record.signal.direction) {
          perf.correct++;
        }
      }
    }

    // Update reliability scores
    for (const [sourceName, perf] of sourcePerformance) {
      const source = this.signalSources.get(sourceName);
      if (source && perf.total >= 10) {
        const newReliability = perf.correct / perf.total;
        // Blend with existing reliability (exponential smoothing)
        source.reliability = source.reliability * 0.7 + newReliability * 0.3;
        
        logger.debug('Source reliability updated', {
          component: 'EntrySignalFilter',
          source: sourceName,
          reliability: source.reliability.toFixed(3),
          samples: perf.total,
        });
      }
    }
  }

  /**
   * Clear pending signals for an opportunity
   */
  clearSignals(opportunityId: string): void {
    this.pendingSignals.delete(opportunityId);
  }

  /**
   * Get filter statistics
   */
  getStatistics(): {
    totalEvaluations: number;
    approvalRate: number;
    avgConfidence: number;
    sourceReliability: Record<string, number>;
  } {
    const evaluations = this.signalHistory.length;
    const approved = this.signalHistory.filter(h => h.signal.approved).length;
    const avgConfidence = evaluations > 0 
      ? this.signalHistory.reduce((sum, h) => sum + h.signal.confidence, 0) / evaluations 
      : 0;
    
    const sourceReliability: Record<string, number> = {};
    for (const [name, source] of this.signalSources) {
      sourceReliability[name] = source.reliability;
    }

    return {
      totalEvaluations: evaluations,
      approvalRate: evaluations > 0 ? approved / evaluations : 0,
      avgConfidence,
      sourceReliability,
    };
  }

  /**
   * Generate signals from market data (helper for testing)
   */
  static generateSignals(
    opportunityId: string,
    marketData: {
      priceChange: number;
      volumeChange: number;
      liquidityScore: number;
      volatility: number;
    }
  ): TradeSignal[] {
    const signals: TradeSignal[] = [];
    const now = Date.now();
    
    // Price momentum signal
    const priceDirection = marketData.priceChange > 0.01 ? 'long' : 
                          marketData.priceChange < -0.01 ? 'short' : 'neutral';
    signals.push({
      source: 'price_momentum',
      direction: priceDirection as any,
      strength: Math.min(1, Math.abs(marketData.priceChange) * 10),
      confidence: 0.7,
      timestamp: now,
    });
    
    // Volume surge signal
    if (Math.abs(marketData.volumeChange) > 0.5) {
      signals.push({
        source: 'volume_surge',
        direction: marketData.volumeChange > 0 ? 'long' : 'short',
        strength: Math.min(1, Math.abs(marketData.volumeChange)),
        confidence: 0.65,
        timestamp: now,
      });
    }
    
    // Liquidity depth signal
    if (marketData.liquidityScore > 0.7) {
      signals.push({
        source: 'liquidity_depth',
        direction: 'long',  // Good liquidity is supportive
        strength: marketData.liquidityScore,
        confidence: 0.75,
        timestamp: now,
      });
    }
    
    // Volatility regime signal
    const volDirection = marketData.volatility < 0.3 ? 'long' : 
                        marketData.volatility > 0.8 ? 'neutral' : 'neutral';
    signals.push({
      source: 'volatility_regime',
      direction: volDirection as any,
      strength: 1 - marketData.volatility,
      confidence: 0.7,
      timestamp: now,
    });
    
    return signals;
  }

  /**
   * Reset filter state
   */
  reset(): void {
    this.pendingSignals.clear();
    this.signalHistory = [];
    
    // Reset source reliability to defaults
    for (const source of DEFAULT_SIGNAL_SOURCES) {
      this.signalSources.set(source.name, { ...source });
    }
    
    logger.info('Entry signal filter reset', {
      component: 'EntrySignalFilter',
    });
  }
}

// Singleton instance
export const entrySignalFilter = new EntrySignalFilter();
export { EntrySignalFilter };
