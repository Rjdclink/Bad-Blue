import {
  PANTHEON_VERIFIED_SOURCE_INVENTORY,
  type PantheonBackgroundCategory,
  type PantheonSourceTarget,
} from '../pantheon/PantheonSovereignSourceRegistry';

export type SpectraSourcePriority = 'critical' | 'high' | 'supporting';
export interface SpectraSourceTarget extends PantheonSourceTarget {
  sourceId: string; sourceName: string; priority: SpectraSourcePriority; reason: string;
}
const CRITICAL=new Set<string>(['identity','identity-resolution','residence','contacts','relatives','associates','geography','chronology','corroboration','contradictions','historical','provenance']);
const HIGH=new Set<string>(['social','usernames','internet','news','employment','education','credentials','business','corporate','property','transportation','civil-litigation','criminal','arrests','corrections','probation-parole','warrants','courts','family-probate','vital-records','government-employment','military','campaign-finance','professional-discipline','regulatory','organizations','nonprofits','publications','professional-web','domain-web','adverse-media','relationship-graph','false-positive']);
function rank(categories:readonly string[]):SpectraSourcePriority { if(categories.some(x=>CRITICAL.has(x))) return 'critical'; if(categories.some(x=>HIGH.has(x))) return 'high'; return 'supporting'; }
function authorityScore(a:string){return a==='primary'?3:a==='secondary'?2:1;}

export const SPECTRA_SOURCE_CATALOG=PANTHEON_VERIFIED_SOURCE_INVENTORY.map(source=>({...source,priority:rank(source.categories)}));
export const SPECTRA_SOURCE_CATALOG_BY_ID=new Map(SPECTRA_SOURCE_CATALOG.map(source=>[source.id,source] as const));

export function getSpectraSources(categories:readonly PantheonBackgroundCategory[]=[],jurisdiction?:string){
 const wanted=new Set<string>(categories);
 return SPECTRA_SOURCE_CATALOG
  .filter(source=>!wanted.size||source.categories.some(category=>wanted.has(category)))
  .filter(source=>!jurisdiction||source.jurisdiction===jurisdiction||source.jurisdiction==='US')
  .sort((a,b)=>{const p={critical:3,high:2,supporting:1};return p[b.priority]-p[a.priority]||authorityScore(b.authority)-authorityScore(a.authority);});
}

export function buildSpectraPriorityTargets(subject:string,clues?:string,limit=SPECTRA_SOURCE_CATALOG.length):SpectraSourceTarget[]{
 const identity=[subject.trim(),String(clues||'').trim()].filter(Boolean).map(v=>`"${v}"`).join(' '); if(!identity)return[];
 const seen=new Set<string>(),targets:SpectraSourceTarget[]=[];
 for(const source of getSpectraSources()){
  const key=source.url.toLowerCase(); if(seen.has(key))continue; seen.add(key);
  const category=(source.categories[0]||'identity') as PantheonBackgroundCategory;
  let host=''; try { host=new URL(source.url).hostname; } catch { host=''; }
  const sourceScopedQuery=[host?`site:${host}`:'',identity,source.categories.join(' ')].filter(Boolean).join(' ');
  targets.push({sourceId:source.id,sourceName:source.name,category,url:source.url,authority:source.authority,jurisdiction:source.jurisdiction,query:sourceScopedQuery,priority:source.priority,reason:source.priority==='critical'?'direct identity/location/corroboration evidence':source.priority==='high'?'recursive records, social, web, or contextual pivot':'supporting corroboration and completeness source'});
  if(targets.length>=Math.max(1,limit))break;
 }
 return targets;
}
export function buildSpectraDiscoveryWaves(subject:string,clues?:string){
 const targets=buildSpectraPriorityTargets(subject,clues);
 return (['critical','high','supporting'] as SpectraSourcePriority[]).map(priority=>({priority,targets:targets.filter(target=>target.priority===priority)})).filter(w=>w.targets.length>0);
}
