/** Scheduled deep-validation profile for the authoritative CryptoCrawler Hyper Monte Carlo engine. */
import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { getCryptara, type CryptaraOpportunityContext } from '../../cryptara/index.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { buildHyperMonteCarloRequest } from '../integration/cryptara-bootstrap-wiring.js';
import { runHyperMonteCarlo } from '../validation/monte-carlo-hyper-engine.js';

const INTERVAL_HOURS=Math.max(1,Number(process.env.CRYPTARA_HYPER_TRAINING_INTERVAL_HOURS||6));
const CHECK_MS=60_000;

export interface OptimizedParameters { successRateMultiplier:number; slippageTolerance:number; positionSizeMultiplier:number; gasOptimizationFactor:number; riskAdjustment:number }
export interface OptimizationResult { strategyName:string; marketCondition:string; originalWinRate:number; optimizedWinRate:number; originalSharpe:number; optimizedSharpe:number; profitImprovement:number; recommendedParameters:OptimizedParameters; timestamp:number }
export interface TrainingSession { sessionId:string; startTime:number; endTime:number|null; simulationsCompleted:number; strategiesTrained:string[]; marketConditionsTested:string[]; optimizationResults:OptimizationResult[]; totalProfitImprovement:number; learningsApplied:boolean; status:'running'|'completed'|'failed'; creativityLevel:number; optimizationPasses:number; earlyStopTriggered:boolean }
export interface TrainingMetrics { totalSessionsCompleted:number; lastTrainingTime:number; averageSessionDuration:number; totalSimulationsRun:number; cumulativeProfitImprovement:number; bestOptimizations:OptimizationResult[]; nextScheduledTraining:number; currentStrategyIndex:number }

export class ScheduledMonteCarloTraining {
  private running=false; private timer:ReturnType<typeof setInterval>|null=null; private current:TrainingSession|null=null; private cursor=0;
  private optimized=new Map<string,OptimizedParameters>();
  private metrics:TrainingMetrics={totalSessionsCompleted:0,lastTrainingTime:0,averageSessionDuration:0,totalSimulationsRun:0,cumulativeProfitImprovement:0,bestOptimizations:[],nextScheduledTraining:Date.now()+INTERVAL_HOURS*3_600_000,currentStrategyIndex:0};

  start():void {
    if(this.running)return;
    try{const g=getCryptocrawlGovernance();if(!g.isLongTermMemoryAllowed())return;g.requireAllowed('EVOLVE_STRATEGY');g.requireAllowed('PERSIST_LONG_TERM_MEMORY')}catch{return}
    this.running=true;void this.check();this.timer=setInterval(()=>void this.check(),CHECK_MS);this.timer.unref();
    logger.info('[MonteCarloTraining] Hyper deep-validation scheduler activated',{component:'ScheduledMCTraining',intervalHours:INTERVAL_HOURS,engine:'cryptara_hyper'});
  }
  stop():void {this.running=false;if(this.timer)clearInterval(this.timer);this.timer=null}
  private async check():Promise<void>{if(!this.running||this.current||Date.now()<this.metrics.nextScheduledTraining)return;try{const g=getCryptocrawlGovernance();g.requireAllowed('EVOLVE_STRATEGY');g.requireAllowed('PERSIST_LONG_TERM_MEMORY')}catch{return}await this.runTrainingSession()}
  private failed(id:string,start:number,reason:string):TrainingSession {logger.warn('[MonteCarloTraining] Hyper training unavailable',{component:'ScheduledMCTraining',reason});return{sessionId:id,startTime:start,endTime:Date.now(),simulationsCompleted:0,strategiesTrained:[],marketConditionsTested:[],optimizationResults:[],totalProfitImprovement:0,learningsApplied:false,status:'failed',creativityLevel:1,optimizationPasses:0,earlyStopTriggered:false}}

  async runTrainingSession():Promise<TrainingSession>{
    if(this.current)throw new Error('Training session already in progress');
    const id=`hyper-training-${randomUUID()}`,start=Date.now();
    try{const g=getCryptocrawlGovernance();g.requireAllowed('EVOLVE_STRATEGY');g.requireAllowed('PERSIST_LONG_TERM_MEMORY')}catch{return this.failed(id,start,'governance does not currently allow deep training')}
    const candidates=canonicalOpportunityState.getRecent(32).filter(s=>!!s.plan);
    if(!candidates.length)return this.failed(id,start,'no canonical verified opportunity is available');
    const snapshot=candidates[this.cursor%candidates.length];this.cursor=(this.cursor+1)%candidates.length;this.metrics.currentStrategyIndex=this.cursor;
    this.current={sessionId:id,startTime:start,endTime:null,simulationsCompleted:0,strategiesTrained:[snapshot.symbol],marketConditionsTested:[],optimizationResults:[],totalProfitImprovement:0,learningsApplied:false,status:'running',creativityLevel:1,optimizationPasses:1,earlyStopTriggered:false};
    try{
      const universe=await marketDataProviders.discoverUniverse();
      const context:CryptaraOpportunityContext={opportunityId:snapshot.opportunityId,observedAt:snapshot.observedAt,chain:snapshot.chain,symbol:snapshot.symbol,plan:snapshot.plan,tradingView:snapshot.technical,mempool:snapshot.mempool,marketUniverse:universe,dexObservation:null,missingInformation:[...snapshot.missingInformation],provenance:[...snapshot.provenance,'hyper_training_replay']};
      const request=buildHyperMonteCarloRequest(context,getCryptara().getExecutionHistory(1000),'training'),result=await runHyperMonteCarlo(request);
      const baseline=snapshot.assessment?.monteCarlo?.probabilityOfProfit??request.successPrior,deterministic=snapshot.plan?.netProfitUsd??0,delta=deterministic!==0?(result.expectedProfitUsd-deterministic)/Math.abs(deterministic)*100:0;
      const params:OptimizedParameters={successRateMultiplier:baseline>0?result.probabilityOfProfit/baseline:1,slippageTolerance:result.averageSampledSlippageBps/10_000,positionSizeMultiplier:request.notionalUsd>0?result.recommendedNotionalUsd/request.notionalUsd:0,gasOptimizationFactor:request.gasUsd>0?Math.max(0,1-result.expectedShortfall95Usd/Math.max(request.gasUsd,1e-9)):1,riskAdjustment:request.notionalUsd>0?result.expectedShortfall95Usd/request.notionalUsd:0};
      const observation:OptimizationResult={strategyName:`hyper:${snapshot.symbol}`,marketCondition:result.marketRegime,originalWinRate:baseline,optimizedWinRate:result.probabilityOfProfit,originalSharpe:0,optimizedSharpe:result.sharpeLikeRatio,profitImprovement:delta,recommendedParameters:params,timestamp:Date.now()};
      this.optimized.set(observation.strategyName,params);this.current.simulationsCompleted=1;this.current.marketConditionsTested=[result.marketRegime];this.current.optimizationResults=[observation];this.current.totalProfitImprovement=delta;this.current.learningsApplied=true;this.current.earlyStopTriggered=result.stoppedEarly;this.current.endTime=Date.now();this.current.status='completed';
      const done={...this.current,optimizationResults:[...this.current.optimizationResults]};this.update(done);this.current=null;
      logger.info('[MonteCarloTraining] Hyper deep-validation completed',{component:'ScheduledMCTraining',symbol:snapshot.symbol,iterations:result.iterations,probabilityOfProfit:result.probabilityOfProfit,expectedProfitUsd:result.expectedProfitUsd,expectedVsVerifiedDeltaPct:delta,workers:result.workersUsed});return done;
    }catch(error){const failed=this.current?{...this.current,endTime:Date.now(),status:'failed' as const}:this.failed(id,start,String(error));this.current=null;logger.warn('[MonteCarloTraining] Hyper deep-validation failed',{component:'ScheduledMCTraining',error:error instanceof Error?error.message:String(error)});return failed}
  }
  private update(s:TrainingSession){this.metrics.totalSessionsCompleted++;this.metrics.lastTrainingTime=s.endTime||Date.now();this.metrics.totalSimulationsRun+=s.simulationsCompleted;this.metrics.cumulativeProfitImprovement+=s.totalProfitImprovement;const d=(s.endTime||Date.now())-s.startTime;this.metrics.averageSessionDuration=(this.metrics.averageSessionDuration*(this.metrics.totalSessionsCompleted-1)+d)/this.metrics.totalSessionsCompleted;this.metrics.bestOptimizations=[...this.metrics.bestOptimizations,...s.optimizationResults].sort((a,b)=>b.profitImprovement-a.profitImprovement).slice(0,10);this.metrics.nextScheduledTraining=Date.now()+INTERVAL_HOURS*3_600_000}
  triggerTraining():Promise<TrainingSession>{return this.runTrainingSession()}
  getMetrics():TrainingMetrics{return{...this.metrics,bestOptimizations:[...this.metrics.bestOptimizations]}}
  getCurrentSession():TrainingSession|null{return this.current?{...this.current,optimizationResults:[...this.current.optimizationResults]}:null}
  getOptimizedParams(name:string):OptimizedParameters|null{return this.optimized.get(name)||null}
  getAllOptimizedParams():Map<string,OptimizedParameters>{return new Map(this.optimized)}
  isActive():boolean{return this.running}
}

export const scheduledMonteCarloTraining=new ScheduledMonteCarloTraining();
