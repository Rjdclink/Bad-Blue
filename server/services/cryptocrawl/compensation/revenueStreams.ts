/**
 * Compensation Revenue Streams
 * 
 * Integrates all four revenue sources:
 * 1. Computational Grid Participation (CPU/GPU cycles)
 * 2. Flash Engine Revenue (arbitrage & micro-delta)
 * 3. Beneficial Crawler Bounty Loop
 * 4. Tri-Beam Broadcasting (computational lattice)
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { compensationEngine } from './compensationEngine';
import type {
  ComputationalGridTask,
  FlashEngineProfit,
  CrawlerBounty,
  TriBeamRevenue,
} from './types';

const log = createLogger('RevenueStreams');

// ============================================================================
// COMPUTATIONAL GRID PARTICIPATION
// ============================================================================

export class ComputationalGridManager extends EventEmitter {
  private activeTasks: Map<string, ComputationalGridTask> = new Map();
  private totalCyclesCompleted = 0;
  private totalCompensation = '0';

  /**
   * Register CPU/GPU cycle task
   */
  async registerTask(
    taskType: 'cpu' | 'gpu',
    cycleCount: number,
    networkId: string
  ): Promise<string> {
    const task: ComputationalGridTask = {
      id: this.generateId(),
      taskType,
      cycleCount,
      networkId,
      compensation: this.calculateCompensation(taskType, cycleCount),
      completedAt: Date.now(),
    };

    this.activeTasks.set(task.id, task);
    this.totalCyclesCompleted += cycleCount;

    // Record compensation
    await compensationEngine.recordCompensation(
      'computational_grid',
      task.compensation,
      'ETH',
      networkId,
      { taskId: task.id, cycleCount, taskType }
    );

    log.info(`⚙️ ${taskType.toUpperCase()} task completed`, {
      cycles: cycleCount,
      compensation: task.compensation,
      network: networkId,
    });

    this.emit('task-completed', task);
    return task.id;
  }

  /**
   * Calculate compensation per cycle
   */
  private calculateCompensation(type: 'cpu' | 'gpu', cycles: number): string {
    // GPU earns 3x more than CPU
    const ratePerCycle = type === 'gpu' ? 0.000003 : 0.000001;
    const total = ratePerCycle * cycles;
    return total.toFixed(18);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeTasks: this.activeTasks.size,
      totalCyclesCompleted: this.totalCyclesCompleted,
      totalCompensation: this.totalCompensation,
    };
  }

  private generateId(): string {
    return `grid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// FLASH ENGINE REVENUE
// ============================================================================

export class FlashEngineRevenueManager extends EventEmitter {
  private profits: FlashEngineProfit[] = [];
  private totalProfit = '0';

  /**
   * Record flash engine profit
   */
  async recordProfit(
    profitType: 'arbitrage' | 'micro_delta' | 'liquidity_reshape',
    amount: string,
    executionTime: number,
    reversible: boolean
  ): Promise<string> {
    // Apply TWA amplification
    const amplifiedAmount = await compensationEngine.amplifyFlashProfit(amount);

    const profit: FlashEngineProfit = {
      id: this.generateId(),
      profitType,
      amount: amplifiedAmount,
      executionTime,
      reversible,
      timestamp: Date.now(),
    };

    this.profits.push(profit);

    // Record compensation with amplification
    await compensationEngine.recordCompensation(
      'flash_engine',
      amplifiedAmount,
      'ETH',
      'ethereum',
      { 
        profitType,
        executionTime,
        reversible,
        originalAmount: amount,
        amplified: true,
      }
    );

    log.info(`⚡ Flash profit recorded (${profitType})`, {
      original: amount,
      amplified: amplifiedAmount,
      executionTime: `${executionTime}ms`,
    });

    this.emit('profit-recorded', profit);
    return profit.id;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      totalProfits: this.profits.length,
      totalAmount: this.totalProfit,
      byType: {
        arbitrage: this.profits.filter(p => p.profitType === 'arbitrage').length,
        micro_delta: this.profits.filter(p => p.profitType === 'micro_delta').length,
        liquidity_reshape: this.profits.filter(p => p.profitType === 'liquidity_reshape').length,
      },
    };
  }

  private generateId(): string {
    return `flash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// BENEFICIAL CRAWLER BOUNTY LOOP
// ============================================================================

export class CrawlerBountyManager extends EventEmitter {
  private bounties: Map<string, CrawlerBounty> = new Map();
  private totalBounties = 0;

  /**
   * Claim task for crawler
   */
  async claimTask(crawlerId: string): Promise<void> {
    let bounty = this.bounties.get(crawlerId);
    
    if (!bounty) {
      bounty = {
        id: this.generateId(),
        crawlerId,
        tasksClaimed: 0,
        tasksCompleted: 0,
        totalCompensation: '0',
        timestamp: Date.now(),
      };
      this.bounties.set(crawlerId, bounty);
    }

    bounty.tasksClaimed++;
    
    log.info('📋 Crawler claimed task', {
      crawlerId: crawlerId.substring(0, 10) + '...',
      totalClaimed: bounty.tasksClaimed,
    });
  }

  /**
   * Complete task and route compensation
   */
  async completeTask(
    crawlerId: string,
    compensation: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const bounty = this.bounties.get(crawlerId);
    
    if (!bounty) {
      log.error('❌ No bounty found for crawler:', crawlerId);
      return;
    }

    bounty.tasksCompleted++;
    const currentTotal = parseFloat(bounty.totalCompensation);
    const newAmount = parseFloat(compensation);
    bounty.totalCompensation = (currentTotal + newAmount).toFixed(18);
    this.totalBounties++;

    // Record compensation from beneficial crawler
    await compensationEngine.recordCompensation(
      'beneficial_crawler',
      compensation,
      'ETH',
      'ethereum',
      { crawlerId, ...metadata }
    );

    log.info('✅ Crawler task completed', {
      crawlerId: crawlerId.substring(0, 10) + '...',
      compensation,
      totalEarned: bounty.totalCompensation,
    });

    this.emit('task-completed', { crawlerId, compensation });
  }

  /**
   * Get crawler statistics
   */
  getCrawlerStats(crawlerId: string): CrawlerBounty | null {
    return this.bounties.get(crawlerId) || null;
  }

  /**
   * Get all bounties
   */
  getAllBounties(): CrawlerBounty[] {
    return Array.from(this.bounties.values());
  }

  private generateId(): string {
    return `bounty_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// TRI-BEAM BROADCASTING
// ============================================================================

export class TriBeamBroadcastManager extends EventEmitter {
  private nodes: Map<string, TriBeamRevenue[]> = new Map();
  private latticeConnections = 0;

  /**
   * Register node connection to lattice
   */
  async registerNode(nodeId: string, connections: number): Promise<void> {
    const revenues = this.nodes.get(nodeId) || [];
    
    const revenue: TriBeamRevenue = {
      id: this.generateId(),
      nodeId,
      connections,
      revenueGenerated: this.calculateRevenue(connections),
      latticePosition: this.calculateLatticePosition(nodeId),
      timestamp: Date.now(),
    };

    revenues.push(revenue);
    this.nodes.set(nodeId, revenues);
    this.latticeConnections += connections;

    // Record compensation from tri-beam broadcast
    await compensationEngine.recordCompensation(
      'tri_beam_broadcast',
      revenue.revenueGenerated,
      'ETH',
      'ethereum',
      { 
        nodeId,
        connections,
        latticePosition: revenue.latticePosition,
      }
    );

    log.info('📡 Tri-beam node broadcasting', {
      nodeId: nodeId.substring(0, 10) + '...',
      connections,
      revenue: revenue.revenueGenerated,
      latticePosition: revenue.latticePosition,
    });

    this.emit('node-broadcasting', revenue);
  }

  /**
   * Calculate revenue based on connections
   */
  private calculateRevenue(connections: number): string {
    // More connections = more revenue (exponential growth)
    const baseRate = 0.000001;
    const revenue = baseRate * connections * Math.log2(connections + 1);
    return revenue.toFixed(18);
  }

  /**
   * Calculate lattice position
   */
  private calculateLatticePosition(nodeId: string): string {
    // Simplified lattice position based on node ID hash
    const hash = parseInt(nodeId.slice(-8), 16);
    const x = hash % 100;
    const y = Math.floor(hash / 100) % 100;
    return `${x},${y}`;
  }

  /**
   * Get node statistics
   */
  getNodeStats(nodeId: string) {
    const revenues = this.nodes.get(nodeId) || [];
    const totalRevenue = revenues.reduce(
      (sum, r) => sum + parseFloat(r.revenueGenerated),
      0
    );

    return {
      broadcastCount: revenues.length,
      totalRevenue: totalRevenue.toFixed(18),
      latestPosition: revenues[revenues.length - 1]?.latticePosition,
    };
  }

  /**
   * Get lattice statistics
   */
  getLatticeStats() {
    return {
      totalNodes: this.nodes.size,
      totalConnections: this.latticeConnections,
      activeNodes: Array.from(this.nodes.keys()),
    };
  }

  private generateId(): string {
    return `tribeam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const computationalGrid = new ComputationalGridManager();
export const flashEngineRevenue = new FlashEngineRevenueManager();
export const crawlerBounty = new CrawlerBountyManager();
export const triBeamBroadcast = new TriBeamBroadcastManager();
