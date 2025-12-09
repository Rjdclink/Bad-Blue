// Multi-Oracle Price Validation System
// Cross-references multiple price sources to prevent manipulation
// Research-backed: Implementation based on DeFi security best practices

import logger from '../../../logger.js';
import type { ChainId } from '../core/lux-swarm';

export interface OracleConfig {
  name: string;
  type: OracleType;
  weight: number;           // Weight in consensus (0-1)
  maxStaleness: number;     // Maximum age in seconds
  minConfirmations: number; // Minimum block confirmations
}

export type OracleType = 
  | 'chainlink'      // Chainlink price feeds
  | 'uniswap_twap'   // Uniswap V3 TWAP
  | 'band'           // Band Protocol
  | 'dia'            // DIA Oracle
  | 'api3'           // API3 dAPI
  | 'pyth'           // Pyth Network
  | 'redstone'       // RedStone Oracle
  | 'dex_spot';      // Real-time DEX spot prices

export interface PriceData {
  oracle: string;
  price: number;
  timestamp: number;
  confidence: number;       // Oracle's confidence (0-1)
  staleness: number;        // Age in seconds
  source: OracleType;
}

export interface PriceValidationResult {
  isValid: boolean;
  consensusPrice: number;
  deviation: number;        // Max deviation from consensus
  outliers: string[];       // Oracles that deviated significantly
  confidence: number;       // Overall confidence (0-1)
  manipulation: ManipulationCheck;
  recommendation: 'proceed' | 'caution' | 'abort';
  details: ValidationDetail[];
}

export interface ManipulationCheck {
  suspected: boolean;
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  indicators: string[];
  honeypotProbability: number;
}

export interface ValidationDetail {
  oracle: string;
  price: number;
  deviation: number;
  status: 'valid' | 'stale' | 'outlier' | 'unavailable';
  weight: number;
}

// Default oracle configurations
const DEFAULT_ORACLES: OracleConfig[] = [
  { name: 'chainlink', type: 'chainlink', weight: 0.35, maxStaleness: 3600, minConfirmations: 1 },
  { name: 'uniswap_twap', type: 'uniswap_twap', weight: 0.25, maxStaleness: 600, minConfirmations: 1 },
  { name: 'pyth', type: 'pyth', weight: 0.20, maxStaleness: 300, minConfirmations: 1 },
  { name: 'dex_spot', type: 'dex_spot', weight: 0.20, maxStaleness: 30, minConfirmations: 0 }
];

// Threshold configurations
const THRESHOLDS = {
  maxDeviation: 0.02,          // 2% max deviation for valid price
  minOracles: 2,               // Minimum oracles needed
  minTotalWeight: 0.5,         // Minimum total weight for consensus
  outlierThreshold: 0.05,      // 5% deviation = outlier
  manipulationThreshold: 0.1,  // 10% deviation = manipulation risk
  honeypotVolumeRatio: 10      // Sell volume / buy volume ratio for honeypot
};

// Price result from oracle with timestamp
interface OraclePriceResult {
  price: number;
  timestamp: number;
}

class MultiOraclePriceValidator {
  private oracles: OracleConfig[];
  private priceCache: Map<string, PriceData[]> = new Map();
  private historicalPrices: Map<string, number[]> = new Map();

  constructor(oracles: OracleConfig[] = DEFAULT_ORACLES) {
    this.oracles = oracles;
  }

  /**
   * Validate price across multiple oracles
   */
  async validatePrice(
    asset: string,
    chain: ChainId,
    expectedPrice?: number
  ): Promise<PriceValidationResult> {
    const startTime = Date.now();

    // Fetch prices from all oracles
    const prices = await this.fetchAllPrices(asset, chain);

    // Filter valid prices (not stale)
    const validPrices = prices.filter(p => {
      const config = this.getOracleConfig(p.oracle);
      return config ? p.staleness <= config.maxStaleness : false;
    });

    // Check minimum oracle requirement
    if (validPrices.length < THRESHOLDS.minOracles) {
      return this.insufficientDataResult(prices);
    }

    // Calculate weighted consensus price
    const consensusPrice = this.calculateConsensusPrice(validPrices);

    // Calculate deviations
    const details = this.calculateDeviations(prices, consensusPrice);

    // Identify outliers
    const outliers = details.filter(d => d.status === 'outlier').map(d => d.oracle);

    // Calculate overall deviation
    const maxDeviation = Math.max(...details.filter(d => d.status === 'valid').map(d => d.deviation));

    // Check for manipulation
    const manipulation = await this.checkManipulation(asset, chain, consensusPrice, prices);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(validPrices, maxDeviation, manipulation);

    // Determine recommendation
    const recommendation = this.determineRecommendation(maxDeviation, manipulation, confidence);

    const elapsed = Date.now() - startTime;

    logger.info('Price validation complete', {
      component: 'MultiOraclePriceValidator',
      asset,
      chain,
      consensusPrice: consensusPrice.toFixed(6),
      maxDeviation: `${(maxDeviation * 100).toFixed(2)}%`,
      outliers: outliers.length,
      recommendation,
      elapsed: `${elapsed}ms`
    });

    return {
      isValid: recommendation !== 'abort',
      consensusPrice,
      deviation: maxDeviation,
      outliers,
      confidence,
      manipulation,
      recommendation,
      details
    };
  }

  /**
   * Fetch prices from all configured oracles
   */
  private async fetchAllPrices(asset: string, chain: ChainId): Promise<PriceData[]> {
    const prices: PriceData[] = [];
    const now = Date.now();

    for (const oracle of this.oracles) {
      try {
        const priceResult = await this.fetchOraclePrice(asset, chain, oracle);
        if (priceResult !== null) {
          // Calculate staleness from the price timestamp
          const priceTimestamp = priceResult.timestamp || now;
          const stalenessMs = now - priceTimestamp;
          const stalenessSeconds = Math.max(0, Math.floor(stalenessMs / 1000));
          
          prices.push({
            oracle: oracle.name,
            price: priceResult.price,
            timestamp: priceTimestamp,
            confidence: this.estimateOracleConfidence(oracle),
            staleness: stalenessSeconds,
            source: oracle.type
          });
        }
      } catch (error) {
        logger.warn(`Failed to fetch price from ${oracle.name}`, {
          component: 'MultiOraclePriceValidator',
          oracle: oracle.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return prices;
  }

  /**
   * Fetch price from specific oracle
   * NOTE: This is a demonstration/testing implementation using mock data.
   * For production deployment, implement actual RPC calls to oracle contracts:
   * - Chainlink: AggregatorV3Interface.latestRoundData()
   * - Uniswap TWAP: OracleLibrary.consult()
   * - Pyth: IPyth.getPrice()
   */
  private async fetchOraclePrice(
    asset: string,
    chain: ChainId,
    oracle: OracleConfig
  ): Promise<OraclePriceResult | null> {
    // Production implementation would make actual RPC calls:
    // const provider = new JsonRpcProvider(RPC_URLS[chain]);
    // const contract = new Contract(ORACLE_ADDRESSES[oracle.type], ABI, provider);
    // const result = await contract.latestRoundData();
    // return { price: result.answer, timestamp: result.updatedAt * 1000 };

    // Demo/Testing: Returns mock prices with realistic oracle variations
    const basePrice = this.getBasePrice(asset);
    if (basePrice === null) return null;

    // Simulate oracle-specific characteristics and staleness
    let variation = 0;
    let stalenessOffsetMs = 0;
    
    switch (oracle.type) {
      case 'chainlink':
        variation = (Math.random() - 0.5) * 0.002; // ±0.1% - most stable
        stalenessOffsetMs = Math.floor(Math.random() * 60000); // 0-60 seconds
        break;
      case 'uniswap_twap':
        variation = (Math.random() - 0.5) * 0.004; // ±0.2% - time-weighted
        stalenessOffsetMs = Math.floor(Math.random() * 120000); // 0-120 seconds
        break;
      case 'pyth':
        variation = (Math.random() - 0.5) * 0.003; // ±0.15% - cross-chain
        stalenessOffsetMs = Math.floor(Math.random() * 30000); // 0-30 seconds
        break;
      case 'dex_spot':
        variation = (Math.random() - 0.5) * 0.01; // ±0.5% - real-time spot
        stalenessOffsetMs = Math.floor(Math.random() * 5000); // 0-5 seconds (freshest)
        break;
      default:
        variation = (Math.random() - 0.5) * 0.005;
        stalenessOffsetMs = Math.floor(Math.random() * 90000);
    }

    return {
      price: basePrice * (1 + variation),
      timestamp: Date.now() - stalenessOffsetMs
    };
  }

  /**
   * Get base price for asset (demonstration/testing data)
   * NOTE: For production, this should fetch real-time prices from
   * CoinGecko, CoinMarketCap API, or on-chain oracle aggregators
   */
  private getBasePrice(asset: string): number | null {
    // Demo prices - MUST be replaced with real-time data for production
    const basePrices: Record<string, number> = {
      'ETH': 2000,
      'WETH': 2000,
      'BTC': 40000,
      'WBTC': 40000,
      'USDC': 1.0,
      'USDT': 1.0,
      'DAI': 1.0,
      'MATIC': 0.8,
      'BNB': 300,
      'AVAX': 35,
      'ARB': 1.2,
      'OP': 2.5
    };

    return basePrices[asset.toUpperCase()] || null;
  }

  /**
   * Calculate weighted consensus price
   */
  private calculateConsensusPrice(prices: PriceData[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const p of prices) {
      const config = this.getOracleConfig(p.oracle);
      if (!config) continue;

      const weight = config.weight * p.confidence;
      weightedSum += p.price * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Calculate deviations from consensus
   */
  private calculateDeviations(prices: PriceData[], consensus: number): ValidationDetail[] {
    return prices.map(p => {
      const deviation = Math.abs(p.price - consensus) / consensus;
      const config = this.getOracleConfig(p.oracle);
      
      let status: ValidationDetail['status'] = 'valid';
      if (p.staleness > (config?.maxStaleness || 3600)) {
        status = 'stale';
      } else if (deviation > THRESHOLDS.outlierThreshold) {
        status = 'outlier';
      }

      return {
        oracle: p.oracle,
        price: p.price,
        deviation,
        status,
        weight: config?.weight || 0
      };
    });
  }

  /**
   * Check for price manipulation
   */
  private async checkManipulation(
    asset: string,
    chain: ChainId,
    consensusPrice: number,
    prices: PriceData[]
  ): Promise<ManipulationCheck> {
    const indicators: string[] = [];
    let riskLevel: ManipulationCheck['risk'] = 'none';

    // Check 1: Large deviation between oracles
    const priceValues = prices.map(p => p.price);
    const maxPrice = Math.max(...priceValues);
    const minPrice = Math.min(...priceValues);
    const spread = (maxPrice - minPrice) / consensusPrice;

    if (spread > 0.1) {
      indicators.push('Large price spread between oracles');
      riskLevel = 'high';
    } else if (spread > 0.05) {
      indicators.push('Elevated price spread between oracles');
      riskLevel = this.elevateRisk(riskLevel, 'medium');
    }

    // Check 2: Sudden price movement
    const history = this.historicalPrices.get(asset) || [];
    if (history.length > 0) {
      const avgHistorical = history.reduce((a, b) => a + b, 0) / history.length;
      const movement = Math.abs(consensusPrice - avgHistorical) / avgHistorical;
      
      if (movement > 0.2) {
        indicators.push('Sudden large price movement detected');
        riskLevel = this.elevateRisk(riskLevel, 'high');
      } else if (movement > 0.1) {
        indicators.push('Unusual price movement');
        riskLevel = this.elevateRisk(riskLevel, 'medium');
      }
    }

    // Update price history
    this.updatePriceHistory(asset, consensusPrice);

    // Check 3: Spot vs TWAP divergence
    const spotPrice = prices.find(p => p.source === 'dex_spot')?.price;
    const twapPrice = prices.find(p => p.source === 'uniswap_twap')?.price;
    
    if (spotPrice && twapPrice) {
      const spotTwapDiff = Math.abs(spotPrice - twapPrice) / twapPrice;
      if (spotTwapDiff > 0.05) {
        indicators.push('Spot vs TWAP divergence (possible manipulation)');
        riskLevel = this.elevateRisk(riskLevel, 'high');
      }
    }

    // Estimate honeypot probability
    const honeypotProbability = this.estimateHoneypotProbability(indicators.length, spread);

    return {
      suspected: riskLevel !== 'none' && riskLevel !== 'low',
      risk: riskLevel,
      indicators,
      honeypotProbability
    };
  }

  /**
   * Elevate risk level
   */
  private elevateRisk(
    current: ManipulationCheck['risk'],
    proposed: ManipulationCheck['risk']
  ): ManipulationCheck['risk'] {
    const levels = ['none', 'low', 'medium', 'high', 'critical'];
    const currentIdx = levels.indexOf(current);
    const proposedIdx = levels.indexOf(proposed);
    return levels[Math.max(currentIdx, proposedIdx)] as ManipulationCheck['risk'];
  }

  /**
   * Estimate honeypot probability
   */
  private estimateHoneypotProbability(indicatorCount: number, spread: number): number {
    let probability = 0;
    
    // More indicators = higher probability
    probability += indicatorCount * 0.1;
    
    // Higher spread = higher probability
    probability += spread * 2;
    
    return Math.min(1, Math.max(0, probability));
  }

  /**
   * Update price history for an asset
   */
  private updatePriceHistory(asset: string, price: number): void {
    const history = this.historicalPrices.get(asset) || [];
    history.push(price);
    
    // Keep last 100 prices
    if (history.length > 100) {
      history.shift();
    }
    
    this.historicalPrices.set(asset, history);
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidence(
    prices: PriceData[],
    deviation: number,
    manipulation: ManipulationCheck
  ): number {
    let confidence = 1.0;

    // Reduce confidence based on number of valid oracles
    confidence *= Math.min(1, prices.length / this.oracles.length);

    // Reduce confidence based on deviation
    confidence *= Math.max(0, 1 - deviation * 10);

    // Reduce confidence based on manipulation risk
    const riskPenalty: Record<string, number> = {
      'none': 0,
      'low': 0.1,
      'medium': 0.3,
      'high': 0.5,
      'critical': 0.8
    };
    confidence *= (1 - riskPenalty[manipulation.risk]);

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determine trade recommendation
   */
  private determineRecommendation(
    deviation: number,
    manipulation: ManipulationCheck,
    confidence: number
  ): 'proceed' | 'caution' | 'abort' {
    if (manipulation.risk === 'critical' || manipulation.risk === 'high') {
      return 'abort';
    }

    if (deviation > THRESHOLDS.maxDeviation) {
      return 'abort';
    }

    if (confidence < 0.5 || manipulation.risk === 'medium') {
      return 'caution';
    }

    if (confidence >= 0.8 && deviation < 0.01) {
      return 'proceed';
    }

    return 'caution';
  }

  /**
   * Get oracle config by name
   */
  private getOracleConfig(name: string): OracleConfig | undefined {
    return this.oracles.find(o => o.name === name);
  }

  /**
   * Estimate oracle confidence based on type
   */
  private estimateOracleConfidence(oracle: OracleConfig): number {
    const baseConfidence: Record<OracleType, number> = {
      'chainlink': 0.95,
      'uniswap_twap': 0.90,
      'band': 0.85,
      'dia': 0.80,
      'api3': 0.85,
      'pyth': 0.90,
      'redstone': 0.85,
      'dex_spot': 0.75
    };

    return baseConfidence[oracle.type] || 0.7;
  }

  /**
   * Result when insufficient data
   */
  private insufficientDataResult(prices: PriceData[]): PriceValidationResult {
    return {
      isValid: false,
      consensusPrice: prices[0]?.price || 0,
      deviation: 1,
      outliers: [],
      confidence: 0,
      manipulation: {
        suspected: true,
        risk: 'high',
        indicators: ['Insufficient oracle data'],
        honeypotProbability: 0.5
      },
      recommendation: 'abort',
      details: prices.map(p => ({
        oracle: p.oracle,
        price: p.price,
        deviation: 0,
        status: 'unavailable' as const,
        weight: 0
      }))
    };
  }
}

export { MultiOraclePriceValidator };
export default MultiOraclePriceValidator;
