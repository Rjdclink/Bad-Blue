import Cryptara, {
  getCryptara,
  type CryptaraExecutionFeedback,
  type CryptaraMonteCarloEvidence,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
  type MonteCarloResult,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import type { MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import {
  HYPER_MONTE_CARLO_MODEL_VERSION,
  runHyperMonteCarlo,
  type HyperMonteCarloMode,
  type HyperMonteCarloRequest,
  type HyperMonteCarloResult,
} from '../validation/monte-carlo-hyper-engine.js';

const log = createLogger('CryptaraBootstrapWiring');
const installed = new WeakSet<object>();

type HyperEvidence = CryptaraMonteCarloEvidence & {
  sourceObservedAt: number;
  mode: 'pretrade_bootstrap' | 'posttrade_calibrated';
  calibrationSamples: number;
  modelVersion: string;
  iterations: number;
  seed: number;
  workersUsed: number;
  convergence: number;
  stoppedEarly: boolean;
  expectedProfitUsd: number;
  probabilityBothLegsFill: number;
  executionDeadlineMs: number;
  recommendedNotionalUsd: number;
  maxSafeNotionalUsd: number;
  averageSampledSlippageBps: number;
  averageSampledLatencyMs: number;
};

type Internals = {
  status: { isRunning:boolean; lastSimulationTime:Date|null; totalSimulations:number; errorCount:number };
  latestOpportunityContext: CryptaraOpportunityContext | null;
  latestMonteCarloEvidence: HyperEvidence | null;
  executionHistory: CryptaraExecutionFeedback[];
  runMonteCarloSimulation: (context?:CryptaraOpportunityContext, signal?:AbortSignal)=>Promise<MonteCarloResult>;
  recordOpportunityObservation: (context:CryptaraOpportunityContext)=>CryptaraOpportunityAssessment;
  recordExecutionResult: (feedback:CryptaraExecutionFeedback)=>void;
  emit: (event:string,...args:unknown[])=>boolean;
};

function asset(universe:MarketUniverseAsset[], symbol:string):MarketUniverseAsset|undefined {
  const s=symbol.trim().toUpperCase();
  return universe.find(a=>a.symbol.toUpperCase()===s) || universe.find(a=>a.symbol.toUpperCase()===`${s.replace(/(USDT|USDC|USD)$/,'')}USDT`);
}
function annualizedVolatility(prices:number[]|undefined):number|null {
  if(!prices||prices.length<20)return null;
  const returns=prices.slice(1).map((p,i)=>p>0&&prices[i]>0?(p-prices[i])/prices[i]:0).filter(Number.isFinite);
  if(returns.length<10)return null;
  return Math.max(.001,Math.min(3,Math.sqrt(returns.reduce((s,v)=>s+v*v,0)/returns.length)*Math.sqrt(365*24)));
}
function terminal(history:CryptaraExecutionFeedback[],symbol:string){
  return history.filter(e=>e.symbol.toUpperCase()===symbol.toUpperCase()&&e.settlementConfirmed===true&&e.realizedProfitUsd!==null&&Number.isFinite(e.realizedProfitUsd));
}

export function buildHyperMonteCarloRequest(
  context:CryptaraOpportunityContext,
  executionHistory:CryptaraExecutionFeedback[],
  mode:HyperMonteCarloMode='live',
):HyperMonteCarloRequest {
  const plan=context.plan;
  if(!plan)throw new Error('EVIDENCE_INCOMPLETE: verified_opportunity_economics');
  const marketAsset=asset(context.marketUniverse,context.symbol), prices=marketAsset?.priceHistory;
  const history=terminal(executionHistory,context.symbol), latencies=history.map(e=>e.latencyMs).filter(v=>Number.isFinite(v)&&v>0), slippage=history.map(e=>e.slippageBps).filter((v):v is number=>v!==null&&Number.isFinite(v)&&v>=0);
  const calibrated=history.length>=3&&latencies.length>0, wins=history.filter(e=>e.success&&e.realizedProfitUsd!>0).length;
  const liquidityMeasured=plan.liquidity.status==='measured'&&plan.liquidity.buyAvailableBaseQty!==null&&plan.liquidity.sellAvailableBaseQty!==null;
  const liquidity=liquidityMeasured?Math.max(0,Math.min(1,Math.min(plan.liquidity.buyAvailableBaseQty!,plan.liquidity.sellAvailableBaseQty!)/Math.max(plan.baseQty,1e-12))):0;
  const quoteMaxAgeMs=Math.max(1,Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS||5000)), freshness=Math.max(0,Math.min(1,1-plan.quoteAgeMs/quoteMaxAgeMs));
  const prior=calibrated?(wins+2)/(history.length+4):Math.max(.25,Math.min(.80,.35+liquidity*.25+freshness*.15+(plan.netProfitUsd>0?.05:0)));
  const mempool=context.mempool, onchain=plan.crossVenueCostModel==='bridge'||!!plan.bridge, gasMeasured=!!mempool&&mempool.available===true&&mempool.avgGasPrice>0&&mempool.maxGasPrice>0;
  const technicalMaxAgeMs=Math.max(30_000,Number(process.env.TRADINGVIEW_DATA_TTL_MS||300_000));
  return {
    opportunityId:context.opportunityId, observedAt:context.observedAt, symbol:context.symbol, mode,
    notionalUsd:plan.notionalUsd, requestedNotionalUsd:plan.requestedNotionalUsd, executableNotionalUsd:plan.executableNotionalUsd,
    netProfitUsd:plan.netProfitUsd, grossProfitUsd:plan.grossProfitUsd, totalCostsUsd:plan.costs.totalCostsUsd, gasUsd:plan.costs.gasUsd,
    expectedSlippageBps:Math.max(0,plan.expectedSlippageBps??0), expectedPriceImpactBps:Math.max(0,plan.expectedPriceImpactBps??0),
    quoteAgeMs:plan.quoteAgeMs, quoteMaxAgeMs, liquidityScore:liquidity, annualizedVolatility:annualizedVolatility(prices),
    gasVolatility:gasMeasured?Math.max(0,Math.min(3,(mempool!.maxGasPrice-mempool!.avgGasPrice)/mempool!.avgGasPrice)):0,
    successPrior:prior, calibrationSamples:history.length, measuredLatenciesMs:latencies, measuredSlippageBps:slippage,
    technicalProvenance:context.tradingView?.dataProvenance??null,
    technicalAgeMs:context.tradingView?Math.max(0,Date.now()-context.tradingView.sourceTimestamp):null,
    technicalMaxAgeMs, feeEvidenceMeasured:!!plan.feeEvidence, liquidityMeasured,
    priceHistoryMeasured:!!prices&&prices.length>=20, onchainTelemetryRequired:onchain, onchainTelemetryMeasured:!onchain||gasMeasured,
  };
}

function toResult(h:HyperMonteCarloResult,mode:HyperEvidence['mode'],notional:number):MonteCarloResult {
  return {
    simulationId:`hyper-${h.seed}-${Date.now()}`, timestamp:new Date(), iterations:h.iterations,
    scenarios:[{name:mode==='posttrade_calibrated'?'Measured execution calibrated Hyper distribution':'Measured pre-trade Hyper distribution',probability:h.probabilityOfProfit,expectedReturn:notional>0?h.expectedProfitUsd/notional:0,maxDrawdown:h.maxDrawdown,sharpeRatio:h.sharpeLikeRatio}],
    optimalStrategy:mode==='posttrade_calibrated'?'verified-arbitrage-hyper-calibrated':'verified-arbitrage-hyper-bootstrap',
    riskMetrics:{valueAtRisk:notional>0?h.valueAtRisk95Usd/notional:0,expectedShortfall:notional>0?h.expectedShortfall95Usd/notional:0,maxDrawdown:h.maxDrawdown,volatility:h.standardDeviationUsd/Math.max(notional,1e-12)},
    learnings:[`Hyper MC ${h.modelVersion}: P(profit)=${h.probabilityOfProfit.toFixed(4)}, P(both fills)=${h.probabilityBothLegsFill.toFixed(4)}, deadline=${Math.round(h.executionDeadlineMs)}ms`],
  };
}

async function runBootstrapAwareMonteCarlo(this:Internals,contextOverride?:CryptaraOpportunityContext,signal?:AbortSignal):Promise<MonteCarloResult>{
  if(!this.status.isRunning)throw new Error('CRYPTARA is not running. Call initialize() first.');
  const source=contextOverride??this.latestOpportunityContext;
  if(!source)throw new Error('EVIDENCE_INCOMPLETE: verified_opportunity_context');
  const context=structuredClone(source), request=buildHyperMonteCarloRequest(context,this.executionHistory,'live');
  this.latestMonteCarloEvidence=null; this.status.totalSimulations++;
  try {
    const hyper=await runHyperMonteCarlo(request,signal), calibrated=request.calibrationSamples>=3&&request.measuredLatenciesMs.length>0;
    const mode:HyperEvidence['mode']=calibrated?'posttrade_calibrated':'pretrade_bootstrap', result=toResult(hyper,mode,request.notionalUsd), scale=Math.max(request.notionalUsd,1e-12);
    this.latestMonteCarloEvidence={
      simulationId:result.simulationId,evaluatedAt:Date.now(),sourceOpportunityId:context.opportunityId,sourceObservedAt:context.observedAt,
      mode,calibrationSamples:request.calibrationSamples,modelVersion:HYPER_MONTE_CARLO_MODEL_VERSION,iterations:hyper.iterations,seed:hyper.seed,workersUsed:hyper.workersUsed,convergence:hyper.convergence,stoppedEarly:hyper.stoppedEarly,
      expectedProfit:hyper.expectedProfitUsd/scale,probabilityOfProfit:hyper.probabilityOfProfit,valueAtRisk95:hyper.valueAtRisk95Usd/scale,expectedShortfall:hyper.expectedShortfall95Usd/scale,maxDrawdown:hyper.maxDrawdown,marketRegime:hyper.marketRegime,confidence:hyper.confidence,missingInformation:[...hyper.missingInformation],
      expectedProfitUsd:hyper.expectedProfitUsd,probabilityBothLegsFill:hyper.probabilityBothLegsFill,executionDeadlineMs:hyper.executionDeadlineMs,recommendedNotionalUsd:hyper.recommendedNotionalUsd,maxSafeNotionalUsd:hyper.maxSafeNotionalUsd,averageSampledSlippageBps:hyper.averageSampledSlippageBps,averageSampledLatencyMs:hyper.averageSampledLatencyMs,
    };
    this.status.lastSimulationTime=new Date(); this.emit('simulation:completed',result); this.emit('evolution:trigger',{learnings:result.learnings,timestamp:new Date(),mode});
    log.info('Cryptara Hyper Monte Carlo completed',{opportunityId:context.opportunityId,observedAt:context.observedAt,mode,iterations:hyper.iterations,workers:hyper.workersUsed,elapsedMs:hyper.elapsedMs,stoppedEarly:hyper.stoppedEarly,probabilityOfProfit:hyper.probabilityOfProfit,probabilityBothLegsFill:hyper.probabilityBothLegsFill,expectedProfitUsd:hyper.expectedProfitUsd,recommendedNotionalUsd:hyper.recommendedNotionalUsd,executionDeadlineMs:hyper.executionDeadlineMs,missingInformation:hyper.missingInformation});
    return result;
  } catch(error){this.latestMonteCarloEvidence=null;this.status.errorCount++;throw error;}
}

export function ensureCryptaraBootstrapWiring():Cryptara {
  const instance=getCryptara(); if(installed.has(instance))return instance; installed.add(instance); const target=instance as unknown as Internals;
  target.runMonteCarloSimulation=runBootstrapAwareMonteCarlo.bind(target);
  const originalObservation=target.recordOpportunityObservation.bind(target);
  target.recordOpportunityObservation=(context:CryptaraOpportunityContext):CryptaraOpportunityAssessment=>{
    const assessment=originalObservation(context), evidence=target.latestMonteCarloEvidence, exact=!!evidence&&evidence.sourceOpportunityId===context.opportunityId&&evidence.sourceObservedAt===context.observedAt;
    canonicalOpportunityState.recordAssessment({opportunityId:context.opportunityId,observedAt:context.observedAt,chain:context.chain,symbol:context.symbol,plan:context.plan,technical:context.tradingView,mempool:context.mempool,assessment:{opportunityId:assessment.opportunityId,evaluatedAt:assessment.evaluatedAt,recommendation:assessment.recommendation,rankScore:assessment.rankScore,executionConfidence:assessment.executionConfidence,probabilityOfProfitableExecution:assessment.probabilityOfProfitableExecution,riskLevel:assessment.riskLevel,dataCompleteness:assessment.dataCompleteness,marketData:{...assessment.marketData},missingInformation:[...assessment.missingInformation],provenance:[...assessment.provenance],monteCarlo:exact?{mode:evidence!.mode,calibrationSamples:evidence!.calibrationSamples,evaluatedAt:evidence!.evaluatedAt,probabilityOfProfit:evidence!.probabilityOfProfit,confidence:evidence!.confidence,valueAtRisk95:evidence!.valueAtRisk95,expectedShortfall:evidence!.expectedShortfall,maxDrawdown:evidence!.maxDrawdown,marketRegime:evidence!.marketRegime}:null}});
    return assessment;
  };
  const originalExecution=target.recordExecutionResult.bind(target);
  target.recordExecutionResult=(feedback:CryptaraExecutionFeedback):void=>{originalExecution(feedback);canonicalOpportunityState.recordExecution({opportunityId:feedback.opportunityId,chain:feedback.chain,symbol:feedback.symbol,success:feedback.success,realizedProfitUsd:feedback.realizedProfitUsd,feeUsd:feedback.feeUsd,slippageBps:feedback.slippageBps,latencyMs:feedback.latencyMs,settlementStatus:feedback.settlementStatus,settlementConfirmed:feedback.settlementConfirmed,settlement:feedback.settlement,provenance:feedback.provenance})};
  log.info('Cryptara Hyper Monte Carlo bootstrap wiring installed',{modelVersion:HYPER_MONTE_CARLO_MODEL_VERSION,liveMode:'adaptive_worker_pool',posttradeCalibration:'terminal_settlement_only',canonicalOpportunityState:true});
  return instance;
}
