/**
 * CryptoCrawler Governance Module
 * 
 * Central export for all governance components:
 * - Profit Ramp Governor (Stage 6 - Daily cap ladder)
 * - Composer (Canonical authority)
 * - Stage Controller (PASS/FAIL state management)
 * - Execution Gate (Final choke-point)
 * - Background Loop Governor (Timer/scheduler control)
 */

// Profit Ramp (Stage 6)
export {
  ProfitRampGovernor,
  profitRamp,
  TIER_DEFINITIONS,
  type RampTier,
  type TierDefinition,
  type TierPrerequisites,
  type RampPolicy,
  type RampStatus,
  type MonteCarloJustification,
  type CycleResult,
  type AnomalyEvent
} from './profit-ramp';

// Composer (Canonical Authority)
export {
  Composer,
  composer,
  STAGE_DEFINITIONS,
  type StageNumber,
  type CommandType,
  type ComposerCommand,
  type CommandResult,
  type SystemState,
  type SystemScope,
  type ExecutionMode,
  type StageDefinition
} from './composer';

// Stage Controller
export {
  StageController,
  stageController,
  type StageStatus,
  type StageValidation,
  type ValidationResult,
  type PrerequisiteCheck,
  type StageTransition
} from './stage-controller';

// Execution Gate
export {
  ExecutionGate,
  executionGate,
  type GateDecision,
  type ExecutionRequest,
  type GateResponse,
  type GateConstraints,
  type SimulatedExecution,
  type GateStatistics
} from './execution-gate';

// Background Loop Governor
export {
  BackgroundLoopGovernor,
  loopGovernor,
  type LoopType,
  type LoopStatus,
  type RegisteredLoop,
  type LoopRegistrationOptions,
  type GovernorStatistics
} from './background-loop-governor';

// UI Sanity Check (Stage 7)
export {
  UISanityCheck,
  uiSanityCheck,
  type UICheckStatus,
  type UICheckResult,
  type UIValidationReport,
  type ColorProfile
} from './ui-sanity-check';

// Final Dry Run (Stage 8)
export {
  FinalDryRun,
  finalDryRun,
  type DryRunPhase,
  type DryRunResult,
  type DryRunState,
  type PhaseResult,
  type DryRunReport,
  type DryRunConfig
} from './final-dry-run';

/**
 * Initialize all governance systems
 */
export function initializeGovernance(): {
  profitRamp: typeof profitRamp;
  composer: typeof composer;
  stageController: typeof stageController;
  executionGate: typeof executionGate;
  loopGovernor: typeof loopGovernor;
  uiSanityCheck: typeof uiSanityCheck;
  finalDryRun: typeof finalDryRun;
} {
  // All singletons are initialized on import
  // This function provides a convenient way to access them all
  
  return {
    profitRamp,
    composer,
    stageController,
    executionGate,
    loopGovernor,
    uiSanityCheck,
    finalDryRun
  };
}

/**
 * Generate comprehensive governance status report
 */
export function generateFullGovernanceReport(): string {
  let report = '\n';
  report += '╔══════════════════════════════════════════════════════════════════════════╗\n';
  report += '║              CRYPTOCRAWLER GOVERNANCE SYSTEM STATUS                      ║\n';
  report += '║                          (HARD-LOCKED)                                   ║\n';
  report += '╚══════════════════════════════════════════════════════════════════════════╝\n';
  
  report += composer.generateStatusReport();
  report += stageController.generateStatusReport();
  report += profitRamp.generatePolicyTable();
  report += executionGate.generateStatusReport();
  report += loopGovernor.generateStatusReport();
  report += uiSanityCheck.generateUIConfirmation();
  
  // Add dry run output if available
  const latestRun = finalDryRun.getLatestRun();
  if (latestRun) {
    report += finalDryRun.generateOutput();
  }
  
  return report;
}
