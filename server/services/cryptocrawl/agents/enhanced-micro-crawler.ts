// LEGACY COMPATIBILITY FACADE — no execution authority.
import { randomUUID } from 'crypto';
import type { MicroCrawlerState, ChainId } from '../eden/types';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';

export type CrawlerMode = 'micro' | 'prewarm' | 'full';
export type CrawlerStatus = 'idle' | 'scanning' | 'executing' | 'shrinking' | 'growing';

export class EnhancedMicroCrawler {
  id:string;parentCainId:string;mode:CrawlerMode;priority=0;target?:string;chain?:ChainId;status:CrawlerStatus='idle';lastActivity:number;profitGenerated=0;
  constructor(parentCainId:string,mode:CrawlerMode='micro'){this.id=`legacy-micro-${randomUUID().split('-')[0]}`;this.parentCainId=parentCainId;this.mode=mode;this.lastActivity=Date.now();}

  async crawl():Promise<void>{
    this.lastActivity=Date.now();this.status='scanning';this.profitGenerated=0;
    if(this.mode==='prewarm'){
      // Non-mutating preparation only: warm structured universe/provider caches.
      await marketDataProviders.discoverUniverse().catch(()=>[]);this.priority=0;this.status='idle';return;
    }
    const candidates=measuredCandidateRegistry.getRecent(64);
    const visible=this.mode==='full'
      ? candidates.filter(candidate=>candidate.status==='deterministic_positive'||candidate.status==='eligible')
      : candidates.filter(candidate=>candidate.status==='observed'||candidate.status==='enriched');
    const best=visible.sort((a,b)=>(b.economics.deterministicNetProfitUsd??0)-(a.economics.deterministicNetProfitUsd??0)||b.updatedAt-a.updatedAt)[0];
    this.target=best?.opportunityId;this.priority=best?.status==='eligible'?100:best?.status==='deterministic_positive'?75:best?25:0;
    const supported=(best?.chains[0]||'') as ChainId;this.chain=['polygon','avalanche','bsc','arbitrum','optimism','ethereum'].includes(supported)?supported:undefined;
    // Full mode evaluates canonical measured evidence only. Real execution remains
    // solely with the canonical scheduler/resource/executor/settlement path.
    this.status='idle';this.profitGenerated=0;
  }
  getState():MicroCrawlerState{return{id:this.id,parentCainId:this.parentCainId,mode:this.mode,priority:this.priority,target:this.target,chain:this.chain,status:this.status,lastActivity:this.lastActivity,profitGenerated:0};}
}

export const ENHANCED_MICRO_EXECUTION_AUTHORITY=false as const;
export const ENHANCED_MICRO_PREWARM_MUTATING=false as const;
