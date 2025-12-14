/**
 * Run Stage 5 Micro Trade Script
 * 
 * Execute: tsx server/services/cryptocrawl/execution/run-stage5-micro-trade.ts
 * 
 * COMMAND LANGUAGE: Only accepts exact command:
 * "Unpause and proceed with Stage-5 deterministic micro test."
 */

import { executeStage5MicroTrade } from './stage5-micro-trade';
import { createLogger } from '../../../logger';
import { getExecutionChokePoint, type Stage5Token } from './execution-choke-point';

const log = createLogger('Stage5MicroTradeRunner');

// ============================================================================
// COMMAND LANGUAGE VALIDATION
// ============================================================================

const REQUIRED_COMMAND = 'Unpause and proceed with Stage-5 deterministic micro test.';

function validateCommand(command: string): boolean {
  return command.trim() === REQUIRED_COMMAND.trim();
}

// ============================================================================
// PAUSE SEMANTICS: Check if paused before initialization
// ============================================================================

function checkPauseBeforeInit(): { allowed: boolean; reason?: string } {
  const chokePoint = getExecutionChokePoint();
  const flags = chokePoint.getCurrentFlags();
  
  if (flags.PAUSED) {
    return {
      allowed: false,
      reason: 'PAUSE = true - No runner may initialize while paused',
    };
  }
  
  return { allowed: true };
}

async function main() {
  // Check pause semantics BEFORE initialization
  const pauseCheck = checkPauseBeforeInit();
  if (!pauseCheck.allowed) {
    log.error('Runner initialization blocked', { reason: pauseCheck.reason });
    process.exit(1);
  }

  log.info('='.repeat(80));
  log.info('STAGE 5 MICRO LIVE TRADE RUNNER');
  log.info('Scope: Single exchange (uniswap-v3), single pair (LINK/USDT)');
  log.info('Size: Micro/dust level (dynamic - eliminates dust)');
  log.info('Auto-pause: Immediately after fill or failure');
  log.info('='.repeat(80));

  // Set unified Stage-5 token (same process)
  const chokePoint = getExecutionChokePoint();
  
  const stage5Token: Stage5Token = {
    token: 'STAGE_5_TOKEN',
    stage: 5,
    scope: {
      exchange: 'uniswap-v3',        // Single exchange (locked)
      pair: 'LINK/USDT',              // Single pair (locked)
      testType: 'deterministic_micro_test',
      maxNotional: 0.2,               // Test ceiling: 0.2 ETH (~$400-600)
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

  chokePoint.setSystemFlags({
    paused: false,
    globalExecution: 'ENABLED',
    locked: false,
  });

  chokePoint.setLastHumanDirective(REQUIRED_COMMAND);

  log.info('STAGE_5_TOKEN set and system unpaused', { 
    flags: chokePoint.getCurrentFlags(),
    scope: stage5Token.scope,
  });

  try {
    const result = await executeStage5MicroTrade();

    log.info('='.repeat(80));
    log.info('MICRO TRADE RESULT');
    log.info('='.repeat(80));
    log.info('Success:', result.success);
    log.info('Timestamp:', result.timestamp.toISOString());
    log.info('Config:', result.config);
    
    log.info('Faucet Mesh Filter:', result.faucetMeshFilter);
    
    if (result.decisionResult) {
      log.info('Decision Result:', result.decisionResult);
    }

    if (result.executionResult) {
      log.info('Execution Result:', result.executionResult);
    }

    if (result.postTradeAnalysis) {
      log.info('Post-Trade Analysis:', result.postTradeAnalysis);
    }

    log.info('Metrics:', result.metrics);

    if (result.errors.length > 0) {
      log.error('Errors:', result.errors);
    }

    if (result.warnings.length > 0) {
      log.warn('Warnings:', result.warnings);
    }

    // Token lifecycle trace
    const tokenLifecycleTrace = chokePoint.getTokenLifecycleTrace();
    log.info('Token Lifecycle Trace:', tokenLifecycleTrace);

    // Choke-point confirmation hash
    const chokePointConfirmationHash = chokePoint.getChokePointConfirmationHash();
    log.info('Choke-Point Confirmation Hash:', chokePointConfirmationHash);

    log.info('='.repeat(80));
    log.info('AUTO-PAUSING: Micro trade complete - pausing immediately');
    log.info('='.repeat(80));

    // Auto-pause
    chokePoint.setSystemFlags({
      paused: true,
      globalExecution: 'DISABLED',
      locked: true,
    });

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    log.error('Micro trade runner failed', { error });
    
    // Auto-pause on error
    chokePoint.setSystemFlags({
      paused: true,
      globalExecution: 'DISABLED',
      locked: true,
    });
    
    process.exit(1);
  }
}

main();
