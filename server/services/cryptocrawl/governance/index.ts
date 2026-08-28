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
import { GovernanceError } from './types.js';

/**
 * Dedicated bootstrap/recovery authority. This never grants ordinary trading
 * permission. It exists only while verified native-gas readiness is below the
 * configured threshold and is valid at any governance stage so a later gas
 * depletion can recover through the same source-funded path.
 */
export function requireBootstrapRecoveryAllowed(context: { chain: string; pair: string; venue: string }): void {
  const state = stageManager.getState();
  const config = stageManager.getStageConfig();
  if (state.isPaused) {
    throw new GovernanceError('PAUSED', 'Bootstrap recovery is paused', { reason: state.pauseReason });
  }
  if (state.killSwitchActive) {
    throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Bootstrap recovery is blocked by the kill-switch');
  }
  if (!config.killSwitchArmed) {
    throw new GovernanceError('KILL_SWITCH_NOT_ARMED', 'Bootstrap recovery requires the canonical kill-switch to be armed');
  }
  if (state.initialGasReady) {
    throw new GovernanceError('CONSTRAINT_VIOLATION', 'Bootstrap recovery is disabled after initial gas readiness', { stage: state.currentStage });
  }
  if (context.pair !== 'NATIVE_GAS_SETTLEMENT' || context.venue !== 'bridge_refuel' || !context.chain || context.chain === 'europa') {
    throw new GovernanceError('CONSTRAINT_VIOLATION', 'Bootstrap recovery context is outside the dedicated source-funded bridge/refuel boundary', { context });
  }
}

/**
 * Initialize governance system
 */
let governanceInitialization: Promise<void> | null = null;

export function initializeGovernance(): Promise<void> {
  if (governanceInitialization) return governanceInitialization;
  governanceInitialization = initializeGovernanceState().catch(error => {
    governanceInitialization = null;
    throw error;
  });
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

  // StageManager persistence is the authoritative restart anchor for terminal
  // learning. Rebuild only the background transport after restoration; outbox
  // failure must never block governance initialization or canonical execution.
  try {
    const { durableIntelligenceOutbox } = await import('../intelligence/durable-intelligence-outbox.js');
    await durableIntelligenceOutbox.reconcilePersistedTerminalEvidence(stageManager.getCryptaraExecutionEvidence());
    durableIntelligenceOutbox.start();
  } catch (error) {
    console.warn('[GOVERNANCE] Durable intelligence outbox unavailable; terminal evidence remains recoverable from StageManager persistence:',
      error instanceof Error ? error.message : String(error));
  }
  
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
