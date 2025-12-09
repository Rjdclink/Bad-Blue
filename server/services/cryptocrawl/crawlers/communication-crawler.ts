// Communication Crawler - Lateral coordination between crawler networks
// Broadcasts opportunities, synchronizes state, escalates high-priority packets

import { randomUUID } from 'crypto';
import { HopPacket, CommunicationState, NetworkState, RiskLevel, GasCondition, CrawlerState } from './types';
import type { ChainId } from '../core/lux-swarm';

export class CommunicationCrawler {
  private id: string;
  private state: CrawlerState;
  private isRunning: boolean = false;
  private commState: CommunicationState;
  
  constructor() {
    this.id = `communication-${randomUUID().split('-')[0]}`;
    
    this.state = {
      id: this.id,
      status: 'idle',
      packetsProcessed: 0,
      successRate: 1.0,
      lastActivity: Date.now()
    };
    
    // Initialize communication state
    this.commState = {
      networks: {} as Record<ChainId, NetworkState>,
      opportunityQueue: [],
      riskLevels: {} as Record<ChainId, RiskLevel>,
      gasConditions: {} as Record<ChainId, GasCondition>,
      highPriorityPackets: new Set(),
      escalationQueue: []
    };
    
    // Initialize network states
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    for (const chain of chains) {
      this.commState.networks[chain] = {
        chain,
        blockHeight: 0,
        gasPrice: 0,
        congestion: 'low',
        discoveryCount: 0,
        validationCount: 0,
        executionCount: 0,
        lastUpdate: Date.now()
      };
      
      this.commState.riskLevels[chain] = {
        chain,
        level: 'safe',
        mevActivity: 0,
        failureRate: 0
      };
      
      this.commState.gasConditions[chain] = {
        chain,
        current: 0,
        average: 0,
        spike: false,
        recommendation: 'normal'
      };
    }
  }
  
  // Start communication loop
  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[COMMUNICATION-${this.id}] 📡 Started communication engine`);
    
    while (this.isRunning) {
      try {
        this.state.status = 'processing';
        this.state.lastActivity = Date.now();
        
        // Update network states
        await this.updateNetworkStates();
        
        // Update risk levels
        await this.updateRiskLevels();
        
        // Update gas conditions
        await this.updateGasConditions();
        
        // Process escalation queue
        await this.processEscalations();
        
        this.state.status = 'idle';
        await this.sleep(500); // Update every 500ms
        
      } catch (error) {
        console.error(`[COMMUNICATION-${this.id}] ❌ Error:`, error);
        this.state.status = 'failed';
        await this.sleep(2000);
        this.state.status = 'idle';
      }
    }
  }
  
  // Stop communication
  stop(): void {
    this.isRunning = false;
    console.log(`[COMMUNICATION-${this.id}] 🛑 Stopped`);
  }
  
  // Broadcast opportunity to all networks
  broadcast(packet: HopPacket): void {
    this.commState.opportunityQueue.push(packet);
    
    // Check if high priority
    if (packet.priority > 80) {
      this.commState.highPriorityPackets.add(packet.id);
      this.escalate(packet);
    }
  }
  
  // Escalate high-priority packet
  private escalate(packet: HopPacket): void {
    console.log(`[COMMUNICATION-${this.id}] 🚨 ESCALATING: ${packet.id} (priority ${packet.priority})`);
    this.commState.escalationQueue.push(packet);
  }
  
  // Process escalation queue
  private async processEscalations(): Promise<void> {
    while (this.commState.escalationQueue.length > 0) {
      const packet = this.commState.escalationQueue.shift()!;
      
      // Broadcast to all networks
      console.log(`[COMMUNICATION-${this.id}] 📢 Broadcasting high-priority: ${packet.id}`);
      
      // In production, this would notify all crawlers of the high-priority opportunity
      this.state.packetsProcessed++;
    }
  }
  
  // Update network states
  private async updateNetworkStates(): Promise<void> {
    for (const chain of Object.keys(this.commState.networks) as ChainId[]) {
      const network = this.commState.networks[chain];
      
      // Mock block height update
      network.blockHeight += 1;
      
      // Mock gas price update
      const baseGas: Record<ChainId, number> = {
        'polygon': 30,
        'bsc': 5,
        'avalanche': 25,
        'arbitrum': 0.1,
        'optimism': 0.5
      };
      network.gasPrice = baseGas[chain] * (0.9 + Math.random() * 0.2);
      
      // Determine congestion
      if (network.gasPrice > baseGas[chain] * 1.5) {
        network.congestion = 'high';
      } else if (network.gasPrice > baseGas[chain] * 1.2) {
        network.congestion = 'medium';
      } else {
        network.congestion = 'low';
      }
      
      network.lastUpdate = Date.now();
    }
  }
  
  // Update risk levels
  private async updateRiskLevels(): Promise<void> {
    for (const chain of Object.keys(this.commState.riskLevels) as ChainId[]) {
      const risk = this.commState.riskLevels[chain];
      
      // Mock MEV activity (0-1 range)
      risk.mevActivity = Math.random() * 0.3;
      
      // Mock failure rate (0-1 range)
      risk.failureRate = Math.random() * 0.15;
      
      // Determine risk level
      const totalRisk = risk.mevActivity + risk.failureRate;
      if (totalRisk > 0.3) {
        risk.level = 'critical';
      } else if (totalRisk > 0.2) {
        risk.level = 'warning';
      } else if (totalRisk > 0.1) {
        risk.level = 'caution';
      } else {
        risk.level = 'safe';
      }
    }
  }
  
  // Update gas conditions
  private async updateGasConditions(): Promise<void> {
    for (const chain of Object.keys(this.commState.gasConditions) as ChainId[]) {
      const gas = this.commState.gasConditions[chain];
      const network = this.commState.networks[chain];
      
      gas.current = network.gasPrice;
      
      // Calculate rolling average (simplified)
      gas.average = gas.average * 0.9 + gas.current * 0.1;
      
      // Detect gas spike
      gas.spike = gas.current > gas.average * 1.3;
      
      // Generate recommendation
      if (gas.spike) {
        gas.recommendation = 'wait';
      } else if (gas.current < gas.average * 0.8) {
        gas.recommendation = 'urgent';
      } else {
        gas.recommendation = 'normal';
      }
    }
  }
  
  // Get communication state (read-only)
  getState(): Readonly<CommunicationState> {
    return {
      networks: { ...this.commState.networks },
      opportunityQueue: [...this.commState.opportunityQueue],
      riskLevels: { ...this.commState.riskLevels },
      gasConditions: { ...this.commState.gasConditions },
      highPriorityPackets: new Set(this.commState.highPriorityPackets),
      escalationQueue: [...this.commState.escalationQueue]
    };
  }
  
  // Get crawler state
  getCrawlerState(): CrawlerState {
    return { ...this.state };
  }
  
  // Get network state for specific chain
  getNetworkState(chain: ChainId): NetworkState | undefined {
    return this.commState.networks[chain];
  }
  
  // Get risk level for specific chain
  getRiskLevel(chain: ChainId): RiskLevel | undefined {
    return this.commState.riskLevels[chain];
  }
  
  // Get gas condition for specific chain
  getGasCondition(chain: ChainId): GasCondition | undefined {
    return this.commState.gasConditions[chain];
  }
  
  // Update network counters (called by other crawlers)
  incrementCounter(chain: ChainId, type: 'discovery' | 'validation' | 'execution'): void {
    const network = this.commState.networks[chain];
    if (network) {
      switch (type) {
        case 'discovery':
          network.discoveryCount++;
          break;
        case 'validation':
          network.validationCount++;
          break;
        case 'execution':
          network.executionCount++;
          break;
      }
    }
  }
  
  // Check if network is healthy for execution
  isHealthy(chain: ChainId): boolean {
    const risk = this.commState.riskLevels[chain];
    const gas = this.commState.gasConditions[chain];
    
    // Ensure risk and gas exist before checking
    if (!risk || !gas) return false;
    
    return risk.level !== 'critical' && gas.recommendation !== 'wait';
  }
  
  // Get best chain for execution based on conditions
  getBestChain(chains: ChainId[]): ChainId | null {
    let bestChain: ChainId | null = null;
    let bestScore = -Infinity;
    
    for (const chain of chains) {
      const risk = this.commState.riskLevels[chain];
      const gas = this.commState.gasConditions[chain];
      const network = this.commState.networks[chain];
      
      // Calculate score (lower risk + lower gas = better)
      const riskScore = 1 - (risk.mevActivity + risk.failureRate);
      const gasScore = gas.average > 0 ? 1 / (gas.current / gas.average) : 1;
      const congestionScore = network.congestion === 'low' ? 1 : network.congestion === 'medium' ? 0.6 : 0.3;
      
      const score = riskScore * 0.4 + gasScore * 0.3 + congestionScore * 0.3;
      
      if (score > bestScore) {
        bestScore = score;
        bestChain = chain;
      }
    }
    
    return bestChain;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Communication Hub - Manages communication crawlers and state diffusion
export class CommunicationHub {
  private crawler: CommunicationCrawler;
  
  constructor() {
    this.crawler = new CommunicationCrawler();
  }
  
  // Start hub
  async start(): Promise<void> {
    await this.crawler.start();
    console.log('[HUB] 📡 Communication hub started');
  }
  
  // Stop hub
  stop(): void {
    this.crawler.stop();
    console.log('[HUB] 🛑 Communication hub stopped');
  }
  
  // Get communication crawler
  getCrawler(): CommunicationCrawler {
    return this.crawler;
  }
  
  // Broadcast packet to all networks
  broadcast(packet: HopPacket): void {
    this.crawler.broadcast(packet);
  }
  
  // Get global state
  getGlobalState(): Readonly<CommunicationState> {
    return this.crawler.getState();
  }
  
  // Get health status for all chains
  getHealthStatus(): Record<ChainId, boolean> {
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
    const status: Partial<Record<ChainId, boolean>> = {};
    
    for (const chain of chains) {
      status[chain] = this.crawler.isHealthy(chain);
    }
    
    return status as Record<ChainId, boolean>;
  }
  
  // Get best chain for execution
  selectBestChain(candidates: ChainId[]): ChainId | null {
    return this.crawler.getBestChain(candidates);
  }
}
