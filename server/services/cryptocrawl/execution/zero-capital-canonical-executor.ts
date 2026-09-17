import { ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  expectedProfitFitsDailyBudget,
  getProfitLadderDailyProfitBudget,
} from '../governance/profit-ladder-daily-profit-budget.js';
import { ghostWalletAlternativeZeroCapitalSelectionRegistry } from '../ghost-wallet/zero-capital-alternative-selection-registry.js';
import {
  evaluateFiveDollarOutputFloor,
  ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
} from '../integration/zero-capital-profit-output-floor.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import {
  persistVerifiedSponsoredProfit,
  prepareSponsoredSystemCapital,
  releaseFailedSponsoredBootstrap,
  type SponsoredSystemCapitalAttempt,
} from '../runtime/system-capital-provenance.js';
import { flashLoanProviderSelectionRegistry } from './adapters/flash-loan-provider-selection-registry.js';
import { builderSponsoredZeroCapitalRegistry } from './builder-sponsored-zero-capital-coldstart.js';
import {
  executeAlternativePreparedWithinCanonicalExecutor,
  type AlternativePreparedExecutionFacts,
} from './zero-capital-alternative-prepared-executor.js';
import {
  executeCompositePreparedWithinCanonicalExecutor,
  type CompositePreparedExecutionFacts,
} from './zero-capital-composite-prepared-executor.js';
import { zeroCapitalCompositeSelectionRegistry } from './zero-capital-composite-selection-registry.js';
import {
  executeCanonicalZeroCapitalOpportunity as executeFlashCanonicalZeroCapitalOpportunity,
  type CanonicalZeroCapitalExecutionResult,
} from './zero-capital-flash-canonical-executor.js';
import { evaluateZeroCapitalRealizedProfit, type ZeroCapitalRealizedProfitDecision } from './zero-capital-realized-profit-policy.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';

export type { CanonicalZeroCapitalExecutionResult } from './zero-capital-flash-canonical-executor.js';

const TREASURY_FRACTION_SCALE = 100_000_000n;
const COMPOSITE_ID_PREFIX = 'atomic-stack:';
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

type PreparedTerminalFacts = {
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  grossProfit: bigint;
  recipientStarting: bigint;
  recipientEnding: bigint;
  nativeFeeWei: bigint;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero: boolean;
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

function expectedNetProfitUsd(opportunity: ZeroCapitalOpportunity): number {
  const tokenAmount = Number(ethers.utils.formatUnits(opportunity.expectedProfit.toString(), opportunity.inputTokenDecimals));
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return 0;
  const quotedPrice = Number(opportunity.inputAssetUsdPrice);
  if (!(Number.isFinite(quotedPrice) && quotedPrice > 0)) return 0;
  const usd = tokenAmount * quotedPrice;
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

async function resolveExpectedNetProfitUsdForBudget(opportunity: ZeroCapitalOpportunity): Promise<number | null> {
  const quoted = expectedNetProfitUsd(opportunity);
  if (quoted > 0) return quoted;
  let prices = new Map<string, number>();
  try {
    prices = await livePriceMesh.getLiveSymbolPrices([opportunity.inputAssetSymbol]);
  } catch {
    return null;
  }
  const usdPrice = Number(prices.get(opportunity.inputAssetSymbol));
  if (!(Number.isFinite(usdPrice) && usdPrice > 0)) return null;
  const tokenAmount = Number(ethers.utils.formatUnits(opportunity.expectedProfit.toString(), opportunity.inputTokenDecimals));
  if (!(Number.isFinite(tokenAmount) && tokenAmount > 0)) return null;
  const usd = tokenAmount * usdPrice;
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** Profit Ladder is telemetry here, never ZERO_CAPITAL_ATOMIC execution authority. */
async function observeDailyProfitBudget(opportunity: ZeroCapitalOpportunity): Promise<void> {
  try {
    const budget = await getProfitLadderDailyProfitBudget();
    const expectedUsd = budget.remainingProfitUsd === null
      ? null
      : await resolveExpectedNetProfitUsdForBudget(opportunity);
    const fits = expectedUsd === null ? null : expectedProfitFitsDailyBudget(expectedUsd, budget);
    logger.debug('[ZeroCapitalExecutor] Profit Ladder observed without Atomic execution veto', {
      component: 'CanonicalZeroCapitalExecutor',
      opportunityId: opportunity.id,
      dailyProfitCapUsd: budget.dailyProfitCapUsd,
      dailyRealizedProfitUsd: budget.realizedProfitUsd,
      dailyRemainingProfitUsd: budget.remainingProfitUsd,
      exhausted: budget.exhausted,
      expectedNetProfitUsd: expectedUsd,
      expectedProfitFitsRemainingBudget: fits,
      borrowingNotionalAuthority: false,
      profitabilityAuthority: false,
      executionVetoAuthority: false,
    });
  } catch (error) {
    logger.debug('[ZeroCapitalExecutor] Profit Ladder telemetry unavailable; canonical $5 Atomic execution floor remains governed by exact economics', {
      component: 'CanonicalZeroCapitalExecutor',
      opportunityId: opportunity.id,
      error: error instanceof Error ? error.message : String(error),
      borrowingNotionalAuthority: false,
      profitabilityAuthority: false,
      executionVetoAuthority: false,
    });
  }
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
    prices = await livePriceMesh.getLiveSymbolPrices([...new Set(symbols)]);
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

function normalizedPreparedSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  facts: PreparedTerminalFacts;
  economics: ZeroCapitalRealizedProfitDecision;
  startedAt: number;
  venueOrRoute: string;
  provenance: string[];
}): NormalizedRealizedExecution {
  const predictedPrice = Number(input.opportunity.inputAssetUsdPrice || 0);
  const predictedProfitUsd = predictedPrice > 0
    ? Number(ethers.utils.formatUnits(input.opportunity.expectedProfit.toString(), input.opportunity.inputTokenDecimals)) * predictedPrice
    : expectedNetProfitUsd(input.opportunity);
  return {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: input.venueOrRoute,
    chain: input.opportunity.chain,
    predicted: {
      profitUsd: predictedProfitUsd,
      feeUsd: null,
      slippageBps: 0,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: input.economics.gasUsd,
      gasUsed: input.facts.receipt.gasUsed?.toString() || null,
      effectiveGasPriceWei: input.facts.receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: input.economics.netProfitUsd,
    },
    provenance: [...input.provenance, 'synthetic_evidence:false'],
    transactionHash: input.facts.transactionHash,
    blockNumber: input.facts.receipt.blockNumber,
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
    logger.warn('[ZeroCapitalExecutor] Terminal learning persistence degraded', {
      component: 'CanonicalZeroCapitalExecutor',
      opportunityId: opportunity.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return feedback;
}

function confirmedPreparedReconciliationException(input: {
  opportunity: ZeroCapitalOpportunity;
  reason: string;
  startedAt: number;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  mode: 'alternative_capital' | 'composite_atomic';
}): CanonicalZeroCapitalExecutionResult {
  const normalized: NormalizedRealizedExecution = {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `${input.mode}_reconciliation_exception`,
    chain: input.opportunity.chain,
    predicted: { profitUsd: expectedNetProfitUsd(input.opportunity), feeUsd: null, slippageBps: 0 },
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
      `${input.mode}_transaction_confirmed`,
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

async function prepareSystemCapitalAttempt(
  opportunity: ZeroCapitalOpportunity,
  profitRecipient: string,
  funding: Awaited<ReturnType<typeof getProvenZeroCapitalGasFundingDecision>>,
): Promise<SponsoredSystemCapitalAttempt | null> {
  if (funding.mode !== 'sponsored' || funding.operatorMonetaryInputRequired !== false) return null;
  try {
    return await prepareSponsoredSystemCapital({
      chain: opportunity.chain,
      inputToken: opportunity.inputToken,
      profitRecipient,
      opportunityId: opportunity.id,
    });
  } catch (error) {
    logger.warn('[ZeroCapitalExecutor] Sponsored bookkeeping preparation degraded without changing execution truth', {
      component: 'CanonicalZeroCapitalExecutor',
      opportunityId: opportunity.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function persistPreparedProfit(input: {
  opportunity: ZeroCapitalOpportunity;
  result: CanonicalZeroCapitalExecutionResult;
  facts: PreparedTerminalFacts;
  systemCapitalAttempt: SponsoredSystemCapitalAttempt | null;
  profitRecipient: string;
  zeroExternalInputCapitalVerified: boolean;
}): Promise<void> {
  const feedback = await persistTerminalLearning(input.opportunity, input.result);
  if (!(input.result.success === true && feedback)) {
    await releaseFailedSponsoredBootstrap(input.systemCapitalAttempt).catch(() => undefined);
    return;
  }
  try {
    const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
    input.result.treasuryRecorded = allocation !== null;
    const distributableNetProfitBaseUnits = input.result.profit;
    if (
      allocation
      && input.facts.sponsoredExecution
      && input.systemCapitalAttempt
      && typeof distributableNetProfitBaseUnits === 'bigint'
      && distributableNetProfitBaseUnits > 0n
    ) {
      const split = splitGrossBaseUnits(distributableNetProfitBaseUnits, allocation.retainedFraction);
      if (split.retainedProfitBaseUnits > 0n) {
        await persistVerifiedSponsoredProfit(input.systemCapitalAttempt, {
          transactionHash: input.facts.transactionHash,
          chain: input.opportunity.chain,
          asset: input.opportunity.inputAssetSymbol,
          grossProfitBaseUnits: input.facts.grossProfit,
          distributableNetProfitBaseUnits,
          retainedProfitBaseUnits: split.retainedProfitBaseUnits,
          payoutReservedBaseUnits: split.payoutReservedBaseUnits,
          sourceRecipient: input.profitRecipient,
          sourceRecipientBalanceBeforeBaseUnits: input.facts.recipientStarting,
          sourceRecipientBalanceAfterBaseUnits: input.facts.recipientEnding,
          zeroOperatorMonetaryGasVerified: input.facts.sponsorOperatorMonetaryCostProvenZero,
          providerGasLiabilityAccounted:
            !input.facts.sponsorOperatorMonetaryCostProvenZero
            && input.facts.nativeFeeWei > 0n
            && input.result.economicsVerified === true,
          zeroExternalNativeCapitalVerified: true,
          zeroExternalInputCapitalVerified: input.zeroExternalInputCapitalVerified,
        });
        input.result.capitalProvenanceVerified = true;
      }
    }
  } catch (error) {
    input.result.capitalProvenanceVerified = false;
    logger.error('[ZeroCapitalExecutor] Confirmed profit preserved but treasury/system-capital persistence requires reconciliation', {
      component: 'CanonicalZeroCapitalExecutor',
      opportunityId: input.opportunity.id,
      transactionHash: input.facts.transactionHash,
      error: error instanceof Error ? error.message : String(error),
      settlementTruthPreserved: true,
    });
  }
}

function preparedResult(input: {
  opportunity: ZeroCapitalOpportunity;
  facts: PreparedTerminalFacts;
  economics: ZeroCapitalRealizedProfitDecision;
  normalized: NormalizedRealizedExecution;
  startedAt: number;
  targetNetProfitBaseUnits?: bigint;
  mode: 'alternative_capital' | 'composite_atomic';
}): CanonicalZeroCapitalExecutionResult {
  const targetSatisfied = input.targetNetProfitBaseUnits === undefined
    || (input.economics.netProfitBaseUnits !== null && input.economics.netProfitBaseUnits >= input.targetNetProfitBaseUnits);
  const positive = input.economics.economicsComplete && input.economics.positiveAfterAllInCost && targetSatisfied;
  return {
    opportunityId: input.opportunity.id,
    submitted: true,
    settlementConfirmed: true,
    executionConfirmed: true,
    economicReconciliationStatus: input.economics.economicsComplete ? 'confirmed' : 'pending',
    status: 'filled',
    success: positive,
    txHash: input.facts.transactionHash,
    transactionHash: input.facts.transactionHash,
    grossProfit: input.facts.grossProfit,
    profit: input.economics.netProfitBaseUnits ?? undefined,
    profitVerified: positive,
    economicsVerified: input.economics.economicsComplete,
    gasUsed: BigInt(input.facts.receipt.gasUsed.toString()),
    effectiveGasPriceWei: input.facts.receipt.effectiveGasPrice
      ? BigInt(input.facts.receipt.effectiveGasPrice.toString())
      : 0n,
    receiptStatus: 1,
    nativeFeeWei: input.facts.nativeFeeWei,
    zeroMonetaryGasVerified: input.facts.sponsoredExecution && input.facts.sponsorOperatorMonetaryCostProvenZero,
    realizedFeeUsd: input.economics.gasUsd ?? undefined,
    latencyMs: Date.now() - input.startedAt,
    blockNumber: input.facts.receipt.blockNumber,
    normalized: input.normalized,
    capitalProvenanceVerified: false,
    error: input.economics.economicsComplete
      ? positive
        ? undefined
        : !targetSatisfied
          ? `${input.mode} terminal settlement did not preserve the prepared profit threshold after realized costs`
          : `${input.mode} terminal settlement realized non-positive all-in net profit`
      : `${input.mode} terminal economics are incomplete: ${input.economics.missingInformation.join(', ')}`,
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
  const systemCapitalAttempt = await prepareSystemCapitalAttempt(opportunity, profitRecipient, funding);
  getCryptocrawlGovernance().recordExecutionAttempt();
  const outcome = await executeAlternativePreparedWithinCanonicalExecutor({
    opportunity, selection, provider, wallet, profitRecipient, funding, runtime: target,
  });
  if (!outcome.ok) {
    if (outcome.receipt?.status === 1 && outcome.transactionHash) {
      ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
      return confirmedPreparedReconciliationException({
        opportunity,
        reason: outcome.reason,
        startedAt,
        transactionHash: outcome.transactionHash,
        receipt: outcome.receipt,
        mode: 'alternative_capital',
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

  const facts: AlternativePreparedExecutionFacts = outcome.facts;
  ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
  const economics = await terminalEconomics({
    opportunity,
    grossProfit: facts.grossProfit,
    nativeFeeWei: facts.nativeFeeWei,
    sponsoredExecution: facts.sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: facts.sponsorOperatorMonetaryCostProvenZero,
  });
  const normalized = normalizedPreparedSettlement({
    opportunity,
    facts,
    economics,
    startedAt,
    venueOrRoute: `${facts.selection.source}:${opportunity.route.map(step => step.protocol).join('->')}`,
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
      facts.sponsoredExecution && facts.sponsorOperatorMonetaryCostProvenZero
        ? 'sponsored_gas:operator_cost_proven_zero'
        : 'system_owned_or_measured_sponsored_gas_cost',
      economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
    ],
  });
  const result = preparedResult({
    opportunity,
    facts,
    economics,
    normalized,
    startedAt,
    mode: 'alternative_capital',
  });
  await persistPreparedProfit({
    opportunity,
    result,
    facts,
    systemCapitalAttempt,
    profitRecipient,
    zeroExternalInputCapitalVerified: facts.intermediaryStarting === facts.intermediaryEnding,
  });
  logger.info('[ZeroCapitalExecutor] Canonical alternative-capital terminal result', {
    component: 'CanonicalZeroCapitalExecutor',
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    source: facts.selection.source,
    sourceAddress: facts.selection.sourceAddress,
    transactionHash: facts.transactionHash,
    settlementConfirmed: true,
    realizedNetProfitUsd: economics.netProfitUsd,
    strictPositiveSatisfied: result.success,
    minimumOutputProfitUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
    treasuryRecorded: result.treasuryRecorded === true,
    singleSchedulerAuthority: true,
  });
  return result;
}

async function executeCanonicalComposite(
  opportunity: ZeroCapitalOpportunity,
  target: CanonicalRuntimeContext,
  provider: providers.JsonRpcProvider,
  wallet: Wallet,
  startedAt: number,
): Promise<CanonicalZeroCapitalExecutionResult> {
  const selection = zeroCapitalCompositeSelectionRegistry.get(opportunity.id);
  if (!selection) return failed(opportunity, 'Prepared composite selection disappeared before execution');
  const profitRecipient = resolveOperationalProfitRecipient();
  const funding = await getProvenZeroCapitalGasFundingDecision(target as any, opportunity.chain);
  const systemCapitalAttempt = await prepareSystemCapitalAttempt(opportunity, profitRecipient, funding);
  getCryptocrawlGovernance().recordExecutionAttempt();
  const outcome = await executeCompositePreparedWithinCanonicalExecutor({
    opportunity, selection, provider, wallet, profitRecipient, funding, runtime: target,
  });
  if (!outcome.ok) {
    if (outcome.receipt?.status === 1 && outcome.transactionHash) {
      zeroCapitalCompositeSelectionRegistry.remove(opportunity.id);
      return confirmedPreparedReconciliationException({
        opportunity,
        reason: outcome.reason,
        startedAt,
        transactionHash: outcome.transactionHash,
        receipt: outcome.receipt,
        mode: 'composite_atomic',
      });
    }
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    if (outcome.submitted) zeroCapitalCompositeSelectionRegistry.remove(opportunity.id);
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

  const facts: CompositePreparedExecutionFacts = outcome.facts;
  zeroCapitalCompositeSelectionRegistry.remove(opportunity.id);
  const economics = await terminalEconomics({
    opportunity,
    grossProfit: facts.grossProfit,
    nativeFeeWei: facts.nativeFeeWei,
    sponsoredExecution: facts.sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: facts.sponsorOperatorMonetaryCostProvenZero,
  });
  const normalized = normalizedPreparedSettlement({
    opportunity,
    facts,
    economics,
    startedAt,
    venueOrRoute: `balancer_composite_v2:${selection.memberOpportunityIds.join('+')}`,
    provenance: [
      'canonical_zero_capital_single_executor',
      'canonical_zero_capital_composite_selection_registry',
      ...selection.provenance,
      'exact_pre_broadcast_eth_call_passed',
      'exact_pre_broadcast_gas_estimate_passed',
      'principal_plus_flash_fee_atomic_repayment_verified',
      'composite_receiver_terminal_balance_neutral',
      'operational_profit_recipient_delta:matches_composite_event',
      `required_target_net_bps:${selection.targetNetProfitBps}`,
      `minimum_output_profit_usd:${ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD}`,
      facts.sponsoredExecution && facts.sponsorOperatorMonetaryCostProvenZero
        ? 'sponsored_gas:operator_cost_proven_zero'
        : 'system_owned_or_measured_sponsored_gas_cost',
      economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
    ],
  });
  const result = preparedResult({
    opportunity,
    facts,
    economics,
    normalized,
    startedAt,
    targetNetProfitBaseUnits: selection.targetNetProfitBaseUnits,
    mode: 'composite_atomic',
  });
  await persistPreparedProfit({
    opportunity,
    result,
    facts,
    systemCapitalAttempt,
    profitRecipient,
    zeroExternalInputCapitalVerified: facts.receiverStarting === facts.receiverEnding,
  });
  logger.info('[ZeroCapitalExecutor] Canonical $5-clearing composite terminal result', {
    component: 'CanonicalZeroCapitalExecutor',
    opportunityId: opportunity.id,
    memberOpportunityIds: selection.memberOpportunityIds,
    chain: opportunity.chain,
    sharedPrincipal: selection.principal.toString(),
    minimumNetProfitBaseUnits: selection.targetNetProfitBaseUnits.toString(),
    minimumOutputProfitUsd: ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD,
    transactionHash: facts.transactionHash,
    settlementConfirmed: true,
    realizedNetProfitUsd: economics.netProfitUsd,
    strictPositiveSatisfied: result.success,
    principalRepaymentVerified: true,
    treasuryRecorded: result.treasuryRecorded === true,
    borrowingNotionalAuthority: false,
    singleSchedulerAuthority: true,
  });
  return result;
}

/**
 * Sole ZERO_CAPITAL_ATOMIC execution entrypoint. Stage 1 remains untouched; every
 * flash, alternative-capital, builder cold-start, and composite execution path must
 * enter here with fresh exact all-in expected profit of at least $5. BPS remains
 * observability/search data, while Profit Ladder remains telemetry only.
 */
export async function executeCanonicalZeroCapitalOpportunity(
  opportunity: ZeroCapitalOpportunity,
): Promise<CanonicalZeroCapitalExecutionResult> {
  const startedAt = Date.now();
  if (opportunity.chain === 'europa') return failed(opportunity, 'Europa execution is retired');
  const floor = evaluateFiveDollarOutputFloor(opportunity, startedAt);
  if (!floor.satisfied) {
    const detail = floor.expectedProfitUsd === null ? floor.reason : `$${floor.expectedProfitUsd.toFixed(8)}`;
    return failed(
      opportunity,
      `Canonical all-in net economics do not clear $${ZERO_CAPITAL_MINIMUM_OUTPUT_PROFIT_USD} output floor (${detail})`,
    );
  }

  void observeDailyProfitBudget(opportunity);

  const composite = zeroCapitalCompositeSelectionRegistry.get(opportunity.id);
  const compositeParent = opportunity.id.startsWith(COMPOSITE_ID_PREFIX);
  if (compositeParent && !composite) {
    return failed(opportunity, 'Composite parent has no fresh exact prepared selection; single-route fallback is prohibited');
  }

  if (!composite) {
    const alternative = ghostWalletAlternativeZeroCapitalSelectionRegistry.get(opportunity.id);
    if (!alternative) return executeFlashCanonicalZeroCapitalOpportunity(opportunity);
    if (
      flashLoanProviderSelectionRegistry.get(opportunity.id)
      || builderSponsoredZeroCapitalRegistry.get(opportunity.id)
    ) {
      ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
      return executeFlashCanonicalZeroCapitalOpportunity(opportunity);
    }
  }

  const target = runtime();
  const provider = target.providers.get(opportunity.chain);
  const wallet = target.executionWallets.get(opportunity.chain);
  if (!provider || !wallet) return failed(opportunity, 'Provider or execution wallet is unavailable');

  const governance = getCryptocrawlGovernance();
  const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opportunity.chain, pair });
  governance.requireAllowed('SUBMIT_TX', { chain: opportunity.chain, pair });

  if (composite) return executeCanonicalComposite(opportunity, target, provider, wallet, startedAt);
  return executeCanonicalAlternative(opportunity, target, provider, wallet, startedAt);
}
