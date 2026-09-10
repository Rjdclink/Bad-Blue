import { BigNumber, Contract, ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import {
  ghostWalletAlternativeZeroCapitalSelectionRegistry,
  type GhostWalletAlternativeZeroCapitalSelection,
} from '../ghost-wallet/zero-capital-alternative-selection-registry.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';
import { evaluateZeroCapitalRealizedProfit } from './zero-capital-realized-profit-policy.js';
import type { NormalizedRealizedExecution } from './settlement-types.js';
import type { CanonicalZeroCapitalExecutionResult } from './zero-capital-canonical-executor.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const INTERMEDIARY_ABI = ['function profitRecipient() view returns (address)'];
const INTERMEDIARY_EVENTS = new ethers.utils.Interface([
  'event AtomicLiabilityCycleSettled(address indexed liabilityOracle,bytes32 indexed liabilityQueryHash,address indexed profitAsset,uint256 startingLiability,uint256 endingLiability,uint256 realizedProfit,address profitRecipient)',
  'event VaultCreditSettled(address indexed vault,address indexed asset,uint256 principal,uint256 sourceFee,uint256 realizedProfit,address indexed profitRecipient)',
]);
const NATIVE_SYMBOL: Partial<Record<SupportedChain, 'ETH' | 'POL' | 'BNB' | 'AVAX'>> = {
  ethereum: 'ETH', polygon: 'POL', arbitrum: 'ETH', optimism: 'ETH', bsc: 'BNB', avalanche: 'AVAX',
};

export interface CanonicalAlternativeRuntimeContext {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
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

interface AlternativeSettlementEvidence {
  realizedProfit: bigint;
  startingLiability?: bigint;
  endingLiability?: bigint;
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

function validateSelection(
  opportunity: ZeroCapitalOpportunity,
  selection: GhostWalletAlternativeZeroCapitalSelection,
  profitRecipient: string,
): string | null {
  if (selection.opportunityId !== opportunity.id) return 'Alternative-capital opportunity identity mismatch';
  if (selection.chain !== opportunity.chain) return 'Alternative-capital chain mismatch';
  if (selection.asset.toLowerCase() !== opportunity.inputToken.toLowerCase()) return 'Alternative-capital asset mismatch';
  if (selection.principal !== opportunity.flashLoanAmount) return 'Alternative-capital principal no longer matches exact opportunity notional';
  if (selection.expectedNetProfit !== opportunity.expectedProfit) return 'Alternative-capital economics no longer match canonical opportunity';
  if (selection.expiresAt <= Date.now() || opportunity.expiresAt <= Date.now()) return 'Alternative-capital selection expired before execution';
  if (selection.prepared.to.toLowerCase() !== selection.intermediary.toLowerCase()) return 'Alternative-capital prepared target is not the measured intermediary';
  if (selection.source === 'aave_credit_delegation' && selection.prepared.executionSurface !== 'atomic_liability_cycle') {
    return 'Aave delegated-credit selection has the wrong execution surface';
  }
  if (selection.source === 'permissionless_vault_capital' && selection.prepared.executionSurface !== 'vault_atomic_credit') {
    return 'Vault-capital selection has the wrong execution surface';
  }
  if (!ethers.utils.isAddress(profitRecipient)) return 'Canonical operational profit recipient is invalid';
  return null;
}

function extractSettlementEvidence(
  receipt: providers.TransactionReceipt,
  selection: GhostWalletAlternativeZeroCapitalSelection,
  profitRecipient: string,
): AlternativeSettlementEvidence | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== selection.intermediary.toLowerCase()) continue;
    try {
      const parsed = INTERMEDIARY_EVENTS.parseLog(log);
      if (selection.source === 'permissionless_vault_capital' && parsed.name === 'VaultCreditSettled') {
        if (String(parsed.args.vault).toLowerCase() !== selection.sourceAddress.toLowerCase()) continue;
        if (String(parsed.args.asset).toLowerCase() !== selection.asset.toLowerCase()) continue;
        if (BigInt(parsed.args.principal.toString()) !== selection.principal) continue;
        if (BigInt(parsed.args.sourceFee.toString()) !== selection.sourceFee) continue;
        if (String(parsed.args.profitRecipient).toLowerCase() !== profitRecipient.toLowerCase()) continue;
        const realizedProfit = BigInt(parsed.args.realizedProfit.toString());
        return realizedProfit > 0n ? { realizedProfit } : null;
      }
      if (selection.source === 'aave_credit_delegation' && parsed.name === 'AtomicLiabilityCycleSettled') {
        if (String(parsed.args.profitAsset).toLowerCase() !== selection.asset.toLowerCase()) continue;
        if (String(parsed.args.profitRecipient).toLowerCase() !== profitRecipient.toLowerCase()) continue;
        const startingLiability = BigInt(parsed.args.startingLiability.toString());
        const endingLiability = BigInt(parsed.args.endingLiability.toString());
        const realizedProfit = BigInt(parsed.args.realizedProfit.toString());
        if (endingLiability > startingLiability || realizedProfit <= 0n) return null;
        return { realizedProfit, startingLiability, endingLiability };
      }
    } catch {
      // Ignore unrelated intermediary events.
    }
  }
  return null;
}

async function terminalEconomics(input: {
  opportunity: ZeroCapitalOpportunity;
  realizedProfit: bigint;
  nativeFeeWei: bigint;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}) {
  const symbols = [input.opportunity.inputAssetSymbol];
  const sponsorCostProvenZero = input.sponsoredExecution && input.sponsorOperatorMonetaryCostProvenZero === true;
  const nativeSymbol = sponsorCostProvenZero ? null : NATIVE_SYMBOL[input.opportunity.chain] || null;
  if (nativeSymbol) symbols.push(nativeSymbol as any);
  let prices = new Map<string, number>();
  try { prices = await coinGeckoPriceClient.getLiveSymbolPrices([...new Set(symbols)]); } catch { /* fail closed below */ }
  return evaluateZeroCapitalRealizedProfit({
    grossProfitBaseUnits: input.realizedProfit,
    inputTokenDecimals: input.opportunity.inputTokenDecimals,
    inputTokenUsdPrice: prices.get(input.opportunity.inputAssetSymbol) ?? null,
    sponsoredExecution: input.sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: input.sponsorOperatorMonetaryCostProvenZero === true,
    nativeFeeWei: input.nativeFeeWei,
    nativeUsdPrice: nativeSymbol ? prices.get(nativeSymbol) ?? null : null,
  });
}

function normalizedSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  selection: GhostWalletAlternativeZeroCapitalSelection;
  transactionHash: string;
  receipt: providers.TransactionReceipt;
  startedAt: number;
  realizedProfit: bigint;
  economics: ReturnType<typeof evaluateZeroCapitalRealizedProfit>;
  sponsoredExecution: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
}): NormalizedRealizedExecution {
  const predictedPrice = Number(input.opportunity.inputAssetUsdPrice || 0);
  const predictedProfitUsd = predictedPrice > 0
    ? Number(ethers.utils.formatUnits(input.opportunity.expectedProfit.toString(), input.opportunity.inputTokenDecimals)) * predictedPrice
    : 0;
  return {
    status: input.receipt.status === 1 ? 'filled' : 'failed',
    terminal: true,
    settlementConfirmed: input.receipt.status === 1,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `alternative:${input.selection.source}:${input.opportunity.route.map(step => step.protocol).join('->')}`,
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
      gasUsed: input.receipt.gasUsed?.toString() || null,
      effectiveGasPriceWei: input.receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: input.economics.netProfitUsd,
    },
    provenance: [
      'canonical_zero_capital_single_executor',
      'canonical_alternative_capital_selection_registry',
      `alternative_capital_source:${input.selection.source}`,
      `alternative_capital_source_address:${input.selection.sourceAddress}`,
      'alternative_capital_intermediary_binding:verified',
      'exact_pre_broadcast_eth_call_and_gas_estimate',
      'same_transaction_source_repayment_or_liability_neutrality',
      'intermediary_terminal_event:realized_profit',
      'operational_profit_recipient_delta:matches_intermediary_event',
      input.sponsoredExecution
        ? input.sponsorOperatorMonetaryCostProvenZero === true
          ? 'sponsored_gas:operator_cost_proven_zero'
          : 'sponsored_gas:provider_fronted_receipt_cost_measured'
        : 'system_owned_native_receipt_gas:measured',
      input.economics.economicsComplete ? 'realized_all_in_net_profit' : 'realized_all_in_economics_incomplete',
      'profit_ladder_authority:canonical_arbitrage_only',
      'ghost_wallet_personal_payout_policy:not_applied_to_arbitrage',
      'synthetic_evidence:false',
    ],
    transactionHash: input.transactionHash,
    blockNumber: input.receipt.blockNumber,
    receiptStatus: input.receipt.status as 0 | 1,
  };
}

/**
 * Subordinate execution seam for already-measured non-flash atomic capital.
 * It has no independent scheduler or discovery authority. Returning null means
 * no alternative selection exists and the caller should continue its legacy path.
 */
export async function executeCanonicalAlternativeZeroCapitalOpportunity(input: {
  opportunity: ZeroCapitalOpportunity;
  runtime: CanonicalAlternativeRuntimeContext;
  profitRecipient: string;
}): Promise<CanonicalZeroCapitalExecutionResult | null> {
  const startedAt = Date.now();
  const { opportunity, runtime, profitRecipient } = input;
  const selection = ghostWalletAlternativeZeroCapitalSelectionRegistry.get(opportunity.id);
  if (!selection) return null;

  const mismatch = validateSelection(opportunity, selection, profitRecipient);
  if (mismatch) return failed(opportunity, mismatch);
  if (opportunity.chain === 'europa') return failed(opportunity, 'Europa execution is retired');

  const provider = runtime.providers.get(opportunity.chain);
  const wallet = runtime.executionWallets.get(opportunity.chain);
  if (!provider || !wallet) return failed(opportunity, 'Alternative-capital provider or execution wallet is unavailable');

  const intermediaryCode = await provider.getCode(selection.intermediary).catch(() => '0x');
  if (intermediaryCode === '0x') return failed(opportunity, 'Measured alternative-capital intermediary is not deployed');
  const intermediary = new Contract(selection.intermediary, INTERMEDIARY_ABI, provider);
  let boundProfitRecipient: string;
  try {
    boundProfitRecipient = ethers.utils.getAddress(String(await intermediary.profitRecipient()));
  } catch (error) {
    return failed(opportunity, `Alternative-capital payout binding is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (boundProfitRecipient.toLowerCase() !== profitRecipient.toLowerCase()) {
    return failed(opportunity, 'Alternative-capital intermediary payout binding no longer matches canonical arbitrage profit recipient');
  }

  const funding = await getProvenZeroCapitalGasFundingDecision(runtime, opportunity.chain);
  if (funding.mode === 'unavailable' || funding.strictZeroInitialCapitalEligible !== true || funding.operatorMonetaryInputRequired !== false) {
    return { ...failed(opportunity, `Strict zero-capital gas funding is unavailable: ${funding.reason}`), status: 'deferred' };
  }
  if (funding.mode === 'native' && funding.paymentSource !== 'system_owned_native') {
    return failed(opportunity, 'Alternative-capital native gas is not proven system-owned');
  }
  if (funding.mode === 'sponsored' && funding.paymentSource !== 'provider_sponsored') {
    return failed(opportunity, 'Alternative-capital sponsored gas payment source is not canonical');
  }

  const envelope = {
    from: wallet.address,
    to: selection.prepared.to,
    data: selection.prepared.data,
    value: BigNumber.from(selection.prepared.value),
  };
  try {
    await provider.call(envelope);
    await provider.estimateGas(envelope);
  } catch (error) {
    return { ...failed(opportunity, `Alternative-capital exact pre-broadcast simulation failed: ${error instanceof Error ? error.message : String(error)}`), status: 'deferred' };
  }

  const token = new Contract(opportunity.inputToken, ERC20_BALANCE_ABI, provider);
  let recipientStarting: bigint;
  try {
    recipientStarting = BigInt((await token.balanceOf(profitRecipient)).toString());
  } catch (error) {
    return failed(opportunity, `Alternative-capital starting profit-recipient balance is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  let transactionHash = '';
  let receipt: providers.TransactionReceipt | null = null;
  let nativeFeeWei = 0n;
  let sponsoredExecution = false;
  try {
    if (funding.mode === 'sponsored') {
      const network = await provider.getNetwork();
      const sponsored = await runtime.gasSponsor.execute({
        wallet,
        chainId: network.chainId,
        calls: [{ to: selection.prepared.to, data: selection.prepared.data, value: BigNumber.from(selection.prepared.value) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
      });
      transactionHash = sponsored.transactionHash;
      receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt) receipt = await provider.waitForTransaction(transactionHash, 1, 15_000);
      sponsoredExecution = true;
      if (receipt?.effectiveGasPrice) nativeFeeWei = BigInt(receipt.gasUsed.toString()) * BigInt(receipt.effectiveGasPrice.toString());
    } else {
      const native = await executeSystemOwnedNativeTransaction({
        chain: opportunity.chain,
        wallet,
        provider,
        idempotencyKey: `zero-capital:alternative:${opportunity.id}:${selection.source}`,
        purpose: `zero_capital_${selection.source}_atomic_execution`,
        transaction: {
          to: selection.prepared.to,
          data: selection.prepared.data,
          value: BigNumber.from(selection.prepared.value),
        },
        confirmations: 1,
      });
      transactionHash = native.transactionHash;
      receipt = native.receipt;
      nativeFeeWei = native.actualSpentWei;
    }
  } catch (error) {
    return failed(opportunity, `Canonical alternative-capital submission failed: ${error instanceof Error ? error.message : String(error)}`, {
      submitted: Boolean(transactionHash),
      transactionHash: transactionHash || undefined,
      txHash: transactionHash || undefined,
      latencyMs: Date.now() - startedAt,
    });
  }

  if (!receipt) {
    return failed(opportunity, 'Canonical alternative-capital submission has no terminal receipt', {
      submitted: true,
      transactionHash,
      txHash: transactionHash,
      status: 'settlement_unknown',
      latencyMs: Date.now() - startedAt,
    });
  }
  if (receipt.status !== 1) {
    return failed(opportunity, 'Canonical alternative-capital transaction reverted', {
      submitted: true,
      transactionHash,
      txHash: transactionHash,
      receiptStatus: 0,
      blockNumber: receipt.blockNumber,
      latencyMs: Date.now() - startedAt,
    });
  }

  // A successful terminal receipt must never be resubmitted, even when telemetry
  // reconciliation below degrades. Remove the selection before reading side data.
  ghostWalletAlternativeZeroCapitalSelectionRegistry.remove(opportunity.id);
  const settlement = extractSettlementEvidence(receipt, selection, profitRecipient);
  if (!settlement) {
    return failed(opportunity, 'Alternative-capital receipt lacks matching source-repayment and realized-profit evidence', {
      submitted: true,
      settlementConfirmed: true,
      executionConfirmed: true,
      economicReconciliationStatus: 'exception',
      status: 'filled',
      transactionHash,
      txHash: transactionHash,
      receiptStatus: 1,
      blockNumber: receipt.blockNumber,
      latencyMs: Date.now() - startedAt,
    });
  }

  let recipientEnding: bigint;
  try {
    recipientEnding = BigInt((await token.balanceOf(profitRecipient)).toString());
  } catch (error) {
    return failed(opportunity, `Alternative-capital transaction settled but terminal payout balance is unavailable: ${error instanceof Error ? error.message : String(error)}`, {
      submitted: true,
      settlementConfirmed: true,
      executionConfirmed: true,
      economicReconciliationStatus: 'exception',
      status: 'filled',
      transactionHash,
      txHash: transactionHash,
      receiptStatus: 1,
      blockNumber: receipt.blockNumber,
      grossProfit: settlement.realizedProfit,
      latencyMs: Date.now() - startedAt,
    });
  }
  const recipientDelta = recipientEnding - recipientStarting;
  if (recipientDelta !== settlement.realizedProfit || recipientDelta <= 0n) {
    return failed(opportunity, `Alternative-capital realized-profit event does not equal canonical profit-recipient delta: event=${settlement.realizedProfit.toString()} delta=${recipientDelta.toString()}`, {
      submitted: true,
      settlementConfirmed: true,
      executionConfirmed: true,
      economicReconciliationStatus: 'exception',
      status: 'filled',
      transactionHash,
      txHash: transactionHash,
      receiptStatus: 1,
      blockNumber: receipt.blockNumber,
      grossProfit: settlement.realizedProfit,
      latencyMs: Date.now() - startedAt,
    });
  }

  const economics = await terminalEconomics({
    opportunity,
    realizedProfit: settlement.realizedProfit,
    nativeFeeWei,
    sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
  });
  const normalized = normalizedSettlement({
    opportunity,
    selection,
    transactionHash,
    receipt,
    startedAt,
    realizedProfit: settlement.realizedProfit,
    economics,
    sponsoredExecution,
    sponsorOperatorMonetaryCostProvenZero: funding.sponsorOperatorMonetaryCostProvenZero,
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
    grossProfit: settlement.realizedProfit,
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
    capitalProvenanceVerified: true,
    error: economics.economicsComplete
      ? positive ? undefined : 'Alternative-capital terminal settlement realized non-positive all-in net profit'
      : `Alternative-capital terminal economics are incomplete: ${economics.missingInformation.join(', ')}`,
  };

  logger.info('[ZeroCapitalExecutor] Canonical alternative-capital terminal result', {
    component: 'CanonicalZeroCapitalExecutor',
    opportunityId: opportunity.id,
    chain: opportunity.chain,
    source: selection.source,
    sourceAddress: selection.sourceAddress,
    intermediary: selection.intermediary,
    transactionHash,
    settlementConfirmed: true,
    sourceRepaymentOrLiabilityNeutralityVerified: true,
    realizedProfitBaseUnits: settlement.realizedProfit.toString(),
    realizedNetProfitUsd: economics.netProfitUsd,
    realizedGasUsd: economics.gasUsd,
    positiveAfterAllInCost: positive,
    sponsoredExecution,
    zeroOperatorMonetaryGasVerified: funding.sponsorOperatorMonetaryCostProvenZero === true,
    profitLadderAuthority: 'canonical_arbitrage_only',
    ghostWalletPersonalPayoutPolicyApplied: false,
    singleSchedulerAuthority: true,
  });
  return result;
}
