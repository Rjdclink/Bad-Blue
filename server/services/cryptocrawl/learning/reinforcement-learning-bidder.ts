import logger from '../../../logger.js';

interface OpportunityContext {
  size: number;
  gasPrice: number;
  competitorCount: number;
  timeOfDay: number;
}

interface State {
  opportunitySize: 'small' | 'medium' | 'large' | 'xlarge';
  gasPrice: 'low' | 'medium' | 'high';
  competitorCount: 'few' | 'some' | 'many';
  timeOfDay: 'night' | 'morning' | 'afternoon' | 'evening';
}

type Action = 'lowBid' | 'mediumBid' | 'highBid' | 'aggressiveBid';

interface QTableEntry {
  lowBid: number;
  mediumBid: number;
  highBid: number;
  aggressiveBid: number;
}

interface CompetitorProfile {
  address: string;
  avgBid: number;
  bidStrategy: 'conservative' | 'moderate' | 'aggressive';
  successRate: number;
  activeHours: number[];
  totalBids: number;
}

class ReinforcementLearningBidder {
  private qTable: Map<string, QTableEntry> = new Map();
  private learningRate = 0.1;
  private discountFactor = 0.95;
  private epsilon = 0.1; // 10% exploration
  private epsilonDecay = 0.9995;
  private minEpsilon = 0.01;
  private competitorProfiles: Map<string, CompetitorProfile> = new Map();

  constructor() {
    this.initializeQTable();
  }

  private initializeQTable(): void {
    // Initialize Q-values to 0 for all state-action pairs
    const sizes = ['small', 'medium', 'large', 'xlarge'];
    const gasPrices = ['low', 'medium', 'high'];
    const competitors = ['few', 'some', 'many'];
    const times = ['night', 'morning', 'afternoon', 'evening'];

    for (const size of sizes) {
      for (const gasPrice of gasPrices) {
        for (const comp of competitors) {
          for (const time of times) {
            const stateKey = this.encodeState({ 
              opportunitySize: size as any, 
              gasPrice: gasPrice as any, 
              competitorCount: comp as any, 
              timeOfDay: time as any 
            });
            
            this.qTable.set(stateKey, {
              lowBid: 0,
              mediumBid: 0,
              highBid: 0,
              aggressiveBid: 0
            });
          }
        }
      }
    }

    logger.info('Q-table initialized', {
      component: 'ReinforcementLearningBidder',
      states: this.qTable.size
    });
  }

  private encodeState(state: State): string {
    return `${state.opportunitySize}|${state.gasPrice}|${state.competitorCount}|${state.timeOfDay}`;
  }

  private categorizeOpportunity(opp: OpportunityContext): State {
    // Categorize opportunity size (in USD)
    let opportunitySize: State['opportunitySize'];
    if (opp.size < 1000) opportunitySize = 'small';
    else if (opp.size < 10000) opportunitySize = 'medium';
    else if (opp.size < 50000) opportunitySize = 'large';
    else opportunitySize = 'xlarge';

    // Categorize gas price (in gwei)
    let gasPrice: State['gasPrice'];
    if (opp.gasPrice < 30) gasPrice = 'low';
    else if (opp.gasPrice < 100) gasPrice = 'medium';
    else gasPrice = 'high';

    // Categorize competitor count
    let competitorCount: State['competitorCount'];
    if (opp.competitorCount < 3) competitorCount = 'few';
    else if (opp.competitorCount < 8) competitorCount = 'some';
    else competitorCount = 'many';

    // Categorize time of day (hour)
    let timeOfDay: State['timeOfDay'];
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 6) timeOfDay = 'night';
    else if (hour >= 6 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 18) timeOfDay = 'afternoon';
    else timeOfDay = 'evening';

    return { opportunitySize, gasPrice, competitorCount, timeOfDay };
  }

  calculateOptimalBid(opp: OpportunityContext): number {
    const state = this.categorizeOpportunity(opp);
    const stateKey = this.encodeState(state);
    
    const qValues = this.qTable.get(stateKey);
    if (!qValues) {
      logger.warn('State not found in Q-table', {
        component: 'ReinforcementLearningBidder',
        state: stateKey
      });
      return this.getBidAmount('mediumBid', opp.size);
    }

    let action: Action;

    // Epsilon-greedy action selection
    if (Math.random() < this.epsilon) {
      // Exploration: random action
      const actions: Action[] = ['lowBid', 'mediumBid', 'highBid', 'aggressiveBid'];
      action = actions[Math.floor(Math.random() * actions.length)];
      
      logger.debug('Exploring with random action', {
        component: 'ReinforcementLearningBidder',
        action,
        epsilon: this.epsilon
      });
    } else {
      // Exploitation: best action
      action = Object.entries(qValues).reduce((best, [act, val]) => 
        val > qValues[best] ? act as Action : best,
        'lowBid' as Action
      );
      
      logger.debug('Exploiting best action', {
        component: 'ReinforcementLearningBidder',
        action,
        qValue: qValues[action]
      });
    }

    return this.getBidAmount(action, opp.size);
  }

  private getBidAmount(action: Action, oppSize: number): number {
    const baseGas = 50; // Base gas price in gwei
    
    switch (action) {
      case 'lowBid':
        return baseGas * 1.1; // 10% above base
      case 'mediumBid':
        return baseGas * 1.3; // 30% above base
      case 'highBid':
        return baseGas * 1.5; // 50% above base
      case 'aggressiveBid':
        return baseGas * 2.0; // 100% above base
      default:
        return baseGas * 1.3;
    }
  }

  recordOutcome(
    opp: OpportunityContext,
    bid: number,
    won: boolean,
    actualWinningBid?: number
  ): void {
    const state = this.categorizeOpportunity(opp);
    const stateKey = this.encodeState(state);
    const qValues = this.qTable.get(stateKey);
    
    if (!qValues) return;

    // Determine action taken
    const action = this.getActionFromBid(bid);
    
    // Calculate reward
    let reward: number;
    if (won) {
      reward = 1.0;
    } else if (actualWinningBid && Math.abs(bid - actualWinningBid) / actualWinningBid < 0.1) {
      reward = -0.3; // Close but lost
    } else {
      reward = -1.0; // Lost badly
    }

    // Q-learning update: Q(s,a) = Q(s,a) + α * [R + γ * max(Q(s',a')) - Q(s,a)]
    const currentQ = qValues[action];
    const maxNextQ = Math.max(...Object.values(qValues));
    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);
    
    qValues[action] = newQ;
    this.qTable.set(stateKey, qValues);

    // Decay epsilon
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);

    logger.debug('Q-value updated', {
      component: 'ReinforcementLearningBidder',
      state: stateKey,
      action,
      reward,
      oldQ: currentQ,
      newQ,
      epsilon: this.epsilon
    });
  }

  private getActionFromBid(bid: number): Action {
    const baseGas = 50;
    const multiplier = bid / baseGas;
    
    if (multiplier < 1.2) return 'lowBid';
    if (multiplier < 1.4) return 'mediumBid';
    if (multiplier < 1.7) return 'highBid';
    return 'aggressiveBid';
  }

  profileCompetitor(address: string, bid: number, won: boolean): void {
    let profile = this.competitorProfiles.get(address);
    
    if (!profile) {
      profile = {
        address,
        avgBid: bid,
        bidStrategy: 'moderate',
        successRate: won ? 1 : 0,
        activeHours: [new Date().getHours()],
        totalBids: 1
      };
    } else {
      // Update running average
      profile.avgBid = (profile.avgBid * profile.totalBids + bid) / (profile.totalBids + 1);
      profile.successRate = (profile.successRate * profile.totalBids + (won ? 1 : 0)) / (profile.totalBids + 1);
      profile.totalBids++;
      
      const currentHour = new Date().getHours();
      if (!profile.activeHours.includes(currentHour)) {
        profile.activeHours.push(currentHour);
      }
    }

    // Categorize strategy
    const baseGas = 50;
    const avgMultiplier = profile.avgBid / baseGas;
    if (avgMultiplier < 1.3) profile.bidStrategy = 'conservative';
    else if (avgMultiplier < 1.6) profile.bidStrategy = 'moderate';
    else profile.bidStrategy = 'aggressive';

    this.competitorProfiles.set(address, profile);
  }

  predictCompetitorBid(competitor: string, opp: OpportunityContext): number {
    const profile = this.competitorProfiles.get(competitor);
    
    if (!profile || profile.totalBids < 5) {
      // Not enough data
      return opp.gasPrice * 1.3;
    }

    // Adjust based on opportunity size and competitor strategy
    let multiplier = 1.0;
    
    if (profile.bidStrategy === 'aggressive') {
      multiplier = 1.5;
    } else if (profile.bidStrategy === 'moderate') {
      multiplier = 1.3;
    } else {
      multiplier = 1.1;
    }

    // Adjust for large opportunities (they bid higher)
    if (opp.size > 50000) {
      multiplier *= 1.2;
    }

    return profile.avgBid * multiplier;
  }

  getCompetitorProfile(address: string): CompetitorProfile | undefined {
    return this.competitorProfiles.get(address);
  }

  exportQTable(): Map<string, QTableEntry> {
    return new Map(this.qTable);
  }

  importQTable(qTable: Map<string, QTableEntry>): void {
    this.qTable = new Map(qTable);
    logger.info('Q-table imported', {
      component: 'ReinforcementLearningBidder',
      states: this.qTable.size
    });
  }
}

export { 
  ReinforcementLearningBidder, 
  type OpportunityContext, 
  type State, 
  type Action, 
  type CompetitorProfile 
};
