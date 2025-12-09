// Six Cane System - Complete Swarm Intelligence Architecture
// Cane 1: Market Mapping | Cane 2: Liquidity Vision | Cane 3: Volatility Pulse
// Cane 4: Order-Flow Prediction | Cane 5: Behavioral Bot-Analysis | Cane 6: GRAND ORCHESTRATOR

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../eden/types.js';
import { parallelIntelligence, type LaneSignal, type MergedDecision } from './parallel-lanes.js';
import { gravityCrawler, cataclysmReaper, type CataclysmEvent, type GravityCenter } from './gravity-reaper.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type CaneRole = 
  | 'market-mapping'         // Cane 1: Comprehensive market state
  | 'liquidity-vision'       // Cane 2: Depth analysis & imbalance detection
  | 'volatility-pulse'       // Cane 3: Micro-forecasting instability
  | 'orderflow-prediction'   // Cane 4: Price action prediction
  | 'behavioral-analysis'    // Cane 5: Bot pattern detection
  | 'grand-orchestrator';    // Cane 6: Central coordination

export interface CaneState {
  id: string;
  role: CaneRole;
  status: CaneStatus;
  lastUpdate: number;
  cycleCount: number;
  signals: any[];
  metrics: CaneMetrics;
  subordinates: string[];    // IDs of crawlers/micro-crawlers under this Cane
}

export type CaneStatus = 'active' | 'processing' | 'idle' | 'error' | 'offline';

export interface CaneMetrics {
  signalsGenerated: number;
  successfulPredictions: number;
  avgProcessingTimeMs: number;
  accuracyScore: number;
  resourceUsage: { cpu: number; memory: number };
}

export interface OrchestratorDecision {
  id: string;
  timestamp: number;
  caneInputs: Map<CaneRole, any>;
  finalDecision: 'execute' | 'wait' | 'abort';
  confidence: number;
  priority: number;
  chain: ChainId;
  asset?: string;
  strategy: string;
  expectedProfit: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasoning: string[];
}

export interface SwarmCoordinationState {
  activeCanes: number;
  totalCrawlers: number;
  totalMicroCrawlers: number;
  pendingDecisions: number;
  executingStrategies: number;
  systemLoad: number;
  healthScore: number;
}

// ============================================================================
// CANE BASE CLASS
// ============================================================================

abstract class BaseCane {
  protected id: string;
  protected role: CaneRole;
  protected state: CaneState;
  protected isRunning: boolean = false;
  protected updateInterval: NodeJS.Timeout | null = null;

  constructor(role: CaneRole) {
    this.id = `cane-${role}-${Date.now()}-${randomUUID().split('-')[0]}`;
    this.role = role;
    this.state = {
      id: this.id,
      role,
      status: 'idle',
      lastUpdate: Date.now(),
      cycleCount: 0,
      signals: [],
      metrics: {
        signalsGenerated: 0,
        successfulPredictions: 0,
        avgProcessingTimeMs: 0,
        accuracyScore: 0,
        resourceUsage: { cpu: 0, memory: 0 }
      },
      subordinates: []
    };
  }

  abstract process(chain: ChainId, asset?: string): Promise<any>;

  start(intervalMs: number = 1000): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.state.status = 'active';

    logger.info(`Starting Cane: ${this.role}`, {
      component: 'SixCaneSystem',
      caneId: this.id
    });

    this.updateInterval = setInterval(async () => {
      try {
        await this.process('polygon'); // Default chain
      } catch (error) {
        this.state.status = 'error';
        logger.error(`Cane ${this.role} error`, {
          component: 'SixCaneSystem',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, intervalMs);
  }

  stop(): void {
    if (!this.isRunning) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    this.state.status = 'offline';

    logger.info(`Stopped Cane: ${this.role}`, {
      component: 'SixCaneSystem',
      caneId: this.id
    });
  }

  getState(): CaneState {
    return { ...this.state };
  }

  getId(): string {
    return this.id;
  }

  getRole(): CaneRole {
    return this.role;
  }

  protected updateMetrics(processingTime: number, success: boolean): void {
    const m = this.state.metrics;
    m.signalsGenerated++;
    if (success) m.successfulPredictions++;
    
    // Running average for processing time
    m.avgProcessingTimeMs = (m.avgProcessingTimeMs * (m.signalsGenerated - 1) + processingTime) / m.signalsGenerated;
    
    // Update accuracy
    m.accuracyScore = m.successfulPredictions / m.signalsGenerated;
    
    // Simulated resource usage
    m.resourceUsage = {
      cpu: Math.random() * 0.3 + 0.1,
      memory: Math.random() * 0.2 + 0.1
    };

    this.state.cycleCount++;
    this.state.lastUpdate = Date.now();
  }
}

// ============================================================================
// CANE 1: MARKET MAPPING
// ============================================================================

class MarketMappingCane extends BaseCane {
  constructor() {
    super('market-mapping');
  }

  async process(chain: ChainId, asset?: string): Promise<{
    marketState: string;
    trend: 'up' | 'down' | 'sideways';
    strength: number;
    keyLevels: number[];
  }> {
    const startTime = Date.now();
    this.state.status = 'processing';

    try {
      // Get gravity map for market structure
      const gravityMap = gravityCrawler.getGravityMap(chain);
      
      // Analyze market state
      const trend: 'up' | 'down' | 'sideways' = gravityMap?.overallPull.direction === 'up' ? 'up' :
                   gravityMap?.overallPull.direction === 'down' ? 'down' : 'sideways';
      
      const strength = gravityMap?.overallPull.strength || 0.5;
      const keyLevels = gravityMap?.hotspots.map(h => h.price) || [];

      const result = {
        marketState: this.getMarketStateDescription(trend, strength),
        trend,
        strength,
        keyLevels: keyLevels.slice(0, 5)
      };

      // Store signal
      this.state.signals.push(result);
      if (this.state.signals.length > 100) this.state.signals.shift();

      this.updateMetrics(Date.now() - startTime, true);
      this.state.status = 'active';

      return result;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private getMarketStateDescription(trend: string, strength: number): string {
    if (strength > 0.7) {
      return trend === 'up' ? 'Strong Bullish' : trend === 'down' ? 'Strong Bearish' : 'Consolidating';
    } else if (strength > 0.4) {
      return trend === 'up' ? 'Moderately Bullish' : trend === 'down' ? 'Moderately Bearish' : 'Ranging';
    }
    return 'Uncertain / Low Activity';
  }
}

// ============================================================================
// CANE 2: LIQUIDITY VISION
// ============================================================================

class LiquidityVisionCane extends BaseCane {
  constructor() {
    super('liquidity-vision');
  }

  async process(chain: ChainId, asset?: string): Promise<{
    liquidityScore: number;
    imbalance: 'bid-heavy' | 'ask-heavy' | 'balanced';
    thinZones: number[];
    recommendation: string;
  }> {
    const startTime = Date.now();
    this.state.status = 'processing';

    try {
      // Get liquidity metrics from parallel lanes
      const liquidityMetrics = parallelIntelligence.getLaneMetrics('liquidity');
      
      const imbalanceRatio = liquidityMetrics?.imbalanceRatio || 1;
      const imbalance: 'bid-heavy' | 'ask-heavy' | 'balanced' = imbalanceRatio > 1.2 ? 'bid-heavy' :
                       imbalanceRatio < 0.8 ? 'ask-heavy' : 'balanced';

      const result = {
        liquidityScore: Math.min(100, (liquidityMetrics?.bidDepth || 0 + liquidityMetrics?.askDepth || 0) / 10000),
        imbalance,
        thinZones: (liquidityMetrics?.thinLiquidityZones?.map((z: any) => z.price) || []) as number[],
        recommendation: this.getLiquidityRecommendation(imbalance, liquidityMetrics?.spreadBps || 0)
      };

      this.state.signals.push(result);
      if (this.state.signals.length > 100) this.state.signals.shift();

      this.updateMetrics(Date.now() - startTime, true);
      this.state.status = 'active';

      return result;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private getLiquidityRecommendation(imbalance: string, spreadBps: number): string {
    if (spreadBps > 30) return 'High spread - avoid large orders';
    if (imbalance === 'bid-heavy') return 'Buying pressure - consider long positions';
    if (imbalance === 'ask-heavy') return 'Selling pressure - consider short positions';
    return 'Balanced liquidity - normal execution';
  }
}

// ============================================================================
// CANE 3: VOLATILITY PULSE
// ============================================================================

class VolatilityPulseCane extends BaseCane {
  constructor() {
    super('volatility-pulse');
  }

  async process(chain: ChainId, asset?: string): Promise<{
    currentVol: number;
    predictedVol: number;
    volTrend: string;
    riskLevel: 'low' | 'medium' | 'high';
    tradingMode: string;
  }> {
    const startTime = Date.now();
    this.state.status = 'processing';

    try {
      const volMetrics = parallelIntelligence.getLaneMetrics('volatility');
      
      const currentVol = volMetrics?.currentVol || 0;
      const predictedVol = volMetrics?.predictedVol || 0;
      const volTrend = volMetrics?.volTrend || 'stable';
      
      const riskLevel: 'low' | 'medium' | 'high' = currentVol > 0.3 ? 'high' : currentVol > 0.15 ? 'medium' : 'low';

      const result = {
        currentVol: currentVol * 100,
        predictedVol: predictedVol * 100,
        volTrend,
        riskLevel,
        tradingMode: this.getTradingMode(riskLevel, volTrend)
      };

      this.state.signals.push(result);
      if (this.state.signals.length > 100) this.state.signals.shift();

      this.updateMetrics(Date.now() - startTime, true);
      this.state.status = 'active';

      return result;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private getTradingMode(risk: string, trend: string): string {
    if (risk === 'high' && trend === 'increasing') return 'DEFENSIVE - Reduce positions';
    if (risk === 'high') return 'CAUTIOUS - Tight stops';
    if (risk === 'medium') return 'NORMAL - Standard parameters';
    return 'AGGRESSIVE - Larger positions allowed';
  }
}

// ============================================================================
// CANE 4: ORDER-FLOW PREDICTION
// ============================================================================

class OrderFlowPredictionCane extends BaseCane {
  constructor() {
    super('orderflow-prediction');
  }

  async process(chain: ChainId, asset?: string): Promise<{
    netFlow: number;
    predictedDirection: 'up' | 'down' | 'neutral';
    confidence: number;
    timeToMoveMs: number;
    largeOrders: number;
  }> {
    const startTime = Date.now();
    this.state.status = 'processing';

    try {
      const orderFlowMetrics = parallelIntelligence.getLaneMetrics('order-flow');
      
      const netFlow = orderFlowMetrics?.netFlow || 0;
      const predictedDirection: 'up' | 'down' | 'neutral' = netFlow > 0.1 ? 'up' : netFlow < -0.1 ? 'down' : 'neutral';
      const confidence = Math.abs(netFlow) * 0.8 + 0.2;

      const result = {
        netFlow: netFlow * 100,
        predictedDirection,
        confidence,
        timeToMoveMs: (orderFlowMetrics?.predictedMoveMs || 500) as number,
        largeOrders: (orderFlowMetrics?.largeOrdersDetected || 0) as number
      };

      this.state.signals.push(result);
      if (this.state.signals.length > 100) this.state.signals.shift();

      this.updateMetrics(Date.now() - startTime, true);
      this.state.status = 'active';

      return result;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }
}

// ============================================================================
// CANE 5: BEHAVIORAL BOT-ANALYSIS
// ============================================================================

class BehavioralAnalysisCane extends BaseCane {
  constructor() {
    super('behavioral-analysis');
  }

  async process(chain: ChainId, asset?: string): Promise<{
    detectedBots: number;
    dominantBotStrategy: string;
    predictedBotMove: string;
    counterStrategy: string;
    confidence: number;
  }> {
    const startTime = Date.now();
    this.state.status = 'processing';

    try {
      const botMetrics = parallelIntelligence.getLaneMetrics('bot-footprint');
      
      const detectedBots = botMetrics?.detectedBots || 0;
      const positioning = botMetrics?.competitorPositioning || [];
      
      const longStrength = positioning.find((p: any) => p.direction === 'long')?.strength || 0;
      const shortStrength = positioning.find((p: any) => p.direction === 'short')?.strength || 0;
      
      const dominantBotStrategy = longStrength > shortStrength ? 'Long accumulation' : 
                                  shortStrength > longStrength ? 'Short accumulation' : 'Mixed';
      
      const predictedBotMove = longStrength > shortStrength ? 'Push price up' : 
                               shortStrength > longStrength ? 'Push price down' : 'Unknown';

      const result = {
        detectedBots,
        dominantBotStrategy,
        predictedBotMove,
        counterStrategy: this.getCounterStrategy(dominantBotStrategy),
        confidence: detectedBots > 5 ? 0.7 : detectedBots > 2 ? 0.5 : 0.3
      };

      this.state.signals.push(result);
      if (this.state.signals.length > 100) this.state.signals.shift();

      this.updateMetrics(Date.now() - startTime, true);
      this.state.status = 'active';

      return result;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  private getCounterStrategy(botStrategy: string): string {
    if (botStrategy === 'Long accumulation') {
      return 'Front-run expected pump, position long before breakout';
    }
    if (botStrategy === 'Short accumulation') {
      return 'Front-run expected dump, position short before breakdown';
    }
    return 'Wait for clearer signal';
  }
}

// ============================================================================
// CANE 6: GRAND ORCHESTRATOR
// ============================================================================

class GrandOrchestratorCane extends BaseCane {
  private canes: Map<CaneRole, BaseCane> = new Map();
  private decisions: OrchestratorDecision[] = [];
  private readonly MAX_DECISIONS = 200;

  constructor() {
    super('grand-orchestrator');
  }

  /**
   * Register subordinate Canes
   */
  registerCane(cane: BaseCane): void {
    this.canes.set(cane.getRole(), cane);
    this.state.subordinates.push(cane.getId());
    
    logger.info('Cane registered with Grand Orchestrator', {
      component: 'GrandOrchestrator',
      caneRole: cane.getRole(),
      caneId: cane.getId()
    });
  }

  /**
   * Main orchestration process
   */
  async process(chain: ChainId, asset?: string): Promise<OrchestratorDecision> {
    const startTime = Date.now();
    this.state.status = 'processing';

    try {
      // Gather inputs from all Canes
      const caneInputs = new Map<CaneRole, any>();
      
      for (const [role, cane] of Array.from(this.canes.entries())) {
        const state = cane.getState();
        caneInputs.set(role, state.signals[state.signals.length - 1] || null);
      }

      // Get merged decision from parallel intelligence lanes
      const mergedDecision = await parallelIntelligence.getMergedDecision(chain, asset);

      // Check for active cataclysms
      const activeThreats = cataclysmReaper.getActiveEvents();
      const systemHealth = cataclysmReaper.getSystemHealth();

      // Generate orchestrator decision
      const decision = this.generateDecision(
        caneInputs,
        mergedDecision,
        activeThreats,
        systemHealth,
        chain,
        asset
      );

      // Store decision
      this.decisions.push(decision);
      if (this.decisions.length > this.MAX_DECISIONS) {
        this.decisions.shift();
      }

      this.state.signals.push(decision);
      if (this.state.signals.length > 100) this.state.signals.shift();

      this.updateMetrics(Date.now() - startTime, true);
      this.state.status = 'active';

      logger.debug('Grand Orchestrator decision', {
        component: 'GrandOrchestrator',
        decision: {
          id: decision.id,
          finalDecision: decision.finalDecision,
          confidence: decision.confidence,
          priority: decision.priority
        }
      });

      return decision;
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Generate orchestrated decision
   */
  private generateDecision(
    caneInputs: Map<CaneRole, any>,
    mergedDecision: MergedDecision,
    activeThreats: CataclysmEvent[],
    systemHealth: any,
    chain: ChainId,
    asset?: string
  ): OrchestratorDecision {
    const reasoning: string[] = [];
    let finalDecision: 'execute' | 'wait' | 'abort' = 'wait';
    let confidence = mergedDecision.confidence;
    let priority = mergedDecision.executionPriority;

    // Check market state
    const marketState = caneInputs.get('market-mapping');
    if (marketState) {
      reasoning.push(`Market state: ${marketState.marketState}`);
      if (marketState.strength > 0.6) {
        confidence += 0.1;
        reasoning.push('Strong market trend detected');
      }
    }

    // Check liquidity
    const liquidityState = caneInputs.get('liquidity-vision');
    if (liquidityState) {
      reasoning.push(`Liquidity: ${liquidityState.recommendation}`);
      if (liquidityState.liquidityScore < 30) {
        confidence -= 0.2;
        reasoning.push('Low liquidity warning');
      }
    }

    // Check volatility
    const volState = caneInputs.get('volatility-pulse');
    if (volState) {
      reasoning.push(`Volatility: ${volState.tradingMode}`);
      if (volState.riskLevel === 'high') {
        confidence -= 0.15;
        priority -= 20;
        reasoning.push('High volatility - reduced priority');
      }
    }

    // Check order flow
    const orderFlowState = caneInputs.get('orderflow-prediction');
    if (orderFlowState && orderFlowState.confidence > 0.7) {
      reasoning.push(`Order flow predicts: ${orderFlowState.predictedDirection}`);
      if (orderFlowState.largeOrders > 3) {
        reasoning.push('Multiple large orders detected');
        priority += 10;
      }
    }

    // Check bot analysis
    const botState = caneInputs.get('behavioral-analysis');
    if (botState && botState.confidence > 0.5) {
      reasoning.push(`Bot counter-strategy: ${botState.counterStrategy}`);
    }

    // Check for cataclysms
    if (activeThreats.length > 0) {
      const criticalThreats = activeThreats.filter(t => t.severity === 'critical');
      if (criticalThreats.length > 0) {
        finalDecision = 'abort';
        confidence = 0;
        reasoning.push(`CRITICAL: ${criticalThreats.length} critical threat(s) active - ABORTING`);
      } else {
        confidence -= 0.1 * activeThreats.length;
        reasoning.push(`Warning: ${activeThreats.length} active threat(s)`);
      }
    }

    // Check system health
    if (systemHealth.score < 50) {
      finalDecision = 'abort';
      confidence = 0;
      reasoning.push(`System health critical (${systemHealth.score}) - ABORTING`);
    } else if (systemHealth.score < 80) {
      confidence -= 0.1;
      reasoning.push(`System health degraded (${systemHealth.score})`);
    }

    // Make final decision
    if (finalDecision !== 'abort') {
      if (confidence > 0.7 && priority > 60 && mergedDecision.finalDirection !== 'hold') {
        finalDecision = 'execute';
        reasoning.push('All systems go - executing');
      } else {
        finalDecision = 'wait';
        reasoning.push('Conditions not optimal - waiting');
      }
    }

    // Determine risk level
    const riskLevel = volState?.riskLevel === 'high' || activeThreats.length > 0 ? 'high' :
                     volState?.riskLevel === 'medium' ? 'medium' : 'low';

    // Determine strategy
    let strategy = 'standard';
    if (mergedDecision.finalDirection === 'long') {
      strategy = botState?.counterStrategy?.includes('long') ? 'front-run-long' : 'long-entry';
    } else if (mergedDecision.finalDirection === 'short') {
      strategy = botState?.counterStrategy?.includes('short') ? 'front-run-short' : 'short-entry';
    }

    return {
      id: `orch-${Date.now()}-${randomUUID().split('-')[0]}`,
      timestamp: Date.now(),
      caneInputs,
      finalDecision,
      confidence: Math.max(0, Math.min(1, confidence)),
      priority: Math.max(0, Math.min(100, priority)),
      chain,
      asset,
      strategy,
      expectedProfit: mergedDecision.expectedProfit,
      riskLevel,
      reasoning
    };
  }

  /**
   * Get recent decisions
   */
  getDecisions(limit: number = 50): OrchestratorDecision[] {
    return this.decisions.slice(-limit);
  }

  /**
   * Get swarm coordination state
   */
  getSwarmState(): SwarmCoordinationState {
    let totalCrawlers = 0;
    let totalMicroCrawlers = 0;

    for (const cane of Array.from(this.canes.values())) {
      const state = cane.getState();
      totalCrawlers += state.subordinates.length;
      totalMicroCrawlers += state.signals.length; // Approximation
    }

    const pendingDecisions = this.decisions.filter(d => d.finalDecision === 'wait').length;
    const executingStrategies = this.decisions.filter(d => d.finalDecision === 'execute').slice(-10).length;

    return {
      activeCanes: this.canes.size + 1, // +1 for orchestrator
      totalCrawlers,
      totalMicroCrawlers,
      pendingDecisions,
      executingStrategies,
      systemLoad: Array.from(this.canes.values())
        .reduce((sum, c) => sum + c.getState().metrics.resourceUsage.cpu, 0) / this.canes.size,
      healthScore: cataclysmReaper.getSystemHealth().score
    };
  }
}

// ============================================================================
// SIX CANE SYSTEM - COMPLETE ORCHESTRATION
// ============================================================================

export class SixCaneSystem {
  private marketMapping: MarketMappingCane;
  private liquidityVision: LiquidityVisionCane;
  private volatilityPulse: VolatilityPulseCane;
  private orderFlowPrediction: OrderFlowPredictionCane;
  private behavioralAnalysis: BehavioralAnalysisCane;
  private grandOrchestrator: GrandOrchestratorCane;
  private isRunning: boolean = false;

  constructor() {
    this.marketMapping = new MarketMappingCane();
    this.liquidityVision = new LiquidityVisionCane();
    this.volatilityPulse = new VolatilityPulseCane();
    this.orderFlowPrediction = new OrderFlowPredictionCane();
    this.behavioralAnalysis = new BehavioralAnalysisCane();
    this.grandOrchestrator = new GrandOrchestratorCane();

    // Register all Canes with the Grand Orchestrator
    this.grandOrchestrator.registerCane(this.marketMapping);
    this.grandOrchestrator.registerCane(this.liquidityVision);
    this.grandOrchestrator.registerCane(this.volatilityPulse);
    this.grandOrchestrator.registerCane(this.orderFlowPrediction);
    this.grandOrchestrator.registerCane(this.behavioralAnalysis);
  }

  /**
   * Start the complete Six Cane System
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    logger.info('Starting Six Cane System', {
      component: 'SixCaneSystem'
    });

    // Start support systems
    gravityCrawler.start();
    cataclysmReaper.start();
    parallelIntelligence.start();

    // Start each Cane with appropriate intervals
    this.marketMapping.start(500);       // 500ms - market overview
    this.liquidityVision.start(300);     // 300ms - liquidity is critical
    this.volatilityPulse.start(200);     // 200ms - fast volatility detection
    this.orderFlowPrediction.start(100); // 100ms - fastest for order flow
    this.behavioralAnalysis.start(500);  // 500ms - bot patterns
    this.grandOrchestrator.start(1000);  // 1s - orchestration cycle

    this.isRunning = true;

    logger.info('Six Cane System started', {
      component: 'SixCaneSystem',
      canes: [
        'market-mapping',
        'liquidity-vision',
        'volatility-pulse',
        'orderflow-prediction',
        'behavioral-analysis',
        'grand-orchestrator'
      ]
    });
  }

  /**
   * Stop the complete Six Cane System
   */
  stop(): void {
    if (!this.isRunning) return;

    logger.info('Stopping Six Cane System', {
      component: 'SixCaneSystem'
    });

    // Stop all Canes
    this.marketMapping.stop();
    this.liquidityVision.stop();
    this.volatilityPulse.stop();
    this.orderFlowPrediction.stop();
    this.behavioralAnalysis.stop();
    this.grandOrchestrator.stop();

    // Stop support systems
    gravityCrawler.stop();
    cataclysmReaper.stop();
    parallelIntelligence.stop();

    this.isRunning = false;

    logger.info('Six Cane System stopped', {
      component: 'SixCaneSystem'
    });
  }

  /**
   * Get orchestrated decision
   */
  async getDecision(chain: ChainId, asset?: string): Promise<OrchestratorDecision> {
    return this.grandOrchestrator.process(chain, asset);
  }

  /**
   * Get all Cane states
   */
  getCaneStates(): Map<CaneRole, CaneState> {
    const states = new Map<CaneRole, CaneState>();
    
    states.set('market-mapping', this.marketMapping.getState());
    states.set('liquidity-vision', this.liquidityVision.getState());
    states.set('volatility-pulse', this.volatilityPulse.getState());
    states.set('orderflow-prediction', this.orderFlowPrediction.getState());
    states.set('behavioral-analysis', this.behavioralAnalysis.getState());
    states.set('grand-orchestrator', this.grandOrchestrator.getState());

    return states;
  }

  /**
   * Get system overview
   */
  getSystemOverview(): {
    isRunning: boolean;
    swarmState: SwarmCoordinationState;
    caneStatuses: Record<string, CaneStatus>;
    recentDecisions: OrchestratorDecision[];
    systemHealth: any;
  } {
    const caneStatuses: Record<string, CaneStatus> = {};
    for (const [role, state] of Array.from(this.getCaneStates().entries())) {
      caneStatuses[role] = state.status;
    }

    return {
      isRunning: this.isRunning,
      swarmState: this.grandOrchestrator.getSwarmState(),
      caneStatuses,
      recentDecisions: this.grandOrchestrator.getDecisions(10),
      systemHealth: cataclysmReaper.getSystemHealth()
    };
  }
}

// Singleton instance
export const sixCaneSystem = new SixCaneSystem();
