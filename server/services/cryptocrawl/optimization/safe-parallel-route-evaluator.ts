import { quantiComp } from '../../quantiComp/index.js';

export interface NonMutatingRouteEvaluation<T> {
  routeId:string;deadlineAt:number;provenance:string[];evaluate:()=>Promise<T>;verify:(result:T)=>boolean;expectedNetUsd:(result:T)=>number;
}
export interface VerifiedParallelRoute<T>{routeId:string;result:T;expectedNetUsd:number;provenance:string[];verified:true;executionAuthority:false;}

export async function evaluateRoutesInParallel<T>(routes:NonMutatingRouteEvaluation<T>[]):Promise<VerifiedParallelRoute<T>|null>{
  const bounded=routes.slice(0,Math.max(1,Math.min(32,Number(process.env.STARBURST_SAFE_PARALLEL_ROUTES||8))));
  const tasks=bounded.map(route=>quantiComp.submit({id:`route-eval:${route.routeId}:${route.deadlineAt}`,kind:'safe_parallel_route_evaluation',lane:'warm',priority:10,createdAt:Date.now(),input:route,features:{nonMutating:1,routeEvaluation:1},resourceHints:{cpuWeight:0.2,memoryMB:8,ioWeight:1,parallelismHint:1},policy:{timeoutMs:Math.max(1,route.deadlineAt-Date.now()),deadlineAt:route.deadlineAt,deterministic:false,sideEffectFree:true,backendEligible:false,allowDeduplication:true,dedupeKey:`route:${route.routeId}:${route.deadlineAt}`,usefulWorkUnits:1,strictValidation:true},execute:input=>input.evaluate(),validate:(result,input)=>input.verify(result)}));
  const settled=await Promise.allSettled(tasks);const verified:VerifiedParallelRoute<T>[]=[];
  for(let index=0;index<settled.length;index++){const row=settled[index];if(row.status!=='fulfilled')continue;const route=bounded[index];const net=route.expectedNetUsd(row.value.result);if(!Number.isFinite(net)||net<=0)continue;verified.push({routeId:route.routeId,result:row.value.result,expectedNetUsd:net,provenance:[...route.provenance,'quanti_parallel_non_mutating','verified_expected_net'],verified:true,executionAuthority:false});}
  return verified.sort((a,b)=>b.expectedNetUsd-a.expectedNetUsd)[0]||null;
}

export const STARBURST_SAFE_PARALLEL_RULES=Object.freeze({nonMutatingEvaluationOnly:true,simulatedSleepIsExecutionProof:false,multipleLiveAttemptsByDefault:false,executionDelegatesToCanonicalScheduler:true,nonceInventorySettlementAuthorityDuplicated:false});
