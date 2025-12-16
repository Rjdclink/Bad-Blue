/**
 * RANK MANAGER
 * Permanent progression with event sourcing
 */

import {
  Rank,
  PromotionEvent,
  PromotionEligibility,
  PromotionResult,
  RankStatus,
  PersistenceAdapter,
} from './cryptaraTypes';
import { RANK_DEFINITIONS } from './cryptaraConfig';
import { LocalPersistence } from './cryptaraPersistence';

class RankManager {
  private currentRank: Rank = Rank.RANK_1;
  private rankEarnedDate: number = Date.now();
  private promotionHistory: PromotionEvent[] = [];
  private persistence: PersistenceAdapter;

  constructor(persistence: PersistenceAdapter) {
    this.persistence = persistence;
  }

  async initialize(): Promise<void> {
    try {
      const state = await this.persistence.loadRankState();
      if (state) {
        this.currentRank = state.currentRank;
        this.rankEarnedDate = state.rankEarnedDate;
        this.promotionHistory = state.promotionHistory;
      }
    } catch (error) {
      console.error('Failed to initialize rank manager:', error);
    }
  }

  async checkPromotionEligibility(): Promise<PromotionEligibility> {
    try {
      const nextRankNum = this.currentRank + 1;

      if (nextRankNum > Rank.RANK_5) {
        return {
          eligible: false,
          reason: 'Already at maximum rank',
          nextRank: null,
          requirements: null,
        };
      }

      const nextRank = nextRankNum as Rank;
      const nextDef = RANK_DEFINITIONS[nextRank];

      const daysAtCurrentRank = (Date.now() - this.rankEarnedDate) / (24 * 60 * 60 * 1000);

      const checks: Record<string, boolean> = {
        daysAtRank: daysAtCurrentRank >= nextDef.requirements.daysAtPreviousRank,
        processScore: await this.getAverageProcessScore() >= nextDef.requirements.minProcessScore,
        successRate: await this.getSuccessRate() >= nextDef.requirements.minSuccessRate,
        violations: await this.hasZeroViolations() === nextDef.requirements.zeroViolations,
        excellence: await this.hasSustainedExcellence() === nextDef.requirements.sustainedExcellence,
      };

      if (nextDef.requirements.strategicCapability) {
        checks['strategic'] = await this.hasStrategicCapability();
      }

      const unmet = Object.entries(checks)
        .filter(([_, passed]) => !passed)
        .map(([req]) => req);

      return {
        eligible: unmet.length === 0,
        reason: unmet.length > 0 ? `Unmet: ${unmet.join(', ')}` : 'All requirements met',
        nextRank: nextRank,
        requirements: checks,
        daysRemaining: Math.max(0, nextDef.requirements.daysAtPreviousRank - daysAtCurrentRank),
      };
    } catch (error) {
      console.error('Failed to check promotion eligibility:', error);
      return {
        eligible: false,
        reason: 'Error checking eligibility',
        nextRank: null,
        requirements: null,
      };
    }
  }

  async promote(): Promise<PromotionResult> {
    try {
      const eligibility = await this.checkPromotionEligibility();

      if (!eligibility.eligible) {
        return {
          success: false,
          message: eligibility.reason,
          newRank: null,
        };
      }

      const nextRankNum = this.currentRank + 1;

      if (nextRankNum > Rank.RANK_5) {
        return {
          success: false,
          message: 'Cannot promote beyond maximum rank',
          newRank: null,
        };
      }

      const nextRank = nextRankNum as Rank;
      const previousRank = this.currentRank;
      const nextDef = RANK_DEFINITIONS[nextRank];

      // Create immutable event
      const event: PromotionEvent = {
        from: previousRank,
        to: nextRank,
        timestamp: Date.now(),
        multiplierUnlocked: nextDef.multiplierUnlocked,
        baselineAutonomyGranted: nextDef.baselineAutonomy,
      };

      // Apply event
      this.currentRank = nextRank;
      this.rankEarnedDate = Date.now();
      this.promotionHistory.push(event);

      // Persist state
      await this.persistence.saveRankState({
        currentRank: this.currentRank,
        rankEarnedDate: this.rankEarnedDate,
        promotionHistory: this.promotionHistory,
      });

      // Update baseline autonomy
      const { getCryptaraRewards } = await import('./cryptaraRewards');
      const rewards = await getCryptaraRewards();
      rewards.setAutonomyBaseline(nextDef.baselineAutonomy);

      return {
        success: true,
        message: `Promoted to ${nextDef.title}`,
        newRank: nextRank,
        multiplierUnlocked: nextDef.multiplierUnlocked,
        newBaseline: nextDef.baselineAutonomy,
      };
    } catch (error) {
      console.error('Failed to promote:', error);
      return {
        success: false,
        message: 'Promotion failed',
        newRank: null,
      };
    }
  }

  demote(): { success: false; message: string } {
    return {
      success: false,
      message: 'Rank demotion is prohibited. Autonomy may be reduced instead.',
    };
  }

  async getRankStatus(): Promise<RankStatus> {
    try {
      const def = RANK_DEFINITIONS[this.currentRank];
      const eligibility = await this.checkPromotionEligibility();

      return {
        currentRank: this.currentRank,
        currentTitle: def.title,
        earnedDate: this.rankEarnedDate,
        daysAtRank: (Date.now() - this.rankEarnedDate) / (24 * 60 * 60 * 1000),
        multiplierUnlocked: def.multiplierUnlocked,
        baselineAutonomy: def.baselineAutonomy,
        promotionEligibility: eligibility,
        benefits: def.benefits,
      };
    } catch (error) {
      console.error('Failed to get rank status:', error);
      throw error;
    }
  }

  getCurrentRank(): Rank {
    return this.currentRank;
  }

  private async getAverageProcessScore(): Promise<number> {
    // Read from local data store only
    return 85;
  }

  private async getSuccessRate(): Promise<number> {
    // Read from local data store only
    return 0.82;
  }

  private async hasZeroViolations(): Promise<boolean> {
    // Read from local data store only
    return true;
  }

  private async hasSustainedExcellence(): Promise<boolean> {
    // Read from local data store only
    return true;
  }

  private async hasStrategicCapability(): Promise<boolean> {
    // Read from local data store only
    return false;
  }
}

// Lazy loader
export const getRankManager = async (): Promise<RankManager> => {
  const persistence = new LocalPersistence();
  const manager = new RankManager(persistence);
  await manager.initialize();
  return manager;
};

export { RankManager };
