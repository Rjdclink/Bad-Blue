// Facet Handler Real-World High-Risk Scenario Testing
// Comprehensive testing against actual exchange monitoring patterns
// Tests: 500 simulations across 40 violations with high-risk scenarios

import {
  FacetSimulationEngine,
  COMPLIANCE_VIOLATIONS,
  ELITE_STRATEGY_CONFIG,
  type SimulationContext,
  type SimulatedTransaction,
  type SimulationResult,
  type SimulationSummary,
  type EliteStrategyConfig,
} from './facet-simulation';
import { randomUUID } from 'crypto';
import type { ChainId } from '../eden/types';

// ============================================================================
// HIGH-RISK REAL-WORLD SCENARIOS
// ============================================================================

export interface HighRiskScenario {
  id: string;
  name: string;
  description: string;
  riskLevel: 'extreme' | 'high' | 'elevated' | 'moderate';
  realWorldExample: string;
  setupFunction: (baseConfig: EliteStrategyConfig) => ScenarioContext;
  expectedChallenges: string[];
}

export interface ScenarioContext {
  config: EliteStrategyConfig;
  accountAge: number;
  declaredIncome: number;
  previousFlags: number;
  targetDailyVolume: number;
  exchangeRestrictions: string[];
  timeRestrictions: { start: number; end: number };
  additionalRiskFactors: string[];
}

export interface ScenarioTestResult {
  scenario: HighRiskScenario;
  simulations: number;
  passed: number;
  failed: number;
  redFlagRate: number;
  averageViolations: number;
  criticalViolations: number;
  worstViolations: { id: string; name: string; count: number }[];
  riskAssessment: 'SAFE' | 'CAUTION' | 'WARNING' | 'DANGER';
  recommendations: string[];
}

// 20 High-Risk Real-World Scenarios
export const HIGH_RISK_SCENARIOS: HighRiskScenario[] = [
  // ============ EXTREME RISK SCENARIOS ============
  {
    id: 'HRS_001',
    name: 'New Account Whale',
    description: 'Brand new account attempting high-volume trading',
    riskLevel: 'extreme',
    realWorldExample: 'Binance and Coinbase flag new accounts with >$5K daily volume within first 30 days',
    setupFunction: (base) => ({
      config: { ...base, maxDailyVolume: 8000, maxTransactionSize: 1500 },
      accountAge: 7,
      declaredIncome: 50000,
      previousFlags: 0,
      targetDailyVolume: 8000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 0, end: 24 },
      additionalRiskFactors: ['new_account', 'high_volume_intent'],
    }),
    expectedChallenges: ['BEHAV_001', 'AMT_004', 'BEHAV_002'],
  },
  {
    id: 'HRS_002',
    name: 'Threshold Dancer',
    description: 'Operating very close to $10K CTR threshold',
    riskLevel: 'extreme',
    realWorldExample: 'FinCEN specifically monitors for transactions between $8K-$9.9K',
    setupFunction: (base) => ({
      config: { ...base, maxDailyVolume: 9500, sweetSpotMax: 2000, thresholdBuffer: 500 },
      accountAge: 90,
      declaredIncome: 75000,
      previousFlags: 0,
      targetDailyVolume: 9500,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 20 },
      additionalRiskFactors: ['threshold_proximity', 'high_daily_aggregate'],
    }),
    expectedChallenges: ['STRUCT_001', 'STRUCT_002', 'AMT_001'],
  },
  {
    id: 'HRS_003',
    name: 'Rapid Liquidation',
    description: 'Converting large crypto holdings to fiat quickly',
    riskLevel: 'extreme',
    realWorldExample: 'Kraken and Gemini freeze accounts showing rapid sell-off patterns',
    setupFunction: (base) => ({
      config: { ...base, maxTransactionsPerHour: 12, minTimeBetweenTx: 30000 },
      accountAge: 180,
      declaredIncome: 100000,
      previousFlags: 1,
      targetDailyVolume: 7000,
      exchangeRestrictions: ['gate', 'huobi'],
      timeRestrictions: { start: 9, end: 17 },
      additionalRiskFactors: ['sell_pressure', 'velocity_concern'],
    }),
    expectedChallenges: ['VELOC_001', 'VELOC_003', 'PATT_005'],
  },
  {
    id: 'HRS_004',
    name: 'Cross-Border Arbitrage',
    description: 'High-frequency trading across multiple jurisdictions',
    riskLevel: 'extreme',
    realWorldExample: 'OKX and Bybit monitor for geographic arbitrage patterns',
    setupFunction: (base) => ({
      config: { ...base, maxExchangeConcentration: 0.15, minExchangesPerDay: 6 },
      accountAge: 120,
      declaredIncome: 150000,
      previousFlags: 0,
      targetDailyVolume: 6000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 0, end: 24 },
      additionalRiskFactors: ['multi_jurisdiction', 'arbitrage_pattern'],
    }),
    expectedChallenges: ['VELOC_005', 'PATT_004', 'BEHAV_005'],
  },

  // ============ HIGH RISK SCENARIOS ============
  {
    id: 'HRS_005',
    name: 'Weekend Warrior',
    description: 'Concentrated trading activity during weekends only',
    riskLevel: 'high',
    realWorldExample: 'Coinbase compliance flags accounts with >80% weekend activity',
    setupFunction: (base) => ({
      config: { ...base, preferredHoursStart: 10, preferredHoursEnd: 22 },
      accountAge: 60,
      declaredIncome: 80000,
      previousFlags: 0,
      targetDailyVolume: 5000,
      exchangeRestrictions: ['binance'],
      timeRestrictions: { start: 10, end: 22 },
      additionalRiskFactors: ['weekend_concentration', 'timing_anomaly'],
    }),
    expectedChallenges: ['PATT_008', 'TIME_006', 'TIME_004'],
  },
  {
    id: 'HRS_006',
    name: 'Stablecoin Shuffle',
    description: 'High volume of stablecoin-to-stablecoin conversions',
    riskLevel: 'high',
    realWorldExample: 'Circle and Tether monitoring flags excessive USDT/USDC swaps',
    setupFunction: (base) => ({
      config: { ...base, maxDailyVolume: 6000 },
      accountAge: 200,
      declaredIncome: 90000,
      previousFlags: 0,
      targetDailyVolume: 6000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 20 },
      additionalRiskFactors: ['stablecoin_heavy', 'conversion_pattern'],
    }),
    expectedChallenges: ['PATT_007', 'PATT_004', 'VELOC_003'],
  },
  {
    id: 'HRS_007',
    name: 'Bot Signature',
    description: 'Trading patterns that appear automated',
    riskLevel: 'high',
    realWorldExample: 'All major exchanges use ML to detect bot-like precision',
    setupFunction: (base) => ({
      config: { ...base, timeVarianceMin: 0.1, timeVarianceMax: 0.2, amountVarianceMin: 0.1 },
      accountAge: 150,
      declaredIncome: 120000,
      previousFlags: 0,
      targetDailyVolume: 5500,
      exchangeRestrictions: [],
      timeRestrictions: { start: 6, end: 22 },
      additionalRiskFactors: ['low_variance', 'mechanical_pattern'],
    }),
    expectedChallenges: ['PATT_001', 'BEHAV_006', 'TIME_001'],
  },
  {
    id: 'HRS_008',
    name: 'Dormant Awakening',
    description: 'Long-dormant account suddenly becomes very active',
    riskLevel: 'high',
    realWorldExample: 'Gemini flags accounts dormant >6 months that suddenly trade >$3K/day',
    setupFunction: (base) => ({
      config: { ...base, maxDailyVolume: 5000 },
      accountAge: 400,
      declaredIncome: 60000,
      previousFlags: 0,
      targetDailyVolume: 5000,
      exchangeRestrictions: ['kucoin', 'gate'],
      timeRestrictions: { start: 9, end: 18 },
      additionalRiskFactors: ['dormant_reactivation', 'sudden_activity'],
    }),
    expectedChallenges: ['BEHAV_004', 'BEHAV_002', 'AMT_004'],
  },
  {
    id: 'HRS_009',
    name: 'Night Owl',
    description: 'Unusual trading during off-hours (1 AM - 5 AM)',
    riskLevel: 'high',
    realWorldExample: 'US exchanges flag unusual activity during typical sleep hours',
    setupFunction: (base) => ({
      config: { ...base, preferredHoursStart: 1, preferredHoursEnd: 5 },
      accountAge: 100,
      declaredIncome: 70000,
      previousFlags: 0,
      targetDailyVolume: 4000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 1, end: 5 },
      additionalRiskFactors: ['off_hours', 'timing_anomaly'],
    }),
    expectedChallenges: ['VELOC_006', 'TIME_004', 'BEHAV_003'],
  },
  {
    id: 'HRS_010',
    name: 'Income Mismatch',
    description: 'Trading volume inconsistent with declared income',
    riskLevel: 'high',
    realWorldExample: 'KYC verification compares declared income vs trading patterns',
    setupFunction: (base) => ({
      config: { ...base, maxDailyVolume: 7000 },
      accountAge: 90,
      declaredIncome: 35000,
      previousFlags: 0,
      targetDailyVolume: 7000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 20 },
      additionalRiskFactors: ['income_mismatch', 'volume_anomaly'],
    }),
    expectedChallenges: ['AMT_004', 'BEHAV_001', 'BEHAV_003'],
  },

  // ============ ELEVATED RISK SCENARIOS ============
  {
    id: 'HRS_011',
    name: 'Single Exchange Concentration',
    description: 'All activity concentrated on one exchange',
    riskLevel: 'elevated',
    realWorldExample: 'Exchanges flag accounts with >90% volume on single platform',
    setupFunction: (base) => ({
      config: { ...base, maxExchangeConcentration: 0.85, minExchangesPerDay: 1 },
      accountAge: 120,
      declaredIncome: 80000,
      previousFlags: 0,
      targetDailyVolume: 4500,
      exchangeRestrictions: ['coinbase', 'kraken', 'gemini', 'bitstamp', 'okx', 'gate', 'huobi'],
      timeRestrictions: { start: 9, end: 21 },
      additionalRiskFactors: ['exchange_concentration'],
    }),
    expectedChallenges: ['PATT_002', 'STRUCT_005'],
  },
  {
    id: 'HRS_012',
    name: 'Round Number Lover',
    description: 'Preference for round transaction amounts',
    riskLevel: 'elevated',
    realWorldExample: 'AML systems flag accounts with >50% round number transactions',
    setupFunction: (base) => ({
      config: { ...base, roundNumberAvoidance: 0.3 },
      accountAge: 180,
      declaredIncome: 100000,
      previousFlags: 0,
      targetDailyVolume: 5000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 20 },
      additionalRiskFactors: ['round_numbers', 'amount_pattern'],
    }),
    expectedChallenges: ['STRUCT_003', 'AMT_005', 'PATT_001'],
  },
  {
    id: 'HRS_013',
    name: 'Flash Trader',
    description: 'All daily activity compressed into short window',
    riskLevel: 'elevated',
    realWorldExample: 'Binance monitors for burst trading patterns',
    setupFunction: (base) => ({
      config: { ...base, maxTransactionsPerHour: 15, minTimeBetweenTx: 20000 },
      accountAge: 150,
      declaredIncome: 90000,
      previousFlags: 0,
      targetDailyVolume: 4000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 14, end: 16 },
      additionalRiskFactors: ['compressed_activity', 'burst_pattern'],
    }),
    expectedChallenges: ['TIME_005', 'VELOC_002', 'VELOC_004'],
  },
  {
    id: 'HRS_014',
    name: 'Micro Transaction Flood',
    description: 'Many very small transactions',
    riskLevel: 'elevated',
    realWorldExample: 'Exchanges flag accounts with >30 transactions under $100',
    setupFunction: (base) => ({
      config: { ...base, minTransactionSize: 25, sweetSpotMin: 40, sweetSpotMax: 100 },
      accountAge: 200,
      declaredIncome: 60000,
      previousFlags: 0,
      targetDailyVolume: 3000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 22 },
      additionalRiskFactors: ['micro_transactions', 'high_frequency'],
    }),
    expectedChallenges: ['AMT_002', 'VELOC_001', 'STRUCT_002'],
  },
  {
    id: 'HRS_015',
    name: 'Chain Hopper',
    description: 'Frequent switching between blockchain networks',
    riskLevel: 'elevated',
    realWorldExample: 'Cross-chain monitoring flags rapid network switching',
    setupFunction: (base) => ({
      config: { ...base },
      accountAge: 180,
      declaredIncome: 110000,
      previousFlags: 0,
      targetDailyVolume: 5000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 20 },
      additionalRiskFactors: ['chain_switching', 'cross_chain'],
    }),
    expectedChallenges: ['BEHAV_005', 'PATT_006', 'VELOC_005'],
  },

  // ============ MODERATE RISK SCENARIOS ============
  {
    id: 'HRS_016',
    name: 'Consistent Trader',
    description: 'Very consistent daily trading patterns',
    riskLevel: 'moderate',
    realWorldExample: 'ML systems detect unnaturally consistent behavior',
    setupFunction: (base) => ({
      config: { ...base, amountVarianceMin: 0.05, amountVarianceMax: 0.15 },
      accountAge: 365,
      declaredIncome: 100000,
      previousFlags: 0,
      targetDailyVolume: 4000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 9, end: 17 },
      additionalRiskFactors: ['low_variance', 'consistent_pattern'],
    }),
    expectedChallenges: ['PATT_001', 'BEHAV_006'],
  },
  {
    id: 'HRS_017',
    name: 'Market Hours Only',
    description: 'Trading only during traditional market hours',
    riskLevel: 'moderate',
    realWorldExample: 'Pattern suggesting traditional finance background',
    setupFunction: (base) => ({
      config: { ...base, preferredHoursStart: 9, preferredHoursEnd: 16 },
      accountAge: 300,
      declaredIncome: 150000,
      previousFlags: 0,
      targetDailyVolume: 5000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 9, end: 16 },
      additionalRiskFactors: ['market_hours_only'],
    }),
    expectedChallenges: ['TIME_002', 'TIME_004'],
  },
  {
    id: 'HRS_018',
    name: 'Previous Flag Recovery',
    description: 'Account with previous compliance flag trying to trade normally',
    riskLevel: 'moderate',
    realWorldExample: 'Flagged accounts face enhanced monitoring for 6-12 months',
    setupFunction: (base) => ({
      config: { ...base, maxDailyVolume: 3000, maxTransactionsPerHour: 5 },
      accountAge: 400,
      declaredIncome: 80000,
      previousFlags: 2,
      targetDailyVolume: 3000,
      exchangeRestrictions: ['binance', 'okx'],
      timeRestrictions: { start: 10, end: 18 },
      additionalRiskFactors: ['previous_flags', 'enhanced_monitoring'],
    }),
    expectedChallenges: ['BEHAV_002', 'BEHAV_003'],
  },
  {
    id: 'HRS_019',
    name: 'DCA Simulator',
    description: 'Mimicking dollar-cost averaging pattern',
    riskLevel: 'moderate',
    realWorldExample: 'Regular interval buying is legitimate but monitored',
    setupFunction: (base) => ({
      config: { ...base, timeVarianceMin: 0.15, timeVarianceMax: 0.25 },
      accountAge: 250,
      declaredIncome: 70000,
      previousFlags: 0,
      targetDailyVolume: 2000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 20 },
      additionalRiskFactors: ['dca_pattern', 'regular_intervals'],
    }),
    expectedChallenges: ['PATT_001', 'TIME_001'],
  },
  {
    id: 'HRS_020',
    name: 'Multi-Asset Diversifier',
    description: 'Trading across many different asset pairs',
    riskLevel: 'moderate',
    realWorldExample: 'High pair diversity can trigger layering detection',
    setupFunction: (base) => ({
      config: { ...base },
      accountAge: 200,
      declaredIncome: 120000,
      previousFlags: 0,
      targetDailyVolume: 5000,
      exchangeRestrictions: [],
      timeRestrictions: { start: 8, end: 22 },
      additionalRiskFactors: ['high_pair_diversity', 'asset_switching'],
    }),
    expectedChallenges: ['PATT_004', 'PATT_007'],
  },
];

// ============================================================================
// ENHANCED SIMULATION ENGINE FOR HIGH-RISK SCENARIOS
// ============================================================================

export class HighRiskSimulationEngine extends FacetSimulationEngine {
  private scenarioContext: ScenarioContext | null = null;
  private hrExchanges = ['binance', 'coinbase', 'kraken', 'kucoin', 'bybit', 'okx', 'gate', 'gemini'];
  private hrChains: ChainId[] = ['polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'];
  private basePairs = ['ETH/USDT', 'BTC/USDT', 'ETH/USDC', 'BTC/USDC', 'MATIC/USDT'];
  private stablePairs = ['USDT/USDC', 'USDC/DAI', 'USDT/DAI', 'BUSD/USDT', 'USDC/BUSD'];

  constructor(config: EliteStrategyConfig = ELITE_STRATEGY_CONFIG) {
    super(config);
  }

  setScenarioContext(context: ScenarioContext): void {
    this.scenarioContext = context;
  }

  /**
   * Generate transactions respecting scenario constraints
   */
  protected generateScenarioTransactions(): SimulatedTransaction[] {
    if (!this.scenarioContext) {
      return this.generateStandardTransactions();
    }

    const ctx = this.scenarioContext;
    const config = ctx.config;
    const transactions: SimulatedTransaction[] = [];
    const exchangeUsage = new Map<string, number>();
    let totalVolume = 0;
    let hourlyTxCount = 0;
    let currentHour = ctx.timeRestrictions.start;

    // Filter available exchanges
    const availableExchanges = this.hrExchanges.filter(
      ex => !ctx.exchangeRestrictions.includes(ex)
    );

    while (totalVolume < ctx.targetDailyVolume * 0.95) {
      // Check time restrictions
      if (currentHour < ctx.timeRestrictions.start || currentHour >= ctx.timeRestrictions.end) {
        currentHour = ctx.timeRestrictions.start;
        if (transactions.length > 0) {
          // Add time gap for next day simulation
          const lastTx = transactions[transactions.length - 1];
          const hoursUntilStart = (24 - currentHour + ctx.timeRestrictions.start) % 24;
          // Skip to next valid time
        }
      }

      // Check hourly limits
      if (hourlyTxCount >= config.maxTransactionsPerHour) {
        currentHour = (currentHour + 1) % 24;
        hourlyTxCount = 0;
        continue;
      }

      // Generate amount with scenario-specific variance
      let amount = config.sweetSpotMin + 
        Math.random() * (config.sweetSpotMax - config.sweetSpotMin);
      
      const variance = config.amountVarianceMin + 
        Math.random() * (config.amountVarianceMax - config.amountVarianceMin);
      amount *= (1 + (Math.random() - 0.5) * 2 * variance);

      // Apply round number avoidance
      if (Math.random() < config.roundNumberAvoidance) {
        amount += Math.random() * 99 + 0.01;
      }

      // Ensure within bounds
      amount = Math.max(config.minTransactionSize, 
        Math.min(config.maxTransactionSize, amount));

      // Check volume limits
      if (totalVolume + amount > ctx.targetDailyVolume) {
        amount = Math.max(0, ctx.targetDailyVolume - totalVolume - Math.random() * 200);
        if (amount < config.minTransactionSize) break;
      }

      // Select exchange with distribution awareness
      const maxPerExchange = totalVolume * config.maxExchangeConcentration;
      const eligibleExchanges = availableExchanges.filter(ex => 
        (exchangeUsage.get(ex) || 0) < maxPerExchange || totalVolume < 500
      );

      const selectedExchange = eligibleExchanges.length > 0
        ? eligibleExchanges[Math.floor(Math.random() * eligibleExchanges.length)]
        : availableExchanges[Math.floor(Math.random() * availableExchanges.length)];

      // Generate timestamp
      let timestamp: number;
      if (transactions.length > 0) {
        const prevTx = transactions[transactions.length - 1];
        const baseDelay = config.minTimeBetweenTx + 
          Math.random() * (config.maxTimeBetweenTx - config.minTimeBetweenTx);
        const timeVar = config.timeVarianceMin + 
          Math.random() * (config.timeVarianceMax - config.timeVarianceMin);
        timestamp = prevTx.timestamp + baseDelay * (1 + (Math.random() - 0.5) * 2 * timeVar);
      } else {
        // Start at beginning of time window
        const startDate = new Date();
        startDate.setHours(ctx.timeRestrictions.start, Math.floor(Math.random() * 60), 0, 0);
        timestamp = startDate.getTime();
      }

      // Select pair based on scenario
      let pair: string;
      if (ctx.additionalRiskFactors.includes('stablecoin_heavy')) {
        pair = Math.random() > 0.3 
          ? this.stablePairs[Math.floor(Math.random() * this.stablePairs.length)]
          : this.basePairs[Math.floor(Math.random() * this.basePairs.length)];
      } else {
        pair = this.basePairs[Math.floor(Math.random() * this.basePairs.length)];
      }

      // Create transaction
      const tx: SimulatedTransaction = {
        id: `sim-${randomUUID().split('-')[0]}`,
        amount: Math.round(amount * 100) / 100,
        exchange: selectedExchange,
        chain: this.hrChains[Math.floor(Math.random() * this.hrChains.length)],
        timestamp,
        pair,
        type: Math.random() > 0.3 ? 'swap' : (Math.random() > 0.5 ? 'buy' : 'sell'),
      };

      transactions.push(tx);
      totalVolume += tx.amount;
      exchangeUsage.set(tx.exchange, (exchangeUsage.get(tx.exchange) || 0) + tx.amount);
      hourlyTxCount++;

      // Pattern break
      if (Math.random() < config.patternBreakFrequency) {
        hourlyTxCount = 0;
        // Add dormant period
        if (Math.random() < config.dormantPeriodChance) {
          const dormant = config.dormantDurationMin + 
            Math.random() * (config.dormantDurationMax - config.dormantDurationMin);
          if (transactions.length > 0) {
            transactions[transactions.length - 1].timestamp += dormant;
          }
        }
      }

      // Safety limit
      if (transactions.length > 150) break;
    }

    return transactions;
  }

  private generateStandardTransactions(): SimulatedTransaction[] {
    // Fallback to parent implementation concept
    const transactions: SimulatedTransaction[] = [];
    let totalVolume = 0;
    const targetVolume = ELITE_STRATEGY_CONFIG.maxDailyVolume * 0.9;

    while (totalVolume < targetVolume && transactions.length < 100) {
      const amount = ELITE_STRATEGY_CONFIG.sweetSpotMin + 
        Math.random() * (ELITE_STRATEGY_CONFIG.sweetSpotMax - ELITE_STRATEGY_CONFIG.sweetSpotMin);
      
      transactions.push({
        id: `sim-${randomUUID().split('-')[0]}`,
        amount: Math.round(amount * 100) / 100,
        exchange: this.hrExchanges[Math.floor(Math.random() * this.hrExchanges.length)],
        chain: this.hrChains[Math.floor(Math.random() * this.hrChains.length)],
        timestamp: Date.now() + transactions.length * 120000,
        pair: this.basePairs[Math.floor(Math.random() * this.basePairs.length)],
        type: 'swap',
      });

      totalVolume += amount;
    }

    return transactions;
  }

  /**
   * Build context with scenario-specific parameters
   */
  protected buildScenarioContext(transactions: SimulatedTransaction[]): SimulationContext {
    const ctx = this.scenarioContext;
    const baseContext = this.buildContextFromTransactions(transactions);

    if (ctx) {
      baseContext.accountAge = ctx.accountAge;
      baseContext.declaredIncome = ctx.declaredIncome;
      baseContext.previousFlags = ctx.previousFlags;
    }

    return baseContext;
  }

  private buildContextFromTransactions(transactions: SimulatedTransaction[]): SimulationContext {
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

      exchangeDist.set(tx.exchange, (exchangeDist.get(tx.exchange) || 0) + tx.amount);
      chainDist.set(tx.chain, (chainDist.get(tx.chain) || 0) + 1);
      pairDist.set(tx.pair, (pairDist.get(tx.pair) || 0) + 1);

      if (i > 0) {
        timeBetween.push(tx.timestamp - transactions[i - 1].timestamp);
      }

      if (tx.amount === Math.round(tx.amount / 100) * 100) {
        roundCount++;
      }

      if (tx.amount >= 9000 && tx.amount < 10000) {
        justBelowCount++;
      }

      if (i > 0 && tx.exchange === transactions[i - 1].exchange) {
        consecutiveSameExchange++;
        maxConsecExchange = Math.max(maxConsecExchange, consecutiveSameExchange);
      } else {
        consecutiveSameExchange = 1;
      }

      if (i > 0 && Math.abs(tx.amount - transactions[i - 1].amount) < transactions[i - 1].amount * 0.05) {
        consecutiveSameAmount++;
        maxConsecAmount = Math.max(maxConsecAmount, consecutiveSameAmount);
      } else {
        consecutiveSameAmount = 1;
      }
    }

    const amounts = transactions.map(t => t.amount);
    const avgAmount = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
    const variance = amounts.length > 0
      ? Math.sqrt(amounts.reduce((s, a) => s + Math.pow(a - avgAmount, 2), 0) / amounts.length) / (avgAmount || 1)
      : 0;

    return {
      transactions,
      dailyVolume,
      hourlyVolume: dailyVolume / 14,
      transactionCount: transactions.length,
      exchangeDistribution: exchangeDist,
      timeOfDay: 12,
      dayOfWeek: 3,
      accountAge: 180,
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
   * Run simulation for a specific scenario
   */
  runScenarioSimulation(): SimulationResult {
    const transactions = this.generateScenarioTransactions();
    const context = this.buildScenarioContext(transactions);

    const details: { violation: { id: string; name: string; severity: string; weight: number }; triggered: boolean }[] = [];
    const violationsTriggered: string[] = [];
    let redFlagScore = 0;

    for (const violation of COMPLIANCE_VIOLATIONS) {
      const triggered = violation.detectionFunction(context);
      details.push({
        violation: {
          id: violation.id,
          name: violation.name,
          severity: violation.severity,
          weight: violation.weight,
        },
        triggered,
      });

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
      details: details as any,
    };
  }
}

// ============================================================================
// COMPREHENSIVE TEST RUNNER
// ============================================================================

export interface ComprehensiveTestResults {
  timestamp: Date;
  totalScenarios: number;
  totalSimulations: number;
  overallPassRate: number;
  overallRedFlagRate: number;
  targetMet: boolean;
  targetRedFlagRate: number;
  scenarioResults: ScenarioTestResult[];
  criticalFindings: string[];
  recommendations: string[];
  performanceMetrics: {
    avgTransactionsPerDay: number;
    avgDailyVolume: number;
    avgViolationsPerSimulation: number;
    worstCaseViolations: number;
  };
}

export async function runComprehensiveHighRiskTests(
  simulationsPerScenario: number = 25,
  targetRedFlagRate: number = 5
): Promise<ComprehensiveTestResults> {
  const scenarioResults: ScenarioTestResult[] = [];
  const criticalFindings: string[] = [];
  const recommendations: string[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalViolations = 0;
  let totalTransactions = 0;
  let totalVolume = 0;
  let worstCaseViolations = 0;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FACET HANDLER HIGH-RISK SCENARIO TESTING');
  console.log('  Target Red Flag Rate: <' + targetRedFlagRate + '%');
  console.log('  Simulations per Scenario: ' + simulationsPerScenario);
  console.log('  Total Scenarios: ' + HIGH_RISK_SCENARIOS.length);
  console.log('  Total Simulations: ' + (simulationsPerScenario * HIGH_RISK_SCENARIOS.length));
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const scenario of HIGH_RISK_SCENARIOS) {
    console.log(`Testing: ${scenario.name} [${scenario.riskLevel.toUpperCase()}]`);
    
    const engine = new HighRiskSimulationEngine();
    const context = scenario.setupFunction(ELITE_STRATEGY_CONFIG);
    engine.setScenarioContext(context);

    const results: SimulationResult[] = [];
    const violationCounts = new Map<string, number>();
    let scenarioPassed = 0;
    let scenarioCritical = 0;

    for (let i = 0; i < simulationsPerScenario; i++) {
      const result = engine.runScenarioSimulation();
      results.push(result);

      if (result.passed) {
        scenarioPassed++;
        totalPassed++;
      } else {
        totalFailed++;
      }

      totalTransactions += result.transactionCount;
      totalVolume += result.totalVolume;
      totalViolations += result.violationsTriggered.length;
      worstCaseViolations = Math.max(worstCaseViolations, result.violationsTriggered.length);

      for (const vId of result.violationsTriggered) {
        violationCounts.set(vId, (violationCounts.get(vId) || 0) + 1);
        const violation = COMPLIANCE_VIOLATIONS.find(v => v.id === vId);
        if (violation?.severity === 'critical') {
          scenarioCritical++;
        }
      }
    }

    const scenarioRedFlagRate = ((simulationsPerScenario - scenarioPassed) / simulationsPerScenario) * 100;
    const avgViolations = results.reduce((s, r) => s + r.violationsTriggered.length, 0) / simulationsPerScenario;

    // Sort violations by count
    const sortedViolations = Array.from(violationCounts.entries())
      .map(([id, count]) => {
        const v = COMPLIANCE_VIOLATIONS.find(v => v.id === id)!;
        return { id, name: v?.name || id, count };
      })
      .sort((a, b) => b.count - a.count);

    // Determine risk assessment
    let riskAssessment: 'SAFE' | 'CAUTION' | 'WARNING' | 'DANGER';
    if (scenarioRedFlagRate <= 2) riskAssessment = 'SAFE';
    else if (scenarioRedFlagRate <= 5) riskAssessment = 'CAUTION';
    else if (scenarioRedFlagRate <= 15) riskAssessment = 'WARNING';
    else riskAssessment = 'DANGER';

    // Generate recommendations
    const scenarioRecommendations: string[] = [];
    if (sortedViolations.length > 0) {
      const topViolation = sortedViolations[0];
      if (topViolation.count > simulationsPerScenario * 0.1) {
        scenarioRecommendations.push(`Address ${topViolation.name} (triggered ${topViolation.count} times)`);
      }
    }
    if (scenarioCritical > 0) {
      scenarioRecommendations.push(`${scenarioCritical} critical violations detected - review immediately`);
    }

    const scenarioResult: ScenarioTestResult = {
      scenario,
      simulations: simulationsPerScenario,
      passed: scenarioPassed,
      failed: simulationsPerScenario - scenarioPassed,
      redFlagRate: scenarioRedFlagRate,
      averageViolations: avgViolations,
      criticalViolations: scenarioCritical,
      worstViolations: sortedViolations.slice(0, 3),
      riskAssessment,
      recommendations: scenarioRecommendations,
    };

    scenarioResults.push(scenarioResult);

    // Log scenario result
    const statusEmoji = riskAssessment === 'SAFE' ? '✅' : 
                        riskAssessment === 'CAUTION' ? '⚠️' : 
                        riskAssessment === 'WARNING' ? '🔶' : '🔴';
    console.log(`  ${statusEmoji} Red Flag Rate: ${scenarioRedFlagRate.toFixed(1)}% | Avg Violations: ${avgViolations.toFixed(2)} | Assessment: ${riskAssessment}`);

    // Collect critical findings
    if (scenarioRedFlagRate > targetRedFlagRate) {
      criticalFindings.push(`${scenario.name}: ${scenarioRedFlagRate.toFixed(1)}% red flag rate exceeds ${targetRedFlagRate}% target`);
    }
  }

  // Calculate overall metrics
  const totalSimulations = simulationsPerScenario * HIGH_RISK_SCENARIOS.length;
  const overallPassRate = (totalPassed / totalSimulations) * 100;
  const overallRedFlagRate = (totalFailed / totalSimulations) * 100;
  const targetMet = overallRedFlagRate <= targetRedFlagRate;

  // Generate overall recommendations
  if (!targetMet) {
    recommendations.push(`Overall red flag rate (${overallRedFlagRate.toFixed(2)}%) exceeds target (${targetRedFlagRate}%)`);
    
    // Find most problematic scenarios
    const problemScenarios = scenarioResults
      .filter(r => r.redFlagRate > targetRedFlagRate)
      .sort((a, b) => b.redFlagRate - a.redFlagRate);
    
    if (problemScenarios.length > 0) {
      recommendations.push(`Focus on improving: ${problemScenarios.slice(0, 3).map(s => s.scenario.name).join(', ')}`);
    }
  }

  // Find most common violations across all scenarios
  const globalViolationCounts = new Map<string, number>();
  for (const result of scenarioResults) {
    for (const v of result.worstViolations) {
      globalViolationCounts.set(v.id, (globalViolationCounts.get(v.id) || 0) + v.count);
    }
  }

  const topGlobalViolations = Array.from(globalViolationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topGlobalViolations.length > 0) {
    recommendations.push(`Most common violations: ${topGlobalViolations.map(([id]) => id).join(', ')}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FINAL RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Simulations: ${totalSimulations}`);
  console.log(`  Passed: ${totalPassed} | Failed: ${totalFailed}`);
  console.log(`  Overall Pass Rate: ${overallPassRate.toFixed(2)}%`);
  console.log(`  Overall Red Flag Rate: ${overallRedFlagRate.toFixed(2)}%`);
  console.log(`  Target Met: ${targetMet ? '✅ YES' : '❌ NO'}`);
  console.log(`  Avg Transactions/Day: ${(totalTransactions / totalSimulations).toFixed(1)}`);
  console.log(`  Avg Daily Volume: $${(totalVolume / totalSimulations).toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return {
    timestamp: new Date(),
    totalScenarios: HIGH_RISK_SCENARIOS.length,
    totalSimulations,
    overallPassRate,
    overallRedFlagRate,
    targetMet,
    targetRedFlagRate,
    scenarioResults,
    criticalFindings,
    recommendations,
    performanceMetrics: {
      avgTransactionsPerDay: totalTransactions / totalSimulations,
      avgDailyVolume: totalVolume / totalSimulations,
      avgViolationsPerSimulation: totalViolations / totalSimulations,
      worstCaseViolations,
    },
  };
}

// ============================================================================
// QUICK TEST FUNCTION
// ============================================================================

export async function quickComplianceTest(): Promise<{
  passed: boolean;
  redFlagRate: number;
  summary: string;
}> {
  const results = await runComprehensiveHighRiskTests(25, 5);
  
  return {
    passed: results.targetMet,
    redFlagRate: results.overallRedFlagRate,
    summary: `${results.totalSimulations} simulations across ${results.totalScenarios} high-risk scenarios. ` +
             `Red flag rate: ${results.overallRedFlagRate.toFixed(2)}% (target: <${results.targetRedFlagRate}%). ` +
             `${results.targetMet ? 'TARGET MET ✅' : 'TARGET NOT MET ❌'}`,
  };
}

// Export for use
export { COMPLIANCE_VIOLATIONS };
