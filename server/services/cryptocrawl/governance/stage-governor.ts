/**
 * CryptoCrawler Stage Governor - Enterprise-Grade Staged Autonomy System
 * 
 * PURPOSE: Manage progressive autonomy through 6 well-defined stages
 * with strict safety controls, pause semantics, and human authorization.
 * 
 * TARGET: $200/day (Stage 1) → $35,000/day (Stage 6)
 * TIMELINE: 2 months to full operational profitability
 * 
 * GLOBAL RULES (Apply to All Stages):
 * 1. No assumptions; no silent expansion
 * 2. No autonomous evolution
 * 3. Execution requires explicit authorization
 * 4. Pause semantics are absolute
 * 5. Ambiguity → ask-and-wait
 * 6. Advancement requires explicit UNPAUSE
 */

import { EventEmitter } from 'events';
import logger from '../../../logger.js';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type StageStatus = 
  | 'locked'           // Stage not accessible
  | 'paused'           // Stage accessible but paused
  | 'active'           // Stage currently active
  | 'completed'        // Stage completed, can advance
  | 'emergency_locked'; // Emergency lock engaged

export type SystemMode = 
  | 'advisory'         // Stages 1: Advisory only
  | 'proof_based'      // Stage 2: Proof-based operation
  | 'dry_run'          // Stage 3: Measured dry-run
  | 'limited_autonomy' // Stage 4: Limited autonomy
  | 'supervised'       // Stage 5: Supervised scaling
  | 'conditional';     // Stage 6: Conditional autonomy

export interface StageConfig {
  stage: StageNumber;
  name: string;
  description: string;
  mode: SystemMode;
  dailyProfitTarget: number;
  maxDailyProfit: number;
  executionAuthority: 'none' | 'limited' | 'conditional' | 'supervised' | 'autonomous';
  evolutionLock: boolean;
  memoryPartitioned: boolean;
  autoPauseEnabled: boolean;
  requirements: StageRequirement[];
}

export interface StageRequirement {
  type: 'monte_carlo_consensus' | 'profit_metric' | 'success_rate' | 'human_approval' | 'duration' | 'no_anomalies';
  description: string;
  threshold: number;
  currentValue?: number;
  met: boolean;
}

export interface StageState {
  currentStage: StageNumber;
  status: StageStatus;
  lastPause: number | null;
  lastUnpause: number | null;
  cyclesCompleted: number;
  profitThisStage: number;
  anomalyCount: number;
  emergencyLockEngaged: boolean;
  killSwitchArmed: boolean;
}

export interface UnpauseRequest {
  stage: StageNumber;
  scope: string[];
  duration: number;      // milliseconds, 0 = until next pause
  authority: string;     // human identifier
  timestamp: number;
  signature?: string;    // optional cryptographic signature
}

export interface AdvisoryCycleResult {
  cycleId: string;
  timestamp: number;
  signals: SignalAnalysis[];
  arbitragePaths: ArbitragePath[];
  recommendations: Recommendation[];
  monteCarloValidation: MonteCarloValidation;
  profitEstimate: number;
  riskAssessment: RiskAssessment;
}

export interface SignalAnalysis {
  pair: string;
  exchange: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string[];
}

export interface ArbitragePath {
  id: string;
  buyExchange: string;
  sellExchange: string;
  pair: string;
  expectedProfit: number;
  fees: number;
  slippage: number;
  latency: number;
  netProfit: number;
  feasibility: number;
}

export interface Recommendation {
  action: 'execute' | 'skip' | 'wait' | 'investigate';
  target: string;
  reasoning: string;
  confidence: number;
  humanApprovalRequired: boolean;
}

export interface MonteCarloValidation {
  simulations: number;
  expectedProfit: number;
  confidenceInterval: [number, number];
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  approval: 'approved' | 'conditional' | 'rejected';
  conditions?: string[];
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  mitigations: string[];
}

export interface RiskFactor {
  factor: string;
  severity: number; // 0-10
  description: string;
}

export interface ProfitLadderTier {
  tier: number;
  minProfit: number;
  maxProfit: number;
  requiredSuccessRate: number;
  requiredDays: number;
  unlocked: boolean;
}

// ============================================================================
// STAGE CONFIGURATIONS
// ============================================================================

export const STAGE_CONFIGS: Record<StageNumber, StageConfig> = {
  1: {
    stage: 1,
    name: 'Constrained Pilot / Strategy Optimization Sandbox',
    description: 'Cryptara acts strictly as advisor/strategist/optimizer. No execution authority.',
    mode: 'advisory',
    dailyProfitTarget: 200,
    maxDailyProfit: 500,
    executionAuthority: 'none',
    evolutionLock: true,
    memoryPartitioned: true,
    autoPauseEnabled: true,
    requirements: [
      { type: 'monte_carlo_consensus', description: 'Monte Carlo validation passes', threshold: 0.75, met: false },
      { type: 'no_anomalies', description: 'Zero anomalies in 24 hours', threshold: 0, met: false },
      { type: 'human_approval', description: 'Human approval for advancement', threshold: 1, met: false },
    ],
  },
  2: {
    stage: 2,
    name: 'Proof-of-Signal Activation',
    description: 'Transition from advisory to proof-based operation. First live actions allowed.',
    mode: 'proof_based',
    dailyProfitTarget: 500,
    maxDailyProfit: 1500,
    executionAuthority: 'limited',
    evolutionLock: true,
    memoryPartitioned: true,
    autoPauseEnabled: true,
    requirements: [
      { type: 'profit_metric', description: 'Achieved Stage 1 targets for 3 days', threshold: 3, met: false },
      { type: 'success_rate', description: 'Signal accuracy >= 70%', threshold: 0.70, met: false },
      { type: 'monte_carlo_consensus', description: 'Monte Carlo approval for live execution', threshold: 0.80, met: false },
      { type: 'human_approval', description: 'Explicit UNPAUSE command received', threshold: 1, met: false },
    ],
  },
  3: {
    stage: 3,
    name: 'Measured Dry-Run Expansion',
    description: 'Incremental scope widening with forced cool-downs and re-verification.',
    mode: 'dry_run',
    dailyProfitTarget: 1500,
    maxDailyProfit: 5000,
    executionAuthority: 'limited',
    evolutionLock: true,
    memoryPartitioned: true,
    autoPauseEnabled: true,
    requirements: [
      { type: 'profit_metric', description: 'Stage 2 profit targets met for 5 days', threshold: 5, met: false },
      { type: 'success_rate', description: 'Execution success rate >= 75%', threshold: 0.75, met: false },
      { type: 'duration', description: 'Minimum 7 days in Stage 2', threshold: 7, met: false },
      { type: 'no_anomalies', description: 'No anomalies during Stage 2', threshold: 0, met: false },
      { type: 'human_approval', description: 'Human verification and UNPAUSE', threshold: 1, met: false },
    ],
  },
  4: {
    stage: 4,
    name: 'Limited Autonomy Restoration',
    description: 'Narrow, conditional autonomy inside explicitly defined corridors.',
    mode: 'limited_autonomy',
    dailyProfitTarget: 5000,
    maxDailyProfit: 15000,
    executionAuthority: 'conditional',
    evolutionLock: true,
    memoryPartitioned: true,
    autoPauseEnabled: true,
    requirements: [
      { type: 'profit_metric', description: 'Consistent profitability in Stage 3 for 7 days', threshold: 7, met: false },
      { type: 'success_rate', description: 'Trade success rate >= 80%', threshold: 0.80, met: false },
      { type: 'monte_carlo_consensus', description: 'Full Monte Carlo + risk governor consensus', threshold: 0.85, met: false },
      { type: 'duration', description: 'Minimum 10 days in Stage 3', threshold: 10, met: false },
      { type: 'human_approval', description: 'Human approval with scope definition', threshold: 1, met: false },
    ],
  },
  5: {
    stage: 5,
    name: 'Supervised Scaling',
    description: 'Sequential unlocking of higher profit tiers with intensified monitoring.',
    mode: 'supervised',
    dailyProfitTarget: 15000,
    maxDailyProfit: 25000,
    executionAuthority: 'supervised',
    evolutionLock: true,
    memoryPartitioned: false, // Memory rights expand
    autoPauseEnabled: true,
    requirements: [
      { type: 'profit_metric', description: 'Stage 4 profit targets met for 10 days', threshold: 10, met: false },
      { type: 'success_rate', description: 'Overall success rate >= 85%', threshold: 0.85, met: false },
      { type: 'monte_carlo_consensus', description: 'Monte Carlo consensus for scaling', threshold: 0.90, met: false },
      { type: 'duration', description: 'Minimum 14 days in Stage 4', threshold: 14, met: false },
      { type: 'human_approval', description: 'Human veto review and UNPAUSE', threshold: 1, met: false },
    ],
  },
  6: {
    stage: 6,
    name: 'Conditional Autonomy',
    description: 'Full autonomy permitted only while all metrics remain within bounds.',
    mode: 'conditional',
    dailyProfitTarget: 35000,
    maxDailyProfit: 50000,
    executionAuthority: 'autonomous',
    evolutionLock: true, // Evolution lock ALWAYS on unless explicitly lifted
    memoryPartitioned: false,
    autoPauseEnabled: true,
    requirements: [
      { type: 'profit_metric', description: 'Stage 5 targets met for 14 days', threshold: 14, met: false },
      { type: 'success_rate', description: 'Success rate >= 90%', threshold: 0.90, met: false },
      { type: 'monte_carlo_consensus', description: 'Full Monte Carlo approval', threshold: 0.95, met: false },
      { type: 'no_anomalies', description: 'Zero anomalies in last 30 days', threshold: 0, met: false },
      { type: 'human_approval', description: 'Final human authorization', threshold: 1, met: false },
    ],
  },
};

// Profit Ladder - Progressive unlocking
export const PROFIT_LADDER: ProfitLadderTier[] = [
  { tier: 1, minProfit: 0, maxProfit: 200, requiredSuccessRate: 0.60, requiredDays: 1, unlocked: true },
  { tier: 2, minProfit: 200, maxProfit: 500, requiredSuccessRate: 0.65, requiredDays: 3, unlocked: false },
  { tier: 3, minProfit: 500, maxProfit: 1500, requiredSuccessRate: 0.70, requiredDays: 5, unlocked: false },
  { tier: 4, minProfit: 1500, maxProfit: 5000, requiredSuccessRate: 0.75, requiredDays: 7, unlocked: false },
  { tier: 5, minProfit: 5000, maxProfit: 15000, requiredSuccessRate: 0.80, requiredDays: 10, unlocked: false },
  { tier: 6, minProfit: 15000, maxProfit: 25000, requiredSuccessRate: 0.85, requiredDays: 14, unlocked: false },
  { tier: 7, minProfit: 25000, maxProfit: 35000, requiredSuccessRate: 0.90, requiredDays: 21, unlocked: false },
  { tier: 8, minProfit: 35000, maxProfit: 50000, requiredSuccessRate: 0.92, requiredDays: 30, unlocked: false },
];

// ============================================================================
// STAGE GOVERNOR CLASS
// ============================================================================

export class StageGovernor extends EventEmitter {
  private static instance: StageGovernor;
  
  private state: StageState;
  private config: StageConfig;
  private unpauseHistory: UnpauseRequest[] = [];
  private advisoryCycles: AdvisoryCycleResult[] = [];
  private profitLadder: ProfitLadderTier[];
  private lastAdvisoryCycle: number = 0;
  private pauseTimer: NodeJS.Timeout | null = null;
  private uncertaintyQueue: string[] = [];
  
  // Global safety flags
  private globalKillSwitch: boolean = false;
  private composerHaltAuthority: boolean = true;
  private evolutionLockEngaged: boolean = true;
  
  private constructor() {
    super();
    this.state = this.initializeState();
    this.config = STAGE_CONFIGS[1];
    this.profitLadder = [...PROFIT_LADDER];
    
    logger.info('[StageGovernor] Initialized at Stage 1 - Advisory Mode', {
      stage: this.state.currentStage,
      status: this.state.status,
      evolutionLock: this.evolutionLockEngaged,
    });
  }
  
  static getInstance(): StageGovernor {
    if (!StageGovernor.instance) {
      StageGovernor.instance = new StageGovernor();
    }
    return StageGovernor.instance;
  }
  
  private initializeState(): StageState {
    return {
      currentStage: 1,
      status: 'paused', // Start paused - requires explicit UNPAUSE
      lastPause: Date.now(),
      lastUnpause: null,
      cyclesCompleted: 0,
      profitThisStage: 0,
      anomalyCount: 0,
      emergencyLockEngaged: false,
      killSwitchArmed: true, // Kill switch always armed
    };
  }
  
  // ============================================================================
  // CORE GOVERNANCE METHODS
  // ============================================================================
  
  /**
   * Get current stage state
   */
  getState(): Readonly<StageState> {
    return { ...this.state };
  }
  
  /**
   * Get current stage configuration
   */
  getConfig(): Readonly<StageConfig> {
    return { ...this.config };
  }
  
  /**
   * Get current profit ladder status
   */
  getProfitLadder(): ProfitLadderTier[] {
    return this.profitLadder.map(t => ({ ...t }));
  }
  
  /**
   * Check if execution is allowed
   * CRITICAL: This is the main gate for any execution
   */
  canExecute(): { allowed: boolean; reason: string } {
    // Global kill switch check
    if (this.globalKillSwitch) {
      return { allowed: false, reason: 'GLOBAL KILL SWITCH ENGAGED' };
    }
    
    // Emergency lock check
    if (this.state.emergencyLockEngaged) {
      return { allowed: false, reason: 'EMERGENCY LOCK ENGAGED' };
    }
    
    // Status check
    if (this.state.status !== 'active') {
      return { allowed: false, reason: `System is ${this.state.status} - execution not allowed` };
    }
    
    // Stage 1 has NO execution authority
    if (this.state.currentStage === 1) {
      return { allowed: false, reason: 'Stage 1: Advisory only - no execution authority' };
    }
    
    // Check if there are pending uncertainties
    if (this.uncertaintyQueue.length > 0) {
      return { allowed: false, reason: `Pending uncertainties require resolution: ${this.uncertaintyQueue[0]}` };
    }
    
    return { allowed: true, reason: 'Execution permitted within current stage bounds' };
  }
  
  /**
   * Process UNPAUSE command
   * CRITICAL: This is the ONLY way to advance stages or resume operations
   */
  processUnpause(request: UnpauseRequest): { success: boolean; message: string } {
    logger.info('[StageGovernor] UNPAUSE request received', {
      stage: request.stage,
      scope: request.scope,
      authority: request.authority,
    });
    
    // Validate request
    if (request.stage > this.state.currentStage + 1) {
      return { 
        success: false, 
        message: `Cannot skip stages. Current: ${this.state.currentStage}, Requested: ${request.stage}` 
      };
    }
    
    // Check if advancement is requested
    if (request.stage > this.state.currentStage) {
      return this.attemptStageAdvancement(request);
    }
    
    // Resume current stage
    if (this.state.status === 'paused' || this.state.status === 'locked') {
      this.state.status = 'active';
      this.state.lastUnpause = Date.now();
      this.unpauseHistory.push(request);
      
      // Set duration timer if specified
      if (request.duration > 0) {
        this.setPauseTimer(request.duration);
      }
      
      this.emit('unpause', { stage: this.state.currentStage, request });
      
      logger.info('[StageGovernor] Stage UNPAUSED', {
        stage: this.state.currentStage,
        duration: request.duration,
        authority: request.authority,
      });
      
      return { 
        success: true, 
        message: `Stage ${this.state.currentStage} unpaused by ${request.authority}` 
      };
    }
    
    return { success: false, message: 'Stage is not in pausable state' };
  }
  
  /**
   * PAUSE the system
   * Can be called by anyone, always succeeds immediately
   */
  pause(reason: string, authority: string): void {
    this.state.status = 'paused';
    this.state.lastPause = Date.now();
    
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    
    this.emit('pause', { stage: this.state.currentStage, reason, authority });
    
    logger.info('[StageGovernor] System PAUSED', {
      stage: this.state.currentStage,
      reason,
      authority,
    });
  }
  
  /**
   * Engage KILL SWITCH
   * Immediately halts all operations, requires manual reset
   */
  engageKillSwitch(reason: string, authority: string): void {
    this.globalKillSwitch = true;
    this.state.status = 'emergency_locked';
    this.state.emergencyLockEngaged = true;
    
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    
    this.emit('kill_switch', { reason, authority, timestamp: Date.now() });
    
    logger.error('[StageGovernor] KILL SWITCH ENGAGED', {
      reason,
      authority,
      stage: this.state.currentStage,
    });
  }
  
  /**
   * Reset kill switch (requires explicit authorization)
   */
  resetKillSwitch(authority: string, confirmation: string): { success: boolean; message: string } {
    if (confirmation !== 'CONFIRM_KILL_SWITCH_RESET') {
      return { success: false, message: 'Invalid confirmation code' };
    }
    
    this.globalKillSwitch = false;
    this.state.emergencyLockEngaged = false;
    this.state.status = 'paused';
    
    logger.info('[StageGovernor] Kill switch reset', { authority });
    
    return { success: true, message: 'Kill switch reset. System is now paused.' };
  }
  
  /**
   * Report uncertainty - triggers ask-and-wait
   */
  reportUncertainty(uncertainty: string): void {
    this.uncertaintyQueue.push(uncertainty);
    this.pause(`Uncertainty detected: ${uncertainty}`, 'system');
    
    this.emit('uncertainty', { uncertainty, timestamp: Date.now() });
    
    logger.warn('[StageGovernor] Uncertainty reported - ask-and-wait engaged', {
      uncertainty,
      queueLength: this.uncertaintyQueue.length,
    });
  }
  
  /**
   * Resolve uncertainty (human input required)
   */
  resolveUncertainty(uncertainty: string, resolution: string, authority: string): boolean {
    const index = this.uncertaintyQueue.indexOf(uncertainty);
    if (index === -1) {
      return false;
    }
    
    this.uncertaintyQueue.splice(index, 1);
    
    logger.info('[StageGovernor] Uncertainty resolved', {
      uncertainty,
      resolution,
      authority,
      remainingUncertainties: this.uncertaintyQueue.length,
    });
    
    return true;
  }
  
  /**
   * Report anomaly - may trigger re-lock
   */
  reportAnomaly(anomaly: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.state.anomalyCount++;
    
    logger.warn('[StageGovernor] Anomaly reported', {
      anomaly,
      severity,
      totalAnomalies: this.state.anomalyCount,
    });
    
    // High/critical anomalies trigger immediate re-lock
    if (severity === 'high' || severity === 'critical') {
      this.pause(`Anomaly detected: ${anomaly}`, 'anomaly_detector');
      
      if (severity === 'critical') {
        this.engageKillSwitch(`Critical anomaly: ${anomaly}`, 'anomaly_detector');
      }
    }
    
    this.emit('anomaly', { anomaly, severity, timestamp: Date.now() });
  }
  
  // ============================================================================
  // ADVISORY CYCLE MANAGEMENT (Stage 1)
  // ============================================================================
  
  /**
   * Run an advisory cycle (Stage 1 operation)
   * Returns analysis and recommendations without execution
   */
  async runAdvisoryCycle(
    marketData: unknown,
    monteCarloResult: MonteCarloValidation
  ): Promise<AdvisoryCycleResult | null> {
    if (this.state.currentStage !== 1) {
      logger.warn('[StageGovernor] Advisory cycle only available in Stage 1');
      return null;
    }
    
    if (this.state.status !== 'active') {
      logger.warn('[StageGovernor] Cannot run advisory cycle - system not active');
      return null;
    }
    
    const cycleId = `adv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    // Generate signal analysis (placeholder - integrate with actual analysis)
    const signals: SignalAnalysis[] = this.analyzeSignals(marketData);
    
    // Discover arbitrage paths (placeholder - integrate with actual discovery)
    const arbitragePaths: ArbitragePath[] = this.discoverArbitragePaths(marketData);
    
    // Generate recommendations
    const recommendations: Recommendation[] = this.generateRecommendations(signals, arbitragePaths, monteCarloResult);
    
    // Calculate profit estimate
    const profitEstimate = arbitragePaths.reduce((sum, p) => sum + Math.max(0, p.netProfit), 0);
    
    // Risk assessment
    const riskAssessment = this.assessRisk(signals, arbitragePaths);
    
    const result: AdvisoryCycleResult = {
      cycleId,
      timestamp: Date.now(),
      signals,
      arbitragePaths,
      recommendations,
      monteCarloValidation: monteCarloResult,
      profitEstimate,
      riskAssessment,
    };
    
    // Store cycle result
    this.advisoryCycles.push(result);
    if (this.advisoryCycles.length > 100) {
      this.advisoryCycles.shift();
    }
    
    this.state.cyclesCompleted++;
    this.lastAdvisoryCycle = Date.now();
    
    // Auto-pause after each advisory cycle (Stage 1 requirement)
    if (this.config.autoPauseEnabled) {
      this.pause('Advisory cycle complete - automatic pause', 'system');
    }
    
    this.emit('advisory_cycle_complete', result);
    
    logger.info('[StageGovernor] Advisory cycle complete', {
      cycleId,
      signals: signals.length,
      arbitragePaths: arbitragePaths.length,
      profitEstimate,
      riskLevel: riskAssessment.overallRisk,
    });
    
    return result;
  }
  
  /**
   * Get advisory cycle history
   */
  getAdvisoryCycles(limit: number = 10): AdvisoryCycleResult[] {
    return this.advisoryCycles.slice(-limit);
  }
  
  // ============================================================================
  // STAGE ADVANCEMENT
  // ============================================================================
  
  private attemptStageAdvancement(request: UnpauseRequest): { success: boolean; message: string } {
    const targetStage = request.stage as StageNumber;
    const currentConfig = this.config;
    
    // Check all requirements
    const unmetRequirements = currentConfig.requirements.filter(r => !r.met);
    if (unmetRequirements.length > 0) {
      const details = unmetRequirements.map(r => r.description).join(', ');
      return { 
        success: false, 
        message: `Cannot advance to Stage ${targetStage}. Unmet requirements: ${details}` 
      };
    }
    
    // Advance stage
    this.state.currentStage = targetStage;
    this.config = STAGE_CONFIGS[targetStage];
    this.state.status = 'active';
    this.state.lastUnpause = Date.now();
    this.state.profitThisStage = 0;
    this.state.cyclesCompleted = 0;
    this.state.anomalyCount = 0;
    
    this.unpauseHistory.push(request);
    
    this.emit('stage_advance', { 
      from: targetStage - 1, 
      to: targetStage, 
      authority: request.authority 
    });
    
    logger.info('[StageGovernor] Stage ADVANCED', {
      from: targetStage - 1,
      to: targetStage,
      authority: request.authority,
      mode: this.config.mode,
    });
    
    return { 
      success: true, 
      message: `Advanced to Stage ${targetStage}: ${this.config.name}` 
    };
  }
  
  /**
   * Mark a requirement as met
   */
  markRequirementMet(type: StageRequirement['type'], value: number): void {
    const requirement = this.config.requirements.find(r => r.type === type);
    if (requirement) {
      requirement.currentValue = value;
      requirement.met = value >= requirement.threshold || (type === 'no_anomalies' && value === 0);
      
      logger.info('[StageGovernor] Requirement updated', {
        stage: this.state.currentStage,
        type,
        value,
        threshold: requirement.threshold,
        met: requirement.met,
      });
    }
  }
  
  /**
   * Check if all requirements for current stage are met
   */
  checkAdvancementReady(): { ready: boolean; unmetRequirements: string[] } {
    const unmet = this.config.requirements
      .filter(r => !r.met)
      .map(r => r.description);
    
    return {
      ready: unmet.length === 0,
      unmetRequirements: unmet,
    };
  }
  
  // ============================================================================
  // PROFIT TRACKING
  // ============================================================================
  
  /**
   * Record profit and update ladder
   */
  recordProfit(amount: number): { 
    recorded: boolean; 
    dailyTotal: number; 
    withinLimits: boolean;
    currentTier: number;
  } {
    this.state.profitThisStage += amount;
    
    // Check against daily limits
    const withinLimits = this.state.profitThisStage <= this.config.maxDailyProfit;
    
    if (!withinLimits) {
      this.pause('Daily profit limit reached', 'profit_monitor');
    }
    
    // Update profit ladder
    this.updateProfitLadder(amount);
    
    // Find current tier
    const currentTier = this.profitLadder.findIndex(t => 
      this.state.profitThisStage >= t.minProfit && 
      this.state.profitThisStage <= t.maxProfit
    );
    
    this.emit('profit_recorded', { 
      amount, 
      dailyTotal: this.state.profitThisStage,
      withinLimits,
      currentTier: currentTier + 1,
    });
    
    return {
      recorded: true,
      dailyTotal: this.state.profitThisStage,
      withinLimits,
      currentTier: currentTier + 1,
    };
  }
  
  private updateProfitLadder(dailyProfit: number): void {
    // Unlock next tier if current tier requirements met
    for (let i = 0; i < this.profitLadder.length - 1; i++) {
      const tier = this.profitLadder[i];
      const nextTier = this.profitLadder[i + 1];
      
      if (tier.unlocked && !nextTier.unlocked) {
        // Check if we can unlock next tier
        // (simplified - in production, track success rate and days)
        if (dailyProfit >= tier.maxProfit) {
          nextTier.unlocked = true;
          
          this.emit('tier_unlocked', { tier: i + 2, maxProfit: nextTier.maxProfit });
          
          logger.info('[StageGovernor] Profit tier unlocked', {
            tier: i + 2,
            maxProfit: nextTier.maxProfit,
          });
        }
        break;
      }
    }
  }
  
  /**
   * Reset daily profit (call at day boundary)
   */
  resetDailyProfit(): void {
    logger.info('[StageGovernor] Daily profit reset', {
      previousTotal: this.state.profitThisStage,
    });
    
    this.state.profitThisStage = 0;
  }
  
  // ============================================================================
  // HELPER METHODS
  // ============================================================================
  
  private setPauseTimer(duration: number): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
    }
    
    this.pauseTimer = setTimeout(() => {
      this.pause('Duration limit reached', 'timer');
    }, duration);
  }
  
  private analyzeSignals(_marketData: unknown): SignalAnalysis[] {
    // Placeholder - integrate with actual signal analysis
    return [];
  }
  
  private discoverArbitragePaths(_marketData: unknown): ArbitragePath[] {
    // Placeholder - integrate with actual arbitrage discovery
    return [];
  }
  
  private generateRecommendations(
    _signals: SignalAnalysis[],
    paths: ArbitragePath[],
    _monteCarlo: MonteCarloValidation
  ): Recommendation[] {
    return paths.map(path => ({
      action: path.netProfit > 0 ? 'execute' : 'skip',
      target: `${path.pair} on ${path.buyExchange}→${path.sellExchange}`,
      reasoning: path.netProfit > 0 
        ? `Positive expected profit: $${path.netProfit.toFixed(2)}`
        : `Negative expected profit: $${path.netProfit.toFixed(2)}`,
      confidence: path.feasibility,
      humanApprovalRequired: this.state.currentStage <= 2, // Stages 1-2 require human approval
    }));
  }
  
  private assessRisk(
    signals: SignalAnalysis[],
    paths: ArbitragePath[]
  ): RiskAssessment {
    const factors: RiskFactor[] = [];
    
    // Market volatility risk
    const bearishSignals = signals.filter(s => s.signal === 'bearish').length;
    if (bearishSignals > signals.length * 0.5) {
      factors.push({
        factor: 'Market Direction',
        severity: 6,
        description: 'Majority bearish signals detected',
      });
    }
    
    // Execution risk
    const highSlippagePaths = paths.filter(p => p.slippage > 0.02).length;
    if (highSlippagePaths > 0) {
      factors.push({
        factor: 'Slippage Risk',
        severity: 5,
        description: `${highSlippagePaths} paths have >2% slippage`,
      });
    }
    
    // Latency risk
    const highLatencyPaths = paths.filter(p => p.latency > 500).length;
    if (highLatencyPaths > 0) {
      factors.push({
        factor: 'Latency Risk',
        severity: 4,
        description: `${highLatencyPaths} paths have >500ms latency`,
      });
    }
    
    // Calculate overall risk
    const avgSeverity = factors.length > 0
      ? factors.reduce((sum, f) => sum + f.severity, 0) / factors.length
      : 0;
    
    let overallRisk: RiskAssessment['overallRisk'];
    if (avgSeverity >= 8) overallRisk = 'critical';
    else if (avgSeverity >= 6) overallRisk = 'high';
    else if (avgSeverity >= 4) overallRisk = 'medium';
    else overallRisk = 'low';
    
    return {
      overallRisk,
      factors,
      mitigations: this.generateMitigations(factors),
    };
  }
  
  private generateMitigations(factors: RiskFactor[]): string[] {
    const mitigations: string[] = [];
    
    for (const factor of factors) {
      switch (factor.factor) {
        case 'Market Direction':
          mitigations.push('Reduce position sizes during bearish market');
          break;
        case 'Slippage Risk':
          mitigations.push('Use limit orders or reduce order sizes');
          break;
        case 'Latency Risk':
          mitigations.push('Prioritize lower-latency exchanges');
          break;
      }
    }
    
    return mitigations;
  }
  
  // ============================================================================
  // STATUS & REPORTING
  // ============================================================================
  
  /**
   * Get comprehensive system status
   */
  getSystemStatus(): {
    state: StageState;
    config: StageConfig;
    canExecute: { allowed: boolean; reason: string };
    advancementStatus: { ready: boolean; unmetRequirements: string[] };
    profitLadder: ProfitLadderTier[];
    uncertainties: string[];
    evolutionLock: boolean;
    killSwitchArmed: boolean;
  } {
    return {
      state: this.getState(),
      config: this.getConfig(),
      canExecute: this.canExecute(),
      advancementStatus: this.checkAdvancementReady(),
      profitLadder: this.getProfitLadder(),
      uncertainties: [...this.uncertaintyQueue],
      evolutionLock: this.evolutionLockEngaged,
      killSwitchArmed: this.state.killSwitchArmed,
    };
  }
}

// Export class for lazy initialization
export { StageGovernor };

// Lazy getter - only initializes on first call
export function getStageGovernor(): StageGovernor {
  return StageGovernor.getInstance();
}
