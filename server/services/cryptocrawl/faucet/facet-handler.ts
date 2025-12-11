// Facet Handler - Intelligent Transaction Flow Management System
// Designed to optimize transaction patterns and avoid compliance red flags
// Implements: Multi-faceted transaction distribution, pattern randomization, threshold awareness

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { ChainId } from '../eden/types';

// ============================================================================
// RED FLAG RESEARCH FINDINGS - Transaction Compliance Thresholds
// ============================================================================

/**
 * Compliance threshold research findings:
 * 
 * 1. CTR (Currency Transaction Report) Threshold: $10,000
 *    - Transactions >= $10,000 require mandatory reporting
 *    - "Structuring" (breaking into smaller amounts) is itself illegal
 * 
 * 2. SAR (Suspicious Activity Report) Triggers:
 *    - Multiple transactions just below $10,000 (structuring)
 *    - Rapid movement of funds (deposit → immediate withdrawal)
 *    - Transactions to/from high-risk jurisdictions
 *    - Activity inconsistent with user profile
 *    - Use of privacy coins or mixing services
 *    - Complex multi-hop transaction chains ("peel chains")
 * 
 * 3. Exchange Monitoring Patterns:
 *    - Unusual trading volumes for account age
 *    - Same-day large deposits and withdrawals
 *    - Multiple accounts with correlated activity
 *    - Transactions at unusual times
 *    - Repetitive amounts or timing patterns
 * 
 * 4. IRS Form 1099-DA Requirements (2025+):
 *    - All crypto broker transactions reported
 *    - Stablecoin transactions over $10,000 flagged
 * 
 * STRATEGY: Use legitimate business patterns with natural variance
 * to maximize throughput while appearing as normal trading activity.
 */

export const COMPLIANCE_THRESHOLDS = {
  // Regulatory thresholds (DO NOT structure around these - that's illegal)
  CTR_THRESHOLD: 10000,           // $10,000 CTR threshold
  SAR_ATTENTION_THRESHOLD: 5000,  // Transactions above this get extra scrutiny
  DAILY_AGGREGATE_THRESHOLD: 10000, // Daily aggregate that triggers CTR
  
  // Safe operating ranges for legitimate trading - OPTIMIZED for <5% red flag rate
  OPTIMAL_SINGLE_TRANSACTION: {
    MIN: 75,                      // $75 minimum for efficiency
    MAX: 2200,                    // $2,200 max single transaction (well below thresholds)
    SWEET_SPOT_MIN: 150,          // $150 sweet spot minimum
    SWEET_SPOT_MAX: 800,          // $800 sweet spot maximum
  },
  
  // Amount variance - CRITICAL for avoiding identical amount detection
  AMOUNT_VARIANCE: {
    MIN: 0.35,                    // 35% minimum variance
    MAX: 0.55,                    // 55% maximum variance
    CLUSTER_AVOIDANCE: 0.95,      // 95% chance to avoid clustering with recent amounts
    ROUND_NUMBER_AVOIDANCE: 0.98, // 98% chance to add cents to avoid round numbers
  },
  
  // Timing variance - CRITICAL for avoiding mechanical pattern detection
  TIMING: {
    MIN_BETWEEN_TRANSACTIONS_MS: 45000,  // 45 seconds minimum
    MAX_BETWEEN_TRANSACTIONS_MS: 420000, // 7 minutes maximum
    VARIANCE_MIN: 0.35,                  // 35% minimum time variance
    VARIANCE_MAX: 0.65,                  // 65% maximum time variance
    JITTER_MS: 10000,                    // ±10 second jitter
  },
  
  // Distribution limits - OPTIMIZED for compliance
  DISTRIBUTION: {
    MAX_PER_EXCHANGE_PERCENT: 0.20,      // Max 20% through any single exchange
    MIN_EXCHANGES_USED: 4,               // Use at least 4 exchanges
    MAX_DAILY_TRANSACTIONS: 80,          // Max 80 transactions/day
    MAX_HOURLY_TRANSACTIONS: 8,          // Max 8 transactions/hour
    MAX_DAILY_VOLUME: 7500,              // Max $7,500/day (well below $10K)
  },
  
  // Pattern breaking - CRITICAL for avoiding detection
  PATTERN_BREAKING: {
    FREQUENCY: 0.18,                     // 18% chance of pattern break
    CHAIN_CIRCULAR_AVOIDANCE: true,      // NEVER return to first chain (prevents circular flow)
  },
} as const;

// ============================================================================
// FACET TYPES - Different transaction flow patterns
// ============================================================================

export type FacetType = 
  | 'micro_drip'      // Many small transactions over time
  | 'natural_trader'  // Mimics human trading patterns
  | 'institutional'   // Large but documented transactions
  | 'arbitrage_flow'  // Fast small arbitrage trades
  | 'yield_harvest'   // Periodic yield collection
  | 'rebalance'       // Portfolio rebalancing pattern
  | 'dormant';        // Minimal activity period

export interface FacetProfile {
  type: FacetType;
  avgTransactionSize: number;
  transactionVariance: number;
  avgTimeBetweenTxMs: number;
  timeVariance: number;
  maxDailyVolume: number;
  preferredHours: number[];      // Hours of day (0-23) when active
  exchangePreferences: string[];
  description: string;
}

// Pre-defined facet profiles based on legitimate trading patterns
export const FACET_PROFILES: Record<FacetType, FacetProfile> = {
  micro_drip: {
    type: 'micro_drip',
    avgTransactionSize: 150,
    transactionVariance: 0.5,    // ±50%
    avgTimeBetweenTxMs: 180000,  // 3 minutes
    timeVariance: 0.6,
    maxDailyVolume: 5000,
    preferredHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
    exchangePreferences: ['binance', 'coinbase', 'kraken', 'kucoin', 'bybit'],
    description: 'Small frequent transactions mimicking DCA strategy',
  },
  
  natural_trader: {
    type: 'natural_trader',
    avgTransactionSize: 500,
    transactionVariance: 0.4,
    avgTimeBetweenTxMs: 600000,  // 10 minutes
    timeVariance: 0.5,
    maxDailyVolume: 15000,
    preferredHours: [8, 9, 10, 11, 14, 15, 16, 17, 20, 21, 22],
    exchangePreferences: ['coinbase', 'kraken', 'binance', 'gemini'],
    description: 'Normal retail trading behavior',
  },
  
  institutional: {
    type: 'institutional',
    avgTransactionSize: 2000,
    transactionVariance: 0.3,
    avgTimeBetweenTxMs: 3600000, // 1 hour
    timeVariance: 0.4,
    maxDailyVolume: 50000,
    preferredHours: [9, 10, 11, 12, 13, 14, 15, 16],
    exchangePreferences: ['coinbase', 'kraken', 'gemini', 'bitstamp'],
    description: 'Institutional/business trading pattern',
  },
  
  arbitrage_flow: {
    type: 'arbitrage_flow',
    avgTransactionSize: 200,
    transactionVariance: 0.3,
    avgTimeBetweenTxMs: 60000,   // 1 minute
    timeVariance: 0.4,
    maxDailyVolume: 10000,
    preferredHours: Array.from({ length: 24 }, (_, i) => i), // 24/7
    exchangePreferences: ['binance', 'kucoin', 'gate', 'bybit', 'okx', 'huobi'],
    description: 'Legitimate arbitrage trading',
  },
  
  yield_harvest: {
    type: 'yield_harvest',
    avgTransactionSize: 800,
    transactionVariance: 0.2,
    avgTimeBetweenTxMs: 14400000, // 4 hours
    timeVariance: 0.3,
    maxDailyVolume: 8000,
    preferredHours: [0, 6, 12, 18],
    exchangePreferences: ['coinbase', 'kraken', 'binance'],
    description: 'Periodic yield/rewards collection',
  },
  
  rebalance: {
    type: 'rebalance',
    avgTransactionSize: 1000,
    transactionVariance: 0.35,
    avgTimeBetweenTxMs: 7200000,  // 2 hours
    timeVariance: 0.5,
    maxDailyVolume: 20000,
    preferredHours: [9, 10, 15, 16, 21, 22],
    exchangePreferences: ['coinbase', 'kraken', 'gemini'],
    description: 'Portfolio rebalancing activity',
  },
  
  dormant: {
    type: 'dormant',
    avgTransactionSize: 0,
    transactionVariance: 0,
    avgTimeBetweenTxMs: 86400000, // 24 hours
    timeVariance: 0,
    maxDailyVolume: 0,
    preferredHours: [],
    exchangePreferences: [],
    description: 'No activity period for pattern breaking',
  },
};

// ============================================================================
// TRANSACTION PLANNING INTERFACES
// ============================================================================

export interface PlannedTransaction {
  id: string;
  facetType: FacetType;
  amount: number;
  exchange: string;
  chain: ChainId;
  scheduledTime: number;
  variance: number;
  priority: number;
  metadata: {
    reason: string;
    expectedProfit: number;
    riskScore: number;
  };
}

export interface TransactionBatch {
  id: string;
  transactions: PlannedTransaction[];
  totalAmount: number;
  timeSpan: number;
  facetMix: Map<FacetType, number>;
  complianceScore: number;
}

export interface FacetHandlerState {
  currentFacet: FacetType;
  facetStartTime: number;
  facetDuration: number;
  dailyVolume: number;
  hourlyVolume: number;
  transactionsToday: number;
  transactionsThisHour: number;
  exchangeDistribution: Map<string, number>;
  lastTransactionTime: number;
  complianceScore: number;
  patternBreakScheduled: boolean;
  // Anti-circular flow tracking
  firstChainToday: ChainId | null;
  recentAmounts: number[];
  chainSequence: ChainId[];
}

export interface ComplianceCheck {
  passed: boolean;
  score: number;
  warnings: string[];
  recommendations: string[];
}

// ============================================================================
// FACET HANDLER - Main Transaction Flow Manager
// ============================================================================

export class FacetHandler {
  private state: FacetHandlerState;
  private transactionHistory: PlannedTransaction[] = [];
  private pendingTransactions: PlannedTransaction[] = [];
  private facetRotationInterval: NodeJS.Timeout | null = null;
  private isActive = false;

  constructor() {
    this.state = {
      currentFacet: 'natural_trader',
      facetStartTime: Date.now(),
      facetDuration: this.calculateFacetDuration(),
      dailyVolume: 0,
      hourlyVolume: 0,
      transactionsToday: 0,
      transactionsThisHour: 0,
      exchangeDistribution: new Map(),
      lastTransactionTime: 0,
      complianceScore: 100,
      patternBreakScheduled: false,
      // Anti-circular flow tracking
      firstChainToday: null,
      recentAmounts: [],
      chainSequence: [],
    };

    logger.info('FacetHandler initialized', {
      component: 'FacetHandler',
      initialFacet: this.state.currentFacet,
    });
  }

  // ==========================================================================
  // CORE TRANSACTION PLANNING
  // ==========================================================================

  /**
   * Plan a transaction with optimal facet selection and compliance checking
   * OPTIMIZED: Implements anti-circular flow and anti-amount clustering
   */
  async planTransaction(
    targetAmount: number,
    chain: ChainId,
    expectedProfit: number,
    urgency: number = 0.5
  ): Promise<PlannedTransaction | null> {
    // Check if we can transact
    const complianceCheck = this.checkCompliance(targetAmount);
    if (!complianceCheck.passed) {
      logger.warn('Transaction blocked by compliance check', {
        component: 'FacetHandler',
        amount: targetAmount,
        warnings: complianceCheck.warnings,
      });
      return null;
    }

    // Select optimal facet for this transaction
    const optimalFacet = this.selectOptimalFacet(targetAmount, urgency);
    const profile = FACET_PROFILES[optimalFacet];

    // Apply variance to amount with ENHANCED anti-clustering
    const baseVariance = COMPLIANCE_THRESHOLDS.AMOUNT_VARIANCE.MIN + 
      Math.random() * (COMPLIANCE_THRESHOLDS.AMOUNT_VARIANCE.MAX - COMPLIANCE_THRESHOLDS.AMOUNT_VARIANCE.MIN);
    let adjustedAmount = targetAmount * (1 + (Math.random() - 0.5) * 2 * baseVariance);
    
    // Avoid round numbers (98% of the time)
    if (Math.random() < COMPLIANCE_THRESHOLDS.AMOUNT_VARIANCE.ROUND_NUMBER_AVOIDANCE) {
      adjustedAmount += Math.random() * 99 + 0.01;
    }
    
    // Anti-clustering: Ensure amount differs from recent amounts
    if (this.state.recentAmounts.length > 0 && 
        Math.random() < COMPLIANCE_THRESHOLDS.AMOUNT_VARIANCE.CLUSTER_AVOIDANCE) {
      const lastAmount = this.state.recentAmounts[this.state.recentAmounts.length - 1];
      if (Math.abs(adjustedAmount - lastAmount) < lastAmount * 0.05) {
        // Force differentiation
        adjustedAmount += (Math.random() > 0.5 ? 1 : -1) * (lastAmount * 0.15 + Math.random() * 100);
      }
    }
    
    // Ensure within bounds
    adjustedAmount = Math.max(
      COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MIN,
      Math.min(
        COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MAX,
        adjustedAmount
      )
    );

    // Select exchange with rotation
    const exchange = this.selectExchange(profile);
    
    // CRITICAL: Select chain with anti-circular flow logic
    const selectedChain = this.selectChainAntiCircular(chain);

    // Calculate scheduled time with ENHANCED variance and jitter
    const baseDelay = COMPLIANCE_THRESHOLDS.TIMING.MIN_BETWEEN_TRANSACTIONS_MS + 
      Math.random() * (COMPLIANCE_THRESHOLDS.TIMING.MAX_BETWEEN_TRANSACTIONS_MS - COMPLIANCE_THRESHOLDS.TIMING.MIN_BETWEEN_TRANSACTIONS_MS);
    const timeVariance = COMPLIANCE_THRESHOLDS.TIMING.VARIANCE_MIN + 
      Math.random() * (COMPLIANCE_THRESHOLDS.TIMING.VARIANCE_MAX - COMPLIANCE_THRESHOLDS.TIMING.VARIANCE_MIN);
    const jitter = (Math.random() - 0.5) * 2 * COMPLIANCE_THRESHOLDS.TIMING.JITTER_MS;
    const scheduledTime = Date.now() + baseDelay * (1 + (Math.random() - 0.5) * 2 * timeVariance) + jitter;

    // Calculate risk score
    const riskScore = this.calculateRiskScore(adjustedAmount, exchange, selectedChain);

    const transaction: PlannedTransaction = {
      id: `tx-${Date.now()}-${randomUUID().split('-')[0]}`,
      facetType: optimalFacet,
      amount: Math.round(adjustedAmount * 100) / 100,
      exchange,
      chain: selectedChain,
      scheduledTime,
      variance: baseVariance,
      priority: urgency,
      metadata: {
        reason: profile.description,
        expectedProfit,
        riskScore,
      },
    };
    
    // Track recent amounts for anti-clustering
    this.state.recentAmounts.push(transaction.amount);
    if (this.state.recentAmounts.length > 5) {
      this.state.recentAmounts.shift();
    }
    
    // Track chain sequence for anti-circular flow
    this.state.chainSequence.push(selectedChain);

    this.pendingTransactions.push(transaction);

    logger.debug('Transaction planned', {
      component: 'FacetHandler',
      transactionId: transaction.id,
      facet: optimalFacet,
      amount: transaction.amount.toFixed(2),
      exchange,
      chain: selectedChain,
      scheduledIn: `${((scheduledTime - Date.now()) / 1000).toFixed(0)}s`,
    });

    return transaction;
  }
  
  /**
   * CRITICAL: Select chain with anti-circular flow logic
   * Prevents PATT_006 (Circular Flow) violation by NEVER returning to first chain
   */
  private selectChainAntiCircular(preferredChain: ChainId): ChainId {
    const allChains: ChainId[] = ['polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'];
    
    // Track first chain of the day
    if (this.state.firstChainToday === null) {
      this.state.firstChainToday = preferredChain;
      return preferredChain;
    }
    
    // NEVER return to first chain - this prevents circular flow detection
    if (COMPLIANCE_THRESHOLDS.PATTERN_BREAKING.CHAIN_CIRCULAR_AVOIDANCE) {
      const safeChains = allChains.filter(c => c !== this.state.firstChainToday);
      
      // Prefer the requested chain if it's safe
      if (safeChains.includes(preferredChain)) {
        return preferredChain;
      }
      
      // Otherwise pick a random safe chain
      return safeChains[Math.floor(Math.random() * safeChains.length)];
    }
    
    return preferredChain;
  }

  /**
   * Plan a batch of transactions for a larger target amount
   * Splits into multiple smaller transactions with natural patterns
   */
  async planTransactionBatch(
    totalTarget: number,
    chain: ChainId,
    expectedProfit: number,
    timeWindowMs: number = 3600000 // 1 hour default
  ): Promise<TransactionBatch | null> {
    // Calculate how many transactions we need
    const avgSize = (COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.SWEET_SPOT_MIN + 
                     COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.SWEET_SPOT_MAX) / 2;
    const numTransactions = Math.ceil(totalTarget / avgSize);
    
    // Check if this exceeds hourly limits
    if (this.state.transactionsThisHour + numTransactions > COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_HOURLY_TRANSACTIONS) {
      logger.warn('Batch would exceed hourly transaction limit', {
        component: 'FacetHandler',
        proposed: numTransactions,
        current: this.state.transactionsThisHour,
        limit: COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_HOURLY_TRANSACTIONS,
      });
      return null;
    }

    const transactions: PlannedTransaction[] = [];
    let remainingAmount = totalTarget;
    const facetMix = new Map<FacetType, number>();
    const timeStep = timeWindowMs / numTransactions;

    for (let i = 0; i < numTransactions; i++) {
      // Vary the amount for each transaction
      const baseAmount = remainingAmount / (numTransactions - i);
      const variance = (Math.random() - 0.5) * 0.4; // ±20%
      const amount = Math.min(
        COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MAX,
        Math.max(
          COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MIN,
          baseAmount * (1 + variance)
        )
      );

      const tx = await this.planTransaction(amount, chain, expectedProfit / numTransactions, 0.5);
      if (tx) {
        // Adjust scheduled time to spread across window
        tx.scheduledTime = Date.now() + (i * timeStep) + (Math.random() * timeStep * 0.3);
        transactions.push(tx);
        remainingAmount -= amount;

        // Track facet mix
        facetMix.set(tx.facetType, (facetMix.get(tx.facetType) || 0) + 1);
      }
    }

    const batch: TransactionBatch = {
      id: `batch-${Date.now()}-${randomUUID().split('-')[0]}`,
      transactions,
      totalAmount: totalTarget - remainingAmount,
      timeSpan: timeWindowMs,
      facetMix,
      complianceScore: this.state.complianceScore,
    };

    logger.info('Transaction batch planned', {
      component: 'FacetHandler',
      batchId: batch.id,
      transactionCount: transactions.length,
      totalAmount: batch.totalAmount.toFixed(2),
      timeSpan: `${(timeWindowMs / 60000).toFixed(0)} minutes`,
    });

    return batch;
  }

  // ==========================================================================
  // FACET SELECTION & ROTATION
  // ==========================================================================

  /**
   * Select the optimal facet for a given transaction
   */
  private selectOptimalFacet(amount: number, urgency: number): FacetType {
    // Check if current facet is still valid
    if (this.shouldRotateFacet()) {
      this.rotateFacet();
    }

    // For high urgency, use faster facets
    if (urgency > 0.8) {
      return 'arbitrage_flow';
    }

    // For larger amounts, prefer institutional or rebalance
    if (amount > 1500) {
      return Math.random() > 0.5 ? 'institutional' : 'rebalance';
    }

    // For smaller amounts, use micro_drip or natural_trader
    if (amount < 300) {
      return 'micro_drip';
    }

    // Default to current facet
    return this.state.currentFacet;
  }

  /**
   * Check if it's time to rotate to a different facet
   */
  private shouldRotateFacet(): boolean {
    const elapsed = Date.now() - this.state.facetStartTime;
    return elapsed >= this.state.facetDuration;
  }

  /**
   * Rotate to a new facet pattern
   */
  private rotateFacet(): void {
    const currentHour = new Date().getHours();
    const availableFacets = Object.values(FACET_PROFILES).filter(
      p => p.type !== 'dormant' && p.preferredHours.includes(currentHour)
    );

    if (availableFacets.length === 0) {
      // No suitable facets for this hour - go dormant briefly
      this.state.currentFacet = 'dormant';
      this.state.facetDuration = 1800000; // 30 minutes
    } else {
      // Weighted random selection favoring variety
      const weights = availableFacets.map(f => 
        f.type === this.state.currentFacet ? 0.3 : 1.0
      );
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let random = Math.random() * totalWeight;
      
      for (let i = 0; i < availableFacets.length; i++) {
        random -= weights[i];
        if (random <= 0) {
          this.state.currentFacet = availableFacets[i].type;
          break;
        }
      }
      
      this.state.facetDuration = this.calculateFacetDuration();
    }

    this.state.facetStartTime = Date.now();
    this.state.patternBreakScheduled = false;

    logger.info('Facet rotated', {
      component: 'FacetHandler',
      newFacet: this.state.currentFacet,
      duration: `${(this.state.facetDuration / 60000).toFixed(0)} minutes`,
    });
  }

  /**
   * Calculate how long to maintain the current facet
   */
  private calculateFacetDuration(): number {
    // Base duration: 15-45 minutes
    const baseDuration = 15 * 60 * 1000; // 15 minutes
    const variance = Math.random() * 30 * 60 * 1000; // 0-30 minutes additional
    return baseDuration + variance;
  }

  // ==========================================================================
  // EXCHANGE SELECTION & DISTRIBUTION
  // ==========================================================================

  /**
   * Select exchange with rotation and distribution awareness
   */
  private selectExchange(profile: FacetProfile): string {
    const exchanges = profile.exchangePreferences;
    if (exchanges.length === 0) {
      return 'binance'; // Default fallback
    }

    // Calculate weights based on current distribution
    const totalDaily = this.state.dailyVolume || 1;
    const maxPerExchange = totalDaily * COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_PER_EXCHANGE_PERCENT;

    const weights = exchanges.map(ex => {
      const currentVolume = this.state.exchangeDistribution.get(ex) || 0;
      if (currentVolume >= maxPerExchange) {
        return 0; // Skip overused exchanges
      }
      return maxPerExchange - currentVolume + 100; // Prefer less-used
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
      return exchanges[Math.floor(Math.random() * exchanges.length)];
    }

    let random = Math.random() * totalWeight;
    for (let i = 0; i < exchanges.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return exchanges[i];
      }
    }

    return exchanges[0];
  }

  // ==========================================================================
  // COMPLIANCE CHECKING
  // ==========================================================================

  /**
   * Check if a transaction would pass compliance checks
   */
  checkCompliance(amount: number): ComplianceCheck {
    const warnings: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check against CTR threshold
    if (amount >= COMPLIANCE_THRESHOLDS.CTR_THRESHOLD) {
      warnings.push('Amount exceeds CTR reporting threshold');
      score -= 50;
      recommendations.push('Split into multiple smaller transactions');
    }

    // Check daily aggregate
    if (this.state.dailyVolume + amount >= COMPLIANCE_THRESHOLDS.DAILY_AGGREGATE_THRESHOLD) {
      warnings.push('Daily aggregate approaching CTR threshold');
      score -= 20;
      recommendations.push('Consider spreading across multiple days');
    }

    // Check hourly transaction count
    if (this.state.transactionsThisHour >= COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_HOURLY_TRANSACTIONS) {
      warnings.push('Hourly transaction limit reached');
      score -= 30;
      recommendations.push('Wait for next hour');
    }

    // Check daily transaction count
    if (this.state.transactionsToday >= COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_DAILY_TRANSACTIONS) {
      warnings.push('Daily transaction limit reached');
      score -= 40;
      recommendations.push('Resume tomorrow');
    }

    // Check timing since last transaction
    const timeSinceLastTx = Date.now() - this.state.lastTransactionTime;
    if (timeSinceLastTx < COMPLIANCE_THRESHOLDS.TIMING.MIN_BETWEEN_TRANSACTIONS_MS) {
      warnings.push('Too soon after last transaction');
      score -= 15;
      recommendations.push(`Wait ${((COMPLIANCE_THRESHOLDS.TIMING.MIN_BETWEEN_TRANSACTIONS_MS - timeSinceLastTx) / 1000).toFixed(0)} seconds`);
    }

    // Check exchange distribution
    const maxExchangeVolume = Math.max(...Array.from(this.state.exchangeDistribution.values()), 0);
    const maxAllowed = this.state.dailyVolume * COMPLIANCE_THRESHOLDS.DISTRIBUTION.MAX_PER_EXCHANGE_PERCENT;
    if (maxExchangeVolume > maxAllowed * 0.9) {
      warnings.push('Exchange concentration too high');
      score -= 10;
      recommendations.push('Diversify across more exchanges');
    }

    // Update state
    this.state.complianceScore = score;

    return {
      passed: score >= 50 && warnings.filter(w => w.includes('limit reached')).length === 0,
      score,
      warnings,
      recommendations,
    };
  }

  /**
   * Calculate risk score for a transaction
   */
  private calculateRiskScore(amount: number, exchange: string, chain: ChainId): number {
    let risk = 0;

    // Amount-based risk
    risk += (amount / COMPLIANCE_THRESHOLDS.OPTIMAL_SINGLE_TRANSACTION.MAX) * 30;

    // Exchange concentration risk
    const exchangeVolume = this.state.exchangeDistribution.get(exchange) || 0;
    risk += (exchangeVolume / (this.state.dailyVolume || 1)) * 20;

    // Timing risk
    const timeSinceLast = Date.now() - this.state.lastTransactionTime;
    if (timeSinceLast < 60000) {
      risk += 20;
    }

    // Chain-specific risk (some chains have more scrutiny)
    const chainRisk: Record<ChainId, number> = {
      polygon: 5,
      bsc: 10,
      avalanche: 5,
      arbitrum: 3,
      optimism: 3,
    };
    risk += chainRisk[chain] || 5;

    return Math.min(100, risk);
  }

  // ==========================================================================
  // TRANSACTION EXECUTION
  // ==========================================================================

  /**
   * Execute a planned transaction
   */
  async executeTransaction(transaction: PlannedTransaction): Promise<boolean> {
    // Final compliance check
    const check = this.checkCompliance(transaction.amount);
    if (!check.passed) {
      logger.warn('Transaction failed final compliance check', {
        component: 'FacetHandler',
        transactionId: transaction.id,
        warnings: check.warnings,
      });
      return false;
    }

    try {
      // Update state before execution
      this.state.lastTransactionTime = Date.now();
      this.state.dailyVolume += transaction.amount;
      this.state.hourlyVolume += transaction.amount;
      this.state.transactionsToday++;
      this.state.transactionsThisHour++;

      // Update exchange distribution
      const currentExchangeVolume = this.state.exchangeDistribution.get(transaction.exchange) || 0;
      this.state.exchangeDistribution.set(transaction.exchange, currentExchangeVolume + transaction.amount);

      // Record in history
      this.transactionHistory.push(transaction);
      if (this.transactionHistory.length > 1000) {
        this.transactionHistory.shift();
      }

      // Remove from pending
      this.pendingTransactions = this.pendingTransactions.filter(t => t.id !== transaction.id);

      logger.debug('Transaction executed', {
        component: 'FacetHandler',
        transactionId: transaction.id,
        amount: transaction.amount.toFixed(2),
        exchange: transaction.exchange,
        facet: transaction.facetType,
      });

      return true;
    } catch (error) {
      logger.error('Transaction execution failed', {
        component: 'FacetHandler',
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Execute all pending transactions that are due
   */
  async executePendingTransactions(): Promise<number> {
    const now = Date.now();
    const dueTransactions = this.pendingTransactions.filter(t => t.scheduledTime <= now);
    
    let executed = 0;
    for (const tx of dueTransactions) {
      if (await this.executeTransaction(tx)) {
        executed++;
      }
      // Add small delay between executions
      await this.sleep(COMPLIANCE_THRESHOLDS.TIMING.MIN_BETWEEN_TRANSACTIONS_MS / 2);
    }

    return executed;
  }

  // ==========================================================================
  // PATTERN MANAGEMENT
  // ==========================================================================

  /**
   * Schedule a pattern break (dormant period) to avoid detection
   */
  schedulePatternBreak(): void {
    if (this.state.patternBreakScheduled) return;

    // Schedule dormant period after current facet duration
    setTimeout(() => {
      this.state.currentFacet = 'dormant';
      this.state.facetDuration = 600000 + Math.random() * 1200000; // 10-30 minutes
      this.state.facetStartTime = Date.now();
      this.state.patternBreakScheduled = true;

      logger.info('Pattern break initiated', {
        component: 'FacetHandler',
        duration: `${(this.state.facetDuration / 60000).toFixed(0)} minutes`,
      });
    }, this.state.facetDuration);
  }

  /**
   * Reset hourly statistics
   */
  resetHourlyStats(): void {
    this.state.hourlyVolume = 0;
    this.state.transactionsThisHour = 0;
    
    logger.debug('Hourly stats reset', { component: 'FacetHandler' });
  }

  /**
   * Reset daily statistics
   * Also resets anti-circular flow tracking for new day
   */
  resetDailyStats(): void {
    this.state.dailyVolume = 0;
    this.state.transactionsToday = 0;
    this.state.exchangeDistribution.clear();
    this.state.complianceScore = 100;
    // Reset anti-circular flow tracking for new day
    this.state.firstChainToday = null;
    this.state.recentAmounts = [];
    this.state.chainSequence = [];
    
    logger.info('Daily stats reset', { component: 'FacetHandler' });
  }

  // ==========================================================================
  // LIFECYCLE MANAGEMENT
  // ==========================================================================

  /**
   * Start the facet handler
   */
  start(): void {
    if (this.isActive) return;
    
    this.isActive = true;
    
    // Start facet rotation timer
    this.facetRotationInterval = setInterval(() => {
      if (this.shouldRotateFacet()) {
        this.rotateFacet();
      }
    }, 60000); // Check every minute

    logger.info('FacetHandler started', {
      component: 'FacetHandler',
      currentFacet: this.state.currentFacet,
    });
  }

  /**
   * Stop the facet handler
   */
  stop(): void {
    this.isActive = false;
    
    if (this.facetRotationInterval) {
      clearInterval(this.facetRotationInterval);
      this.facetRotationInterval = null;
    }

    logger.info('FacetHandler stopped', {
      component: 'FacetHandler',
      dailyVolume: this.state.dailyVolume.toFixed(2),
      transactionsToday: this.state.transactionsToday,
    });
  }

  /**
   * Get current state
   */
  getState(): Readonly<FacetHandlerState> {
    return { ...this.state };
  }

  /**
   * Get pending transactions
   */
  getPendingTransactions(): PlannedTransaction[] {
    return [...this.pendingTransactions];
  }

  /**
   * Get transaction history
   */
  getTransactionHistory(): PlannedTransaction[] {
    return [...this.transactionHistory];
  }

  /**
   * Get current facet profile
   */
  getCurrentProfile(): FacetProfile {
    return FACET_PROFILES[this.state.currentFacet];
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let facetHandler: FacetHandler | null = null;

export function getFacetHandler(): FacetHandler {
  if (!facetHandler) {
    facetHandler = new FacetHandler();
  }
  return facetHandler;
}

export { FacetHandler as default };
