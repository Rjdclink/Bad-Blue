import logger from '../../../logger.js';
import {
  evaluateOkxRpiTakerBenefit,
  fetchFreshOkxRpiTakerDepth,
} from '../intelligence/okx-rpi-taker-depth.js';
import type {
  CexOrderReceipt,
  CexSettlementAdapter,
  OrderRequest,
  PreparedCexOrderSubmission,
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

async function prepareBaseSubmission(
  base: CexSettlementAdapter,
  request: OrderRequest,
): Promise<PreparedCexOrderSubmission> {
  if (base.prepareSubmit) return base.prepareSubmit(request);
  return {
    transport: 'strategy_specific',
    preparedAt: Date.now(),
    dispatch: () => base.submit(request),
  };
}

/**
 * Run the measured OKX order-book/RPI-vs-Convert auction against an already
 * prepared immediate-order fallback. No order is sent while this function runs.
 * The caller therefore keeps one synchronized parent dispatch barrier regardless
 * of which surface wins.
 */
export async function prepareOkxConvertAuctionAgainstFallback(input: {
  request: OrderRequest;
  fallback: PreparedCexOrderSubmission;
  rpiAveragePrice?: number | null;
  onConvertTrade?: (trade: OkxConvertTradeResult) => void;
}): Promise<PreparedCexOrderSubmission> {
  const auction = await evaluateOkxExecutionSurfaceAuction({
    symbol: input.request.symbol,
    side: input.request.side,
    quantity: input.request.quantity,
    plannedLimitPrice: input.request.price,
    rpiAveragePrice: input.rpiAveragePrice ?? null,
  }).catch(() => null);

  if (auction?.surface !== 'convert' || !auction.convertQuote) return input.fallback;

  logOkxConvertAuctionSelection({
    symbol: input.request.symbol,
    side: input.request.side,
    quantity: input.request.quantity,
    plannedLimitPrice: input.request.price,
    auction,
  });

  return {
    transport: 'rest',
    preparedAt: Date.now(),
    dispatch: async () => {
      // A null result means Convert explicitly did not submit (expired/cooldown
      // or explicit rejected state). The immediate-order fallback was already
      // prepared before the parent barrier, so fallback cannot add preparation
      // skew. Ambiguous Convert outcomes throw and never duplicate-submit.
      const trade = await executeOkxConvertQuote(auction.convertQuote!);
      if (!trade) return input.fallback.dispatch();

      input.onConvertTrade?.(trade);
      return {
        venue: 'okx',
        orderId: `${CONVERT_ORDER_PREFIX}${trade.clTReqId}`,
        symbol: input.request.symbol,
        side: input.request.side,
        requestedQuantity: input.request.quantity,
        submittedAt: trade.timestamp,
      };
    },
  };
}

/**
 * Wrap the existing OKX settlement adapter without replacing its signing,
 * inventory, scheduler, or standard IOC/RPI authorities. Convert is an execution
 * surface only and is selected after the plan is already canonical-positive.
 * All quote/auth/product preparation completes before the parent dispatch barrier.
 */
export function wrapOkxSettlementAdapterWithConvertAuction(base: CexSettlementAdapter): CexSettlementAdapter {
  const terminalConvertTrades = new Map<string, OkxConvertTradeResult>();

  const prepareAuctionSubmission = async (request: OrderRequest): Promise<PreparedCexOrderSubmission> => {
    // Prepare the already-positive standard path concurrently with the measured
    // RPI reference. Both remain no-order-sent work until the parent barrier.
    const basePreparationPromise = prepareBaseSubmission(base, request);
    const rpiSnapshotPromise = process.env.CRYPTO_OKX_RPI_TAKER_EXECUTION_ENABLED !== 'false'
      ? fetchFreshOkxRpiTakerDepth(request.symbol).catch(() => null)
      : Promise.resolve(null);

    const [basePrepared, rpiSnapshot] = await Promise.all([
      basePreparationPromise,
      rpiSnapshotPromise,
    ]);

    let rpiAveragePrice: number | null = null;
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

    return prepareOkxConvertAuctionAgainstFallback({
      request,
      fallback: basePrepared,
      rpiAveragePrice,
      onConvertTrade: trade => terminalConvertTrades.set(trade.clTReqId, trade),
    });
  };

  return {
    prepareSubmit: prepareAuctionSubmission,

    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      const prepared = await prepareAuctionSubmission(request);
      return prepared.dispatch();
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
