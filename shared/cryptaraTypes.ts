/**
 * CRYPTARA TYPE DEFINITIONS
 * All interfaces and types required for reward system
 * NO EXTERNAL DEPENDENCIES
 */

// ============================================
// Rank Types (defined first for forward reference)
// ============================================
export enum Rank {
  RANK_1 = 1,
  RANK_2 = 2,
  RANK_3 = 3,
  RANK_4 = 4,
  RANK_5 = 5,
}

// ============================================
// Performance Metrics
// ============================================
export interface PerformanceMetrics {
  accuracy: number;           // 0-1
  stability: number;          // 0-1
  profit: number;             // USD
  riskReduction: number;      // 0-1
  safetyCompliance: number;   // 0-1
  processScore: number;       // 0-100
  disciplineScore: number;    // 0-100
}

// ============================================
// Reward Signal
// ============================================
export interface RewardSignal {
  compositeScore: number;
  components: {
    accuracy: number;
    stability: number;
    profit: number;
    riskReduction: number;
    safetyCompliance: number;
  };
  autonomyDelta: number;
  multiplierDelta: number;
  feedback: string;
  trend: 'improving' | 'stable' | 'degrading';
  rankEligibility: {
    eligible: boolean;
    daysUntilEligible: number;
    nextRank: Rank | null;
  };
}

// ============================================
// Application Result
// ============================================
export interface RewardApplication {
  autonomy: {
    previous: number;
    new: number;
    delta: number;
    level: 0 | 1 | 2 | 3 | 4;
  };
  multiplier: {
    previous: number;
    new: number;
    delta: number;
  };
  feedback: string;
  timestamp: number;
}

export interface PromotionEvent {
  from: Rank;
  to: Rank;
  timestamp: number;
  multiplierUnlocked: number;
  baselineAutonomyGranted: number;
}

export interface PromotionEligibility {
  eligible: boolean;
  reason: string;
  nextRank: Rank | null;
  requirements: Record<string, boolean> | null;
  daysRemaining?: number;
}

export interface PromotionResult {
  success: boolean;
  message: string;
  newRank: Rank | null;
  multiplierUnlocked?: number;
  newBaseline?: number;
}

export interface RankBenefits {
  tierAccessExpanded: boolean;
  memoryPartitionLifted: boolean;
  strategicInput: boolean;
}

export interface RankStatus {
  currentRank: Rank;
  currentTitle: string;
  earnedDate: number;
  daysAtRank: number;
  multiplierUnlocked: number;
  baselineAutonomy: number;
  promotionEligibility: PromotionEligibility;
  benefits: RankBenefits;
}

export interface RankRequirements {
  daysAtPreviousRank: number;
  minProcessScore: number;
  minSuccessRate: number;
  zeroViolations: boolean;
  sustainedExcellence: boolean;
  strategicCapability?: boolean;
  multiDomainExpertise?: boolean;
}

export interface RankDefinition {
  level: Rank;
  title: string;
  multiplierUnlocked: number;
  baselineAutonomy: number;
  requirements: RankRequirements;
  benefits: RankBenefits;
}

// ============================================
// Multiplier Types
// ============================================
export interface MultiplierEvent {
  from: number;
  to: number;
  timestamp: number;
  reason: string;
}

export interface MultiplierRequirements {
  tradesRemaining: number;
  avgScoreNeeded: number;
  currentAvgScore: number;
  violationsAllowed: number;
  currentViolations: number;
}

export interface MultiplierAdvancement {
  eligible: boolean;
  reason: string;
  nextMultiplier: number | null;
  requirements?: MultiplierRequirements;
}

export interface MultiplierResult {
  success: boolean;
  message: string;
  newMultiplier: number;
  capacityIncrease?: number;
}

// ============================================
// Configuration Types
// ============================================
export interface CryptaraWeights {
  accuracy: number;
  stability: number;
  profit: number;
  riskReduction: number;
  safetyCompliance: number;
}

export interface CryptaraGrowthRates {
  exceptional: number;
  excellent: number;
  good: number;
  neutral: number;
  poor: number;
  unacceptable: number;
}

export interface CryptaraThresholds {
  exceptionalScore: number;
  excellentScore: number;
  goodScore: number;
  neutralScore: number;
  poorScore: number;
}

export interface CryptaraNormalization {
  accuracyBaseline: number;
  profitTargetRatio: number;
}

export interface CryptaraHistory {
  trendWindowSize: number;
  recentWindowSize: number;
}

export interface CryptaraAutonomy {
  floor: number;
  ceiling: number;
}

export interface CryptaraMultiplier {
  floor: number;
  ceiling: number;
}

export interface CryptaraConfig {
  weights: CryptaraWeights;
  growthRates: CryptaraGrowthRates;
  thresholds: CryptaraThresholds;
  normalization: CryptaraNormalization;
  history: CryptaraHistory;
  autonomy: CryptaraAutonomy;
  multiplier: CryptaraMultiplier;
}

// ============================================
// Persistence Types
// ============================================
export interface RankState {
  currentRank: Rank;
  rankEarnedDate: number;
  promotionHistory: PromotionEvent[];
}

export interface MultiplierState {
  currentMultiplier: number;
  multiplierHistory: MultiplierEvent[];
}

export interface PersistenceAdapter {
  loadPerformanceHistory(): Promise<PerformanceMetrics[]>;
  savePerformanceHistory(history: PerformanceMetrics[]): Promise<void>;
  loadRankState(): Promise<RankState | null>;
  saveRankState(state: RankState): Promise<void>;
  loadMultiplierState(): Promise<MultiplierState | null>;
  saveMultiplierState(state: MultiplierState): Promise<void>;
}

// ============================================
// Multiplier Tier Types
// ============================================
export interface MultiplierTier {
  multiplier: number;
  tradesRequired: number;
  avgScore: number;
  violations: number;
}

export interface TradeStatistics {
  totalTrades: number;
  avgProcessScore: number;
  violationCount: number;
}

// ============================================
// Normalized Scores
// ============================================
export interface NormalizedScores {
  accuracy: number;
  stability: number;
  profit: number;
  riskReduction: number;
  safetyCompliance: number;
}

// ============================================
// Rank Eligibility for Reward Signal
// ============================================
export interface RankEligibilityInfo {
  eligible: boolean;
  daysUntilEligible: number;
  nextRank: Rank | null;
}
