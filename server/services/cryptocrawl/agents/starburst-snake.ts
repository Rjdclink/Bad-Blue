// LEGACY COMPATIBILITY SHELL
//
// The historical Starburst Snake path used sleeps/randomized timing as a stand-in
// for execution. It is retained for import compatibility only. Canonical trading
// must use verified opportunity plans, governance, execution, settlement, and
// terminal feedback paths.

import { randomUUID } from 'crypto';
import type { Opportunity, ChainId } from '../core/lux-swarm';

class SnakeAgent {
  id: string;
  priority: number;
  target: string;
  chain: ChainId;
  state: Record<string, any>;

  constructor(opp: Opportunity, parentState?: Record<string, any>, _canShed = true) {
    this.id = `legacy-snake-${Date.now()}-${randomUUID().split('-')[0]}`;
    this.priority = opp.priority;
    this.target = opp.asset;
    this.chain = opp.chain;
    this.state = parentState || { depth: 0, spawned: [] };
  }

  async crawl(): Promise<void> {}

  shed(): SnakeAgent {
    return new SnakeAgent({
      asset: this.target,
      pair: `${this.target}/USDT`,
      chain: this.chain,
      priority: this.priority,
      profitEstimate: 0,
      timestamp: Date.now(),
    }, { ...this.state, parent: this.id }, false);
  }

  pursue(opp: Opportunity): void {
    this.target = opp.asset;
    this.priority = opp.priority;
    this.chain = opp.chain;
  }

  /** Compatibility-only: never represents a submitted or settled trade. */
  async strike(_asset: string): Promise<void> {}
}

class StarburstWave {
  /** Compatibility-only: returns inert agents and performs no execution. */
  async burst(opps: Opportunity[]): Promise<SnakeAgent[]> {
    return opps.map(opp => new SnakeAgent(opp));
  }
}

export { SnakeAgent, StarburstWave };
