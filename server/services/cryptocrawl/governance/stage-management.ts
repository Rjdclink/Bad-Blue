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
import type { StageManagerPersistedSnapshot, StageManagerStateStore } from './stage-state-store.js';
import type { ExecutionStatus, NormalizedRealizedExecution } from '../execution/settlement-types.js';
import type { InitialGasReadiness, InitialGasReadinessStatus } from '../initial-gas-readiness.js';

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
    requiresHumanApproval: false,
    requiresExplicitUnpause: false,
    
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
    requiresHumanApproval: false,
    requiresExplicitUnpause: false,
    
    maxPairsAllowed: 10,
    maxVenuesAllowed: 3,
    allowedChains: ['polygon', 'arbitrum', 'europa'],
    
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
    requiresHumanApproval: false,
    requiresExplicitUnpause: false,
    
    maxPairsAllowed: 20,
    maxVenuesAllowed: 5,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'europa'],
    
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
    requiresExplicitUnpause: false,
    
    maxPairsAllowed: 50,
    maxVenuesAllowed: 10,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'europa'],
    
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
    requiresExplicitUnpause: false,
    
    maxPairsAllowed: 100,
    maxVenuesAllowed: 15,
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'europa'],
    
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
    allowedChains: ['polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', 'ethereum', 'europa'],
    
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
  activationMode: 'automatic' | 'manual' | 'none';
  activatedAt?: number;
  manualHold: boolean;
  
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

  initialGasReady: boolean;
  initialGasReadinessStatus: InitialGasReadinessStatus;
  initialGasReadinessObservedAt?: number;

  automaticAdvancementEvidence: AutomaticAdvancementEvidence | null;
  automaticAdvancementBlockers: string[];
  cryptaraExecutionEvidence: PersistedCryptaraExecutionEvidence[];
  profitLadderState: Record<string, unknown> | null;
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

export interface CryptaraRankingEvidence {
  evaluatedAt: number;
  sampleCount: number;
  successfulExecutions: number;
  successRate: number;
  averageNetProfitUsd: number;
  averageSlippageBps: number;
  preferredChains: string[];
  preferredExecutionModes: Array<'standard' | 'zero_capital' | 'flashbots'>;
  riskBudget: 'defensive' | 'balanced' | 'aggressive';
  notionalMultiplier: number;
  maxSlippageBps: number;
  chainPerformance: Array<{
    chain: string;
    netRealizedProfitUsd: number;
    successfulExecutions: number;
    totalExecutions: number;
    rankingScore: number;
  }>;
}

export interface AutomaticAdvancementEvidence {
  evaluatedAt: number;
  marketGate: {
    decision: 'ALLOW' | 'BLOCK';
    evaluatedAt: number;
    reasons: string[];
  };
  cryptara: CryptaraRankingEvidence;
  profitLadder: {
    currentTierId: number;
    readyForNextTier: boolean;
    blockers: string[];
  };
  risk: {
    circuitBreakersClear: boolean;
    trippedCircuitBreakers: string[];
  };
}

export interface AutomaticAdvancementResult {
  advanced: boolean;
  fromStage: Stage;
  toStage?: Stage;
  blockers: string[];
}

export interface PersistedCryptaraExecutionEvidence {
  source: 'master_pipeline' | 'zero_capital' | 'flash_loan' | 'manual';
  opportunityId?: string;
  chain: string;
  symbol: string;
  strategy: string;
  success: boolean;
  expectedProfitUsd: number;
  realizedProfitUsd: number | null;
  feeUsd: number | null;
  slippageBps: number | null;
  latencyMs: number;
  usedZeroCapital: boolean;
  timestamp: number;
  notes?: string;
  settlementStatus?: string;
  settlementConfirmed?: boolean;
  provenance?: string[];
  settlement?: NormalizedRealizedExecution;
}

// ============================================================================
// STAGE MANAGER
// ============================================================================

export class StageManager extends EventEmitter {
  private static instance: StageManager | null = null;
  private state: StageState;
  private config: StageConfig;
  private stateHistory: Array<{ timestamp: number; state: Partial<StageState> }> = [];
  private stateStore: StageManagerStateStore | null = null;
  private persistenceTail: Promise<void> = Promise.resolve();
  
  private constructor() {
    super();
    this.state = this.createInitialState();
    
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

  async restorePersistence(store: StageManagerStateStore): Promise<boolean> {
    this.stateStore = store;
    const snapshot = await store.load();
    if (!snapshot) {
      await this.persistState();
      return false;
    }

    this.importState(snapshot);
    await this.persistState();
    return true;
  }

  async flushPersistence(): Promise<void> {
    await this.persistenceTail;
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
    
    log.info('Manual UNPAUSE request received', {
      stage: this.config.stageName,
      authority,
      scope,
      duration,
    });
      
    // Record optional manual override activation.
    this.state.isPaused = false;
    this.state.pauseReason = undefined;
    this.state.lastUnpauseTimestamp = Date.now();
    this.state.lastUnpauseAuthority = authority;
    this.state.lastUnpauseScope = scope;
    this.state.lastUnpauseDuration = duration;
    this.state.unpauseRequiresAuthorization = false;
    this.state.activationMode = 'manual';
    this.state.activatedAt = Date.now();
    this.state.manualHold = false;
      
    // Schedule automatic pause if duration specified.
    if (duration > 0) {
      setTimeout(() => {
        this.pause('Duration expired');
      }, duration);
    }
      
    this.emit('unpaused', {
      stage: this.state.currentStage,
      authority,
      scope,
      duration,
      automatic: false,
      timestamp: Date.now(),
    });
      
    this.recordStateChange({ isPaused: false, activationMode: 'manual', manualHold: false });
    await this.persistState();
      
    return {
      success: true,
      message: `System manually activated by ${authority} for scope: ${scope}`,
    };
  }

  private activateAutomatically(reason: string, evidence?: AutomaticAdvancementEvidence): void {
    this.state.isPaused = false;
    this.state.pauseReason = undefined;
    this.state.unpauseRequiresAuthorization = false;
    this.state.activationMode = 'automatic';
    this.state.activatedAt = Date.now();
    this.state.manualHold = false;
    this.emit('unpaused', {
      stage: this.state.currentStage,
      authority: 'system',
      scope: reason,
      duration: 0,
      automatic: true,
      evidence,
      timestamp: this.state.activatedAt,
    });
  }
  
  /**
   * PAUSE the system with absolute semantics
   */
  pause(reason: string, options?: { manualOverride?: boolean }): void {
    if (this.state.isPaused) {
      log.warn('System already paused', { reason });
      this.state.pauseReason = reason;
      this.state.lastPauseTimestamp = Date.now();
      this.state.activationMode = 'none';
      this.state.manualHold = this.state.manualHold || options?.manualOverride === true;
      this.recordStateChange({ pauseReason: reason, lastPauseTimestamp: this.state.lastPauseTimestamp });
      return;
    }
    
    log.warn('SYSTEM PAUSED', { reason, stage: this.config.stageName });
    
    this.state.isPaused = true;
    this.state.pauseReason = reason;
    this.state.lastPauseTimestamp = Date.now();
    this.state.unpauseRequiresAuthorization = this.config.requiresExplicitUnpause;
    this.state.activationMode = 'none';
    this.state.manualHold = options?.manualOverride === true;
    
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
    this.state.proofMetrics = this.getEmptyProofMetrics();
    
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
    await this.persistState();
    
    return {
      success: true,
      message: `Advanced to ${this.config.stageName}. System paused - requires UNPAUSE.`,
    };
  }

  async evaluateAutomaticAdvancement(evidence: AutomaticAdvancementEvidence): Promise<AutomaticAdvancementResult> {
    const normalizedEvidence = normalizeAutomaticAdvancementEvidence(evidence);
    this.state.automaticAdvancementEvidence = normalizedEvidence;

    const blockers = this.getAutomaticAdvancementBlockers(normalizedEvidence);
    this.state.automaticAdvancementBlockers = blockers;
    if (blockers.length > 0) {
      this.recordStateChange({
        automaticAdvancementEvidence: normalizedEvidence,
        automaticAdvancementBlockers: blockers,
      });
      await this.persistState();
      return { advanced: false, fromStage: this.state.currentStage, blockers };
    }

    const { profitLadder } = await import('./profit-ladder.js');
    const tierAdvance = profitLadder.advanceToNextTier();
    if (!tierAdvance.success) {
      const tierBlocker = `Profit ladder did not advance: ${tierAdvance.message}`;
      this.state.automaticAdvancementBlockers = [tierBlocker];
      this.recordStateChange({ automaticAdvancementBlockers: [tierBlocker] });
      await this.persistState();
      return { advanced: false, fromStage: this.state.currentStage, blockers: [tierBlocker] };
    }
    this.state.profitLadderState = profitLadder.exportState();

    const previousStage = this.state.currentStage;
    const nextStage = (previousStage + 1) as Stage;
    this.state.currentStage = nextStage;
    this.config = STAGE_CONFIGS[nextStage];
    this.state.proofMetrics = this.getEmptyProofMetrics();
    this.state.automaticAdvancementBlockers = [];

    log.info('STAGE ADVANCED AUTOMATICALLY FROM VERIFIED EVIDENCE', {
      from: STAGE_CONFIGS[previousStage].stageName,
      to: this.config.stageName,
      cryptaraRiskBudget: normalizedEvidence.cryptara.riskBudget,
      preferredChains: normalizedEvidence.cryptara.preferredChains,
      profitLadderTier: normalizedEvidence.profitLadder.currentTierId,
    });
    this.emit('stage-advanced', {
      previousStage,
      currentStage: nextStage,
      authority: 'system',
      automatic: true,
      evidence: normalizedEvidence,
      timestamp: Date.now(),
    });
    this.activateAutomatically(`automatic_stage_advancement:${previousStage}->${nextStage}`, normalizedEvidence);
    this.recordStateChange({
      currentStage: nextStage,
      isPaused: false,
      activationMode: 'automatic',
      manualHold: false,
      automaticAdvancementEvidence: normalizedEvidence,
      automaticAdvancementBlockers: [],
    });
    await this.persistState();
    return { advanced: true, fromStage: previousStage, toStage: nextStage, blockers: [] };
  }

  async recordExecutionEvidence(input: {
    success: boolean;
    realizedProfitUsd: number | null;
    automaticEvidence: AutomaticAdvancementEvidence;
    cryptaraFeedback: PersistedCryptaraExecutionEvidence;
  }): Promise<AutomaticAdvancementResult> {
    const metrics = this.state.proofMetrics;
    const previousTrades = metrics.totalTrades;
    metrics.totalTrades += 1;
    if (input.success && input.realizedProfitUsd !== null && Number.isFinite(input.realizedProfitUsd)) {
      metrics.winningTrades += 1;
      this.state.dailyProfitUSD += input.realizedProfitUsd;
      this.state.totalProfitUSD += input.realizedProfitUsd;
    } else {
      metrics.losingTrades += 1;
    }
    metrics.successRate = metrics.winningTrades / metrics.totalTrades;
    if (input.realizedProfitUsd !== null && Number.isFinite(input.realizedProfitUsd)) {
      metrics.avgProfitPerTrade = ((metrics.avgProfitPerTrade * previousTrades) + input.realizedProfitUsd) / metrics.totalTrades;
    }
    metrics.meetsAdvancementCriteria = this.checkAdvancementCriteria();
    this.state.cryptaraExecutionEvidence.push(normalizeCryptaraExecutionEvidence(input.cryptaraFeedback));
    if (this.state.cryptaraExecutionEvidence.length > 1000) {
      this.state.cryptaraExecutionEvidence = this.state.cryptaraExecutionEvidence.slice(-1000);
    }
    this.emit('execution-evidence-recorded', {
      stage: this.state.currentStage,
      metrics: { ...metrics },
      success: input.success,
      realizedProfitUsd: input.realizedProfitUsd,
      timestamp: Date.now(),
    });
    return this.evaluateAutomaticAdvancement(input.automaticEvidence);
  }
  
  /**
   * Update proof metrics (called by trading engine)
   */
  async updateProofMetrics(metrics: Partial<ProofMetrics>): Promise<void> {
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
    await this.persistState();
  }
  
  /**
   * Check if current proof metrics meet criteria for advancement
   */
  private checkAdvancementCriteria(): boolean {
    const m = this.state.proofMetrics;
    m.uptime = this.state.activatedAt ? Math.max(0, Date.now() - this.state.activatedAt) : 0;

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

  private getAutomaticAdvancementBlockers(evidence: AutomaticAdvancementEvidence): string[] {
    const blockers: string[] = [];
    if (this.state.currentStage >= Stage.STAGE_6_CONDITIONAL_AUTONOMY) {
      blockers.push('Already at the highest stage');
    }
    if (this.state.manualHold) blockers.push('A human pause or stop override is active');
    if (this.state.killSwitchActive) blockers.push('Kill-switch is active');
    if (this.state.blockingAnomaly) blockers.push('Blocking anomaly is active');
    if (this.state.uncertainties.length > 0) blockers.push(`Pending uncertainty: ${this.state.uncertainties[0]}`);
    if (!this.state.proofMetrics.meetsAdvancementCriteria) blockers.push('StageManager proof metrics do not meet the current stage criteria');
    if (evidence.marketGate.decision !== 'ALLOW') blockers.push('Cryptara market gate did not authorize advancement');
    if (!evidence.risk.circuitBreakersClear) blockers.push(`Risk circuit breakers are tripped: ${evidence.risk.trippedCircuitBreakers.join(', ')}`);
    if (evidence.cryptara.riskBudget === 'defensive') blockers.push('Cryptara performance ranking selected a defensive risk budget');
    if (evidence.cryptara.preferredChains.length === 0) blockers.push('Cryptara performance ranking has no preferred chain');
    if (this.state.currentStage >= Stage.STAGE_2_PROOF_OF_SIGNAL && evidence.cryptara.sampleCount < this.state.proofMetrics.totalTrades) {
      blockers.push('Persisted Cryptara execution history does not cover all recorded StageManager trades');
    }
    if (evidence.profitLadder.currentTierId !== this.state.currentStage - 1) {
      blockers.push('Profit-ladder tier is not aligned with the current governance stage');
    }
    if (!evidence.profitLadder.readyForNextTier) {
      blockers.push(...evidence.profitLadder.blockers.map(blocker => `Profit ladder: ${blocker}`));
      if (evidence.profitLadder.blockers.length === 0) blockers.push('Profit ladder is not ready for the next tier');
    }
    return blockers;
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
    if (this.config.automaticPauseAfterCycle && this.state.activationMode !== 'automatic') {
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

  setInitialGasReadiness(readiness: InitialGasReadiness): void {
    this.state.initialGasReady = readiness.status === 'INITIAL_GAS_READY' && readiness.initialGasReady;
    this.state.initialGasReadinessStatus = readiness.status;
    this.state.initialGasReadinessObservedAt = readiness.observedAt;
    this.recordStateChange({
      initialGasReady: this.state.initialGasReady,
      initialGasReadinessStatus: this.state.initialGasReadinessStatus,
      initialGasReadinessObservedAt: this.state.initialGasReadinessObservedAt,
    });
    this.persistSoon();
    this.emit('initial-gas-readiness-updated', {
      ready: this.state.initialGasReady,
      status: this.state.initialGasReadinessStatus,
      observedAt: readiness.observedAt,
    });
  }

  isInitialGasReady(): boolean {
    return this.state.initialGasReady && this.state.initialGasReadinessStatus === 'INITIAL_GAS_READY';
  }

  resetInitialGasReadiness(): void {
    this.state.initialGasReady = false;
    this.state.initialGasReadinessStatus = 'PRE_STAGE_1_BOOTSTRAP';
    this.state.initialGasReadinessObservedAt = undefined;
    this.recordStateChange({
      initialGasReady: false,
      initialGasReadinessStatus: 'PRE_STAGE_1_BOOTSTRAP',
      initialGasReadinessObservedAt: undefined,
    });
    this.persistSoon();
  }

  isMarketOperationsAllowed(): boolean {
    return this.isInitialGasReady() && !this.state.isPaused && !this.state.killSwitchActive;
  }
  
  requiresHumanApproval(): boolean {
    return this.config.requiresHumanApproval && this.state.activationMode !== 'automatic';
  }

  isAutomaticallyActivated(): boolean {
    return this.state.activationMode === 'automatic' && !this.state.isPaused;
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

  async recordLiveValidation(evidence: { passed: boolean; chainHealthy: boolean; timestamp?: number }): Promise<void> {
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
    await this.persistState();
  }

  engageKillSwitch(reason: string): void {
    this.state.killSwitchActive = true;
    this.state.isPaused = true;
    this.state.pauseReason = `Kill-switch: ${reason}`;
    this.state.lastPauseTimestamp = Date.now();
    this.state.unpauseRequiresAuthorization = true;
    this.state.activationMode = 'none';
    this.state.manualHold = false;
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
    this.state.pauseReason = 'Kill switch reset - awaiting fresh qualifying evidence or manual activation';
    this.state.lastPauseTimestamp = Date.now();
    this.state.activationMode = 'none';
    this.state.manualHold = false;
    this.recordStateChange({ killSwitchActive: false, isPaused: true, pauseReason: this.state.pauseReason, lastPauseTimestamp: this.state.lastPauseTimestamp });
    return { success: true, message: 'Kill switch reset. System remains paused until requalification or manual activation.' };
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

  private createInitialState(): StageState {
    return {
      currentStage: Stage.STAGE_1_CONSTRAINED_PILOT,
      isPaused: false,
      unpauseRequiresAuthorization: false,
      activationMode: 'automatic',
      activatedAt: Date.now(),
      manualHold: false,
      cycleCount: 0,
      dailyProfitUSD: 0,
      totalProfitUSD: 0,
      currentDrawdownPercent: 0,
      proofMetrics: this.getEmptyProofMetrics(),
      anomalyCount: 0,
      blockingAnomaly: false,
      killSwitchActive: false,
      uncertainties: [],
      initialGasReady: false,
      initialGasReadinessStatus: 'PRE_STAGE_1_BOOTSTRAP',
      automaticAdvancementEvidence: null,
      automaticAdvancementBlockers: [],
      cryptaraExecutionEvidence: [],
      profitLadderState: null,
    };
  }

  private async persistState(): Promise<void> {
    if (!this.stateStore) return;
    const snapshot = this.exportState();
    const write = this.persistenceTail
      .catch(() => undefined)
      .then(() => this.stateStore!.save(snapshot));
    this.persistenceTail = write;
    await write;
  }

  private persistSoon(): void {
    void this.persistState().catch(error => {
      log.error('Failed to persist governance state', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  
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
    this.persistSoon();
  }
  
  getStateHistory(): Array<{ timestamp: number; state: Partial<StageState> }> {
    return [...this.stateHistory];
  }

  getCryptaraExecutionEvidence(): PersistedCryptaraExecutionEvidence[] {
    return this.state.cryptaraExecutionEvidence.map(entry => ({ ...entry }));
  }

  getProfitLadderState(): Record<string, unknown> | null {
    return this.state.profitLadderState ? { ...this.state.profitLadderState } : null;
  }

  async recordProfitLadderState(value: Record<string, unknown>): Promise<void> {
    this.state.profitLadderState = { ...value };
    this.recordStateChange({ profitLadderState: this.state.profitLadderState });
    await this.persistState();
  }
  
  /**
   * Export full state for persistence
   */
  exportState(): StageManagerPersistedSnapshot {
    return {
      state: this.state,
      stateHistory: this.stateHistory,
    };
  }
  
  /**
   * Import state from persistence
   */
  importState(data: StageManagerPersistedSnapshot): void {
    if (!isRecord(data.state)) {
      throw new Error('Persisted governance state is missing a state object');
    }

    const restored = this.normalizeRestoredState(data.state);
    const legacyAuthorizationPause =
      restored.currentStage === Stage.STAGE_1_CONSTRAINED_PILOT &&
      (restored.pauseReason === 'Initial state - awaiting human authorization' ||
        restored.pauseReason === 'restart_requires_human_unpause');
    if (legacyAuthorizationPause) {
      restored.isPaused = false;
      restored.pauseReason = undefined;
      restored.lastPauseTimestamp = undefined;
      restored.unpauseRequiresAuthorization = false;
      restored.activationMode = 'automatic';
      restored.manualHold = false;
    }
    const mayResumeAutomatic =
      restored.activationMode === 'automatic' &&
      !restored.isPaused &&
      !restored.manualHold &&
      !restored.killSwitchActive &&
      !restored.blockingAnomaly &&
      restored.uncertainties.length === 0 &&
      (restored.currentStage === Stage.STAGE_1_CONSTRAINED_PILOT || restored.activationMode === 'automatic');
    if (!legacyAuthorizationPause && !mayResumeAutomatic && !restored.isPaused) {
      restored.isPaused = true;
      restored.pauseReason = 'restart_requires_human_unpause';
      restored.lastPauseTimestamp = Date.now();
      restored.unpauseRequiresAuthorization = true;
      restored.activationMode = 'none';
      restored.manualHold = true;
    } else if (mayResumeAutomatic) {
      restored.unpauseRequiresAuthorization = false;
    }

    restored.initialGasReady = false;
    restored.initialGasReadinessStatus = 'PRE_STAGE_1_BOOTSTRAP';
    restored.initialGasReadinessObservedAt = undefined;
    this.state = restored;
    this.config = STAGE_CONFIGS[restored.currentStage];
    this.state.proofMetrics.meetsAdvancementCriteria = this.checkAdvancementCriteria();
    this.stateHistory = Array.isArray(data.stateHistory)
      ? data.stateHistory.slice(-1000).filter(isStateHistoryEntry)
      : [];
    
    log.info('State imported', {
      stage: this.config.stageName,
      isPaused: this.state.isPaused,
    });
  }

  private normalizeRestoredState(value: Record<string, unknown>): StageState {
    const stage = Number(value.currentStage);
    if (!Number.isInteger(stage) || !STAGE_CONFIGS[stage as Stage]) {
      throw new Error('Persisted governance state has an invalid stage');
    }
    if (!isRecord(value.proofMetrics)) {
      throw new Error('Persisted governance state is missing proof metrics');
    }

    const proofMetrics = this.normalizeProofMetrics(value.proofMetrics);
    const initial = this.createInitialState();
    return {
      ...initial,
      currentStage: stage as Stage,
      isPaused: requireBoolean('isPaused', value.isPaused),
      pauseReason: optionalString(value.pauseReason),
      lastPauseTimestamp: optionalTimestamp(value.lastPauseTimestamp),
      unpauseRequiresAuthorization: requireBoolean('unpauseRequiresAuthorization', value.unpauseRequiresAuthorization),
      activationMode: value.activationMode === 'automatic' || value.activationMode === 'manual' || value.activationMode === 'none'
        ? value.activationMode
        : requireBoolean('isPaused', value.isPaused) ? 'none' : 'manual',
      activatedAt: optionalTimestamp(value.activatedAt),
      manualHold: value.manualHold === undefined || value.manualHold === null
        ? false
        : requireBoolean('manualHold', value.manualHold),
      lastUnpauseTimestamp: optionalTimestamp(value.lastUnpauseTimestamp),
      lastUnpauseAuthority: optionalString(value.lastUnpauseAuthority),
      lastUnpauseScope: optionalString(value.lastUnpauseScope),
      lastUnpauseDuration: optionalNonNegativeNumber(value.lastUnpauseDuration),
      cycleCount: requireNonNegativeInteger('cycleCount', value.cycleCount),
      dailyProfitUSD: requireFiniteNumber('dailyProfitUSD', value.dailyProfitUSD),
      totalProfitUSD: requireFiniteNumber('totalProfitUSD', value.totalProfitUSD),
      currentDrawdownPercent: requireFiniteNumber('currentDrawdownPercent', value.currentDrawdownPercent),
      proofMetrics,
      anomalyCount: requireNonNegativeInteger('anomalyCount', value.anomalyCount),
      lastAnomalyTime: optionalTimestamp(value.lastAnomalyTime),
      lastAnomalyReason: optionalString(value.lastAnomalyReason),
      blockingAnomaly: requireBoolean('blockingAnomaly', value.blockingAnomaly),
      killSwitchActive: requireBoolean('killSwitchActive', value.killSwitchActive),
      uncertainties: requireStringArray('uncertainties', value.uncertainties),
      initialGasReady: value.initialGasReady === undefined || value.initialGasReady === null
        ? false
        : requireBoolean('initialGasReady', value.initialGasReady),
      initialGasReadinessStatus: normalizeInitialGasReadinessStatus(value.initialGasReadinessStatus),
      initialGasReadinessObservedAt: optionalTimestamp(value.initialGasReadinessObservedAt),
      automaticAdvancementEvidence: value.automaticAdvancementEvidence === undefined || value.automaticAdvancementEvidence === null
        ? null
        : normalizeAutomaticAdvancementEvidence(value.automaticAdvancementEvidence),
      automaticAdvancementBlockers: value.automaticAdvancementBlockers === undefined || value.automaticAdvancementBlockers === null
        ? []
        : requireStringArray('automaticAdvancementBlockers', value.automaticAdvancementBlockers),
      cryptaraExecutionEvidence: value.cryptaraExecutionEvidence === undefined || value.cryptaraExecutionEvidence === null
        ? []
        : requireCryptaraExecutionEvidence(value.cryptaraExecutionEvidence),
      profitLadderState: value.profitLadderState === undefined || value.profitLadderState === null
        ? null
        : requireRecord('profitLadderState', value.profitLadderState),
    };
  }

  private normalizeProofMetrics(value: Record<string, unknown>): ProofMetrics {
    const liveValidationSamples = requireNonNegativeInteger('liveValidationSamples', value.liveValidationSamples);
    const liveValidationPasses = requireNonNegativeInteger('liveValidationPasses', value.liveValidationPasses);
    if (liveValidationPasses > liveValidationSamples) {
      throw new Error('Persisted governance evidence has more passes than samples');
    }
    return {
      successRate: requireFiniteNumber('successRate', value.successRate),
      totalTrades: requireNonNegativeInteger('totalTrades', value.totalTrades),
      winningTrades: requireNonNegativeInteger('winningTrades', value.winningTrades),
      losingTrades: requireNonNegativeInteger('losingTrades', value.losingTrades),
      avgProfitPerTrade: requireFiniteNumber('avgProfitPerTrade', value.avgProfitPerTrade),
      sharpeRatio: requireFiniteNumber('sharpeRatio', value.sharpeRatio),
      maxDrawdown: requireFiniteNumber('maxDrawdown', value.maxDrawdown),
      uptime: requireNonNegativeNumber('uptime', value.uptime),
      monteCarloPassRate: requireUnitInterval('monteCarloPassRate', value.monteCarloPassRate),
      monteCarloSimulations: requireNonNegativeInteger('monteCarloSimulations', value.monteCarloSimulations),
      liveValidationSamples,
      liveValidationPasses,
      liveValidationPassRate: requireUnitInterval('liveValidationPassRate', value.liveValidationPassRate),
      chainHealthy: requireBoolean('chainHealthy', value.chainHealthy),
      lastLiveValidationAt: optionalTimestamp(value.lastLiveValidationAt),
      meetsAdvancementCriteria: false,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeInitialGasReadinessStatus(value: unknown): InitialGasReadinessStatus {
  if (value === undefined || value === null) return 'PRE_STAGE_1_BOOTSTRAP';
  const statuses: InitialGasReadinessStatus[] = [
    'PRE_STAGE_1_BOOTSTRAP',
    'INITIAL_GAS_READY',
    'GAS_READY',
    'GAS_BELOW_THRESHOLD',
    'GAS_ZERO_BALANCE',
    'BALANCE_UNKNOWN',
    'PRICE_UNKNOWN',
    'PROVIDER_UNAVAILABLE',
  ];
  if (typeof value !== 'string' || !statuses.includes(value as InitialGasReadinessStatus)) {
    throw new Error('Persisted governance state has an invalid initial gas readiness status');
  }
  return value as InitialGasReadinessStatus;
}

function normalizeAutomaticAdvancementEvidence(value: unknown): AutomaticAdvancementEvidence {
  if (!isRecord(value) || !isRecord(value.marketGate) || !isRecord(value.cryptara) || !isRecord(value.profitLadder) || !isRecord(value.risk)) {
    throw new Error('Persisted automatic advancement evidence has an invalid shape');
  }
  const gateDecision = value.marketGate.decision;
  if (gateDecision !== 'ALLOW' && gateDecision !== 'BLOCK') {
    throw new Error('Persisted automatic advancement evidence has an invalid market gate decision');
  }
  const riskBudget = value.cryptara.riskBudget;
  if (riskBudget !== 'defensive' && riskBudget !== 'balanced' && riskBudget !== 'aggressive') {
    throw new Error('Persisted automatic advancement evidence has an invalid Cryptara risk budget');
  }
  if (!Array.isArray(value.cryptara.chainPerformance)) {
    throw new Error('Persisted automatic advancement evidence has invalid chain performance');
  }
  const chainPerformance = value.cryptara.chainPerformance.map(entry => {
    if (!isRecord(entry)) throw new Error('Persisted automatic advancement evidence has an invalid chain performance entry');
    return {
      chain: requireNonEmptyString('chain', entry.chain),
      netRealizedProfitUsd: requireFiniteNumber('netRealizedProfitUsd', entry.netRealizedProfitUsd),
      successfulExecutions: requireNonNegativeInteger('successfulExecutions', entry.successfulExecutions),
      totalExecutions: requireNonNegativeInteger('totalExecutions', entry.totalExecutions),
      rankingScore: requireFiniteNumber('rankingScore', entry.rankingScore),
    };
  });
  const preferredExecutionModes = requireStringArray('preferredExecutionModes', value.cryptara.preferredExecutionModes);
  if (preferredExecutionModes.some(mode => mode !== 'standard' && mode !== 'zero_capital' && mode !== 'flashbots')) {
    throw new Error('Persisted automatic advancement evidence has an invalid Cryptara execution mode');
  }

  return {
    evaluatedAt: requireNonNegativeNumber('evaluatedAt', value.evaluatedAt),
    marketGate: {
      decision: gateDecision,
      evaluatedAt: requireNonNegativeNumber('marketGate.evaluatedAt', value.marketGate.evaluatedAt),
      reasons: requireStringArray('marketGate.reasons', value.marketGate.reasons),
    },
    cryptara: {
      evaluatedAt: requireNonNegativeNumber('cryptara.evaluatedAt', value.cryptara.evaluatedAt),
      sampleCount: requireNonNegativeInteger('cryptara.sampleCount', value.cryptara.sampleCount),
      successfulExecutions: requireNonNegativeInteger('cryptara.successfulExecutions', value.cryptara.successfulExecutions),
      successRate: requireUnitInterval('cryptara.successRate', value.cryptara.successRate),
      averageNetProfitUsd: requireFiniteNumber('cryptara.averageNetProfitUsd', value.cryptara.averageNetProfitUsd),
      averageSlippageBps: requireNonNegativeNumber('cryptara.averageSlippageBps', value.cryptara.averageSlippageBps),
      preferredChains: requireStringArray('cryptara.preferredChains', value.cryptara.preferredChains),
      preferredExecutionModes: preferredExecutionModes as Array<'standard' | 'zero_capital' | 'flashbots'>,
      riskBudget,
      notionalMultiplier: requireNonNegativeNumber('cryptara.notionalMultiplier', value.cryptara.notionalMultiplier),
      maxSlippageBps: requireNonNegativeNumber('cryptara.maxSlippageBps', value.cryptara.maxSlippageBps),
      chainPerformance,
    },
    profitLadder: {
      currentTierId: requireNonNegativeInteger('profitLadder.currentTierId', value.profitLadder.currentTierId),
      readyForNextTier: requireBoolean('profitLadder.readyForNextTier', value.profitLadder.readyForNextTier),
      blockers: requireStringArray('profitLadder.blockers', value.profitLadder.blockers),
    },
    risk: {
      circuitBreakersClear: requireBoolean('risk.circuitBreakersClear', value.risk.circuitBreakersClear),
      trippedCircuitBreakers: requireStringArray('risk.trippedCircuitBreakers', value.risk.trippedCircuitBreakers),
    },
  };
}

function requireCryptaraExecutionEvidence(value: unknown): PersistedCryptaraExecutionEvidence[] {
  if (!Array.isArray(value)) throw new Error('Persisted Cryptara execution evidence must be an array');
  return value.slice(-1000).map(normalizeCryptaraExecutionEvidence);
}

function normalizeCryptaraExecutionEvidence(value: PersistedCryptaraExecutionEvidence | unknown): PersistedCryptaraExecutionEvidence {
  if (!isRecord(value)) throw new Error('Persisted Cryptara execution evidence has an invalid shape');
  const source = value.source;
  if (source !== 'master_pipeline' && source !== 'zero_capital' && source !== 'flash_loan' && source !== 'manual') {
    throw new Error('Persisted Cryptara execution evidence has an invalid source');
  }
  return {
    source,
    opportunityId: optionalString(value.opportunityId),
    chain: requireNonEmptyString('chain', value.chain),
    symbol: requireNonEmptyString('symbol', value.symbol),
    strategy: requireNonEmptyString('strategy', value.strategy),
    success: requireBoolean('success', value.success),
    expectedProfitUsd: requireFiniteNumber('expectedProfitUsd', value.expectedProfitUsd),
    realizedProfitUsd: nullableFiniteNumber('realizedProfitUsd', value.realizedProfitUsd),
    feeUsd: nullableFiniteNumber('feeUsd', value.feeUsd),
    slippageBps: nullableFiniteNumber('slippageBps', value.slippageBps),
    latencyMs: requireNonNegativeNumber('latencyMs', value.latencyMs),
    usedZeroCapital: requireBoolean('usedZeroCapital', value.usedZeroCapital),
    timestamp: requireNonNegativeNumber('timestamp', value.timestamp),
    notes: optionalString(value.notes),
    settlementStatus: optionalString(value.settlementStatus),
    settlementConfirmed: optionalBoolean(value.settlementConfirmed),
    provenance: optionalStringArray(value.provenance),
    settlement: value.settlement === undefined ? undefined : normalizePersistedSettlement(value.settlement),
  };
}

function normalizePersistedSettlement(value: unknown): NormalizedRealizedExecution {
  if (!isRecord(value)) throw new Error('Persisted settlement has an invalid shape');
  const status = value.status;
  if (!isExecutionStatus(status)) throw new Error('Persisted settlement has an invalid status');
  const predicted = requireRecord('settlement.predicted', value.predicted);
  const realized = requireRecord('settlement.realized', value.realized);
  const provenance = requireStringArray('settlement.provenance', value.provenance).slice(0, 50);
  const orders = value.orders === undefined
    ? undefined
    : requireRecordArray('settlement.orders', value.orders).slice(0, 2).map((order, orderIndex) => normalizePersistedOrder(order, orderIndex));
  const tokenAmounts = value.tokenAmounts === undefined
    ? undefined
    : requireRecordArray('settlement.tokenAmounts', value.tokenAmounts).slice(0, 100).map((tokenAmount, tokenIndex) => ({
      token: requireNonEmptyString(`settlement.tokenAmounts[${tokenIndex}].token`, tokenAmount.token),
      direction: requireSettlementDirection(`settlement.tokenAmounts[${tokenIndex}].direction`, tokenAmount.direction),
      amount: requireNonEmptyString(`settlement.tokenAmounts[${tokenIndex}].amount`, tokenAmount.amount),
      decimals: tokenAmount.decimals === undefined ? undefined : requireNonNegativeInteger(`settlement.tokenAmounts[${tokenIndex}].decimals`, tokenAmount.decimals),
    }));
  return {
    status,
    terminal: requireBoolean('settlement.terminal', value.terminal),
    settlementConfirmed: requireBoolean('settlement.settlementConfirmed', value.settlementConfirmed),
    submittedAt: requireNonNegativeNumber('settlement.submittedAt', value.submittedAt),
    settledAt: nullableNonNegativeNumber('settlement.settledAt', value.settledAt),
    venueOrRoute: requireNonEmptyString('settlement.venueOrRoute', value.venueOrRoute),
    chain: value.chain === null ? null : requireNonEmptyString('settlement.chain', value.chain),
    predicted: {
      profitUsd: nullableFiniteNumber('settlement.predicted.profitUsd', predicted.profitUsd),
      feeUsd: nullableFiniteNumber('settlement.predicted.feeUsd', predicted.feeUsd),
      slippageBps: nullableFiniteNumber('settlement.predicted.slippageBps', predicted.slippageBps),
    },
    realized: {
      acquisitionCostUsd: nullableFiniteNumber('settlement.realized.acquisitionCostUsd', realized.acquisitionCostUsd),
      proceedsUsd: nullableFiniteNumber('settlement.realized.proceedsUsd', realized.proceedsUsd),
      exchangeFeeUsd: nullableFiniteNumber('settlement.realized.exchangeFeeUsd', realized.exchangeFeeUsd),
      gasUsd: nullableFiniteNumber('settlement.realized.gasUsd', realized.gasUsd),
      gasUsed: nullableString('settlement.realized.gasUsed', realized.gasUsed),
      effectiveGasPriceWei: nullableString('settlement.realized.effectiveGasPriceWei', realized.effectiveGasPriceWei),
      slippageBps: nullableFiniteNumber('settlement.realized.slippageBps', realized.slippageBps),
      netProfitUsd: nullableFiniteNumber('settlement.realized.netProfitUsd', realized.netProfitUsd),
    },
    provenance,
    orders,
    transactionHash: optionalString(value.transactionHash),
    blockNumber: value.blockNumber === undefined ? undefined : requireNonNegativeInteger('settlement.blockNumber', value.blockNumber),
    receiptStatus: value.receiptStatus === undefined ? undefined : requireReceiptStatus(value.receiptStatus),
    tokenAmounts,
    error: boundedOptionalString(value.error, 500),
  };
}

function normalizePersistedOrder(value: Record<string, unknown>, orderIndex: number): NormalizedRealizedExecution['orders'][number] {
  const fills = requireRecordArray(`settlement.orders[${orderIndex}].fills`, value.fills).slice(0, 100).map((fill, fillIndex) => ({
    quantity: requireFiniteNumber(`settlement.orders[${orderIndex}].fills[${fillIndex}].quantity`, fill.quantity),
    price: requireFiniteNumber(`settlement.orders[${orderIndex}].fills[${fillIndex}].price`, fill.price),
    feeAmount: nullableFiniteNumber(`settlement.orders[${orderIndex}].fills[${fillIndex}].feeAmount`, fill.feeAmount),
    feeAsset: nullableString(`settlement.orders[${orderIndex}].fills[${fillIndex}].feeAsset`, fill.feeAsset),
    timestamp: nullableNonNegativeNumber(`settlement.orders[${orderIndex}].fills[${fillIndex}].timestamp`, fill.timestamp),
    tradeId: optionalString(fill.tradeId),
  }));
  return {
    venue: requireNonEmptyString(`settlement.orders[${orderIndex}].venue`, value.venue),
    orderId: requireNonEmptyString(`settlement.orders[${orderIndex}].orderId`, value.orderId),
    symbol: requireNonEmptyString(`settlement.orders[${orderIndex}].symbol`, value.symbol),
    side: requireSettlementSide(`settlement.orders[${orderIndex}].side`, value.side),
    status: isExecutionStatus(value.status) ? value.status : (() => { throw new Error(`Persisted settlement.orders[${orderIndex}] has an invalid status`); })(),
    terminal: requireBoolean(`settlement.orders[${orderIndex}].terminal`, value.terminal),
    requestedQuantity: requireFiniteNumber(`settlement.orders[${orderIndex}].requestedQuantity`, value.requestedQuantity),
    filledQuantity: nullableFiniteNumber(`settlement.orders[${orderIndex}].filledQuantity`, value.filledQuantity),
    remainingQuantity: nullableFiniteNumber(`settlement.orders[${orderIndex}].remainingQuantity`, value.remainingQuantity),
    averageFillPrice: nullableFiniteNumber(`settlement.orders[${orderIndex}].averageFillPrice`, value.averageFillPrice),
    fills,
    feeAmount: nullableFiniteNumber(`settlement.orders[${orderIndex}].feeAmount`, value.feeAmount),
    feeAsset: nullableString(`settlement.orders[${orderIndex}].feeAsset`, value.feeAsset),
    submittedAt: requireNonNegativeNumber(`settlement.orders[${orderIndex}].submittedAt`, value.submittedAt),
    terminalAt: nullableNonNegativeNumber(`settlement.orders[${orderIndex}].terminalAt`, value.terminalAt),
    finalBalances: value.finalBalances === undefined ? undefined : requireStringRecord(`settlement.orders[${orderIndex}].finalBalances`, value.finalBalances),
    error: boundedOptionalString(value.error, 500),
  };
}

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return value === 'submitted' || value === 'partially_filled' || value === 'filled' || value === 'cancelled' || value === 'rejected' || value === 'failed' || value === 'settlement_unknown';
}

function requireSettlementSide(name: string, value: unknown): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell') throw new Error(`Persisted settlement has invalid ${name}`);
  return value;
}

function requireSettlementDirection(name: string, value: unknown): 'in' | 'out' {
  if (value !== 'in' && value !== 'out') throw new Error(`Persisted settlement has invalid ${name}`);
  return value;
}

function requireReceiptStatus(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Persisted settlement has an invalid receiptStatus');
  return value;
}

function requireRecordArray(name: string, value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`Persisted governance state has invalid ${name}`);
  return value;
}

function requireStringRecord(name: string, value: unknown): Record<string, string> {
  const record = requireRecord(name, value);
  if (!Object.values(record).every(entry => typeof entry === 'string')) throw new Error(`Persisted governance state has invalid ${name}`);
  return Object.fromEntries(Object.entries(record).slice(0, 100)) as Record<string, string>;
}

function nullableFiniteNumber(name: string, value: unknown): number | null {
  if (value === null) return null;
  return requireFiniteNumber(name, value);
}

function nullableNonNegativeNumber(name: string, value: unknown): number | null {
  if (value === null) return null;
  return requireNonNegativeNumber(name, value);
}

function nullableString(name: string, value: unknown): string | null {
  if (value === null) return null;
  return requireNonEmptyString(name, value);
}

function boundedOptionalString(value: unknown, maxLength: number): string | undefined {
  const string = optionalString(value);
  return string === undefined ? undefined : string.slice(0, maxLength);
}

function requireFiniteNumber(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Persisted governance state has invalid ${name}`);
  return value;
}

function requireNonNegativeNumber(name: string, value: unknown): number {
  const number = requireFiniteNumber(name, value);
  if (number < 0) throw new Error(`Persisted governance state has negative ${name}`);
  return number;
}

function requireNonNegativeInteger(name: string, value: unknown): number {
  const number = requireNonNegativeNumber(name, value);
  if (!Number.isInteger(number)) throw new Error(`Persisted governance state has non-integer ${name}`);
  return number;
}

function requireUnitInterval(name: string, value: unknown): number {
  const number = requireFiniteNumber(name, value);
  if (number < 0 || number > 1) throw new Error(`Persisted governance state has out-of-range ${name}`);
  return number;
}

function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error(`Persisted governance state has invalid ${name}`);
  return value;
}

function requireNonEmptyString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Persisted governance state has invalid ${name}`);
  return value;
}

function requireRecord(name: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Persisted governance state has invalid ${name}`);
  return { ...value };
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Persisted governance state has an invalid string field');
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return requireBoolean('boolean', value);
}

function optionalTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonNegativeNumber('timestamp', value);
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonNegativeNumber('number', value);
}

function requireStringArray(name: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Persisted governance state has invalid ${name}`);
  }
  return [...value];
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return requireStringArray('string array', value);
}

function isStateHistoryEntry(value: unknown): value is { timestamp: number; state: Partial<StageState> } {
  return isRecord(value) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    isRecord(value.state);
}

// Singleton instance
export const stageManager = StageManager.getInstance();
