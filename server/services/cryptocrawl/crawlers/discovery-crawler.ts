// Discovery Crawler - Sweeps DEXs and emits opportunity candidates
// Constantly compares token pairs across networks

import { randomUUID } from 'crypto';
import type { ChainId } from '../core/lux-swarm';
import { HopPacket, HopStage, DiscoveryCandidate, CrawlerState } from './types';

export class DiscoveryCrawler {
  private id: string;
  private chain: ChainId;
  private state: CrawlerState;
  private dexList: string[];
  private scanInterval: number;
  private isRunning: boolean = false;
  
  constructor(chain: ChainId, dexList: string[] = ['Uniswap', 'Sushiswap', 'PancakeSwap']) {
    this.id = `discovery-${chain}-${randomUUID().split('-')[0]}`;
    this.chain = chain;
    this.dexList = dexList;
    this.scanInterval = 2000; // 2 seconds
    
    this.state = {
      id: this.id,
      status: 'idle',
      packetsProcessed: 0,
      successRate: 1.0,
      lastActivity: Date.now()
    };
  }
  
  // Start continuous scanning
  async start(onDiscovery: (packet: HopPacket) => void): Promise<void> {
    this.isRunning = true;
    console.log(`[DISCOVERY-${this.id}] 🔍 Started scanning ${this.chain}`);
    
    while (this.isRunning) {
      try {
        this.state.status = 'scanning';
        this.state.lastActivity = Date.now();
        
        // Sweep all DEXs for opportunities
        const candidates = await this.sweepDEXs();
        
        // Convert candidates to hop packets
        for (const candidate of candidates) {
          const packet = this.createHopPacket(candidate);
          
          // Emit packet to next stage
          onDiscovery(packet);
          
          this.state.packetsProcessed++;
        }
        
        this.state.status = 'idle';
        
        // Wait before next scan
        await this.sleep(this.scanInterval);
        
      } catch (error) {
        console.error(`[DISCOVERY-${this.id}] ❌ Error:`, error);
        this.state.status = 'failed';
        await this.sleep(5000); // Wait longer on error
        this.state.status = 'idle';
      }
    }
  }
  
  // Stop scanning
  stop(): void {
    this.isRunning = false;
    console.log(`[DISCOVERY-${this.id}] 🛑 Stopped`);
  }
  
  // Sweep all DEXs for arbitrage opportunities
  private async sweepDEXs(): Promise<DiscoveryCandidate[]> {
    const candidates: DiscoveryCandidate[] = [];
    
    for (const dex of this.dexList) {
      // Scan token pairs on this DEX
      const pairs = await this.scanDEX(dex);
      candidates.push(...pairs);
    }
    
    return candidates;
  }
  
  // Scan a specific DEX for opportunities
  private async scanDEX(dex: string): Promise<DiscoveryCandidate[]> {
    // Mock implementation - in production, this would query real DEX contracts
    const candidates: DiscoveryCandidate[] = [];
    
    // Simulate finding opportunities with varying quality
    const tokenPairs = [
      { tokenA: 'USDC', tokenB: 'USDT' },
      { tokenA: 'WETH', tokenB: 'USDC' },
      { tokenA: 'WBTC', tokenB: 'WETH' }
    ];
    
    for (const pair of tokenPairs) {
      // Simulate price comparison
      const priceA = 1.0 + (Math.random() - 0.5) * 0.02; // ±1% variance
      const priceB = 1.0;
      const spread = Math.abs(priceA - priceB);
      
      // Only emit if spread is profitable
      if (spread > 0.003) { // >0.3% spread
        const liquidity = 100000 + Math.random() * 900000; // $100k-$1M
        const gasEstimate = 150000 + Math.random() * 100000;
        const estimatedProfit = spread * 10000; // Estimated profit on $10k trade
        
        candidates.push({
          dex,
          tokenA: pair.tokenA,
          tokenB: pair.tokenB,
          chain: this.chain,
          priceA,
          priceB,
          spread,
          liquidity,
          estimatedProfit,
          gasEstimate,
          confidence: 0.7 + Math.random() * 0.3 // 70-100% confidence
        });
      }
    }
    
    return candidates;
  }
  
  // Create hop packet from discovery candidate
  private createHopPacket(candidate: DiscoveryCandidate): HopPacket {
    const priority = this.calculatePriority(candidate);
    
    return {
      id: `hop-${randomUUID()}`,
      stage: HopStage.DISCOVERY,
      priority,
      timestamp: Date.now(),
      asset: candidate.tokenA,
      pair: `${candidate.tokenA}/${candidate.tokenB}`,
      chain: candidate.chain,
      profitEstimate: candidate.estimatedProfit,
      discovery: {
        dex: candidate.dex,
        spreadDistance: candidate.spread,
        liquidityDepth: candidate.liquidity,
        gasEstimate: candidate.gasEstimate,
        hopChain: [] // Can be populated for multi-hop routes
      },
      hopHistory: [HopStage.DISCOVERY],
      hopCount: 0
    };
  }
  
  // Calculate priority score for opportunity
  private calculatePriority(candidate: DiscoveryCandidate): number {
    // Priority based on: profit, spread, liquidity, confidence
    const profitScore = Math.min(candidate.estimatedProfit / 100, 100);
    const spreadScore = Math.min(candidate.spread * 10000, 100);
    const liquidityScore = Math.min(candidate.liquidity / 10000, 100);
    const confidenceScore = candidate.confidence * 100;
    
    // Weighted average
    return (
      profitScore * 0.4 +
      spreadScore * 0.2 +
      liquidityScore * 0.2 +
      confidenceScore * 0.2
    );
  }
  
  // Get current state
  getState(): CrawlerState {
    return { ...this.state };
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Discovery Crawler Factory - Creates multiple crawlers across networks
export class DiscoveryCrawlerFactory {
  private crawlers: Map<string, DiscoveryCrawler> = new Map();
  
  // Create crawler swarm for multiple chains
  createSwarm(chains: ChainId[], onDiscovery: (packet: HopPacket) => void): DiscoveryCrawler[] {
    const swarm: DiscoveryCrawler[] = [];
    
    for (const chain of chains) {
      // Create multiple crawlers per chain for parallel scanning
      const count = this.getCrawlerCount(chain);
      
      for (let i = 0; i < count; i++) {
        const crawler = new DiscoveryCrawler(chain);
        swarm.push(crawler);
        this.crawlers.set(crawler.getState().id, crawler);
        
        // Start crawler
        crawler.start(onDiscovery).catch(err => {
          console.error(`[FACTORY] Crawler ${crawler.getState().id} failed:`, err);
        });
      }
    }
    
    console.log(`[FACTORY] 🚀 Created ${swarm.length} discovery crawlers`);
    return swarm;
  }
  
  // Determine crawler count based on chain characteristics
  private getCrawlerCount(chain: ChainId): number {
    // More crawlers for faster chains
    const counts: Record<ChainId, number> = {
      'arbitrum': 5,  // Fastest (250ms blocks)
      'polygon': 3,   // Fast (2s blocks)
      'avalanche': 3, // Fast (2s blocks)
      'optimism': 2,  // Medium (2s blocks)
      'bsc': 2        // Medium (3s blocks)
    };
    
    return counts[chain] || 1;
  }
  
  // Stop all crawlers
  stopAll(): void {
    for (const crawler of this.crawlers.values()) {
      crawler.stop();
    }
    console.log(`[FACTORY] 🛑 Stopped all crawlers`);
  }
  
  // Get all crawler states
  getStates(): CrawlerState[] {
    return Array.from(this.crawlers.values()).map(c => c.getState());
  }
}
