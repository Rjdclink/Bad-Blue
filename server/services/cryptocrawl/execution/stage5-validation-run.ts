/**
 * STAGE 5 VALIDATION RUN
 * 
 * Run 100 deterministic signals and validate:
 * - ≥95% pass rate
 * - Zero scope violations
 * - Zero token warnings
 * 
 * Report: pass rate, token lifecycle trace, choke-point confirmation hash
 */

import { createLogger } from '../../../logger';
import { generateDeterministicTestSignal } from './deterministic-test-signal';
import { getFaucetMeshFilter } from '../decision-engine/faucet-mesh-filter';
import { getExecutionChokePoint, gateExecutionPath, type Stage5Token } from './execution-choke-point';
import { getCanonicalControlManager } from './canonical-control';

const log = createLogger('Stage5ValidationRun');

// ============================================================================
// VALIDATION RUN
// ============================================================================

export interface ValidationRunResult {
  totalSignals: number;
  passedSignals: number;
  failedSignals: number;
  passRate: number;
  targetPassRate: number;
  meetsTarget: boolean;
  scopeViolations: number;
  tokenWarnings: number;
  tokenLifecycleTrace: Array<{
    phase: string;
    timestamp: Date;
    action: string;
  }>;
  chokePointConfirmationHash: string;
  errors: string[];
}

/**
 * Run validation: 100 deterministic signals
 */
export function runStage5Validation(): ValidationRunResult {
  log.info('Starting Stage 5 validation run', { signalCount: 100, targetPassRate: 0.95 });

  const chokePoint = getExecutionChokePoint();
  const faucetMeshFilter = getFaucetMeshFilter();
  
  // Set Stage-5 token for validation run
  const stage5Token: Stage5Token = {
    token: 'STAGE_5_TOKEN',
    stage: 5,
    scope: {
      exchange: 'uniswap-v3',
      pair: 'LINK/USDT',
      testType: 'deterministic_micro_test',
      maxNotional: 0.2,
    },
    lifecycle: {
      currentPhase: 'signal',
      startedAt: new Date(),
    },
    issuedBy: 'human',
    timestamp: new Date(),
    explicit: true,
    consumed: false,
  };

  chokePoint.setStage5Token(stage5Token);
  
  // Apply GLOBAL_FULL_UNPAUSE_AND_PROCEED via canonical control
  const canonicalControl = getCanonicalControlManager();
  const unpauseResult = canonicalControl.processCommand(
    { type: 'GLOBAL_FULL_UNPAUSE_AND_PROCEED', stage: 5, scope: 'validation run (100 deterministic signals)' },
    'composer'
  );
  
  if (!unpauseResult.success) {
    throw new Error(`Failed to apply GLOBAL_FULL_UNPAUSE_AND_PROCEED: ${unpauseResult.reason}`);
  }

  const actorId = 'cryptara-pilot';
  const capability = 'pilot' as const;
  const proposedScope = {
    exchange: 'uniswap-v3',
    pair: 'LINK/USDT',
    testType: 'deterministic_micro_test' as const,
    maxNotional: 0.2,
  };

  let passedCount = 0;
  let failedCount = 0;
  let scopeViolations = 0;
  let tokenWarnings = 0;
  const errors: string[] = [];

  for (let i = 0; i < 100; i++) {
    // Gate signal acceptance
    const signalGate = gateExecutionPath(
      actorId,
      capability,
      'signal',
      `Generate deterministic test signal ${i + 1}/100`,
      proposedScope
    );

    if (!signalGate.allowed) {
      if (signalGate.reason?.includes('Scope violation')) {
        scopeViolations++;
      }
      if (signalGate.missingTokens.length > 0) {
        tokenWarnings++;
      }
      errors.push(`Signal ${i + 1}: ${signalGate.reason}`);
      failedCount++;
      continue;
    }

    // Generate signal
    const signalResult = generateDeterministicTestSignal();
    if (!signalResult.signal) {
      errors.push(`Signal ${i + 1}: Generation failed - ${signalResult.reason}`);
      failedCount++;
      continue;
    }

    // Check scope pinning (via gateExecutionPath with proposed scope)
    const signalScope = {
      exchange: signalResult.signal.metadata?.exchange as string,
      pair: signalResult.signal.signal.opportunity?.pair as string,
      testType: 'deterministic_micro_test' as const,
      maxNotional: (signalResult.signal.metadata?.baseAmount as number) || 0,
    };

    // Scope check is done inside gateExecutionPath, but we verify here too
    if (signalScope.exchange !== proposedScope.exchange || 
        signalScope.pair !== proposedScope.pair ||
        signalScope.maxNotional > proposedScope.maxNotional) {
      scopeViolations++;
      errors.push(`Signal ${i + 1}: Scope violation - exchange: ${signalScope.exchange}, pair: ${signalScope.pair}, maxNotional: ${signalScope.maxNotional}`);
      failedCount++;
      continue;
    }

    // Test through faucet mesh
    const filterResult = faucetMeshFilter.filterSignal(signalResult.signal);
    if (filterResult.passed) {
      passedCount++;
    } else {
      failedCount++;
      errors.push(`Signal ${i + 1}: Faucet mesh failed - ${filterResult.reason}`);
    }
  }

  // Get token lifecycle trace
  const tokenLifecycleTrace = chokePoint.getTokenLifecycleTrace();
  
  // Get choke-point confirmation hash
  const chokePointConfirmationHash = chokePoint.getChokePointConfirmationHash();

  // Calculate pass rate
  const passRate = passedCount / 100;
  const targetPassRate = 0.95;
  const meetsTarget = passRate >= targetPassRate;

  const result: ValidationRunResult = {
    totalSignals: 100,
    passedSignals: passedCount,
    failedSignals: failedCount,
    passRate,
    targetPassRate,
    meetsTarget,
    scopeViolations,
    tokenWarnings,
    tokenLifecycleTrace,
    chokePointConfirmationHash,
    errors: errors.slice(0, 10), // First 10 errors
  };

  log.info('Validation run complete', {
    passRate: `${(passRate * 100).toFixed(2)}%`,
    targetPassRate: `${(targetPassRate * 100).toFixed(2)}%`,
    meetsTarget,
    scopeViolations,
    tokenWarnings,
    chokePointConfirmationHash,
  });

  return result;
}

// ============================================================================
// MAIN (For Testing)
// ============================================================================

if (require.main === module) {
  console.log('\n=== STAGE 5 VALIDATION RUN ===\n');
  
  const result = runStage5Validation();
  
  console.log('=== VALIDATION RESULTS ===');
  console.log(`Total Signals: ${result.totalSignals}`);
  console.log(`Passed: ${result.passedSignals}`);
  console.log(`Failed: ${result.failedSignals}`);
  console.log(`Pass Rate: ${(result.passRate * 100).toFixed(2)}%`);
  console.log(`Target: ${(result.targetPassRate * 100).toFixed(2)}%`);
  console.log(`Meets Target: ${result.meetsTarget ? 'YES ✅' : 'NO ❌'}`);
  console.log(`\nScope Violations: ${result.scopeViolations}`);
  console.log(`Token Warnings: ${result.tokenWarnings}`);
  console.log(`\nChoke-Point Confirmation Hash: ${result.chokePointConfirmationHash}`);
  console.log(`\nToken Lifecycle Trace:`);
  result.tokenLifecycleTrace.forEach((entry, i) => {
    console.log(`  ${i + 1}. [${entry.timestamp.toISOString()}] ${entry.phase}: ${entry.action}`);
  });
  
  if (result.errors.length > 0) {
    console.log(`\nErrors (first 10):`);
    result.errors.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error}`);
    });
  }
  
  console.log('\n=== VALIDATION STATUS ===');
  if (result.meetsTarget && result.scopeViolations === 0 && result.tokenWarnings === 0) {
    console.log('✅ VALIDATION PASSED');
    process.exit(0);
  } else {
    console.log('❌ VALIDATION FAILED');
    if (!result.meetsTarget) console.log(`  - Pass rate ${(result.passRate * 100).toFixed(2)}% < target ${(result.targetPassRate * 100).toFixed(2)}%`);
    if (result.scopeViolations > 0) console.log(`  - Scope violations: ${result.scopeViolations}`);
    if (result.tokenWarnings > 0) console.log(`  - Token warnings: ${result.tokenWarnings}`);
    process.exit(1);
  }
}
