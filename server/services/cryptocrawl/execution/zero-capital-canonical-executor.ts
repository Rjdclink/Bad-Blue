import { ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { ghostWalletAlternativeZeroCapitalSelectionRegistry } from '../ghost-wallet/zero-capital-alternative-selection-registry.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import {
  persistVerifiedSponsoredProfit,
  prepareSponsoredSystemCapital,
  releaseFailedSponsoredBootstrap,
  type SponsoredSystemCapitalAttempt,
} from '../runtime/system-capital-provenance.js';
import { builderSponsoredZeroCapitalRegistry } from './builder-sponsored-zero-capital-coldstart.js';
import { flashLoanProviderSelectionRegistry } from './adapters/flash-loan-provider-selection-registry.js';
import {
  executeAlternativePreparedWithinCanonicalExecutor,
  type AlternativePreparedExecutionFacts,
} from './zero-capital-alternative-prepared-executor.js';
import {
  executeCanonicalZeroCapitalOpportunity as executeFlashCanonicalZeroCapitalOpportunity,
  type CanonicalZeroCapitalExecutionResult,
} from './zero-capital-flash-canonical-executor.js';
import { evaluateZeroCapitalRealizedProfit, type ZeroCapitalRealizedProfitDecision } from './zero-capital-realized-profit-policy.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';

export type { CanonicalZeroCapitalExecutionResult } from './zero-capital-flash-canonical-executor.js';

const TREASURY_FRACTION_SCALE = 100_000_000n;
const NATIVE_SYMBOL: Partial<Record<SupportedChain, 'ETH' | 'POL' | 'BNB' | 'AVAX'>> = {
  ethereum: 'ETH',
  polygon: 'POL',
  arbitrum: 'ETH',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
};

type CanonicalRuntimeContext = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  gasSponsor: {
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: import('ethers').BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
};

function runtime(): CanonicalRuntimeContext {
  return zeroCapitalEngine as unknown as CanonicalRuntimeContext;
}

function failed(
  opportunity: ZeroCapitalOpportunity,
  reason: string,
  extra: Partial<CanonicalZeroCapitalExecutionResult> = {},
): CanonicalZeroCapitalExecutionResult {
  return {
    opportunityId: opportunity.id,
    submitted: Boolean(extra.transactionHash || extra.txHash),
    settlementConfirmed: false,
    status: extra.transactionHash || extra.txHash ? 'settlement_unknown' : 'failed',
    success: false,
    error: reason,
    ...extra,
  };
}

function splitGrossBaseUnits(grossProfitBaseUnits: bigint, retainedFraction: number) {
  if (grossProfitBaseUnits <= 0n) throw new Error('Gross settled profit must be positive before treasury split');
  const bounded = Math.max(
    0,
    Math.min(
      Number(TREASURY_FRACTION_SCALE),
      Math.floor(retainedFraction * Number(TREASURY_FRACTION_SCALE)),
    ),
  );
  const retainedProfitBaseUnits = (grossProfitBaseUnits * BigInt(bounded)) / TREASURY_FRACTION_SCALE;
  return {
    retainedProfitBaseUnits,
    payoutReservedBaseUnits: grossProfitBaseUnits - retainedProfitBaseUnits,
  };
}

async function terminalEconomics(input: {
  opportunity: ZeroCapitalOpportunity;
  grossProfit: bigint;
  nativeFeeWei: bigint;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero: boolean;
}): Promise<ZeroCapitalRealizedProfitDecision> {
  const symbols = [input.opportunity.inputAssetSymbol];
  const sponsorCostProvenZero = input.sponsoredExecution && input.sponsorOperatorMonetaryCostProvenZero;
  const nativeSymbol = sponsorCostProvenZero ? null : NATIVE_SYMBOL[input.opportunity.chain] || null;
  if (nativeSymbol) symbols.push(nativeSymbol as any);

  let prices = new Map<string, number>();
  try {
    prices = await coinGeckoPriceClient.getLiveSymbolPrices([...new Set(symbols)]);
  } catch {
    // Settlement truth is preserved; economics fail closed below if pricing is unavailable.
  }

  return evaluateZeroCapitalRealizedProfit({
    grossProfitBaseUnits: input.grossProfit,
    inputTokenDecimals: input.opportunity.inputTokenDecimals,
    inputTokenUsdPrice: prices.get(input.opportunity.inputAssetSymbol) ?? null,
    sponsoredExecution: input.sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: input.sponsorOperatorMonetaryCostProvenZero,
    nativeFeeWei: input.nativeFeeWei,
    nativeUsdPrice: nativeSymbol ? prices.get(nativeSymbol) ?? null : null,
  });
}

function normalizedAlternativeSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  facts: AlternativePreparedExecutionFacts;
  economics: ZeroCapitalRealizedProfitDecision;
  startedAt: number;
}): NormalizedRealizedExecution {
  const { opportunity, facts, economics } = input;
  const predictedPrice = Number(opportunity.inputAssetUsdPrice || 0);
  const predictedProfitUsd = predictedPrice > 0
    ? Number(ethers.utils.formatUnits(opportunity.expectedProfit.toString(), opportunity.inputTokenDecimals)) * predictedPrice
    : 0;

  return {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `${facts.selection.source}:${opportunity.route.map(step => step.protocol).join('->')}`,
    chain: opportunity.chain,
    predicted: {
      profitUsd: predictedProfitUsd,
      feeUsd: null,
      slippageBps: 0,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: economics.gasUsd,
      gasUsed: facts.receipt.gasUsed?.toString() || null,
      effectiveGasPriceWei: facts.receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: economics.netProfitUsd,
    },
    provenance: [
      'canonical_zero_capital_single_executor',
      'canonical_alternative_capital_selection_registry',
      `alternative_capital_source:${facts.selection.source}`,
      ...facts.selection.provenance,
      'exact_pre_broadcast_eth_call_passed',
      'exact_pre_broadcast_gas_estimate_passed',
      'source_specific_atomic_repayment_event_verified',
      'intermediary_terminal_balance_neutral',
      'operational_profit_recipient_delta:matches_intermediary_event',
      facts.sponsoredExecution
        ? facts.sponsorOperatorMonetaryCostProvenZero
          ? 'sponsored_gas:operator_cost_proven_zero'
          : 'sponsored_gas:provider_fronted_receipt_cost_measured'
        : 'system_owned_native_receipt_gas:measured',
      economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
      'synthetic_evidence:false',
    ],
    transactionHash: facts.transactionHash,
    blockNumber: facts.receipt.blockNumber,
    receiptStatus: 1,
  };
}

function executionFeedback(
  opportunity: ZeroCapitalOpportunity,
  result: CanonicalZeroCapitalExecutionResult,
): CryptaraExecutionFeedback | null {
  const normalized = result.normalized;
  if (!normalized?.terminal) return null;
  return {
    source: 'zero_capital',
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    symbol: `${opportunity.inputToken}/${opportunity.outputToken}`,
    strategy: opportunity.type,
    success: result.success === true,
    expectedProfitUsd: Number(normalized.predicted?.profitUsd || 0),
    realizedProfitUsd: normalized.realized?.netProfitUsd ?? null,
    feeUsd: normalized.realized?.gasUsd ?? null,
    slippageBps: normalized.realized?.slippageBps ?? null,
    latencyMs: Number(result.latencyMs || 0),
    usedZeroCapital: true,
    timestamp: Number(normalized.settledAt || Date.now()),
    notes: result.error,
    settlementStatus: normalized.status,
    settlementConfirmed: normalized.settlementConfirmed,
    provenance: normalized.provenance,
    settlement: normalized,
  };
}

async function persistTerminalLearning(
  opportunity: ZeroCapitalOpportunity,
  result: CanonicalZeroCapitalExecutionResult,
): Promise<CryptaraExecutionFeedback | null> {
  const feedback = executionFeedback(opportunity, result);
  if (!feedback) return null;
  await recordCryptaraExecutionEvidence(feedback).catch(error => {
    logger.warn('[ZeroCapitalExecutor] Alternative-capital terminal learning persistence degraded', {
      component: 'CanonicalZeroCapitalExecutor',
      opportunityId: opportunity.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return feedback;
}

function confirmedAlternativeReconciliationException(input: {
  opportunity: ZeroCapitalOpportunity;
  reason: string;
  startedAt: number;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
}): CanonicalZeroCapitalExecutionResult {
  const normalized: NormalizedRealizedExecution = {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `alternative_capital_reconciliation_exception:${input.opportunity.route.map(step => step.protocol).join('->')}`,
    chain: input.opportunity.chain,
    predicted: {
      profitUsd: 0,
      feeUsd: null,
      slippageBps: 0,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: null,
      gasUsed: input.receipt.gasUsed?.toString() || null,
      effectiveGasPriceWei: input.receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: null,
    },
    provenance: [
      'canonical_zero_capital_single_executor',
      'alternative_capital_transaction_confirmed',
      'terminal_economic_reconciliation_exception',
      'settlement_truth_preserved',
      'synthetic_evidence:false',
    ],
    transactionHash: input.transactionHash,
    blockNumber: input.receipt.blockNumber,
    receiptStatus: 1,
  };

  return {
    opportunityId: input.opportunity.id,
    submitted: true,
    settlementConfirmed: true,
    executionConfirmed: true,
    economicReconciliationStatus: 'exception',
    status: 'filled',
    success: false,
    transactionHash: input.transactionHash,
    txHash: input.transactionHash,
    receiptStatus: 1,
    blockNumber: input.receipt.blockNumber,
    economicsVerified: false,
    profitVerified: false,
    capitalProvenanceVerified: false,
    latencyMs: Date.now() - input.startedAt,
    normalized,
    error: input.reason,
  };
}

async function executeCanonicalAlternative(
  opportunity: ZeroCapitalOpportunity,
  target: CanonicalRuntimeContext,
  provider: providers.JsonRpcProvider,
  wallet: Wallet,
  startedAt: number,
): Promise<CanonicalZeroCapitalExecutionResult> {
  const selection = ghostWalletAlternativeZeroCapitalSelectionRegistry.get(opportunity.id);
  if (!selection) return failed(opportunity, 'Alternative-capital selection disappeared before execution');

  const profitRecipient = resolveOperationalProfitRecipient();
  const funding = await getProvenZeroCapitalGasFundingDecision(target as any, opportunity.chain);
  let systemCapitalAttempt: SponsoredSystemCapitalAttempt | null = null;
  if (funding.mode === 'sponsored' && funding.sponsorOperatorMonetaryCostProvenZero === true) {
    try {
      systemCapitalAttempt = await prepareSponsoredSystemCapital({
        chain: opportunity.chain,
        inputToken: opportunity.inputToken,
        profitRecipient,
        opportunityId: opportunity.id,
      });
    } catch (error) {
      logger.warn('[ZeroCapitalExecutor] Alternative-capital sponsored bookkeeping preparation degraded without changing execution truth', {
        component: 'CanonicalZeroCapitalExecutor',
        opportunityId: opportunity.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getCryptocrawlGovernance().recordExecutionAttempt();
  const outcome = await executeAlternativePreparedWithinCanonicalExecutor({
    opportunity,
    selection,
    provider,
    wallet,
    profitRecipient,
    funding,
    runtime: target,
  });

  if (!outcome.ok) {
    if (outcome.receipt?.status === 1 && outcome.transactionHash) {
      ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
      return confirmedAlternativeReconciliationException({
        opportunity,
        reason: outcome.reason,
        startedAt,
        transactionHash: outcome.transactionHash,
        receipt: outcome.receipt,
      });
    }
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    if (outcome.submitted) ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
    return failed(opportunity, outcome.reason, {
      submitted: outcome.submitted,
      transactionHash: outcome.transactionHash,
      txHash: outcome.transactionHash,
      receiptStatus: outcome.receipt?.status as 0 | 1 | undefined,
      blockNumber: outcome.receipt?.blockNumber,
      latencyMs: Date.now() - startedAt,
      status: outcome.submitted ? 'settlement_unknown' : 'failed',
    });
  }

  const facts = outcome.facts;
  ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
  const economics = await terminalEconomics({
    opportunity,
    grossProfit: facts.grossProfit,
    nativeFeeWei: facts.nativeFeeWei,
    sponsoredExecution: facts.sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: facts.sponsorOperatorMonetaryCostProvenZero,
  });
  const normalized = normalizedAlternativeSettlement({ opportunity, facts, economics, startedAt });
  const positive = economics.economicsComplete && economics.positiveAfterAllInCost;

  const result: CanonicalZeroCapitalExecutionResult = {
    opportunityId: opportunity.id,
    submitted: true,
    settlementConfirmed: true,
    executionConfirmed: true,
    economicReconciliationStatus: economics.economicsComplete ? 'confirmed' : 'pending',
    status: 'filled',
    success: positive,
    txHash: facts.transactionHash,
    transactionHash: facts.transactionHash,
    grossProfit: facts.grossProfit,
    profit: economics.netProfitBaseUnits ?? undefined,
    profitVerified: positive,
    economicsVerified: economics.economicsComplete,
    gasUsed: BigInt(facts.receipt.gasUsed.toString()),
    effectiveGasPriceWei: facts.receipt.effectiveGasPrice
      ? BigInt(facts.receipt.effectiveGasPrice.toString())
      : 0n,
    receiptStatus: 1,
    nativeFeeWei: facts.nativeFeeWei,
    zeroMonetaryGasVerified:
      facts.sponsoredExecution && facts.sponsorOperatorMonetaryCostProvenZero,
    realizedFeeUsd: economics.gasUsd ?? undefined,
    latencyMs: Date.now() - startedAt,
    blockNumber: facts.receipt.blockNumber,
    normalized,
    capitalProvenanceVerified: true,
    error: economics.economicsComplete
      ? positive ? undefined : 'Alternative-capital terminal settlement realized non-positive all-in net profit'
      : `Alternative-capital terminal economics are incomplete: ${economics.missingInformation.join(', ')}`,
  };

  const feedback = await persistTerminalLearning(opportunity, result);
  if (positive && feedback) {
    try {
      const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
      result.treasuryRecorded = allocation !== null;
      if (
        allocation
        && facts.sponsoredExecution
        && facts.sponsorOperatorMonetaryCostProvenZero
        && systemCapitalAttempt
      ) {
        const split = splitGrossBaseUnits(facts.grossProfit, allocation.retainedFraction);
        if (split.retainedProfitBaseUnits > 0n) {
          await persistVerifiedSponsoredProfit(systemCapitalAttempt, {
            transactionHash: facts.transactionHash,
            chain: opportunity.chain,
            asset: opportunity.inputAssetSymbol,
            grossProfitBaseUnits: facts.grossProfit,
            retainedProfitBaseUnits: split.retainedProfitBaseUnits,
            payoutReservedBaseUnits: split.payoutReservedBaseUnits,
            sourceRecipient: profitRecipient,
            sourceRecipientBalanceBeforeBaseUnits: facts.recipientStarting,
            sourceRecipientBalanceAfterBaseUnits: facts.recipientEnding,
            zeroOperatorMonetaryGasVerified: true,
            zeroExternalNativeCapitalVerified: true,
            zeroExternalInputCapitalVerified:
              facts.intermediaryStarting === facts.intermediaryEnding,
          });
        }
      }
    } catch (error) {
      logger.error('[ZeroCapitalExecutor] Alternative-capital profit preserved but treasury/system-capital persistence requires reconciliation', {
        component: 'CanonicalZeroCapitalExecutor',
        opportunityId: opportunity.id,
        transactionHash: facts.transactionHash,
        error: error instanceof Error ? error.message : String(error),
        settlementTruthPreserved: true,
      });
    }
  } else {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
  }

  logger.info('[ZeroCapitalExecutor] Canonical alternative-capital terminal result', {
    component: 'CanonicalZeroCapitalExecutor',
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    source: facts.selection.source,
    sourceAddress: facts.selection.sourceAddress,
    transactionHash: facts.transactionHash,
    settlementConfirmed: true,
    grossProfitBaseUnits: facts.grossProfit.toString(),
    realizedNetProfitUsd: economics.netProfitUsd,
    realizedGasUsd: economics.gasUsd,
    positiveAfterAllInCost: positive,
    sourceSpecificAtomicRepaymentVerified: true,
    intermediaryTerminalBalanceNeutral: facts.intermediaryStarting === facts.intermediaryEnding,
    sponsoredExecution: facts.sponsoredExecution,
    zeroOperatorMonetaryGasVerified: facts.sponsorOperatorMonetaryCostProvenZero,
    treasuryRecorded: result.treasuryRecorded === true,
    singleSchedulerAuthority: true,
    runtimeMethodMutation: false,
  });
  return result;
}

/**
 * Sole ZERO_CAPITAL_ATOMIC entrypoint. Existing flash/builder selections retain
 * priority and execute through the preserved proven implementation. Alternative
 * capital is used only when discovery produced a fresh source-specific selection
 * and no canonical flash/builder selection exists for the same opportunity.
 */
export async function executeCanonicalZeroCapitalOpportunity(
  opportunity: ZeroCapitalOpportunity,
): Promise<CanonicalZeroCapitalExecutionResult> {
  const alternative = ghostWalletAlternativeZeroCapitalSelectionRegistry.get(opportunity.id);
  if (!alternative) return executeFlashCanonicalZeroCapitalOpportunity(opportunity);

  // Preserve existing flash/builder execution semantics if a concurrent refresh
  // established either source after alternative repricing. Alternative capital is
  // strictly fallback and can never displace a working existing lane.
  if (
    flashLoanProviderSelectionRegistry.get(opportunity.id)
    || builderSponsoredZeroCapitalRegistry.get(opportunity.id)
  ) {
    ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
    return executeFlashCanonicalZeroCapitalOpportunity(opportunity);
  }

  const startedAt = Date.now();
  if (opportunity.chain === 'europa') return failed(opportunity, 'Europa execution is retired');
  if (Date.now() >= opportunity.expiresAt) return failed(opportunity, 'Exact zero-capital opportunity expired before canonical execution');
  if (opportunity.expectedProfit <= 0n) return failed(opportunity, 'Canonical all-in net economics are not strictly positive');

  const target = runtime();
  const provider = target.providers.get(opportunity.chain);
  const wallet = target.executionWallets.get(opportunity.chain);
  if (!provider || !wallet) return failed(opportunity, 'Provider or execution wallet is unavailable');

  const governance = getCryptocrawlGovernance();
  const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opportunity.chain, pair });
  governance.requireAllowed('SUBMIT_TX', { chain: opportunity.chain, pair });

  return executeCanonicalAlternative(opportunity, target, provider, wallet, startedAt);
}
