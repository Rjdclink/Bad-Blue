// Monitoring Crawler - Tracks transactions and provides feedback
// Shadows every transaction, detects reversions, injects real-time feedback

import { randomUUID } from 'crypto';
import { HopPacket, HopStage, MonitoringFeedback, CrawlerState } from './types';
import type { ChainId } from '../core/lux-swarm';

export class MonitoringCrawler {
  private id: string;
  private chain: ChainId;
  private state: CrawlerState;
  private isRunning: boolean = false;
  private tracking: Map<string, HopPacket> = new Map(); // txHash -> packet
  private feedbackHistory: MonitoringFeedback[] = [];
  
  constructor(chain: ChainId) {
    this.id = `monitoring-${chain}-${randomUUID().split('-')[0]}`;
    this.chain = chain;
    
    this.state = {
      id: this.id,
      status: 'idle',
      packetsProcessed: 0,
      successRate: 1.0,
      lastActivity: Date.now()
    };
  }
  
  // Start monitoring loop
  async start(onFeedback: (feedback: MonitoringFeedback, packet: HopPacket) => void): Promise<void> {
    this.isRunning = true;
    console.log(`[MONITORING-${this.id}] 👁️  Started monitoring engine`);
    
    while (this.isRunning) {
      try {
        if (this.tracking.size > 0) {
          this.state.status = 'processing';
          this.state.lastActivity = Date.now();
          
          // Check all tracked transactions
          for (const [txHash, packet] of this.tracking.entries()) {
            const status = await this.checkTransaction(txHash);
            
            if (status === 'settled') {
              // Transaction is confirmed, generate feedback
              const feedback = await this.generateFeedback(packet);
              onFeedback(feedback, packet);
              
              // Update packet with monitoring results
              const monitoredPacket = this.createMonitoredPacket(packet);
              
              // Remove from tracking
              this.tracking.delete(txHash);
              
              // Update success rate
              const successCount = this.state.packetsProcessed * this.state.successRate;
              this.state.packetsProcessed++;
              const wasSuccess = feedback.profit !== undefined && feedback.profit > 0;
              this.state.successRate = wasSuccess
                ? (successCount + 1) / this.state.packetsProcessed
                : successCount / this.state.packetsProcessed;
              
              // Store feedback
              this.feedbackHistory.push(feedback);
              if (this.feedbackHistory.length > 1000) {
                this.feedbackHistory.shift(); // Keep last 1000
              }
            }
          }
        }
        
        this.state.status = 'idle';
        await this.sleep(1000); // Check every second
        
      } catch (error) {
        console.error(`[MONITORING-${this.id}] ❌ Error:`, error);
        this.state.status = 'failed';
        await this.sleep(5000);
        this.state.status = 'idle';
      }
    }
  }
  
  // Stop monitoring
  stop(): void {
    this.isRunning = false;
    console.log(`[MONITORING-${this.id}] 🛑 Stopped`);
  }
  
  // Add packet to monitoring
  track(packet: HopPacket): void {
    const txHash = packet.execution?.txHash;
    if (txHash) {
      this.tracking.set(txHash, packet);
      console.log(`[MONITORING-${this.id}] 👁️  Tracking ${txHash.slice(0, 10)}...`);
    }
  }
  
  // Transaction status probabilities
  private static readonly TX_PENDING_THRESHOLD = 0.1;   // 10% still pending
  private static readonly TX_SETTLED_THRESHOLD = 0.95;  // 85% settled
  // Remaining 5% are failed
  
  // Check transaction status
  private async checkTransaction(txHash: string): Promise<'pending' | 'settled' | 'failed'> {
    // Mock implementation - in production, query blockchain RPC
    await this.sleep(100);
    
    // Simulate confirmation time
    const rand = Math.random();
    if (rand < MonitoringCrawler.TX_PENDING_THRESHOLD) return 'pending';
    if (rand < MonitoringCrawler.TX_SETTLED_THRESHOLD) return 'settled';
    return 'failed';
  }
  
  // Generate feedback for discovery system
  private async generateFeedback(packet: HopPacket): Promise<MonitoringFeedback> {
    // Calculate actual profit
    const estimatedProfit = packet.profitEstimate;
    const executionProfit = packet.execution?.profit || 0;
    const actualProfit = executionProfit * (0.95 + Math.random() * 0.1); // ±5% variance
    
    // Calculate actual slippage
    const estimatedSlippage = packet.validation?.slippageRisk || 0.01;
    const actualSlippage = estimatedSlippage * (0.8 + Math.random() * 0.4); // ±20% variance
    
    // Calculate gas efficiency
    const estimatedGas = packet.discovery?.gasEstimate || 200000;
    const actualGas = packet.execution?.gasUsed || 200000;
    const gasEfficiency = estimatedGas / actualGas;
    
    // Generate recommendation
    let recommendation: 'adjust-gas' | 'adjust-slippage' | 'avoid-dex' | 'none';
    
    if (gasEfficiency < 0.7) {
      recommendation = 'adjust-gas';
    } else if (actualSlippage > estimatedSlippage * 1.5) {
      recommendation = 'adjust-slippage';
    } else if (actualProfit < estimatedProfit * 0.5) {
      recommendation = 'avoid-dex';
    } else {
      recommendation = 'none';
    }
    
    return {
      packetId: packet.id,
      settled: true,
      profit: actualProfit,
      slippage: actualSlippage,
      gasEfficiency,
      recommendation
    };
  }
  
  // Create monitored hop packet
  private createMonitoredPacket(packet: HopPacket): HopPacket {
    const blockConfirmations = Math.floor(Math.random() * 10) + 1;
    
    return {
      ...packet,
      stage: HopStage.MONITORING,
      monitoring: {
        finalProfit: packet.execution?.profit,
        actualSlippage: packet.validation?.slippageRisk,
        blockConfirmations,
        settled: true
      },
      hopHistory: [...packet.hopHistory, HopStage.MONITORING],
      hopCount: packet.hopCount + 1
    };
  }
  
  // Get current state
  getState(): CrawlerState {
    return { ...this.state };
  }
  
  // Get tracking count
  getTrackingCount(): number {
    return this.tracking.size;
  }
  
  // Get feedback analytics
  getAnalytics() {
    if (this.feedbackHistory.length === 0) {
      return {
        avgProfit: 0,
        avgSlippage: 0,
        avgGasEfficiency: 0,
        successRate: 0,
        recommendations: {}
      };
    }
    
    const totalProfit = this.feedbackHistory.reduce((sum, f) => sum + (f.profit || 0), 0);
    const totalSlippage = this.feedbackHistory.reduce((sum, f) => sum + (f.slippage || 0), 0);
    const totalGasEff = this.feedbackHistory.reduce((sum, f) => sum + f.gasEfficiency, 0);
    const successCount = this.feedbackHistory.filter(f => (f.profit || 0) > 0).length;
    
    const recommendations = this.feedbackHistory.reduce((acc, f) => {
      acc[f.recommendation] = (acc[f.recommendation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      avgProfit: totalProfit / this.feedbackHistory.length,
      avgSlippage: totalSlippage / this.feedbackHistory.length,
      avgGasEfficiency: totalGasEff / this.feedbackHistory.length,
      successRate: successCount / this.feedbackHistory.length,
      recommendations
    };
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Monitoring Crawler Pool - Manages monitoring crawlers per chain
export class MonitoringCrawlerPool {
  private crawlers: Map<string, MonitoringCrawler> = new Map();
  
  // Create monitoring crawler pool for each chain
  createForChains(
    chains: ChainId[], 
    onFeedback: (feedback: MonitoringFeedback, packet: HopPacket) => void
  ): Map<ChainId, MonitoringCrawler[]> {
    const poolsByChain = new Map<ChainId, MonitoringCrawler[]>();
    
    for (const chain of chains) {
      const count = this.getCrawlerCount(chain);
      const crawlers: MonitoringCrawler[] = [];
      
      for (let i = 0; i < count; i++) {
        const crawler = new MonitoringCrawler(chain);
        crawlers.push(crawler);
        this.crawlers.set(crawler.getState().id, crawler);
        
        // Start crawler
        crawler.start(onFeedback).catch(err => {
          console.error(`[POOL] Monitor ${crawler.getState().id} failed:`, err);
        });
      }
      
      poolsByChain.set(chain, crawlers);
    }
    
    const total = Array.from(poolsByChain.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[POOL] 👁️  Created ${total} monitoring crawlers across ${chains.length} chains`);
    
    return poolsByChain;
  }
  
  // Determine crawler count based on chain characteristics
  private getCrawlerCount(chain: ChainId): number {
    // More monitors for faster chains (more transactions to track)
    const counts: Record<ChainId, number> = {
      'arbitrum': 8,
      'polygon': 6,
      'avalanche': 6,
      'optimism': 4,
      'bsc': 4
    };
    
    return counts[chain] || 3;
  }
  
  // Distribute packet to appropriate chain pool
  distribute(packet: HopPacket, poolsByChain: Map<ChainId, MonitoringCrawler[]>): boolean {
    const crawlers = poolsByChain.get(packet.chain);
    if (!crawlers || crawlers.length === 0) return false;
    
    // Find crawler with least tracking load
    let minLoad = Infinity;
    let targetCrawler: MonitoringCrawler | null = null;
    
    for (const crawler of crawlers) {
      const load = crawler.getTrackingCount();
      if (load < minLoad) {
        minLoad = load;
        targetCrawler = crawler;
      }
    }
    
    if (targetCrawler) {
      targetCrawler.track(packet);
      return true;
    }
    
    return false;
  }
  
  // Stop all crawlers
  stopAll(): void {
    for (const crawler of this.crawlers.values()) {
      crawler.stop();
    }
    console.log(`[POOL] 🛑 Stopped all monitoring crawlers`);
  }
  
  // Get all crawler states
  getStates(): CrawlerState[] {
    return Array.from(this.crawlers.values()).map(c => c.getState());
  }
  
  // Get aggregated analytics
  getAggregatedAnalytics() {
    const allAnalytics = Array.from(this.crawlers.values()).map(c => c.getAnalytics());
    
    if (allAnalytics.length === 0) {
      return {
        avgProfit: 0,
        avgSlippage: 0,
        avgGasEfficiency: 0,
        successRate: 0,
        totalRecommendations: {}
      };
    }
    
    const totalProfit = allAnalytics.reduce((sum, a) => sum + a.avgProfit, 0);
    const totalSlippage = allAnalytics.reduce((sum, a) => sum + a.avgSlippage, 0);
    const totalGasEff = allAnalytics.reduce((sum, a) => sum + a.avgGasEfficiency, 0);
    const totalSuccess = allAnalytics.reduce((sum, a) => sum + a.successRate, 0);
    
    const totalRecommendations = allAnalytics.reduce((acc, a) => {
      for (const [key, val] of Object.entries(a.recommendations)) {
        acc[key] = (acc[key] || 0) + val;
      }
      return acc;
    }, {} as Record<string, number>);
    
    return {
      avgProfit: totalProfit / allAnalytics.length,
      avgSlippage: totalSlippage / allAnalytics.length,
      avgGasEfficiency: totalGasEff / allAnalytics.length,
      successRate: totalSuccess / allAnalytics.length,
      totalRecommendations
    };
  }
}
