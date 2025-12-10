// Lux Swarm - Parallel Chain Communication via Shared State Observation
// NON-DIRECT COMMUNICATION: Agents observe shared state (like fireflies)
// No locks, no message queues, no coordination overhead
// ENHANCED v2.0: Added performance metrics, batch operations, priority queuing

type ChainId = 'polygon' | 'bsc' | 'avalanche' | 'arbitrum' | 'optimism';

interface Opportunity {
  asset: string;
  pair: string;
  chain: ChainId;
  priority: number;
  profitEstimate: number;
  timestamp: number;
  expiresAt?: number;  // TTL for opportunity
  confidence?: number; // Confidence score 0-1
  source?: string;     // Source of opportunity detection
}

interface AgentState {
  id: string;
  target: string;
  priority: number;
  status: 'scanning' | 'pursuing' | 'executing' | 'completed' | 'failed' | 'idle';
  lastUpdate: number;
  chain?: ChainId;           // Chain agent is operating on
  successRate?: number;      // Historical success rate
  executionCount?: number;   // Total executions
}

interface LuxSignal {
  opportunities: Opportunity[];
  agentStates: Map<string, AgentState>;
  blockHeight: Record<ChainId, number>;
  claimed: Set<string>;
  timestamp: number;
}

// Performance metrics for swarm optimization
interface SwarmMetrics {
  totalOpportunities: number;
  activeAgents: number;
  claimedAssets: number;
  avgResponseTime: number;
  throughput: number;
  lastMetricsUpdate: number;
}

// Global shared state - all agents observe this
class LuxSwarm {
  private static state: LuxSignal = {
    opportunities: [],
    agentStates: new Map(),
    blockHeight: { polygon: 0, bsc: 0, avalanche: 0, arbitrum: 0, optimism: 0 },
    claimed: new Set(),
    timestamp: Date.now()
  };

  private static metrics: SwarmMetrics = {
    totalOpportunities: 0,
    activeAgents: 0,
    claimedAssets: 0,
    avgResponseTime: 0,
    throughput: 0,
    lastMetricsUpdate: Date.now()
  };

  private static responseTimes: number[] = [];

  // Immutable read - all agents can read simultaneously
  static observe(): Readonly<LuxSignal> {
    const startTime = performance.now();
    
    const result = {
      ...this.state,
      agentStates: new Map(this.state.agentStates),
      blockHeight: { ...this.state.blockHeight },
      claimed: new Set(this.state.claimed),
      opportunities: [...this.state.opportunities]
    };
    
    // Track response time for metrics
    this.trackResponseTime(performance.now() - startTime);
    
    return result;
  }

  // Observe with filtering - optimized for specific queries
  static observeFiltered(filter: {
    chain?: ChainId;
    minPriority?: number;
    excludeClaimed?: boolean;
    limit?: number;
  }): Readonly<Opportunity[]> {
    let opportunities = this.state.opportunities;
    
    // Apply chain filter
    if (filter.chain) {
      opportunities = opportunities.filter(o => o.chain === filter.chain);
    }
    
    // Apply priority filter
    if (filter.minPriority !== undefined) {
      opportunities = opportunities.filter(o => o.priority >= filter.minPriority!);
    }
    
    // Exclude claimed assets
    if (filter.excludeClaimed) {
      opportunities = opportunities.filter(o => !this.state.claimed.has(o.asset));
    }
    
    // Remove expired opportunities
    const now = Date.now();
    opportunities = opportunities.filter(o => !o.expiresAt || o.expiresAt > now);
    
    // Sort by priority (descending) and apply limit
    opportunities = opportunities.sort((a, b) => b.priority - a.priority);
    
    if (filter.limit) {
      opportunities = opportunities.slice(0, filter.limit);
    }
    
    return opportunities;
  }

  // Atomic write - updates shared state with proper ordering
  static emit(update: Partial<Omit<LuxSignal, 'timestamp'>>): void {
    // Apply updates in specific order to prevent race conditions
    const newState: LuxSignal = {
      opportunities: update.opportunities !== undefined ? update.opportunities : this.state.opportunities,
      agentStates: update.agentStates !== undefined ? update.agentStates : this.state.agentStates,
      blockHeight: update.blockHeight !== undefined ? update.blockHeight : this.state.blockHeight,
      claimed: update.claimed !== undefined ? update.claimed : this.state.claimed,
      timestamp: Date.now()
    };
    
    this.state = newState;
    this.updateMetrics();
  }

  // Batch emit - optimized for multiple updates
  static emitBatch(updates: Array<Partial<Omit<LuxSignal, 'timestamp'>>>): void {
    let mergedOpportunities = this.state.opportunities;
    let mergedAgentStates = new Map(this.state.agentStates);
    let mergedBlockHeight = { ...this.state.blockHeight };
    let mergedClaimed = new Set(this.state.claimed);
    
    for (const update of updates) {
      if (update.opportunities !== undefined) {
        mergedOpportunities = update.opportunities;
      }
      if (update.agentStates !== undefined) {
        update.agentStates.forEach((state, id) => mergedAgentStates.set(id, state));
      }
      if (update.blockHeight !== undefined) {
        mergedBlockHeight = { ...mergedBlockHeight, ...update.blockHeight };
      }
      if (update.claimed !== undefined) {
        update.claimed.forEach(c => mergedClaimed.add(c));
      }
    }
    
    this.state = {
      opportunities: mergedOpportunities,
      agentStates: mergedAgentStates,
      blockHeight: mergedBlockHeight,
      claimed: mergedClaimed,
      timestamp: Date.now()
    };
    
    this.updateMetrics();
  }

  // Add opportunity with automatic deduplication
  static addOpportunity(opportunity: Opportunity): boolean {
    const key = `${opportunity.chain}:${opportunity.asset}:${opportunity.pair}`;
    
    // Check for duplicate
    const exists = this.state.opportunities.some(
      o => o.chain === opportunity.chain && o.asset === opportunity.asset && o.pair === opportunity.pair
    );
    
    if (!exists) {
      this.state.opportunities.push(opportunity);
      this.metrics.totalOpportunities++;
      return true;
    }
    
    return false;
  }

  // Claim asset atomically
  static claimAsset(asset: string, agentId: string): boolean {
    if (this.state.claimed.has(asset)) {
      return false; // Already claimed
    }
    
    this.state.claimed.add(asset);
    this.metrics.claimedAssets++;
    return true;
  }

  // Update agent state
  static updateAgent(agentId: string, state: Partial<AgentState>): void {
    const existing = this.state.agentStates.get(agentId);
    const updated: AgentState = {
      id: agentId,
      target: state.target ?? existing?.target ?? '',
      priority: state.priority ?? existing?.priority ?? 0,
      status: state.status ?? existing?.status ?? 'idle',
      lastUpdate: Date.now(),
      chain: state.chain ?? existing?.chain,
      successRate: state.successRate ?? existing?.successRate,
      executionCount: state.executionCount ?? existing?.executionCount
    };
    
    this.state.agentStates.set(agentId, updated);
  }

  // Get swarm performance metrics
  static getMetrics(): Readonly<SwarmMetrics> {
    return { ...this.metrics };
  }

  // Track response time for performance metrics
  private static trackResponseTime(time: number): void {
    this.responseTimes.push(time);
    
    // Keep only last 1000 samples
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }
  }

  // Update performance metrics
  private static updateMetrics(): void {
    const now = Date.now();
    const timeDelta = (now - this.metrics.lastMetricsUpdate) / 1000; // seconds
    
    this.metrics.totalOpportunities = this.state.opportunities.length;
    this.metrics.activeAgents = Array.from(this.state.agentStates.values())
      .filter(a => a.status !== 'idle' && a.status !== 'failed').length;
    this.metrics.claimedAssets = this.state.claimed.size;
    
    // Calculate average response time
    if (this.responseTimes.length > 0) {
      this.metrics.avgResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    }
    
    // Calculate throughput (operations per second)
    if (timeDelta > 0) {
      this.metrics.throughput = this.responseTimes.length / timeDelta;
    }
    
    this.metrics.lastMetricsUpdate = now;
  }

  // Cleanup expired opportunities and stale agent states
  static cleanup(maxAgeMs: number = 60000): number {
    const now = Date.now();
    let removed = 0;
    
    // Remove expired opportunities
    const validOpportunities = this.state.opportunities.filter(o => {
      const isExpired = o.expiresAt ? o.expiresAt < now : (now - o.timestamp > maxAgeMs);
      if (isExpired) removed++;
      return !isExpired;
    });
    
    // Remove stale agent states
    const staleAgents: string[] = [];
    this.state.agentStates.forEach((state, id) => {
      if (now - state.lastUpdate > maxAgeMs) {
        staleAgents.push(id);
        removed++;
      }
    });
    
    staleAgents.forEach(id => this.state.agentStates.delete(id));
    
    this.state.opportunities = validOpportunities;
    return removed;
  }

  // Reset state (for testing)
  static reset(): void {
    this.state = {
      opportunities: [],
      agentStates: new Map(),
      blockHeight: { polygon: 0, bsc: 0, avalanche: 0, arbitrum: 0, optimism: 0 },
      claimed: new Set(),
      timestamp: Date.now()
    };
    
    this.metrics = {
      totalOpportunities: 0,
      activeAgents: 0,
      claimedAssets: 0,
      avgResponseTime: 0,
      throughput: 0,
      lastMetricsUpdate: Date.now()
    };
    
    this.responseTimes = [];
  }
}

export { LuxSwarm, type LuxSignal, type Opportunity, type AgentState, type ChainId, type SwarmMetrics };
