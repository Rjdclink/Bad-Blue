import { Contract } from 'ethers';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { AutonomousZeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { withEvmSignerLane } from '../execution/evm-signer-lane.js';
import { evaluateZeroCapitalRealizedProfit } from '../execution/zero-capital-realized-profit-policy.js';

const installed = new WeakSet<object>();
const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];

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
    // Receipt status 1 is terminal settlement evidence even when realized net
    // economics are negative or unavailable. Do not conflate settlement with P&L.
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
        'receiver_starting_loan_token_balance:zero_verified',
        'operational_profit_recipient_delta:matches_receiver_event',
        result.zeroMonetaryGasVerified
          ? 'sponsored_gas:user_native_cost_zero'
          : 'receipt_effective_gas_fee:measured',
        ...(economics.economicsComplete ? ['realized_all_in_net_profit'] : ['realized_all_in_economics_incomplete']),
      ]),
    ],
  };
}

async function executeWithProfitProvenanceBoundary(
  runtime: any,
  originalExecuteFunded: Function,
  opportunity: ZeroCapitalOpportunity,
  funding: any,
): Promise<any> {
  const provider = runtime.providers?.get(opportunity.chain);
  const wallet = runtime.executionWallets?.get(opportunity.chain);
  const receiver = runtime.receiverManager?.getReceiver(opportunity.chain);
  if (!provider || !wallet || !receiver) {
    return { success: false, error: `Zero-capital profit-provenance boundary has no provider/wallet/receiver for ${opportunity.chain}` };
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
      error: `ZERO_CAPITAL_RECEIVER_STARTING_LOAN_TOKEN_BALANCE_NONZERO:${receiverStarting.toString()}`,
    };
  }

  const invoke = () => originalExecuteFunded.call(runtime, opportunity, funding);
  const result = funding?.mode === 'native'
    ? await withEvmSignerLane({
        chainId: network.chainId,
        walletAddress: wallet.address,
        operation: invoke,
      })
    : await invoke();

  if (!result?.txHash || result.receiptStatus !== 1 || typeof result.profit !== 'bigint') return result;

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
      error: `Terminal receiver profit event does not equal operational profit-recipient token delta: event=${result.profit.toString()} delta=${recipientDelta.toString()}`,
    };
  }

  return {
    ...result,
    profitRecipient,
    profitRecipientStartingInputBalance: recipientStarting,
    profitRecipientEndingInputBalance: recipientEnding,
  };
}

/**
 * Correct the zero-capital settlement boundary so the receiver's emitted token
 * surplus is treated as gross profit only when provenance is pure: the receiver
 * must begin with zero loan-token balance and the terminal operational-wallet
 * balance delta must exactly equal the emitted profit. Native-funded submissions
 * are serialized through the shared distributed signer lane. Native receipt gas
 * is then subtracted at a live native/USD price before a trade is considered
 * genuinely profitable. Unknown evidence remains unknown and pauses learning.
 */
export function ensureZeroCapitalRealizedProfitWiring(): void {
  const prototype = AutonomousZeroCapitalEngine.prototype as any;
  if (installed.has(prototype)) return;
  installed.add(prototype);

  const originalExecuteFunded = prototype.executeFunded;
  prototype.executeFunded = async function(opportunity: ZeroCapitalOpportunity, funding: any) {
    let result: any;
    try {
      result = await executeWithProfitProvenanceBoundary(this, originalExecuteFunded, opportunity, funding);
    } catch (error) {
      return {
        success: false,
        error: `Zero-capital receiver profit-provenance boundary failed closed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!result?.txHash || result.receiptStatus !== 1 || typeof result.profit !== 'bigint') return result;

    const grossProfitBaseUnits = result.profit as bigint;
    let nativeUsdPrice: number | null = null;
    if (!result.zeroMonetaryGasVerified) {
      const nativeSymbol = NATIVE_SYMBOL[opportunity.chain];
      if (nativeSymbol) {
        try {
          const prices = await coinGeckoPriceClient.getLiveSymbolPrices([nativeSymbol]);
          nativeUsdPrice = prices.get(nativeSymbol) ?? null;
        } catch {
          nativeUsdPrice = null;
        }
      }
    }

    const economics = evaluateZeroCapitalRealizedProfit({
      grossProfitBaseUnits,
      inputTokenDecimals: opportunity.inputTokenDecimals,
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
      sponsoredExecution: result.zeroMonetaryGasVerified === true,
      grossProfitUsd: economics.grossProfitUsd,
      realizedGasUsd: economics.gasUsd,
      realizedNetProfitUsd: economics.netProfitUsd,
      receiverStartingLoanTokenBalanceZero: true,
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
  };

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
      // Signed net base units: realized losses are part of cumulative performance.
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

  logger.info('[CryptoCoreRuntime] Zero-capital realized-profit wiring installed', {
    component: 'CryptoCoreRuntime',
    receiverEventClassifiedAs: 'gross_profit_only_after_zero_starting_balance',
    operationalProfitRecipientDeltaRequired: true,
    nativeSubmissionDistributedSignerLane: true,
    actualNativeReceiptGasSubtracted: true,
    liveNativeUsdPriceRequiredForNativeFunding: true,
    sponsoredUserGasCost: 0,
    realizedLossesIncludedInCumulativeProfit: true,
    unknownRealizedCostBlocksLearning: true,
  });
}