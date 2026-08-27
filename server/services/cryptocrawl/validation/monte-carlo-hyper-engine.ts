import os from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  QuantiParallelismError,
  quantiParallelismGovernor,
} from '../../quantiComp/index.js';

export const HYPER_MONTE_CARLO_MODEL_VERSION = 'cryptara-hyper-mc-1.1.0';
export type HyperMonteCarloMode = 'live' | 'training';

export interface HyperMonteCarloRequest {
  opportunityId: string; observedAt: number; symbol: string; mode: HyperMonteCarloMode;
  notionalUsd: number; requestedNotionalUsd: number; executableNotionalUsd: number;
  netProfitUsd: number; grossProfitUsd: number; totalCostsUsd: number; gasUsd: number;
  expectedSlippageBps: number; expectedPriceImpactBps: number;
  quoteAgeMs: number; quoteMaxAgeMs: number; liquidityScore: number;
  annualizedVolatility: number | null; gasVolatility: number; successPrior: number;
  calibrationSamples: number; measuredLatenciesMs: number[]; measuredSlippageBps: number[];
  technicalProvenance: string | null; technicalAgeMs: number | null; technicalMaxAgeMs: number;
  feeEvidenceMeasured: boolean; liquidityMeasured: boolean; priceHistoryMeasured: boolean;
  onchainTelemetryRequired: boolean; onchainTelemetryMeasured: boolean;
}

export interface HyperMonteCarloResult {
  modelVersion: string; mode: HyperMonteCarloMode; seed: number; iterations: number;
  elapsedMs: number; workersUsed: number; stoppedEarly: boolean; convergence: number;
  expectedProfitUsd: number; rawExpectedProfitUsd: number; probabilityOfProfit: number;
  probabilityBothLegsFill: number; confidence: number; confidenceInterval: [number, number];
  valueAtRisk95Usd: number; expectedShortfall95Usd: number; maxDrawdown: number;
  standardDeviationUsd: number; sharpeLikeRatio: number; p5Usd: number; p50Usd: number; p95Usd: number;
  averageSampledSlippageBps: number; averageSampledLatencyMs: number; executionDeadlineMs: number;
  recommendedNotionalUsd: number; maxSafeNotionalUsd: number; marketRegime: string;
  evidenceQuality: number; controlVariateBeta: number; missingInformation: string[];
}

type WReq = Pick<HyperMonteCarloRequest, 'notionalUsd'|'netProfitUsd'|'totalCostsUsd'|'gasUsd'|'expectedSlippageBps'|'expectedPriceImpactBps'|'quoteAgeMs'|'quoteMaxAgeMs'|'liquidityScore'|'annualizedVolatility'|'gasVolatility'|'successPrior'|'measuredLatenciesMs'|'measuredSlippageBps'|'onchainTelemetryRequired'> & { stressScale: number };
type Batch = { pnl:number[]; control:number[]; fills:number[]; slip:number[]; latency:number[] };
type Job = { id:number; req:WReq; n:number; seed:number; resolve:(b:Batch)=>void; reject:(e:Error)=>void; cancelled:boolean };
type Slot = { worker:Worker; busy:boolean; job:Job|null };

const WORKER_SOURCE = String.raw`
const {parentPort}=require('node:worker_threads'); const YEAR=365.25*24*60*60*1000;
const c=(v,a,b)=>Math.max(a,Math.min(b,v));
function rng(seed){let s=seed>>>0||0x9e3779b9;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s>>>=0;s^=s<<5;s>>>=0;return(s>>>0)/4294967296}}
function norm(r){const a=Math.max(1e-12,r()),b=r(),q=Math.sqrt(-2*Math.log(a)),t=2*Math.PI*b;return[q*Math.cos(t),q*Math.sin(t)]}
function emp(v,u,f){if(Array.isArray(v)&&v.length){const x=Number(v[Math.min(v.length-1,Math.floor(c(u,0,.999999999)*v.length))]);if(Number.isFinite(x))return x}return f}
function draw(r){const a=norm(r),b=norm(r);return{p:a[0],s:a[1],l:b[0],g:b[1],u:r(),lu:r(),su:r()}}
function anti(d){return{p:-d.p,s:-d.s,l:-d.l,g:-d.g,u:1-d.u,lu:1-d.lu,su:1-d.su}}
function sim(x,d){
 const base=emp(x.measuredLatenciesMs,d.lu,Math.max(1,x.quoteAgeMs)),ls=x.measuredLatenciesMs?.length>=3?.12:.25;
 const latency=Math.max(1,base*Math.exp(d.l*ls-.5*ls*ls)),age=Math.max(0,x.quoteAgeMs)+latency,fresh=c(1-age/Math.max(1,x.quoteMaxAgeMs),0,1);
 const ms=emp(x.measuredSlippageBps,d.su,Math.max(0,x.expectedSlippageBps)),scale=Math.max(.5,x.expectedSlippageBps,x.expectedPriceImpactBps);
 const slip=Math.max(0,ms+Math.abs(d.s)*scale*.35*x.stressScale),extra=Math.max(0,slip-Math.max(0,x.expectedSlippageBps))*x.notionalUsd/10000;
 const pf=c(x.successPrior*(.75+.25*c(x.liquidityScore,0,1))*(.65+.35*fresh),.01,.995),fill=d.u<pf;
 const vol=Number.isFinite(x.annualizedVolatility)?Math.max(0,x.annualizedVolatility):0,sigma=x.notionalUsd*vol*Math.sqrt(Math.max(1,age)/YEAR)*x.stressScale,shock=sigma*d.p;
 const control=Math.abs(shock)-sigma*Math.sqrt(2/Math.PI),gas=x.onchainTelemetryRequired?Math.max(-x.gasUsd*.75,x.gasUsd*x.gasVolatility*d.g*.35*x.stressScale):0;
 const pnl=fill&&fresh>0?x.netProfitUsd-extra-Math.max(0,gas):-(Math.abs(shock)+extra+x.totalCostsUsd+Math.max(0,gas));
 return[pnl,control,fill&&fresh>0?1:0,slip,latency];
}
parentPort.on('message',m=>{const r=rng(m.seed),out=new Float64Array(m.n*5);let base=null;for(let i=0;i<m.n;i++){const d=i%2===0||!base?draw(r):anti(base);if(i%2===0)base=d;const q=sim(m.req,d),o=i*5;for(let k=0;k<5;k++)out[o+k]=q[k]}parentPort.postMessage({id:m.id,buffer:out.buffer},[out.buffer])});
`;

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const num=(v:unknown,d=0)=>Number.isFinite(Number(v))?Number(v):d;
function hash32(s:string){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return h>>>0}
const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
function vari(a:number[],m=avg(a)){return a.length<2?0:a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1)}
function cov(a:number[],b:number[],am:number,bm:number){const n=Math.min(a.length,b.length);if(n<2)return 0;let s=0;for(let i=0;i<n;i++)s+=(a[i]-am)*(b[i]-bm);return s/(n-1)}
function q(a:number[],p:number){if(!a.length)return 0;const x=clamp(p,0,1)*(a.length-1),l=Math.floor(x),u=Math.ceil(x);return l===u?a[l]:a[l]*(u-x)+a[u]*(x-l)}
function wilson(k:number,n:number):[number,number]{if(!n)return[0,1];const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;return[clamp(c-m,0,1),clamp(c+m,0,1)]}

class Pool {
  readonly size:number; private slots:Slot[]=[]; private queue:Job[]=[]; private id=1;
  constructor(){const a=Math.max(1,os.availableParallelism?.()||os.cpus().length),c=Math.max(1,num(process.env.CRYPTARA_HYPER_MC_WORKERS,a));this.size=Math.min(a,c,8)}
  private slot():Slot{const worker=new Worker(WORKER_SOURCE,{eval:true}),s:Slot={worker,busy:false,job:null};worker.unref();worker.on('message',(m:{id:number;buffer:ArrayBuffer})=>{const j=s.job;if(!j||j.id!==m.id)return;const x=new Float64Array(m.buffer),b:Batch={pnl:[],control:[],fills:[],slip:[],latency:[]};for(let i=0;i<x.length;i+=5){b.pnl.push(x[i]);b.control.push(x[i+1]);b.fills.push(x[i+2]);b.slip.push(x[i+3]);b.latency.push(x[i+4])}s.busy=false;s.job=null;worker.unref();if(!j.cancelled)j.resolve(b);this.pump()});worker.on('error',e=>{const j=s.job;s.busy=false;s.job=null;if(j&&!j.cancelled)j.reject(e);this.slots=this.slots.filter(v=>v!==s);this.pump()});return s}
  private ensure(){while(this.slots.length<this.size)this.slots.push(this.slot())}
  private pump(){this.ensure();for(const s of this.slots){if(s.busy)continue;let j:Job|undefined;while((j=this.queue.shift())?.cancelled){}if(!j)return;s.busy=true;s.job=j;s.worker.ref();s.worker.postMessage({id:j.id,req:j.req,n:j.n,seed:j.seed})}}
  private dispatch(req:WReq,n:number,seed:number,signal?:AbortSignal){return new Promise<Batch>((resolve,reject)=>{const j:Job={id:this.id++,req,n,seed,resolve,reject,cancelled:false};const abort=()=>{j.cancelled=true;reject(new Error('HYPER_ABORTED: Monte Carlo batch aborted'))};signal?.addEventListener('abort',abort,{once:true});const done=j.resolve,fail=j.reject;j.resolve=v=>{signal?.removeEventListener('abort',abort);done(v)};j.reject=e=>{signal?.removeEventListener('abort',abort);fail(e)};this.queue.push(j);this.pump()})}
  run(req:WReq,n:number,seed:number,signal?:AbortSignal,maxParallelism=this.size){this.ensure();const parts=Math.max(1,Math.min(this.size,Math.max(1,Math.floor(maxParallelism)),Math.ceil(n/64))),base=Math.floor(n/parts),rem=n%parts;return Promise.all(Array.from({length:parts},(_,i)=>this.dispatch(req,base+(i<rem?1:0),hash32(`${seed}:${i}`),signal)))}
  async close():Promise<void>{const slots=[...this.slots];this.slots=[];for(const j of this.queue.splice(0))if(!j.cancelled)j.reject(new Error('HYPER_ABORTED: worker pool shutdown'));await Promise.allSettled(slots.map(s=>s.worker.terminate()))}
}
const pool=new Pool();
export async function shutdownHyperMonteCarloWorkers():Promise<void>{await pool.close()}

function configuredBatch(mode:HyperMonteCarloMode):number{
 return mode==='live'
  ?Math.max(64,num(process.env.CRYPTARA_HYPER_MC_BATCH_SIZE,128))
  :Math.max(256,num(process.env.CRYPTARA_HYPER_MC_TRAINING_BATCH_SIZE,512));
}

export function estimateHyperMonteCarloParallelism(mode:HyperMonteCarloMode):number{
 return Math.min(pool.size,Math.max(1,Math.ceil(configuredBatch(mode)/64)));
}

function currentQuoteAgeMs(r:HyperMonteCarloRequest):number{
 return Math.max(0,r.quoteAgeMs+Math.max(0,Date.now()-r.observedAt));
}

function quality(r:HyperMonteCarloRequest){let score=1;const missing:string[]=[];if(!r.feeEvidenceMeasured){score-=.18;missing.push('authenticated_fee_evidence')}if(!r.liquidityMeasured){score-=.20;missing.push('measured_liquidity')}if(!r.priceHistoryMeasured||r.annualizedVolatility===null){score-=.18;missing.push('price_history')}if(r.onchainTelemetryRequired&&!r.onchainTelemetryMeasured){score-=.18;missing.push('gas_observations')}if(!r.technicalProvenance){score-=.08;missing.push('technical_analysis')}else if(r.technicalProvenance!=='live')score-=r.technicalAgeMs!==null&&r.technicalAgeMs<=r.technicalMaxAgeMs?.04:.10;if(r.calibrationSamples<3){score-=.12;missing.push('posttrade_calibration_pending')}else score+=Math.min(.08,Math.log10(r.calibrationSamples+1)*.04);return{score:clamp(score,.2,1),missing:[...new Set(missing)]}}
function regime(v:number|null){return v===null||!Number.isFinite(v)?'unknown':v>=1.5?'crisis':v>=.8?'volatile':v<=.25?'calm':'normal'}

export async function runHyperMonteCarlo(r:HyperMonteCarloRequest,signal?:AbortSignal):Promise<HyperMonteCarloResult>{
 const started=Date.now();
 if(!Number.isFinite(r.notionalUsd)||r.notionalUsd<=0||!Number.isFinite(r.netProfitUsd))throw new Error('EVIDENCE_INCOMPLETE: verified_opportunity_economics');
 const ageBeforeAdmission=currentQuoteAgeMs(r);
 if(!Number.isFinite(r.quoteAgeMs)||r.quoteAgeMs<0||!Number.isFinite(ageBeforeAdmission)||ageBeforeAdmission>r.quoteMaxAgeMs)throw new Error('EVIDENCE_INCOMPLETE: fresh_verified_quote');
 if(signal?.aborted)throw new Error('HYPER_ABORTED: Monte Carlo aborted before execution');

 const live=r.mode==='live',min=live?Math.max(64,num(process.env.CRYPTARA_HYPER_MC_MIN_SAMPLES,128)):Math.max(512,num(process.env.CRYPTARA_HYPER_MC_TRAINING_MIN_SAMPLES,1024)),max=live?Math.max(min,num(process.env.CRYPTARA_HYPER_MC_MAX_SAMPLES,2048)):Math.max(min,num(process.env.CRYPTARA_HYPER_MC_TRAINING_MAX_SAMPLES,10000)),batch=configuredBatch(r.mode),target=live?clamp(num(process.env.CRYPTARA_HYPER_MC_TARGET_HALF_WIDTH,.035),.005,.2):clamp(num(process.env.CRYPTARA_HYPER_MC_TRAINING_TARGET_HALF_WIDTH,.015),.003,.1),rejectAt=clamp(num(process.env.CRYPTARA_HYPER_MC_EARLY_REJECT_UPPER,.55),.05,.95),acceptAt=clamp(num(process.env.CRYPTARA_HYPER_MC_EARLY_ACCEPT_LOWER,.80),.05,.99);
 const requestedParallelism=Math.min(pool.size,Math.max(1,Math.ceil(batch/64)));
 const quoteDeadlineAt=live?Date.now()+Math.max(1,r.quoteMaxAgeMs-ageBeforeAdmission):undefined;
 let lease;
 try{
  lease=await quantiParallelismGovernor.acquire({
   id:`hyper-mc:${r.opportunityId}:${r.observedAt}:${r.mode}`,
   units:requestedParallelism,
   lane:live?'hot':'batch',
   priority:live?80:40,
   deadlineAt:quoteDeadlineAt,
   signal,
   metadata:{model:HYPER_MONTE_CARLO_MODEL_VERSION,mode:r.mode,symbol:r.symbol},
  });
 }catch(error){
  if(error instanceof QuantiParallelismError&&error.code==='DEADLINE_EXPIRED')throw new Error('EVIDENCE_INCOMPLETE: fresh_verified_quote');
  if(error instanceof QuantiParallelismError&&error.code==='ABORTED')throw new Error('HYPER_ABORTED: Monte Carlo admission aborted');
  throw error;
 }

 try{
  const admittedQuoteAge=currentQuoteAgeMs(r);
  if(admittedQuoteAge>r.quoteMaxAgeMs)throw new Error('EVIDENCE_INCOMPLETE: fresh_verified_quote');
  const seed=hash32(`${HYPER_MONTE_CARLO_MODEL_VERSION}:${r.opportunityId}:${r.observedAt}:${r.mode}`),qual=quality(r),req:WReq={notionalUsd:r.notionalUsd,netProfitUsd:r.netProfitUsd,totalCostsUsd:Math.max(0,r.totalCostsUsd),gasUsd:Math.max(0,r.gasUsd),expectedSlippageBps:Math.max(0,r.expectedSlippageBps),expectedPriceImpactBps:Math.max(0,r.expectedPriceImpactBps),quoteAgeMs:admittedQuoteAge,quoteMaxAgeMs:r.quoteMaxAgeMs,liquidityScore:clamp(r.liquidityScore,0,1),annualizedVolatility:r.annualizedVolatility,gasVolatility:clamp(r.gasVolatility,0,3),successPrior:clamp(r.successPrior,.01,.995),measuredLatenciesMs:r.measuredLatenciesMs.filter(v=>Number.isFinite(v)&&v>0).slice(-256),measuredSlippageBps:r.measuredSlippageBps.filter(v=>Number.isFinite(v)&&v>=0).slice(-256),onchainTelemetryRequired:r.onchainTelemetryRequired,stressScale:live?1:1.35};
  const pnl:number[]=[],control:number[]=[],fills:number[]=[],slip:number[]=[],latency:number[]=[];let ci:[number,number]=[0,1],stopped=false,bi=0;
  while(pnl.length<max){if(signal?.aborted)throw new Error('HYPER_ABORTED: Monte Carlo aborted during execution');const n=Math.min(batch,max-pnl.length),parts=await pool.run(req,n,hash32(`${seed}:batch:${bi++}`),signal,lease.units);for(const p of parts){pnl.push(...p.pnl);control.push(...p.control);fills.push(...p.fills);slip.push(...p.slip);latency.push(...p.latency)}ci=wilson(pnl.filter(v=>v>0).length,pnl.length);const half=(ci[1]-ci[0])/2;if(pnl.length>=min&&(half<=target||(live&&(ci[1]<rejectAt||ci[0]>acceptAt)))){stopped=pnl.length<max;break}}
  const raw=avg(pnl),cm=avg(control),cv=vari(control,cm),beta=cv>0?cov(pnl,control,raw,cm)/cv:0,expected=raw-beta*cm,sd=Math.sqrt(Math.max(0,vari(pnl,raw))),sorted=[...pnl].sort((a,b)=>a-b),p5=q(sorted,.05),p50=q(sorted,.5),p95=q(sorted,.95),tail=sorted.slice(0,Math.max(1,Math.ceil(sorted.length*.05))),pProfit=pnl.filter(v=>v>0).length/Math.max(1,pnl.length),pFill=avg(fills),sampling=clamp(1-(ci[1]-ci[0]),0,1),cal=r.calibrationSamples>=3?Math.min(1,.82+Math.log10(r.calibrationSamples+1)*.08):.75,confidence=clamp(sampling*qual.score*cal,0,1),elapsed=Date.now()-started,avgSlip=avg(slip),avgLatency=avg(latency),deadline=Math.max(0,r.quoteMaxAgeMs-currentQuoteAgeMs(r)-avgLatency),slipScale=r.expectedSlippageBps>0?clamp(r.expectedSlippageBps/Math.max(r.expectedSlippageBps,avgSlip),.25,1):1,maxSafe=Math.max(0,Math.min(r.executableNotionalUsd,r.requestedNotionalUsd)*slipScale),sizeScale=clamp((pProfit-.5)/.35,0,1)*clamp(pFill,0,1),recommended=expected>0?Math.min(r.notionalUsd,maxSafe*sizeScale):0;
  return{modelVersion:HYPER_MONTE_CARLO_MODEL_VERSION,mode:r.mode,seed,iterations:pnl.length,elapsedMs:elapsed,workersUsed:Math.min(pool.size,lease.units,Math.max(1,Math.ceil(Math.min(batch,pnl.length)/64))),stoppedEarly:stopped,convergence:clamp((ci[1]-ci[0])/2,0,1),expectedProfitUsd:expected,rawExpectedProfitUsd:raw,probabilityOfProfit:pProfit,probabilityBothLegsFill:pFill,confidence,confidenceInterval:ci,valueAtRisk95Usd:Math.max(0,-p5),expectedShortfall95Usd:Math.max(0,-avg(tail)),maxDrawdown:r.notionalUsd>0?clamp(Math.max(0,-sorted[0])/r.notionalUsd,0,1):0,standardDeviationUsd:sd,sharpeLikeRatio:sd>0?expected/sd:0,p5Usd:p5,p50Usd:p50,p95Usd:p95,averageSampledSlippageBps:avgSlip,averageSampledLatencyMs:avgLatency,executionDeadlineMs:deadline,recommendedNotionalUsd:recommended,maxSafeNotionalUsd:maxSafe,marketRegime:regime(r.annualizedVolatility),evidenceQuality:qual.score,controlVariateBeta:beta,missingInformation:qual.missing};
 }finally{
  lease.release();
 }
}
