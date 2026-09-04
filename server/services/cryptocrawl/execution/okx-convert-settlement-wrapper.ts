import logger from '../../../logger.js';
import {
  evaluateOkxRpiTakerBenefit,
  fetchFreshOkxRpiTakerDepth,
} from '../intelligence/okx-rpi-taker-depth.js';
import type {
  CexOrderReceipt,
  CexSettlementAdapter,
  OrderRequest,
} from './cex-settlement.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';
import {
  evaluateOkxExecutionSurfaceAuction,
  executeOkxConvertQuote,
  logOkxConvertAuctionSelection,
  queryOkxConvertTrade,
  type OkxConvertTradeResult,
} from './okx-convert-execution-auction.js';

const CONVERT_ORDER_PREFIX = 'okx-convert:';

function convertClientId(orderId: string): string | null {
  return orderId.startsWith(CONVERT_ORDER_PREFIX) ? orderId.slice(CONVERT_ORDER_PREFIX.length) || null : null;
}

/**
 * Wrap the existing OKX settlement adapter without replacing its signing,
 * inventory, scheduler, or standard IOC/RPI authorities. Convert is an execution
 * surface only and is selected after the plan is already canonical-positive.
 */
export function wrapOkxSettlementAdapterWithConvertAuction(base: CexSettlementAdapter): CexSettlementAdapter {
  const terminalConvertTrades = new Map<string, OkxConvertTradeResult>();

  return {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      let rpiAveragePrice: number | null = null;
      if (process.env.CRYPTO_OKX_RPI_TAKER_EXECUTION_ENABLED !== 'false') {
        const rpiSnapshot = await fetchFreshOkxRpiTakerDepth(request.symbol).catch(() => null);
        if (rpiSnapshot) {
          const benefit = evaluateOkxRpiTakerBenefit({
            snapshot: rpiSnapshot,
            side: request.side,
            quantity: request.quantity,
            plannedLimitPrice: request.price,
          });
          if (benefit.useRpiTakerAccess && benefit.total.executable) {
            rpiAveragePrice = benefit.total.averagePrice;
          }
        }
      }

      const auction = await evaluateOkxExecutionSurfaceAuction({
        symbol: request.symbol,
        side: request.side,
        quantity: request.quantity,
        plannedLimitPrice: request.price,
        rpiAveragePrice,
      }).catch(() => null);

      if (auction?.surface === 'convert' && auction.convertQuote) {
        logOkxConvertAuctionSelection({
          symbol: request.symbol,
          side: request.side,
          quantity: request.quantity,
          plannedLimitPrice: request.price,
          auction,
        });
        // A null result means the Convert endpoint explicitly did not submit
        // (local documented cooldown or explicit rejected state), so the already
        // positive standard IOC path remains safe. Network/ambiguous outcomes throw
        // and never fall through to a duplicate standard order.
        const trade = await executeOkxConvertQuote(auction.convertQuote);
        if (trade) {
          terminalConvertTrades.set(trade.clTReqId, trade);
          return {
            venue: 'okx',
            orderId: `${CONVERT_ORDER_PREFIX}${trade.clTReqId}`,
            symbol: request.symbol,
            side: request.side,
            requestedQuantity: request.quantity,
            submittedAt: trade.timestamp,
          };
        }
      }

      return base.submit(request);
    },

    async query(order: CexOrderReceipt): Promise<NormalizedOrderSettlement> {
      const clTReqId = convertClientId(order.orderId);
      if (!clTReqId) return base.query(order);
      const trade = terminalConvertTrades.get(clTReqId) || await queryOkxConvertTrade(clTReqId);
      if (!trade) {
        return {
          venue: 'okx',
          orderId: order.orderId,
          symbol: order.symbol,
          side: order.side,
          status: 'settlement_unknown',
          terminal: false,
          requestedQuantity: order.requestedQuantity,
          filledQuantity: null,
          remainingQuantity: null,
          averageFillPrice: null,
          fills: [],
          feeAmount: null,
          feeAsset: null,
          submittedAt: order.submittedAt,
          terminalAt: null,
          error: 'OKX Convert terminal history is not yet available',
        };
      }
      terminalConvertTrades.set(clTReqId, trade);
      let finalBalances: Record<string, string> | undefined;
      try {
        finalBalances = base.getBalances ? await base.getBalances() : undefined;
      } catch (error) {
        logger.warn('[CEX Executor] OKX Convert final balance query unavailable', {
          component: 'CentralizedExchangeExecutor',
          clTReqId,
          tradeId: trade.tradeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        venue: 'okx',
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        status: 'filled',
        terminal: true,
        requestedQuantity: order.requestedQuantity,
        filledQuantity: trade.fillBaseQuantity,
        remainingQuantity: Math.max(0, order.requestedQuantity - trade.fillBaseQuantity),
        averageFillPrice: trade.fillPrice,
        fills: [{
          quantity: trade.fillBaseQuantity,
          price: trade.fillPrice,
          feeAmount: 0,
          feeAsset: null,
          timestamp: trade.timestamp,
          tradeId: trade.tradeId,
        }],
        // OKX Convert currently quotes the all-in conversion price and charges no
        // separate transaction fee; the price difference is therefore captured in
        // realized fill price rather than fabricated as a zero-BPS market claim.
        feeAmount: 0,
        feeAsset: null,
        submittedAt: order.submittedAt,
        terminalAt: trade.timestamp,
        finalBalances,
      };
    },

    async cancel(order: CexOrderReceipt): Promise<void> {
      if (convertClientId(order.orderId)) return;
      return base.cancel(order);
    },

    getBalances: base.getBalances ? () => base.getBalances!() : undefined,
  };
}
