// Validation Crawler - Validates discovery findings and filters bad trades
// Triple-checks liquidity, simulates slippage, evaluates syndrome risk

import { randomUUID } from 'crypto';
import { HopPacket, HopStage, ValidationResult, CrawlerState } from './types';

export class ValidationCrawler {
  private id: string;
  private state: CrawlerState;
  private isRunning: boolean = false;
  private queue: HopPacket[] = [];
  private maxQueueSize: number = 100;
  
  constructor() {
    this.id = `validation-${randomUUID().split('-')[0]}`;
    
    this.state = {
      id: this.id,
      status: 'idle',
      packetsProcessed: 0,
      successRate: 1.0,
      lastActivity: Date.now()
    };
  }
  
  // Start validation loop
  async start(onValidated: (packet: HopPacket) => void): Promise<void> {
    this.isRunning = true;
    console.log(`[VALIDATION-${this.id}] ✓ Started validation engine`);
    
    while (this.isRunning) {
      try {
        if (this.queue.length > 0) {
          this.state.status = 'processing';
          this.state.lastActivity = Date.now();
          
          // Process packet from queue
          const packet = this.queue.shift()!;
          this.state.currentPacket = packet.id;
          
          // Perform validation
          const result = await this.validate(packet);
          
          // Update packet if valid
          if (result.valid) {
            const validatedPacket = this.createValidatedPacket(packet, result);
            onValidated(validatedPacket);
            
            // Update success rate
            const successCount = this.state.packetsProcessed * this.state.successRate;
            this.state.packetsProcessed++;
            this.state.successRate = (successCount + 1) / this.state.packetsProcessed;
          } else {
            // Log rejection
            console.log(`[VALIDATION-${this.id}] ❌ Rejected: ${packet.id} - ${result.reason}`);
            
            // Update success rate
            const successCount = this.state.packetsProcessed * this.state.successRate;
            this.state.packetsProcessed++;
            this.state.successRate = successCount / this.state.packetsProcessed;
          }
          
          this.state.currentPacket = undefined;
        }
        
        this.state.status = 'idle';
        await this.sleep(100); // Brief pause between validations
        
      } catch (error) {
        console.error(`[VALIDATION-${this.id}] ❌ Error:`, error);
        this.state.status = 'failed';
        await this.sleep(2000);
        this.state.status = 'idle';
      }
    }
  }
  
  // Stop validation
  stop(): void {
    this.isRunning = false;
    console.log(`[VALIDATION-${this.id}] 🛑 Stopped`);
  }
  
  // Add packet to validation queue
  addPacket(packet: HopPacket): boolean {
    if (this.queue.length >= this.maxQueueSize) {
      console.warn(`[VALIDATION-${this.id}] ⚠️ Queue full, dropping packet ${packet.id}`);
      return false;
    }
    
    this.queue.push(packet);
    return true;
  }
  
  // Validate opportunity packet
  private async validate(packet: HopPacket): Promise<ValidationResult> {
    // Run all validation checks in parallel
    const [
      liquidityCheck,
      slippageCheck,
      mevCheck,
      syndromeCheck
    ] = await Promise.all([
      this.checkLiquidity(packet),
      this.simulateSlippage(packet),
      this.assessMEVRisk(packet),
      this.detectSyndrome(packet)
    ]);
    
    // Determine if packet is valid
    const valid = liquidityCheck.valid && 
                 slippageCheck.valid && 
                 mevCheck.valid && 
                 syndromeCheck.valid;
    
    // Combine risk scores
    const risk = {
      slippage: slippageCheck.risk,
      mev: mevCheck.risk,
      liquidity: liquidityCheck.risk,
      syndrome: syndromeCheck.syndrome
    };
    
    // Determine recommendation
    let recommendation: 'execute' | 'skip' | 'queue';
    if (!valid) {
      recommendation = 'skip';
    } else if (packet.priority > 70) {
      recommendation = 'execute';
    } else if (packet.priority > 40) {
      recommendation = 'execute';
    } else {
      recommendation = 'queue';
    }
    
    return {
      valid,
      reason: valid ? undefined : this.getFailureReason(liquidityCheck, slippageCheck, mevCheck, syndromeCheck),
      risk,
      recommendation
    };
  }
  
  // Check if liquidity really exists
  private async checkLiquidity(packet: HopPacket): Promise<{ valid: boolean; risk: number }> {
    // Mock implementation - in production, query DEX reserves
    const depth = packet.discovery?.liquidityDepth || 0;
    const required = packet.profitEstimate * 1000; // Assume we need 1000x for safe execution
    
    const valid = depth >= required;
    const risk = valid ? 0.1 : 0.9;
    
    return { valid, risk };
  }
  
  // Simulate slippage impact
  private async simulateSlippage(packet: HopPacket): Promise<{ valid: boolean; risk: number }> {
    // Mock implementation - in production, use constant product formula
    const spread = packet.discovery?.spreadDistance || 0;
    const liquidity = packet.discovery?.liquidityDepth || 100000;
    
    // Estimate slippage based on spread and liquidity
    const tradeSize = 10000; // $10k trade
    const estimatedSlippage = (tradeSize / liquidity) * 0.3; // Simplified model
    
    const valid = estimatedSlippage < 0.02; // <2% slippage
    const risk = estimatedSlippage;
    
    return { valid, risk };
  }
  
  // Assess MEV exposure risk
  private async assessMEVRisk(packet: HopPacket): Promise<{ valid: boolean; risk: number }> {
    // Mock implementation - in production, analyze mempool and MEV activity
    const profit = packet.profitEstimate;
    const priority = packet.priority;
    
    // Higher profit = higher MEV risk
    const mevRisk = Math.min(profit / 1000, 0.5);
    
    // High priority packets should use MEV protection (Flashbots)
    const valid = priority > 70 ? true : mevRisk < 0.3;
    
    return { valid, risk: mevRisk };
  }
  
  // Detect syndrome risk (fake liquidity, dead pools, etc.)
  private async detectSyndrome(packet: HopPacket): Promise<{ valid: boolean; syndrome: 'none' | 'low' | 'medium' | 'high' }> {
    // Mock implementation - in production, analyze pool history and behavior
    const dex = packet.discovery?.dex || '';
    const liquidity = packet.discovery?.liquidityDepth || 0;
    
    // Check for warning signs
    let syndromeScore = 0;
    
    // Low liquidity DEXs are suspicious
    if (liquidity < 50000) syndromeScore += 0.3;
    
    // Unknown DEXs are risky
    if (!['Uniswap', 'Sushiswap', 'PancakeSwap'].includes(dex)) syndromeScore += 0.4;
    
    // Determine syndrome level
    let syndrome: 'none' | 'low' | 'medium' | 'high';
    if (syndromeScore > 0.6) syndrome = 'high';
    else if (syndromeScore > 0.4) syndrome = 'medium';
    else if (syndromeScore > 0.2) syndrome = 'low';
    else syndrome = 'none';
    
    const valid = syndrome !== 'high';
    
    return { valid, syndrome };
  }
  
  // Create validated hop packet
  private createValidatedPacket(packet: HopPacket, result: ValidationResult): HopPacket {
    return {
      ...packet,
      stage: HopStage.VALIDATION,
      validation: {
        slippageRisk: result.risk.slippage,
        liquidityConfirmed: result.risk.liquidity < 0.2,
        mevExposure: result.risk.mev,
        syndromeRisk: result.risk.syndrome,
        validatedAt: Date.now()
      },
      hopHistory: [...packet.hopHistory, HopStage.VALIDATION],
      hopCount: packet.hopCount + 1
    };
  }
  
  // Get failure reason
  private getFailureReason(
    liquidity: { valid: boolean },
    slippage: { valid: boolean },
    mev: { valid: boolean },
    syndrome: { valid: boolean }
  ): string {
    if (!liquidity.valid) return 'Insufficient liquidity';
    if (!slippage.valid) return 'Excessive slippage risk';
    if (!mev.valid) return 'High MEV exposure';
    if (!syndrome.valid) return 'Syndrome detected (suspicious pool)';
    return 'Unknown validation failure';
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

// Validation Crawler Pool - Manages multiple validation crawlers
export class ValidationCrawlerPool {
  private crawlers: Map<string, ValidationCrawler> = new Map();
  private currentIndex: number = 0;
  
  // Create validation crawler pool
  create(count: number, onValidated: (packet: HopPacket) => void): ValidationCrawler[] {
    const pool: ValidationCrawler[] = [];
    
    for (let i = 0; i < count; i++) {
      const crawler = new ValidationCrawler();
      pool.push(crawler);
      this.crawlers.set(crawler.getState().id, crawler);
      
      // Start crawler
      crawler.start(onValidated).catch(err => {
        console.error(`[POOL] Validator ${crawler.getState().id} failed:`, err);
      });
    }
    
    console.log(`[POOL] ✓ Created ${pool.length} validation crawlers`);
    return pool;
  }
  
  // Distribute packet to least loaded crawler (round-robin with queue awareness)
  distribute(packet: HopPacket): boolean {
    const crawlers = Array.from(this.crawlers.values());
    if (crawlers.length === 0) return false;
    
    // Find crawler with smallest queue
    let minQueue = Infinity;
    let targetCrawler: ValidationCrawler | null = null;
    
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
    console.log(`[POOL] 🛑 Stopped all validation crawlers`);
  }
  
  // Get all crawler states
  getStates(): CrawlerState[] {
    return Array.from(this.crawlers.values()).map(c => c.getState());
  }
}
