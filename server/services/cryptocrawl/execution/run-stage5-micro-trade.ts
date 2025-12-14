/**
 * Run Stage 5 Micro Trade Script
 * 
 * Execute: tsx server/services/cryptocrawl/execution/run-stage5-micro-trade.ts
 */

import { executeStage5MicroTrade } from './stage5-micro-trade';
import { createLogger } from '../../../logger';

const log = createLogger('Stage5MicroTradeRunner');

async function main() {
  log.info('='.repeat(80));
  log.info('STAGE 5 MICRO LIVE TRADE RUNNER');
  log.info('Scope: Single exchange (uniswap-v3), single pair (ETH/USDT)');
  log.info('Size: Micro/dust level (0.001 ETH)');
  log.info('Auto-pause: Immediately after fill or failure');
  log.info('='.repeat(80));

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
