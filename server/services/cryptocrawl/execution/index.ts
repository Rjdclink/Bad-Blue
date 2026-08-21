import { MultiRelaySubmitter } from './multi-relay-submitter.js';
import { FlashLoanAggregator } from './flash-loan-aggregator.js';
import { UltraLowLatencyExecutor } from './ultra-low-latency-executor.js';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { getCryptara, type CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { centralizedExchangeExecutor, type ArbitrageExecutionResult } from './centralized-exchange-executor.js';
import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { buildOnchainPayloadFromPlan, type OnchainExecutionPlan } from './adapters/onchain-payload-builder.js';

interface OpportunityData {
  to: string;
  data: string;
  value: string;
  gasLimit: number;
}

interface Opportunity {
  id: string;
  asset: string;
  chain: string;
  profit: number;
  type: 'simple' | 'triangle' | 'quadrilateral' | 'cross-chain';
  requiresFlashLoan?: boolean;
  flashLoanAmount?: number;
  pair?: string;
  payload?: OpportunityData;
  onchainPlan?: OnchainExecutionPlan;
  expectedFeeUsd?: number;
  expectedSlippageBps?: number;
  usedZeroCapital?: boolean;
  skipCryptaraFeedback?: boolean;
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

export interface SharedExecutionCapabilities {
  explicitPayloadRequired: boolean;
  genericOnChainPayloadBuilder: boolean;
  structuredOnChainPayloadBuilder: boolean;
  autonomousRoutePlanner: boolean;
  flashLoanReceiverSupport: boolean;
  liveOrderGuarded: boolean;
  supportedCentralizedVenues: Array<'kraken' | 'okx'>;
}

export interface SharedExecutionEnvironmentReadiness {
  noExecutionGuardEnabled: boolean;
  placeholderExecutionAllowed: boolean;
  liveExecutionEnabled: boolean;
  liveExecutionConfirmed: boolean;
  rpcConfigured: boolean;
  walletConfigured: boolean;
  centralizedExchangeConfigured: boolean;
  flashbotsAuthConfigured: boolean;
  zeroCapitalExecutionEnabled: boolean;
  zeroCapitalReceiverConfigured: boolean;
  liveCentralizedReady: boolean;
  liveOnchainReady: boolean;
  anyLiveRouteReady: boolean;
}

const SHARED_EXECUTION_CAPABILITIES: SharedExecutionCapabilities = {
  explicitPayloadRequired: false,
  genericOnChainPayloadBuilder: false,
  structuredOnChainPayloadBuilder: true,
  autonomousRoutePlanner: true,
  flashLoanReceiverSupport: true,
  liveOrderGuarded: true,
  supportedCentralizedVenues: ['kraken', 'okx'],
};

const PLACEHOLDER_OPPORTUNITY_PAYLOAD: OpportunityData = {
  to: '0x0000000000000000000000000000000000000001',
  data: '0x',
  value: '0',
  gasLimit: 500000,
};

function normalizeChain(chain: string): string {
  return String(chain || 'unknown').trim().toLowerCase();
}

function isSupportedCentralizedVenue(venue: QuoteVenue): venue is 'kraken' | 'okx' {
  return venue === 'kraken' || venue === 'okx';
}

function resolveOpportunityPayload(opp: Opportunity): OpportunityData {
  if (opp.payload) {
    return opp.payload;
  }

  if (opp.onchainPlan) {
    return buildOnchainPayloadFromPlan(opp.onchainPlan);
  }

  if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true') {
    throw new Error(
      'Live on-chain execution requires opportunity.payload or opportunity.onchainPlan; the autonomous plan-to-payload adapter is not implemented for executeWithMaxProfit()',
    );
  }

  if (process.env.CRYPTO_ALLOW_PLACEHOLDER_EXECUTION !== 'true') {
    throw new Error(
      'Explicit opportunity.payload is required. Set CRYPTO_ALLOW_PLACEHOLDER_EXECUTION=true only for non-production dry runs that intentionally use placeholder transaction payloads.',
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Placeholder transaction payloads are forbidden in production');
  }

  return PLACEHOLDER_OPPORTUNITY_PAYLOAD;
}

function shouldBlockForDirective(opp: Opportunity): string | null {
  const directive = getCryptara().getAutonomousDirective();
  const normalizedChain = normalizeChain(opp.chain);

  if (
    directive.riskBudget === 'defensive' &&
    directive.preferredChains.length > 0 &&
    !directive.preferredChains.includes(normalizedChain)
  ) {
    return `Autonomous directive is defensive and does not currently prefer chain ${normalizedChain}`;
  }

  if (opp.profit < directive.minimumNetProfitUsd) {
    return `Expected profit $${opp.profit.toFixed(2)} is below autonomous minimum net profit $${directive.minimumNetProfitUsd.toFixed(2)}`;
  }

  if (opp.requiresFlashLoan && !directive.preferredExecutionModes.includes('zero_capital')) {
    return 'Autonomous directive does not currently prefer zero-capital execution';
  }

  return null;
}

function recordCryptaraExecutionFeedback(feedback: CryptaraExecutionFeedback): void {
  try {
    getCryptara().recordExecutionResult(feedback);
  } catch (error) {
    logger.warn('Failed to record Cryptara execution feedback', {
      component: 'ExecutionOrchestrator',
      error: error instanceof Error ? error.message : String(error),
      symbol: feedback.symbol,
      strategy: feedback.strategy,
    });
  }
}

export function getSharedExecutionCapabilities(): SharedExecutionCapabilities {
  return {
    ...SHARED_EXECUTION_CAPABILITIES,
    supportedCentralizedVenues: [...SHARED_EXECUTION_CAPABILITIES.supportedCentralizedVenues],
  };
}

export function assessSharedExecutionEnvironment(): SharedExecutionEnvironmentReadiness {
  const noExecutionGuardEnabled = process.env.NO_EXECUTION === 'true';
  const placeholderExecutionAllowed = process.env.CRYPTO_ALLOW_PLACEHOLDER_EXECUTION === 'true';
  const liveExecutionEnabled = process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true';
  const liveExecutionConfirmed = process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
  const rpcConfigured = !!(
    process.env.PRIVATE_RPC_URL?.trim() ||
    process.env.RPC_URL?.trim() ||
    process.env.ETHEREUM_RPC_URL?.trim()
  );
  const walletConfigured = !!process.env.WALLET_PRIVATE_KEY?.trim();
  const centralizedExchangeConfigured = !!(
    (process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim()) ||
    (process.env.OKX_API_KEY?.trim() && process.env.OKX_API_SECRET?.trim() && process.env.OKX_API_PASSPHRASE?.trim())
  );
  const flashbotsAuthConfigured = !!(process.env.FLASHBOTS_AUTH_KEY?.trim() || process.env.WALLET_PRIVATE_KEY?.trim());
  const zeroCapitalExecutionEnabled = process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true';
  const zeroCapitalReceiverConfigured = !!process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER?.trim();
  const liveCentralizedReady = liveExecutionEnabled && liveExecutionConfirmed && centralizedExchangeConfigured;
  const liveOnchainReady =
    liveExecutionEnabled &&
    liveExecutionConfirmed &&
    rpcConfigured &&
    walletConfigured &&
    SHARED_EXECUTION_CAPABILITIES.structuredOnChainPayloadBuilder;

  return {
    noExecutionGuardEnabled,
    placeholderExecutionAllowed,
    liveExecutionEnabled,
    liveExecutionConfirmed,
    rpcConfigured,
    walletConfigured,
    centralizedExchangeConfigured,
    flashbotsAuthConfigured,
    zeroCapitalExecutionEnabled,
    zeroCapitalReceiverConfigured,
    liveCentralizedReady,
    liveOnchainReady,
    anyLiveRouteReady: liveCentralizedReady || liveOnchainReady,
  };
}

// Create singleton instances
export const multiRelay = new MultiRelaySubmitter();
export const flashLoans = new FlashLoanAggregator();
export const ultraLowLatency = new UltraLowLatencyExecutor();

// Unified execution function that combines all systems
export async function executeWithMaxProfit(opp: Opportunity): Promise<ExecutionResult> {
  const governance = getCryptocrawlGovernance();
  // Hard gate: deny-by-default unless explicitly UNPAUSED inside an envelope.
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opp.chain, pair: opp.pair || opp.asset });

  if (process.env.NO_EXECUTION === 'true') {
    return {
      success: false,
      error: 'Execution disabled by NO_EXECUTION=true safety guard',
    };
  }

  const directiveBlockReason = shouldBlockForDirective(opp);
  if (directiveBlockReason) {
    logger.warn('Execution blocked by Cryptara autonomous directive', {
      component: 'ExecutionOrchestrator',
      opportunityId: opp.id,
      chain: opp.chain,
      pair: opp.pair || opp.asset,
      reason: directiveBlockReason,
    });
    return {
      success: false,
      error: directiveBlockReason,
    };
  }

  logger.info('Executing opportunity with max profit strategy', {
    component: 'ExecutionOrchestrator',
    opportunityId: opp.id,
    type: opp.type,
    profit: opp.profit,
    requiresFlashLoan: opp.requiresFlashLoan
  });

  try {
    // Live execution implies transaction submission. Gate again with chain context.
    governance.requireAllowed('SUBMIT_TX', { chain: opp.chain, pair: opp.pair || opp.asset });
    governance.recordExecutionAttempt();

    // Initialize systems if needed
    await multiRelay.initialize();
    await ultraLowLatency.initialize();

    const oppData = resolveOpportunityPayload(opp);

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

    if (!opp.skipCryptaraFeedback) {
      recordCryptaraExecutionFeedback({
        source: opp.requiresFlashLoan ? 'flash_loan' : 'manual',
        opportunityId: opp.id,
        chain: normalizeChain(opp.chain),
        symbol: opp.pair || opp.asset,
        strategy: opp.type,
        success: executionResult.success,
        expectedProfitUsd: opp.profit,
        realizedProfitUsd: executionResult.success ? executionResult.profit || 0 : 0,
        feeUsd: opp.expectedFeeUsd || 0,
        slippageBps: opp.expectedSlippageBps || 0,
        latencyMs: executionResult.latency || 0,
        usedZeroCapital: opp.usedZeroCapital ?? !!opp.requiresFlashLoan,
        timestamp: Date.now(),
        notes: executionResult.error,
      });
    }

    return executionResult;
  } catch (error) {
    if (!opp.skipCryptaraFeedback) {
      recordCryptaraExecutionFeedback({
        source: opp.requiresFlashLoan ? 'flash_loan' : 'manual',
        opportunityId: opp.id,
        chain: normalizeChain(opp.chain),
        symbol: opp.pair || opp.asset,
        strategy: opp.type,
        success: false,
        expectedProfitUsd: opp.profit,
        realizedProfitUsd: 0,
        feeUsd: opp.expectedFeeUsd || 0,
        slippageBps: opp.expectedSlippageBps || 0,
        latencyMs: 0,
        usedZeroCapital: opp.usedZeroCapital ?? !!opp.requiresFlashLoan,
        timestamp: Date.now(),
        notes: error instanceof Error ? error.message : String(error),
      });
    }

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

export async function executeVerifiedArbitragePlan(
  plan: VerifiedArbitragePlan,
  options?: {
    chain?: string;
    source?: CryptaraExecutionFeedback['source'];
    observedSlippageBps?: number;
  },
): Promise<ArbitrageExecutionResult & { latencyMs: number; netExpectedProfitUsd: number }> {
  const governance = getCryptocrawlGovernance();
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol, venue: plan.buyVenue });
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol, venue: plan.sellVenue });

  if (process.env.NO_EXECUTION === 'true') {
    return {
      success: false,
      error: 'Execution disabled by NO_EXECUTION=true safety guard',
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  governance.recordExecutionAttempt();

  const normalizedChain = normalizeChain(options?.chain || plan.bridge?.from || 'cex');
  const directive = getCryptara().getAutonomousDirective();

  if (
    directive.riskBudget === 'defensive' &&
    normalizedChain !== 'cex' &&
    directive.preferredChains.length > 0 &&
    !directive.preferredChains.includes(normalizedChain)
  ) {
    return {
      success: false,
      error: `Autonomous directive is defensive and does not currently prefer chain ${normalizedChain}`,
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  if (plan.netProfitUsd < directive.minimumNetProfitUsd) {
    return {
      success: false,
      error: `Net expected profit $${plan.netProfitUsd.toFixed(2)} is below autonomous minimum $${directive.minimumNetProfitUsd.toFixed(2)}`,
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  if (!isSupportedCentralizedVenue(plan.buyVenue) || !isSupportedCentralizedVenue(plan.sellVenue)) {
    return {
      success: false,
      error: `Verified arbitrage plan requires unsupported live venue pairing ${plan.buyVenue}->${plan.sellVenue}; supported venues are ${SHARED_EXECUTION_CAPABILITIES.supportedCentralizedVenues.join(', ')}`,
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  const startedAt = Date.now();
  const result = await centralizedExchangeExecutor.execute(plan);
  const latencyMs = Date.now() - startedAt;
  const approximatedExecutionDragBps = options?.observedSlippageBps ?? Math.max(
    0,
    Math.round(((plan.grossProfitUsd - plan.netProfitUsd) / Math.max(plan.notionalUsd, 1)) * 10000),
  );

  recordCryptaraExecutionFeedback({
    source: options?.source || 'manual',
    opportunityId: `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`,
    chain: normalizedChain,
    symbol: plan.symbol,
    strategy: 'verified_cex_arbitrage',
    success: result.success,
    expectedProfitUsd: plan.netProfitUsd,
    realizedProfitUsd: result.success ? plan.netProfitUsd : 0,
    feeUsd: plan.costs.totalCostsUsd,
    slippageBps: approximatedExecutionDragBps,
    latencyMs,
    usedZeroCapital: false,
    timestamp: Date.now(),
    notes: result.error,
  });

  return {
    ...result,
    latencyMs,
    netExpectedProfitUsd: plan.netProfitUsd,
  };
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
