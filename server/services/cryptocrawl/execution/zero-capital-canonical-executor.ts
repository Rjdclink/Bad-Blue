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
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import { buildDualFlashLoanReceiverPayload } from './adapters/dual-flashloan-receiver-builder.js';
import { buildFlashLoanReceiverPayloadFromPlan } from './adapters/flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry } from './adapters/flash-loan-provider-selection-registry.js';
import { evaluateZeroCapitalRealizedProfit } from './zero-capital-realized-profit-policy.js';
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
}): Promise<ReturnType<typeof evaluateZeroCapitalRealizedProfit>> {
  const symbols = [input.opportunity.inputAssetSymbol];
  const nativeSymbol = input.sponsoredExecution ? null : NATIVE_SYMBOL[input.opportunity.chain] || null;
  if (nativeSymbol) symbols.push(nativeSymbol as any);
  let prices = new Map<string, number>();
  try { prices = await coinGeckoPriceClient.getLiveSymbolPrices([...new Set(symbols)]); } catch { /* fail closed below */ }
  return evaluateZeroCapitalRealizedProfit({
    grossProfitBaseUnits: input.grossProfit,
    inputTokenDecimals: input.opportunity.inputTokenDecimals,
    inputTokenUsdPrice: prices.get(input.opportunity.inputAssetSymbol) ?? null,
    sponsoredExecution: input.sponsoredExecution,
    nativeFeeWei: input.nativeFeeWei,
    nativeUsdPrice: nativeSymbol ? prices.get(nativeSymbol) ?? null : null,
  });
}

function normalizedSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  startedAt: number;
  grossProfit: bigint;
  economics: ReturnType<typeof evaluateZeroCapitalRealizedProfit>;
  sponsoredExecution: boolean;
  providerLabel: string;
}): NormalizedRealizedExecution {
  const { opportunity, receipt, economics } = input;
  const positive = economics.economicsComplete && economics.positiveAfterAllInCost;
  const predictedPrice = Number(opportunity.inputAssetUsdPrice || 0);
  const predictedProfitUsd = predictedPrice > 0
    ? Number(ethers.utils.formatUnits(opportunity.expectedProfit.toString(), opportunity.inputTokenDecimals)) * predictedPrice
    : 0;
  return {
    status: positive ? 'filled' : 'failed',
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
      effectiveGasPriceWei: receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: economics.netProfitUsd,
    },
    provenance: [
      'canonical_zero_capital_single_executor',
      'canonical_provider_selection_registry',
      'exact_pre_broadcast_eth_call_and_gas_estimate',
      'receiver_starting_loan_token_balance_zero',
      'receiver_event:gross_profit',
      'operational_profit_recipient_delta:matches_receiver_event',
      input.sponsoredExecution ? 'sponsored_gas:user_native_cost_zero_verified' : 'system_owned_native_receipt_gas:measured',
      economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
      'synthetic_evidence:false',
    ],
    transactionHash: input.transactionHash,
    blockNumber: receipt.blockNumber,
    receiptStatus: receipt.status as 0 | 1,
  };
}

/**
 * Sole ZERO_CAPITAL_ATOMIC execution route. The canonical parent scheduler is the
 * only caller. Discovery/provider selection can make a candidate eligible, but
 * this function independently requires exact freshness, strict zero-personal-cost
 * gas proof, current provider selection, exact pre-broadcast simulation, terminal
 * receipt evidence, recipient-delta proof, realized all-in economics, and the
 * fixed canonical treasury ledger.
 */
export async function executeCanonicalZeroCapitalOpportunity(
  opportunity: ZeroCapitalOpportunity,
): Promise<CanonicalZeroCapitalExecutionResult> {
  const startedAt = Date.now();
  const target = runtime();
  if (opportunity.chain === 'europa') return failed(opportunity, 'Europa execution is retired');
  if (Date.now() >= opportunity.expiresAt) return failed(opportunity, 'Exact zero-capital opportunity expired before canonical execution');
  if (opportunity.expectedProfit <= 0n || !(opportunity.netProfitBps > 0)) return failed(opportunity, 'Canonical all-in net economics are not strictly positive');

  const provider = target.providers.get(opportunity.chain);
  const wallet = target.executionWallets.get(opportunity.chain);
  const selection = flashLoanProviderSelectionRegistry.get(opportunity.id);
  if (!provider || !wallet || !selection) return failed(opportunity, 'Provider, execution wallet, or canonical flash-provider selection is unavailable');
  if (selection.expiresAt <= Date.now()) return failed(opportunity, 'Canonical flash-provider selection expired before execution');
  if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) return failed(opportunity, 'Selected receiver owner no longer matches canonical execution wallet');
  if (selection.kind === 'dual' && selection.balancerAmount + selection.aaveAmount !== opportunity.flashLoanAmount) return failed(opportunity, 'Selected dual-provider principal no longer matches exact opportunity notional');

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

  const governance = getCryptocrawlGovernance();
  const pair = `${opportunity.inputAssetSymbol}/CYCLIC`;
  governance.requireAllowed('EXECUTE_OPPORTUNITY', { chain: opportunity.chain, pair });
  governance.requireAllowed('SUBMIT_TX', { chain: opportunity.chain, pair });

  const receiver = selection.receiver;
  const profitRecipient = resolveOperationalProfitRecipient();
  const token = new Contract(opportunity.inputToken, ERC20_BALANCE_ABI, provider);
  const [receiverStartingRaw, recipientStartingRaw] = await Promise.all([
    token.balanceOf(receiver), token.balanceOf(profitRecipient),
  ]);
  const receiverStarting = BigInt(receiverStartingRaw.toString());
  const recipientStarting = BigInt(recipientStartingRaw.toString());
  if (receiverStarting !== 0n) return failed(opportunity, `Selected receiver starting loan-token balance is nonzero: ${receiverStarting.toString()}`);

  let systemCapitalAttempt: SponsoredSystemCapitalAttempt | null = null;
  if (funding.mode === 'sponsored') {
    try {
      systemCapitalAttempt = await prepareSponsoredSystemCapital({
        chain: opportunity.chain,
        inputToken: opportunity.inputToken,
        profitRecipient,
        opportunityId: opportunity.id,
      });
    } catch (error) {
      logger.warn('[ZeroCapitalExecutor] Sponsored system-capital bookkeeping preparation degraded without changing settlement truth', {
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
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    return failed(opportunity, 'Terminal receipt did not emit a positive FlashLoanExecuted profit', {
      submitted: true, transactionHash, txHash: transactionHash, receiptStatus: 1, blockNumber: receipt.blockNumber, latencyMs: Date.now() - startedAt,
    });
  }

  let recipientEnding: bigint;
  try {
    recipientEnding = BigInt((await token.balanceOf(profitRecipient)).toString());
  } catch (error) {
    return failed(opportunity, `Operational profit-recipient terminal balance is unavailable: ${error instanceof Error ? error.message : String(error)}`, {
      submitted: true, transactionHash, txHash: transactionHash, receiptStatus: 1, blockNumber: receipt.blockNumber, grossProfit, latencyMs: Date.now() - startedAt,
    });
  }
  const recipientDelta = recipientEnding - recipientStarting;
  if (recipientDelta !== grossProfit) {
    return failed(opportunity, `Receiver event profit does not equal operational profit-recipient delta: event=${grossProfit.toString()} delta=${recipientDelta.toString()}`, {
      submitted: true, transactionHash, txHash: transactionHash, receiptStatus: 1, blockNumber: receipt.blockNumber, grossProfit, latencyMs: Date.now() - startedAt,
    });
  }

  const economics = await terminalEconomics({ opportunity, grossProfit, nativeFeeWei, sponsoredExecution });
  const normalized = normalizedSettlement({
    opportunity, transactionHash, receipt, startedAt, grossProfit, economics, sponsoredExecution,
    providerLabel: selection.provider,
  });
  const positive = economics.economicsComplete && economics.positiveAfterAllInCost;
  let result: CanonicalZeroCapitalExecutionResult = {
    opportunityId: opportunity.id,
    submitted: true,
    settlementConfirmed: true,
    status: positive ? 'filled' : 'failed',
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
    zeroMonetaryGasVerified: sponsoredExecution,
    realizedFeeUsd: economics.gasUsd ?? undefined,
    latencyMs: Date.now() - startedAt,
    blockNumber: receipt.blockNumber,
    normalized,
    error: economics.economicsComplete
      ? positive ? undefined : 'Terminal settlement realized non-positive all-in net profit'
      : `Terminal settlement realized economics are incomplete: ${economics.missingInformation.join(', ')}`,
  };

  const feedback = executionFeedback(opportunity, result);
  if (feedback) {
    await recordCryptaraExecutionEvidence(feedback).catch(error => {
      logger.warn('[ZeroCapitalExecutor] Terminal learning feedback persistence degraded', {
        component: 'CanonicalZeroCapitalExecutor', opportunityId: opportunity.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  if (positive && feedback) {
    try {
      const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
      result.treasuryRecorded = allocation !== null;
      if (allocation && sponsoredExecution && systemCapitalAttempt) {
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
    treasuryRecorded: result.treasuryRecorded === true,
    capitalProvenanceVerified: result.capitalProvenanceVerified === true,
    singleSchedulerAuthority: true, runtimeMethodMutation: false,
  });
  return result;
}
