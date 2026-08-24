import { MultiRelaySubmitter } from './multi-relay-submitter.js';
import { FlashLoanAggregator } from './flash-loan-aggregator.js';
import { UltraLowLatencyExecutor } from './ultra-low-latency-executor.js';
import { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { getCryptara, type CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { centralizedExchangeExecutor, type ArbitrageExecutionResult } from './centralized-exchange-executor.js';
import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { buildOnchainPayloadFromPlan, type OnchainExecutionPlan } from './adapters/onchain-payload-builder.js';
import { DexSettlementObserver, type DexSettlementPriceContext } from './dex-settlement-observer.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';

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
  settlement?: {
    walletAddress?: string;
    tokenIn?: string;
    tokenOut?: string;
    inputAmountBaseUnits?: string;
    expectedOutputAmountBaseUnits?: string;
    inputTokenDecimals?: number;
    outputTokenDecimals?: number;
    prices?: DexSettlementPriceContext;
  };
}

interface ExecutionResult {
  success: boolean;
  status: 'submitted' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'failed' | 'settlement_unknown';
  settlementConfirmed: boolean;
  txHash?: string;
  profit?: number;
  latency?: number;
  method?: string;
  relaySubmissions?: any;
  normalized?: NormalizedRealizedExecution;
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

function resolveSettlementWalletAddress(explicitAddress?: string): string {
  if (explicitAddress?.trim()) return explicitAddress.trim();
  const configuredAddress = process.env.WALLET_ADDRESS?.trim();
  if (configuredAddress) return configuredAddress;
  const privateKey = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!privateKey) throw new Error('WALLET_ADDRESS or WALLET_PRIVATE_KEY is required for DEX settlement observation');
  return new Wallet(privateKey).address;
}

function resolveSettlementRpcUrl(chain: string): string {
  const chainRpc = process.env[`${chain.toUpperCase()}_RPC_URL`]?.trim();
  return chainRpc || process.env.PRIVATE_RPC_URL?.trim() || process.env.RPC_URL?.trim() || process.env.ETHEREUM_RPC_URL?.trim() || '';
}

async function observeDexSettlement(opp: Opportunity, txHash: string): Promise<{
  success: boolean;
  status: NonNullable<ExecutionResult['status']>;
  settlementConfirmed: boolean;
  normalized: NormalizedRealizedExecution;
  error?: string;
}> {
  if (!opp.onchainPlan && !opp.settlement) {
    throw new Error('DEX settlement metadata is required to observe an on-chain execution');
  }
  const chain = normalizeChain(opp.chain);
  const rpcUrl = resolveSettlementRpcUrl(chain);
  if (!rpcUrl) throw new Error(`No RPC URL is configured for DEX settlement observation on ${chain}`);
  const firstLeg = opp.onchainPlan?.legs[0];
  const settlement = opp.settlement || {};
  const observer = new DexSettlementObserver(new providers.JsonRpcProvider(rpcUrl));
  return observer.observe({
    txHash,
    chain,
    walletAddress: resolveSettlementWalletAddress(settlement.walletAddress),
    plan: opp.onchainPlan,
    tokenIn: settlement.tokenIn || firstLeg?.tokenIn,
    tokenOut: settlement.tokenOut || firstLeg?.tokenOut,
    inputAmountBaseUnits: settlement.inputAmountBaseUnits || firstLeg?.amountIn,
    expectedOutputAmountBaseUnits: settlement.expectedOutputAmountBaseUnits,
    inputTokenDecimals: settlement.inputTokenDecimals,
    outputTokenDecimals: settlement.outputTokenDecimals,
    prices: settlement.prices,
    predictedProfitUsd: opp.profit,
    predictedFeeUsd: opp.expectedFeeUsd ?? null,
    predictedSlippageBps: opp.expectedSlippageBps ?? null,
  });
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

async function recordCryptaraExecutionFeedback(feedback: CryptaraExecutionFeedback): Promise<void> {
  try {
    await recordCryptaraExecutionEvidence(feedback);
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
      status: 'failed',
      settlementConfirmed: false,
      error: 'Execution disabled by NO_EXECUTION=true safety guard',
    };
  }

  if (opp.requiresFlashLoan) {
    return {
      success: false,
      status: 'failed',
      settlementConfirmed: false,
      error: 'Flash-loan execution is unavailable: the configured aggregator does not provide atomic borrow, repayment, and settlement verification',
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
      status: 'rejected',
      settlementConfirmed: false,
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

    // The generic on-chain executor confirms broadcast acceptance only. A
    // receipt and settlement observer must provide realized economics later.
    logger.debug('Using ultra-low-latency executor (settlement pending)', {
      component: 'ExecutionOrchestrator',
      opportunityId: opp.id
    });

    const result = await ultraLowLatency.executeMultiPath(oppData);
    executionResult = {
      success: result.success,
      status: result.success ? 'submitted' : 'failed',
      settlementConfirmed: false,
      txHash: result.txHash,
      latency: result.latency,
      method: result.method,
    };

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

    if (executionResult.success && executionResult.txHash && (opp.onchainPlan || opp.settlement)) {
      try {
        const settlement = await observeDexSettlement(opp, executionResult.txHash);
        executionResult = {
          ...executionResult,
          success: settlement.success,
          status: settlement.status,
          settlementConfirmed: settlement.settlementConfirmed,
          normalized: settlement.normalized,
          profit: settlement.normalized.realized.netProfitUsd ?? undefined,
          error: settlement.error,
        };
      } catch (error) {
        executionResult = {
          ...executionResult,
          status: 'settlement_unknown',
          settlementConfirmed: false,
          error: error instanceof Error ? error.message : String(error),
        };
        logger.warn('On-chain execution was submitted but settlement observation is unavailable', {
          component: 'ExecutionOrchestrator',
          opportunityId: opp.id,
          txHash: executionResult.txHash,
          error: executionResult.error,
        });
      }
    }

    if (executionResult.success && executionResult.settlementConfirmed) {
      logger.info('Opportunity executed and settled successfully', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id,
        profit: executionResult.profit,
        method: executionResult.method
      });
    } else if (executionResult.success) {
      logger.info('Opportunity submitted; settlement is pending', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id,
        txHash: executionResult.txHash,
        method: executionResult.method,
      });
    } else {
      logger.warn('Opportunity execution failed', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id,
        method: executionResult.method
      });
    }

    const realizedEconomics = executionResult.normalized?.realized;
    const hasMeasuredSettlementEconomics = executionResult.settlementConfirmed === true &&
      Number.isFinite(realizedEconomics?.netProfitUsd) &&
      Number.isFinite(realizedEconomics?.gasUsd) &&
      Number.isFinite(realizedEconomics?.slippageBps);
    if (!opp.skipCryptaraFeedback && hasMeasuredSettlementEconomics) {
      await recordCryptaraExecutionFeedback({
        source: opp.requiresFlashLoan ? 'flash_loan' : 'manual',
        opportunityId: opp.id,
        chain: normalizeChain(opp.chain),
        symbol: opp.pair || opp.asset,
        strategy: opp.type,
        success: executionResult.success,
        expectedProfitUsd: opp.profit,
        realizedProfitUsd: realizedEconomics!.netProfitUsd!,
        feeUsd: realizedEconomics!.gasUsd!,
        slippageBps: realizedEconomics!.slippageBps!,
        latencyMs: executionResult.latency || 0,
        usedZeroCapital: opp.usedZeroCapital ?? !!opp.requiresFlashLoan,
        timestamp: Date.now(),
        settlementStatus: executionResult.normalized?.status,
        settlementConfirmed: executionResult.normalized?.settlementConfirmed,
        provenance: executionResult.normalized?.provenance,
        settlement: executionResult.normalized,
        notes: executionResult.error,
      });
    } else if (!opp.skipCryptaraFeedback) {
      logger.warn('Execution settlement lacks complete measured economics; omitting Cryptara feedback', {
        component: 'ExecutionOrchestrator',
        opportunityId: opp.id,
        expectedProfitUsd: opp.profit,
        status: executionResult.status,
        settlementConfirmed: executionResult.settlementConfirmed,
        realizedProfitUsd: realizedEconomics?.netProfitUsd ?? null,
        gasUsd: realizedEconomics?.gasUsd ?? null,
        slippageBps: realizedEconomics?.slippageBps ?? null,
        error: executionResult.error,
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
      status: 'failed',
      settlementConfirmed: false,
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
    realizedProfitUsd?: number;
  },
): Promise<ArbitrageExecutionResult & { latencyMs: number; netExpectedProfitUsd: number }> {
  const governance = getCryptocrawlGovernance();
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol, venue: plan.buyVenue });
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol, venue: plan.sellVenue });

  if (process.env.NO_EXECUTION === 'true') {
    return {
      success: false,
      status: 'failed',
      settlementConfirmed: false,
      error: 'Execution disabled by NO_EXECUTION=true safety guard',
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  governance.requireAllowed('SUBMIT_TX', { pair: plan.symbol, venue: plan.buyVenue });
  governance.requireAllowed('SUBMIT_TX', { pair: plan.symbol, venue: plan.sellVenue });
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
      status: 'rejected',
      settlementConfirmed: false,
      error: `Autonomous directive is defensive and does not currently prefer chain ${normalizedChain}`,
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  if (plan.netProfitUsd < directive.minimumNetProfitUsd) {
    return {
      success: false,
      status: 'rejected',
      settlementConfirmed: false,
      error: `Net expected profit $${plan.netProfitUsd.toFixed(2)} is below autonomous minimum $${directive.minimumNetProfitUsd.toFixed(2)}`,
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  if (!isSupportedCentralizedVenue(plan.buyVenue) || !isSupportedCentralizedVenue(plan.sellVenue)) {
    return {
      success: false,
      status: 'rejected',
      settlementConfirmed: false,
      error: `Verified arbitrage plan requires unsupported live venue pairing ${plan.buyVenue}->${plan.sellVenue}; supported venues are ${SHARED_EXECUTION_CAPABILITIES.supportedCentralizedVenues.join(', ')}`,
      latencyMs: 0,
      netExpectedProfitUsd: plan.netProfitUsd,
    };
  }

  const startedAt = Date.now();
  const result = await centralizedExchangeExecutor.execute(plan);
  const latencyMs = Date.now() - startedAt;
  const normalized = result.normalized;
  const realizedProfitUsd = normalized?.realized.netProfitUsd;
  const realizedFeeUsd = normalized?.realized.exchangeFeeUsd;
  const realizedSlippageBps = normalized?.realized.slippageBps;
  const hasMeasuredEconomics = result.settlementConfirmed === true &&
    Number.isFinite(realizedProfitUsd) &&
    Number.isFinite(realizedFeeUsd) &&
    Number.isFinite(realizedSlippageBps);
  const settlementConfirmed = result.settlementConfirmed === true;
  if (hasMeasuredEconomics) {
    await recordCryptaraExecutionFeedback({
      source: options?.source || 'manual',
      opportunityId: `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`,
      chain: normalizedChain,
      symbol: plan.symbol,
      strategy: 'verified_cex_arbitrage',
      success: result.success,
      expectedProfitUsd: plan.netProfitUsd,
      realizedProfitUsd: realizedProfitUsd!,
      feeUsd: realizedFeeUsd!,
      slippageBps: realizedSlippageBps!,
      latencyMs,
      usedZeroCapital: false,
      timestamp: Date.now(),
      settlementStatus: normalized!.status,
      settlementConfirmed: normalized!.settlementConfirmed,
      provenance: normalized!.provenance,
      settlement: normalized,
      notes: result.error,
    });
  } else {
    logger.warn('CEX settlement lacks complete measured economics; omitting Cryptara feedback', {
      component: 'ExecutionOrchestrator',
      opportunityId: `${plan.buyVenue}-${plan.sellVenue}-${plan.symbol}`,
      expectedProfitUsd: plan.netProfitUsd,
      status: result.status,
      settlementConfirmed,
      realizedProfitUsd: realizedProfitUsd ?? null,
      realizedFeeUsd: realizedFeeUsd ?? null,
      realizedSlippageBps: realizedSlippageBps ?? null,
      error: result.error,
    });
  }

  return {
    ...result,
    settlementConfirmed,
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
