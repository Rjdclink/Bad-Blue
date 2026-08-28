import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';

export interface CainTwinMeasuredPerformance { twinId:string;regime:string;terminalSamples:number;successRate:number;realizedNetUsd:number;latencyP95Ms:number;errorRate:number;calibrationError:number;healthy:boolean;observedAt:number; }
export interface CainTwinLeaderState { leaderId:string|null;followerId:string|null;changedAt:number|null;reason:string;confidence:number;executionAuthority:false; }
const latest=new Map<string,CainTwinMeasuredPerformance>();let leader:CainTwinLeaderState={leaderId:null,followerId:null,changedAt:null,reason:'insufficient measured evidence',confidence:0,executionAuthority:false};

function score(value:CainTwinMeasuredPerformance):number{
  if(!value.healthy||value.terminalSamples<=0)return Number.NEGATIVE_INFINITY;
  const sampleConfidence=Math.min(1,value.terminalSamples/Math.max(1,Number(process.env.CAIN_TWIN_MIN_TERMINAL_SAMPLES||30)));
  return sampleConfidence*(value.successRate+Math.tanh(value.realizedNetUsd/100)-Math.min(1,value.latencyP95Ms/5000)-value.errorRate-value.calibrationError);
}
async function persistChange(previous:string|null,next:string,reason:string,observedAt:number):Promise<void>{
  const id=`cain-twin-leader:${createHash('sha256').update(`${previous}:${next}:${observedAt}:${reason}`).digest('hex')}`;
  await pool.query(`insert into private.cryptara_governance_events(event_id,observed_at,event_kind,stage,authority,model_version,config_version,provenance,source_event_ids,payload)
    values($1,$2,'cain_twin_leader_change',null,'coordination_projection','cain-twin-v1',$3,$4,$5,$6::jsonb) on conflict(event_id) do nothing`,[
    id,new Date(observedAt),process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim()||'runtime-config-v1',['measured_terminal_performance','hysteretic_leadership'],[],JSON.stringify({previous,next,reason,executionAuthority:false})]);
}
export function observeCainTwinPerformance(value:CainTwinMeasuredPerformance):CainTwinLeaderState{
  latest.set(`${value.twinId}:${value.regime}`,{...value});
  const regimeRows=[...latest.values()].filter(row=>row.regime===value.regime&&row.healthy).sort((a,b)=>score(b)-score(a));
  if(regimeRows.length<2)return{...leader};
  const [best,second]=regimeRows;const bestScore=score(best),secondScore=score(second);const margin=bestScore-secondScore;
  const minMargin=Math.max(0.01,Number(process.env.CAIN_TWIN_LEADER_HYSTERESIS_MARGIN||0.15));const minConfidence=Math.max(0.1,Math.min(1,Number(process.env.CAIN_TWIN_LEADER_MIN_CONFIDENCE||0.6)));
  const confidence=Math.min(1,best.terminalSamples/Math.max(1,Number(process.env.CAIN_TWIN_MIN_TERMINAL_SAMPLES||30)));
  if(confidence>=minConfidence&&margin>=minMargin&&leader.leaderId!==best.twinId){
    const previous=leader.leaderId;leader={leaderId:best.twinId,followerId:second.twinId,changedAt:Date.now(),reason:`measured performance margin ${margin.toFixed(4)} exceeded hysteresis ${minMargin}`,confidence,executionAuthority:false};
    void persistChange(previous,best.twinId,leader.reason,leader.changedAt).catch(()=>undefined);
  }else if(leader.leaderId){leader={...leader,followerId:regimeRows.find(row=>row.twinId!==leader.leaderId)?.twinId||leader.followerId,confidence};}
  return{...leader};
}
export function getCainTwinLeaderState(){return{...leader,hotFollowerMaintained:Boolean(leader.followerId),sharedReadOnlyCachesAllowed:true,nonceInventorySettlementResourceAuthorityDuplicated:false as const};}
