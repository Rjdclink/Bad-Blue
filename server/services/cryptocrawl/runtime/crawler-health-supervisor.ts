import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { stageManager } from '../governance/stage-management.js';

export interface CrawlerHeartbeat {
  crawlerId:string; observedAt:number; queueLagMs:number; staleDataMs:number; sequenceGaps:number; errorRate:number;
  providerHealth:number; resourcePressure:number; modelVersion:string; configVersion:string; stateChecksum:string; provenance:string[];
}
export type CrawlerHealthAction='healthy'|'degraded'|'soft_quarantine'|'restart_recommended'|'governance_escalation';
interface CrawlerState { last:CrawlerHeartbeat; ewmaError:number; ewmaLag:number; samples:number; meanError:number; m2Error:number; quarantinedAt:number|null; restartAttempts:number; cooldownUntil:number; action:CrawlerHealthAction; }
const states=new Map<string,CrawlerState>();
const ALPHA=Math.max(0.01,Math.min(0.5,Number(process.env.CRAWLER_HEALTH_EWMA_ALPHA||0.2)));

function checksumValid(heartbeat:CrawlerHeartbeat):boolean {
  if (!heartbeat.modelVersion.trim()||!heartbeat.configVersion.trim()||!heartbeat.stateChecksum.trim()) return false;
  return /^[a-f0-9]{8,128}$/i.test(heartbeat.stateChecksum);
}
function zScore(state:CrawlerState,value:number):number {
  if(state.samples<3)return 0; const variance=state.m2Error/Math.max(1,state.samples-1); return variance>0?(value-state.meanError)/Math.sqrt(variance):0;
}
async function audit(heartbeat:CrawlerHeartbeat,action:CrawlerHealthAction,reason:string):Promise<void>{
  const eventId=`crawler-health:${createHash('sha256').update(`${heartbeat.crawlerId}:${heartbeat.observedAt}:${action}:${reason}`).digest('hex')}`;
  await pool.query(`insert into private.cryptara_anomaly_events(event_id,observed_at,anomaly_kind,severity,opportunity_id,model_version,config_version,provenance,source_event_ids,payload)
    values($1,$2,'crawler_health',$3,null,$4,$5,$6,$7,$8::jsonb) on conflict(event_id) do nothing`,[
    eventId,new Date(heartbeat.observedAt),action==='governance_escalation'?'critical':action==='restart_recommended'?'high':action==='soft_quarantine'?'medium':'info',heartbeat.modelVersion,heartbeat.configVersion,
    [...heartbeat.provenance,'canonical_health_supervisor'],[],JSON.stringify({crawlerId:heartbeat.crawlerId,action,reason,executionAuthority:false})]);
}

export function publishCrawlerHeartbeat(heartbeat:CrawlerHeartbeat):CrawlerHealthAction{
  if(!heartbeat.crawlerId.trim()||!Number.isFinite(heartbeat.observedAt)||heartbeat.observedAt<=0)throw new Error('Typed crawler heartbeat identity/time required');
  const previous=states.get(heartbeat.crawlerId);
  const state: CrawlerState=previous||{last:heartbeat,ewmaError:heartbeat.errorRate,ewmaLag:heartbeat.queueLagMs,samples:0,meanError:0,m2Error:0,quarantinedAt:null,restartAttempts:0,cooldownUntil:0,action:'healthy'};
  state.samples++; const delta=heartbeat.errorRate-state.meanError; state.meanError+=delta/state.samples; state.m2Error+=delta*(heartbeat.errorRate-state.meanError);
  state.ewmaError=previous?ALPHA*heartbeat.errorRate+(1-ALPHA)*state.ewmaError:heartbeat.errorRate;
  state.ewmaLag=previous?ALPHA*heartbeat.queueLagMs+(1-ALPHA)*state.ewmaLag:heartbeat.queueLagMs;
  const governance=stageManager.getState();
  let action:CrawlerHealthAction='healthy'; let reason='heartbeat healthy';
  const invalidState=!checksumValid(heartbeat);
  const anomalous=Math.abs(zScore(state,heartbeat.errorRate))>=3;
  const severe=invalidState||heartbeat.errorRate>=0.5||heartbeat.providerHealth<=0.1||heartbeat.resourcePressure>=0.98||heartbeat.sequenceGaps>=10;
  const degraded=severe||anomalous||state.ewmaError>=0.15||state.ewmaLag>=Number(process.env.CRAWLER_HEALTH_QUEUE_LAG_MS||5000)||heartbeat.staleDataMs>=Number(process.env.CRAWLER_HEALTH_STALE_MS||15000);
  if(governance.killSwitchActive){ action='governance_escalation'; reason='governance kill switch has precedence'; }
  else if(severe){ action='soft_quarantine'; reason=invalidState?'model/config/state checksum invalid':'severe measured crawler health degradation'; state.quarantinedAt??=Date.now(); }
  else if(degraded){ action='degraded'; reason='EWMA/z-score/queue/stale/provider/resource signal degraded'; }
  if(state.quarantinedAt && Date.now()-state.quarantinedAt>=Math.max(5000,Number(process.env.CRAWLER_HEALTH_RESTART_AFTER_MS||30000)) && Date.now()>=state.cooldownUntil){
    const maxRetries=Math.max(0,Number(process.env.CRAWLER_HEALTH_MAX_RESTART_RECOMMENDATIONS||3));
    if(state.restartAttempts<maxRetries){state.restartAttempts++;state.cooldownUntil=Date.now()+Math.max(10000,Number(process.env.CRAWLER_HEALTH_RESTART_COOLDOWN_MS||60000));action='restart_recommended';reason='bounded restart recommendation after soft quarantine';}
    else {action='governance_escalation';reason='restart recommendation budget exhausted';}
  }
  state.last={...heartbeat,provenance:[...heartbeat.provenance]};state.action=action;states.set(heartbeat.crawlerId,state);
  if(action!=='healthy')void audit(heartbeat,action,reason).catch(error=>logger.warn('[CrawlerHealth] audit persistence degraded',{error:error instanceof Error?error.message:String(error),executionBlocked:false}));
  return action;
}

export function getCrawlerHealthSupervisorSnapshot(){
  const now=Date.now(); const watchdogMs=Math.max(1000,Number(process.env.CRAWLER_HEALTH_WATCHDOG_MS||10000));
  return [...states.entries()].map(([crawlerId,state])=>({crawlerId,action:now-state.last.observedAt>watchdogMs?'soft_quarantine' as const:state.action,lastObservedAt:state.last.observedAt,watchdogExpired:now-state.last.observedAt>watchdogMs,ewmaError:state.ewmaError,ewmaQueueLagMs:state.ewmaLag,restartAttempts:state.restartAttempts,cooldownUntil:state.cooldownUntil}));
}
export const CRAWLER_HEALTH_SUPERVISOR_AUTHORITY='health_actions_only' as const;
export const CRAWLERS_MAY_SELF_TERMINATE_EXECUTION_AUTHORITY=false as const;
