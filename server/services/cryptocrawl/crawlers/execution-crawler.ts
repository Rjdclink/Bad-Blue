// Execution Crawler - Atomic execution in isolated containers
// Fires transactions instantly, handles multi-hop routing, auto-aborts on gas spikes

import { randomUUID } from 'crypto';
import { HopPacket, HopStage, ExecutionResult, CrawlerState } from './types';
import type { ChainId } from '../core/lux-swarm';

export class ExecutionCrawler {
  private id: string;
  private chain: ChainId;
  private state: CrawlerState;
  private isRunning: boolean = false;
  private queue: HopPacket[] = [];
  private maxQueueSize: number = 50;
  private gasThreshold: number = 200; // Auto-abort if gas > threshold gwei
  
  constructor(chain: ChainId) {
    this.id = `execution-${chain}-${randomUUID().split('-')[0]}`;
    this.chain = chain;
    
    this.state = {
      id: this.id,
      status: 'idle',
      packetsProcessed: 0,
      successRate: 1.0,
      lastActivity: Date.now()
    };
  }
  
  // Start execution loop
  async start(onExecuted: (packet: HopPacket) => void): Promise<void> {
    this.isRunning = true;
    console.log(`[EXECUTION-${this.id}] ⚡ Started execution engine`);
    
    while (this.isRunning) {
      try {
        if (this.queue.length > 0) {
          this.state.status = 'executing';
          this.state.lastActivity = Date.now();
          
          // Get highest priority packet
          const packet = this.getNextPacket();
          if (!packet) {
            await this.sleep(100);
            continue;
          }
          
          this.state.currentPacket = packet.id;
          
          // Check gas conditions before execution
          const gasOk = await this.checkGasConditions();
          if (!gasOk) {
            console.warn(`[EXECUTION-${this.id}] ⚠️ Gas spike detected, re-queueing ${packet.id}`);
            this.queue.unshift(packet); // Put back at front
            await this.sleep(5000); // Wait for gas to stabilize
            continue;
          }
          
          // Execute in isolated container
          const result = await this.executeIsolated(packet);
          
          // Update packet with execution results
          const executedPacket = this.createExecutedPacket(packet, result);
          onExecuted(executedPacket);
          
          // Update success rate
          const successCount = this.state.packetsProcessed * this.state.successRate;
          this.state.packetsProcessed++;
          this.state.successRate = result.success 
            ? (successCount + 1) / this.state.packetsProcessed
            : successCount / this.state.packetsProcessed;
          
          this.state.currentPacket = undefined;
        }
        
        this.state.status = 'idle';
        await this.sleep(50); // Brief pause between executions
        
      } catch (error) {
        console.error(`[EXECUTION-${this.id}] ❌ Error:`, error);
        this.state.status = 'failed';
        await this.sleep(2000);
        this.state.status = 'idle';
      }
    }
  }
  
  // Stop execution
  stop(): void {
    this.isRunning = false;
    console.log(`[EXECUTION-${this.id}] 🛑 Stopped`);
  }
  
  // Add packet to execution queue
  addPacket(packet: HopPacket): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      console.warn(`[EXECUTION-${this.id}] ⚠️ Queue full, dropping packet ${packet.id}`);
      return false;
    }
    
    this.queue.push(packet);
    // Sort by priority (highest first)
    this.queue.sort((a, b) => b.priority - a.priority);
    return true;
  }
  
  // Get next packet (highest priority)
  private getNextPacket(): HopPacket | undefined {
    return this.queue.shift();
  }
  
  // Check gas conditions
  private async checkGasConditions(): Promise<boolean> {
    // Mock implementation - in production, check real-time gas prices
    const currentGas = await this.getCurrentGas();
    return currentGas < this.gasThreshold;
  }
  
  // Get current gas price
  private async getCurrentGas(): Promise<number> {
    // Mock implementation - simulate gas fluctuations
    const baseGas: Record<ChainId, number> = {
      'polygon': 30,
      'bsc': 5,
      'avalanche': 25,
      'arbitrum': 0.1,
      'optimism': 0.5
    };
    
    const base = baseGas[this.chain] || 50;
    const variance = base * (Math.random() * 0.5 - 0.25); // ±25% variance
    return base + variance;
  }
  
  // Execute in isolated container (prevents failure contamination)
  private async executeIsolated(packet: HopPacket): Promise<ExecutionResult> {
    try {
      // Determine execution strategy
      const strategy = this.selectStrategy(packet);
      
      // Execute based on strategy
      let result: ExecutionResult;
      
      switch (strategy) {
        case 'flashloan':
          result = await this.executeFlashLoan(packet);
          break;
        case 'multi-hop':
          result = await this.executeMultiHop(packet);
          break;
        case 'cross-chain':
          result = await this.executeCrossChain(packet);
          break;
        default:
          result = await this.executeDirect(packet);
      }
      
      return result;
      
    } catch (error) {
      // Isolated failure - doesn't affect other crawlers
      console.error(`[EXECUTION-${this.id}] ❌ Isolated failure:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  // Select execution strategy
  private selectStrategy(packet: HopPacket): 'direct' | 'flashloan' | 'multi-hop' | 'cross-chain' {
    // Use validation recommendation if available
    const hasMultiHop = packet.discovery?.hopChain && packet.discovery.hopChain.length > 0;
    const highProfit = packet.profitEstimate > 100;
    const highPriority = packet.priority > 70;
    
    if (hasMultiHop) return 'multi-hop';
    if (highProfit && highPriority) return 'flashloan';
    if (packet.chain !== this.chain) return 'cross-chain';
    return 'direct';
  }
  
  // Execution success rates
  private static readonly DIRECT_SUCCESS_RATE = 0.95;      // 95% success
  private static readonly FLASHLOAN_SUCCESS_RATE = 0.92;   // 92% success
  private static readonly CROSSCHAIN_SUCCESS_RATE = 0.85;  // 85% success
  
  // Execute direct trade
  private async executeDirect(packet: HopPacket): Promise<ExecutionResult> {
    // Mock implementation - in production, execute real DEX swap
    await this.sleep(100 + Math.random() * 200);
    
    const success = Math.random() < ExecutionCrawler.DIRECT_SUCCESS_RATE;
    
    if (success) {
      return {
        success: true,
        txHash: `0x${randomUUID().replace(/-/g, '')}`,
        gasUsed: Math.floor(150000 + Math.random() * 50000),
        profit: packet.profitEstimate * 0.9 // 90% of estimated profit
      };
    } else {
      return {
        success: false,
        error: 'Transaction reverted'
      };
    }
  }
  
  // Execute with flash loan
  private async executeFlashLoan(packet: HopPacket): Promise<ExecutionResult> {
    // Mock implementation - in production, use Aave flash loans
    await this.sleep(150 + Math.random() * 250);
    
    const success = Math.random() < ExecutionCrawler.FLASHLOAN_SUCCESS_RATE;
    
    if (success) {
      return {
        success: true,
        txHash: `0x${randomUUID().replace(/-/g, '')}`,
        gasUsed: Math.floor(300000 + Math.random() * 100000),
        profit: packet.profitEstimate * 1.5 // Flash loan allows 50% more profit
      };
    } else {
      return {
        success: false,
        error: 'Flash loan execution failed'
      };
    }
  }
  
  // Execute multi-hop trade
  private async executeMultiHop(packet: HopPacket): Promise<ExecutionResult> {
    // Mock implementation - in production, execute multi-step swaps
    const hops = packet.discovery?.hopChain?.length || 2;
    await this.sleep(hops * (100 + Math.random() * 150));
    
    const success = Math.random() > (0.05 * hops); // Success rate decreases with hops
    
    if (success) {
      return {
        success: true,
        txHash: `0x${randomUUID().replace(/-/g, '')}`,
        gasUsed: Math.floor(hops * 120000 + Math.random() * 50000),
        profit: packet.profitEstimate * 0.85 // Multi-hop has more fees
      };
    } else {
      return {
        success: false,
        error: 'Multi-hop execution failed'
      };
    }
  }
  
  // Execute cross-chain trade
  private async executeCrossChain(packet: HopPacket): Promise<ExecutionResult> {
    // Mock implementation - in production, use bridge protocols
    await this.sleep(2000 + Math.random() * 3000); // Cross-chain is slower
    
    const success = Math.random() < ExecutionCrawler.CROSSCHAIN_SUCCESS_RATE;
    
    if (success) {
      return {
        success: true,
        txHash: `0x${randomUUID().replace(/-/g, '')}`,
        gasUsed: Math.floor(500000 + Math.random() * 200000),
        profit: packet.profitEstimate * 0.7 // Bridge fees reduce profit
      };
    } else {
      return {
        success: false,
        error: 'Cross-chain bridge failed'
      };
    }
  }
  
  // Create executed hop packet
  private createExecutedPacket(packet: HopPacket, result: ExecutionResult): HopPacket {
    return {
      ...packet,
      stage: HopStage.EXECUTION,
      execution: {
        strategy: this.selectStrategy(packet),
        txHash: result.txHash,
        gasUsed: result.gasUsed,
        executedAt: Date.now(),
        status: result.success ? 'pending' : 'failed'
      },
      hopHistory: [...packet.hopHistory, HopStage.EXECUTION],
      hopCount: packet.hopCount + 1
    };
  }
  
  // Get current state
  getState(): CrawlerState {
    return { ...this.state };
  }
  
  // Get queue depth
  getQueueDepth(): number {
    return this.queue.length;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Execution Crawler Pool - Manages multiple execution crawlers per chain
export class ExecutionCrawlerPool {
  private crawlers: Map<string, ExecutionCrawler> = new Map();
  
  // Create execution crawler pool for each chain
  createForChains(chains: ChainId[], onExecuted: (packet: HopPacket) => void): Map<ChainId, ExecutionCrawler[]> {
    const poolsByChain = new Map<ChainId, ExecutionCrawler[]>();
    
    for (const chain of chains) {
      const count = this.getCrawlerCount(chain);
      const crawlers: ExecutionCrawler[] = [];
      
      for (let i = 0; i < count; i++) {
        const crawler = new ExecutionCrawler(chain);
        crawlers.push(crawler);
        this.crawlers.set(crawler.getState().id, crawler);
        
        // Start crawler
        crawler.start(onExecuted).catch(err => {
          console.error(`[POOL] Executor ${crawler.getState().id} failed:`, err);
        });
      }
      
      poolsByChain.set(chain, crawlers);
    }
    
    const total = Array.from(poolsByChain.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[POOL] ⚡ Created ${total} execution crawlers across ${chains.length} chains`);
    
    return poolsByChain;
  }
  
  // Determine crawler count based on chain characteristics
  private getCrawlerCount(chain: ChainId): number {
    // More execution crawlers for faster chains
    const counts: Record<ChainId, number> = {
      'arbitrum': 10,  // Fastest execution
      'polygon': 8,
      'avalanche': 8,
      'optimism': 6,
      'bsc': 6
    };
    
    return counts[chain] || 5;
  }
  
  // Distribute packet to appropriate chain pool
  distribute(packet: HopPacket, poolsByChain: Map<ChainId, ExecutionCrawler[]>): boolean {
    const crawlers = poolsByChain.get(packet.chain);
    if (!crawlers || crawlers.length === 0) return false;
    
    // Find crawler with smallest queue
    let minQueue = Infinity;
    let targetCrawler: ExecutionCrawler | null = null;
    
    for (const crawler of crawlers) {
      const queueDepth = crawler.getQueueDepth();
      if (queueDepth < minQueue) {
        minQueue = queueDepth;
        targetCrawler = crawler;
      }
    }
    
    if (targetCrawler) {
      return targetCrawler.addPacket(packet);
    }
    
    return false;
  }
  
  // Stop all crawlers
  stopAll(): void {
    for (const crawler of this.crawlers.values()) {
      crawler.stop();
    }
    console.log(`[POOL] 🛑 Stopped all execution crawlers`);
  }
  
  // Get all crawler states
  getStates(): CrawlerState[] {
    return Array.from(this.crawlers.values()).map(c => c.getState());
  }
}
