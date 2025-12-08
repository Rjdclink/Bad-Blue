// Opportunity Quality Analyzer - 15-Dimensional Quality Scoring System

import { ExecutionTier } from './risk-tier-system';

interface Opportunity {
  asset: string;
  chain: string;
  profit: number;
  type: 'simple' | 'triangle' | 'quadrilateral' | 'cross-chain';
}

interface Metrics {
  liquidityDepth: number;
  spreadSize: number;
  priceStability: number;
  volumeConsistency: number;
  slippageRisk: number;
  gasVolatility: number;
  competitionLevel: number;
  blockTiming: number;
  contractRisk: number;
  historicalSuccess: number;
  oracleDeviation: number;
  networkCongestion: number;
  whaleActivity: number;
  flashLoanAvailability: number;
  freshnessScore: number;
}

interface OpportunityScore {
  opportunity: Opportunity;
  qualityScore: number;
  successProbability: number;
  expectedValue: number;
  riskScore: number;
  tier: ExecutionTier;
  confidence: 'ultra-high' | 'high' | 'medium' | 'low';
}

class OpportunityQualityAnalyzer {
  // Weights for each of the 15 dimensions (order: liquidity, spread, stability, volume, slippage, 
  // gas, competition, timing, contract, history, oracle, network, whale, flashloan, freshness)
  private static readonly DIMENSION_WEIGHTS = [
    0.15, // liquidityDepth - most important
    0.12, // spreadSize
    0.10, // priceStability
    0.08, // volumeConsistency
    0.10, // slippageRisk
    0.05, // gasVolatility
    0.08, // competitionLevel
    0.07, // blockTiming
    0.09, // contractRisk
    0.06, // historicalSuccess
    0.04, // oracleDeviation
    0.03, // networkCongestion
    0.02, // whaleActivity
    0.01, // flashLoanAvailability
    0.05  // freshnessScore
  ];
  
  // Main analysis function
  async analyze(opp: Opportunity): Promise<OpportunityScore> {
    const metrics = await this.measure15Dimensions(opp);
    const qualityScore = this.calculateComposite(metrics);
    const successProbability = this.predictSuccess(metrics);
    const riskScore = this.calculateRisk(metrics);
    const expectedValue = opp.profit * successProbability;
    const tier = this.classifyTier(successProbability);
    const confidence = this.categorizeConfidence(successProbability);
    
    return {
      opportunity: opp,
      qualityScore,
      successProbability,
      expectedValue,
      riskScore,
      tier,
      confidence
    };
  }
  
  // Measure all 15 dimensions (can use mock values for now)
  private async measure15Dimensions(opp: Opportunity): Promise<Metrics> {
    // Mock values for now - in production, these would be real measurements
    return {
      liquidityDepth: 95,
      spreadSize: 85,
      priceStability: 92,
      volumeConsistency: 88,
      slippageRisk: 90,
      gasVolatility: 75,
      competitionLevel: 82,
      blockTiming: 94,
      contractRisk: 98,
      historicalSuccess: 91,
      oracleDeviation: 89,
      networkCongestion: 86,
      whaleActivity: 93,
      flashLoanAvailability: 97,
      freshnessScore: 99
    };
  }
  
  // Weighted composite score
  private calculateComposite(m: Metrics): number {
    const weights = OpportunityQualityAnalyzer.DIMENSION_WEIGHTS;
    return (
      m.liquidityDepth * weights[0] +
      m.spreadSize * weights[1] +
      m.priceStability * weights[2] +
      m.volumeConsistency * weights[3] +
      m.slippageRisk * weights[4] +
      m.gasVolatility * weights[5] +
      m.competitionLevel * weights[6] +
      m.blockTiming * weights[7] +
      m.contractRisk * weights[8] +
      m.historicalSuccess * weights[9] +
      m.oracleDeviation * weights[10] +
      m.networkCongestion * weights[11] +
      m.whaleActivity * weights[12] +
      m.flashLoanAvailability * weights[13] +
      m.freshnessScore * weights[14]
    );
  }
  
  // Lightweight ML prediction (sigmoid activation)
  private predictSuccess(metrics: Metrics): number {
    const features = [
      metrics.liquidityDepth / 100,
      metrics.spreadSize / 100,
      metrics.priceStability / 100,
      metrics.volumeConsistency / 100,
      metrics.slippageRisk / 100,
      metrics.gasVolatility / 100,
      metrics.competitionLevel / 100,
      metrics.blockTiming / 100,
      metrics.contractRisk / 100,
      metrics.historicalSuccess / 100,
      metrics.oracleDeviation / 100,
      metrics.networkCongestion / 100,
      metrics.whaleActivity / 100,
      metrics.flashLoanAvailability / 100,
      metrics.freshnessScore / 100
    ];
    
    const weights = OpportunityQualityAnalyzer.DIMENSION_WEIGHTS;
    const score = features.reduce((sum, f, i) => sum + f * weights[i], 0);
    
    // Sigmoid activation
    return 1 / (1 + Math.exp(-10 * (score - 0.5)));
  }
  
  // Risk score calculation
  private calculateRisk(metrics: Metrics): number {
    return (
      (100 - metrics.slippageRisk) * 0.3 +
      (100 - metrics.gasVolatility) * 0.2 +
      (100 - metrics.competitionLevel) * 0.2 +
      metrics.contractRisk * 0.3
    );
  }
  
  // Classify into execution tier
  private classifyTier(probability: number): ExecutionTier {
    if (probability >= 0.99) return ExecutionTier.ULTRA_SAFE;
    if (probability >= 0.95) return ExecutionTier.SAFE;
    if (probability >= 0.90) return ExecutionTier.BALANCED;
    if (probability >= 0.85) return ExecutionTier.AGGRESSIVE;
    if (probability >= 0.80) return ExecutionTier.DEGEN;
    return ExecutionTier.SKIP;
  }
  
  // Categorize confidence
  private categorizeConfidence(probability: number): 'ultra-high' | 'high' | 'medium' | 'low' {
    if (probability >= 0.95) return 'ultra-high';
    if (probability >= 0.90) return 'high';
    if (probability >= 0.85) return 'medium';
    return 'low';
  }
}

export { OpportunityQualityAnalyzer };
export type { Opportunity, Metrics, OpportunityScore };
