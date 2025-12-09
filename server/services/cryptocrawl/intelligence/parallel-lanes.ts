// Multi-Eden Parallel Intelligence Lanes
// 5 parallel lanes for superior synthesis: Order-Flow, Liquidity, Volatility, Bot-Footprint, Latency-Race

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../eden/types.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type LaneType = 
  | 'order-flow'        // Predicts price action in milliseconds
  | 'liquidity'         // Analyzes depth and imbalance
  | 'volatility'        // Micro-forecasting instability
  | 'bot-footprint'     // Detects algo behavioral patterns
  | 'latency-race';     // Finds micro-windows where rivals are slow

export interface LaneSignal {
  id: string;
  lane: LaneType;
  timestamp: number;
  confidence: number;       // 0-1
  direction: 'bullish' | 'bearish' | 'neutral';
  magnitude: number;        // Signal strength 0-100
  chain: ChainId;
  asset?: string;
  metadata: Record<string, any>;
}

export interface MergedDecision {
  id: string;
  timestamp: number;
  signals: LaneSignal[];
  finalDirection: 'long' | 'short' | 'hold';
  confidence: number;
  expectedProfit: number;
  riskScore: number;
  recommendedAction: string;
  executionPriority: number; // 1-100
}

export interface LaneConfig {
  type: LaneType;
  weight: number;           // Weight in final decision (0-1)
  updateIntervalMs: number;
  minConfidenceThreshold: number;
  enabled: boolean;
}

export interface OrderFlowMetrics {
  buyPressure: number;      // 0-1
  sellPressure: number;     // 0-1
  netFlow: number;          // Positive = buying, negative = selling
  volumeProfile: number[];  // Volume at price levels
  largeOrdersDetected: number;
  predictedMoveMs: number;  // Predicted time to price move
}

export interface LiquidityMetrics {
  bidDepth: number;
  askDepth: number;
  imbalanceRatio: number;   // > 1 = more bids, < 1 = more asks
  spreadBps: number;        // Spread in basis points
  thinLiquidityZones: { price: number; size: number }[];
  supportLevels: number[];
  resistanceLevels: number[];
}

export interface VolatilityMetrics {
  currentVol: number;       // Current volatility
  predictedVol: number;     // Predicted volatility
  volTrend: 'increasing' | 'decreasing' | 'stable';
  volatilitySpikes: { timestamp: number; magnitude: number }[];
  microInstabilityScore: number; // 0-100
}

export interface BotFootprintMetrics {
  detectedBots: number;
  botPatterns: { signature: string; frequency: number; lastSeen: number }[];
  predictedBotActions: { action: string; probability: number; timeframeMs: number }[];
  competitorPositioning: { direction: string; strength: number }[];
}

export interface LatencyMetrics {
  selfLatency: number;      // Our current latency
  estimatedCompetitorLatency: number;
  latencyAdvantage: number; // Positive = we're faster
  microWindowsMs: number[]; // Windows where rivals are slow
  optimalExecutionWindow: { start: number; duration: number };
}

// ============================================================================
// LANE CONFIGURATION
// ============================================================================

const DEFAULT_LANE_CONFIGS: Record<LaneType, LaneConfig> = {
  'order-flow': {
    type: 'order-flow',
    weight: 0.25,
    updateIntervalMs: 100,
    minConfidenceThreshold: 0.6,
    enabled: true
  },
  'liquidity': {
    type: 'liquidity',
    weight: 0.20,
    updateIntervalMs: 200,
    minConfidenceThreshold: 0.5,
    enabled: true
  },
  'volatility': {
    type: 'volatility',
    weight: 0.20,
    updateIntervalMs: 500,
    minConfidenceThreshold: 0.5,
    enabled: true
  },
  'bot-footprint': {
    type: 'bot-footprint',
    weight: 0.20,
    updateIntervalMs: 300,
    minConfidenceThreshold: 0.7,
    enabled: true
  },
  'latency-race': {
    type: 'latency-race',
    weight: 0.15,
    updateIntervalMs: 50,
    minConfidenceThreshold: 0.8,
    enabled: true
  }
};

// ============================================================================
// ORDER-FLOW LANE
// ============================================================================

class OrderFlowLane {
  private metrics: OrderFlowMetrics = {
    buyPressure: 0.5,
    sellPressure: 0.5,
    netFlow: 0,
    volumeProfile: [],
    largeOrdersDetected: 0,
    predictedMoveMs: 0
  };

  async analyze(chain: ChainId, asset?: string): Promise<LaneSignal> {
    // Simulate order flow analysis
    const buyPressure = Math.random();
    const sellPressure = Math.random();
    const netFlow = buyPressure - sellPressure;
    
    this.metrics = {
      buyPressure,
      sellPressure,
      netFlow,
      volumeProfile: Array(10).fill(0).map(() => Math.random() * 1000),
      largeOrdersDetected: Math.floor(Math.random() * 5),
      predictedMoveMs: Math.random() * 500 + 50
    };

    const confidence = Math.abs(netFlow) * 0.8 + 0.2;
    const direction = netFlow > 0.1 ? 'bullish' : netFlow < -0.1 ? 'bearish' : 'neutral';

    return {
      id: `of-${Date.now()}-${randomUUID().split('-')[0]}`,
      lane: 'order-flow',
      timestamp: Date.now(),
      confidence: Math.min(1, confidence),
      direction,
      magnitude: Math.abs(netFlow) * 100,
      chain,
      asset,
      metadata: { ...this.metrics }
    };
  }

  getMetrics(): OrderFlowMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// LIQUIDITY LANE
// ============================================================================

class LiquidityLane {
  private metrics: LiquidityMetrics = {
    bidDepth: 0,
    askDepth: 0,
    imbalanceRatio: 1,
    spreadBps: 0,
    thinLiquidityZones: [],
    supportLevels: [],
    resistanceLevels: []
  };

  async analyze(chain: ChainId, asset?: string): Promise<LaneSignal> {
    // Simulate liquidity analysis
    const bidDepth = Math.random() * 1000000;
    const askDepth = Math.random() * 1000000;
    const imbalanceRatio = bidDepth / Math.max(askDepth, 1);
    
    this.metrics = {
      bidDepth,
      askDepth,
      imbalanceRatio,
      spreadBps: Math.random() * 50 + 1,
      thinLiquidityZones: Array(3).fill(0).map(() => ({
        price: Math.random() * 1000,
        size: Math.random() * 10000
      })),
      supportLevels: [Math.random() * 100, Math.random() * 100],
      resistanceLevels: [Math.random() * 100 + 100, Math.random() * 100 + 100]
    };

    // High imbalance = stronger signal
    const confidence = Math.min(1, Math.abs(imbalanceRatio - 1) + 0.3);
    const direction = imbalanceRatio > 1.2 ? 'bullish' : imbalanceRatio < 0.8 ? 'bearish' : 'neutral';

    return {
      id: `liq-${Date.now()}-${randomUUID().split('-')[0]}`,
      lane: 'liquidity',
      timestamp: Date.now(),
      confidence,
      direction,
      magnitude: Math.abs(imbalanceRatio - 1) * 50,
      chain,
      asset,
      metadata: { ...this.metrics }
    };
  }

  getMetrics(): LiquidityMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// VOLATILITY LANE
// ============================================================================

class VolatilityLane {
  private metrics: VolatilityMetrics = {
    currentVol: 0,
    predictedVol: 0,
    volTrend: 'stable',
    volatilitySpikes: [],
    microInstabilityScore: 0
  };
  
  private volHistory: number[] = [];

  async analyze(chain: ChainId, asset?: string): Promise<LaneSignal> {
    // Simulate volatility analysis
    const currentVol = Math.random() * 0.5;
    const predictedVol = currentVol + (Math.random() - 0.5) * 0.2;
    
    this.volHistory.push(currentVol);
    if (this.volHistory.length > 20) this.volHistory.shift();
    
    const avgVol = this.volHistory.reduce((a, b) => a + b, 0) / this.volHistory.length;
    const volTrend = predictedVol > avgVol * 1.1 ? 'increasing' : 
                     predictedVol < avgVol * 0.9 ? 'decreasing' : 'stable';

    this.metrics = {
      currentVol,
      predictedVol,
      volTrend,
      volatilitySpikes: predictedVol > 0.3 ? [{ timestamp: Date.now(), magnitude: predictedVol * 100 }] : [],
      microInstabilityScore: Math.min(100, predictedVol * 200)
    };

    // High volatility = opportunity (but also risk)
    const confidence = Math.min(1, Math.abs(predictedVol - currentVol) * 5 + 0.4);
    const direction = volTrend === 'increasing' ? 'bullish' : 
                     volTrend === 'decreasing' ? 'bearish' : 'neutral';

    return {
      id: `vol-${Date.now()}-${randomUUID().split('-')[0]}`,
      lane: 'volatility',
      timestamp: Date.now(),
      confidence,
      direction,
      magnitude: this.metrics.microInstabilityScore,
      chain,
      asset,
      metadata: { ...this.metrics }
    };
  }

  getMetrics(): VolatilityMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// BOT FOOTPRINT LANE
// ============================================================================

class BotFootprintLane {
  private metrics: BotFootprintMetrics = {
    detectedBots: 0,
    botPatterns: [],
    predictedBotActions: [],
    competitorPositioning: []
  };

  private knownSignatures: Map<string, { frequency: number; lastSeen: number }> = new Map();

  async analyze(chain: ChainId, asset?: string): Promise<LaneSignal> {
    // Simulate bot detection and pattern analysis
    const detectedBots = Math.floor(Math.random() * 10) + 1;
    
    // Update known signatures
    const newSignature = `bot-${Math.floor(Math.random() * 100)}`;
    const existing = this.knownSignatures.get(newSignature);
    if (existing) {
      this.knownSignatures.set(newSignature, {
        frequency: existing.frequency + 1,
        lastSeen: Date.now()
      });
    } else {
      this.knownSignatures.set(newSignature, {
        frequency: 1,
        lastSeen: Date.now()
      });
    }

    const botPatterns = Array.from(this.knownSignatures.entries())
      .slice(0, 5)
      .map(([signature, data]) => ({
        signature,
        frequency: data.frequency,
        lastSeen: data.lastSeen
      }));

    // Predict bot actions based on patterns
    const predictedBotActions = botPatterns.map(p => ({
      action: Math.random() > 0.5 ? 'buy' : 'sell',
      probability: Math.random() * 0.4 + 0.3,
      timeframeMs: Math.random() * 1000 + 100
    }));

    this.metrics = {
      detectedBots,
      botPatterns,
      predictedBotActions,
      competitorPositioning: [
        { direction: 'long', strength: Math.random() },
        { direction: 'short', strength: Math.random() }
      ]
    };

    // Calculate net bot direction
    const longStrength = this.metrics.competitorPositioning.find(c => c.direction === 'long')?.strength || 0;
    const shortStrength = this.metrics.competitorPositioning.find(c => c.direction === 'short')?.strength || 0;
    const netBotDirection = longStrength - shortStrength;

    const confidence = Math.min(1, detectedBots * 0.1 + 0.2);
    // We want to front-run bots - go opposite direction
    const direction = netBotDirection > 0.2 ? 'bearish' : netBotDirection < -0.2 ? 'bullish' : 'neutral';

    return {
      id: `bot-${Date.now()}-${randomUUID().split('-')[0]}`,
      lane: 'bot-footprint',
      timestamp: Date.now(),
      confidence,
      direction,
      magnitude: detectedBots * 10,
      chain,
      asset,
      metadata: { ...this.metrics }
    };
  }

  getMetrics(): BotFootprintMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// LATENCY RACE LANE
// ============================================================================

class LatencyRaceLane {
  private metrics: LatencyMetrics = {
    selfLatency: 0,
    estimatedCompetitorLatency: 0,
    latencyAdvantage: 0,
    microWindowsMs: [],
    optimalExecutionWindow: { start: 0, duration: 0 }
  };

  private latencyHistory: number[] = [];

  async analyze(chain: ChainId, asset?: string): Promise<LaneSignal> {
    // Simulate latency measurement and competitor estimation
    const selfLatency = Math.random() * 50 + 10; // 10-60ms
    const estimatedCompetitorLatency = Math.random() * 100 + 20; // 20-120ms
    const latencyAdvantage = estimatedCompetitorLatency - selfLatency;

    this.latencyHistory.push(selfLatency);
    if (this.latencyHistory.length > 100) this.latencyHistory.shift();

    // Find micro-windows where we have advantage
    const microWindowsMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (Math.random() > 0.5) {
        microWindowsMs.push(Math.random() * 100 + 20);
      }
    }

    // Calculate optimal execution window
    const avgLatency = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
    const optimalWindow = {
      start: Date.now() + Math.floor(avgLatency / 2),
      duration: Math.max(10, Math.floor(latencyAdvantage))
    };

    this.metrics = {
      selfLatency,
      estimatedCompetitorLatency,
      latencyAdvantage,
      microWindowsMs,
      optimalExecutionWindow: optimalWindow
    };

    // High latency advantage = high confidence we can execute first
    const confidence = Math.min(1, latencyAdvantage / 100 + 0.3);
    const direction = latencyAdvantage > 20 ? 'bullish' : 'neutral'; // We can execute, so bullish on opportunity

    return {
      id: `lat-${Date.now()}-${randomUUID().split('-')[0]}`,
      lane: 'latency-race',
      timestamp: Date.now(),
      confidence,
      direction,
      magnitude: Math.max(0, latencyAdvantage),
      chain,
      asset,
      metadata: { ...this.metrics }
    };
  }

  getMetrics(): LatencyMetrics {
    return { ...this.metrics };
  }
}

// ============================================================================
// PARALLEL INTELLIGENCE ENGINE
// ============================================================================

export class ParallelIntelligenceLanes {
  private orderFlowLane: OrderFlowLane;
  private liquidityLane: LiquidityLane;
  private volatilityLane: VolatilityLane;
  private botFootprintLane: BotFootprintLane;
  private latencyRaceLane: LatencyRaceLane;
  
  private laneConfigs: Map<LaneType, LaneConfig> = new Map();
  private recentSignals: LaneSignal[] = [];
  private recentDecisions: MergedDecision[] = [];
  private isRunning: boolean = false;
  private updateIntervals: Map<LaneType, NodeJS.Timeout> = new Map();

  constructor() {
    this.orderFlowLane = new OrderFlowLane();
    this.liquidityLane = new LiquidityLane();
    this.volatilityLane = new VolatilityLane();
    this.botFootprintLane = new BotFootprintLane();
    this.latencyRaceLane = new LatencyRaceLane();

    // Initialize lane configs
    for (const [type, config] of Object.entries(DEFAULT_LANE_CONFIGS)) {
      this.laneConfigs.set(type as LaneType, config);
    }
  }

  /**
   * Start all intelligence lanes
   */
  start(): void {
    if (this.isRunning) return;

    logger.info('Starting Parallel Intelligence Lanes', {
      component: 'ParallelIntelligenceLanes'
    });

    this.isRunning = true;

    // Start each lane with its configured interval
    for (const [type, config] of Array.from(this.laneConfigs.entries())) {
      if (!config.enabled) continue;

      const interval = setInterval(() => {
        this.runLane(type, 'polygon'); // Default chain
      }, config.updateIntervalMs);

      this.updateIntervals.set(type, interval);
    }

    logger.info('Parallel Intelligence Lanes started', {
      component: 'ParallelIntelligenceLanes',
      lanes: Array.from(this.laneConfigs.keys()).filter(t => this.laneConfigs.get(t)?.enabled)
    });
  }

  /**
   * Stop all intelligence lanes
   */
  stop(): void {
    if (!this.isRunning) return;

    logger.info('Stopping Parallel Intelligence Lanes', {
      component: 'ParallelIntelligenceLanes'
    });

    for (const interval of Array.from(this.updateIntervals.values())) {
      clearInterval(interval);
    }
    this.updateIntervals.clear();
    this.isRunning = false;
  }

  /**
   * Run a specific lane and collect signal
   */
  private async runLane(type: LaneType, chain: ChainId, asset?: string): Promise<LaneSignal | null> {
    try {
      let signal: LaneSignal;

      switch (type) {
        case 'order-flow':
          signal = await this.orderFlowLane.analyze(chain, asset);
          break;
        case 'liquidity':
          signal = await this.liquidityLane.analyze(chain, asset);
          break;
        case 'volatility':
          signal = await this.volatilityLane.analyze(chain, asset);
          break;
        case 'bot-footprint':
          signal = await this.botFootprintLane.analyze(chain, asset);
          break;
        case 'latency-race':
          signal = await this.latencyRaceLane.analyze(chain, asset);
          break;
        default:
          return null;
      }

      // Store signal
      this.recentSignals.push(signal);
      if (this.recentSignals.length > 1000) {
        this.recentSignals = this.recentSignals.slice(-500);
      }

      return signal;
    } catch (error) {
      logger.error('Lane analysis error', {
        component: 'ParallelIntelligenceLanes',
        lane: type,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get merged decision from all lanes
   */
  async getMergedDecision(chain: ChainId, asset?: string): Promise<MergedDecision> {
    // Run all lanes in parallel
    const [orderFlow, liquidity, volatility, botFootprint, latencyRace] = await Promise.all([
      this.runLane('order-flow', chain, asset),
      this.runLane('liquidity', chain, asset),
      this.runLane('volatility', chain, asset),
      this.runLane('bot-footprint', chain, asset),
      this.runLane('latency-race', chain, asset)
    ]);

    const signals = [orderFlow, liquidity, volatility, botFootprint, latencyRace].filter(Boolean) as LaneSignal[];

    // Calculate weighted direction
    let weightedBullish = 0;
    let weightedBearish = 0;
    let totalWeight = 0;
    let totalConfidence = 0;

    for (const signal of signals) {
      const config = this.laneConfigs.get(signal.lane);
      if (!config || signal.confidence < config.minConfidenceThreshold) continue;

      const weight = config.weight * signal.confidence;
      totalWeight += weight;
      totalConfidence += signal.confidence;

      if (signal.direction === 'bullish') {
        weightedBullish += weight * signal.magnitude;
      } else if (signal.direction === 'bearish') {
        weightedBearish += weight * signal.magnitude;
      }
    }

    // Determine final direction
    const netDirection = totalWeight > 0 ? (weightedBullish - weightedBearish) / totalWeight : 0;
    const finalDirection = netDirection > 10 ? 'long' : netDirection < -10 ? 'short' : 'hold';

    // Calculate confidence
    const avgConfidence = signals.length > 0 ? totalConfidence / signals.length : 0;

    // Calculate risk score (higher volatility = higher risk)
    const volMetrics = this.volatilityLane.getMetrics();
    const riskScore = Math.min(100, volMetrics.microInstabilityScore + 20);

    // Calculate expected profit
    const latencyMetrics = this.latencyRaceLane.getMetrics();
    const expectedProfit = latencyMetrics.latencyAdvantage > 0 
      ? Math.abs(netDirection) * 0.001 // 0.1% per 100 magnitude units
      : Math.abs(netDirection) * 0.0005;

    // Determine recommended action
    let recommendedAction = 'wait';
    if (finalDirection !== 'hold' && avgConfidence > 0.6) {
      recommendedAction = finalDirection === 'long' ? 'buy' : 'sell';
    }

    const decision: MergedDecision = {
      id: `dec-${Date.now()}-${randomUUID().split('-')[0]}`,
      timestamp: Date.now(),
      signals,
      finalDirection,
      confidence: avgConfidence,
      expectedProfit,
      riskScore,
      recommendedAction,
      executionPriority: Math.floor(avgConfidence * 100)
    };

    // Store decision
    this.recentDecisions.push(decision);
    if (this.recentDecisions.length > 100) {
      this.recentDecisions = this.recentDecisions.slice(-50);
    }

    logger.debug('Merged decision calculated', {
      component: 'ParallelIntelligenceLanes',
      direction: finalDirection,
      confidence: avgConfidence.toFixed(2),
      action: recommendedAction
    });

    return decision;
  }

  /**
   * Get latest signals from all lanes
   */
  getLatestSignals(): LaneSignal[] {
    const latest: LaneSignal[] = [];
    const laneTypes: LaneType[] = ['order-flow', 'liquidity', 'volatility', 'bot-footprint', 'latency-race'];

    for (const type of laneTypes) {
      const signal = this.recentSignals
        .filter(s => s.lane === type)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      
      if (signal) latest.push(signal);
    }

    return latest;
  }

  /**
   * Get lane metrics
   */
  getLaneMetrics(lane: LaneType): any {
    switch (lane) {
      case 'order-flow':
        return this.orderFlowLane.getMetrics();
      case 'liquidity':
        return this.liquidityLane.getMetrics();
      case 'volatility':
        return this.volatilityLane.getMetrics();
      case 'bot-footprint':
        return this.botFootprintLane.getMetrics();
      case 'latency-race':
        return this.latencyRaceLane.getMetrics();
      default:
        return null;
    }
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 10): MergedDecision[] {
    return this.recentDecisions.slice(-limit);
  }

  /**
   * Update lane configuration
   */
  updateLaneConfig(lane: LaneType, config: Partial<LaneConfig>): void {
    const existing = this.laneConfigs.get(lane);
    if (existing) {
      this.laneConfigs.set(lane, { ...existing, ...config });
      
      // Restart lane if running
      if (this.isRunning && config.updateIntervalMs !== undefined) {
        const existingInterval = this.updateIntervals.get(lane);
        if (existingInterval) {
          clearInterval(existingInterval);
        }
        
        if (this.laneConfigs.get(lane)?.enabled) {
          const newInterval = setInterval(() => {
            this.runLane(lane, 'polygon');
          }, config.updateIntervalMs);
          this.updateIntervals.set(lane, newInterval);
        }
      }
    }
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    isRunning: boolean;
    activeLanes: number;
    totalSignals: number;
    totalDecisions: number;
    avgDecisionConfidence: number;
  } {
    const activeLanes = Array.from(this.laneConfigs.values()).filter(c => c.enabled).length;
    const avgConfidence = this.recentDecisions.length > 0
      ? this.recentDecisions.reduce((sum, d) => sum + d.confidence, 0) / this.recentDecisions.length
      : 0;

    return {
      isRunning: this.isRunning,
      activeLanes,
      totalSignals: this.recentSignals.length,
      totalDecisions: this.recentDecisions.length,
      avgDecisionConfidence: avgConfidence
    };
  }

  /**
   * Reset all data
   */
  reset(): void {
    this.stop();
    this.recentSignals = [];
    this.recentDecisions = [];
  }
}

// Singleton instance
export const parallelIntelligence = new ParallelIntelligenceLanes();
