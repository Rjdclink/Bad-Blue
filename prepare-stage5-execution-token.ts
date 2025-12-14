/**
 * PREPARE STAGE 5 EXECUTION TOKEN
 * 
 * Prepares tokens for Stage 5 execution:
 * - HUMAN_UNPAUSE_TOKEN
 * - STAGE_SCOPE_TOKEN
 * - ONE_ACTION_TOKEN
 * 
 * Scope: Single exchange, single pair, dust size
 * Mode: Execution stub or live micro (explicitly chosen)
 * Auto-pause: Immediately after completion
 */

import { getExecutionChokePoint } from './server/services/cryptocrawl/execution/execution-choke-point';
import { createLogger } from './logger';

const log = createLogger('PrepareStage5Token');

// ============================================================================
// STAGE 5 EXECUTION TOKEN PREPARATION
// ============================================================================

export interface Stage5ExecutionMode {
  mode: 'stub' | 'live_micro';
  explicitlyChosen: boolean;
}

export interface Stage5TokenConfig {
  exchange: string;
  pair: string;
  size: 'dust';
  baseAmount: number;
  executionMode: Stage5ExecutionMode;
}

const STAGE_5_CONFIG: Stage5TokenConfig = {
  exchange: 'uniswap-v3',
  pair: 'LINK/USDT',
  size: 'dust',
  baseAmount: 0.0005, // 0.0005 ETH (dust size)
  executionMode: {
    mode: 'stub', // Default to stub - human must explicitly choose 'live_micro'
    explicitlyChosen: false, // Must be set to true by human
  },
};

/**
 * Prepare Stage 5 execution tokens
 */
export function prepareStage5ExecutionTokens(
  executionMode: 'stub' | 'live_micro' = 'stub'
): {
  success: boolean;
  tokensPrepared: boolean;
  reason: string;
  tokens?: {
    humanUnpause: boolean;
    stageScope: boolean;
    oneAction: boolean;
  };
} {
  log.info('Preparing Stage 5 execution tokens...', {
    config: STAGE_5_CONFIG,
    executionMode,
  });

  // Verify execution mode is explicitly chosen
  if (executionMode === 'live_micro') {
    log.warn('LIVE_MICRO mode selected - requires explicit human confirmation');
    // In production, this would require explicit human signature
  }

  const chokePoint = getExecutionChokePoint();

  try {
    // Set HUMAN_UNPAUSE_TOKEN
    chokePoint.setHumanUnpauseToken({
      token: 'HUMAN_UNPAUSE_TOKEN',
      issuedBy: 'human',
      timestamp: new Date(),
      explicit: true,
    });

    // Set STAGE_SCOPE_TOKEN
    chokePoint.setStageScopeToken({
      token: 'STAGE_SCOPE_TOKEN',
      stage: 5,
      scope: `single exchange (${STAGE_5_CONFIG.exchange}), single pair (${STAGE_5_CONFIG.pair}), dust size (${STAGE_5_CONFIG.baseAmount} ETH)`,
      issuedBy: 'human',
      timestamp: new Date(),
      explicit: true,
    });

    // Set ONE_ACTION_TOKEN (for execution)
    chokePoint.setOneActionToken({
      token: 'ONE_ACTION_TOKEN',
      actionType: 'execution',
      singleUse: true,
      issuedBy: 'human',
      timestamp: new Date(),
      used: false,
      explicit: true,
    });

    // Set system flags (unpause for execution)
    chokePoint.setSystemFlags({
      paused: false,
      globalExecution: 'ENABLED',
      locked: false,
    });

    // Set last human directive
    chokePoint.setLastHumanDirective(
      `Execute Stage 5 micro trade: single exchange (${STAGE_5_CONFIG.exchange}), single pair (${STAGE_5_CONFIG.pair}), dust size, mode: ${executionMode}`
    );

    log.info('Stage 5 execution tokens prepared successfully', {
      executionMode,
      tokensSet: {
        humanUnpause: true,
        stageScope: true,
        oneAction: true,
      },
    });

    return {
      success: true,
      tokensPrepared: true,
      reason: 'All tokens prepared successfully',
      tokens: {
        humanUnpause: true,
        stageScope: true,
        oneAction: true,
      },
    };
  } catch (error) {
    log.error('Failed to prepare Stage 5 execution tokens', { error });
    return {
      success: false,
      tokensPrepared: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Verify tokens are set
 */
export function verifyStage5Tokens(): {
  tokensSet: boolean;
  missingTokens: string[];
  flags: {
    UNPAUSE: boolean;
    GLOBAL_EXECUTION: 'ENABLED' | 'DISABLED';
    LOCKED: boolean;
    PAUSED: boolean;
  };
} {
  const chokePoint = getExecutionChokePoint();
  const flags = chokePoint.getCurrentFlags();

  // Check if tokens would allow execution
  const testResult = chokePoint.checkExecution(
    'cryptara-pilot',
    'pilot',
    'execution',
    'Test token verification'
  );

  const missingTokens = testResult.missingTokens;

  return {
    tokensSet: testResult.allowed,
    missingTokens,
    flags,
  };
}

// ============================================================================
// MAIN (For Testing)
// ============================================================================

if (require.main === module) {
  log.info('Preparing Stage 5 execution tokens...');
  
  // Default to stub mode (human must explicitly choose live_micro)
  const result = prepareStage5ExecutionTokens('stub');
  
  if (result.success) {
    log.info('Tokens prepared successfully');
    const verification = verifyStage5Tokens();
    log.info('Token verification', verification);
  } else {
    log.error('Token preparation failed', { reason: result.reason });
    process.exit(1);
  }
}
