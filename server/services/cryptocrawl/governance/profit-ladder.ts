/**
 * PROFIT LADDER SYSTEM
 *
 * Progressive profit-tier tracking. StageManager remains the stage-progression
 * authority; the ladder may only claim performance readiness from realized,
 * terminal-confirmed execution evidence.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { Stage, stageManager } from './stage-management';

const log = createLogger('ProfitLadder');
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_REALIZED_SHARPE_DAYS = Math.max(
  3,
  Number(process.env.CRYPTO_PROFIT_LADDER_MIN_SHARPE_DAYS || 7),
);

// ============================================================================
// PROFIT TIERS
// ============================================================================

export interface ProfitTier {
  id: number;
  name: string;
  stage: Stage;

  minDailyProfitUSD: number;
  targetDailyProfitUSD: number;
  maxDailyProfitUSD: number;

  minCapitalUSD: number;
  recommendedCapitalUSD: number;

  maxPositionSizeUSD: number;
  maxDrawdownPercent: number;
  maxDailyLossUSD: number;

  daysRequiredAtTarget: number;
  minSuccessRate: number;
  minSharpeRatio: number;

  maxPairs: number;
  maxVenues: number;
  allowedChains: string[];
}

export const PROFIT_TIERS: Record<number, ProfitTier> = {
  0: {
    id: 0,
    name: 'Foundation (Testing)',
    stage: Stage.STAGE_1_CONSTRAINED_PILOT,
    minDailyProfitUSD: 0,
    targetDailyProfitUSD: 0,
    maxDailyProfitUSD: 0,
    minCapitalUSD: 0,
    recommendedCapitalUSD: 1000,
    maxPositionSizeUSD: 0,
    maxDrawdownPercent: 0,
    maxDailyLossUSD: 0,
    // Tier 0 is not a realized-profit tier. These zero values are descriptive
    // only and MUST NOT independently satisfy advancement.
    daysRequiredAtTarget: 0,
    minSuccessRate: 0,
    minSharpeRatio: 0,
    maxPairs: 5,
    maxVenues: 2,
    allowedChains: ['polygon-testnet', 'arbitrum-testnet'],
  },
  1: {
    id: 1,
    name: 'Tier 1: Initial Proof ($200/day)',
    stage: Stage.STAGE_2_PROOF_OF_SIGNAL,
    minDailyProfitUSD: 200,
    targetDailyProfitUSD: 300,
    maxDailyProfitUSD: 500,
    minCapitalUSD: 5000,
    recommendedCapitalUSD: 10000,
    maxPositionSizeUSD: 100,
    maxDrawdownPercent: 5,
    maxDailyLossUSD: 200,
    daysRequiredAtTarget: 7,
    minSuccessRate: 0.65,
    minSharpeRatio: 1.2,
    maxPairs: 10,
    maxVenues: 3,
    allowedChains: ['polygon', 'arbitrum'],
  },
  2: {
    id: 2,
    name: 'Tier 2: Consolidation ($500-1500/day)',
    stage: Stage.STAGE_3_MEASURED_DRYRUN,
    minDailyProfitUSD: 500,
    targetDailyProfitUSD: 1000,
    maxDailyProfitUSD: 1500,
    minCapitalUSD: 20000,
    recommendedCapitalUSD: 40000,
    maxPositionSizeUSD: 500,
    maxDrawdownPercent: 10,
    maxDailyLossUSD: 500,
    daysRequiredAtTarget: 10,
    minSuccessRate: 0.65,
    minSharpeRatio: 1.3,
    maxPairs: 20,
    maxVenues: 5,
    allowedChains: ['polygon', 'arbitrum', 'optimism'],
  },
  3: {
    id: 3,
    name: 'Tier 3: Growth Phase ($1500-5000/day)',
    stage: Stage.STAGE_4_LIMITED_AUTONOMY,
    minDailyProfitUSD: 1500,
    targetDailyProfitUSD: 3000,
    maxDailyProfitUSD: 5000,
    minCapitalUSD: 50000,
    recommendedCapitalUSD: 100000,
    maxPositionSizeUSD: 2000,
    maxDrawdownPercent: 12,
    maxDailyLossUSD: 1500,
    daysRequiredAtTarget: 14,
    minSuccessRate: 0.68,
    minSharpeRatio: 1.4,
    maxPairs: 50,
    maxVenues: 10,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche'],
  },
  4: {
    id: 4,
    name: 'Tier 4: Scaling Phase ($5000-15000/day)',
    stage: Stage.STAGE_5_SUPERVISED_SCALING,
    minDailyProfitUSD: 5000,
    targetDailyProfitUSD: 10000,
    maxDailyProfitUSD: 15000,
    minCapitalUSD: 150000,
    recommendedCapitalUSD: 300000,
    maxPositionSizeUSD: 5000,
    maxDrawdownPercent: 15,
    maxDailyLossUSD: 3000,
    daysRequiredAtTarget: 21,
    minSuccessRate: 0.70,
    minSharpeRatio: 1.5,
    maxPairs: 100,
    maxVenues: 15,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc'],
  },
  5: {
    id: 5,
    name: 'Tier 5: Target Achievement ($15000-35000/day)',
    stage: Stage.STAGE_6_CONDITIONAL_AUTONOMY,
    minDailyProfitUSD: 15000,
    targetDailyProfitUSD: 25000,
    maxDailyProfitUSD: 35000,
    minCapitalUSD: 400000,
    recommendedCapitalUSD: 800000,
    maxPositionSizeUSD: 10000,
    maxDrawdownPercent: 15,
    maxDailyLossUSD: 5000,
    daysRequiredAtTarget: 30,
    minSuccessRate: 0.72,
    minSharpeRatio: 1.6,
    maxPairs: 200,
    maxVenues: 25,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'ethereum'],
  },
};

// ============================================================================
// TIER PERFORMANCE TRACKING
// ============================================================================

export interface TierPerformance {
  tierId: number;
  startTime: number;
  daysInTier: number;
  daysAtTarget: number;

  totalProfit: number;
  dailyProfits: number[];
  avgDailyProfit: number;
  bestDayProfit: number;
  worstDayProfit: number;

  // These are REALIZED metrics only. Monte Carlo/projection metrics cannot
  // satisfy the profit ladder.
  successRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  terminalSampleCount: number;
  terminalWinningSamples: number;
  realizedSharpeDayCount: number;
  lastReconciledAt: number;
  lastReconciledDay: string | null;

  meetsAdvancementCriteria: boolean;
  readyForNextTier: boolean;
  blockers: string[];
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function realizedDailySharpe(dailyProfits: readonly number[]): number {
  if (dailyProfits.length < MIN_REALIZED_SHARPE_DAYS) return 0;
  const mean = dailyProfits.reduce((sum, value) => sum + value, 0) / dailyProfits.length;
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  const variance = dailyProfits.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / dailyProfits.length;
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  if (standardDeviation <= 1e-9) return 99;
  return Math.min(99, mean / standardDeviation);
}

// ============================================================================
// PROFIT LADDER MANAGER
// ============================================================================

export class ProfitLadder extends EventEmitter {
  private static instance: ProfitLadder | null = null;
  private currentTier: ProfitTier;
  private tierPerformance: Map<number, TierPerformance> = new Map();
  private currentCapitalUSD = 0;
  private capitalVerificationStatus: 'verified' | 'unavailable' = 'unavailable';

  private constructor() {
    super();
    this.currentTier = PROFIT_TIERS[0];
    this.initializeTierPerformance(0);
    log.info('Profit Ladder initialized', {
      tier: this.currentTier.name,
      targetProfit: this.currentTier.targetDailyProfitUSD,
      realizedEvidenceRequired: true,
    });
  }

  static getInstance(): ProfitLadder {
    if (!ProfitLadder.instance) ProfitLadder.instance = new ProfitLadder();
    return ProfitLadder.instance;
  }

  private initializeTierPerformance(tierId: number): void {
    const now = Date.now();
    this.tierPerformance.set(tierId, {
      tierId,
      startTime: now,
      daysInTier: 0,
      daysAtTarget: 0,
      totalProfit: 0,
      dailyProfits: [],
      avgDailyProfit: 0,
      bestDayProfit: 0,
      worstDayProfit: 0,
      successRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      terminalSampleCount: 0,
      terminalWinningSamples: 0,
      realizedSharpeDayCount: 0,
      lastReconciledAt: now,
      lastReconciledDay: null,
      meetsAdvancementCriteria: false,
      readyForNextTier: false,
      blockers: [],
    });
  }

  private terminalEvidence(performance: TierPerformance): Array<{
    timestamp: number;
    success: boolean;
    realizedProfitUsd: number;
  }> {
    const state = stageManager.getState();
    return state.cryptaraExecutionEvidence.flatMap(evidence => {
      const realizedProfitUsd = finiteNumber(evidence.realizedProfitUsd);
      const settlementTerminal = evidence.settlement?.terminal === true;
      const settlementConfirmed = evidence.settlementConfirmed === true || evidence.settlement?.settlementConfirmed === true;
      if (
        evidence.timestamp < performance.startTime ||
        !settlementTerminal ||
        !settlementConfirmed ||
        realizedProfitUsd === null
      ) return [];
      return [{
        timestamp: evidence.timestamp,
        success: evidence.success === true,
        realizedProfitUsd,
      }];
    }).sort((left, right) => left.timestamp - right.timestamp);
  }

  private refreshRealizedMetrics(performance: TierPerformance): void {
    const terminal = this.terminalEvidence(performance);
    performance.terminalSampleCount = terminal.length;
    performance.terminalWinningSamples = terminal.filter(sample => sample.success && sample.realizedProfitUsd > 0).length;
    performance.successRate = terminal.length > 0 ? performance.terminalWinningSamples / terminal.length : 0;
    performance.realizedSharpeDayCount = performance.dailyProfits.length;
    performance.sharpeRatio = realizedDailySharpe(performance.dailyProfits);

    if (this.capitalVerificationStatus === 'verified' && this.currentCapitalUSD > 0) {
      let equity = this.currentCapitalUSD;
      let peak = equity;
      let maximum = 0;
      for (const profit of performance.dailyProfits) {
        equity += profit;
        peak = Math.max(peak, equity);
        if (peak > 0) maximum = Math.max(maximum, (peak - equity) / peak);
      }
      performance.maxDrawdown = maximum;
    } else {
      performance.maxDrawdown = 0;
    }
  }

  advanceToNextTier(): { success: boolean; message: string } {
    const nextTierId = this.currentTier.id + 1;
    if (!PROFIT_TIERS[nextTierId]) return { success: false, message: 'Already at maximum tier' };

    this.checkAdvancementCriteria();
    const performance = this.tierPerformance.get(this.currentTier.id);
    if (!performance?.readyForNextTier) {
      return {
        success: false,
        message: `Not ready for advancement. Blockers: ${performance?.blockers.join(', ')}`,
      };
    }

    const previousTier = this.currentTier;
    this.currentTier = PROFIT_TIERS[nextTierId];
    this.initializeTierPerformance(nextTierId);
    log.info('TIER ADVANCED', {
      from: previousTier.name,
      to: this.currentTier.name,
      targetProfit: this.currentTier.targetDailyProfitUSD,
      authority: previousTier.id === 0 ? 'stage_manager_foundation_proof' : 'terminal_realized_performance',
    });
    this.emit('tier-advanced', {
      previousTier: previousTier.id,
      currentTier: this.currentTier.id,
      timestamp: Date.now(),
    });
    return { success: true, message: `Advanced to ${this.currentTier.name}` };
  }

  /**
   * Reconcile one UTC day. The historic arguments remain for source compatibility,
   * but advancement metrics are deliberately rebuilt from StageManager's persisted
   * terminal-confirmed settlements. Predicted/simulated values cannot satisfy the
   * ladder merely because a caller supplies them here.
   */
  recordDailyPerformance(
    _profit: number,
    _successRate: number,
    _sharpeRatio: number,
    _maxDrawdown: number,
  ): void {
    const performance = this.tierPerformance.get(this.currentTier.id);
    if (!performance) return;

    const now = Date.now();
    const dayKey = utcDayKey(now);
    if (performance.lastReconciledDay === dayKey) {
      this.refreshRealizedMetrics(performance);
      this.checkAdvancementCriteria();
      log.debug('Daily profit reconciliation already recorded for UTC day', {
        tier: this.currentTier.name,
        day: dayKey,
      });
      return;
    }

    const newTerminal = this.terminalEvidence(performance)
      .filter(sample => sample.timestamp > performance.lastReconciledAt && sample.timestamp <= now);
    const realizedDailyProfit = newTerminal.reduce((sum, sample) => sum + sample.realizedProfitUsd, 0);

    performance.dailyProfits.push(realizedDailyProfit);
    performance.totalProfit += realizedDailyProfit;
    performance.avgDailyProfit = performance.totalProfit / performance.dailyProfits.length;
    performance.bestDayProfit = performance.dailyProfits.length === 1
      ? realizedDailyProfit
      : Math.max(performance.bestDayProfit, realizedDailyProfit);
    performance.worstDayProfit = performance.dailyProfits.length === 1
      ? realizedDailyProfit
      : Math.min(performance.worstDayProfit, realizedDailyProfit);
    performance.daysInTier = Math.floor((now - performance.startTime) / DAY_MS);
    performance.lastReconciledAt = now;
    performance.lastReconciledDay = dayKey;

    // A target day must contain terminal-confirmed realized evidence. A zero
    // target must never turn a no-trade day into advancement evidence.
    if (newTerminal.length > 0 && realizedDailyProfit >= this.currentTier.targetDailyProfitUSD) {
      performance.daysAtTarget += 1;
    }

    this.refreshRealizedMetrics(performance);
    this.checkAdvancementCriteria();

    log.info('Daily terminal performance reconciled', {
      tier: this.currentTier.name,
      realizedDailyProfit,
      terminalSamplesThisDay: newTerminal.length,
      terminalSamplesInTier: performance.terminalSampleCount,
      avgProfit: performance.avgDailyProfit,
      daysInTier: performance.daysInTier,
      daysAtTarget: performance.daysAtTarget,
      realizedSuccessRate: performance.successRate,
      realizedSharpeRatio: performance.sharpeRatio,
    });

    this.emit('performance-recorded', {
      tierId: this.currentTier.id,
      profit: realizedDailyProfit,
      terminalSamples: newTerminal.length,
      performance,
      timestamp: now,
    });
  }

  private checkAdvancementCriteria(): void {
    const performance = this.tierPerformance.get(this.currentTier.id);
    if (!performance) return;

    this.refreshRealizedMetrics(performance);
    const tier = this.currentTier;
    const nextTier = PROFIT_TIERS[tier.id + 1];
    const blockers: string[] = [];

    if (tier.id === 0) {
      // Stage 1 cannot execute trades. Foundation exit therefore mirrors the
      // StageManager's verified live-signal/infrastructure proof; it must never
      // be inferred from the tier's descriptive zero profit thresholds.
      const stageState = stageManager.getState();
      if (stageState.currentStage !== Stage.STAGE_1_CONSTRAINED_PILOT) {
        blockers.push(`Foundation tier is misaligned with StageManager stage ${stageState.currentStage}`);
      }
      if (!stageState.proofMetrics.meetsAdvancementCriteria) {
        blockers.push('StageManager foundation proof metrics are not complete');
      }
    } else {
      if (performance.terminalSampleCount <= 0) {
        blockers.push('No terminal-confirmed realized settlement samples for this tier');
      }

      // Zero thresholds on an actual realized-profit tier are configuration
      // errors, not automatic passes.
      if (!Number.isFinite(tier.daysRequiredAtTarget) || tier.daysRequiredAtTarget <= 0) {
        blockers.push('Invalid profit-ladder configuration: daysRequiredAtTarget must be > 0');
      }
      if (!Number.isFinite(tier.minSuccessRate) || tier.minSuccessRate <= 0) {
        blockers.push('Invalid profit-ladder configuration: minSuccessRate must be > 0');
      }
      if (!Number.isFinite(tier.minSharpeRatio) || tier.minSharpeRatio <= 0) {
        blockers.push('Invalid profit-ladder configuration: minSharpeRatio must be > 0');
      }

      if (performance.daysAtTarget < tier.daysRequiredAtTarget) {
        blockers.push(`Need ${tier.daysRequiredAtTarget - performance.daysAtTarget} more realized days at target`);
      }
      if (performance.successRate < tier.minSuccessRate) {
        blockers.push(`Realized success rate ${(performance.successRate * 100).toFixed(1)}% < ${(tier.minSuccessRate * 100).toFixed(1)}%`);
      }
      if (performance.realizedSharpeDayCount < MIN_REALIZED_SHARPE_DAYS) {
        blockers.push(`Need ${MIN_REALIZED_SHARPE_DAYS - performance.realizedSharpeDayCount} more realized daily samples before Sharpe is meaningful`);
      } else if (performance.sharpeRatio < tier.minSharpeRatio) {
        blockers.push(`Realized Sharpe ratio ${performance.sharpeRatio.toFixed(2)} < ${tier.minSharpeRatio.toFixed(2)}`);
      }

      if (this.capitalVerificationStatus !== 'verified') {
        blockers.push('Capital is not verified from live balance evidence');
      }
      if (nextTier && this.currentCapitalUSD < nextTier.minCapitalUSD) {
        blockers.push(`Verified capital $${this.currentCapitalUSD} < $${nextTier.minCapitalUSD} required`);
      }
      if (performance.maxDrawdown > tier.maxDrawdownPercent / 100) {
        blockers.push(`Realized max drawdown ${(performance.maxDrawdown * 100).toFixed(1)}% > ${tier.maxDrawdownPercent}%`);
      }
    }

    const wasReadyForNextTier = performance.readyForNextTier;
    performance.blockers = blockers;
    performance.meetsAdvancementCriteria = blockers.length === 0;
    performance.readyForNextTier = performance.meetsAdvancementCriteria && nextTier !== undefined;

    if (performance.readyForNextTier && !wasReadyForNextTier) {
      if (tier.id === 0) {
        log.info('Foundation exit criteria verified by StageManager', {
          tier: tier.name,
          stage: stageManager.getCurrentStage(),
        });
      } else {
        log.info('Tier advancement criteria MET from terminal realized evidence', {
          tier: tier.name,
          terminalSampleCount: performance.terminalSampleCount,
          daysAtTarget: performance.daysAtTarget,
          successRate: (performance.successRate * 100).toFixed(1),
          sharpeRatio: performance.sharpeRatio.toFixed(2),
        });
      }
      this.emit('advancement-criteria-met', {
        tierId: tier.id,
        evidenceAuthority: tier.id === 0 ? 'stage_manager_foundation_proof' : 'terminal_realized_settlements',
        performance,
        timestamp: Date.now(),
      });
    }
  }

  setCapital(capitalUSD: number): void {
    this.currentCapitalUSD = capitalUSD;
    log.info('Capital updated (unverified)', { capital: capitalUSD, tier: this.currentTier.name });
    this.emit('capital-updated', { capital: capitalUSD, verified: false, timestamp: Date.now() });
  }

  setVerifiedCapital(capitalUSD: number): void {
    if (!Number.isFinite(capitalUSD) || capitalUSD < 0) throw new Error('Verified capital must be a finite non-negative amount');
    this.currentCapitalUSD = capitalUSD;
    this.capitalVerificationStatus = 'verified';
    this.checkAdvancementCriteria();
    this.emit('capital-updated', { capital: capitalUSD, verified: true, timestamp: Date.now() });
  }

  markCapitalUnavailable(): void {
    this.capitalVerificationStatus = 'unavailable';
    this.checkAdvancementCriteria();
  }

  getCapitalVerificationStatus(): 'verified' | 'unavailable' {
    return this.capitalVerificationStatus;
  }

  getCapitalRequirement(): {
    minimum: number;
    recommended: number;
    current: number;
    sufficient: boolean;
  } {
    return {
      minimum: this.currentTier.minCapitalUSD,
      recommended: this.currentTier.recommendedCapitalUSD,
      current: this.currentCapitalUSD,
      sufficient: this.capitalVerificationStatus === 'verified' && this.currentCapitalUSD >= this.currentTier.minCapitalUSD,
    };
  }

  calculateCapitalFor35K(): {
    currentCapital: number;
    requiredCapital: number;
    gap: number;
    currentTierMax: number;
    targetTierMax: number;
  } {
    const targetTier = PROFIT_TIERS[5];
    return {
      currentCapital: this.currentCapitalUSD,
      requiredCapital: targetTier.recommendedCapitalUSD,
      gap: Math.max(0, targetTier.recommendedCapitalUSD - this.currentCapitalUSD),
      currentTierMax: this.currentTier.maxDailyProfitUSD,
      targetTierMax: targetTier.maxDailyProfitUSD,
    };
  }

  getCurrentTier(): ProfitTier {
    return { ...this.currentTier };
  }

  getCurrentPerformance(): TierPerformance | undefined {
    return this.tierPerformance.get(this.currentTier.id);
  }

  getAllPerformance(): TierPerformance[] {
    return Array.from(this.tierPerformance.values());
  }

  getProgressSummary(): {
    currentTier: string;
    currentTierId: number;
    targetDailyProfit: number;
    maxDailyProfit: number;
    daysInTier: number;
    daysAtTarget: number;
    avgDailyProfit: number;
    terminalSampleCount: number;
    realizedSharpeDayCount: number;
    readyForNextTier: boolean;
    blockers: string[];
    percentToGoal: number;
  } {
    this.checkAdvancementCriteria();
    const performance = this.getCurrentPerformance();
    const targetTierProfit = PROFIT_TIERS[5].maxDailyProfitUSD;
    const percentToGoal = (this.currentTier.maxDailyProfitUSD / targetTierProfit) * 100;
    return {
      currentTier: this.currentTier.name,
      currentTierId: this.currentTier.id,
      targetDailyProfit: this.currentTier.targetDailyProfitUSD,
      maxDailyProfit: this.currentTier.maxDailyProfitUSD,
      daysInTier: performance?.daysInTier || 0,
      daysAtTarget: performance?.daysAtTarget || 0,
      avgDailyProfit: performance?.avgDailyProfit || 0,
      terminalSampleCount: performance?.terminalSampleCount || 0,
      realizedSharpeDayCount: performance?.realizedSharpeDayCount || 0,
      readyForNextTier: performance?.readyForNextTier || false,
      blockers: performance?.blockers || [],
      percentToGoal,
    };
  }

  getRoadmapTo35K(): {
    currentTier: number;
    tiersRemaining: number;
    estimatedDaysToGoal: number;
    tierMilestones: Array<{
      tier: number;
      name: string;
      targetProfit: number;
      daysRequired: number;
      capitalRequired: number;
    }>;
  } {
    const currentTierId = this.currentTier.id;
    const targetTierId = 5;
    let estimatedDaysToGoal = 0;
    const tierMilestones: Array<{
      tier: number;
      name: string;
      targetProfit: number;
      daysRequired: number;
      capitalRequired: number;
    }> = [];
    for (let i = currentTierId + 1; i <= targetTierId; i++) {
      const tier = PROFIT_TIERS[i];
      estimatedDaysToGoal += tier.daysRequiredAtTarget;
      tierMilestones.push({
        tier: tier.id,
        name: tier.name,
        targetProfit: tier.targetDailyProfitUSD,
        daysRequired: tier.daysRequiredAtTarget,
        capitalRequired: tier.recommendedCapitalUSD,
      });
    }
    return {
      currentTier: currentTierId,
      tiersRemaining: targetTierId - currentTierId,
      estimatedDaysToGoal,
      tierMilestones,
    };
  }

  exportState(): any {
    return {
      currentTier: this.currentTier,
      tierPerformance: Array.from(this.tierPerformance.entries()),
      currentCapital: this.currentCapitalUSD,
      timestamp: Date.now(),
    };
  }

  importState(data: any): void {
    if (data?.currentTier) {
      const tierId = Number(data.currentTier.id);
      if (Number.isInteger(tierId) && PROFIT_TIERS[tierId]) this.currentTier = PROFIT_TIERS[tierId];
    }

    if (Array.isArray(data?.tierPerformance)) {
      const now = Date.now();
      this.tierPerformance = new Map(data.tierPerformance.map((entry: any) => {
        const tierId = Number(entry?.[0]);
        const value = entry?.[1] && typeof entry[1] === 'object' ? entry[1] : {};
        const dailyProfits = Array.isArray(value.dailyProfits)
          ? value.dailyProfits.map(Number).filter(Number.isFinite)
          : [];
        const normalized: TierPerformance = {
          tierId,
          startTime: Number.isFinite(Number(value.startTime)) ? Number(value.startTime) : now,
          daysInTier: Math.max(0, Number(value.daysInTier) || 0),
          daysAtTarget: Math.max(0, Number(value.daysAtTarget) || 0),
          totalProfit: Number.isFinite(Number(value.totalProfit)) ? Number(value.totalProfit) : dailyProfits.reduce((sum: number, item: number) => sum + item, 0),
          dailyProfits,
          avgDailyProfit: Number.isFinite(Number(value.avgDailyProfit)) ? Number(value.avgDailyProfit) : 0,
          bestDayProfit: Number.isFinite(Number(value.bestDayProfit)) ? Number(value.bestDayProfit) : 0,
          worstDayProfit: Number.isFinite(Number(value.worstDayProfit)) ? Number(value.worstDayProfit) : 0,
          successRate: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          terminalSampleCount: 0,
          terminalWinningSamples: 0,
          realizedSharpeDayCount: dailyProfits.length,
          // Old snapshots did not carry a reconciliation watermark. Start from
          // restore time so deployment cannot replay historic settlements into a
          // second daily P&L sample.
          lastReconciledAt: Number.isFinite(Number(value.lastReconciledAt)) ? Number(value.lastReconciledAt) : now,
          lastReconciledDay: typeof value.lastReconciledDay === 'string' ? value.lastReconciledDay : null,
          meetsAdvancementCriteria: false,
          readyForNextTier: false,
          blockers: [],
        };
        return [tierId, normalized] as [number, TierPerformance];
      }));
    }

    if (!this.tierPerformance.has(this.currentTier.id)) this.initializeTierPerformance(this.currentTier.id);

    // Capital is deliberately re-verified from live balances after restore.
    this.currentCapitalUSD = 0;
    this.capitalVerificationStatus = 'unavailable';
    this.checkAdvancementCriteria();

    log.info('State imported', {
      tier: this.currentTier.name,
      capital: this.currentCapitalUSD,
      capitalVerificationStatus: this.capitalVerificationStatus,
      terminalEvidenceAuthority: true,
    });
  }
}

export const profitLadder = ProfitLadder.getInstance();
