/**
 * Compatibility facade for historic StageGovernor callers.
 * StageManager is the sole mutable governance authority.
 */
import { EventEmitter } from 'events';
import { Stage as ManagedStage, STAGE_CONFIGS as MANAGED_STAGE_CONFIGS, stageManager } from './stage-management.js';

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type StageStatus = 'locked' | 'paused' | 'active' | 'completed' | 'emergency_locked';
export type SystemMode = 'advisory' | 'proof_based' | 'dry_run' | 'limited_autonomy' | 'supervised' | 'conditional';

export interface StageRequirement {
  type: 'monte_carlo_consensus' | 'profit_metric' | 'success_rate' | 'human_approval' | 'duration' | 'no_anomalies';
  description: string;
  threshold: number;
  currentValue?: number;
  met: boolean;
}

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
  duration: number;
  authority: string;
  timestamp: number;
  signature?: string;
}

export interface AdvisoryCycleResult { cycleId: string; timestamp: number; }
export interface SignalAnalysis { pair: string; exchange: string; signal: 'bullish' | 'bearish' | 'neutral'; confidence: number; reasoning: string[]; }
export interface ArbitragePath { id: string; buyExchange: string; sellExchange: string; pair: string; expectedProfit: number; fees: number; slippage: number; latency: number; netProfit: number; feasibility: number; }
export interface Recommendation { action: 'execute' | 'skip' | 'wait' | 'investigate'; target: string; reasoning: string; confidence: number; humanApprovalRequired: boolean; }
export interface MonteCarloValidation { simulations: number; expectedProfit: number; confidenceInterval: [number, number]; winRate: number; maxDrawdown: number; sharpeRatio: number; approval: 'approved' | 'conditional' | 'rejected'; conditions?: string[]; }
export interface RiskFactor { factor: string; severity: number; description: string; }
export interface RiskAssessment { overallRisk: 'low' | 'medium' | 'high' | 'critical'; factors: RiskFactor[]; mitigations: string[]; }

export interface ProfitLadderTier {
  tier: number;
  minProfit: number;
  maxProfit: number;
  requiredSuccessRate: number;
  requiredDays: number;
  unlocked: boolean;
}

const MODE_BY_STAGE: Record<StageNumber, SystemMode> = {
  1: 'advisory', 2: 'proof_based', 3: 'dry_run', 4: 'limited_autonomy', 5: 'supervised', 6: 'conditional',
};
const AUTHORITY_BY_STAGE: Record<StageNumber, StageConfig['executionAuthority']> = {
  1: 'none', 2: 'limited', 3: 'limited', 4: 'conditional', 5: 'supervised', 6: 'autonomous',
};

export const PROFIT_LADDER: ProfitLadderTier[] = [
  { tier: 1, minProfit: 0, maxProfit: 200, requiredSuccessRate: 0.6, requiredDays: 1, unlocked: true },
  { tier: 2, minProfit: 200, maxProfit: 500, requiredSuccessRate: 0.65, requiredDays: 3, unlocked: false },
  { tier: 3, minProfit: 500, maxProfit: 1500, requiredSuccessRate: 0.7, requiredDays: 5, unlocked: false },
  { tier: 4, minProfit: 1500, maxProfit: 5000, requiredSuccessRate: 0.75, requiredDays: 7, unlocked: false },
  { tier: 5, minProfit: 5000, maxProfit: 15000, requiredSuccessRate: 0.8, requiredDays: 10, unlocked: false },
  { tier: 6, minProfit: 15000, maxProfit: 25000, requiredSuccessRate: 0.85, requiredDays: 14, unlocked: false },
];

function toCompatibilityConfig(stage: StageNumber): StageConfig {
  const config = MANAGED_STAGE_CONFIGS[stage as ManagedStage];
  return {
    stage,
    name: config.stageName,
    description: config.description,
    mode: MODE_BY_STAGE[stage],
    dailyProfitTarget: config.minDailyProfit,
    maxDailyProfit: config.maxDailyProfit,
    executionAuthority: AUTHORITY_BY_STAGE[stage],
    evolutionLock: config.evolutionLocked,
    memoryPartitioned: config.memoryPartitioned,
    autoPauseEnabled: config.automaticPauseAfterCycle,
    requirements: [],
  };
}

export const STAGE_CONFIGS = Object.fromEntries(
  ([1, 2, 3, 4, 5, 6] as StageNumber[]).map(stage => [stage, toCompatibilityConfig(stage)]),
) as Record<StageNumber, StageConfig>;

export class StageGovernor extends EventEmitter {
  private static instance: StageGovernor;

  private constructor() {
    super();
    for (const event of ['paused', 'unpaused', 'stage-advanced', 'anomaly-detected', 'kill-switch-engaged']) {
      stageManager.on(event, (data) => this.emit(event, data));
    }
  }

  static getInstance(): StageGovernor {
    if (!StageGovernor.instance) StageGovernor.instance = new StageGovernor();
    return StageGovernor.instance;
  }

  getState(): Readonly<StageState> {
    const state = stageManager.getState();
    return {
      currentStage: state.currentStage as StageNumber,
      status: state.killSwitchActive ? 'emergency_locked' : state.isPaused ? 'paused' : 'active',
      lastPause: state.lastCycleEndTime || null,
      lastUnpause: state.lastUnpauseTimestamp || null,
      cyclesCompleted: state.cycleCount,
      profitThisStage: state.dailyProfitUSD,
      anomalyCount: state.anomalyCount,
      emergencyLockEngaged: state.killSwitchActive,
      killSwitchArmed: stageManager.getStageConfig().killSwitchArmed,
    };
  }

  getConfig(): Readonly<StageConfig> {
    return toCompatibilityConfig(stageManager.getCurrentStage() as StageNumber);
  }

  canExecute(): { allowed: boolean; reason: string } {
    const state = stageManager.getState();
    const gate = stageManager.canProceed();
    if (!gate.allowed) return { allowed: false, reason: gate.reason || 'Governance denied execution' };
    if (state.currentStage === ManagedStage.STAGE_1_CONSTRAINED_PILOT) {
      return { allowed: false, reason: 'Stage 1: Advisory only - no execution authority' };
    }
    if (!stageManager.canExecuteTrades()) return { allowed: false, reason: 'Execution is not authorized for the current stage' };
    return { allowed: true, reason: 'Execution permitted within current stage bounds' };
  }

  processUnpause(request: UnpauseRequest): Promise<{ success: boolean; message: string }> {
    const currentStage = stageManager.getCurrentStage() as StageNumber;
    if (request.stage === currentStage) {
      return stageManager.requestUnpause(request.authority, request.scope.join(','), request.duration);
    }
    if (request.stage === currentStage + 1) {
      return stageManager.requestStageAdvancement(request.authority, request.stage as ManagedStage);
    }
    return Promise.resolve({ success: false, message: `Cannot skip stages. Current: ${currentStage}, Requested: ${request.stage}` });
  }

  pause(reason: string, _authority: string): void { stageManager.pause(reason); }
  engageKillSwitch(reason: string, _authority: string): void { stageManager.engageKillSwitch(reason); }
  resetKillSwitch(_authority: string, confirmation: string) { return stageManager.resetKillSwitch(confirmation); }
  reportUncertainty(uncertainty: string): void { stageManager.reportUncertainty(uncertainty); }
  resolveUncertainty(uncertainty: string, _resolution: string, _authority: string): boolean { return stageManager.resolveUncertainty(uncertainty); }
  reportAnomaly(anomaly: string, severity: 'low' | 'medium' | 'high' | 'critical'): void { stageManager.reportAnomaly(anomaly, severity); }

  markRequirementMet(type: StageRequirement['type'], value: number): void {
    if (type === 'monte_carlo_consensus') stageManager.updateProofMetrics({ monteCarloPassRate: value });
  }

  checkAdvancementReady(): { ready: boolean; unmetRequirements: string[] } {
    const ready = stageManager.getState().proofMetrics.meetsAdvancementCriteria;
    return { ready, unmetRequirements: ready ? [] : ['Canonical StageManager proof criteria are not yet satisfied'] };
  }

  getProfitLadder(): ProfitLadderTier[] {
    const profit = stageManager.getCurrentDailyProfit();
    return PROFIT_LADDER.map(tier => ({ ...tier, unlocked: profit >= tier.minProfit }));
  }

  getAdvisoryCycles(_limit: number = 10): AdvisoryCycleResult[] { return []; }

  recordProfit(amount: number): { recorded: boolean; dailyTotal: number; withinLimits: boolean; currentTier: number } {
    stageManager.recordTrade(amount);
    const dailyTotal = stageManager.getCurrentDailyProfit();
    const config = stageManager.getStageConfig();
    let currentTier = 0;
    for (const tier of this.getProfitLadder()) {
      if (tier.unlocked) currentTier = tier.tier;
    }
    return { recorded: true, dailyTotal, withinLimits: dailyTotal <= config.maxDailyProfit, currentTier };
  }
}

export function getStageGovernor(): StageGovernor {
  return StageGovernor.getInstance();
}