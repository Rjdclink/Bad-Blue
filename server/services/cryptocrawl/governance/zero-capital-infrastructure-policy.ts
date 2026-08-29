import { stageManager } from './stage-management.js';
import { GovernanceError } from './types.js';

const RECEIVER_DEPLOYMENT_CHAINS = new Set(['ethereum', 'polygon', 'arbitrum', 'optimism']);

/**
 * Receiver deployment and allow-list preparation are infrastructure bootstrap,
 * not opportunity execution. This policy deliberately grants no trading or
 * settlement authority; those actions remain behind normal StageManager and
 * governance gates.
 */
export function requireZeroCapitalInfrastructureDeploymentAllowed(input: {
  chain: string;
  operation: 'receiver_deployment' | 'receiver_permissions';
}): void {
  const state = stageManager.getState();

  if (process.env.NO_EXECUTION === 'true') {
    throw new GovernanceError('ACTION_NOT_ALLOWED', 'NO_EXECUTION blocks zero-capital infrastructure transactions');
  }
  if (
    process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true' ||
    process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK' ||
    process.env.ZERO_CAPITAL_ENABLE_EXECUTION !== 'true' ||
    process.env.ZERO_CAPITAL_EXECUTION_CONFIRMATION !== 'I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK'
  ) {
    throw new GovernanceError('ACTION_NOT_ALLOWED', 'Live zero-capital confirmations are incomplete for infrastructure deployment');
  }
  if (state.killSwitchActive) {
    throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Zero-capital infrastructure deployment is blocked by the kill switch');
  }
  if (state.isPaused) {
    throw new GovernanceError('PAUSED', 'Zero-capital infrastructure deployment is blocked while StageManager is paused', {
      reason: state.pauseReason,
    });
  }
  if (!RECEIVER_DEPLOYMENT_CHAINS.has(input.chain)) {
    throw new GovernanceError('CONSTRAINT_VIOLATION', 'Chain is outside the reviewed zero-capital receiver deployment surface', {
      chain: input.chain,
      operation: input.operation,
    });
  }
}
