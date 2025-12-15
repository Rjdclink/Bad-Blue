/**
 * FAUCET MESH - Multiple Faucets Stitched Together
 * 
 * The Faucet Mesh coordinates multiple faucets to provide:
 * - Cross-venue signal correlation
 * - Cross-pair opportunity detection
 * - Single-feed bias prevention
 * - Signal aggregation and validation
 * 
 * HARD RULES:
 * - Aggregates signals from multiple faucets
 * - No single point of failure
 * - Cross-validates signals
 * - No execution authority
 */

import { EventEmitter } from 'events';
import { Faucet, Signal, SignalType } from './faucet';

export interface MeshNode {
  faucet: Faucet;
  weight: number;
  isHealthy: boolean;
  signalsReceived: number;
}

export interface AggregatedSignal {
  id: string;
  type: SignalType;
  timestamp: number;
  chain: string;
  asset: string;
  pair?: string;
  aggregatedData: {
    price?: number;
    spread?: number;
    momentum?: number;
    imbalance?: number;
    volatility?: number;
    confidence: number;
    agreement: number; // 0-1, how much faucets agree
    sources: number; // number of faucets that contributed
  };
  rawSignals: Signal[];
}

export interface MeshMetrics {
  totalNodes: number;
  healthyNodes: number;
  signalsAggregated: number;
  avgAgreement: number;
  crossVenueOpportunities: number;
  crossPairOpportunities: number;
}

/**
 * Faucet Mesh - Multiple faucets coordination
 */
export class FaucetMesh extends EventEmitter {
  private nodes: Map<string, MeshNode> = new Map();
  private aggregationWindow: number = 1000; // 1 second window
  private pendingSignals: Map<string, Signal[]> = new Map();
  private metrics: MeshMetrics;

  constructor() {
    super();
    this.metrics = {
      totalNodes: 0,
      healthyNodes: 0,
      signalsAggregated: 0,
      avgAgreement: 0,
      crossVenueOpportunities: 0,
      crossPairOpportunities: 0,
    };
  }

  /**
   * Add faucet to mesh
   */
  addFaucet(faucet: Faucet, weight: number = 1.0): void {
    const node: MeshNode = {
      faucet,
      weight,
      isHealthy: true,
      signalsReceived: 0,
    };

    this.nodes.set(faucet.getId(), node);
    this.metrics.totalNodes = this.nodes.size;
    this.metrics.healthyNodes = Array.from(this.nodes.values()).filter(n => n.isHealthy).length;

    // Listen to faucet signals
    faucet.on('signal', (signal: Signal) => {
      this.handleSignal(signal);
    });

    console.log(`[FaucetMesh] ➕ Faucet added: ${faucet.getId()} (weight: ${weight})`);
  }

  /**
   * Remove faucet from mesh
   */
  removeFaucet(faucetId: string): boolean {
    const existed = this.nodes.delete(faucetId);
    
    if (existed) {
      this.metrics.totalNodes = this.nodes.size;
      this.metrics.healthyNodes = Array.from(this.nodes.values()).filter(n => n.isHealthy).length;
      console.log(`[FaucetMesh] ➖ Faucet removed: ${faucetId}`);
    }

    return existed;
  }

  /**
   * Start all faucets in mesh
   */
  startAll(): void {
    for (const node of this.nodes.values()) {
      if (!node.faucet.isRunning()) {
        node.faucet.start();
      }
    }
    console.log(`[FaucetMesh] ▶️ All faucets started (${this.nodes.size} nodes)`);
  }

  /**
   * Stop all faucets in mesh
   */
  stopAll(): void {
    for (const node of this.nodes.values()) {
      if (node.faucet.isRunning()) {
        node.faucet.stop();
      }
    }
    console.log(`[FaucetMesh] ⏹️ All faucets stopped`);
  }

  /**
   * Handle incoming signal
   */
  private handleSignal(signal: Signal): void {
    const key = this.getSignalKey(signal);
    
    // Add to pending signals
    if (!this.pendingSignals.has(key)) {
      this.pendingSignals.set(key, []);
      
      // Schedule aggregation
      setTimeout(() => {
        this.aggregateSignals(key);
      }, this.aggregationWindow);
    }

    this.pendingSignals.get(key)!.push(signal);

    // Update node metrics
    const node = this.nodes.get(signal.source);
    if (node) {
      node.signalsReceived++;
    }
  }

  /**
   * Aggregate signals for a key
   */
  private aggregateSignals(key: string): void {
    const signals = this.pendingSignals.get(key);
    if (!signals || signals.length === 0) {
      this.pendingSignals.delete(key);
      return;
    }

    // Calculate aggregated data
    const aggregated = this.calculateAggregation(signals);
    
    // Emit aggregated signal
    this.emit('aggregated-signal', aggregated);
    this.emit(`aggregated:${aggregated.type}`, aggregated);

    // Update metrics
    this.metrics.signalsAggregated++;
    
    // Update average agreement
    const totalAgreement = this.metrics.avgAgreement * (this.metrics.signalsAggregated - 1);
    this.metrics.avgAgreement = (totalAgreement + aggregated.aggregatedData.agreement) / this.metrics.signalsAggregated;

    // Detect cross-venue opportunities
    if (this.isCrossVenueOpportunity(signals)) {
      this.metrics.crossVenueOpportunities++;
      this.emit('cross-venue-opportunity', aggregated);
    }

    // Detect cross-pair opportunities
    if (this.isCrossPairOpportunity(signals)) {
      this.metrics.crossPairOpportunities++;
      this.emit('cross-pair-opportunity', aggregated);
    }

    // Clean up
    this.pendingSignals.delete(key);
  }

  /**
   * Calculate aggregation
   */
  private calculateAggregation(signals: Signal[]): AggregatedSignal {
    const type = signals[0].type;
    const chain = signals[0].chain;
    const asset = signals[0].asset;
    const pair = signals[0].pair;

    // Weighted average calculation
    let totalWeight = 0;
    let weightedPrice = 0;
    let weightedSpread = 0;
    let weightedMomentum = 0;
    let weightedImbalance = 0;
    let weightedVolatility = 0;
    let weightedConfidence = 0;

    for (const signal of signals) {
      const node = this.nodes.get(signal.source);
      const weight = node?.weight || 1.0;

      totalWeight += weight;
      
      if (signal.data.price) weightedPrice += signal.data.price * weight;
      if (signal.data.spread) weightedSpread += signal.data.spread * weight;
      if (signal.data.momentum) weightedMomentum += signal.data.momentum * weight;
      if (signal.data.imbalance) weightedImbalance += signal.data.imbalance * weight;
      if (signal.data.volatility) weightedVolatility += signal.data.volatility * weight;
      weightedConfidence += signal.data.confidence * weight;
    }

    // Calculate agreement (variance-based)
    const avgConfidence = weightedConfidence / totalWeight;
    const confidenceVariance = signals.reduce((sum, s) => {
      const diff = s.data.confidence - avgConfidence;
      return sum + (diff * diff);
    }, 0) / signals.length;
    const agreement = 1 - Math.min(1, confidenceVariance * 2); // 0-1 scale

    return {
      id: `mesh-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      type,
      timestamp: Date.now(),
      chain,
      asset,
      pair,
      aggregatedData: {
        price: weightedPrice > 0 ? weightedPrice / totalWeight : undefined,
        spread: weightedSpread > 0 ? weightedSpread / totalWeight : undefined,
        momentum: weightedMomentum !== 0 ? weightedMomentum / totalWeight : undefined,
        imbalance: weightedImbalance !== 0 ? weightedImbalance / totalWeight : undefined,
        volatility: weightedVolatility > 0 ? weightedVolatility / totalWeight : undefined,
        confidence: avgConfidence,
        agreement,
        sources: signals.length,
      },
      rawSignals: signals,
    };
  }

  /**
   * Get signal key for aggregation
   */
  private getSignalKey(signal: Signal): string {
    return `${signal.type}-${signal.chain}-${signal.asset}-${signal.pair || 'spot'}`;
  }

  /**
   * Check if signals represent cross-venue opportunity
   */
  private isCrossVenueOpportunity(signals: Signal[]): boolean {
    if (signals.length < 2) return false;

    // Check if signals are from different sources (venues)
    const sources = new Set(signals.map(s => s.source));
    if (sources.size < 2) return false;

    // Check for price discrepancies (spread opportunities)
    const prices = signals.map(s => s.data.price).filter(p => p !== undefined) as number[];
    if (prices.length >= 2) {
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const spreadPercent = ((maxPrice - minPrice) / minPrice) * 100;
      
      // Opportunity if spread > 0.1%
      return spreadPercent > 0.1;
    }

    return false;
  }

  /**
   * Check if signals represent cross-pair opportunity
   */
  private isCrossPairOpportunity(signals: Signal[]): boolean {
    if (signals.length < 2) return false;

    // Check if signals involve different pairs
    const pairs = new Set(signals.map(s => s.pair).filter(p => p !== undefined));
    return pairs.size >= 2;
  }

  /**
   * Get mesh metrics
   */
  getMetrics(): MeshMetrics {
    return { ...this.metrics };
  }

  /**
   * Get all nodes
   */
  getNodes(): MeshNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get mesh health
   */
  getHealth(): { healthy: boolean; healthyNodes: number; totalNodes: number; healthPercentage: number } {
    const healthyNodes = Array.from(this.nodes.values()).filter(n => n.isHealthy).length;
    const totalNodes = this.nodes.size;
    const healthPercentage = totalNodes > 0 ? (healthyNodes / totalNodes) * 100 : 0;

    return {
      healthy: healthPercentage >= 50, // At least 50% nodes must be healthy
      healthyNodes,
      totalNodes,
      healthPercentage,
    };
  }
}

// Singleton instance
export const faucetMesh = new FaucetMesh();
