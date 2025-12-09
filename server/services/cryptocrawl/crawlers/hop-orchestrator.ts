// Hop Orchestrator - Manages the complete hop chain flow
// Discovery → Validation → Execution → Monitoring → Feedback

import { HopPacket, HopStage, MonitoringFeedback } from './types';
import type { ChainId } from '../core/lux-swarm';
import { DiscoveryCrawlerFactory } from './discovery-crawler';
import { ValidationCrawlerPool } from './validation-crawler';
import { ExecutionCrawlerPool } from './execution-crawler';
import { MonitoringCrawlerPool } from './monitoring-crawler';
import { CommunicationHub } from './communication-crawler';

export class HopOrchestrator {
  private discoveryFactory: DiscoveryCrawlerFactory;
  private validationPool: ValidationCrawlerPool;
  private executionPool: ExecutionCrawlerPool;
  private monitoringPool: MonitoringCrawlerPool;
  private commHub: CommunicationHub;
  
  private executionPoolsByChain = new Map<ChainId, any[]>();
  private monitoringPoolsByChain = new Map<ChainId, any[]>();
  
  private isRunning: boolean = false;
  private stats = {
    totalDiscovered: 0,
    totalValidated: 0,
    totalExecuted: 0,
    totalMonitored: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfit: 0
  };
  
  constructor() {
    this.discoveryFactory = new DiscoveryCrawlerFactory();
    this.validationPool = new ValidationCrawlerPool();
    this.executionPool = new ExecutionCrawlerPool();
    this.monitoringPool = new MonitoringCrawlerPool();
    this.commHub = new CommunicationHub();
  }
  
  // Start the complete hop orchestration system
  async start(chains: ChainId[]): Promise<void> {
    this.isRunning = true;
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🚀 MULTI-NETWORK PARALLEL CRAWLER ARBITRAGE ENGINE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    
    // 1. Start Communication Hub (must be first)
    await this.commHub.start();
    console.log('✓ Communication Hub initialized\n');
    
    // 2. Start Monitoring Crawlers
    this.monitoringPoolsByChain = this.monitoringPool.createForChains(
      chains,
      this.handleMonitoringFeedback.bind(this)
    );
    console.log('✓ Monitoring Crawlers deployed\n');
    
    // 3. Start Execution Crawlers
    this.executionPoolsByChain = this.executionPool.createForChains(
      chains,
      this.handleExecution.bind(this)
    );
    console.log('✓ Execution Crawlers deployed\n');
    
    // 4. Start Validation Crawlers
    this.validationPool.create(
      20, // 20 parallel validators
      this.handleValidation.bind(this)
    );
    console.log('✓ Validation Crawlers deployed\n');
    
    // 5. Start Discovery Crawlers
    this.discoveryFactory.createSwarm(
      chains,
      this.handleDiscovery.bind(this)
    );
    console.log('✓ Discovery Crawlers deployed\n');
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ HOP ORCHESTRATOR FULLY OPERATIONAL');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Hop Chain Flow:');
    console.log('   Discovery → Validation → Execution → Monitoring → Feedback');
    console.log('');
    
    // Start stats reporting
    this.startStatsReporting();
  }
  
  // Stop all crawlers
  stop(): void {
    this.isRunning = false;
    
    console.log('\n🛑 Stopping Hop Orchestrator...\n');
    
    this.discoveryFactory.stopAll();
    this.validationPool.stopAll();
    this.executionPool.stopAll();
    this.monitoringPool.stopAll();
    this.commHub.stop();
    
    console.log('✅ All crawlers stopped');
    this.printFinalStats();
  }
  
  // HOP STAGE 1: Discovery → Validation
  private handleDiscovery(packet: HopPacket): void {
    this.stats.totalDiscovered++;
    
    console.log(`[HOP-1] 🔍 DISCOVERY: ${packet.asset} on ${packet.chain} (priority: ${packet.priority.toFixed(0)})`);
    
    // Broadcast to communication hub
    this.commHub.broadcast(packet);
    
    // Increment discovery counter
    this.commHub.getCrawler().incrementCounter(packet.chain, 'discovery');
    
    // Pass to validation stage
    const distributed = this.validationPool.distribute(packet);
    
    if (!distributed) {
      console.warn(`[HOP-1] ⚠️  Failed to distribute to validation: ${packet.id}`);
    }
  }
  
  // HOP STAGE 2: Validation → Execution
  private handleValidation(packet: HopPacket): void {
    this.stats.totalValidated++;
    
    console.log(`[HOP-2] ✓ VALIDATED: ${packet.asset} on ${packet.chain} (slippage: ${(packet.validation?.slippageRisk || 0).toFixed(3)})`);
    
    // Increment validation counter
    this.commHub.getCrawler().incrementCounter(packet.chain, 'validation');
    
    // Check if network is healthy before execution
    const healthy = this.commHub.getCrawler().isHealthy(packet.chain);
    if (!healthy) {
      console.warn(`[HOP-2] ⚠️  Network ${packet.chain} unhealthy, skipping execution`);
      return;
    }
    
    // Pass to execution stage
    const distributed = this.executionPool.distribute(packet, this.executionPoolsByChain);
    
    if (!distributed) {
      console.warn(`[HOP-2] ⚠️  Failed to distribute to execution: ${packet.id}`);
    }
  }
  
  // HOP STAGE 3: Execution → Monitoring
  private handleExecution(packet: HopPacket): void {
    this.stats.totalExecuted++;
    
    const success = packet.execution?.status !== 'failed';
    
    if (success) {
      console.log(`[HOP-3] ⚡ EXECUTED: ${packet.asset} via ${packet.execution?.strategy} (profit: $${(packet.execution?.profit || 0).toFixed(2)})`);
      this.stats.successfulTrades++;
      this.stats.totalProfit += packet.execution?.profit || 0;
    } else {
      console.log(`[HOP-3] ❌ FAILED: ${packet.asset} execution failed`);
      this.stats.failedTrades++;
    }
    
    // Increment execution counter
    this.commHub.getCrawler().incrementCounter(packet.chain, 'execution');
    
    // Pass to monitoring stage (even if failed, to learn from it)
    const distributed = this.monitoringPool.distribute(packet, this.monitoringPoolsByChain);
    
    if (!distributed) {
      console.warn(`[HOP-3] ⚠️  Failed to distribute to monitoring: ${packet.id}`);
    }
  }
  
  // HOP STAGE 4: Monitoring → Feedback
  private handleMonitoringFeedback(feedback: MonitoringFeedback, packet: HopPacket): void {
    this.stats.totalMonitored++;
    
    console.log(`[HOP-4] 👁️  MONITORED: ${packet.asset} settled (gas eff: ${feedback.gasEfficiency.toFixed(2)}x)`);
    
    // Process feedback recommendations
    if (feedback.recommendation !== 'none') {
      console.log(`[HOP-4] 💡 FEEDBACK: ${feedback.recommendation} for ${packet.discovery?.dex}`);
      
      // In production, this feedback would update discovery crawler parameters
      // For example:
      // - adjust-gas: increase gas estimates for this DEX
      // - adjust-slippage: increase slippage tolerance
      // - avoid-dex: temporarily blacklist this DEX
    }
    
    // Complete hop chain - packet has gone through all stages
    console.log(`[HOP-COMPLETE] ✅ Packet ${packet.id} completed full hop chain (${packet.hopCount} hops)\n`);
  }
  
  // Start periodic stats reporting
  private startStatsReporting(): void {
    const reportInterval = 10000; // Report every 10 seconds
    
    const report = () => {
      if (!this.isRunning) return;
      
      console.log('\n┌─────────────────────────────────────────────────────────────┐');
      console.log('│                    📊 SYSTEM STATISTICS                      │');
      console.log('├─────────────────────────────────────────────────────────────┤');
      console.log(`│ Discovered:     ${this.stats.totalDiscovered.toString().padStart(8)}                                   │`);
      console.log(`│ Validated:      ${this.stats.totalValidated.toString().padStart(8)}                                   │`);
      console.log(`│ Executed:       ${this.stats.totalExecuted.toString().padStart(8)}                                   │`);
      console.log(`│ Monitored:      ${this.stats.totalMonitored.toString().padStart(8)}                                   │`);
      console.log(`│ Success Rate:   ${((this.stats.successfulTrades / Math.max(this.stats.totalExecuted, 1)) * 100).toFixed(1).padStart(6)}%                                 │`);
      console.log(`│ Total Profit:   $${this.stats.totalProfit.toFixed(2).padStart(7)}                                │`);
      console.log('└─────────────────────────────────────────────────────────────┘\n');
      
      // Get communication state
      const commState = this.commHub.getGlobalState();
      
      console.log('┌─────────────────────────────────────────────────────────────┐');
      console.log('│                  🌐 NETWORK CONDITIONS                       │');
      console.log('├─────────────────────────────────────────────────────────────┤');
      
      for (const [chain, network] of Object.entries(commState.networks)) {
        const risk = commState.riskLevels[chain as ChainId];
        const gas = commState.gasConditions[chain as ChainId];
        
        const healthEmoji = risk.level === 'safe' ? '✓' : risk.level === 'caution' ? '⚠' : '❌';
        const gasEmoji = gas.spike ? '🔥' : '✓';
        
        console.log(`│ ${chain.padEnd(10)} ${healthEmoji} Risk: ${risk.level.padEnd(8)} ${gasEmoji} Gas: ${network.congestion.padEnd(6)} │`);
      }
      
      console.log('└─────────────────────────────────────────────────────────────┘\n');
      
      setTimeout(report, reportInterval);
    };
    
    setTimeout(report, reportInterval);
  }
  
  // Print final statistics
  private printFinalStats(): void {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 FINAL STATISTICS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total Discovered:     ${this.stats.totalDiscovered}`);
    console.log(`Total Validated:      ${this.stats.totalValidated}`);
    console.log(`Total Executed:       ${this.stats.totalExecuted}`);
    console.log(`Total Monitored:      ${this.stats.totalMonitored}`);
    console.log(`Successful Trades:    ${this.stats.successfulTrades}`);
    console.log(`Failed Trades:        ${this.stats.failedTrades}`);
    console.log(`Success Rate:         ${((this.stats.successfulTrades / Math.max(this.stats.totalExecuted, 1)) * 100).toFixed(2)}%`);
    console.log(`Total Profit:         $${this.stats.totalProfit.toFixed(2)}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Get monitoring analytics
    const analytics = this.monitoringPool.getAggregatedAnalytics();
    
    console.log('\n📈 PERFORMANCE ANALYTICS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Avg Profit per Trade: $${analytics.avgProfit.toFixed(2)}`);
    console.log(`Avg Slippage:         ${(analytics.avgSlippage * 100).toFixed(3)}%`);
    console.log(`Avg Gas Efficiency:   ${analytics.avgGasEfficiency.toFixed(2)}x`);
    console.log(`Overall Success Rate: ${(analytics.successRate * 100).toFixed(2)}%`);
    console.log('═══════════════════════════════════════════════════════════════\n');
  }
  
  // Get current statistics
  getStats() {
    return { ...this.stats };
  }
  
  // Get all crawler states
  getAllStates() {
    return {
      discovery: this.discoveryFactory.getStates(),
      validation: this.validationPool.getStates(),
      execution: this.executionPool.getStates(),
      monitoring: this.monitoringPool.getStates(),
      communication: this.commHub.getCrawler().getCrawlerState()
    };
  }
}
