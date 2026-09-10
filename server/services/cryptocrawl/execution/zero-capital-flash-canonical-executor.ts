import { BigNumber, Contract, ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { zeroCapitalEngine, type ExecutionResult, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import { buildDualFlashLoanReceiverPayload } from './adapters/dual-flashloan-receiver-builder.js';
import { buildFlashLoanReceiverPayloadFromPlan } from './adapters/flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry } from './adapters/flash-loan-provider-selection-registry.js';
import { buildMissingReceiverPermissionCalls, verifyFlashLoanReceiverCapability } from './adapters/flash-loan-receiver-capability.js';
import { getSponsoredReceiverManager } from './adapters/sponsored-receiver-manager.js';
import {
  builderSponsoredZeroCapitalRegistry,
  submitPreparedBuilderSponsoredZeroCapital,
  type BuilderSponsoredZeroCapitalEvidence,
} from './builder-sponsored-zero-capital-coldstart.js';
import { evaluateZeroCapitalRealizedProfit, type ZeroCapitalRealizedProfitDecision } from './zero-capital-realized-profit-policy.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';
import { evaluateZeroCapitalDynamicAttemptBarrier } from '../integration/zero-capital-dynamic-attempt-barrier-wiring.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import {
  persistVerifiedSponsoredProfit,
  prepareSponsoredSystemCapital,
  releaseFailedSponsoredBootstrap,
  type SponsoredSystemCapitalAttempt,
} from '../runtime/system-capital-provenance.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator, address indexed loanToken, uint256 loanAmount, uint256 profit)',
]);
const TREASURY_FRACTION_SCALE = 100_000_000n;
const NATIVE_SYMBOL: Partial<Record<SupportedChain, 'ETH' | 'POL' | 'BNB' | 'AVAX'>> = {
  ethereum: 'ETH', polygon: 'POL', arbitrum: 'ETH', optimism: 'ETH', bsc: 'BNB', avalanche: 'AVAX',
};

interface CanonicalRuntimeContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  gasSponsor: {
    getReadiness: () => { ready: boolean };
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
}

export interface CanonicalZeroCapitalExecutionResult extends ExecutionResult {
  opportunityId: string;
  submitted: boolean;
  settlementConfirmed: boolean;
  status: 'deferred' | 'failed' | 'filled' | 'settlement_unknown';
  transactionHash?: string;
  grossProfit?: bigint;
  economicsVerified?: boolean;
  capitalProvenanceVerified?: boolean;
  treasuryRecorded?: boolean;
  executionConfirmed?: boolean;
  economicReconciliationStatus?: 'not_started' | 'pending' | 'confirmed' | 'exception';
}

function runtime(): CanonicalRuntimeContext {
  return zeroCapitalEngine as unknown as CanonicalRuntimeContext;
}

function splitGrossBaseUnits(grossProfitBaseUnits: bigint, retainedFraction: number) {
  if (grossProfitBaseUnits <= 0n) throw new Error('Gross settled profit must be positive before treasury split');
  const bounded = Math.max(0, Math.min(Number(TREASURY_FRACTION_SCALE), Math.floor(retainedFraction * Number(TREASURY_FRACTION_SCALE))));
  const retainedProfitBaseUnits = (grossProfitBaseUnits * BigInt(bounded)) / TREASURY_FRACTION_SCALE;
  return { retainedProfitBaseUnits, payoutReservedBaseUnits: grossProfitBaseUnits - retainedProfitBaseUnits };
}

function extractProfit(receipt: providers.TransactionReceipt, receiver: string): bigint | null {
  for (const entry of receipt.logs) {
    if (entry.address.toLowerCase() !== receiver.toLowerCase()) continue;
    try {
      const parsed = RECEIVER_EVENT.parseLog(entry);
      if (parsed.name === 'FlashLoanExecuted') return BigInt(parsed.args.profit.toString());
    } catch {
      // Ignore unrelated receiver logs.
    }
  }
  return null;
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

function failed(opportunity: ZeroCapitalOpportunity, reason: string, extra: Partial<CanonicalZeroCapitalExecutionResult> = {}): CanonicalZeroCapitalExecutionResult {
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

async function terminalEconomics(input: {
  opportunity: ZeroCapitalOpportunity;
  grossProfit: bigint;
  nativeFeeWei: bigint;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}): Promise<ReturnType<typeof evaluateZeroCapitalRealizedProfit>> {
  const symbols = [input.opportunity.inputAssetSymbol];
  const sponsorCostProvenZero = input.sponsoredExecution && input.sponsorOperatorMonetaryCostProvenZero === true;
  const nativeSymbol = sponsorCostProvenZero ? null : NATIVE_SYMBOL[input.opportunity.chain] || null;
  if (nativeSymbol) symbols.push(nativeSymbol as any);
  let prices = new Map<string, number>();
  try { prices = await coinGeckoPriceClient.getLiveSymbolPrices([...new Set(symbols)]); } catch { /* fail closed below */ }
  return evaluateZeroCapitalRealizedProfit({
    grossProfitBaseUnits: input.grossProfit,
    inputTokenDecimals: input.opportunity.inputTokenDecimals,
    inputTokenUsdPrice: prices.get(input.opportunity.inputAssetSymbol) ?? null,
    sponsoredExecution: input.sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: input.sponsorOperatorMonetaryCostProvenZero === true,
    nativeFeeWei: input.nativeFeeWei,
    nativeUsdPrice: nativeSymbol ? prices.get(nativeSymbol) ?? null : null,
  });
}

async function builderTerminalEconomics(input: {
  opportunity: ZeroCapitalOpportunity;
  grossProfit: bigint;
  residualProfit: bigint;
}): Promise<ZeroCapitalRealizedProfitDecision> {
  let prices = new Map<string, number>();
  try { prices = await coinGeckoPriceClient.getLiveSymbolPrices([input.opportunity.inputAssetSymbol]); } catch { /* fail closed below */ }
  const price = prices.get(input.opportunity.inputAssetSymbol);
  if (!Number.isFinite(price) || Number(price) <= 0) {
    return {
      economicsComplete: false,
      grossProfitUsd: 0,
      gasUsd: null,
      netProfitUsd: null,
      netProfitBaseUnits: null,
      positiveAfterAllInCost: false,
      missingInformation: ['live_input_token_usd_price_for_builder_realized_profit'],
    };
  }
  const decimals = input.opportunity.inputTokenDecimals;
  const gross = Number(ethers.utils.formatUnits(input.grossProfit.toString(), decimals)) * Number(price);
  const residual = Number(ethers.utils.formatUnits(input.residualProfit.toString(), decimals)) * Number(price);
  const builderCost = Number(ethers.utils.formatUnits((input.grossProfit - input.residualProfit).toString(), decimals)) * Number(price);
  const complete = Number.isFinite(gross) && Number.isFinite(residual) && Number.isFinite(builderCost) && builderCost >= 0;
  return {
    economicsComplete: complete,
    grossProfitUsd: complete ? gross : 0,
    gasUsd: complete ? builderCost : null,
    netProfitUsd: complete ? residual : null,
    netProfitBaseUnits: complete ? input.residualProfit : null,
    positiveAfterAllInCost: complete && input.residualProfit > 0n,
    missingInformation: complete ? [] : ['finite_builder_realized_all_in_economics'],
  };
}

function normalizedSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  startedAt: number;
  grossProfit: bigint;
  economics: ZeroCapitalRealizedProfitDecision;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
  providerLabel: string;
  builderExecution?: boolean;
  builderReceiverBootstrap?: boolean;
}): NormalizedRealizedExecution {
  const { opportunity, receipt, economics } = input;
  const predictedPrice = Number(opportunity.inputAssetUsdPrice || 0);
  const predictedProfitUsd = predictedPrice > 0
    ? Number(ethers.utils.formatUnits(opportunity.expectedProfit.toString(), opportunity.inputTokenDecimals)) * predictedPrice
    : 0;
  const provenance = input.builderExecution
    ? [
        'canonical_zero_capital_single_executor',
        input.builderReceiverBootstrap ? 'canonical_builder_receiver_bootstrap_evidence' : 'canonical_provider_selection_registry',
        input.builderReceiverBootstrap ? 'receiver_bootstrap:create2_deployment_and_permissions_same_atomic_bundle' : 'receiver_capability:preverified',
        'builder_bundle:exact_signed_execution_conversion_payment',
        'builder_private_bundle:requires_system_owned_native_sender_gas',
        'builder_payment_source:execution_created_value',
        'receiver_starting_loan_token_balance_zero',
        'receiver_event:gross_profit_before_builder_repayment',
        'operational_profit_recipient_delta:net_after_builder_repayment',
        'builder_repayment_cost:realized_input_token_delta',
        economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
        'synthetic_evidence:false',
      ]
    : [
        'canonical_zero_capital_single_executor',
        'canonical_provider_selection_registry',
        'exact_pre_broadcast_eth_call_and_gas_estimate',
        'receiver_starting_loan_token_balance_zero',
        'receiver_event:gross_profit',
        'operational_profit_recipient_delta:matches_receiver_event',
        input.sponsoredExecution
          ? input.sponsorOperatorMonetaryCostProvenZero === true
            ? 'sponsored_gas:operator_cost_proven_zero'
            : 'sponsored_gas:provider_fronted_receipt_cost_measured'
          : 'system_owned_native_receipt_gas:measured',
        economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
        'synthetic_evidence:false',
      ];
  return {
    status: receipt.status === 1 ? 'filled' : 'failed',
    terminal: true,
    settlementConfirmed: receipt.status === 1,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `${input.providerLabel}:${opportunity.route.map(step => step.protocol).join('->')}`,
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
      gasUsed: receipt.gasUsed?.toString() || null,
      effectiveGasPriceWei: input.builderExecution ? null : receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: economics.netProfitUsd,
    },
    provenance,
    transactionHash: input.transactionHash,
    blockNumber: receipt.blockNumber,
    receiptStatus: receipt.status as 0 | 1,
  };
}

function confirmedExecutionReconciliationException(input: {
  opportunity: ZeroCapitalOpportunity;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  startedAt: number;
  reason: string;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
  providerLabel: string;
  builderExecution?: boolean;
  builderReceiverBootstrap?: boolean;
  grossProfit?: bigint;
}): CanonicalZeroCapitalExecutionResult {
  const economics: ZeroCapitalRealizedProfitDecision = {
    economicsComplete: false,
    grossProfitUsd: 0,
    gasUsd: null,
    netProfitUsd: null,
    netProfitBaseUnits: null,
    positiveAfterAllInCost: false,
    missingInformation: [input.reason],
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
    grossProfit: input.grossProfit,
    economicsVerified: false,
    profitVerified: false,
    latencyMs: Date.now() - input.startedAt,
    normalized: normalizedSettlement({
      opportunity: input.opportunity,
      transactionHash: input.transactionHash,
      receipt: input.receipt,
      startedAt: input.startedAt,
      grossProfit: input.grossProfit ?? 0n,
      economics,
      sponsoredExecution: input.sponsoredExecution,
      sponsorOperatorMonetaryCostProvenZero: input.sponsorOperatorMonetaryCostProvenZero,
      providerLabel: input.providerLabel,
      builderExecution: input.builderExecution,
      builderReceiverBootstrap: input.builderReceiverBootstrap,
    }),
    error: input.reason,
  };
}

async function persistTerminalLearning(
  opportunity: ZeroCapitalOpportunity,
  result: CanonicalZeroCapitalExecutionResult,
): Promise<CryptaraExecutionFeedback | null> {
  const feedback = executionFeedback(opportunity, result);
  if (!feedback) return null;
  await recordCryptaraExecutionEvidence(feedback).catch(error => {
    logger.warn('[ZeroCapitalExecutor] Terminal learning feedback persistence degraded', {
      component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return feedback;
}

async function executeBuilderColdStart(input: {
  opportunity: ZeroCapitalOpportunity;
  evidence: BuilderSponsoredZeroCapitalEvidence;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  receiver: string;
  profitRecipient: string;
  receiverStarting: bigint;
  recipientStarting: bigint;
  startedAt: number;
  providerLabel: string;
}): Promise<CanonicalZeroCapitalExecutionResult> {
  const { opportunity, evidence, provider, wallet, receiver, profitRecipient, receiverStarting, recipientStarting, startedAt } = input;
  if (opportunity.chain !== 'ethereum' || evidence.inputToken.toLowerCase() !== opportunity.inputToken.toLowerCase()) {
    return failed(opportunity, 'Builder-sponsored evidence does not match the exact Ethereum opportunity');
  }

  // Standard EOA eth_sendBundle does not remove the protocol requirement that the
  // sender can fund its own gas. Keep this private-bundle path only after native gas
  // is already proven system-owned; true zero-initial startup uses the paymaster lane.
  const builderFunding = await getProvenZeroCapitalGasFundingDecision(runtime(), opportunity.chain);
  if (builderFunding.mode !== 'native' || builderFunding.paymentSource !== 'system_owned_native') {
    return {
      ...failed(opportunity, 'Legacy EOA builder cold-start is not zero-native-capital authority; canonical paymaster or proven system-owned native gas is required'),
      status: 'deferred',
    };
  }

  if (evidence.receiver.toLowerCase() !== receiver.toLowerCase() || evidence.providerLabel !== input.providerLabel) {
    return failed(opportunity, 'Builder-sponsored receiver/provider evidence no longer matches canonical execution input');
  }
  if (evidence.guaranteedNetProfitInInputToken !== opportunity.expectedProfit || evidence.expiresAt <= Date.now()) {
    return failed(opportunity, 'Builder-sponsored economics evidence is stale or no longer matches canonical net profit');
  }
  if (evidence.receiverBootstrap) {
    if (evidence.receiverBootstrap.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return failed(opportunity, 'Builder receiver-bootstrap owner no longer matches canonical execution wallet');
    }
    requireZeroCapitalInfrastructureDeploymentAllowed({ chain: 'ethereum', operation: 'receiver_deployment' });
    const codeBefore = await provider.getCode(receiver);
    if (codeBefore !== '0x') {
      return {
        ...failed(opportunity, 'Prepared receiver-bootstrap bundle is stale because the deterministic receiver is already deployed'),
        status: 'deferred',
      };
    }
  }

  getCryptocrawlGovernance().recordExecutionAttempt();
  const submitted = await submitPreparedBuilderSponsoredZeroCapital({ opportunityId: opportunity.id, provider });
  if (!submitted) {
    return {
      ...failed(opportunity, 'All prepared builder-sponsored lanes definitively failed before inclusion'),
      status: 'deferred',
    };
  }
  const transactionHash = submitted.executionTransactionHash;
  if (submitted.result.status === 'ambiguous') {
    return failed(opportunity, `Builder-sponsored bundle acceptance is ambiguous and will not be raced: ${submitted.result.reason || 'reconciliation pending'}`, {
      submitted: true,
      transactionHash,
      txHash: transactionHash,
      status: 'settlement_unknown',
      latencyMs: Date.now() - startedAt,
    });
  }
  if (submitted.result.status !== 'confirmed') {
    return {
      ...failed(opportunity, submitted.result.reason || 'Builder-sponsored bundle did not land'),
      status: 'deferred',
    };
  }

  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (!receipt || receipt.status !== 1) {
    return failed(opportunity, 'Confirmed builder bundle is missing the successful flash-loan execution receipt', {
      submitted: true,
      transactionHash,
      txHash: transactionHash,
      status: 'settlement_unknown',
      latencyMs: Date.now() - startedAt,
    });
  }
  if (evidence.receiverBootstrap) {
    const verified = await getSponsoredReceiverManager().inspectExistingReceiver({
      chain: 'ethereum',
      provider,
      owner: wallet.address,
    }).catch(() => null);
    if (!verified || verified.address.toLowerCase() !== receiver.toLowerCase()) {
      return confirmedExecutionReconciliationException({
        opportunity, transactionHash, receipt, startedAt,
        reason: 'Builder bundle landed but deterministic receiver bootstrap could not be verified',
        sponsoredExecution: false, providerLabel: input.providerLabel,
        builderExecution: true, builderReceiverBootstrap: true,
      });
    }
  }
  const grossProfit = extractProfit(receipt, receiver);
  if (grossProfit === null || grossProfit <= 0n) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt,
      reason: 'Builder bundle flash-loan receipt did not emit positive gross profit',
      sponsoredExecution: false, providerLabel: input.providerLabel,
      builderExecution: true, builderReceiverBootstrap: Boolean(evidence.receiverBootstrap),
    });
  }

  const token = new Contract(opportunity.inputToken, ERC20_BALANCE_ABI, provider);
  let recipientEnding: bigint;
  try {
    recipientEnding = BigInt((await token.balanceOf(profitRecipient)).toString());
  } catch (error) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt, grossProfit,
      reason: `Builder terminal profit-recipient balance is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      sponsoredExecution: false, providerLabel: input.providerLabel,
      builderExecution: true, builderReceiverBootstrap: Boolean(evidence.receiverBootstrap),
    });
  }
  const residualProfit = recipientEnding - recipientStarting;
  if (residualProfit <= 0n || residualProfit >= grossProfit) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt, grossProfit,
      reason: `Builder terminal stablecoin delta is inconsistent with positive gross-profit repayment: gross=${grossProfit.toString()} residual=${residualProfit.toString()}`,
      sponsoredExecution: false, providerLabel: input.providerLabel,
      builderExecution: true, builderReceiverBootstrap: Boolean(evidence.receiverBootstrap),
    });
  }
  const realizedBuilderCostBaseUnits = grossProfit - residualProfit;
  if (realizedBuilderCostBaseUnits > evidence.builderGasCostInInputToken) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt, grossProfit,
      reason: `Builder repayment exceeded the exact admitted stablecoin cost ceiling: realized=${realizedBuilderCostBaseUnits.toString()} ceiling=${evidence.builderGasCostInInputToken.toString()}`,
      sponsoredExecution: false, providerLabel: input.providerLabel,
      builderExecution: true, builderReceiverBootstrap: Boolean(evidence.receiverBootstrap),
    });
  }

  const economics = await builderTerminalEconomics({ opportunity, grossProfit, residualProfit });
  const normalized = normalizedSettlement({
    opportunity,
    transactionHash,
    receipt,
    startedAt,
    grossProfit,
    economics,
    sponsoredExecution: false,
    builderExecution: true,
    builderReceiverBootstrap: Boolean(evidence.receiverBootstrap),
    providerLabel: input.providerLabel,
  });
  const positive = economics.economicsComplete && economics.positiveAfterAllInCost;
  const result: CanonicalZeroCapitalExecutionResult = {
    opportunityId: opportunity.id,
    submitted: true,
    settlementConfirmed: true,
    executionConfirmed: true,
    economicReconciliationStatus: economics.economicsComplete ? 'confirmed' : 'pending',
    status: 'filled',
    success: positive,
    txHash: transactionHash,
    transactionHash,
    grossProfit,
    profit: economics.netProfitBaseUnits ?? undefined,
    profitVerified: positive,
    economicsVerified: economics.economicsComplete,
    receiptStatus: 1,
    nativeFeeWei: receipt.effectiveGasPrice ? BigInt(receipt.gasUsed.toString()) * BigInt(receipt.effectiveGasPrice.toString()) : 0n,
    zeroMonetaryGasVerified: false,
    realizedFeeUsd: economics.gasUsd ?? undefined,
    latencyMs: Date.now() - startedAt,
    blockNumber: receipt.blockNumber,
    normalized,
    capitalProvenanceVerified: false,
    error: positive ? undefined : economics.economicsComplete
      ? 'Builder-funded terminal settlement realized non-positive residual profit'
      : `Builder-funded terminal economics are incomplete: ${economics.missingInformation.join(', ')}`,
  };

  const feedback = await persistTerminalLearning(opportunity, result);
  if (positive && feedback) {
    try {
      const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
      result.treasuryRecorded = allocation !== null;
    } catch (error) {
      logger.error('[ZeroCapitalExecutor] Builder-funded terminal profit preserved but treasury persistence requires reconciliation', {
        component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id, transactionHash,
        error: error instanceof Error ? error.message : String(error), settlementTruthPreserved: true,
      });
    }
  }

  logger.info('[ZeroCapitalExecutor] Builder private-bundle terminal result', {
    component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id, chain: opportunity.chain,
    provider: input.providerLabel, builder: submitted.candidate.builder, transactionHash,
    bundleHash: submitted.result.bundleHash, settlementConfirmed: true,
    receiverBootstrappedInBundle: Boolean(evidence.receiverBootstrap),
    grossProfitBaseUnits: grossProfit.toString(), realizedBuilderCostBaseUnits: realizedBuilderCostBaseUnits.toString(),
    residualProfitBaseUnits: residualProfit.toString(), realizedNetProfitUsd: economics.netProfitUsd,
    realizedBuilderCostUsd: economics.gasUsd, positiveAfterAllInCost: positive,
    operatorNativeGasInputRequired: false, systemOwnedNativeGasRequired: true,
    receiverStartingBalanceZero: receiverStarting === 0n,
    treasuryRecorded: result.treasuryRecorded === true, singleSchedulerAuthority: true,
  });
  return result;
}

/**
 * Sole ZERO_CAPITAL_ATOMIC execution route. The canonical parent scheduler is the
 * only caller. Provider paymaster sponsorship is the cold-start authority because
 * it can remove the execution account's native-balance prerequisite. Legacy EOA
 * builder bundles are private-inclusion transports only and require already-proven
 * system-owned native sender gas.
 */
export async function executeCanonicalZeroCapitalOpportunity(
  opportunity: ZeroCapitalOpportunity,
): Promise<CanonicalZeroCapitalExecutionResult> {
  const startedAt = Date.now();
  const target = runtime();
  if (opportunity.chain === 'europa') return failed(opportunity, 'Europa execution is retired');
  if (Date.now() >= opportunity.expiresAt) return failed(opportunity, 'Exact zero-capital opportunity expired before canonical execution');
  if (opportunity.expectedProfit <= 0n) return failed(opportunity, 'Canonical all-in net economics are not strictly positive');

  const provider = target.providers.get(opportunity.chain);
  const wallet = target.executionWallets.get(opportunity.chain);
  if (!provider || !wallet) return failed(opportunity, 'Provider or execution wallet is unavailable');

  const governance = getCryptocrawlGovernance();
  const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opportunity.chain, pair });
  governance.requireAllowed('SUBMIT_TX', { chain: opportunity.chain, pair });

  const profitRecipient = resolveOperationalProfitRecipient();
  const token = new Contract(opportunity.inputToken, ERC20_BALANCE_ABI, provider);
  let builderEvidence = builderSponsoredZeroCapitalRegistry.get(opportunity.id);

  if (builderEvidence?.receiverBootstrap) {
    if (opportunity.chain !== 'ethereum') return failed(opportunity, 'First-receiver builder bootstrap is Ethereum-only');
    if (builderEvidence.receiverBootstrap.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      return failed(opportunity, 'First-receiver builder bootstrap owner does not match canonical execution wallet');
    }
    const code = await provider.getCode(builderEvidence.receiver);
    if (code !== '0x' && builderEvidence.bootstrapProviderEconomics) {
      const capability = await verifyFlashLoanReceiverCapability({
        kind: 'balancer_v1', chain: 'ethereum', provider,
        expectedOwner: wallet.address, address: builderEvidence.receiver,
      }).catch(() => null);
      const missingPermissions = capability
        ? await buildMissingReceiverPermissionCalls({
            chain: 'ethereum', provider, receiver: capability.address, route: opportunity.route,
          }).catch(() => [{ reason: 'receiver_permission_revalidation_failed' }])
        : [{ reason: 'receiver_capability_revalidation_failed' }];
      if (capability && missingPermissions.length === 0) {
        flashLoanProviderSelectionRegistry.record({
          kind: 'single', opportunityId: opportunity.id, provider: 'balancer_v2',
          receiver: capability.address, economics: builderEvidence.bootstrapProviderEconomics,
          receiverCapability: capability, selectedAt: Date.now(), expiresAt: builderEvidence.expiresAt,
          provenance: [...builderEvidence.provenance, 'receiver_appeared:fell_through_to_verified_standard_path'],
        });
        builderSponsoredZeroCapitalRegistry.remove(opportunity.id);
        builderEvidence = null;
      }
    }
    if (builderEvidence) {
      const [receiverStartingRaw, recipientStartingRaw] = await Promise.all([
        token.balanceOf(builderEvidence.receiver), token.balanceOf(profitRecipient),
      ]);
      const receiverStarting = BigInt(receiverStartingRaw.toString());
      const recipientStarting = BigInt(recipientStartingRaw.toString());
      if (receiverStarting !== 0n) {
        return failed(opportunity, `Predicted bootstrap receiver starting loan-token balance is nonzero: ${receiverStarting.toString()}`);
      }
      return executeBuilderColdStart({
        opportunity,
        evidence: builderEvidence,
        provider,
        wallet,
        receiver: builderEvidence.receiver,
        profitRecipient,
        receiverStarting,
        recipientStarting,
        startedAt,
        providerLabel: builderEvidence.providerLabel,
      });
    }
  }

  const selection = flashLoanProviderSelectionRegistry.get(opportunity.id);
  if (!selection) return failed(opportunity, 'Canonical flash-provider selection is unavailable');
  if (selection.expiresAt <= Date.now()) return failed(opportunity, 'Canonical flash-provider selection expired before execution');
  if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) return failed(opportunity, 'Selected receiver owner no longer matches canonical execution wallet');
  if (selection.kind === 'dual' && selection.balancerAmount + selection.aaveAmount !== opportunity.flashLoanAmount) return failed(opportunity, 'Selected dual-provider principal no longer matches exact opportunity notional');

  const receiver = selection.receiver;
  const [receiverStartingRaw, recipientStartingRaw] = await Promise.all([
    token.balanceOf(receiver), token.balanceOf(profitRecipient),
  ]);
  const receiverStarting = BigInt(receiverStartingRaw.toString());
  const recipientStarting = BigInt(recipientStartingRaw.toString());
  if (receiverStarting !== 0n) return failed(opportunity, `Selected receiver starting loan-token balance is nonzero: ${receiverStarting.toString()}`);

  if (builderEvidence) {
    return executeBuilderColdStart({
      opportunity,
      evidence: builderEvidence,
      provider,
      wallet,
      receiver,
      profitRecipient,
      receiverStarting,
      recipientStarting,
      startedAt,
      providerLabel: selection.provider,
    });
  }

  const funding = await getProvenZeroCapitalGasFundingDecision(target, opportunity.chain);
  if (funding.mode === 'unavailable' || funding.strictZeroInitialCapitalEligible !== true || funding.operatorMonetaryInputRequired !== false) {
    return failed(opportunity, `Strict zero-capital gas funding is unavailable: ${funding.reason}`);
  }
  if (funding.mode === 'native' && funding.paymentSource !== 'system_owned_native') {
    return failed(opportunity, 'Native gas is not proven system-owned');
  }
  if (funding.mode === 'sponsored' && funding.paymentSource !== 'provider_sponsored') {
    return failed(opportunity, 'Sponsored gas payment source is not canonical');
  }

  const barrier = await evaluateZeroCapitalDynamicAttemptBarrier({
    providers: target.providers,
    executionWallets: target.executionWallets,
    receiverManager: target.receiverManager,
    getGasFundingDecision: chain => getProvenZeroCapitalGasFundingDecision(target, chain),
  }, opportunity);
  if (!barrier.approved) {
    return {
      ...failed(opportunity, barrier.reason),
      status: 'deferred',
    };
  }

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
      logger.warn('[ZeroCapitalExecutor] Zero-cost sponsored system-capital bookkeeping preparation degraded without changing settlement truth', {
        component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let plan;
  let payload: { to: string; data: string; value: string | number };
  try {
    plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
      receiver,
      provider: selection.kind === 'single' ? selection.provider : 'balancer_v2',
      profitRecipient,
      nowMs: Date.now(),
    });
    payload = selection.kind === 'dual'
      ? buildDualFlashLoanReceiverPayload({
          chain: plan.chain,
          receiver,
          loanToken: plan.loanToken,
          balancerAmount: selection.balancerAmount.toString(),
          aaveAmount: selection.aaveAmount.toString(),
          minProfit: plan.minProfit,
          profitRecipient: plan.profitRecipient,
          steps: plan.steps,
          gasLimit: Math.max(1_800_000, plan.gasLimit || 0),
        })
      : buildFlashLoanReceiverPayloadFromPlan(plan);
  } catch (error) {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    return failed(opportunity, `Canonical zero-capital payload construction failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  governance.recordExecutionAttempt();
  let transactionHash = '';
  let receipt: providers.TransactionReceipt | null = null;
  let nativeFeeWei = 0n;
  let sponsoredExecution = false;
  try {
    if (funding.mode === 'sponsored') {
      const network = await provider.getNetwork();
      const sponsored = await target.gasSponsor.execute({
        wallet,
        chainId: network.chainId,
        calls: [{ to: payload.to, data: payload.data, value: BigNumber.from(payload.value) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
      });
      transactionHash = sponsored.transactionHash;
      receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt) receipt = await provider.waitForTransaction(transactionHash, 1, 15_000);
      sponsoredExecution = true;
      if (receipt?.effectiveGasPrice) {
        nativeFeeWei = BigInt(receipt.gasUsed.toString()) * BigInt(receipt.effectiveGasPrice.toString());
      }
    } else {
      const native = await executeSystemOwnedNativeTransaction({
        chain: opportunity.chain,
        wallet,
        provider,
        idempotencyKey: `zero-capital:${opportunity.id}`,
        purpose: `zero_capital_${selection.provider}_flash_execution`,
        transaction: { to: payload.to, data: payload.data, value: BigNumber.from(payload.value) },
        confirmations: 1,
      });
      transactionHash = native.transactionHash;
      receipt = native.receipt;
      nativeFeeWei = native.actualSpentWei;
    }
  } catch (error) {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    return failed(opportunity, `Canonical zero-capital submission failed: ${error instanceof Error ? error.message : String(error)}`, {
      submitted: Boolean(transactionHash),
      transactionHash: transactionHash || undefined,
      txHash: transactionHash || undefined,
      latencyMs: Date.now() - startedAt,
    });
  }

  if (!receipt) {
    return failed(opportunity, 'Canonical zero-capital submission has no terminal receipt', {
      submitted: true, transactionHash, txHash: transactionHash, status: 'settlement_unknown', latencyMs: Date.now() - startedAt,
    });
  }
  if (receipt.status !== 1) {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    return failed(opportunity, 'Canonical zero-capital transaction reverted', {
      submitted: true, transactionHash, txHash: transactionHash, receiptStatus: 0, blockNumber: receipt.blockNumber, latencyMs: Date.now() - startedAt,
    });
  }

  const grossProfit = extractProfit(receipt, receiver);
  if (grossProfit === null || grossProfit <= 0n) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt,
      reason: 'Terminal receipt did not emit a positive FlashLoanExecuted profit',
      sponsoredExecution,
      sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
      providerLabel: selection.provider,
    });
  }

  let recipientEnding: bigint;
  try {
    recipientEnding = BigInt((await token.balanceOf(profitRecipient)).toString());
  } catch (error) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt, grossProfit,
      reason: `Operational profit-recipient terminal balance is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      sponsoredExecution,
      sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
      providerLabel: selection.provider,
    });
  }
  const recipientDelta = recipientEnding - recipientStarting;
  if (recipientDelta !== grossProfit) {
    return confirmedExecutionReconciliationException({
      opportunity, transactionHash, receipt, startedAt, grossProfit,
      reason: `Receiver event profit does not equal operational profit-recipient delta: event=${grossProfit.toString()} delta=${recipientDelta.toString()}`,
      sponsoredExecution,
      sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
      providerLabel: selection.provider,
    });
  }

  const economics = await terminalEconomics({
    opportunity,
    grossProfit,
    nativeFeeWei,
    sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
  });
  const normalized = normalizedSettlement({
    opportunity, transactionHash, receipt, startedAt, grossProfit, economics, sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
    providerLabel: selection.provider,
  });
  const positive = economics.economicsComplete && economics.positiveAfterAllInCost;
  const result: CanonicalZeroCapitalExecutionResult = {
    opportunityId: opportunity.id,
    submitted: true,
    settlementConfirmed: true,
    executionConfirmed: true,
    economicReconciliationStatus: economics.economicsComplete ? 'confirmed' : 'pending',
    status: 'filled',
    success: positive,
    txHash: transactionHash,
    transactionHash,
    grossProfit,
    profit: economics.netProfitBaseUnits ?? undefined,
    profitVerified: positive,
    economicsVerified: economics.economicsComplete,
    gasUsed: BigInt(receipt.gasUsed.toString()),
    effectiveGasPriceWei: receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : 0n,
    receiptStatus: 1,
    nativeFeeWei,
    zeroMonetaryGasVerified: sponsoredExecution && funding.sponsorOperatorMonetaryCostProvenZero === true,
    realizedFeeUsd: economics.gasUsd ?? undefined,
    latencyMs: Date.now() - startedAt,
    blockNumber: receipt.blockNumber,
    normalized,
    error: economics.economicsComplete
      ? positive ? undefined : 'Terminal settlement realized non-positive all-in net profit'
      : `Terminal settlement realized economics are incomplete: ${economics.missingInformation.join(', ')}`,
  };

  const feedback = await persistTerminalLearning(opportunity, result);
  if (positive && feedback) {
    try {
      const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
      result.treasuryRecorded = allocation !== null;
      if (allocation && sponsoredExecution && systemCapitalAttempt && funding.sponsorOperatorMonetaryCostProvenZero === true) {
        const split = splitGrossBaseUnits(grossProfit, allocation.retainedFraction);
        if (split.retainedProfitBaseUnits > 0n) {
          await persistVerifiedSponsoredProfit(systemCapitalAttempt, {
            transactionHash,
            chain: opportunity.chain,
            asset: opportunity.inputAssetSymbol,
            grossProfitBaseUnits: grossProfit,
            retainedProfitBaseUnits: split.retainedProfitBaseUnits,
            payoutReservedBaseUnits: split.payoutReservedBaseUnits,
            sourceRecipient: profitRecipient,
            sourceRecipientBalanceBeforeBaseUnits: recipientStarting,
            sourceRecipientBalanceAfterBaseUnits: recipientEnding,
            zeroOperatorMonetaryGasVerified: true,
            zeroExternalNativeCapitalVerified: true,
            zeroExternalInputCapitalVerified: receiverStarting === 0n,
          });
          result.capitalProvenanceVerified = true;
        }
      }
    } catch (error) {
      result.capitalProvenanceVerified = false;
      logger.error('[ZeroCapitalExecutor] Terminal profit preserved but treasury/system-capital persistence requires reconciliation', {
        component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id, transactionHash,
        error: error instanceof Error ? error.message : String(error),
        settlementTruthPreserved: true,
      });
    }
  } else {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
  }

  logger.info('[ZeroCapitalExecutor] Canonical zero-capital terminal result', {
    component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id, chain: opportunity.chain,
    provider: selection.provider, transactionHash, settlementConfirmed: true,
    grossProfitBaseUnits: grossProfit.toString(), realizedNetProfitUsd: economics.netProfitUsd,
    realizedGasUsd: economics.gasUsd, positiveAfterAllInCost: positive,
    sponsoredExecution,
    providerBillingLiability: funding.providerBillingLiability === true,
    zeroOperatorMonetaryGasVerified: funding.sponsorOperatorMonetaryCostProvenZero === true,
    treasuryRecorded: result.treasuryRecorded === true,
    capitalProvenanceVerified: result.capitalProvenanceVerified === true,
    singleSchedulerAuthority: true, runtimeMethodMutation: false,
  });
  return result;
}
