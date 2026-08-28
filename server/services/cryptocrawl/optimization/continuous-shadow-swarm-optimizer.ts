import { createHash } from 'node:crypto';
import { quantiComp } from '../../quantiComp/index.js';
import { getMeasuredEvolutionSamples } from '../evolution/measured-execution-feedback.js';
import { registerModelCheckpoint } from '../intelligence/model-registry.js';

export type ShadowSwarmMethod='pso'|'aco'|'bee';
export interface ShadowGenome { profitWeight:number; fillWeight:number; tailRiskWeight:number; slippageWeight:number; latencyWeight:number; costWeight:number; missedOpportunityWeight:number; }
export interface ShadowProposal { id:string;method:ShadowSwarmMethod;genome:ShadowGenome;score:number;sampleCount:number;observedAt:number;status:'shadow';promotionAuthority:false;provenance:string[]; }
const proposals=new Map<string,ShadowProposal>();

function unit(seed:string,index:number):number{
  const hex=createHash('sha256').update(`${seed}:${index}`).digest('hex').slice(0,13);return Number.parseInt(hex,16)/0x1fffffffffffff;
}
function genome(seed:string):ShadowGenome{
  const vals=Array.from({length:7},(_,i)=>0.25+unit(seed,i)*1.5);const sum=vals.reduce((a,b)=>a+b,0);
  return {profitWeight:vals[0]/sum,fillWeight:vals[1]/sum,tailRiskWeight:vals[2]/sum,slippageWeight:vals[3]/sum,latencyWeight:vals[4]/sum,costWeight:vals[5]/sum,missedOpportunityWeight:vals[6]/sum};
}
function evaluate(g:ShadowGenome):{score:number;samples:number}{
  const samples=getMeasuredEvolutionSamples(500);if(!samples.length)return{score:Number.NEGATIVE_INFINITY,samples:0};
  let score=0;for(const sample of samples){
    const profit=sample.realizedProfitUsd??0;const fill=sample.success?1:0;const loss=Math.max(0,-profit);const slip=Math.max(0,sample.slippageBps??0);const latency=Math.max(0,sample.latencyMs);const cost=Math.max(0,sample.feeUsd??0);
    score+=g.profitWeight*profit+g.fillWeight*fill-g.tailRiskWeight*loss-g.slippageWeight*(slip/100)-g.latencyWeight*(latency/1000)-g.costWeight*cost;
  }return{score:score/samples.length,samples:samples.length};
}

export async function runShadowSwarmOptimization(method:ShadowSwarmMethod,population=12):Promise<ShadowProposal|null>{
  const count=Math.max(3,Math.min(64,population));const epoch=Math.floor(Date.now()/Math.max(60000,Number(process.env.SHADOW_SWARM_EPOCH_MS||300000)));
  const workloads=Array.from({length:count},(_,index)=>{
    const seed=`${method}:${epoch}:${index}`;const g=genome(seed);
    return quantiComp.submit({id:`shadow-${seed}`,kind:`shadow_swarm_${method}`,lane:'background',priority:-50,createdAt:Date.now(),input:g,features:{shadow:1,population:count},resourceHints:{cpuWeight:0.2,memoryMB:8,ioWeight:0,parallelismHint:1},policy:{timeoutMs:2000,deadlineAt:Date.now()+5000,deterministic:true,sideEffectFree:true,backendEligible:true,allowDeduplication:true,dedupeKey:seed,usefulWorkUnits:1,strictValidation:true},execute:value=>evaluate(value),validate:result=>Number.isFinite(result.score)||result.score===Number.NEGATIVE_INFINITY});
  });
  const settled=await Promise.allSettled(workloads);const valid=settled.filter((r):r is PromiseFulfilledResult<Awaited<(typeof workloads)[number]>>=>r.status==='fulfilled').map(r=>r.value).filter(r=>r.result.samples>0).sort((a,b)=>b.result.score-a.result.score);
  const best=valid[0];if(!best)return null;const g=best.workloadId?genome(best.workloadId.replace(/^shadow-/,'')):genome(`${method}:${epoch}:0`);
  const proposal:ShadowProposal={id:`shadow-proposal:${method}:${epoch}`,method,genome:g,score:best.result.score,sampleCount:best.result.samples,observedAt:Date.now(),status:'shadow',promotionAuthority:false,provenance:['terminal_measured_replay','quanti_comp_parallel_evaluation','multi_objective_shadow_only']};
  proposals.set(proposal.id,proposal);while(proposals.size>128)proposals.delete(proposals.keys().next().value!);
  await registerModelCheckpoint({modelId:proposal.id,modelKind:`swarm_${method}`,modelVersion:'shadow-swarm-v1',status:'shadow',state:proposal,observedAt:proposal.observedAt,provenance:proposal.provenance});
  return {...proposal,genome:{...proposal.genome},provenance:[...proposal.provenance]};
}
export function getShadowSwarmProposals(){return[...proposals.values()].sort((a,b)=>b.score-a.score).map(p=>({...p,genome:{...p.genome},provenance:[...p.provenance]}));}
export const SHADOW_SWARM_PROMOTION_PIPELINE=['proposal','offline_replay','shadow_paper','governed_canary','explicit_promotion'] as const;
export const SYNTHETIC_FITNESS_AUTHORITY=false as const;
