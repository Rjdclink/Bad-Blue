/**
 * STAGES MODULE - Stage 6-8 Implementation Scripts
 * 
 * This module provides the implementation scripts for:
 * - Stage 6: Profit Ramp Logic
 * - Stage 7: Visual/UI Sanity Check
 * - Stage 8: Final Dry Run
 */

export { executeStage6, validateRampPolicy } from './stage-6-profit-ramp';
export { executeStage7, generateUIConfirmation } from './stage-7-ui-check';
export { executeStage8 } from './stage-8-dry-run';

/**
 * Execute all stages in sequence
 */
export async function executeAllStages(): Promise<boolean> {
  console.log('\n🚀 EXECUTING STAGES 6-8...\n');

  const { executeStage6 } = await import('./stage-6-profit-ramp');
  const { executeStage7 } = await import('./stage-7-ui-check');
  const { executeStage8 } = await import('./stage-8-dry-run');

  // Stage 6
  const stage6Result = await executeStage6();
  if (!stage6Result.success) {
    console.error('❌ Stage 6 failed, stopping execution');
    return false;
  }

  // Stage 7
  const stage7Result = await executeStage7();
  if (!stage7Result.success) {
    console.error('❌ Stage 7 failed, stopping execution');
    return false;
  }

  // Stage 8
  const stage8Result = await executeStage8();
  if (!stage8Result.success) {
    console.error('❌ Stage 8 failed, stopping execution');
    return false;
  }

  console.log('\n✅ ALL STAGES COMPLETE - SYSTEM READY FOR LIVE EXECUTION');
  return true;
}
