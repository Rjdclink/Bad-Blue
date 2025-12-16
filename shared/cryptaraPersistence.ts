/**
 * CRYPTARA PERSISTENCE ADAPTER
 * Local storage implementation for persistence
 */

import {
  PerformanceMetrics,
  PersistenceAdapter,
  RankState,
  MultiplierState,
} from './cryptaraTypes';

/**
 * Local persistence adapter using in-memory storage
 * Can be extended to use file system, database, etc.
 */
export class LocalPersistence implements PersistenceAdapter {
  private performanceHistory: PerformanceMetrics[] = [];
  private rankState: RankState | null = null;
  private multiplierState: MultiplierState | null = null;

  async loadPerformanceHistory(): Promise<PerformanceMetrics[]> {
    return [...this.performanceHistory];
  }

  async savePerformanceHistory(history: PerformanceMetrics[]): Promise<void> {
    this.performanceHistory = [...history];
  }

  async loadRankState(): Promise<RankState | null> {
    return this.rankState ? { ...this.rankState } : null;
  }

  async saveRankState(state: RankState): Promise<void> {
    this.rankState = { ...state };
  }

  async loadMultiplierState(): Promise<MultiplierState | null> {
    return this.multiplierState ? { ...this.multiplierState } : null;
  }

  async saveMultiplierState(state: MultiplierState): Promise<void> {
    this.multiplierState = { ...state };
  }
}
