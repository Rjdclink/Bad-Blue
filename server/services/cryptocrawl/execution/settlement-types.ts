export type ExecutionStatus =
  | 'submitted'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'failed'
  | 'settlement_unknown';

export interface ExecutionFill {
  /** Numeric telemetry/economics view retained for existing consumers. */
  quantity: number;
  price: number;
  feeAmount: number | null;
  feeAsset: string | null;
  timestamp: number | null;
  tradeId?: string;
  /**
   * Exchange-native decimal evidence. Ownership/provenance accounting MUST use
   * these strings (plus authenticated asset decimals), never the numeric fields.
   */
  quantityDecimal?: string;
  priceDecimal?: string;
  feeAmountDecimal?: string | null;
}

export interface NormalizedOrderSettlement {
  venue: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: ExecutionStatus;
  terminal: boolean;
  requestedQuantity: number;
  filledQuantity: number | null;
  remainingQuantity: number | null;
  averageFillPrice: number | null;
  fills: ExecutionFill[];
  feeAmount: number | null;
  feeAsset: string | null;
  submittedAt: number;
  terminalAt: number | null;
  finalBalances?: Record<string, string>;
  error?: string;
  /** Exact exchange decimal strings for physical system-capital accounting. */
  requestedQuantityDecimal?: string;
  filledQuantityDecimal?: string | null;
  averageFillPriceDecimal?: string | null;
  feeAmountDecimal?: string | null;
}

export interface PredictedExecutionEconomics {
  profitUsd: number | null;
  feeUsd: number | null;
  slippageBps: number | null;
}

export interface RealizedExecutionEconomics {
  acquisitionCostUsd: number | null;
  proceedsUsd: number | null;
  exchangeFeeUsd: number | null;
  gasUsd: number | null;
  gasUsed: string | null;
  effectiveGasPriceWei: string | null;
  slippageBps: number | null;
  netProfitUsd: number | null;
}

export interface NormalizedRealizedExecution {
  status: ExecutionStatus;
  terminal: boolean;
  settlementConfirmed: boolean;
  submittedAt: number;
  settledAt: number | null;
  venueOrRoute: string;
  chain: string | null;
  predicted: PredictedExecutionEconomics;
  realized: RealizedExecutionEconomics;
  provenance: string[];
  orders?: NormalizedOrderSettlement[];
  transactionHash?: string;
  blockNumber?: number;
  receiptStatus?: 0 | 1;
  tokenAmounts?: Array<{
    token: string;
    direction: 'in' | 'out';
    amount: string;
    decimals?: number;
  }>;
  error?: string;
}
