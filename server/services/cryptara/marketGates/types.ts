export type SignalStatus = 'pass' | 'fail' | 'unknown';

export interface GateSignal {
  id: string;
  status: SignalStatus;
  score?: number; // Optional 0..1 normalized score
  message: string;
  details?: Record<string, unknown>;
}

export type GateDecision = 'ALLOW' | 'BLOCK';

export interface GateActions {
  /** If true, caller should pause governance immediately. */
  requestAutoPause?: boolean;
  /** Human-readable reason for pause. */
  autoPauseReason?: string;
}

export interface GateEvaluation {
  decision: GateDecision;
  signals: GateSignal[];
  blockReasons: string[];
  actions: GateActions;
  metadata: {
    evaluatedAt: number;
    stageHint?: string;
  };
}

// ============================================================================
// Context inputs (all optional; missing data => "unknown" signals)
// ============================================================================

export interface OrderFlowTrade {
  ts: number;
  side: 'buy' | 'sell';
  size: number; // base units, or normalized
  price?: number;
}

export interface OrderFlowContext {
  trades: OrderFlowTrade[];
  windowMs: number;
}

export interface MarketProfileContext {
  /** Volume histogram by price bucket (ascending by price). */
  buckets: Array<{ price: number; volume: number }>;
  /** Optional point of control override. */
  pocPrice?: number;
  /** Percentage of volume to consider as value area (default 0.7). */
  valueAreaPct?: number;
  /** Current/entry price to evaluate relative to value area. */
  referencePrice?: number;
}

export interface LiquidityHeatmapContext {
  /** Simplified depth around reference price. */
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  referencePrice?: number;
  /** If present, required depth (base units) within +- bandBps. */
  requiredDepth?: number;
  bandBps?: number;
}

export interface VolatilityRegimeContext {
  /** 0..2+ annualized */
  volatility?: number;
  /** 0..1 */
  liquidityScore?: number;
  spreadSize?: number;
  competitorDensity?: number;
  networkCongestion?: number;
  recentPriceMovement?: number;
  gasPriceGwei?: number;
  mempoolActivity?: number;
}

export interface FundingRatesContext {
  /** Annualized or per-interval rate; caller provides unit via `unit`. */
  fundingRate: number;
  unit: 'per8h' | 'annualized';
  openInterestUsd?: number;
}

export interface CorrelationContext {
  /** Correlation coefficient -1..1 */
  correlation: number;
  /** Reference pair/instrument used for correlation. */
  against: string;
}

export interface TimeOfDayContext {
  /** UTC hour 0..23 */
  utcHour: number;
  /** Optional per-hour risk profile (0..1) where higher is riskier. */
  riskByHour?: Record<number, number>;
}

export interface OptionsImpliedContext {
  impliedVol?: number; // 0..2+
  skew?: number; // e.g. 25d RR, -1..1
  termStructureSlope?: number; // short iv - long iv
}

export interface VenueLatencyContext {
  /** Map of venue -> p50 latency in ms */
  p50Ms: Record<string, number>;
  /** Optional maximum acceptable latency in ms */
  maxP50Ms?: number;
}

export interface FeeRebateContext {
  /** Fees in bps; rebates as negative bps. */
  makerFeeBps?: number;
  takerFeeBps?: number;
  makerRebateBps?: number;
  /** Whether strategy is strictly maker-only. */
  makerOnly?: boolean;
  /** Whether rebate capture is intended. */
  rebateOptimization?: boolean;
}

export interface CrossVenueFeeAsymmetryContext {
  buyVenue: string;
  sellVenue: string;
  buyTakerFeeBps: number;
  sellTakerFeeBps: number;
  /** Spread in bps between sellBid and buyAsk. */
  grossSpreadBps: number;
}

export interface FundingCaptureNoInventoryContext {
  /** Whether execution can be delta-neutral without inventory. */
  deltaNeutralAvailable: boolean;
  /** Whether the system currently requires holding inventory. */
  requiresInventory?: boolean;
}

export interface DrawdownCapsContext {
  /** Realized peak-to-trough drawdown in USD (positive number). */
  drawdownUsd?: number;
  /** Max allowed drawdown in USD. */
  maxDrawdownUsd?: number;
  /** If using % drawdown tracking. */
  drawdownPct?: number;
  maxDrawdownPct?: number;
}

export interface ProfitReinvestmentLadderContext {
  /** Current realized profit pool (USD) available for reinvestment. */
  realizedProfitUsd?: number;
  /** Requested notional for this action (USD). */
  requestedNotionalUsd?: number;
  /** Fraction of realized profit allowed to be deployed (0..1). */
  reinvestFraction?: number;
}

export interface SlippageContext {
  expectedSlippageBps?: number;
  observedSlippageBps?: number;
  maxSlippageBps?: number;
}

export interface CryptaraMarketGateContext {
  chain?: string;
  pairOrSymbol?: string;
  venue?: string;

  expectedProfitUsd?: number;

  orderFlow?: OrderFlowContext;
  marketProfile?: MarketProfileContext;
  liquidityHeatmap?: LiquidityHeatmapContext;
  volatilityRegime?: VolatilityRegimeContext;
  fundingRates?: FundingRatesContext;
  correlation?: CorrelationContext;
  timeOfDay?: TimeOfDayContext;
  optionsImplied?: OptionsImpliedContext;
  venueLatency?: VenueLatencyContext;
  feesRebates?: FeeRebateContext;
  crossVenueFees?: CrossVenueFeeAsymmetryContext;
  fundingCaptureNoInventory?: FundingCaptureNoInventoryContext;
  drawdownCaps?: DrawdownCapsContext;
  profitReinvestment?: ProfitReinvestmentLadderContext;
  slippage?: SlippageContext;
}

export interface CryptaraMarketGateConfig {
  /** If true, unknown critical signals block. Default true. */
  blockOnUnknownCritical?: boolean;
  /** Critical evaluators; missing data => BLOCK when blockOnUnknownCritical=true */
  criticalSignals?: Array<
    | 'volatilityRegime'
    | 'venueLatency'
    | 'crossVenueFees'
    | 'slippage'
    | 'drawdownCaps'
    | 'feesRebates'
  >;
}

