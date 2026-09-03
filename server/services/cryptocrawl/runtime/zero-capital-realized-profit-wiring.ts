import { Contract } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
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
      throw new Error(`SYSTEM_CAPITAL_PROVENANCE_PREP_FAILED:${error instanceof Error ? error.message : String(error)}`);
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
    // A submitted transaction without terminal proof stays pending. Releasing the
    // capital lifecycle here could allow a duplicate attempt while the first hash
    // is still capable of settling.
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
  funding: any,
  result: any,
): Promise<any> {
  const attempt = result?.systemCapitalAttempt as SponsoredSystemCapitalAttempt | null | undefined;
  if (funding?.mode !== 'sponsored' || !attempt) return result;

  if (result.economicsVerified === true && result.success === false) {
    await releaseFailedSponsoredBootstrap(attempt).catch(() => undefined);
    return result;
  }

  if (
    result.success !== true ||
    result.profitVerified !== true ||
    result.receiptStatus !== 1 ||
    typeof result.profit !== 'bigint' ||
    typeof result.profitRecipient !== 'string' ||
    typeof result.profitRecipientStartingInputBalance !== 'bigint' ||
    typeof result.profitRecipientEndingInputBalance !== 'bigint' ||
    typeof result.txHash !== 'string'
  ) return result;

  const retainedProfitBaseUnits = result.profitRecipientEndingInputBalance - result.profitRecipientStartingInputBalance;
  if (retainedProfitBaseUnits <= 0n || retainedProfitBaseUnits !== result.profit) {
    getCryptocrawlGovernance().pause('system', 'zero_capital_system_capital_delta_mismatch');
    return {
      ...result,
      capitalProvenanceVerified: false,
      error: `Verified sponsored settlement cannot enter reusable capital: retained delta=${retainedProfitBaseUnits.toString()} all-in profit=${result.profit.toString()}`,
    };
  }

  try {
    const capital = await persistVerifiedSponsoredProfit(attempt, {
      transactionHash: result.txHash,
      chain: opportunity.chain,
      asset: opportunity.inputAssetSymbol,
      retainedProfitBaseUnits,
      sourceRecipient: result.profitRecipient,
      sourceRecipientBalanceBeforeBaseUnits: result.profitRecipientStartingInputBalance,
      sourceRecipientBalanceAfterBaseUnits: result.profitRecipientEndingInputBalance,
    });
    const normalized = result.normalized
      ? {
          ...result.normalized,
          provenance: [...new Set([...(result.normalized.provenance || []), 'durable_self_funded_capital_provenance'])],
        }
      : result.normalized;
    logger.info('[ZeroCapitalEngine] Verified sponsored profit credited to reusable system capital', {
      component: 'ZeroCapitalEngine',
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      asset: opportunity.inputAssetSymbol,
      capitalScope: attempt.scope,
      capitalLifecycle: capital.lifecycle,
      generation: capital.generation,
      retainedProfitBaseUnits: retainedProfitBaseUnits.toString(),
      systemCapitalBalanceBaseUnits: capital.internallyGeneratedBalance,
      operatorBalanceAuthorityGranted: false,
    });
    return {
      ...result,
      normalized,
      capitalProvenanceVerified: true,
      systemCapitalScope: attempt.scope,
      systemCapitalBalanceBaseUnits: capital.internallyGeneratedBalance,
    };
  } catch (error) {
    getCryptocrawlGovernance().pause('system', 'zero_capital_system_capital_persistence_failed');
    logger.error('[ZeroCapitalEngine] Real profit settled but durable system-capital credit failed; execution paused', {
      component: 'ZeroCapitalEngine',
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      transactionHash: result.txHash,
      capitalScope: attempt.scope,
      error: error instanceof Error ? error.message : String(error),
      settlementTruthPreserved: true,
      newExecutionPaused: true,
    });
    return {
      ...result,
      capitalProvenanceVerified: false,
      error: `Trade settled profit successfully, but reusable capital persistence failed: ${error instanceof Error ? error.message : String(error)}`,
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
        let result: any;
        try {
          result = await executeWithProfitProvenanceBoundary(target, delegate, opportunity, funding);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.startsWith('SYSTEM_CAPITAL_PROVENANCE_PREP_FAILED:')) {
            getCryptocrawlGovernance().pause('system', 'zero_capital_system_capital_preparation_failed');
          }
          return {
            success: false,
            error: `Zero-capital receiver profit-provenance boundary failed closed: ${message}`,
          };
        }
        const reconciled = await reconcileAllInResult(opportunity, result);
        return persistSystemCapitalIfVerified(opportunity, funding, reconciled);
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
    sponsoredProfitRequiresDurableSelfFundedCapitalProvenance: true,
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
