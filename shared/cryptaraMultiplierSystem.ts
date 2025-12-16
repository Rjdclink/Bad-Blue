/**
 * MULTIPLIER SYSTEM
 * Incremental capacity scaling
 */

import {
  MultiplierEvent,
  MultiplierAdvancement,
  MultiplierResult,
  PersistenceAdapter,
  TradeStatistics,
} from './cryptaraTypes';
import { RANK_DEFINITIONS, MULTIPLIER_TIERS } from './cryptaraConfig';
import { LocalPersistence } from './cryptaraPersistence';

class MultiplierSystem {
  private currentMultiplier: number = 1.0;
  private multiplierHistory: MultiplierEvent[] = [];
  private persistence: PersistenceAdapter;

  constructor(persistence: PersistenceAdapter) {
    this.persistence = persistence;
  }

  async initialize(): Promise<void> {
    try {
      const state = await this.persistence.loadMultiplierState();
      if (state) {
        this.currentMultiplier = state.currentMultiplier;
        this.multiplierHistory = state.multiplierHistory;
      }
    } catch (error) {
      console.error('Failed to initialize multiplier system:', error);
    }
  }

  async checkAdvancement(): Promise<MultiplierAdvancement> {
    try {
      const currentTier = MULTIPLIER_TIERS.find(t => t.multiplier === this.currentMultiplier);

      if (!currentTier) {
        return {
          eligible: false,
          reason: 'Current tier not found',
          nextMultiplier: null,
        };
      }

      const nextTierIndex = MULTIPLIER_TIERS.indexOf(currentTier) + 1;

      if (nextTierIndex >= MULTIPLIER_TIERS.length) {
        return {
          eligible: false,
          reason: 'Already at maximum multiplier (1.6x)',
          nextMultiplier: null,
        };
      }

      const nextTier = MULTIPLIER_TIERS[nextTierIndex];
      const stats = await this.getTradeStatistics();

      const checks: Record<string, boolean> = {
        trades: stats.totalTrades >= nextTier.tradesRequired,
        avgScore: stats.avgProcessScore >= nextTier.avgScore,
        violations: stats.violationCount <= nextTier.violations,
      };

      const unmet = Object.entries(checks)
        .filter(([_, passed]) => !passed)
        .map(([req]) => req);

      return {
        eligible: unmet.length === 0,
        reason: unmet.length > 0 ? `Unmet: ${unmet.join(', ')}` : 'Requirements met',
        nextMultiplier: nextTier.multiplier,
        requirements: {
          tradesRemaining: Math.max(0, nextTier.tradesRequired - stats.totalTrades),
          avgScoreNeeded: nextTier.avgScore,
          currentAvgScore: stats.avgProcessScore,
          violationsAllowed: nextTier.violations === Infinity ? -1 : nextTier.violations,
          currentViolations: stats.violationCount,
        },
      };
    } catch (error) {
      console.error('Failed to check advancement:', error);
      return {
        eligible: false,
        reason: 'Error checking advancement',
        nextMultiplier: null,
      };
    }
  }

  async advance(): Promise<MultiplierResult> {
    try {
      const eligibility = await this.checkAdvancement();

      if (!eligibility.eligible) {
        return {
          success: false,
          message: eligibility.reason,
          newMultiplier: this.currentMultiplier,
        };
      }

      const previousMultiplier = this.currentMultiplier;
      const newMultiplier = eligibility.nextMultiplier!;

      // Create event
      const event: MultiplierEvent = {
        from: previousMultiplier,
        to: newMultiplier,
        timestamp: Date.now(),
        reason: 'Requirements met',
      };

      // Apply event
      this.currentMultiplier = newMultiplier;
      this.multiplierHistory.push(event);

      // Persist
      await this.persistence.saveMultiplierState({
        currentMultiplier: this.currentMultiplier,
        multiplierHistory: this.multiplierHistory,
      });

      return {
        success: true,
        message: `Multiplier advanced: ${previousMultiplier}x → ${newMultiplier}x`,
        newMultiplier: newMultiplier,
        capacityIncrease: ((newMultiplier - previousMultiplier) / previousMultiplier) * 100,
      };
    } catch (error) {
      console.error('Failed to advance multiplier:', error);
      return {
        success: false,
        message: 'Advancement failed',
        newMultiplier: this.currentMultiplier,
      };
    }
  }

  async reduce(reason: string): Promise<MultiplierResult> {
    try {
      if (this.currentMultiplier <= 1.0) {
        return {
          success: false,
          message: 'Already at baseline multiplier (1.0x)',
          newMultiplier: 1.0,
        };
      }

      const currentIndex = MULTIPLIER_TIERS.findIndex(t => t.multiplier === this.currentMultiplier);
      const newMultiplier = MULTIPLIER_TIERS[Math.max(0, currentIndex - 1)].multiplier;
      const previousMultiplier = this.currentMultiplier;

      // Create event
      const event: MultiplierEvent = {
        from: previousMultiplier,
        to: newMultiplier,
        timestamp: Date.now(),
        reason: reason,
      };

      // Apply event
      this.currentMultiplier = newMultiplier;
      this.multiplierHistory.push(event);

      // Persist
      await this.persistence.saveMultiplierState({
        currentMultiplier: this.currentMultiplier,
        multiplierHistory: this.multiplierHistory,
      });

      return {
        success: true,
        message: `Multiplier reduced: ${previousMultiplier}x → ${newMultiplier}x due to ${reason}`,
        newMultiplier: newMultiplier,
        capacityIncrease: ((newMultiplier - previousMultiplier) / previousMultiplier) * 100,
      };
    } catch (error) {
      console.error('Failed to reduce multiplier:', error);
      return {
        success: false,
        message: 'Reduction failed',
        newMultiplier: this.currentMultiplier,
      };
    }
  }

  async getEffectiveMultiplier(): Promise<number> {
    try {
      const { getRankManager } = await import('./cryptaraRankManager');
      const rankManager = await getRankManager();
      const rankDef = RANK_DEFINITIONS[rankManager.getCurrentRank()];
      const rankMultiplier = rankDef.multiplierUnlocked;

      return Math.min(rankMultiplier, this.currentMultiplier);
    } catch (error) {
      console.error('Failed to get effective multiplier:', error);
      return 1.0;
    }
  }

  private async getTradeStatistics(): Promise<TradeStatistics> {
    // Read from local data store only - NO external calls
    return {
      totalTrades: 0,
      avgProcessScore: 0,
      violationCount: 0,
    };
  }
}

// Lazy loader
export const getMultiplierSystem = async (): Promise<MultiplierSystem> => {
  const persistence = new LocalPersistence();
  const system = new MultiplierSystem(persistence);
  await system.initialize();
  return system;
};

export { MultiplierSystem };
