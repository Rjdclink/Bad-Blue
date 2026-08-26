import { arbitrageVerifier } from '../../cryptocrawl/arbitrage/arbitrage-verifier.js';
import { opportunityMlRanker } from '../opportunity-ml-ranker.js';
import { CryptaraMarketGateEngine as BaseCryptaraMarketGateEngine } from './engine.js';
import type { CryptaraMarketGateConfig, CryptaraMarketGateContext, GateEvaluation } from './types.js';

export class CryptaraMarketGateEngine extends BaseCryptaraMarketGateEngine {
  evaluate(context: CryptaraMarketGateContext, config: CryptaraMarketGateConfig = {}): GateEvaluation {
    const measuredFeeContext = context.pairOrSymbol
      ? arbitrageVerifier.getBestCrossVenueFeeContext([context.pairOrSymbol])
      : null;

    const enrichedContext: CryptaraMarketGateContext = {
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
    };

    const evaluation = super.evaluate(enrichedContext, config);
    const mlAssessment = opportunityMlRanker.assess(enrichedContext);

    // AI/ML is advisory evidence only. It may rank and learn from opportunities, but it
    // never overrides the deterministic market-gate decision or converts unknown/failed
    // critical evidence into authorization.
    return {
      ...evaluation,
      signals: [...evaluation.signals, mlAssessment.signal],
    };
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
