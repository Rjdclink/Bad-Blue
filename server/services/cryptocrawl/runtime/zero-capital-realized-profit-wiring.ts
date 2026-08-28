import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { AutonomousZeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { evaluateZeroCapitalRealizedProfit } from '../execution/zero-capital-realized-profit-policy.js';

const installed = new WeakSet<object>();

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
        result.zeroMonetaryGasVerified
          ? 'sponsored_gas:user_native_cost_zero'
          : 'receipt_effective_gas_fee:measured',
        ...(economics.economicsComplete ? ['realized_all_in_net_profit'] : ['realized_all_in_economics_incomplete']),
      ]),
    ],
  };
}

/**
 * Correct the zero-capital settlement boundary so the receiver's emitted token
 * surplus is treated as gross profit. Native-funded receipt gas is subtracted at
 * a live native/USD price before a trade is considered genuinely profitable.
 * Unknown native price remains unknown and pauses learning rather than becoming
 * zero cost. The patch also makes the engine's cumulative total include realized
 * losses instead of summing wins only.
 */
export function ensureZeroCapitalRealizedProfitWiring(): void {
  const prototype = AutonomousZeroCapitalEngine.prototype as any;
  if (installed.has(prototype)) return;
  installed.add(prototype);

  const originalExecuteFunded = prototype.executeFunded;
  prototype.executeFunded = async function(opportunity: ZeroCapitalOpportunity, funding: any) {
    const result = await originalExecuteFunded.call(this, opportunity, funding);
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
    receiverEventClassifiedAs: 'gross_profit',
    actualNativeReceiptGasSubtracted: true,
    liveNativeUsdPriceRequiredForNativeFunding: true,
    sponsoredUserGasCost: 0,
    realizedLossesIncludedInCumulativeProfit: true,
    unknownRealizedCostBlocksLearning: true,
  });
}
