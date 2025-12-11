// Facet Handler Simulation Engine - Red Flag Compliance Testing
// Tests transaction strategies against 40 known compliance violations
// Target: < 5% red flag rate across 500 simulations

import { randomUUID } from 'crypto';
import type { ChainId } from '../eden/types';

// ============================================================================
// 40 KNOWN COMPLIANCE VIOLATIONS - Based on FATF, FinCEN, and Exchange Guidelines
// ============================================================================

export interface ComplianceViolation {
  id: string;
  name: string;
  category: 'structuring' | 'velocity' | 'pattern' | 'jurisdiction' | 'amount' | 'behavior' | 'identity' | 'timing';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  detectionFunction: (context: SimulationContext) => boolean;
  weight: number; // How heavily exchanges weight this violation
}

export interface SimulationContext {
  transactions: SimulatedTransaction[];
  dailyVolume: number;
  hourlyVolume: number;
  transactionCount: number;
  exchangeDistribution: Map<string, number>;
  timeOfDay: number; // 0-23
  dayOfWeek: number; // 0-6
  accountAge: number; // days
  declaredIncome: number;
  previousFlags: number;
  chainDistribution: Map<string, number>;
  pairDistribution: Map<string, number>;
  avgTransactionSize: number;
  transactionSizeVariance: number;
  timeBetweenTransactions: number[];
  consecutiveSameExchange: number;
  consecutiveSameAmount: number;
  roundNumberCount: number;
  justBelowThresholdCount: number;
}

export interface SimulatedTransaction {
  id: string;
  amount: number;
  exchange: string;
  chain: string;
  timestamp: number;
  pair: string;
  type: 'buy' | 'sell' | 'swap' | 'transfer';
}

// The 40 Known Compliance Violations
export const COMPLIANCE_VIOLATIONS: ComplianceViolation[] = [
  // ============ STRUCTURING (Smurfing) - 8 violations ============
  {
    id: 'STRUCT_001',
    name: 'Classic Structuring',
    category: 'structuring',
    severity: 'critical',
    description: 'Multiple transactions just below $10,000 threshold',
    weight: 1.0,
    detectionFunction: (ctx) => ctx.justBelowThresholdCount >= 3,
  },
  {
    id: 'STRUCT_002',
    name: 'Daily Aggregate Structuring',
    category: 'structuring',
    severity: 'critical',
    description: 'Daily total exceeds $10K via multiple small transactions',
    weight: 0.9,
    detectionFunction: (ctx) => ctx.dailyVolume > 10000 && ctx.transactionCount > 5 && ctx.avgTransactionSize < 3000,
  },
  {
    id: 'STRUCT_003',
    name: 'Round Number Structuring',
    category: 'structuring',
    severity: 'high',
    description: 'Multiple transactions with round numbers ($1000, $2000, etc.)',
    weight: 0.7,
    detectionFunction: (ctx) => ctx.roundNumberCount >= 4,
  },
  {
    id: 'STRUCT_004',
    name: 'Identical Amount Structuring',
    category: 'structuring',
    severity: 'high',
    description: 'Multiple transactions with identical or near-identical amounts',
    weight: 0.8,
    detectionFunction: (ctx) => ctx.consecutiveSameAmount >= 3,
  },
  {
    id: 'STRUCT_005',
    name: 'Multi-Exchange Structuring',
    category: 'structuring',
    severity: 'high',
    description: 'Spreading transactions across exchanges to avoid aggregation',
    weight: 0.75,
    detectionFunction: (ctx) => {
      const exchanges = ctx.exchangeDistribution.size;
      return exchanges >= 5 && ctx.dailyVolume > 8000 && ctx.avgTransactionSize < 2000;
    },
  },
  {
    id: 'STRUCT_006',
    name: 'Time-Based Structuring',
    category: 'structuring',
    severity: 'medium',
    description: 'Transactions timed to cross midnight to reset daily limits',
    weight: 0.6,
    detectionFunction: (ctx) => {
      const nearMidnight = ctx.transactions.filter(t => {
        const hour = new Date(t.timestamp).getHours();
        return hour === 23 || hour === 0;
      });
      return nearMidnight.length >= 3;
    },
  },
  {
    id: 'STRUCT_007',
    name: 'Incremental Structuring',
    category: 'structuring',
    severity: 'medium',
    description: 'Gradually increasing transaction sizes to test limits',
    weight: 0.65,
    detectionFunction: (ctx) => {
      if (ctx.transactions.length < 5) return false;
      let increasing = 0;
      for (let i = 1; i < ctx.transactions.length; i++) {
        if (ctx.transactions[i].amount > ctx.transactions[i-1].amount * 1.1) increasing++;
      }
      return increasing >= 4;
    },
  },
  {
    id: 'STRUCT_008',
    name: 'Decremental Structuring',
    category: 'structuring',
    severity: 'medium',
    description: 'Gradually decreasing transaction sizes after large initial',
    weight: 0.6,
    detectionFunction: (ctx) => {
      if (ctx.transactions.length < 5) return false;
      const first = ctx.transactions[0]?.amount || 0;
      const last = ctx.transactions[ctx.transactions.length - 1]?.amount || 0;
      return first > 5000 && last < 1000 && first > last * 5;
    },
  },

  // ============ VELOCITY (Rapid Movement) - 6 violations ============
  {
    id: 'VELOC_001',
    name: 'Rapid Fire Trading',
    category: 'velocity',
    severity: 'high',
    description: 'Too many transactions in short time period',
    weight: 0.8,
    detectionFunction: (ctx) => ctx.hourlyVolume > 5000 && ctx.transactionCount > 20,
  },
  {
    id: 'VELOC_002',
    name: 'Burst Trading',
    category: 'velocity',
    severity: 'high',
    description: 'Sudden spike in trading activity',
    weight: 0.75,
    detectionFunction: (ctx) => {
      const avgTime = ctx.timeBetweenTransactions.reduce((a, b) => a + b, 0) / ctx.timeBetweenTransactions.length;
      return avgTime < 30000 && ctx.transactionCount > 10; // Less than 30 seconds average
    },
  },
  {
    id: 'VELOC_003',
    name: 'Deposit-Withdraw Cycle',
    category: 'velocity',
    severity: 'critical',
    description: 'Funds deposited and immediately withdrawn',
    weight: 0.95,
    detectionFunction: (ctx) => {
      const buys = ctx.transactions.filter(t => t.type === 'buy').length;
      const sells = ctx.transactions.filter(t => t.type === 'sell').length;
      return Math.abs(buys - sells) <= 1 && ctx.transactionCount > 6;
    },
  },
  {
    id: 'VELOC_004',
    name: 'High Frequency Pattern',
    category: 'velocity',
    severity: 'medium',
    description: 'Consistent high-frequency trading without breaks',
    weight: 0.7,
    detectionFunction: (ctx) => {
      const minTime = Math.min(...ctx.timeBetweenTransactions);
      return minTime < 10000 && ctx.transactionCount > 15; // Less than 10 seconds
    },
  },
  {
    id: 'VELOC_005',
    name: 'Cross-Exchange Velocity',
    category: 'velocity',
    severity: 'high',
    description: 'Rapid movement between multiple exchanges',
    weight: 0.8,
    detectionFunction: (ctx) => {
      if (ctx.transactions.length < 4) return false;
      let exchangeChanges = 0;
      for (let i = 1; i < ctx.transactions.length; i++) {
        if (ctx.transactions[i].exchange !== ctx.transactions[i-1].exchange) exchangeChanges++;
      }
      return exchangeChanges >= ctx.transactions.length * 0.7;
    },
  },
  {
    id: 'VELOC_006',
    name: 'Overnight Velocity',
    category: 'velocity',
    severity: 'medium',
    description: 'Unusual trading activity during off-hours',
    weight: 0.6,
    detectionFunction: (ctx) => {
      const nightTx = ctx.transactions.filter(t => {
        const hour = new Date(t.timestamp).getHours();
        return hour >= 1 && hour <= 5;
      });
      return nightTx.length >= 5 && nightTx.reduce((s, t) => s + t.amount, 0) > 3000;
    },
  },

  // ============ PATTERN DETECTION - 8 violations ============
  {
    id: 'PATT_001',
    name: 'Mechanical Trading Pattern',
    category: 'pattern',
    severity: 'high',
    description: 'Too regular/predictable trading intervals',
    weight: 0.75,
    detectionFunction: (ctx) => {
      if (ctx.timeBetweenTransactions.length < 5) return false;
      const avg = ctx.timeBetweenTransactions.reduce((a, b) => a + b, 0) / ctx.timeBetweenTransactions.length;
      const variance = ctx.timeBetweenTransactions.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / ctx.timeBetweenTransactions.length;
      const stdDev = Math.sqrt(variance);
      return stdDev / avg < 0.15; // Less than 15% variance = too regular
    },
  },
  {
    id: 'PATT_002',
    name: 'Same Exchange Concentration',
    category: 'pattern',
    severity: 'medium',
    description: 'Excessive concentration on single exchange',
    weight: 0.6,
    detectionFunction: (ctx) => ctx.consecutiveSameExchange >= 10,
  },
  {
    id: 'PATT_003',
    name: 'Peel Chain Pattern',
    category: 'pattern',
    severity: 'critical',
    description: 'Systematic peeling of funds through multiple hops',
    weight: 0.95,
    detectionFunction: (ctx) => {
      // Detect decreasing amounts through transfers
      const transfers = ctx.transactions.filter(t => t.type === 'transfer');
      if (transfers.length < 4) return false;
      let peelCount = 0;
      for (let i = 1; i < transfers.length; i++) {
        if (transfers[i].amount < transfers[i-1].amount * 0.95) peelCount++;
      }
      return peelCount >= 3;
    },
  },
  {
    id: 'PATT_004',
    name: 'Layering Pattern',
    category: 'pattern',
    severity: 'high',
    description: 'Multiple conversion layers between assets',
    weight: 0.8,
    detectionFunction: (ctx) => {
      const uniquePairs = ctx.pairDistribution.size;
      return uniquePairs >= 6 && ctx.transactionCount > 10;
    },
  },
  {
    id: 'PATT_005',
    name: 'Mirror Trading',
    category: 'pattern',
    severity: 'high',
    description: 'Matching buy/sell patterns suggesting wash trading',
    weight: 0.85,
    detectionFunction: (ctx) => {
      const amounts = ctx.transactions.map(t => t.amount);
      const uniqueAmounts = new Set(amounts.map(a => Math.round(a / 10) * 10));
      return uniqueAmounts.size < amounts.length * 0.3 && amounts.length > 8;
    },
  },
  {
    id: 'PATT_006',
    name: 'Circular Flow',
    category: 'pattern',
    severity: 'critical',
    description: 'Funds returning to origin through complex path',
    weight: 0.9,
    detectionFunction: (ctx) => {
      const chains = ctx.transactions.map(t => t.chain);
      if (chains.length < 4) return false;
      return chains[0] === chains[chains.length - 1] && new Set(chains).size >= 3;
    },
  },
  {
    id: 'PATT_007',
    name: 'Stablecoin Shuffle',
    category: 'pattern',
    severity: 'medium',
    description: 'Excessive stablecoin-to-stablecoin conversions',
    weight: 0.65,
    detectionFunction: (ctx) => {
      const stablePairs = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD'];
      const stableTx = ctx.transactions.filter(t => 
        stablePairs.some(s => t.pair.includes(s))
      );
      return stableTx.length >= ctx.transactions.length * 0.8 && ctx.transactionCount > 5;
    },
  },
  {
    id: 'PATT_008',
    name: 'Weekend Warrior',
    category: 'pattern',
    severity: 'low',
    description: 'Unusual weekend-only trading activity',
    weight: 0.4,
    detectionFunction: (ctx) => {
      const weekendTx = ctx.transactions.filter(t => {
        const day = new Date(t.timestamp).getDay();
        return day === 0 || day === 6;
      });
      return weekendTx.length >= ctx.transactions.length * 0.9 && ctx.transactionCount > 10;
    },
  },

  // ============ AMOUNT-BASED - 6 violations ============
  {
    id: 'AMT_001',
    name: 'Threshold Proximity',
    category: 'amount',
    severity: 'critical',
    description: 'Transactions consistently near $9,500-$9,999',
    weight: 1.0,
    detectionFunction: (ctx) => {
      const nearThreshold = ctx.transactions.filter(t => t.amount >= 9000 && t.amount < 10000);
      return nearThreshold.length >= 2;
    },
  },
  {
    id: 'AMT_002',
    name: 'Micro-Transaction Flood',
    category: 'amount',
    severity: 'medium',
    description: 'Excessive very small transactions',
    weight: 0.55,
    detectionFunction: (ctx) => {
      const micro = ctx.transactions.filter(t => t.amount < 50);
      return micro.length >= 20;
    },
  },
  {
    id: 'AMT_003',
    name: 'Whale Alert',
    category: 'amount',
    severity: 'high',
    description: 'Single transaction exceeding normal range significantly',
    weight: 0.7,
    detectionFunction: (ctx) => {
      const maxTx = Math.max(...ctx.transactions.map(t => t.amount));
      return maxTx > ctx.avgTransactionSize * 10 && maxTx > 5000;
    },
  },
  {
    id: 'AMT_004',
    name: 'Volume Mismatch',
    category: 'amount',
    severity: 'high',
    description: 'Trading volume inconsistent with declared profile',
    weight: 0.8,
    detectionFunction: (ctx) => ctx.dailyVolume > ctx.declaredIncome * 0.5,
  },
  {
    id: 'AMT_005',
    name: 'Precise Amounts',
    category: 'amount',
    severity: 'medium',
    description: 'Too many transactions with exact dollar amounts',
    weight: 0.5,
    detectionFunction: (ctx) => {
      const exactDollar = ctx.transactions.filter(t => t.amount === Math.floor(t.amount));
      return exactDollar.length >= ctx.transactions.length * 0.7 && ctx.transactionCount > 5;
    },
  },
  {
    id: 'AMT_006',
    name: 'Split Large Amount',
    category: 'amount',
    severity: 'high',
    description: 'Large amount split into equal smaller parts',
    weight: 0.75,
    detectionFunction: (ctx) => {
      const amounts = ctx.transactions.map(t => t.amount);
      const sum = amounts.reduce((a, b) => a + b, 0);
      const avg = sum / amounts.length;
      const equalParts = amounts.filter(a => Math.abs(a - avg) < avg * 0.1);
      return equalParts.length >= 4 && sum > 8000;
    },
  },

  // ============ BEHAVIORAL - 6 violations ============
  {
    id: 'BEHAV_001',
    name: 'New Account Large Volume',
    category: 'behavior',
    severity: 'high',
    description: 'High volume trading on new account',
    weight: 0.8,
    detectionFunction: (ctx) => ctx.accountAge < 30 && ctx.dailyVolume > 5000,
  },
  {
    id: 'BEHAV_002',
    name: 'Sudden Activity Spike',
    category: 'behavior',
    severity: 'medium',
    description: 'Dramatic increase from historical activity',
    weight: 0.65,
    detectionFunction: (ctx) => ctx.transactionCount > 30 && ctx.previousFlags === 0,
  },
  {
    id: 'BEHAV_003',
    name: 'Inconsistent Behavior',
    category: 'behavior',
    severity: 'medium',
    description: 'Trading pattern inconsistent with historical behavior',
    weight: 0.6,
    detectionFunction: (ctx) => ctx.transactionSizeVariance > 2.0,
  },
  {
    id: 'BEHAV_004',
    name: 'Dormant Activation',
    category: 'behavior',
    severity: 'medium',
    description: 'Long dormant account suddenly active',
    weight: 0.55,
    detectionFunction: (ctx) => ctx.accountAge > 365 && ctx.previousFlags === 0 && ctx.dailyVolume > 3000,
  },
  {
    id: 'BEHAV_005',
    name: 'Multiple Session Anomaly',
    category: 'behavior',
    severity: 'medium',
    description: 'Trading from multiple sessions/locations simultaneously',
    weight: 0.7,
    detectionFunction: (ctx) => {
      // Simulate by checking chain diversity in short time
      const chainChanges = ctx.transactions.filter((t, i) => 
        i > 0 && t.chain !== ctx.transactions[i-1].chain
      ).length;
      return chainChanges >= ctx.transactions.length * 0.5;
    },
  },
  {
    id: 'BEHAV_006',
    name: 'Bot-Like Precision',
    category: 'behavior',
    severity: 'high',
    description: 'Inhuman precision in timing and amounts',
    weight: 0.75,
    detectionFunction: (ctx) => {
      const timeVariance = ctx.timeBetweenTransactions.length > 0 ?
        Math.sqrt(ctx.timeBetweenTransactions.reduce((s, t) => {
          const avg = ctx.timeBetweenTransactions.reduce((a, b) => a + b, 0) / ctx.timeBetweenTransactions.length;
          return s + Math.pow(t - avg, 2);
        }, 0) / ctx.timeBetweenTransactions.length) : 0;
      const avgTime = ctx.timeBetweenTransactions.reduce((a, b) => a + b, 0) / ctx.timeBetweenTransactions.length || 1;
      return (timeVariance / avgTime) < 0.1 && ctx.transactionCount > 10;
    },
  },

  // ============ TIMING-BASED - 6 violations ============
  {
    id: 'TIME_001',
    name: 'Clock Precision',
    category: 'timing',
    severity: 'medium',
    description: 'Transactions at exact time intervals',
    weight: 0.6,
    detectionFunction: (ctx) => {
      const intervals = ctx.timeBetweenTransactions;
      if (intervals.length < 3) return false;
      const roundedIntervals = intervals.map(i => Math.round(i / 60000) * 60000);
      const uniqueRounded = new Set(roundedIntervals);
      return uniqueRounded.size === 1 && intervals.length > 5;
    },
  },
  {
    id: 'TIME_002',
    name: 'Market Close Rush',
    category: 'timing',
    severity: 'medium',
    description: 'Concentrated activity near market close times',
    weight: 0.5,
    detectionFunction: (ctx) => {
      const closeHours = [15, 16, 21, 22]; // Various market close times
      const closeTx = ctx.transactions.filter(t => {
        const hour = new Date(t.timestamp).getHours();
        return closeHours.includes(hour);
      });
      return closeTx.length >= ctx.transactions.length * 0.7;
    },
  },
  {
    id: 'TIME_003',
    name: 'Midnight Crossing',
    category: 'timing',
    severity: 'high',
    description: 'Strategic transactions around midnight UTC',
    weight: 0.7,
    detectionFunction: (ctx) => {
      const midnightTx = ctx.transactions.filter(t => {
        const hour = new Date(t.timestamp).getUTCHours();
        return hour === 23 || hour === 0;
      });
      return midnightTx.length >= 3 && midnightTx.reduce((s, t) => s + t.amount, 0) > 5000;
    },
  },
  {
    id: 'TIME_004',
    name: 'Regular Schedule',
    category: 'timing',
    severity: 'medium',
    description: 'Trading at same times every day',
    weight: 0.55,
    detectionFunction: (ctx) => {
      const hours = ctx.transactions.map(t => new Date(t.timestamp).getHours());
      const hourCounts = new Map<number, number>();
      hours.forEach(h => hourCounts.set(h, (hourCounts.get(h) || 0) + 1));
      const maxCount = Math.max(...hourCounts.values());
      return maxCount >= ctx.transactions.length * 0.8;
    },
  },
  {
    id: 'TIME_005',
    name: 'Flash Activity',
    category: 'timing',
    severity: 'high',
    description: 'All transactions within very short window',
    weight: 0.8,
    detectionFunction: (ctx) => {
      if (ctx.transactions.length < 5) return false;
      const times = ctx.transactions.map(t => t.timestamp);
      const span = Math.max(...times) - Math.min(...times);
      return span < 300000 && ctx.transactionCount >= 5; // 5 minutes
    },
  },
  {
    id: 'TIME_006',
    name: 'Holiday Trading',
    category: 'timing',
    severity: 'low',
    description: 'Unusual trading on major holidays',
    weight: 0.35,
    detectionFunction: (ctx) => {
      // Simplified: check if weekend + high volume
      const isWeekend = ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6;
      return isWeekend && ctx.dailyVolume > 10000;
    },
  },
];

// ============================================================================
// ELITE TRANSACTION STRATEGY - Designed to avoid all 40 violations
// ============================================================================

export interface EliteStrategyConfig {
  // Amount controls
  minTransactionSize: number;
  maxTransactionSize: number;
  sweetSpotMin: number;
  sweetSpotMax: number;
  amountVarianceMin: number;
  amountVarianceMax: number;
  
  // Timing controls
  minTimeBetweenTx: number;
  maxTimeBetweenTx: number;
  timeVarianceMin: number;
  timeVarianceMax: number;
  preferredHoursStart: number;
  preferredHoursEnd: number;
  
  // Distribution controls
  maxExchangeConcentration: number;
  minExchangesPerDay: number;
  maxTransactionsPerHour: number;
  maxDailyVolume: number;
  maxHourlyVolume: number;
  
  // Pattern breaking
  patternBreakFrequency: number;
  dormantPeriodChance: number;
  dormantDurationMin: number;
  dormantDurationMax: number;
  
  // Anti-detection
  roundNumberAvoidance: number;
  thresholdBuffer: number;
  sizeClusteringAvoidance: number;
}

export const ELITE_STRATEGY_CONFIG: EliteStrategyConfig = {
  // Amount controls - Stay well below thresholds with high variance
  minTransactionSize: 75,
  maxTransactionSize: 2200,
  sweetSpotMin: 150,
  sweetSpotMax: 800,
  amountVarianceMin: 0.25,
  amountVarianceMax: 0.45,
  
  // Timing controls - Natural human-like intervals
  minTimeBetweenTx: 45000,      // 45 seconds minimum
  maxTimeBetweenTx: 420000,     // 7 minutes maximum
  timeVarianceMin: 0.3,
  timeVarianceMax: 0.6,
  preferredHoursStart: 8,
  preferredHoursEnd: 22,
  
  // Distribution controls - Spread activity widely
  maxExchangeConcentration: 0.20,  // Max 20% on any exchange
  minExchangesPerDay: 4,
  maxTransactionsPerHour: 8,
  maxDailyVolume: 7500,           // Well below $10K
  maxHourlyVolume: 1500,
  
  // Pattern breaking - Introduce natural irregularity
  patternBreakFrequency: 0.15,    // 15% chance of pattern break
  dormantPeriodChance: 0.08,      // 8% chance of going dormant
  dormantDurationMin: 600000,     // 10 minutes
  dormantDurationMax: 1800000,    // 30 minutes
  
  // Anti-detection - Avoid suspicious patterns
  roundNumberAvoidance: 0.95,     // 95% chance to add cents
  thresholdBuffer: 1500,          // Stay $1500 below $10K threshold
  sizeClusteringAvoidance: 0.9,   // 90% chance to vary from previous
};

// ============================================================================
// SIMULATION ENGINE
// ============================================================================

export interface SimulationResult {
  simulationId: string;
  transactionCount: number;
  totalVolume: number;
  violationsTriggered: string[];
  redFlagScore: number;
  passed: boolean;
  details: {
    violation: ComplianceViolation;
    triggered: boolean;
  }[];
}

export interface SimulationSummary {
  totalSimulations: number;
  passedSimulations: number;
  failedSimulations: number;
  passRate: number;
  redFlagRate: number;
  averageViolations: number;
  worstViolations: { id: string; name: string; triggerCount: number }[];
  bestViolations: { id: string; name: string; triggerCount: number }[];
}

export class FacetSimulationEngine {
  private config: EliteStrategyConfig;
  private exchanges = ['binance', 'coinbase', 'kraken', 'kucoin', 'bybit', 'okx', 'gate', 'gemini'];
  private chains: ChainId[] = ['polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'];
  private pairs = ['ETH/USDT', 'BTC/USDT', 'ETH/USDC', 'BTC/USDC', 'MATIC/USDT', 'ARB/USDT', 'OP/USDT', 'AVAX/USDT'];

  constructor(config: EliteStrategyConfig = ELITE_STRATEGY_CONFIG) {
    this.config = config;
  }

  /**
   * Generate a simulated transaction using the elite strategy
   */
  private generateTransaction(
    previousTx: SimulatedTransaction | null,
    exchangeUsage: Map<string, number>,
    totalVolume: number
  ): SimulatedTransaction {
    // Amount generation with variance
    let baseAmount = this.config.sweetSpotMin + 
      Math.random() * (this.config.sweetSpotMax - this.config.sweetSpotMin);
    
    // Apply variance
    const variance = this.config.amountVarianceMin + 
      Math.random() * (this.config.amountVarianceMax - this.config.amountVarianceMin);
    baseAmount *= (1 + (Math.random() - 0.5) * 2 * variance);
    
    // Avoid round numbers
    if (Math.random() < this.config.roundNumberAvoidance) {
      baseAmount += Math.random() * 99 + 0.01; // Add cents
    }
    
    // Avoid clustering with previous transaction
    if (previousTx && Math.random() < this.config.sizeClusteringAvoidance) {
      const diff = Math.abs(baseAmount - previousTx.amount);
      if (diff < 50) {
        baseAmount += (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 100);
      }
    }
    
    // Ensure within bounds
    baseAmount = Math.max(this.config.minTransactionSize, 
      Math.min(this.config.maxTransactionSize, baseAmount));
    
    // Stay below threshold
    if (totalVolume + baseAmount > this.config.maxDailyVolume) {
      baseAmount = Math.max(0, this.config.maxDailyVolume - totalVolume - Math.random() * 500);
    }
    
    // Exchange selection with distribution awareness
    let selectedExchange: string;
    const maxPerExchange = totalVolume * this.config.maxExchangeConcentration;
    const availableExchanges = this.exchanges.filter(ex => 
      (exchangeUsage.get(ex) || 0) < maxPerExchange || totalVolume < 1000
    );
    
    if (availableExchanges.length > 0) {
      // Prefer less-used exchanges
      const weights = availableExchanges.map(ex => {
        const usage = exchangeUsage.get(ex) || 0;
        return Math.max(1, maxPerExchange - usage);
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalWeight;
      selectedExchange = availableExchanges[0];
      for (let i = 0; i < availableExchanges.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          selectedExchange = availableExchanges[i];
          break;
        }
      }
    } else {
      selectedExchange = this.exchanges[Math.floor(Math.random() * this.exchanges.length)];
    }
    
    // Time generation
    let timestamp: number;
    if (previousTx) {
      const baseDelay = this.config.minTimeBetweenTx + 
        Math.random() * (this.config.maxTimeBetweenTx - this.config.minTimeBetweenTx);
      const timeVariance = this.config.timeVarianceMin + 
        Math.random() * (this.config.timeVarianceMax - this.config.timeVarianceMin);
      const delay = baseDelay * (1 + (Math.random() - 0.5) * 2 * timeVariance);
      timestamp = previousTx.timestamp + delay;
    } else {
      timestamp = Date.now();
    }
    
    // Avoid midnight crossing
    const hour = new Date(timestamp).getHours();
    if (hour === 23 || hour === 0) {
      timestamp += (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 120) * 60000;
    }
    
    return {
      id: `sim-${randomUUID().split('-')[0]}`,
      amount: Math.round(baseAmount * 100) / 100,
      exchange: selectedExchange,
      chain: this.chains[Math.floor(Math.random() * this.chains.length)],
      timestamp,
      pair: this.pairs[Math.floor(Math.random() * this.pairs.length)],
      type: Math.random() > 0.3 ? 'swap' : (Math.random() > 0.5 ? 'buy' : 'sell'),
    };
  }

  /**
   * Generate a full day's worth of transactions
   */
  private generateDayTransactions(): SimulatedTransaction[] {
    const transactions: SimulatedTransaction[] = [];
    const exchangeUsage = new Map<string, number>();
    let totalVolume = 0;
    let hourlyTxCount = 0;
    let currentHour = this.config.preferredHoursStart;
    
    while (totalVolume < this.config.maxDailyVolume * 0.9) {
      // Check for dormant period
      if (Math.random() < this.config.dormantPeriodChance) {
        const dormantDuration = this.config.dormantDurationMin + 
          Math.random() * (this.config.dormantDurationMax - this.config.dormantDurationMin);
        if (transactions.length > 0) {
          const lastTx = transactions[transactions.length - 1];
          const nextTimestamp = lastTx.timestamp + dormantDuration;
          currentHour = new Date(nextTimestamp).getHours();
        }
        hourlyTxCount = 0;
        continue;
      }
      
      // Check hourly limits
      if (hourlyTxCount >= this.config.maxTransactionsPerHour) {
        currentHour = (currentHour + 1) % 24;
        hourlyTxCount = 0;
        if (currentHour < this.config.preferredHoursStart || currentHour > this.config.preferredHoursEnd) {
          continue;
        }
      }
      
      // Generate transaction
      const prevTx = transactions.length > 0 ? transactions[transactions.length - 1] : null;
      const tx = this.generateTransaction(prevTx, exchangeUsage, totalVolume);
      
      if (tx.amount > 0) {
        transactions.push(tx);
        totalVolume += tx.amount;
        exchangeUsage.set(tx.exchange, (exchangeUsage.get(tx.exchange) || 0) + tx.amount);
        hourlyTxCount++;
      }
      
      // Pattern break
      if (Math.random() < this.config.patternBreakFrequency) {
        hourlyTxCount = 0;
      }
      
      // Safety limit
      if (transactions.length > 100) break;
    }
    
    return transactions;
  }

  /**
   * Build simulation context from transactions
   */
  private buildContext(transactions: SimulatedTransaction[]): SimulationContext {
    const exchangeDist = new Map<string, number>();
    const chainDist = new Map<string, number>();
    const pairDist = new Map<string, number>();
    const timeBetween: number[] = [];
    
    let dailyVolume = 0;
    let roundCount = 0;
    let justBelowCount = 0;
    let consecutiveSameExchange = 1;
    let consecutiveSameAmount = 1;
    let maxConsecExchange = 1;
    let maxConsecAmount = 1;
    
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      dailyVolume += tx.amount;
      
      // Exchange distribution
      exchangeDist.set(tx.exchange, (exchangeDist.get(tx.exchange) || 0) + tx.amount);
      
      // Chain distribution
      chainDist.set(tx.chain, (chainDist.get(tx.chain) || 0) + 1);
      
      // Pair distribution
      pairDist.set(tx.pair, (pairDist.get(tx.pair) || 0) + 1);
      
      // Time between transactions
      if (i > 0) {
        timeBetween.push(tx.timestamp - transactions[i-1].timestamp);
      }
      
      // Round numbers
      if (tx.amount === Math.round(tx.amount / 100) * 100) {
        roundCount++;
      }
      
      // Just below threshold
      if (tx.amount >= 9000 && tx.amount < 10000) {
        justBelowCount++;
      }
      
      // Consecutive same exchange
      if (i > 0 && tx.exchange === transactions[i-1].exchange) {
        consecutiveSameExchange++;
        maxConsecExchange = Math.max(maxConsecExchange, consecutiveSameExchange);
      } else {
        consecutiveSameExchange = 1;
      }
      
      // Consecutive same amount (within 5%)
      if (i > 0 && Math.abs(tx.amount - transactions[i-1].amount) < transactions[i-1].amount * 0.05) {
        consecutiveSameAmount++;
        maxConsecAmount = Math.max(maxConsecAmount, consecutiveSameAmount);
      } else {
        consecutiveSameAmount = 1;
      }
    }
    
    const amounts = transactions.map(t => t.amount);
    const avgAmount = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const variance = amounts.length > 0 ? 
      Math.sqrt(amounts.reduce((s, a) => s + Math.pow(a - avgAmount, 2), 0) / amounts.length) / avgAmount : 0;
    
    return {
      transactions,
      dailyVolume,
      hourlyVolume: dailyVolume / 14, // Assume 14-hour trading day
      transactionCount: transactions.length,
      exchangeDistribution: exchangeDist,
      timeOfDay: 12,
      dayOfWeek: 3,
      accountAge: 180, // 6 months
      declaredIncome: 100000,
      previousFlags: 0,
      chainDistribution: chainDist,
      pairDistribution: pairDist,
      avgTransactionSize: avgAmount,
      transactionSizeVariance: variance,
      timeBetweenTransactions: timeBetween,
      consecutiveSameExchange: maxConsecExchange,
      consecutiveSameAmount: maxConsecAmount,
      roundNumberCount: roundCount,
      justBelowThresholdCount: justBelowCount,
    };
  }

  /**
   * Run a single simulation
   */
  runSimulation(): SimulationResult {
    const transactions = this.generateDayTransactions();
    const context = this.buildContext(transactions);
    
    const details: { violation: ComplianceViolation; triggered: boolean }[] = [];
    const violationsTriggered: string[] = [];
    let redFlagScore = 0;
    
    for (const violation of COMPLIANCE_VIOLATIONS) {
      const triggered = violation.detectionFunction(context);
      details.push({ violation, triggered });
      
      if (triggered) {
        violationsTriggered.push(violation.id);
        redFlagScore += violation.weight;
      }
    }
    
    return {
      simulationId: randomUUID(),
      transactionCount: transactions.length,
      totalVolume: context.dailyVolume,
      violationsTriggered,
      redFlagScore,
      passed: violationsTriggered.length === 0,
      details,
    };
  }

  /**
   * Run multiple simulations and generate summary
   */
  runSimulations(count: number = 500): SimulationSummary {
    const results: SimulationResult[] = [];
    const violationCounts = new Map<string, number>();
    
    for (let i = 0; i < count; i++) {
      const result = this.runSimulation();
      results.push(result);
      
      for (const vId of result.violationsTriggered) {
        violationCounts.set(vId, (violationCounts.get(vId) || 0) + 1);
      }
    }
    
    const passedCount = results.filter(r => r.passed).length;
    const totalViolations = results.reduce((s, r) => s + r.violationsTriggered.length, 0);
    
    // Sort violations by trigger count
    const sortedViolations = Array.from(violationCounts.entries())
      .map(([id, count]) => {
        const v = COMPLIANCE_VIOLATIONS.find(v => v.id === id)!;
        return { id, name: v.name, triggerCount: count };
      })
      .sort((a, b) => b.triggerCount - a.triggerCount);
    
    return {
      totalSimulations: count,
      passedSimulations: passedCount,
      failedSimulations: count - passedCount,
      passRate: (passedCount / count) * 100,
      redFlagRate: ((count - passedCount) / count) * 100,
      averageViolations: totalViolations / count,
      worstViolations: sortedViolations.slice(0, 5),
      bestViolations: sortedViolations.slice(-5).reverse(),
    };
  }

  /**
   * Optimize strategy configuration to achieve target red flag rate
   */
  optimizeStrategy(targetRedFlagRate: number = 5, iterations: number = 10): EliteStrategyConfig {
    let bestConfig = { ...this.config };
    let bestRate = 100;
    
    for (let iter = 0; iter < iterations; iter++) {
      // Run simulation with current config
      const summary = this.runSimulations(100); // Quick test
      
      if (summary.redFlagRate < bestRate) {
        bestRate = summary.redFlagRate;
        bestConfig = { ...this.config };
      }
      
      if (summary.redFlagRate <= targetRedFlagRate) {
        break;
      }
      
      // Adjust config based on worst violations
      for (const worst of summary.worstViolations.slice(0, 3)) {
        this.adjustForViolation(worst.id);
      }
    }
    
    this.config = bestConfig;
    return bestConfig;
  }

  /**
   * Adjust configuration to avoid specific violation
   */
  private adjustForViolation(violationId: string): void {
    switch (violationId) {
      case 'STRUCT_001':
      case 'AMT_001':
        // Reduce max transaction size further from threshold
        this.config.maxTransactionSize = Math.min(this.config.maxTransactionSize, 2000);
        this.config.thresholdBuffer = Math.max(this.config.thresholdBuffer, 2000);
        break;
      case 'STRUCT_002':
        // Reduce daily volume
        this.config.maxDailyVolume *= 0.9;
        break;
      case 'STRUCT_003':
        // Increase round number avoidance
        this.config.roundNumberAvoidance = Math.min(0.99, this.config.roundNumberAvoidance + 0.02);
        break;
      case 'STRUCT_004':
        // Increase size variance
        this.config.amountVarianceMax = Math.min(0.6, this.config.amountVarianceMax + 0.05);
        break;
      case 'VELOC_001':
      case 'VELOC_002':
        // Reduce transactions per hour
        this.config.maxTransactionsPerHour = Math.max(4, this.config.maxTransactionsPerHour - 1);
        break;
      case 'PATT_001':
        // Increase time variance
        this.config.timeVarianceMax = Math.min(0.8, this.config.timeVarianceMax + 0.1);
        break;
      case 'PATT_002':
        // Reduce exchange concentration
        this.config.maxExchangeConcentration *= 0.9;
        break;
      default:
        // General adjustments
        this.config.patternBreakFrequency = Math.min(0.25, this.config.patternBreakFrequency + 0.02);
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export function runComplianceSimulation(simulations: number = 500): SimulationSummary {
  const engine = new FacetSimulationEngine();
  return engine.runSimulations(simulations);
}

export function optimizeForCompliance(targetRate: number = 5): {
  config: EliteStrategyConfig;
  summary: SimulationSummary;
} {
  const engine = new FacetSimulationEngine();
  const config = engine.optimizeStrategy(targetRate, 20);
  const summary = engine.runSimulations(500);
  return { config, summary };
}
