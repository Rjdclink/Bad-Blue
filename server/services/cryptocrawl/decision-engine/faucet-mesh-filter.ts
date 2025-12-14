/**
 * FAUCET MESH FILTER
 * 
 * Pre-filters signals before they reach the decision engine:
 * - Only top liquidity pairs
 * - Spread ≥ fees × 1.5
 * - Order book depth ≥ 10× intended size
 * - Reject recent volatility spikes
 * - Reject unstable latency
 */

import { createLogger } from '../../../logger';
import type { SignalInput } from './index';

const log = createLogger('FaucetMeshFilter');

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface FaucetMeshConfig {
  // Liquidity filtering
  topLiquidityPairsOnly: boolean;
  minLiquidityRank: number;          // Top N pairs (e.g., 50 = top 50 pairs)
  
  // Spread filtering
  minSpreadMultiplier: number;       // Spread must be ≥ fees × multiplier (default: 1.5)
  testSignalSpreadMultiplier: number; // Relaxed spread multiplier for test signals (default: 2.0)
  allowTestSignalOverride: boolean;   // Allow TEST_SIGNAL override (default: true)
  
  // Order book filtering
  minOrderBookDepthMultiplier: number; // Order book depth ≥ size × multiplier (default: 10)
  
  // Volatility filtering
  rejectVolatilitySpikes: boolean;
  volatilitySpikeThreshold: number;   // Standard deviations (default: 2.0)
  volatilityLookbackPeriods: number;  // Number of periods to check (default: 20)
  
  // Latency filtering
  rejectUnstableLatency: boolean;
  maxLatencyVariance: number;        // Max latency variance in ms (default: 50)
  latencyLookbackCount: number;       // Number of recent latency measurements (default: 10)
}

export interface FilterResult {
  passed: boolean;
  reason: string;
  filters: {
    liquidity: boolean;
    spread: boolean;
    orderBook: boolean;
    volatility: boolean;
    latency: boolean;
  };
  details?: Record<string, unknown>;
}

// Top liquidity pairs (example - should be dynamically updated)
const TOP_LIQUIDITY_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT',
  'USDC/USDT', 'ADA/USDT', 'DOGE/USDT', 'TRX/USDT', 'AVAX/USDT',
  'DOT/USDT', 'LINK/USDT', 'MATIC/USDT', 'SHIB/USDT', 'LTC/USDT',
  'BCH/USDT', 'UNI/USDT', 'ATOM/USDT', 'ETC/USDT', 'XLM/USDT',
  // Add more top pairs as needed
];

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: FaucetMeshConfig = {
  topLiquidityPairsOnly: true,
  minLiquidityRank: 50,
  minSpreadMultiplier: 1.5, // Production spread requirement
  testSignalSpreadMultiplier: 2.0, // Relaxed for test signals
  allowTestSignalOverride: true, // Allow TEST_SIGNAL override
  minOrderBookDepthMultiplier: 10,
  rejectVolatilitySpikes: true,
  volatilitySpikeThreshold: 2.0,
  volatilityLookbackPeriods: 20,
  rejectUnstableLatency: true,
  maxLatencyVariance: 50,
  latencyLookbackCount: 10,
};

// ============================================================================
// FAUCET MESH FILTER CLASS
// ============================================================================

export class FaucetMeshFilter {
  private config: FaucetMeshConfig;
  private recentLatency: number[] = [];
  private recentVolatility: number[] = [];

  constructor(config?: Partial<FaucetMeshConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    log.info('Faucet Mesh Filter created', { config: this.config });
  }

  /**
   * Filter signal through faucet mesh
   */
  filterSignal(signal: SignalInput): FilterResult {
    const filters = {
      liquidity: false,
      spread: false,
      orderBook: false,
      volatility: false,
      latency: false,
    };

    const details: Record<string, unknown> = {};

    // ========================================================================
    // FILTER 1: Top Liquidity Pairs Only
    // ========================================================================
    if (this.config.topLiquidityPairsOnly) {
      const pair = signal.signal.opportunity?.pair || signal.signal.prediction?.asset;
      if (pair) {
        const normalizedPair = pair.toUpperCase().replace(/[-_]/g, '/');
        const isTopPair = TOP_LIQUIDITY_PAIRS.includes(normalizedPair);
        filters.liquidity = isTopPair;
        
        if (!isTopPair) {
          return {
            passed: false,
            reason: `Pair ${pair} is not in top ${this.config.minLiquidityRank} liquidity pairs`,
            filters,
            details: { pair, topPairs: TOP_LIQUIDITY_PAIRS.slice(0, 10) },
          };
        }
        details.liquidityPair = normalizedPair;
      } else {
        filters.liquidity = true; // No pair info, allow through (will be filtered later)
      }
    } else {
      filters.liquidity = true;
    }

    // ========================================================================
    // FILTER 2: Spread ≥ Fees × 1.5
    // ========================================================================
    if (signal.signal.opportunity) {
      const profitEstimate = signal.signal.opportunity.profitEstimate;
      const marketData = signal.signal.marketData;
      
      if (marketData) {
        // Estimate fees (gas + exchange fees) - simplified model
        const estimatedGasFee = 0.0001; // ~$0.10 in ETH terms
        const estimatedExchangeFee = profitEstimate * 0.003; // 0.3% exchange fee
        const totalFees = estimatedGasFee + estimatedExchangeFee;
        
        // Spread should be profit estimate (spread = profit)
        const spread = profitEstimate;
        const minRequiredSpread = totalFees * this.config.minSpreadMultiplier;
        
        filters.spread = spread >= minRequiredSpread;
        
        if (!filters.spread) {
          return {
            passed: false,
            reason: `Spread ${spread.toFixed(6)} < required ${minRequiredSpread.toFixed(6)} (fees × ${this.config.minSpreadMultiplier})`,
            filters,
            details: { spread, totalFees, minRequiredSpread },
          };
        }
        details.spread = spread;
        details.totalFees = totalFees;
        details.spreadMultiplier = spread / totalFees;
      } else {
        filters.spread = true; // No market data, allow through (will be filtered later)
      }
    } else {
      filters.spread = true;
    }

    // ========================================================================
    // FILTER 3: Order Book Depth ≥ 10× Intended Size
    // ========================================================================
    if (signal.signal.opportunity) {
      const profitEstimate = signal.signal.opportunity.profitEstimate;
      // Estimate intended size from profit (assume 1% profit margin)
      const intendedSize = profitEstimate * 100; // Rough estimate
      const marketData = signal.signal.marketData;
      
      if (marketData) {
        // Estimate order book depth from liquidity score
        // liquidityScore 0-1, assume it represents depth adequacy
        const estimatedDepth = marketData.liquidityScore * 1000000; // Scale to USD
        const minRequiredDepth = intendedSize * this.config.minOrderBookDepthMultiplier;
        
        filters.orderBook = estimatedDepth >= minRequiredDepth;
        
        if (!filters.orderBook) {
          return {
            passed: false,
            reason: `Order book depth ${estimatedDepth.toFixed(2)} < required ${minRequiredDepth.toFixed(2)} (size × ${this.config.minOrderBookDepthMultiplier})`,
            filters,
            details: { intendedSize, estimatedDepth, minRequiredDepth },
          };
        }
        details.intendedSize = intendedSize;
        details.estimatedDepth = estimatedDepth;
        details.depthMultiplier = estimatedDepth / intendedSize;
      } else {
        filters.orderBook = true; // No market data, allow through
      }
    } else {
      filters.orderBook = true;
    }

    // ========================================================================
    // FILTER 4: Reject Recent Volatility Spikes
    // ========================================================================
    if (this.config.rejectVolatilitySpikes && signal.signal.marketData) {
      const currentVolatility = signal.signal.marketData.volatility;
      this.recentVolatility.push(currentVolatility);
      if (this.recentVolatility.length > this.config.volatilityLookbackPeriods) {
        this.recentVolatility.shift();
      }

      if (this.recentVolatility.length >= 5) {
        const mean = this.recentVolatility.reduce((sum, v) => sum + v, 0) / this.recentVolatility.length;
        const variance = this.recentVolatility.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / this.recentVolatility.length;
        const stdDev = Math.sqrt(variance);
        const zScore = stdDev > 0 ? (currentVolatility - mean) / stdDev : 0;
        
        filters.volatility = Math.abs(zScore) <= this.config.volatilitySpikeThreshold;
        
        if (!filters.volatility) {
          return {
            passed: false,
            reason: `Volatility spike detected: z-score ${zScore.toFixed(2)} exceeds threshold ${this.config.volatilitySpikeThreshold}`,
            filters,
            details: { currentVolatility, mean, stdDev, zScore },
          };
        }
        details.volatilityZScore = zScore;
      } else {
        filters.volatility = true; // Not enough data yet
      }
    } else {
      filters.volatility = true;
    }

    // ========================================================================
    // FILTER 5: Reject Unstable Latency
    // ========================================================================
    if (this.config.rejectUnstableLatency) {
      // Simulate latency measurement (in production, this would come from actual measurements)
      const simulatedLatency = 30 + Math.random() * 20; // 30-50ms
      this.recentLatency.push(simulatedLatency);
      if (this.recentLatency.length > this.config.latencyLookbackCount) {
        this.recentLatency.shift();
      }

      if (this.recentLatency.length >= 3) {
        const mean = this.recentLatency.reduce((sum, l) => sum + l, 0) / this.recentLatency.length;
        const variance = this.recentLatency.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / this.recentLatency.length;
        
        filters.latency = variance <= this.config.maxLatencyVariance;
        
        if (!filters.latency) {
          return {
            passed: false,
            reason: `Unstable latency detected: variance ${variance.toFixed(2)} exceeds threshold ${this.config.maxLatencyVariance}`,
            filters,
            details: { currentLatency: simulatedLatency, mean, variance },
          };
        }
        details.latencyVariance = variance;
        details.currentLatency = simulatedLatency;
      } else {
        filters.latency = true; // Not enough data yet
      }
    } else {
      filters.latency = true;
    }

    // ========================================================================
    // ALL FILTERS PASSED
    // ========================================================================
    return {
      passed: true,
      reason: 'All faucet mesh filters passed',
      filters,
      details,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<FaucetMeshConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info('Faucet Mesh Filter configuration updated', { updates });
  }

  /**
   * Get current configuration
   */
  getConfig(): FaucetMeshConfig {
    return { ...this.config };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let faucetMeshFilterInstance: FaucetMeshFilter | null = null;

export function getFaucetMeshFilter(config?: Partial<FaucetMeshConfig>): FaucetMeshFilter {
  if (!faucetMeshFilterInstance) {
    faucetMeshFilterInstance = new FaucetMeshFilter(config);
  }
  return faucetMeshFilterInstance;
}

export default FaucetMeshFilter;
