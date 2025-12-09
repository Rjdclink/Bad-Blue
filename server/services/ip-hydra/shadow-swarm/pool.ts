/**
 * PR 3: Shadow Swarm - Pool Management System
 * Manages shadow crawlers with pre-warmed, ready, active, and obsolete states
 */

import { randomBytes } from 'crypto';
import { ShadowCrawler, PoolConfig, LifecycleEvent } from '../types';
import { EventLogger } from '../utils/event-logger';

export class ShadowPool {
  private shadows: Map<string, ShadowCrawler> = new Map();
  private config: PoolConfig;
  private logger: EventLogger;

  constructor(config?: Partial<PoolConfig>) {
    this.config = {
      totalSize: parseInt(process.env.HYDRA_POOL_SIZE || '10'),
      minPerChain: 2,
      chains: ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum'],
      ...config,
    };
    this.logger = EventLogger.getInstance();
  }

  /**
   * Initialize the shadow pool with pre-warmed crawlers
   */
  async initialize(): Promise<void> {
    const { totalSize, minPerChain, chains } = this.config;
    
    // Ensure minimum per chain first
    for (const chain of chains) {
      for (let i = 0; i < minPerChain; i++) {
        await this.createShadow(chain);
      }
    }

    // Fill remaining slots
    const created = chains.length * minPerChain;
    const remaining = totalSize - created;
    
    for (let i = 0; i < remaining; i++) {
      const chain = chains[i % chains.length];
      await this.createShadow(chain);
    }

    console.log(`[ShadowPool] Initialized with ${this.shadows.size} shadows`);
  }

  /**
   * Create a new shadow crawler
   */
  private async createShadow(chain: string, parentId?: string, generation: number = 0): Promise<ShadowCrawler> {
    const shadow: ShadowCrawler = {
      id: this.generateId(),
      namespace: this.generateNamespace(),
      mac: this.generateMAC(),
      ip: this.generateIP(chain),
      status: 'pre-warmed',
      chain,
      latency: 0,
      createdAt: new Date(),
      lastActive: new Date(),
      parentId,
      generation,
    };

    this.shadows.set(shadow.id, shadow);

    // Log creation event
    await this.logger.logEvent({
      id: this.generateId(),
      type: 'shadow-created',
      crawlerId: shadow.id,
      chain,
      subnet: this.getSubnetFromIP(shadow.ip),
      metadata: { 
        mac: shadow.mac, 
        ip: shadow.ip,
        generation,
        parentId: parentId || null,
      },
      timestamp: new Date(),
    });

    // Pre-warm the shadow (simulate connection setup)
    setTimeout(() => this.preWarmShadow(shadow.id), 100);

    return shadow;
  }

  /**
   * Pre-warm a shadow (establish connections, test latency)
   */
  private async preWarmShadow(shadowId: string): Promise<void> {
    const shadow = this.shadows.get(shadowId);
    if (!shadow) return;

    // Simulate pre-warming
    shadow.latency = this.measureLatency(shadow.ip, shadow.chain);
    shadow.status = 'ready';
    shadow.lastActive = new Date();

    this.shadows.set(shadowId, shadow);
  }

  /**
   * Promote a shadow to active status for a specific task
   */
  async promoteShadow(chain: string, taskId: string, asset: string): Promise<ShadowCrawler | null> {
    // Find best ready shadow for this chain
    const candidates = Array.from(this.shadows.values())
      .filter(s => s.chain === chain && s.status === 'ready')
      .sort((a, b) => a.latency - b.latency);

    if (candidates.length === 0) {
      console.warn(`[ShadowPool] No ready shadows for chain ${chain}`);
      return null;
    }

    const shadow = candidates[0];
    shadow.status = 'active';
    shadow.assignedTask = taskId;
    shadow.assignedAsset = asset;
    shadow.lastActive = new Date();
    this.shadows.set(shadow.id, shadow);

    // Log promotion
    await this.logger.logEvent({
      id: this.generateId(),
      type: 'shadow-promoted',
      crawlerId: shadow.id,
      chain,
      metadata: { taskId, asset },
      timestamp: new Date(),
    });

    return shadow;
  }

  /**
   * Swap in a shadow due to detection/failure
   */
  async swapShadow(oldCrawlerId: string, reason: string): Promise<ShadowCrawler | null> {
    const oldShadow = this.shadows.get(oldCrawlerId);
    if (!oldShadow) return null;

    // Mark old shadow as obsolete
    oldShadow.status = 'obsolete';
    this.shadows.set(oldCrawlerId, oldShadow);

    // Find replacement
    const newShadow = await this.promoteShadow(
      oldShadow.chain,
      oldShadow.assignedTask || 'recovery',
      oldShadow.assignedAsset || 'unknown'
    );

    if (newShadow && oldShadow.assignedTask) {
      // Transfer context
      newShadow.assignedTask = oldShadow.assignedTask;
      newShadow.assignedAsset = oldShadow.assignedAsset;
      this.shadows.set(newShadow.id, newShadow);
    }

    // Log swap event
    await this.logger.logEvent({
      id: this.generateId(),
      type: 'shadow-swapped',
      crawlerId: newShadow?.id || 'none',
      chain: oldShadow.chain,
      metadata: { 
        oldCrawlerId,
        reason,
        transferred: !!newShadow,
      },
      timestamp: new Date(),
    });

    // Create replacement shadow to maintain pool size
    await this.createShadow(oldShadow.chain);

    // Destroy obsolete shadow after a delay
    setTimeout(() => this.destroyShadow(oldCrawlerId), 5000);

    return newShadow;
  }

  /**
   * Destroy an obsolete shadow
   */
  private async destroyShadow(shadowId: string): Promise<void> {
    const shadow = this.shadows.get(shadowId);
    if (!shadow) return;

    this.shadows.delete(shadowId);

    await this.logger.logEvent({
      id: this.generateId(),
      type: 'shadow-obsolete',
      crawlerId: shadowId,
      chain: shadow.chain,
      metadata: { 
        lifetime: Date.now() - shadow.createdAt.getTime(),
      },
      timestamp: new Date(),
    });

    console.log(`[ShadowPool] Destroyed shadow ${shadowId}`);
  }

  /**
   * Get shadow by ID
   */
  getShadow(shadowId: string): ShadowCrawler | undefined {
    return this.shadows.get(shadowId);
  }

  /**
   * Get all shadows by status
   */
  getShadowsByStatus(status: ShadowCrawler['status']): ShadowCrawler[] {
    return Array.from(this.shadows.values())
      .filter(s => s.status === status);
  }

  /**
   * Get all shadows by chain
   */
  getShadowsByChain(chain: string): ShadowCrawler[] {
    return Array.from(this.shadows.values())
      .filter(s => s.chain === chain);
  }

  /**
   * Get pool health metrics
   */
  getPoolHealth(): {
    total: number;
    ready: number;
    active: number;
    obsolete: number;
    avgLatency: number;
    healthScore: number;
  } {
    const shadows = Array.from(this.shadows.values());
    const ready = shadows.filter(s => s.status === 'ready').length;
    const active = shadows.filter(s => s.status === 'active').length;
    const obsolete = shadows.filter(s => s.status === 'obsolete').length;
    
    const avgLatency = shadows.length > 0
      ? shadows.reduce((sum, s) => sum + s.latency, 0) / shadows.length
      : 0;

    // Health score: 100 if we have enough ready shadows, decreasing if not
    const expectedReady = this.config.totalSize * 0.5; // 50% should be ready
    const healthScore = Math.min(100, (ready / expectedReady) * 100);

    return {
      total: shadows.length,
      ready,
      active,
      obsolete,
      avgLatency,
      healthScore,
    };
  }

  /**
   * Check and replace high-latency shadows
   */
  async healthCheck(): Promise<void> {
    const avgLatency = this.getPoolHealth().avgLatency;
    const threshold = avgLatency * 1.5; // 50% above average

    for (const shadow of this.shadows.values()) {
      if (shadow.status === 'ready' && shadow.latency > threshold) {
        console.log(`[ShadowPool] Replacing high-latency shadow ${shadow.id} (${shadow.latency}ms > ${threshold}ms)`);
        await this.swapShadow(shadow.id, 'high-latency');
      }
    }
  }

  // Utility methods
  private generateId(): string {
    return `shadow_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  private generateNamespace(): string {
    return `ns_${randomBytes(4).toString('hex')}`;
  }

  private generateMAC(): string {
    const bytes = randomBytes(6);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(':')
      .toUpperCase();
  }

  private generateIP(chain: string): string {
    // Generate IPs close to RPC targets (simplified)
    const ranges: Record<string, string> = {
      ethereum: '10.0.1',
      polygon: '10.0.2',
      bsc: '10.0.3',
      avalanche: '10.0.4',
      arbitrum: '10.0.5',
    };
    
    const baseIP = ranges[chain] || '10.0.0';
    const lastOctet = Math.floor(Math.random() * 254) + 1;
    return `${baseIP}.${lastOctet}`;
  }

  private getSubnetFromIP(ip: string): string {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }

  private measureLatency(ip: string, chain: string): number {
    // Simulate latency measurement (in real implementation, ping RPC)
    return Math.floor(Math.random() * 100) + 20; // 20-120ms
  }

  /**
   * Spawn a child crawler (Snake-Skin pattern)
   */
  async spawnChild(parentId: string, assetDetected: string): Promise<ShadowCrawler | null> {
    const parent = this.shadows.get(parentId);
    if (!parent) return null;

    const child = await this.createShadow(
      parent.chain,
      parentId,
      parent.generation + 1
    );

    // Optimize child's MAC/IP for the detected asset
    child.assignedAsset = assetDetected;
    child.status = 'active';
    this.shadows.set(child.id, child);

    // Log spawn event
    await this.logger.logEvent({
      id: this.generateId(),
      type: 'snake-spawned',
      crawlerId: child.id,
      chain: parent.chain,
      metadata: {
        parentId,
        assetDetected,
        generation: child.generation,
      },
      timestamp: new Date(),
    });

    return child;
  }

  /**
   * Get crawler lineage (ancestry tree)
   */
  getLineage(crawlerId: string): ShadowCrawler[] {
    const lineage: ShadowCrawler[] = [];
    let current = this.shadows.get(crawlerId);

    while (current) {
      lineage.unshift(current);
      if (!current.parentId) break;
      current = this.shadows.get(current.parentId);
    }

    return lineage;
  }

  /**
   * Get all children of a crawler
   */
  getChildren(crawlerId: string): ShadowCrawler[] {
    return Array.from(this.shadows.values())
      .filter(s => s.parentId === crawlerId);
  }
}
