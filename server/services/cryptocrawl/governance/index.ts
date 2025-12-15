/**
 * GOVERNANCE MODULE - Control & Oversight for CryptoCrawler
 * 
 * This module provides the governance layer that enforces:
 * - Stage progression and enforcement
 * - Capital exposure limits (profit ramp)
 * - Execution gating and mode control
 * - System-wide locks and pauses
 * 
 * HIERARCHY:
 * 1. Composer - Issues commands
 * 2. Stage Controller - Enforces stage progression
 * 3. Profit Ramp Governor - Enforces capital limits
 * 4. Execution Gate - Final execution approval
 */

// Composer - Canonical Authority
export {
  Composer,
  composer,
  SystemScope,
  LockType,
  type Lock,
  type StageCommand,
  type ComposerState,
} from './composer';

// Stage Controller
export {
  StageController,
  stageController,
  StageStatus,
  type StageDefinition,
  type StageState,
} from './stage-controller';

// Profit Ramp Governor
export {
  ProfitRampGovernor,
  profitRampGovernor,
  type RampTier,
  type TierStatus,
  type RampMetrics,
} from './profit-ramp-governor';

// Execution Gate
export {
  ExecutionGate,
  executionGate,
  ExecutionMode,
  type OrderIntent,
  type ExecutionResult,
  type GateMetrics,
} from './execution-gate';

/**
 * Initialize all governance components
 */
export async function initializeGovernance(): Promise<void> {
  console.log('[Governance] 🏛️ Initializing Governance Layer...');
  
  const { composer } = await import('./composer');
  const { stageController } = await import('./stage-controller');
  const { profitRampGovernor } = await import('./profit-ramp-governor');
  const { executionGate } = await import('./execution-gate');
  
  await composer.initialize();
  await stageController.initialize();
  await profitRampGovernor.initialize();
  await executionGate.initialize();
  
  console.log('[Governance] ✅ All governance components initialized');
}

/**
 * Get governance status
 */
export function getGovernanceStatus() {
  const { composer } = require('./composer');
  const { stageController } = require('./stage-controller');
  const { profitRampGovernor } = require('./profit-ramp-governor');
  const { executionGate } = require('./execution-gate');
  
  return {
    composer: composer.getState(),
    stage: stageController.getProgressSummary(),
    ramp: profitRampGovernor.getCurrentTier(),
    gate: executionGate.getStatus(),
  };
}
