/**
 * Run Stage 5 Micro Trade Script
 * 
 * Execute: tsx server/services/cryptocrawl/execution/run-stage5-micro-trade.ts
 */

import { executeStage5MicroTrade } from './stage5-micro-trade';
import { createLogger } from '../../../logger';
import { getExecutionChokePoint } from './execution-choke-point';

const log = createLogger('Stage5MicroTradeRunner');

async function main() {
  log.info('='.repeat(80));
  log.info('STAGE 5 MICRO LIVE TRADE RUNNER');
  log.info('Scope: Single exchange (uniswap-v3), single pair (LINK/USDT)');
  log.info('Size: Micro/dust level (dynamic - eliminates dust)');
  log.info('Auto-pause: Immediately after fill or failure');
  log.info('='.repeat(80));

  // Set execution tokens and unpause system
  const chokePoint = getExecutionChokePoint();
  
  chokePoint.setHumanUnpauseToken({
    token: 'HUMAN_UNPAUSE_TOKEN',
    issuedBy: 'human',
    timestamp: new Date(),
    explicit: true,
  });

  chokePoint.setStageScopeToken({
    token: 'STAGE_SCOPE_TOKEN',
    stage: 5,
    scope: 'single exchange (uniswap-v3), single pair (LINK/USDT), dust size',
    issuedBy: 'human',
    timestamp: new Date(),
    explicit: true,
  });

  // Set token for signal acceptance (first gate in cycle)
  // Token will be consumed as it passes through gates
  chokePoint.setOneActionToken({
    token: 'ONE_ACTION_TOKEN',
    actionType: 'signal', // Start with signal, allows cascade through validation and execution
    singleUse: true,
    issuedBy: 'human',
    timestamp: new Date(),
    used: false,
    explicit: true,
  });

  chokePoint.setSystemFlags({
    paused: false,
    globalExecution: 'ENABLED',
    locked: false,
  });

  chokePoint.setLastHumanDirective('Execute Stage 5 micro trade: single exchange, single pair, dust size, mode: stub');

  log.info('Tokens set and system unpaused', { flags: chokePoint.getCurrentFlags() });

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

    log.info('='.repeat(80));
    log.info('AUTO-PAUSING: Micro trade complete - pausing immediately');
    log.info('='.repeat(80));

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    log.error('Micro trade runner failed', { error });
    process.exit(1);
  }
}

main();
