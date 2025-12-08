// Lux Swarm - Parallel Chain Communication via Shared State Observation
// NON-DIRECT COMMUNICATION: Agents observe shared state (like fireflies)
// No locks, no message queues, no coordination overhead

type ChainId = 'polygon' | 'bsc' | 'avalanche' | 'arbitrum' | 'optimism';

interface Opportunity {
  asset: string;
  pair: string;
  chain: ChainId;
  priority: number;
  profitEstimate: number;
  timestamp: number;
}

interface AgentState {
  id: string;
  target: string;
  priority: number;
  status: 'scanning' | 'pursuing' | 'executing' | 'completed' | 'failed';
  lastUpdate: number;
}

interface LuxSignal {
  opportunities: Opportunity[];
  agentStates: Map<string, AgentState>;
  blockHeight: Record<ChainId, number>;
  claimed: Set<string>;
  timestamp: number;
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

  // Immutable read - all agents can read simultaneously
  static observe(): Readonly<LuxSignal> {
    return {
      ...this.state,
      agentStates: new Map(this.state.agentStates),
      blockHeight: { ...this.state.blockHeight },
      claimed: new Set(this.state.claimed),
      opportunities: [...this.state.opportunities]
    };
  }

  // Atomic write - updates shared state
  static emit(update: Partial<Omit<LuxSignal, 'timestamp'>>): void {
    this.state = {
      ...this.state,
      ...update,
      agentStates: update.agentStates || this.state.agentStates,
      blockHeight: update.blockHeight || this.state.blockHeight,
      claimed: update.claimed || this.state.claimed,
      opportunities: update.opportunities || this.state.opportunities,
      timestamp: Date.now()
    };
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
  }
}

export { LuxSwarm, type LuxSignal, type Opportunity, type AgentState, type ChainId };
