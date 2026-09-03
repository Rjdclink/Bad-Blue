import { Contract } from 'ethers';
import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  AutonomousZeroCapitalEngine,
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flash-loan-provider-selection-registry.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import { withEvmSignerLane } from '../execution/evm-signer-lane.js';
import { evaluateZeroCapitalRealizedProfit } from '../execution/zero-capital-realized-profit-policy.js';
import {
  persistVerifiedSponsoredProfit,
  prepareSponsoredSystemCapital,
  releaseFailedSponsoredBootstrap,
  type SponsoredSystemCapitalAttempt,
} from './system-capital-provenance.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const activeProfitBoundaries = new WeakSet<object>();
const TREASURY_FRACTION_SCALE = 100_000_000n;
let latestWrappedExecuteFunded: Function | null = null;
let executeAndRecordPatched = false;

const NATIVE_SYMBOL: Partial<Record<SupportedChain, 'ETH' | 'POL' | 'BNB' | 'AVAX'>> = {
  ethereum: 'ETH',
  polygon: 'POL',
  arbitrum: 'ETH',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
};

function correctedSettlement(result: any, economics: ReturnType<typeof evaluateZeroCapitalRealizedProfit>) {
  if (!result.normalized) return result.normalized;
  const positive = economics.economicsComplete && economics.positiveAfterAllInCost;
  return {
    ...result.normalized,
    status: positive ? 'filled' : 'failed',
    terminal: true,
    settlementConfirmed: result.receiptStatus === 1,
    realized: {
      ...result.normalized.realized,
      gasUsd: economics.gasUsd,
      netProfitUsd: economics.netProfitUsd,
    },
    provenance: [
      ...new Set([
        ...(result.normalized.provenance || []),
        'receiver_event:gross_profit',
        'selected_receiver_starting_loan_token_balance:zero_verified',
        'operational_profit_recipient_delta:matches_receiver_event',
        result.zeroMonetaryGasVerified
          ? 'sponsored_gas:user_native_cost_zero'
          : 'receipt_effective_gas_fee:measured',
        ...(economics.economicsComplete ? ['realized_all_in_net_profit'] : ['realized_all_in_economics_incomplete']),
      ]),
    ],
  };
}

function selectedReceiver(runtime: any, opportunity: ZeroCapitalOpportunity): string | null {
  const dual = dualFlashLoanProviderSelectionRegistry.get(opportunity.id);
  if (dual?.receiver) return dual.receiver;
  const single = flashLoanProviderSelectionRegistry.get(opportunity.id);
  if (single?.receiver) return single.receiver;
  return runtime.receiverManager?.getReceiver(opportunity.chain) || null;
}

function terminalTreasuryFeedback(opportunity: ZeroCapitalOpportunity, result: any): CryptaraExecutionFeedback {
  const normalized = result.normalized;
  if (!normalized?.terminal || normalized.settlementConfirmed !== true || !normalized.transactionHash) {
    throw new Error('Zero-capital treasury allocation requires terminal confirmed settlement');
  }
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

function splitGrossBaseUnits(grossProfitBaseUnits: bigint, retainedFraction: number): {
  retainedProfitBaseUnits: bigint;
  payoutReservedBaseUnits: bigint;
} {
  if (grossProfitBaseUnits <= 0n) throw new Error('Gross settled profit must be positive before treasury split');
  if (!Number.isFinite(retainedFraction) || retainedFraction < 0 || retainedFraction > 1) {
    throw new Error('Treasury retained fraction must be finite and between zero and one');
  }
  const scaledRetained = BigInt(Math.max(0, Math.min(Number(TREASURY_FRACTION_SCALE), Math.floor(retainedFraction * Number(TREASURY_FRACTION_SCALE)))));
  const retainedProfitBaseUnits = (grossProfitBaseUnits * scaledRetained) / TREASURY_FRACTION_SCALE;
  const payoutReservedBaseUnits = grossProfitBaseUnits - retainedProfitBaseUnits;
  return { retainedProfitBaseUnits, payoutReservedBaseUnits };
}

async function executeWithProfitProvenanceBoundary(
  runtime: any,
  delegate: Function,
  opportunity: ZeroCapitalOpportunity,
  funding: any,
): Promise<any> {
  const provider = runtime.providers?.get(opportunity.chain);
  const wallet = runtime.executionWallets?.get(opportunity.chain);
  const receiver = selectedReceiver(runtime, opportunity);
  if (!provider || !wallet || !receiver) {
    return { success: false, error: `Zero-capital profit-provenance boundary has no provider/wallet/selected receiver for ${opportunity.chain}` };
  }

  const token = new Contract(opportunity.inputToken, ERC20_BALANCE_ABI, provider);
  const profitRecipient = resolveOperationalProfitRecipient();
  const [receiverStartingRaw, recipientStartingRaw, network] = await Promise.all([
    token.balanceOf(receiver),
    token.balanceOf(profitRecipient),
    provider.getNetwork(),
  ]);
  const receiverStarting = BigInt(receiverStartingRaw.toString());
  const recipientStarting = BigInt(recipientStartingRaw.toString());
  if (receiverStarting !== 0n) {
    return {
      success: false,
      error: `ZERO_CAPITAL_SELECTED_RECEIVER_STARTING_LOAN_TOKEN_BALANCE_NONZERO:${receiverStarting.toString()}`,
    };
  }

  let systemCapitalAttempt: SponsoredSystemCapitalAttempt | null = null;
  if (funding?.mode === 'sponsored') {
    try {
      systemCapitalAttempt = await prepareSponsoredSystemCapital({
        chain: opportunity.chain,
        inputToken: opportunity.inputToken,
        profitRecipient,
        opportunityId: opportunity.id,
      });
    } catch (error) {
      logger.warn('[ZeroCapitalEngine] System-capital preparation unavailable; sponsored execution remains governed by measured trade facts', {
        component: 'ZeroCapitalEngine',
        opportunityId: opportunity.id,
        chain: opportunity.chain,
        error: error instanceof Error ? error.message : String(error),
        executionBlocked: false,
        reusableCapitalCreditDeferred: true,
      });
    }
  }

  const invoke = () => delegate(opportunity, funding);
  let result: any;
  try {
    result = funding?.mode === 'native'
      ? await withEvmSignerLane({
          chainId: network.chainId,
          walletAddress: wallet.address,
          operation: invoke,
        })
      : await invoke();
  } catch (error) {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    throw error;
  }

  if (!result?.txHash) {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    return { ...result, systemCapitalAttempt };
  }
  if (result.receiptStatus === 0) {
    await releaseFailedSponsoredBootstrap(systemCapitalAttempt).catch(() => undefined);
    return { ...result, systemCapitalAttempt };
  }
  if (result.receiptStatus !== 1 || typeof result.profit !== 'bigint') {
    return { ...result, systemCapitalAttempt };
  }

  let recipientEnding: bigint;
  try {
    const raw = await token.balanceOf(profitRecipient);
    recipientEnding = BigInt(raw.toString());
  } catch (error) {
    return {
      ...result,
      success: false,
      profit: undefined,
      profitVerified: false,
      profitRecipient,
      profitRecipientStartingInputBalance: recipientStarting,
      systemCapitalAttempt,
      error: `Terminal receiver profit event exists but operational profit-recipient ending balance is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const recipientDelta = recipientEnding - recipientStarting;
  if (recipientDelta !== result.profit) {
    return {
      ...result,
      success: false,
      profit: undefined,
      profitVerified: false,
      profitRecipient,
      profitRecipientStartingInputBalance: recipientStarting,
      profitRecipientEndingInputBalance: recipientEnding,
      systemCapitalAttempt,
      error: `Terminal receiver profit event does not equal operational profit-recipient token delta: event=${result.profit.toString()} delta=${recipientDelta.toString()}`,
    };
  }

  return {
    ...result,
    profitRecipient,
    profitRecipientStartingInputBalance: recipientStarting,
    profitRecipientEndingInputBalance: recipientEnding,
    systemCapitalAttempt,
  };
}

function reconcileAllInResult(opportunity: ZeroCapitalOpportunity, result: any): Promise<any> | any {
  if (!result?.txHash || result.receiptStatus !== 1 || typeof result.profit !== 'bigint') return result;
  return (async () => {
    const grossProfitBaseUnits = result.profit as bigint;
    const inputSymbol = String(opportunity.inputAssetSymbol || '').trim().toUpperCase();
    const nativeSymbol = result.zeroMonetaryGasVerified ? null : NATIVE_SYMBOL[opportunity.chain] || null;
    const requestedSymbols = [...new Set([inputSymbol, nativeSymbol].filter((value): value is string => Boolean(value)))];
    let inputTokenUsdPrice: number | null = null;
    let nativeUsdPrice: number | null = null;

    if (requestedSymbols.length > 0) {
      try {
        const prices = await coinGeckoPriceClient.getLiveSymbolPrices(requestedSymbols);
        inputTokenUsdPrice = inputSymbol ? prices.get(inputSymbol) ?? null : null;
        nativeUsdPrice = nativeSymbol ? prices.get(nativeSymbol) ?? null : null;
      } catch {
        inputTokenUsdPrice = null;
        nativeUsdPrice = null;
      }
    }

    const economics = evaluateZeroCapitalRealizedProfit({
      grossProfitBaseUnits,
      inputTokenDecimals: opportunity.inputTokenDecimals,
      inputTokenUsdPrice,
      sponsoredExecution: result.zeroMonetaryGasVerified === true,
      nativeFeeWei: typeof result.nativeFeeWei === 'bigint' ? result.nativeFeeWei : 0n,
      nativeUsdPrice,
    });
    const profit = economics.netProfitBaseUnits ?? undefined;
    const economicsVerified = economics.economicsComplete;
    const positive = economicsVerified && economics.positiveAfterAllInCost;
    const normalized = correctedSettlement(result, economics);
    const error = !economicsVerified
      ? `Terminal receiver settlement confirmed but all-in realized economics are incomplete: ${economics.missingInformation.join(', ')}`
      : positive
        ? result.error
        : `Terminal receiver settlement realized non-positive all-in net profit: gross=$${economics.grossProfitUsd.toFixed(8)}, gas=$${(economics.gasUsd || 0).toFixed(8)}, net=$${(economics.netProfitUsd || 0).toFixed(8)}`;

    logger.info('[ZeroCapitalEngine] All-in realized receiver economics reconciled', {
      component: 'ZeroCapitalEngine',
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      inputAssetSymbol: inputSymbol || null,
      inputTokenUsdPrice,
      nativeAssetSymbol: nativeSymbol,
      nativeUsdPrice,
      sponsoredExecution: result.zeroMonetaryGasVerified === true,
      grossProfitUsd: economics.grossProfitUsd,
      realizedGasUsd: economics.gasUsd,
      realizedNetProfitUsd: economics.netProfitUsd,
      selectedReceiverStartingLoanTokenBalanceZero: true,
      operationalProfitRecipientDeltaVerified: true,
      distributedNativeSignerLane: result.zeroMonetaryGasVerified !== true,
      economicsVerified,
      positiveAfterAllInCost: positive,
      missingInformation: economics.missingInformation,
    });

    return {
      ...result,
      grossProfit: grossProfitBaseUnits,
      profit,
      economicsVerified,
      profitVerified: positive,
      success: positive,
      realizedFeeUsd: economics.gasUsd,
      normalized,
      error,
    };
  })();
}

async function persistSystemCapitalIfVerified(
  opportunity: ZeroCapitalOpportunity,
  result: any,
): Promise<any> {
  const attempt = result?.systemCapitalAttempt as SponsoredSystemCapitalAttempt | null | undefined;
  if (result?.zeroMonetaryGasVerified !== true || !attempt) return result;

  if (result.economicsVerified === true && result.success === false) {
    await releaseFailedSponsoredBootstrap(attempt).catch(() => undefined);
    return result;
  }

  if (
    result.success !== true ||
    result.profitVerified !== true ||
    result.receiptStatus !== 1 ||
    typeof result.profit !== 'bigint' ||
    typeof result.grossProfit !== 'bigint' ||
    typeof result.profitRecipient !== 'string' ||
    typeof result.profitRecipientStartingInputBalance !== 'bigint' ||
    typeof result.profitRecipientEndingInputBalance !== 'bigint' ||
    typeof result.txHash !== 'string'
  ) return result;

  const grossProfitBaseUnits = result.profitRecipientEndingInputBalance - result.profitRecipientStartingInputBalance;
  if (grossProfitBaseUnits <= 0n || grossProfitBaseUnits !== result.grossProfit) {
    await releaseFailedSponsoredBootstrap(attempt).catch(() => undefined);
    return {
      ...result,
      capitalProvenanceVerified: false,
      capitalProvenanceError: `Verified sponsored settlement gross delta mismatch: delta=${grossProfitBaseUnits.toString()} receiver=${result.grossProfit.toString()}`,
    };
  }

  try {
    const allocation = await retainedProfitLedger.recordTerminalSettlement(terminalTreasuryFeedback(opportunity, result));
    if (!allocation) throw new Error('Canonical terminal treasury allocation was unavailable');
    const { retainedProfitBaseUnits, payoutReservedBaseUnits } = splitGrossBaseUnits(
      grossProfitBaseUnits,
      allocation.retainedFraction,
    );
    if (retainedProfitBaseUnits <= 0n) throw new Error('Canonical treasury split produced no reusable retained base units');

    const capital = await persistVerifiedSponsoredProfit(attempt, {
      transactionHash: result.txHash,
      chain: opportunity.chain,
      asset: opportunity.inputAssetSymbol,
      grossProfitBaseUnits,
      retainedProfitBaseUnits,
      payoutReservedBaseUnits,
      sourceRecipient: result.profitRecipient,
      sourceRecipientBalanceBeforeBaseUnits: result.profitRecipientStartingInputBalance,
      sourceRecipientBalanceAfterBaseUnits: result.profitRecipientEndingInputBalance,
    });
    const normalized = result.normalized
      ? {
          ...result.normalized,
          provenance: [...new Set([
            ...(result.normalized.provenance || []),
            'canonical_treasury_split_before_reusable_capital_credit',
            'durable_self_funded_capital_provenance',
          ])],
        }
      : result.normalized;
    logger.info('[ZeroCapitalEngine] Verified sponsored profit split and retained share credited to reusable system capital', {
      component: 'ZeroCapitalEngine',
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      asset: opportunity.inputAssetSymbol,
      capitalScope: attempt.scope,
      capitalLifecycle: capital.lifecycle,
      generation: capital.generation,
      grossProfitBaseUnits: grossProfitBaseUnits.toString(),
      retainedProfitBaseUnits: retainedProfitBaseUnits.toString(),
      payoutReservedBaseUnits: payoutReservedBaseUnits.toString(),
      payoutFraction: allocation.payoutFraction,
      retainedFraction: allocation.retainedFraction,
      systemCapitalBalanceBaseUnits: capital.internallyGeneratedBalance,
      operatorBalanceAuthorityGranted: false,
    });
    return {
      ...result,
      normalized,
      capitalProvenanceVerified: true,
      systemCapitalScope: attempt.scope,
      systemCapitalBalanceBaseUnits: capital.internallyGeneratedBalance,
      retainedProfitBaseUnits,
      payoutReservedBaseUnits,
    };
  } catch (error) {
    await releaseFailedSponsoredBootstrap(attempt).catch(() => undefined);
    logger.error('[ZeroCapitalEngine] Settled profit preserved but reusable-capital credit deferred for reconciliation', {
      component: 'ZeroCapitalEngine',
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      transactionHash: result.txHash,
      capitalScope: attempt.scope,
      error: error instanceof Error ? error.message : String(error),
      settlementTruthPreserved: true,
      unrelatedExecutionPaused: false,
      reusableUnverifiedBalanceSpendable: false,
    });
    return {
      ...result,
      capitalProvenanceVerified: false,
      capitalProvenanceError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install terminal profit reconciliation around the CURRENT instance execution
 * stack, not only the class prototype. Provider-specific and dual-provider
 * execution are instance wrappers; canonical runtime may install/reassert this
 * layer before or after them. Re-entrant execution is detected by opportunity
 * object identity so an older captured reconciliation wrapper delegates directly
 * instead of nesting signer locks or double-counting settlement evidence.
 */
export function ensureZeroCapitalRealizedProfitWiring(): void {
  const target = zeroCapitalEngine as any;
  if (target.executeFunded !== latestWrappedExecuteFunded) {
    const delegate = target.executeFunded.bind(target);
    const wrapped = async (opportunity: ZeroCapitalOpportunity, funding: any) => {
      if (activeProfitBoundaries.has(opportunity as object)) return delegate(opportunity, funding);
      activeProfitBoundaries.add(opportunity as object);
      try {
        const result = await executeWithProfitProvenanceBoundary(target, delegate, opportunity, funding);
        return reconcileAllInResult(opportunity, result);
      } finally {
        activeProfitBoundaries.delete(opportunity as object);
      }
    };
    target.executeFunded = wrapped;
    latestWrappedExecuteFunded = wrapped;
  }

  if (!executeAndRecordPatched) {
    executeAndRecordPatched = true;
    const prototype = AutonomousZeroCapitalEngine.prototype as any;
    prototype.executeAndRecord = async function(opportunity: ZeroCapitalOpportunity): Promise<void> {
      let result: any;
      try {
        result = await this.executeOpportunity(opportunity);
      } catch (error) {
        result = { success: false, economicsVerified: false, error: error instanceof Error ? error.message : String(error) };
      }

      await this.recordExecutionFeedback(opportunity, result);
      result = await persistSystemCapitalIfVerified(opportunity, result);
      this.state.totalTrades++;

      if (result.economicsVerified === true && typeof result.profit === 'bigint') {
        this.state.totalProfit += result.profit;
        if (result.profit > 0n && result.success) {
          this.state.successfulTrades++;
          this.state.lastTradeTimestamp = Date.now();
        } else {
          this.state.failedTrades++;
        }
        return;
      }

      if (result.txHash && result.receiptStatus === 1) {
        this.state.includedUnverifiedTrades++;
        getCryptocrawlGovernance().pause('system', 'zero_capital_realized_economics_unverified');
        return;
      }

      this.state.failedTrades++;
    };
  }

  logger.info('[CryptoCoreRuntime] Zero-capital realized-profit wiring asserted', {
    component: 'CryptoCoreRuntime',
    wrapsCurrentInstanceExecutionStack: true,
    selectedReceiverBoundToProviderSelectionRegistry: true,
    reentrantCapturedWrappersBypassDuplicateBoundary: true,
    receiverEventClassifiedAs: 'gross_profit_only_after_zero_starting_balance',
    operationalProfitRecipientDeltaRequired: true,
    sponsoredProfitUsesCanonicalTreasurySplitBeforeReusableCapitalCredit: true,
    payoutReservedBaseUnitsExcludedFromReusableCapital: true,
    capitalPersistenceFailurePausesUnrelatedExecution: false,
    nativeSubmissionDistributedSignerLane: true,
    actualNativeReceiptGasSubtracted: true,
    liveInputTokenUsdPriceRequiredForTerminalRealizedProfit: true,
    liveNativeUsdPriceRequiredForNativeFunding: true,
    settlementPriceRequestsDeduplicatedBySymbol: true,
    sponsoredUserGasCost: 0,
    realizedLossesIncludedInCumulativeProfit: true,
    unknownRealizedCostBlocksLearning: true,
  });
}
