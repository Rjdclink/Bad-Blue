import { MultiRelaySubmitter } from './multi-relay-submitter.js';
import { FlashLoanAggregator } from './flash-loan-aggregator.js';
import { UltraLowLatencyExecutor } from './ultra-low-latency-executor.js';
import logger from '../../../logger.js';
import { CRYPTO_EXECUTION_RELEASED, assertCryptoExecutionReleased } from '../../../../shared/cryptoExecutionPolicy';

interface Opportunity {
  id: string;
  asset: string;
  chain: string;
  profit: number;
  type: 'simple' | 'triangle' | 'quadrilateral' | 'cross-chain';
  requiresFlashLoan?: boolean;
  flashLoanAmount?: number;
}

interface ExecutionResult {
  success: boolean;
  txHash?: string;
  profit?: number;
  latency?: number;
  method?: string;
  relaySubmissions?: any;
  error?: string;
}

// Create singleton instances
export const multiRelay = new MultiRelaySubmitter();
export const flashLoans = new FlashLoanAggregator();
export const ultraLowLatency = new UltraLowLatencyExecutor();

// Unified execution function that combines all systems
export async function executeWithMaxProfit(opp: Opportunity): Promise<ExecutionResult> {
  if (!CRYPTO_EXECUTION_RELEASED) {
    assertCryptoExecutionReleased('cryptocrawl.execution.executeWithMaxProfit');
  }
  logger.info('Executing opportunity with max profit strategy', {
    component: 'ExecutionOrchestrator',
    opportunityId: opp.id,
    type: opp.type,
    profit: opp.profit,
    requiresFlashLoan: opp.requiresFlashLoan
  });

  try {
    // Initialize systems if needed
    await multiRelay.initialize();
    await ultraLowLatency.initialize();

    let executionResult: ExecutionResult;

    if (opp.requiresFlashLoan && opp.flashLoanAmount) {
      // Execute with flash loan aggregator
      logger.debug('Using flash loan aggregator', {
        component: 'ExecutionOrchestrator',
        amount: opp.flashLoanAmount,
        asset: opp.asset
      });

      const flashLoanResult = await flashLoans.executeWithFlashLoan(
        opp.flashLoanAmount,
        opp.asset,
        async (borrowed: number) => {
          // Execute arbitrage with borrowed funds
          logger.debug('Executing arbitrage with borrowed funds', {
            component: 'ExecutionOrchestrator',
            borrowed
          });
          
          // Use ultra-low-latency executor for the actual trade
          const oppData = {
            to: '0x0000000000000000000000000000000000000001',
            data: '0x',
            value: '0',
            gasLimit: 500000
          };

          const result = await ultraLowLatency.executeInstant(oppData);
          
          if (result.success) {
            return opp.profit;
          } else {
            throw new Error('Arbitrage execution failed');
          }
        }
      );

      executionResult = {
        success: flashLoanResult.success,
        profit: flashLoanResult.profit,
        method: 'flash-loan-aggregator'
      };
    } else {
      // Execute with ultra-low-latency executor (multi-path racing)
      logger.debug('Using ultra-low-latency executor', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id
      });

      const oppData = {
        to: '0x0000000000000000000000000000000000000001',
        data: '0x',
        value: '0',
        gasLimit: 500000
      };

      const result = await ultraLowLatency.executeMultiPath(oppData);
      
      executionResult = {
        success: result.success,
        txHash: result.txHash,
        latency: result.latency,
        method: result.method,
        profit: result.success ? opp.profit : 0
      };
    }

    // If execution successful, submit to multiple relays for inclusion
    if (executionResult.success && executionResult.txHash) {
      const currentBlock = await getCurrentBlock();
      const targetBlock = currentBlock + 1;

      const relayResult = await multiRelay.submitBundle(
        {
          signedTransactions: [executionResult.txHash],
          targetBlock
        },
        targetBlock
      );

      executionResult.relaySubmissions = relayResult;

      logger.info('Bundle submitted to multiple relays', {
        component: 'ExecutionOrchestrator',
        submitted: relayResult.submitted,
        successful: relayResult.successful
      });
    }

    if (executionResult.success) {
      logger.info('Opportunity executed successfully', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id,
        profit: executionResult.profit,
        method: executionResult.method
      });
    } else {
      logger.warn('Opportunity execution failed', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id,
        method: executionResult.method
      });
    }

    return executionResult;
  } catch (error) {
    logger.error('Execution error', {
      component: 'ExecutionOrchestrator',
      opportunityId: opp.id,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function getCurrentBlock(): Promise<number> {
  // In production, query actual blockchain
  return Math.floor(Date.now() / 12000); // Simulate block number
}

// Export types
export type { Opportunity, ExecutionResult };

// Re-export individual modules
export { MultiRelaySubmitter } from './multi-relay-submitter.js';
export { FlashLoanAggregator } from './flash-loan-aggregator.js';
export { UltraLowLatencyExecutor } from './ultra-low-latency-executor.js';
