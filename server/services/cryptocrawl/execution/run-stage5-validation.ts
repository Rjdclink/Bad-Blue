/**
 * Run Stage 5 Validation Script
 * 
 * Execute: tsx server/services/cryptocrawl/execution/run-stage5-validation.ts
 */

import { runStage5Validation } from './stage5-validation';
import { createLogger } from '../../../logger';

const log = createLogger('Stage5ValidationRunner');

async function main() {
  log.info('='.repeat(80));
  log.info('STAGE 5 VALIDATION RUNNER');
  log.info('Scope: Single exchange, single pair, micro/dust level');
  log.info('Purpose: Connectivity + execution validation');
  log.info('Post condition: Auto-pause immediately after fill or failure');
  log.info('='.repeat(80));

  try {
    const result = await runStage5Validation();

    log.info('='.repeat(80));
    log.info('VALIDATION RESULT');
    log.info('='.repeat(80));
    log.info('Success:', result.success);
    log.info('Timestamp:', result.timestamp.toISOString());
    log.info('Config:', result.config);
    log.info('Connectivity:', result.connectivity);
    
    if (result.decisionResult) {
      log.info('Decision Result:', {
        verdict: result.decisionResult.verdict,
        decisionId: result.decisionResult.decisionId,
        gates: {
          signalFusion: result.decisionResult.gates.signalFusion.passed,
          monteCarloStress: result.decisionResult.gates.monteCarloStress.passed,
          riskGovernor: result.decisionResult.gates.riskGovernor.passed,
        },
      });
    }

    if (result.executionResult) {
      log.info('Execution Result:', result.executionResult);
    }

    if (result.errors.length > 0) {
      log.error('Errors:', result.errors);
    }

    if (result.warnings.length > 0) {
      log.warn('Warnings:', result.warnings);
    }

    log.info('='.repeat(80));
    log.info('AUTO-PAUSING: Validation complete - pausing immediately');
    log.info('='.repeat(80));

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    log.error('Validation runner failed', { error });
    process.exit(1);
  }
}

main();
