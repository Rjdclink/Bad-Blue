// TECHNIQUE 5: Adaptive Learning Engine
// Implements real-time reinforcement learning and competitor profiling
// Target: 15-20% better decision-making vs static strategies

import type { Opportunity } from '../core/lux-swarm';
import type { CompetitorProfile, RLState, RLAction, AnomalyOpportunity } from './types';

interface QValue {
  state: string;
  action: string;
  value: number;
  visits: number;
}

export class ContinuousLearningSystem {
  // Q-learning parameters
  private qTable: Map<string, Map<string, QValue>> = new Map();
  private learningRate = 0.1;
  private discountFactor = 0.95;
  private explorationRate = 0.2;

  // Competitor profiles
  private competitors: Map<string, CompetitorProfile> = new Map();
  
  // Historical opportunity data for anomaly detection
  private opportunityHistory: Array<{ profit: number; timestamp: number }> = [];
  private readonly historyWindow = 1000; // Keep last 1000 opportunities

  constructor() {
    this.initializeQTable();
  }

  /**
   * Initialize Q-table with common state-action pairs
   */
  private initializeQTable(): void {
    // Q-table will be populated dynamically as we encounter states
    console.log('[STEALTH] Reinforcement learning model initialized');
  }

  /**
   * Learn from execution outcome
   * Updates Q-values based on reward signal
   */
  learnFromOutcome(
    opportunity: Opportunity,
    action: RLAction,
    result: { success: boolean; profit: number; latency: number }
  ): void {
    const state = this.encodeState(opportunity);
    const actionKey = this.encodeAction(action);

    // Calculate reward
    const reward = this.calculateReward(result);

    // Get current Q-value
    const currentQ = this.getQValue(state, actionKey);

    // Get max Q-value for next state (we don't have next state here, so use 0)
    const maxNextQ = 0; // Simplified - in full implementation would look ahead

    // Q-learning update: Q(s,a) = Q(s,a) + α[r + γ*max(Q(s',a')) - Q(s,a)]
    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);

    // Update Q-table
    this.updateQValue(state, actionKey, newQ);

    // Store in opportunity history for anomaly detection
    this.opportunityHistory.push({
      profit: opportunity.profitEstimate,
      timestamp: Date.now()
    });

    // Keep history window
    if (this.opportunityHistory.length > this.historyWindow) {
      this.opportunityHistory.shift();
    }
  }

  /**
   * Get best action for current opportunity
   * Uses epsilon-greedy strategy for exploration vs exploitation
   */
  getBestAction(opportunity: Opportunity): RLAction {
    const state = this.encodeState(opportunity);

    // Epsilon-greedy: explore vs exploit
    if (Math.random() < this.explorationRate) {
      // Explore: random action
      return this.getRandomAction();
    }

    // Exploit: best known action
    const stateActions = this.qTable.get(state);
    if (!stateActions || stateActions.size === 0) {
      // No experience with this state, return default action
      return this.getDefaultAction(opportunity);
    }

    // Find action with highest Q-value
    let bestAction = '';
    let bestValue = -Infinity;

    stateActions.forEach((qValue, actionKey) => {
      if (qValue.value > bestValue) {
        bestValue = qValue.value;
        bestAction = actionKey;
      }
    });

    return this.decodeAction(bestAction, opportunity);
  }

  /**
   * Profile competitor behavior from on-chain history
   */
  async profileCompetitor(address: string, transactions: any[]): Promise<CompetitorProfile> {
    const existing = this.competitors.get(address);
    
    if (transactions.length === 0) {
      return existing || this.createDefaultProfile(address);
    }

    // Analyze transaction patterns
    const bids = transactions.map(tx => tx.gasPrice || 0);
    const avgBid = bids.reduce((a, b) => a + b, 0) / bids.length;
    
    // Determine strategy based on bid variance
    const variance = bids.reduce((a, b) => a + Math.pow(b - avgBid, 2), 0) / bids.length;
    const stdDev = Math.sqrt(variance);
    
    let bidStrategy: 'aggressive' | 'conservative' | 'adaptive';
    if (stdDev > avgBid * 0.5) {
      bidStrategy = 'adaptive';
    } else if (avgBid > 100) { // High average bid
      bidStrategy = 'aggressive';
    } else {
      bidStrategy = 'conservative';
    }

    // Calculate success rate (transactions that were included)
    const successfulTxs = transactions.filter(tx => tx.status === 1).length;
    const successRate = successfulTxs / transactions.length;

    // Analyze active hours
    const hours = transactions.map(tx => new Date(tx.timestamp * 1000).getHours());
    const activeHours = [...new Set(hours)];

    // Analyze chain preferences
    const chains = transactions.map(tx => tx.chain);
    const chainCounts = chains.reduce((acc: any, chain) => {
      acc[chain] = (acc[chain] || 0) + 1;
      return acc;
    }, {});
    const preferredChains = Object.keys(chainCounts).sort((a, b) => chainCounts[b] - chainCounts[a]);

    const profile: CompetitorProfile = {
      address,
      avgBid,
      bidStrategy,
      successRate,
      activeHours,
      preferences: {
        minProfit: this.estimateMinProfit(transactions),
        maxGasPrice: Math.max(...bids),
        preferredChains
      },
      lastSeen: Date.now(),
      totalTransactions: transactions.length
    };

    this.competitors.set(address, profile);
    console.log(`[STEALTH] Profiled competitor ${address}: ${bidStrategy} strategy, ${(successRate * 100).toFixed(1)}% success`);
    
    return profile;
  }

  /**
   * Predict competitor's bid based on learned profile
   */
  predictCompetitorBid(competitor: CompetitorProfile, opportunity: Opportunity): number {
    // Base prediction on average bid
    let predictedBid = competitor.avgBid;

    // Adjust based on strategy
    switch (competitor.bidStrategy) {
      case 'aggressive':
        // Aggressive bidders increase bid with profit
        predictedBid *= (1 + opportunity.profitEstimate / 1000);
        break;
      case 'conservative':
        // Conservative bidders stay consistent
        predictedBid *= 0.9;
        break;
      case 'adaptive':
        // Adaptive bidders adjust to market conditions
        predictedBid *= (0.8 + Math.random() * 0.4); // 80-120% of average
        break;
    }

    // Adjust based on time of day (if outside active hours, likely lower bid)
    const currentHour = new Date().getHours();
    if (!competitor.activeHours.includes(currentHour)) {
      predictedBid *= 0.5; // Less likely to compete
    }

    return predictedBid;
  }

  /**
   * Detect anomalies (rare high-value opportunities)
   * Uses z-score analysis: |x - μ| / σ > 3 indicates anomaly
   */
  detectAnomalies(opportunities: Opportunity[]): AnomalyOpportunity[] {
    if (this.opportunityHistory.length < 30) {
      // Not enough data for statistical analysis
      return opportunities.map(opp => ({
        opportunity: opp,
        zScore: 0,
        isAnomaly: false,
        timestamp: Date.now()
      }));
    }

    // Calculate mean and standard deviation
    const profits = this.opportunityHistory.map(h => h.profit);
    const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
    const variance = profits.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / profits.length;
    const stdDev = Math.sqrt(variance);

    // Calculate z-score for each opportunity
    return opportunities.map(opp => {
      const zScore = stdDev > 0 ? (opp.profitEstimate - mean) / stdDev : 0;
      const isAnomaly = Math.abs(zScore) > 3; // 3 standard deviations

      if (isAnomaly) {
        console.log(`[STEALTH] Anomaly detected: profit=${opp.profitEstimate}, z-score=${zScore.toFixed(2)}`);
      }

      return {
        opportunity: opp,
        zScore,
        isAnomaly,
        timestamp: Date.now()
      };
    });
  }

  /**
   * Encode state for Q-learning
   */
  private encodeState(opportunity: Opportunity): string {
    // Discretize continuous values for state space
    const profitBucket = Math.floor(opportunity.profitEstimate / 100) * 100;
    const priorityLevel = opportunity.priority > 5 ? 'high' : 'low';
    
    return `profit:${profitBucket},priority:${priorityLevel},chain:${opportunity.chain}`;
  }

  /**
   * Encode action for Q-learning
   */
  private encodeAction(action: RLAction): string {
    return `bid:${action.bidMultiplier.toFixed(1)},gas:${action.gasMultiplier.toFixed(1)},path:${action.executionPath},exec:${action.shouldExecute}`;
  }

  /**
   * Decode action from string
   */
  private decodeAction(actionKey: string, opportunity: Opportunity): RLAction {
    // Parse action string
    const parts = actionKey.split(',');
    return {
      bidMultiplier: 1.0,
      gasMultiplier: 1.0,
      executionPath: 'direct',
      shouldExecute: true
    };
  }

  /**
   * Get Q-value for state-action pair
   */
  private getQValue(state: string, action: string): number {
    const stateActions = this.qTable.get(state);
    if (!stateActions) return 0;
    
    const qValue = stateActions.get(action);
    return qValue ? qValue.value : 0;
  }

  /**
   * Update Q-value for state-action pair
   */
  private updateQValue(state: string, action: string, newValue: number): void {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, new Map());
    }
    
    const stateActions = this.qTable.get(state)!;
    const existing = stateActions.get(action);
    
    stateActions.set(action, {
      state,
      action,
      value: newValue,
      visits: existing ? existing.visits + 1 : 1
    });
  }

  /**
   * Calculate reward from execution result
   */
  private calculateReward(result: { success: boolean; profit: number; latency: number }): number {
    if (!result.success) return -1;
    
    // Reward = profit - latency penalty
    const profitReward = result.profit / 100; // Scale down
    const latencyPenalty = result.latency / 1000; // Convert to seconds
    
    return profitReward - latencyPenalty;
  }

  /**
   * Get random action for exploration
   */
  private getRandomAction(): RLAction {
    const paths: Array<'flashbots' | 'bloxroute' | 'direct'> = ['flashbots', 'bloxroute', 'direct'];
    return {
      bidMultiplier: 0.8 + Math.random() * 0.4, // 0.8-1.2
      gasMultiplier: 0.9 + Math.random() * 0.2, // 0.9-1.1
      executionPath: paths[Math.floor(Math.random() * paths.length)],
      shouldExecute: Math.random() > 0.1 // 90% execute
    };
  }

  /**
   * Get default action for unknown state
   */
  private getDefaultAction(opportunity: Opportunity): RLAction {
    return {
      bidMultiplier: 1.0,
      gasMultiplier: 1.0,
      executionPath: opportunity.profitEstimate > 500 ? 'flashbots' : 'direct',
      shouldExecute: opportunity.profitEstimate > 50
    };
  }

  /**
   * Create default competitor profile
   */
  private createDefaultProfile(address: string): CompetitorProfile {
    return {
      address,
      avgBid: 50,
      bidStrategy: 'conservative',
      successRate: 0.5,
      activeHours: [],
      preferences: {
        minProfit: 10,
        maxGasPrice: 100,
        preferredChains: []
      },
      lastSeen: Date.now(),
      totalTransactions: 0
    };
  }

  /**
   * Estimate minimum profit threshold from transactions
   */
  private estimateMinProfit(transactions: any[]): number {
    // Simple heuristic: lowest profitable transaction
    const profits = transactions
      .filter(tx => tx.profit && tx.profit > 0)
      .map(tx => tx.profit);
    
    return profits.length > 0 ? Math.min(...profits) : 10;
  }

  /**
   * Get learning statistics
   */
  getStats(): { qTableSize: number; competitorCount: number; historySize: number } {
    return {
      qTableSize: this.qTable.size,
      competitorCount: this.competitors.size,
      historySize: this.opportunityHistory.length
    };
  }
}
