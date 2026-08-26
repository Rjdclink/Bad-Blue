import { arbitrageVerifier } from '../../cryptocrawl/arbitrage/arbitrage-verifier.js';
import { CryptaraMarketGateEngine as BaseCryptaraMarketGateEngine } from './engine.js';
import type { CryptaraMarketGateConfig, CryptaraMarketGateContext, GateEvaluation } from './types.js';

export class CryptaraMarketGateEngine extends BaseCryptaraMarketGateEngine {
  evaluate(context: CryptaraMarketGateContext, config: CryptaraMarketGateConfig = {}): GateEvaluation {
    const measuredFeeContext = context.pairOrSymbol
      ? arbitrageVerifier.getBestCrossVenueFeeContext([context.pairOrSymbol])
      : null;

    return super.evaluate({
      ...context,
      feesRebates: context.feesRebates ?? (measuredFeeContext ? {
        takerFeeBps: measuredFeeContext.buyTakerFeeBps + measuredFeeContext.sellTakerFeeBps,
      } : undefined),
      crossVenueFees: context.crossVenueFees ?? (measuredFeeContext ? {
        buyVenue: measuredFeeContext.buyVenue,
        sellVenue: measuredFeeContext.sellVenue,
        buyTakerFeeBps: measuredFeeContext.buyTakerFeeBps,
        sellTakerFeeBps: measuredFeeContext.sellTakerFeeBps,
        grossSpreadBps: measuredFeeContext.grossSpreadBps,
      } : undefined),
    }, config);
  }
}

export type {
  GateEvaluation,
  GateSignal,
  GateDecision,
  GateActions,
  SignalStatus,
  CryptaraMarketGateContext,
  CryptaraMarketGateConfig,
  OrderFlowContext,
  OrderFlowTrade,
  MarketProfileContext,
  LiquidityHeatmapContext,
  VolatilityRegimeContext,
  FundingRatesContext,
  CorrelationContext,
  TimeOfDayContext,
  OptionsImpliedContext,
  VenueLatencyContext,
  FeeRebateContext,
  CrossVenueFeeAsymmetryContext,
  FundingCaptureNoInventoryContext,
  DrawdownCapsContext,
  ProfitReinvestmentLadderContext,
  SlippageContext,
} from './types.js';
