/**
 * GOVERNANCE SYSTEM - Main Export
 * 
 * 6-Stage Controlled Deployment System for Cryptocrawler
 * 
 * Exports all governance components:
 * - Stage Management
 * - Risk Governor
 * - Kill-Switch
 * - Composer Interface
 * - Profit Ladder
 */

export * from './stage-management';
export * from './risk-governor';
export * from './kill-switch';
export * from './composer-interface';
export * from './profit-ladder';
export * from './governance';
export {
  getStageGovernor,
  PROFIT_LADDER,
  StageGovernor,
  type AdvisoryCycleResult,
  type ArbitragePath,
  type MonteCarloValidation,
  type ProfitLadderTier,
  type Recommendation,
  type RiskFactor,
  type SignalAnalysis,
  type StageNumber,
  type StageRequirement,
  type StageStatus,
  type SystemMode,
  type UnpauseRequest,
  type StageConfig as AutonomyStageConfig,
  type StageState as AutonomyStageState,
  type RiskAssessment as AutonomyRiskAssessment,
  STAGE_CONFIGS as AUTONOMY_STAGE_CONFIGS,
} from './stage-governor';

  
import { stageManager } from './stage-management';
import { PostgresStageManagerStateStore } from './stage-state-store.js';
import { riskGovernor } from './risk-governor';
import { killSwitch } from './kill-switch';
import { composer } from './composer-interface';
import { profitLadder } from './profit-ladder';

/**
 * Initialize governance system
 */
let governanceInitialization: Promise<void> | null = null;

export function initializeGovernance(): Promise<void> {
  if (governanceInitialization) return governanceInitialization;
  governanceInitialization = initializeGovernanceState();
  return governanceInitialization;
}

async function initializeGovernanceState(): Promise<void> {
  console.log('[GOVERNANCE] Initializing 6-Stage Deployment System...');

  const restored = await stageManager.restorePersistence(new PostgresStageManagerStateStore());
  const persistedProfitLadder = stageManager.getProfitLadderState();
  if (persistedProfitLadder) {
    profitLadder.importState(persistedProfitLadder);
  }
  const { balanceMonitor } = await import('../bridge/balance-monitor.js');
  const verifiedCapital = await balanceMonitor.getVerifiedPortfolioValue();
  if (verifiedCapital.status === 'verified') {
    profitLadder.setVerifiedCapital(verifiedCapital.totalUsd);
  } else {
    profitLadder.markCapitalUnavailable();
  }
  const { getCryptara } = await import('../../cryptara/index.js');
  getCryptara().restoreExecutionHistory(stageManager.getCryptaraExecutionEvidence());
  
  const currentStage = stageManager.getCurrentStage();
  const stageConfig = stageManager.getStageConfig();
  const systemStatus = composer.getSystemStatus();
  
  console.log('[GOVERNANCE] System Status:');
  console.log(`  Stage: ${stageConfig.stageName}`);
  console.log(`  Paused: ${systemStatus.isPaused}`);
  console.log(`  Kill-Switch Armed: ${systemStatus.killSwitchArmed}`);
  console.log(`  Profit Tier: ${profitLadder.getCurrentTier().name}`);
  console.log(`  Persisted State: ${restored ? 'restored' : 'initialized'}`);
  console.log('[GOVERNANCE] ✅ Governance system initialized');
}

/**
 * Get unified governance state
 */
export function getGovernanceState() {
  return {
    stage: stageManager.getState(),
    risk: riskGovernor.exportState(),
    killSwitch: killSwitch.exportState(),
    composer: composer.exportState(),
    profitLadder: profitLadder.exportState(),
    timestamp: Date.now(),
  };
}

// Export singleton instances
export {
  stageManager,
  riskGovernor,
  killSwitch,
  composer,
  profitLadder,
};
