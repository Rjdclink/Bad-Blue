import { admitPantheonUrl } from '../crawlers/PublicAcquisitionInfrastructure';
import { PANTHEON_VERIFIED_SOURCES_BATCH_01 } from './sources/batch01';
import { PANTHEON_VERIFIED_SOURCES_BATCH_02 } from './sources/batch02';
import { PANTHEON_VERIFIED_SOURCES_BATCH_03 } from './sources/batch03';
import { PANTHEON_VERIFIED_SOURCES_BATCH_04 } from './sources/batch04';
import { PANTHEON_VERIFIED_SOURCES_BATCH_05 } from './sources/batch05';
import { PANTHEON_VERIFIED_SOURCES_BATCH_06 } from './sources/batch06';
import { PANTHEON_VERIFIED_SOURCES_BATCH_07 } from './sources/batch07';
import { PANTHEON_VERIFIED_SOURCES_BATCH_08 } from './sources/batch08';
import { PANTHEON_VERIFIED_SOURCES_BATCH_09 } from './sources/batch09';
import { PANTHEON_VERIFIED_SOURCES_BATCH_10 } from './sources/batch10';
import { PANTHEON_VERIFIED_SOURCES_BATCH_11 } from './sources/batch11';
import { PANTHEON_VERIFIED_SOURCES_BATCH_12 } from './sources/batch12';
import { PANTHEON_VERIFIED_SOURCES_BATCH_13 } from './sources/batch13';
import { PANTHEON_VERIFIED_SOURCES_BATCH_14 } from './sources/batch14';
import { PANTHEON_VERIFIED_SOURCES_BATCH_15 } from './sources/batch15';
import { PANTHEON_VERIFIED_SOURCES_BATCH_16 } from './sources/batch16';
import { PANTHEON_VERIFIED_SOURCES_BATCH_17 } from './sources/batch17';
import { PANTHEON_VERIFIED_SOURCES_BATCH_18 } from './sources/batch18';
import { PANTHEON_VERIFIED_SOURCES_BATCH_19 } from './sources/batch19';
import { PANTHEON_VERIFIED_SOURCES_BATCH_20 } from './sources/batch20';
import { PANTHEON_VERIFIED_SOURCES_BATCH_21 } from './sources/batch21';
import { PANTHEON_VERIFIED_SOURCES_BATCH_22 } from './sources/batch22';
import { PANTHEON_VERIFIED_SOURCES_BATCH_23 } from './sources/batch23';
import {
  compilePantheonSourceRegistry,
  pantheonSourceExclusionsForCategory,
  type PantheonSourceAccessMode,
} from './PantheonSourceRegistryCompiler';
/**
 * PANTHEON sovereign source registry.
 *
 * A retrieval-target registry, not a claim that every upstream record exists.
 * Direct authorities are preferred; discovery targets broaden coverage when the
 * subject's jurisdiction is not known yet.  Targets never contain credentials.
 */
export const PANTHEON_BACKGROUND_CATEGORIES = [
  'identity','residence','contacts','relatives','associates','social','usernames','internet',
  'news','employment','education','credentials','business','corporate','property','transportation',
  'financial-public','banking-affiliations','securities','bankruptcy','civil-litigation','criminal',
  'arrests','corrections','probation-parole','warrants','sex-offender','courts','family-probate',
  'vital-records','estate','tax-public','government-employment','military','government-contracting',
  'campaign-finance','lobbying','professional-discipline','regulatory','sanctions','foreign-connections',
  'foreign-residence','immigration','organizations','nonprofits','intellectual-property','publications',
  'professional-web','domain-web','breach-notices','adverse-media','chronology','relationship-graph',
  'geography','corroboration','identity-resolution','contradictions','historical','provenance',
  'confidence','false-positive','completeness','crawler-audit','source-audit','final-dossier',
] as const;
export type PantheonBackgroundCategory = typeof PANTHEON_BACKGROUND_CATEGORIES[number];

export type PantheonTransport = 'direct-http'|'browser'|'search-provider'|'specialized-adapter'|'archive';

export interface PantheonSourceTarget {
  category: PantheonBackgroundCategory;
  url: string;
  authority: 'primary'|'secondary'|'discovery'|'archive';
  jurisdiction: string;
  query: string;
  transport: PantheonTransport;
  sourceKind?: 'api'|'bulk-dataset'|'sitemap'|'rss'|'public-page'|'search'|'archive';
  freshnessWeight?: number;
  expectedValue?: number;
  /** Whether this exact target contains the submitted subject query. */
  subjectScoped?: boolean;
  sourceIds?: string[];
  originalUrls?: string[];
  accessMode?: Extract<PantheonSourceAccessMode, 'public'|'contact-registration'>;
  accessReason?: string;
}

export const PANTHEON_VERIFIED_SOURCE_INVENTORY = [
  ...PANTHEON_VERIFIED_SOURCES_BATCH_01, ...PANTHEON_VERIFIED_SOURCES_BATCH_02,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_03, ...PANTHEON_VERIFIED_SOURCES_BATCH_04,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_05, ...PANTHEON_VERIFIED_SOURCES_BATCH_06,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_07, ...PANTHEON_VERIFIED_SOURCES_BATCH_08,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_09, ...PANTHEON_VERIFIED_SOURCES_BATCH_10,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_11, ...PANTHEON_VERIFIED_SOURCES_BATCH_12,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_13, ...PANTHEON_VERIFIED_SOURCES_BATCH_14,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_15, ...PANTHEON_VERIFIED_SOURCES_BATCH_16,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_17, ...PANTHEON_VERIFIED_SOURCES_BATCH_18,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_19, ...PANTHEON_VERIFIED_SOURCES_BATCH_20,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_21, ...PANTHEON_VERIFIED_SOURCES_BATCH_22,
  ...PANTHEON_VERIFIED_SOURCES_BATCH_23,
] as const;

export const PANTHEON_COMPILED_SOURCE_REGISTRY = compilePantheonSourceRegistry(
  PANTHEON_VERIFIED_SOURCE_INVENTORY,
);
export const PANTHEON_EXECUTABLE_SOURCE_INVENTORY = PANTHEON_COMPILED_SOURCE_REGISTRY.executable;
export const PANTHEON_SOURCE_EXCLUSION_LEDGER = PANTHEON_COMPILED_SOURCE_REGISTRY.exclusions;
export const PANTHEON_SOURCE_REGISTRY_DIAGNOSTICS = PANTHEON_COMPILED_SOURCE_REGISTRY.diagnostics;

const AUTHORITIES = [
  ['https://www.usa.gov/','primary'],['https://www.uscourts.gov/','primary'],
  ['https://www.supremecourt.gov/','primary'],
  ['https://www.justice.gov/','primary'],['https://www.fbi.gov/','primary'],
  ['https://www.bop.gov/','primary'],['https://www.usmarshals.gov/','primary'],
  ['https://www.nsopw.gov/','primary'],['https://www.archives.gov/','primary'],
  ['https://catalog.archives.gov/','primary'],['https://www.govinfo.gov/','primary'],
  ['https://www.congress.gov/','primary'],['https://www.fec.gov/','primary'],
  ['https://www.sec.gov/search-filings','primary'],['https://adviserinfo.sec.gov/','primary'],
  ['https://brokercheck.finra.org/','primary'],['https://www.nmlsconsumeraccess.org/','primary'],
  ['https://www.fdic.gov/','primary'],['https://www.occ.gov/','primary'],
  ['https://www.federalreserve.gov/','primary'],['https://ncua.gov/','primary'],
  ['https://www.cftc.gov/','primary'],['https://www.nfa.futures.org/basicnet/','primary'],
  ['https://www.ftc.gov/','primary'],['https://www.consumerfinance.gov/','primary'],
  ['https://www.usaspending.gov/','primary'],['https://sam.gov/','primary'],
  ['https://www.uspto.gov/','primary'],['https://www.copyright.gov/','primary'],
  ['https://www.dol.gov/','primary'],['https://www.osha.gov/','primary'],
  ['https://www.nlrb.gov/','primary'],['https://www.eeoc.gov/','primary'],
  ['https://data.cms.gov/','primary'],['https://npiregistry.cms.hhs.gov/','primary'],
  ['https://openpaymentsdata.cms.gov/','primary'],['https://www.fda.gov/','primary'],
  ['https://www.fmcsa.dot.gov/','primary'],['https://safer.fmcsa.dot.gov/','primary'],
  ['https://www.faa.gov/','primary'],['https://www.epa.gov/','primary'],
  ['https://echo.epa.gov/','primary'],['https://ofac.treasury.gov/','primary'],
  ['https://sanctionssearch.ofac.treas.gov/','primary'],['https://www.bis.gov/','primary'],
  ['https://www.interpol.int/','primary'],['https://www.irs.gov/charities-non-profits','primary'],
  ['https://www.loc.gov/','primary'],['https://chroniclingamerica.loc.gov/','archive'],
  ['https://www.courtlistener.com/','secondary'],['https://archive.org/','archive'],
  ['https://web.archive.org/','archive'],['https://index.commoncrawl.org/','archive'],
] as const;

const DISCOVERY_HOSTS = [
 'https://www.bing.com/search?q=',
 'https://html.duckduckgo.com/html/?q=',
] as const;

const facets = [
 'official record','historical record','current record','archive','filing','register','registry','database',
 'court','county','state','federal','municipal','license','discipline','enforcement','property','business',
 'professional','employment','education','address','contact','associate','news','document','report','index',
 'directory','docket','assessment','deed','lien','judgment','disclosure','ownership','officer','biography',
 'publication','sanction','procurement','contract','grant','corrections','inmate','warrant','case','appeal',
] as const;

function transportForSource(url: string, authority: PantheonSourceTarget['authority']): PantheonTransport {
 const value=url.toLowerCase();
 if(authority==='discovery'||/google\.com\/search|bing\.com\/search|search\.brave\.com|duckduckgo\.com\/html/.test(value)) return 'search-provider';
 if(authority==='archive'||/archive\.org|commoncrawl/.test(value)) return 'archive';
 if(/pacer\.uscourts\.gov|brokercheck\.finra\.org|nmlsconsumeraccess/.test(value)) return 'browser';
 if(/data\.|api\.|\/api\/|\.json(?:$|\?)/.test(value)) return 'specialized-adapter';
 return 'direct-http';
}

function sourceKindFor(url: string, authority: PantheonSourceTarget['authority']): NonNullable<PantheonSourceTarget['sourceKind']> {
 const value=url.toLowerCase();
 if(authority==='discovery'||/google\.com\/search|bing\.com\/search|search\.brave\.com|duckduckgo\.com\/html/.test(value)) return 'search';
 if(authority==='archive'||/archive\.org|arquivo\.pt|mementoweb/.test(value)) return 'archive';
 if(/(?:^|\/)sitemap(?:[_-]|\.|\/)|sitemap\.xml/.test(value)) return 'sitemap';
 if(/(?:rss|atom|feed)(?:\.|\/|$)/.test(value)) return 'rss';
 if(/(?:bulk|download|dataset|data\.)/.test(value)) return 'bulk-dataset';
 if(/api\.|\/api\/|\.json(?:$|\?)/.test(value)) return 'api';
 return 'public-page';
}

function sourceWeights(kind: NonNullable<PantheonSourceTarget['sourceKind']>, authority: PantheonSourceTarget['authority']) {
 const kindValue=({api:95,'bulk-dataset':92,sitemap:88,rss:84,'public-page':78,search:70,archive:62})[kind];
 const authorityValue=({primary:100,secondary:82,discovery:68,archive:60})[authority];
 return { freshnessWeight: kind==='rss'||kind==='api'?95:kind==='archive'?45:75, expectedValue: Math.round((kindValue+authorityValue)/2) };
}

function searchUrl(prefix:string, query:string) { return prefix + encodeURIComponent(query); }

/**
 * Deterministic, policy-admitted targets for a category.  A registry source is
 * always scheduled directly before any third-party discovery query that refers
 * to it.  This keeps the public-source registry usable when a search provider
 * is unavailable or disallows automated retrieval, and preserves the source
 * provenance needed by the category frontier.
 */
export function buildPantheonCategoryTargets(
 category: PantheonBackgroundCategory,
 subject: string,
 location?: string,
 limit = 300,
): PantheonSourceTarget[] {
 const identity = [subject.trim(), String(location||'').trim()].filter(Boolean).map(v=>`"${v}"`).join(' ');
 if (!identity) return [];
 const out:PantheonSourceTarget[]=[]; const seen=new Set<string>();
 const add=(x:Omit<PantheonSourceTarget,'transport'|'subjectScoped'|'sourceKind'|'freshnessWeight'|'expectedValue'> & {transport?:PantheonTransport;subjectScoped?:boolean;sourceKind?:PantheonSourceTarget['sourceKind'];freshnessWeight?:number;expectedValue?:number})=>{ if(!seen.has(x.url)){const sourceKind=x.sourceKind||sourceKindFor(x.url,x.authority);const weights=sourceWeights(sourceKind,x.authority);seen.add(x.url);out.push({...x,transport:x.transport||transportForSource(x.url,x.authority),sourceKind,freshnessWeight:x.freshnessWeight??weights.freshnessWeight,expectedValue:x.expectedValue??weights.expectedValue,subjectScoped:x.subjectScoped===true});} };
 // Pair each verified authority with its direct public entry point and a
 // subject-specific discovery task. The direct entry point is intentionally
 // not credited as person evidence by itself; it gives the appropriately
 // routed crawler a policy-compliant source page from which it can discover
 // lawful public search/result routes. Discovery remains a fallback, never
 // the sole source plan.
 const normalizedLocation=String(location||'').toUpperCase();
 const inventory=PANTHEON_EXECUTABLE_SOURCE_INVENTORY
   .filter(source=>source.categories.includes(category))
   .sort((left,right)=>{
     const score=(jurisdiction:string)=>normalizedLocation.includes(jurisdiction.replace(/^US-/,''))?3:/^(?:US|FEDERAL|NATIONAL)$/i.test(jurisdiction)?2:1;
     return score(right.jurisdiction)-score(left.jurisdiction);
   });
 for (const source of inventory) {
   if (!source.categories.includes(category)) continue;
   const q=`${identity} ${category}`;
   const host=new URL(source.url).hostname;
   add({
     category,
     url:source.url,
     authority:source.authority,
     jurisdiction:source.jurisdiction,
     query:q,
     subjectScoped:false,
     sourceIds:[...source.sourceIds],
     originalUrls:[...source.originalUrls],
     accessMode:source.accessMode,
     accessReason:source.accessReason,
   });
   if(out.length>=limit) return out.slice(0,limit);
   add({
     category,
     url:searchUrl('https://www.bing.com/search?q=',`site:${host} ${q}`),
     authority:'discovery',
     jurisdiction:source.jurisdiction,
     query:q,
     transport:'search-provider',
     subjectScoped:true,
     sourceIds:[...source.sourceIds],
     originalUrls:[...source.originalUrls],
     accessMode:source.accessMode,
     accessReason:source.accessReason,
   });
   if(out.length>=limit) return out.slice(0,limit);
 }
 for(const [root,authority] of AUTHORITIES){
   const q=`${identity} ${category}`;
   add({category,url:searchUrl('https://html.duckduckgo.com/html/?q=',`site:${new URL(root).hostname} ${q}`),authority:'discovery',jurisdiction:'US',query:q,subjectScoped:true});
 }
 for(const facet of facets){
   for(const host of DISCOVERY_HOSTS){
     const q=`${identity} ${category} ${facet}`;
     add({category,url:searchUrl(host,q),authority:'discovery',jurisdiction:location||'US',query:q,subjectScoped:true});
     if(out.length>=limit) return out.slice(0,limit);
   }
 }
 return out.slice(0,limit);
}


export interface PantheonSourcePreflightIssue {
  originalUrl: string;
  reason: string;
  replacementUrl?: string;
  disposition?: 'replaced'|'excluded';
  accessRequirement?: PantheonSourceAccessMode;
  sourceIds?: string[];
}

export function preflightPantheonSourceTargets(
  targets: readonly PantheonSourceTarget[],
  category: PantheonBackgroundCategory,
  subject: string,
  location?: string,
): { targets: PantheonSourceTarget[]; issues: PantheonSourcePreflightIssue[] } {
  const accepted: PantheonSourceTarget[] = [];
  const issues: PantheonSourcePreflightIssue[] = pantheonSourceExclusionsForCategory(
    PANTHEON_SOURCE_EXCLUSION_LEDGER,
    category,
  ).map(exclusion => ({
    originalUrl: exclusion.originalUrls[0] || exclusion.canonicalUrl || 'unknown',
    reason: exclusion.reason,
    disposition: 'excluded' as const,
    accessRequirement: exclusion.accessMode,
    sourceIds: [...exclusion.sourceIds],
  }));
  const seen = new Set<string>();
  for (const target of targets) {
    const admission = admitPantheonUrl(target.url);
    if (admission.ok) {
      if (!seen.has(admission.url)) {
        seen.add(admission.url);
        accepted.push({ ...target, url: admission.url });
      }
      continue;
    }

    issues.push({
      originalUrl: target.url,
      reason: admission.reason,
      disposition: 'excluded',
      accessRequirement: 'excluded-invalid',
      sourceIds: target.sourceIds ? [...target.sourceIds] : undefined,
    });
  }
  return { targets: accepted, issues };
}

export function buildPantheonBackgroundRegistryTargets(subject:string, location?:string, perCategory=300) {
 return PANTHEON_BACKGROUND_CATEGORIES.flatMap(category=>buildPantheonCategoryTargets(category,subject,location,perCategory));
}
