/**
 * CRYPTARA CONFIGURATION
 * All thresholds and constants externalized
 */

import {
  Rank,
  CryptaraConfig,
  RankDefinition,
  MultiplierTier,
} from './cryptaraTypes';

// ============================================
// Main Configuration
// ============================================
export const CRYPTARA_CONFIG: CryptaraConfig = {
  // Weights must sum to 1.0 (0.25 + 0.20 + 0.30 + 0.15 + 0.10 = 1.00)
  weights: {
    accuracy: 0.25,
    stability: 0.20,
    profit: 0.30,
    riskReduction: 0.15,
    safetyCompliance: 0.10,
  },

  growthRates: {
    exceptional: 0.05,
    excellent: 0.03,
    good: 0.01,
    neutral: 0.00,
    poor: -0.02,
    unacceptable: -0.05,
  },

  thresholds: {
    exceptionalScore: 95,
    excellentScore: 85,
    goodScore: 70,
    neutralScore: 60,
    poorScore: 50,
  },

  normalization: {
    accuracyBaseline: 0.6,
    profitTargetRatio: 1.0,
  },

  history: {
    trendWindowSize: 20,
    recentWindowSize: 10,
  },

  autonomy: {
    floor: 20,
    ceiling: 100,
  },

  multiplier: {
    floor: 1.0,
    ceiling: 1.6,
  },
};

// ============================================
// Rank Definitions
// ============================================
export const RANK_DEFINITIONS: Record<Rank, RankDefinition> = {
  [Rank.RANK_1]: {
    level: Rank.RANK_1,
    title: 'Head of Autonomous Execution',
    multiplierUnlocked: 1.2,
    baselineAutonomy: 50,
    requirements: {
      daysAtPreviousRank: 0,
      minProcessScore: 0,
      minSuccessRate: 0,
      zeroViolations: false,
      sustainedExcellence: false,
    },
    benefits: {
      tierAccessExpanded: false,
      memoryPartitionLifted: false,
      strategicInput: false,
    },
  },
  [Rank.RANK_2]: {
    level: Rank.RANK_2,
    title: 'Primary Profit Generator',
    multiplierUnlocked: 1.3,
    baselineAutonomy: 60,
    requirements: {
      daysAtPreviousRank: 30,
      minProcessScore: 85,
      minSuccessRate: 0.80,
      zeroViolations: true,
      sustainedExcellence: true,
    },
    benefits: {
      tierAccessExpanded: true,
      memoryPartitionLifted: false,
      strategicInput: false,
    },
  },
  [Rank.RANK_3]: {
    level: Rank.RANK_3,
    title: 'Principal Systems Strategist',
    multiplierUnlocked: 1.4,
    baselineAutonomy: 70,
    requirements: {
      daysAtPreviousRank: 60,
      minProcessScore: 90,
      minSuccessRate: 0.85,
      zeroViolations: true,
      sustainedExcellence: true,
      strategicCapability: true,
    },
    benefits: {
      tierAccessExpanded: true,
      memoryPartitionLifted: true,
      strategicInput: true,
    },
  },
  [Rank.RANK_4]: {
    level: Rank.RANK_4,
    title: 'Executive Orchestration Lead',
    multiplierUnlocked: 1.5,
    baselineAutonomy: 80,
    requirements: {
      daysAtPreviousRank: 90,
      minProcessScore: 95,
      minSuccessRate: 0.90,
      zeroViolations: true,
      sustainedExcellence: true,
      strategicCapability: true,
      multiDomainExpertise: true,
    },
    benefits: {
      tierAccessExpanded: true,
      memoryPartitionLifted: true,
      strategicInput: true,
    },
  },
  [Rank.RANK_5]: {
    level: Rank.RANK_5,
    title: 'Chief Autonomous Officer',
    multiplierUnlocked: 1.6,
    baselineAutonomy: 100,
    requirements: {
      daysAtPreviousRank: 120,
      minProcessScore: 98,
      minSuccessRate: 0.95,
      zeroViolations: true,
      sustainedExcellence: true,
      strategicCapability: true,
      multiDomainExpertise: true,
    },
    benefits: {
      tierAccessExpanded: true,
      memoryPartitionLifted: true,
      strategicInput: true,
    },
  },
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get the rank definition by rank level
 */
export function getRankDefinition(rank: Rank): RankDefinition {
  return RANK_DEFINITIONS[rank];
}

/**
 * Get the next rank level
 */
export function getNextRank(currentRank: Rank): Rank | null {
  const nextLevel = currentRank + 1;
  if (nextLevel <= Rank.RANK_5) {
    return nextLevel as Rank;
  }
  return null;
}

/**
 * Get the growth rate based on composite score
 */
export function getGrowthRate(compositeScore: number): number {
  const { thresholds, growthRates } = CRYPTARA_CONFIG;

  if (compositeScore >= thresholds.exceptionalScore) {
    return growthRates.exceptional;
  } else if (compositeScore >= thresholds.excellentScore) {
    return growthRates.excellent;
  } else if (compositeScore >= thresholds.goodScore) {
    return growthRates.good;
  } else if (compositeScore >= thresholds.neutralScore) {
    return growthRates.neutral;
  } else if (compositeScore >= thresholds.poorScore) {
    return growthRates.poor;
  } else {
    return growthRates.unacceptable;
  }
}

/**
 * Clamp autonomy value within configured bounds
 */
export function clampAutonomy(value: number): number {
  const { floor, ceiling } = CRYPTARA_CONFIG.autonomy;
  return Math.max(floor, Math.min(ceiling, value));
}

/**
 * Clamp multiplier value within configured bounds
 */
export function clampMultiplier(value: number): number {
  const { floor, ceiling } = CRYPTARA_CONFIG.multiplier;
  return Math.max(floor, Math.min(ceiling, value));
}

// ============================================
// Multiplier Tiers
// ============================================
export const MULTIPLIER_TIERS: MultiplierTier[] = [
  { multiplier: 1.0, tradesRequired: 0, avgScore: 0, violations: Infinity },
  { multiplier: 1.1, tradesRequired: 50, avgScore: 70, violations: 5 },
  { multiplier: 1.2, tradesRequired: 100, avgScore: 75, violations: 3 },
  { multiplier: 1.3, tradesRequired: 200, avgScore: 80, violations: 2 },
  { multiplier: 1.4, tradesRequired: 350, avgScore: 85, violations: 1 },
  { multiplier: 1.5, tradesRequired: 500, avgScore: 90, violations: 0 },
  { multiplier: 1.6, tradesRequired: 750, avgScore: 95, violations: 0 },
];
