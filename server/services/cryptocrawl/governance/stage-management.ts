/**
 * STAGE MANAGEMENT SYSTEM
 * 
 * Controls the 6-stage progressive deployment of Cryptara trading system
 * Goal: $200/day → $35,000/day over 2 months with strict safety controls
 * 
 * STAGE 1: Constrained Pilot - Advisory only, no execution
 * STAGE 2: Proof-of-Signal - First live actions with explicit UNPAUSE
 * STAGE 3: Measured Dry-Run - Incremental scope widening with cool-downs
 * STAGE 4: Limited Autonomy - Narrow conditional autonomy in corridors
 * STAGE 5: Supervised Scaling - Sequential unlocking of higher profit tiers
 * STAGE 6: Conditional Autonomy - Full autonomy within bounds
 * 
 * GLOBAL RULES (All Stages):
 * - No assumptions, no silent expansion
 * - No autonomous evolution (Evolution Lock ON)
 * - Execution requires explicit authorization
 * - Pause semantics absolute
 * - Ambiguity → ask-and-wait
 * - Advancement requires explicit UNPAUSE
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { randomUUID } from 'crypto';

const log = createLogger('StageManagement');

// ============================================================================
// STAGE DEFINITIONS
// ============================================================================

export enum Stage {
  STAGE_1_CONSTRAINED_PILOT = 1,
  STAGE_2_PROOF_OF_SIGNAL = 2,
  STAGE_3_MEASURED_DRYRUN = 3,
  STAGE_4_LIMITED_AUTONOMY = 4,
  STAGE_5_SUPERVISED_SCALING = 5,
  STAGE_6_CONDITIONAL_AUTONOMY = 6,
}

export interface StageConfig {
  stage: Stage;
  stageName: string;
  description: string;
  
  // Execution Authority
  canExecuteTrades: boolean;
  requiresHumanApproval: boolean;
  requiresExplicitUnpause: boolean;
  
  // Scope Limits
  maxPairsAllowed: number;
  maxVenuesAllowed: number;
  allowedChains: string[];
  
  // Profit Tier Limits (daily USD)
  minDailyProfit: number;
  maxDailyProfit: number;
  
  // Risk Parameters
  maxPositionSizeUSD: number;
  maxDrawdownPercent: number;
  requiresMonteCarloConsensus: boolean;
  
  // Autonomy Level
  autonomyLevel: 'none' | 'advisory' | 'limited' | 'conditional' | 'full';
  
  // Memory & Evolution
  memoryPartitioned: boolean;
  evolutionLocked: boolean;
  canSelfExpand: boolean;
  
  // Safety Gates
  anomalyDetectionRequired: boolean;
  automaticPauseAfterCycle: boolean;
  killSwitchArmed: boolean;
}

// ============================================================================
// STAGE CONFIGURATIONS
// ============================================================================

export const STAGE_CONFIGS: Record<Stage, StageConfig> = {
  [Stage.STAGE_1_CONSTRAINED_PILOT]: {
    stage: Stage.STAGE_1_CONSTRAINED_PILOT,
    stageName: 'Constrained Pilot',
    description: 'Advisory/strategy optimization sandbox - NO EXECUTION',
    
    canExecuteTrades: false,
    requiresHumanApproval: true,
    requiresExplicitUnpause: true,
    
    maxPairsAllowed: 5,
    maxVenuesAllowed: 2,
    allowedChains: ['polygon-testnet', 'arbitrum-testnet'],
    
    minDailyProfit: 0,
    maxDailyProfit: 0, // No execution = no profit
    
    maxPositionSizeUSD: 0,
    maxDrawdownPercent: 0,
    requiresMonteCarloConsensus: true,
    
    autonomyLevel: 'advisory',
    
    memoryPartitioned: true,
    evolutionLocked: true,
    canSelfExpand: false,
    
    anomalyDetectionRequired: true,
    automaticPauseAfterCycle: true,
    killSwitchArmed: true,
  },
  
  [Stage.STAGE_2_PROOF_OF_SIGNAL]: {
    stage: Stage.STAGE_2_PROOF_OF_SIGNAL,
    stageName: 'Proof-of-Signal Activation',
    description: 'First live actions inside pre-approved envelopes',
    
    canExecuteTrades: true,
    requiresHumanApproval: true,
    requiresExplicitUnpause: true,
    
    maxPairsAllowed: 10,
    maxVenuesAllowed: 3,
    allowedChains: ['polygon', 'arbitrum'],
    
    minDailyProfit: 200,
    maxDailyProfit: 500,
    
    maxPositionSizeUSD: 100,
    maxDrawdownPercent: 5,
    requiresMonteCarloConsensus: true,
    
    autonomyLevel: 'limited',
    
    memoryPartitioned: true,
    evolutionLocked: true,
    canSelfExpand: false,
    
    anomalyDetectionRequired: true,
    automaticPauseAfterCycle: true,
    killSwitchArmed: true,
  },
  
  [Stage.STAGE_3_MEASURED_DRYRUN]: {
    stage: Stage.STAGE_3_MEASURED_DRYRUN,
    stageName: 'Measured Dry-Run Expansion',
    description: 'Incremental scope widening with forced cool-downs',
    
    canExecuteTrades: true,
    requiresHumanApproval: true,
    requiresExplicitUnpause: true,
    
    maxPairsAllowed: 20,
    maxVenuesAllowed: 5,
    allowedChains: ['polygon', 'arbitrum', 'optimism'],
    
    minDailyProfit: 500,
    maxDailyProfit: 1500,
    
    maxPositionSizeUSD: 500,
    maxDrawdownPercent: 10,
    requiresMonteCarloConsensus: true,
    
    autonomyLevel: 'limited',
    
    memoryPartitioned: true,
    evolutionLocked: true,
    canSelfExpand: false,
    
    anomalyDetectionRequired: true,
    automaticPauseAfterCycle: true,
    killSwitchArmed: true,
  },
  
  [Stage.STAGE_4_LIMITED_AUTONOMY]: {
    stage: Stage.STAGE_4_LIMITED_AUTONOMY,
    stageName: 'Limited Autonomy Restoration',
    description: 'Narrow conditional autonomy inside defined corridors',
    
    canExecuteTrades: true,
    requiresHumanApproval: false, // Conditional autonomy within bounds
    requiresExplicitUnpause: true,
    
    maxPairsAllowed: 50,
    maxVenuesAllowed: 10,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche'],
    
    minDailyProfit: 1500,
    maxDailyProfit: 5000,
    
    maxPositionSizeUSD: 2000,
    maxDrawdownPercent: 12,
    requiresMonteCarloConsensus: true,
    
    autonomyLevel: 'conditional',
    
    memoryPartitioned: true,
    evolutionLocked: true,
    canSelfExpand: false,
    
    anomalyDetectionRequired: true,
    automaticPauseAfterCycle: true,
    killSwitchArmed: true,
  },
  
  [Stage.STAGE_5_SUPERVISED_SCALING]: {
    stage: Stage.STAGE_5_SUPERVISED_SCALING,
    stageName: 'Supervised Scaling',
    description: 'Sequential unlocking of higher profit tiers',
    
    canExecuteTrades: true,
    requiresHumanApproval: false,
    requiresExplicitUnpause: true,
    
    maxPairsAllowed: 100,
    maxVenuesAllowed: 15,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc'],
    
    minDailyProfit: 5000,
    maxDailyProfit: 15000,
    
    maxPositionSizeUSD: 5000,
    maxDrawdownPercent: 15,
    requiresMonteCarloConsensus: true,
    
    autonomyLevel: 'conditional',
    
    memoryPartitioned: true,
    evolutionLocked: true,
    canSelfExpand: false,
    
    anomalyDetectionRequired: true,
    automaticPauseAfterCycle: true,
    killSwitchArmed: true,
  },
  
  [Stage.STAGE_6_CONDITIONAL_AUTONOMY]: {
    stage: Stage.STAGE_6_CONDITIONAL_AUTONOMY,
    stageName: 'Conditional Autonomy',
    description: 'Full autonomy permitted while metrics remain within bounds',
    
    canExecuteTrades: true,
    requiresHumanApproval: false,
    requiresExplicitUnpause: false, // Can continue autonomously
    
    maxPairsAllowed: 200,
    maxVenuesAllowed: 25,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'ethereum'],
    
    minDailyProfit: 15000,
    maxDailyProfit: 35000,
    
    maxPositionSizeUSD: 10000,
    maxDrawdownPercent: 15,
    requiresMonteCarloConsensus: true,
    
    autonomyLevel: 'full',
    
    memoryPartitioned: false, // Can use full memory
    evolutionLocked: true, // Still locked unless explicitly lifted
    canSelfExpand: false, // No self-expansion even at Stage 6
    
    anomalyDetectionRequired: true,
    automaticPauseAfterCycle: false, // Can run continuously
    killSwitchArmed: true,
  },
};

// ============================================================================
// STAGE STATE
// ============================================================================

export interface StageState {
  currentStage: Stage;
  isPaused: boolean;
  pauseReason?: string;
  lastPauseTimestamp?: number;
  unpauseRequiresAuthorization: boolean;
  
  // Authorization tracking
  lastUnpauseTimestamp?: number;
  lastUnpauseAuthority?: string;
  lastUnpauseScope?: string;
  lastUnpauseDuration?: number; // milliseconds
  
  // Cycle tracking
  cycleCount: number;
  lastCycleStartTime?: number;
  lastCycleEndTime?: number;
  
  // Performance tracking
  dailyProfitUSD: number;
  totalProfitUSD: number;
  currentDrawdownPercent: number;
  
  // Metrics for advancement
  proofMetrics: ProofMetrics;
  
  // Anomaly tracking
  anomalyCount: number;
  lastAnomalyTime?: number;
  lastAnomalyReason?: string;
  blockingAnomaly: boolean;
  killSwitchActive: boolean;
  uncertainties: string[];
}

export interface ProofMetrics {
  successRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgProfitPerTrade: number;
  sharpeRatio: number;
  maxDrawdown: number;
  uptime: number;
  
  // Monte Carlo validation
  monteCarloPassRate: number;
  monteCarloSimulations: number;
  liveValidationSamples: number;
  liveValidationPasses: number;
  liveValidationPassRate: number;
  chainHealthy: boolean;
  lastLiveValidationAt?: number;
  
  // Stage-specific requirements
  meetsAdvancementCriteria: boolean;
}

// ============================================================================
// STAGE MANAGER
// ============================================================================

export class StageManager extends EventEmitter {
  private static instance: StageManager | null = null;
  private state: StageState;
  private config: StageConfig;
  private stateHistory: Array<{ timestamp: number; state: Partial<StageState> }> = [];
  
  private constructor() {
    super();
    
    // Initialize at Stage 1
    this.state = {
      currentStage: Stage.STAGE_1_CONSTRAINED_PILOT,
      isPaused: true, // Start paused
      pauseReason: 'Initial state - awaiting human authorization',
      lastPauseTimestamp: Date.now(),
      unpauseRequiresAuthorization: true,
      
      cycleCount: 0,
      dailyProfitUSD: 0,
      totalProfitUSD: 0,
      currentDrawdownPercent: 0,
      
      proofMetrics: this.getEmptyProofMetrics(),
      
      anomalyCount: 0,
      blockingAnomaly: false,
      killSwitchActive: false,
      uncertainties: [],
    };
    
    this.config = STAGE_CONFIGS[Stage.STAGE_1_CONSTRAINED_PILOT];
    
    log.info('Stage Manager initialized', {
      stage: this.config.stageName,
      isPaused: this.state.isPaused,
    });
  }
  
  static getInstance(): StageManager {
    if (!StageManager.instance) {
      StageManager.instance = new StageManager();
    }
    return StageManager.instance;
  }
  
  // ============================================================================
  // PAUSE / UNPAUSE CONTROL
  // ============================================================================
  
  /**
   * Request UNPAUSE with explicit authorization
   * 
   * @param authority - Who is authorizing (human operator ID)
   * @param scope - What scope is authorized (stage, pairs, venues, duration)
   * @param duration - How long unpause lasts (milliseconds, 0 = until next pause)
   */
  async requestUnpause(
    authority: string,
    scope: string,
    duration: number = 0
  ): Promise<{ success: boolean; message: string }> {
    if (!this.state.isPaused) {
      return {
        success: false,
        message: 'System is already running',
      };
    }
    
    // Verify authority (in production, this would check actual auth)
    if (!authority || authority.length === 0) {
      return {
        success: false,
        message: 'Invalid authority - UNPAUSE requires human operator ID',
      };
    }
    
    // Verify scope is defined
    if (!scope || scope.length === 0) {
      return {
        success: false,
        message: 'Invalid scope - UNPAUSE requires explicit scope definition',
      };
    }
    
    // Check if current stage requires explicit unpause
    if (this.config.requiresExplicitUnpause) {
      log.info('UNPAUSE request received', {
        stage: this.config.stageName,
        authority,
        scope,
        duration,
      });
      
      // Record authorization
      this.state.isPaused = false;
      this.state.pauseReason = undefined;
      this.state.lastUnpauseTimestamp = Date.now();
      this.state.lastUnpauseAuthority = authority;
      this.state.lastUnpauseScope = scope;
      this.state.lastUnpauseDuration = duration;
      
      // Schedule automatic pause if duration specified
      if (duration > 0) {
        setTimeout(() => {
          this.pause('Duration expired');
        }, duration);
      }
      
      // Emit event
      this.emit('unpaused', {
        stage: this.state.currentStage,
        authority,
        scope,
        duration,
        timestamp: Date.now(),
      });
      
      this.recordStateChange({ isPaused: false });
      
      return {
        success: true,
        message: `System UNPAUSED by ${authority} for scope: ${scope}`,
      };
    } else {
      return {
        success: false,
        message: 'Current stage does not require explicit unpause',
      };
    }
  }
  
  /**
   * PAUSE the system with absolute semantics
   */
  pause(reason: string): void {
    if (this.state.isPaused) {
      log.warn('System already paused', { reason });
      this.state.pauseReason = reason;
      this.state.lastPauseTimestamp = Date.now();
      this.recordStateChange({ pauseReason: reason, lastPauseTimestamp: this.state.lastPauseTimestamp });
      return;
    }
    
    log.warn('SYSTEM PAUSED', { reason, stage: this.config.stageName });
    
    this.state.isPaused = true;
    this.state.pauseReason = reason;
    this.state.lastPauseTimestamp = Date.now();
    this.state.unpauseRequiresAuthorization = this.config.requiresExplicitUnpause;
    
    this.emit('paused', {
      stage: this.state.currentStage,
      reason,
      timestamp: Date.now(),
    });
    
    this.recordStateChange({ isPaused: true, pauseReason: reason, lastPauseTimestamp: this.state.lastPauseTimestamp });
  }
  
  /**
   * Check if system can proceed with action
   */
  canProceed(): { allowed: boolean; reason?: string } {
    if (this.state.killSwitchActive) {
      return { allowed: false, reason: 'Kill switch is active' };
    }
    if (this.state.isPaused) {
      return {
        allowed: false,
        reason: `System paused: ${this.state.pauseReason}`,
      };
    }
    if (this.state.uncertainties.length > 0) {
      return { allowed: false, reason: `Pending uncertainty: ${this.state.uncertainties[0]}` };
    }
    
    return { allowed: true };
  }
  
  // ============================================================================
  // STAGE ADVANCEMENT
  // ============================================================================
  
  /**
   * Request stage advancement with proof metrics
   * Requires explicit human authorization
   */
  async requestStageAdvancement(
    authority: string,
    targetStage: Stage
  ): Promise<{ success: boolean; message: string }> {
    // Verify authority
    if (!authority || authority.length === 0) {
      return {
        success: false,
        message: 'Invalid authority - Stage advancement requires human authorization',
      };
    }
    
    // Check if advancement is sequential
    if (targetStage !== this.state.currentStage + 1) {
      return {
        success: false,
        message: `Cannot skip stages. Current: ${this.state.currentStage}, Target: ${targetStage}`,
      };
    }
    
    // Check if proof metrics meet criteria
    if (!this.state.proofMetrics.meetsAdvancementCriteria) {
      return {
        success: false,
        message: 'Proof metrics do not meet advancement criteria',
      };
    }
    
    // Advance stage
    const previousStage = this.state.currentStage;
    this.state.currentStage = targetStage;
    this.config = STAGE_CONFIGS[targetStage];
    
    // Reset to paused state
    this.state.isPaused = true;
    this.state.pauseReason = 'Stage advancement - awaiting UNPAUSE';
    this.state.unpauseRequiresAuthorization = this.config.requiresExplicitUnpause;
    
    log.info('STAGE ADVANCED', {
      from: STAGE_CONFIGS[previousStage].stageName,
      to: this.config.stageName,
      authority,
    });
    
    this.emit('stage-advanced', {
      previousStage,
      currentStage: targetStage,
      authority,
      timestamp: Date.now(),
    });
    
    this.recordStateChange({
      currentStage: targetStage,
      isPaused: true,
      pauseReason: 'Stage advancement - awaiting UNPAUSE',
    });
    
    return {
      success: true,
      message: `Advanced to ${this.config.stageName}. System paused - requires UNPAUSE.`,
    };
  }
  
  /**
   * Update proof metrics (called by trading engine)
   */
  updateProofMetrics(metrics: Partial<ProofMetrics>): void {
    this.state.proofMetrics = {
      ...this.state.proofMetrics,
      ...metrics,
    };
    
    // Check if meets advancement criteria
    this.state.proofMetrics.meetsAdvancementCriteria = this.checkAdvancementCriteria();
    
    this.emit('metrics-updated', {
      stage: this.state.currentStage,
      metrics: this.state.proofMetrics,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Check if current proof metrics meet criteria for advancement
   */
  private checkAdvancementCriteria(): boolean {
    const m = this.state.proofMetrics;

    if (this.state.currentStage === Stage.STAGE_1_CONSTRAINED_PILOT) {
      return m.chainHealthy &&
        m.liveValidationSamples >= 3 &&
        m.liveValidationPassRate >= 0.8 &&
        m.monteCarloSimulations > 0 &&
        m.monteCarloPassRate >= 0.8 &&
        !this.state.blockingAnomaly;
    }
    
    // Minimum trade count
    if (m.totalTrades < 100) return false;
    
    // Success rate threshold
    if (m.successRate < 0.6) return false;
    
    // Sharpe ratio threshold
    if (m.sharpeRatio < 1.0) return false;
    
    // Max drawdown limit
    if (m.maxDrawdown > 0.2) return false;
    
    // Monte Carlo validation
    if (m.monteCarloPassRate < 0.8) return false;
    
    // Uptime requirement
    const requiredUptimeHours = 24 * 3; // 3 days
    if (m.uptime < requiredUptimeHours * 3600 * 1000) return false;
    
    return true;
  }
  
  // ============================================================================
  // CYCLE MANAGEMENT
  // ============================================================================
  
  /**
   * Begin a new cycle
   */
  beginCycle(): void {
    this.state.cycleCount++;
    this.state.lastCycleStartTime = Date.now();
    
    this.emit('cycle-started', {
      stage: this.state.currentStage,
      cycleCount: this.state.cycleCount,
      timestamp: Date.now(),
    });
  }
  
  /**
   * End current cycle
   */
  endCycle(): void {
    this.state.lastCycleEndTime = Date.now();
    
    this.emit('cycle-ended', {
      stage: this.state.currentStage,
      cycleCount: this.state.cycleCount,
      timestamp: Date.now(),
    });
    
    // Automatic pause if required by stage
    if (this.config.automaticPauseAfterCycle) {
      this.pause('Automatic pause after cycle completion');
    }
  }
  
  // ============================================================================
  // ANOMALY DETECTION
  // ============================================================================
  
  /**
   * Report anomaly detected
   */
  reportAnomaly(reason: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.state.anomalyCount++;
    this.state.lastAnomalyTime = Date.now();
    this.state.lastAnomalyReason = reason;
    if (severity === 'high' || severity === 'critical') {
      this.state.blockingAnomaly = true;
    }
    
    log.warn('ANOMALY DETECTED', {
      stage: this.config.stageName,
      reason,
      severity,
      count: this.state.anomalyCount,
    });
    
    this.emit('anomaly-detected', {
      stage: this.state.currentStage,
      reason,
      severity,
      count: this.state.anomalyCount,
      timestamp: Date.now(),
    });
    
    // Auto-pause on high or critical anomalies
    if (severity === 'high' || severity === 'critical') {
      this.pause(`Anomaly detected: ${reason} (${severity})`);
    }
  }
  
  // ============================================================================
  // STATE QUERIES
  // ============================================================================
  
  getCurrentStage(): Stage {
    return this.state.currentStage;
  }
  
  getStageConfig(): StageConfig {
    return { ...this.config };
  }
  
  getState(): StageState {
    return { ...this.state };
  }
  
  isPaused(): boolean {
    return this.state.isPaused;
  }
  
  canExecuteTrades(): boolean {
    return this.config.canExecuteTrades && !this.state.isPaused;
  }
  
  requiresHumanApproval(): boolean {
    return this.config.requiresHumanApproval;
  }
  
  getMaxDailyProfit(): number {
    return this.config.maxDailyProfit;
  }
  
  getCurrentDailyProfit(): number {
    return this.state.dailyProfitUSD;
  }
  
  getTotalProfit(): number {
    return this.state.totalProfitUSD;
  }

  recordLiveValidation(evidence: { passed: boolean; chainHealthy: boolean; timestamp?: number }): void {
    const metrics = this.state.proofMetrics;
    metrics.liveValidationSamples += 1;
    if (evidence.passed) metrics.liveValidationPasses += 1;
    metrics.liveValidationPassRate = metrics.liveValidationPasses / metrics.liveValidationSamples;
    metrics.chainHealthy = evidence.chainHealthy;
    metrics.lastLiveValidationAt = evidence.timestamp ?? Date.now();
    metrics.meetsAdvancementCriteria = this.checkAdvancementCriteria();
    this.emit('live-validation-recorded', {
      stage: this.state.currentStage,
      metrics: { ...metrics },
      timestamp: metrics.lastLiveValidationAt,
    });
  }

  engageKillSwitch(reason: string): void {
    this.state.killSwitchActive = true;
    this.state.isPaused = true;
    this.state.pauseReason = `Kill-switch: ${reason}`;
    this.state.lastPauseTimestamp = Date.now();
    this.state.unpauseRequiresAuthorization = true;
    this.emit('kill-switch-engaged', { stage: this.state.currentStage, reason, timestamp: Date.now() });
    this.recordStateChange({
      killSwitchActive: true,
      isPaused: true,
      pauseReason: this.state.pauseReason,
      lastPauseTimestamp: this.state.lastPauseTimestamp,
    });
  }

  resetKillSwitch(confirmation: string): { success: boolean; message: string } {
    if (confirmation !== 'CONFIRM_KILL_SWITCH_RESET') {
      return { success: false, message: 'Invalid confirmation code' };
    }
    this.state.killSwitchActive = false;
    this.state.isPaused = true;
    this.state.pauseReason = 'Kill switch reset - awaiting human authorization';
    this.state.lastPauseTimestamp = Date.now();
    this.recordStateChange({ killSwitchActive: false, isPaused: true, pauseReason: this.state.pauseReason, lastPauseTimestamp: this.state.lastPauseTimestamp });
    return { success: true, message: 'Kill switch reset. System remains paused.' };
  }

  reportUncertainty(uncertainty: string): void {
    this.state.uncertainties.push(uncertainty);
    this.pause(`Uncertainty detected: ${uncertainty}`);
    this.emit('uncertainty-reported', { uncertainty, timestamp: Date.now() });
  }

  resolveUncertainty(uncertainty: string): boolean {
    const index = this.state.uncertainties.indexOf(uncertainty);
    if (index === -1) return false;
    this.state.uncertainties.splice(index, 1);
    this.emit('uncertainty-resolved', { uncertainty, timestamp: Date.now() });
    return true;
  }
  
  // ============================================================================
  // PROFIT TRACKING
  // ============================================================================
  
  /**
   * Record profit/loss from trade
   */
  recordTrade(profitUSD: number): void {
    this.state.dailyProfitUSD += profitUSD;
    this.state.totalProfitUSD += profitUSD;
    
    // Check if exceeded daily limit
    if (this.state.dailyProfitUSD > this.config.maxDailyProfit) {
      this.pause(`Daily profit limit reached: $${this.state.dailyProfitUSD.toFixed(2)} / $${this.config.maxDailyProfit}`);
    }
    
    this.emit('trade-recorded', {
      profitUSD,
      dailyTotal: this.state.dailyProfitUSD,
      totalProfit: this.state.totalProfitUSD,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Reset daily profit counter (should be called at midnight UTC)
   */
  resetDailyProfit(): void {
    const previousDailyProfit = this.state.dailyProfitUSD;
    this.state.dailyProfitUSD = 0;
    
    log.info('Daily profit counter reset', {
      previousDailyProfit,
      totalProfit: this.state.totalProfitUSD,
    });
    
    this.emit('daily-profit-reset', {
      previousDailyProfit,
      totalProfit: this.state.totalProfitUSD,
      timestamp: Date.now(),
    });
  }
  
  // ============================================================================
  // UTILITIES
  // ============================================================================
  
  private getEmptyProofMetrics(): ProofMetrics {
    return {
      successRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      avgProfitPerTrade: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      uptime: 0,
      monteCarloPassRate: 0,
      monteCarloSimulations: 0,
      liveValidationSamples: 0,
      liveValidationPasses: 0,
      liveValidationPassRate: 0,
      chainHealthy: false,
      meetsAdvancementCriteria: false,
    };
  }
  
  private recordStateChange(changes: Partial<StageState>): void {
    this.stateHistory.push({
      timestamp: Date.now(),
      state: changes,
    });
    
    // Keep last 1000 state changes
    if (this.stateHistory.length > 1000) {
      this.stateHistory.shift();
    }
  }
  
  getStateHistory(): Array<{ timestamp: number; state: Partial<StageState> }> {
    return [...this.stateHistory];
  }
  
  /**
   * Export full state for persistence
   */
  exportState(): any {
    return {
      state: this.state,
      config: this.config,
      stateHistory: this.stateHistory,
      timestamp: Date.now(),
    };
  }
  
  /**
   * Import state from persistence
   */
  importState(data: any): void {
    if (data.state) {
      this.state = data.state;
      this.config = STAGE_CONFIGS[this.state.currentStage];
    }
    if (data.stateHistory) {
      this.stateHistory = data.stateHistory;
    }
    
    log.info('State imported', {
      stage: this.config.stageName,
      isPaused: this.state.isPaused,
    });
  }
}

// Singleton instance
export const stageManager = StageManager.getInstance();
