// Gravity Crawler & Cataclysm Reaper - Market Intelligence Agents
// Gravity Crawler: Detects where market activity is "pulled", follows liquidity centers
// Cataclysm Reaper: Monitors for systemic threats and market instability

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../eden/types.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface GravityCenter {
  id: string;
  chain: ChainId;
  asset: string;
  position: { price: number; volume: number };
  pullStrength: number;     // How strongly activity is pulled here (0-1)
  momentum: 'increasing' | 'decreasing' | 'stable';
  timestamp: number;
  confidence: number;
}

export interface LiquidityGravityMap {
  chain: ChainId;
  centers: GravityCenter[];
  overallPull: { direction: 'up' | 'down' | 'sideways'; strength: number };
  hotspots: { price: number; intensity: number }[];
  timestamp: number;
}

export interface CataclysmEvent {
  id: string;
  type: CataclysmType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  chain: ChainId;
  description: string;
  timestamp: number;
  metrics: Record<string, any>;
  recoveryActions: string[];
  resolved: boolean;
  resolvedAt?: number;
}

export type CataclysmType = 
  | 'liquidity-vacuum'       // Sudden liquidity disappearance
  | 'cascading-liquidation'  // Chain of liquidations
  | 'volatility-shockwave'   // Extreme volatility spike
  | 'flash-crash'            // Rapid price collapse
  | 'api-cold-start'         // API provider issues
  | 'cloud-throttling'       // Cloud region throttling
  | 'network-congestion'     // Blockchain network congestion
  | 'oracle-manipulation'    // Price oracle anomaly
  | 'smart-contract-exploit'; // Detected exploit pattern

export interface ReaperStatistics {
  eventsDetected: number;
  eventsResolved: number;
  avgDetectionTimeMs: number;
  avgResolutionTimeMs: number;
  criticalEventsThisHour: number;
  systemHealthScore: number;
}

// ============================================================================
// GRAVITY CRAWLER - MARKET ACTIVITY DETECTOR
// ============================================================================

export class GravityCrawler {
  private id: string;
  private gravityMaps: Map<ChainId, LiquidityGravityMap> = new Map();
  private historicalCenters: GravityCenter[] = [];
  private isActive: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL_MS = 500;
  private readonly MAX_HISTORY = 1000;

  constructor() {
    this.id = `gravity-${Date.now()}-${randomUUID().split('-')[0]}`;
  }

  /**
   * Start the gravity crawler
   */
  start(): void {
    if (this.isActive) return;

    logger.info('Starting Gravity Crawler', {
      component: 'GravityCrawler',
      id: this.id
    });

    this.isActive = true;

    // Initialize maps for all chains
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      this.gravityMaps.set(chain, {
        chain,
        centers: [],
        overallPull: { direction: 'sideways', strength: 0 },
        hotspots: [],
        timestamp: Date.now()
      });
    }

    // Start periodic updates
    this.updateInterval = setInterval(() => {
      this.updateGravityMaps();
    }, this.UPDATE_INTERVAL_MS);
  }

  /**
   * Stop the gravity crawler
   */
  stop(): void {
    if (!this.isActive) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isActive = false;

    logger.info('Gravity Crawler stopped', {
      component: 'GravityCrawler',
      id: this.id
    });
  }

  /**
   * Update gravity maps for all chains
   */
  private async updateGravityMaps(): Promise<void> {
    for (const [chain, map] of Array.from(this.gravityMaps.entries())) {
      try {
        const updatedMap = await this.analyzeChainGravity(chain);
        this.gravityMaps.set(chain, updatedMap);
      } catch (error) {
        logger.error('Gravity analysis error', {
          component: 'GravityCrawler',
          chain,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Analyze gravity patterns for a specific chain
   */
  private async analyzeChainGravity(chain: ChainId): Promise<LiquidityGravityMap> {
    // Simulate gravity center detection
    const centers: GravityCenter[] = [];
    const numCenters = Math.floor(Math.random() * 5) + 1;

    for (let i = 0; i < numCenters; i++) {
      const center: GravityCenter = {
        id: `gc-${chain}-${Date.now()}-${i}`,
        chain,
        asset: ['ETH', 'USDC', 'WBTC', 'MATIC', 'LINK'][Math.floor(Math.random() * 5)],
        position: {
          price: Math.random() * 2000 + 100,
          volume: Math.random() * 1000000
        },
        pullStrength: Math.random(),
        momentum: ['increasing', 'decreasing', 'stable'][Math.floor(Math.random() * 3)] as any,
        timestamp: Date.now(),
        confidence: Math.random() * 0.5 + 0.5
      };

      centers.push(center);

      // Store in history
      this.historicalCenters.push(center);
      if (this.historicalCenters.length > this.MAX_HISTORY) {
        this.historicalCenters.shift();
      }
    }

    // Sort by pull strength
    centers.sort((a, b) => b.pullStrength - a.pullStrength);

    // Calculate overall pull direction
    const avgPullUp = centers.filter(c => c.momentum === 'increasing').length / centers.length;
    const avgPullDown = centers.filter(c => c.momentum === 'decreasing').length / centers.length;
    
    let direction: 'up' | 'down' | 'sideways' = 'sideways';
    if (avgPullUp > 0.5) direction = 'up';
    else if (avgPullDown > 0.5) direction = 'down';

    const strength = Math.max(avgPullUp, avgPullDown, 0.3);

    // Identify hotspots
    const hotspots = centers.slice(0, 3).map(c => ({
      price: c.position.price,
      intensity: c.pullStrength * 100
    }));

    return {
      chain,
      centers,
      overallPull: { direction, strength },
      hotspots,
      timestamp: Date.now()
    };
  }

  /**
   * Get gravity map for a chain
   */
  getGravityMap(chain: ChainId): LiquidityGravityMap | undefined {
    return this.gravityMaps.get(chain);
  }

  /**
   * Get strongest gravity centers across all chains
   */
  getStrongestCenters(limit: number = 10): GravityCenter[] {
    const allCenters: GravityCenter[] = [];
    
    for (const map of Array.from(this.gravityMaps.values())) {
      allCenters.push(...map.centers);
    }

    return allCenters
      .sort((a, b) => b.pullStrength - a.pullStrength)
      .slice(0, limit);
  }

  /**
   * Predict next gravity shift
   */
  predictGravityShift(chain: ChainId): {
    predictedDirection: 'up' | 'down' | 'sideways';
    confidence: number;
    expectedTimeMs: number;
    targetPrice?: number;
  } {
    const chainCenters = this.historicalCenters
      .filter(c => c.chain === chain)
      .slice(-50);

    if (chainCenters.length < 5) {
      return {
        predictedDirection: 'sideways',
        confidence: 0.3,
        expectedTimeMs: 60000
      };
    }

    // Analyze momentum trend
    const recentMomentum = chainCenters.slice(-10);
    const increasingCount = recentMomentum.filter(c => c.momentum === 'increasing').length;
    const decreasingCount = recentMomentum.filter(c => c.momentum === 'decreasing').length;

    let predictedDirection: 'up' | 'down' | 'sideways' = 'sideways';
    let confidence = 0.5;

    if (increasingCount > decreasingCount * 1.5) {
      predictedDirection = 'up';
      confidence = Math.min(0.9, increasingCount / 10 + 0.4);
    } else if (decreasingCount > increasingCount * 1.5) {
      predictedDirection = 'down';
      confidence = Math.min(0.9, decreasingCount / 10 + 0.4);
    }

    // Estimate target price from strongest center
    const strongestCenter = chainCenters.sort((a, b) => b.pullStrength - a.pullStrength)[0];

    return {
      predictedDirection,
      confidence,
      expectedTimeMs: Math.random() * 30000 + 5000,
      targetPrice: strongestCenter?.position.price
    };
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    isActive: boolean;
    chainsMonitored: number;
    totalCenters: number;
    historicalCentersStored: number;
  } {
    let totalCenters = 0;
    for (const map of Array.from(this.gravityMaps.values())) {
      totalCenters += map.centers.length;
    }

    return {
      isActive: this.isActive,
      chainsMonitored: this.gravityMaps.size,
      totalCenters,
      historicalCentersStored: this.historicalCenters.length
    };
  }
}

// ============================================================================
// CATACLYSM REAPER - INSTABILITY DETECTOR
// ============================================================================

export class CataclysmReaper {
  private id: string;
  private events: CataclysmEvent[] = [];
  private isActive: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private readonly MONITOR_INTERVAL_MS = 1000;
  private readonly MAX_EVENTS = 500;
  
  // Detection thresholds
  private readonly LIQUIDITY_VACUUM_THRESHOLD = 0.3; // 30% drop
  private readonly VOLATILITY_SPIKE_THRESHOLD = 0.5; // 50% increase
  private readonly FLASH_CRASH_THRESHOLD = 0.1;      // 10% drop in 1 minute
  private readonly CONGESTION_THRESHOLD = 100;       // 100+ pending txs
  
  // Statistics
  private stats: ReaperStatistics = {
    eventsDetected: 0,
    eventsResolved: 0,
    avgDetectionTimeMs: 0,
    avgResolutionTimeMs: 0,
    criticalEventsThisHour: 0,
    systemHealthScore: 100
  };

  // Callbacks for event handlers
  private eventHandlers: ((event: CataclysmEvent) => void)[] = [];

  constructor() {
    this.id = `reaper-${Date.now()}-${randomUUID().split('-')[0]}`;
  }

  /**
   * Start the cataclysm reaper
   */
  start(): void {
    if (this.isActive) return;

    logger.info('Starting Cataclysm Reaper', {
      component: 'CataclysmReaper',
      id: this.id
    });

    this.isActive = true;

    // Start monitoring
    this.monitorInterval = setInterval(() => {
      this.monitorForCataclysms();
    }, this.MONITOR_INTERVAL_MS);
  }

  /**
   * Stop the cataclysm reaper
   */
  stop(): void {
    if (!this.isActive) return;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.isActive = false;

    logger.info('Cataclysm Reaper stopped', {
      component: 'CataclysmReaper',
      id: this.id,
      totalEvents: this.events.length
    });
  }

  /**
   * Register event handler
   */
  onEvent(handler: (event: CataclysmEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Monitor for all types of cataclysms
   */
  private async monitorForCataclysms(): Promise<void> {
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];

    for (const chain of chains) {
      try {
        // Check for each type of cataclysm
        await this.checkLiquidityVacuum(chain);
        await this.checkVolatilityShockwave(chain);
        await this.checkFlashCrash(chain);
        await this.checkNetworkCongestion(chain);
        await this.checkAPIHealth(chain);
        await this.checkOracleManipulation(chain);
      } catch (error) {
        logger.error('Cataclysm monitoring error', {
          component: 'CataclysmReaper',
          chain,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Update statistics
    this.updateStatistics();
  }

  /**
   * Check for liquidity vacuum
   */
  private async checkLiquidityVacuum(chain: ChainId): Promise<void> {
    // Simulate liquidity check
    const liquidityDrop = Math.random();
    
    if (liquidityDrop > (1 - this.LIQUIDITY_VACUUM_THRESHOLD) && Math.random() < 0.01) {
      this.triggerEvent({
        type: 'liquidity-vacuum',
        severity: liquidityDrop > 0.9 ? 'critical' : 'high',
        chain,
        description: `Sudden liquidity drop detected: ${(liquidityDrop * 100).toFixed(1)}% decrease`,
        metrics: { liquidityDrop }
      });
    }
  }

  /**
   * Check for volatility shockwave
   */
  private async checkVolatilityShockwave(chain: ChainId): Promise<void> {
    // Simulate volatility check
    const volatilitySpike = Math.random();
    
    if (volatilitySpike > (1 - this.VOLATILITY_SPIKE_THRESHOLD) && Math.random() < 0.02) {
      this.triggerEvent({
        type: 'volatility-shockwave',
        severity: volatilitySpike > 0.8 ? 'high' : 'medium',
        chain,
        description: `Extreme volatility spike: ${(volatilitySpike * 100).toFixed(1)}% increase`,
        metrics: { volatilitySpike }
      });
    }
  }

  /**
   * Check for flash crash
   */
  private async checkFlashCrash(chain: ChainId): Promise<void> {
    // Simulate flash crash detection
    const priceDrop = Math.random();
    
    if (priceDrop > (1 - this.FLASH_CRASH_THRESHOLD) && Math.random() < 0.005) {
      this.triggerEvent({
        type: 'flash-crash',
        severity: 'critical',
        chain,
        description: `Flash crash detected: ${(priceDrop * 100).toFixed(1)}% drop in < 1 minute`,
        metrics: { priceDrop, duration: 'sub-minute' }
      });
    }
  }

  /**
   * Check for network congestion
   */
  private async checkNetworkCongestion(chain: ChainId): Promise<void> {
    // Simulate congestion check
    const pendingTxs = Math.floor(Math.random() * 200);
    
    if (pendingTxs > this.CONGESTION_THRESHOLD && Math.random() < 0.03) {
      this.triggerEvent({
        type: 'network-congestion',
        severity: pendingTxs > 150 ? 'high' : 'medium',
        chain,
        description: `Network congestion detected: ${pendingTxs} pending transactions`,
        metrics: { pendingTxs }
      });
    }
  }

  /**
   * Check for API health issues
   */
  private async checkAPIHealth(chain: ChainId): Promise<void> {
    // Simulate API health check
    const apiLatency = Math.random() * 2000;
    
    if (apiLatency > 1000 && Math.random() < 0.02) {
      this.triggerEvent({
        type: 'api-cold-start',
        severity: apiLatency > 1500 ? 'high' : 'medium',
        chain,
        description: `API latency spike: ${apiLatency.toFixed(0)}ms response time`,
        metrics: { apiLatency }
      });
    }
  }

  /**
   * Check for oracle manipulation
   */
  private async checkOracleManipulation(chain: ChainId): Promise<void> {
    // Simulate oracle deviation check
    const priceDeviation = Math.random() * 0.2;
    
    if (priceDeviation > 0.05 && Math.random() < 0.01) {
      this.triggerEvent({
        type: 'oracle-manipulation',
        severity: priceDeviation > 0.1 ? 'critical' : 'high',
        chain,
        description: `Oracle price deviation: ${(priceDeviation * 100).toFixed(1)}% from market`,
        metrics: { priceDeviation }
      });
    }
  }

  /**
   * Trigger a cataclysm event
   */
  private triggerEvent(params: {
    type: CataclysmType;
    severity: CataclysmEvent['severity'];
    chain: ChainId;
    description: string;
    metrics: Record<string, any>;
  }): void {
    const event: CataclysmEvent = {
      id: `cat-${Date.now()}-${randomUUID().split('-')[0]}`,
      type: params.type,
      severity: params.severity,
      chain: params.chain,
      description: params.description,
      timestamp: Date.now(),
      metrics: params.metrics,
      recoveryActions: this.getRecoveryActions(params.type, params.severity),
      resolved: false
    };

    // Store event
    this.events.push(event);
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }

    // Update stats
    this.stats.eventsDetected++;
    if (params.severity === 'critical') {
      this.stats.criticalEventsThisHour++;
    }

    // Log the event
    const logMethod = params.severity === 'critical' ? 'error' : 
                      params.severity === 'high' ? 'warn' : 'info';
    
    logger[logMethod]('Cataclysm event detected', {
      component: 'CataclysmReaper',
      event
    });

    // Notify handlers
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error('Event handler error', {
          component: 'CataclysmReaper',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Auto-resolve non-critical events after some time
    if (params.severity !== 'critical') {
      setTimeout(() => {
        this.resolveEvent(event.id);
      }, Math.random() * 30000 + 10000);
    }
  }

  /**
   * Get recovery actions for event type
   */
  private getRecoveryActions(type: CataclysmType, severity: string): string[] {
    const actions: string[] = [];

    switch (type) {
      case 'liquidity-vacuum':
        actions.push('Pause new positions');
        actions.push('Reduce position sizes');
        if (severity === 'critical') actions.push('Emergency liquidation');
        break;
      
      case 'cascading-liquidation':
        actions.push('Monitor liquidation cascade');
        actions.push('Prepare counter-positions');
        break;
      
      case 'volatility-shockwave':
        actions.push('Widen slippage tolerance');
        actions.push('Reduce leverage');
        break;
      
      case 'flash-crash':
        actions.push('Halt all trading');
        actions.push('Check for arbitrage opportunities post-crash');
        break;
      
      case 'api-cold-start':
      case 'cloud-throttling':
        actions.push('Switch to backup RPC');
        actions.push('Reduce request rate');
        break;
      
      case 'network-congestion':
        actions.push('Increase gas prices');
        actions.push('Queue non-urgent transactions');
        break;
      
      case 'oracle-manipulation':
        actions.push('Use alternative price feeds');
        actions.push('Pause oracle-dependent operations');
        break;
      
      case 'smart-contract-exploit':
        actions.push('Halt interactions with affected contracts');
        actions.push('Move funds to safety');
        break;
    }

    return actions;
  }

  /**
   * Resolve an event
   */
  resolveEvent(eventId: string): boolean {
    const event = this.events.find(e => e.id === eventId);
    if (!event || event.resolved) return false;

    event.resolved = true;
    event.resolvedAt = Date.now();
    this.stats.eventsResolved++;

    logger.info('Cataclysm event resolved', {
      component: 'CataclysmReaper',
      eventId,
      resolutionTimeMs: event.resolvedAt - event.timestamp
    });

    return true;
  }

  /**
   * Update statistics
   */
  private updateStatistics(): void {
    // Calculate average detection time (simulated)
    this.stats.avgDetectionTimeMs = Math.random() * 100 + 50;

    // Calculate average resolution time
    const resolvedEvents = this.events.filter(e => e.resolved && e.resolvedAt);
    if (resolvedEvents.length > 0) {
      this.stats.avgResolutionTimeMs = resolvedEvents.reduce(
        (sum, e) => sum + (e.resolvedAt! - e.timestamp),
        0
      ) / resolvedEvents.length;
    }

    // Update critical events in last hour
    const oneHourAgo = Date.now() - 3600000;
    this.stats.criticalEventsThisHour = this.events.filter(
      e => e.severity === 'critical' && e.timestamp > oneHourAgo
    ).length;

    // Calculate system health score
    const unresolvedCritical = this.events.filter(
      e => e.severity === 'critical' && !e.resolved
    ).length;
    const unresolvedHigh = this.events.filter(
      e => e.severity === 'high' && !e.resolved
    ).length;

    this.stats.systemHealthScore = Math.max(0, 
      100 - (unresolvedCritical * 25) - (unresolvedHigh * 10) - (this.stats.criticalEventsThisHour * 5)
    );
  }

  /**
   * Get active events (unresolved)
   */
  getActiveEvents(): CataclysmEvent[] {
    return this.events.filter(e => !e.resolved);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 50): CataclysmEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: CataclysmType): CataclysmEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Get events by chain
   */
  getEventsByChain(chain: ChainId): CataclysmEvent[] {
    return this.events.filter(e => e.chain === chain);
  }

  /**
   * Get statistics
   */
  getStatistics(): ReaperStatistics {
    return { ...this.stats };
  }

  /**
   * Get system health
   */
  getSystemHealth(): {
    score: number;
    status: 'healthy' | 'degraded' | 'critical';
    activeThreats: number;
    recommendation: string;
  } {
    const activeThreats = this.events.filter(e => !e.resolved).length;
    
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    let recommendation = 'System operating normally';

    if (this.stats.systemHealthScore < 50) {
      status = 'critical';
      recommendation = 'Immediate attention required - multiple unresolved critical events';
    } else if (this.stats.systemHealthScore < 80) {
      status = 'degraded';
      recommendation = 'System experiencing issues - review active events';
    }

    return {
      score: this.stats.systemHealthScore,
      status,
      activeThreats,
      recommendation
    };
  }
}

// Singleton instances
export const gravityCrawler = new GravityCrawler();
export const cataclysmReaper = new CataclysmReaper();
