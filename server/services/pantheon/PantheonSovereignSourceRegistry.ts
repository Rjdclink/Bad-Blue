import { admitPantheonUrl } from '../crawlers/PublicAcquisitionInfrastructure';
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
  accessMode?: 'public'|'contact-registration';
  accessReason?: string;
}

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

const KEYLESS_CATEGORY_SOURCES: Partial<Record<PantheonBackgroundCategory, readonly {
  url: string;
  name: string;
  authority: 'primary'|'secondary';
  jurisdiction: string;
}[]>> = {
  'domain-web': [
    { url: 'https://lookup.icann.org/en', name: 'ICANN Registration Data Lookup', authority: 'primary', jurisdiction: 'global' },
    { url: 'https://data.iana.org/rdap/dns.json', name: 'IANA RDAP DNS Bootstrap Registry', authority: 'primary', jurisdiction: 'global' },
  ],
  'breach-notices': [
    { url: 'https://haveibeenpwned.com/PwnedWebsites', name: 'Have I Been Pwned Public Breach Directory', authority: 'secondary', jurisdiction: 'global' },
    { url: 'https://www.cisa.gov/news-events/cybersecurity-advisories', name: 'CISA Cybersecurity Advisories', authority: 'primary', jurisdiction: 'US' },
  ],
  'relationship-graph': [
    { url: 'https://www.wikidata.org/', name: 'Wikidata Public Knowledge Graph', authority: 'secondary', jurisdiction: 'global' },
    { url: 'https://query.wikidata.org/', name: 'Wikidata Public Query Service', authority: 'secondary', jurisdiction: 'global' },
  ],
};

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
 // Pair each category-verified authority with its direct public entry point,
 // same-origin sitemap, subject-specific site search, and public archive index.
 // The direct entry point is intentionally
 // not credited as person evidence by itself; it gives the appropriately
 // routed crawler a policy-compliant source page from which it can discover
 // lawful public search/result routes. Discovery remains a fallback, never
 // the sole source plan.
 const inventory=(KEYLESS_CATEGORY_SOURCES[category] || []).map((source,index)=>({
   id:`keyless-${category}-${index+1}`,
   sourceIds:[`keyless-${category}-${index+1}`],
   names:[source.name],
   url:source.url,
   originalUrls:[source.url],
   jurisdiction:source.jurisdiction,
   jurisdictions:[source.jurisdiction],
   categories:[category],
   authority:source.authority,
   verifiedAt:'2026-09-22',
   accessMode:'public' as const,
   accessReason:'Public source requiring neither an API key nor registration.',
 }));
 for (const source of inventory) {
   if (!source.categories.includes(category)) continue;
   const q=`${identity} ${category}`;
   const parsedSource=new URL(source.url);
   const host=parsedSource.hostname;
   const sourceRoot=`${parsedSource.protocol}//${parsedSource.host}`;
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
     url:`${sourceRoot}/robots.txt`,
     authority:source.authority,
     jurisdiction:source.jurisdiction,
     query:q,
     transport:'direct-http',
     sourceKind:'sitemap',
     subjectScoped:false,
     sourceIds:[...source.sourceIds],
     originalUrls:[...source.originalUrls],
     accessMode:source.accessMode,
     accessReason:source.accessReason,
   });
   if(out.length>=limit) return out.slice(0,limit);
   add({
     category,
     url:`${sourceRoot}/sitemap.xml`,
     authority:source.authority,
     jurisdiction:source.jurisdiction,
     query:q,
     transport:'direct-http',
     sourceKind:'sitemap',
     subjectScoped:false,
     sourceIds:[...source.sourceIds],
     originalUrls:[...source.originalUrls],
     accessMode:source.accessMode,
     accessReason:source.accessReason,
   });
   if(out.length>=limit) return out.slice(0,limit);
   for (const facet of ['', 'record', 'registry', 'filing', 'archive']) {
     const scopedQuery=[`site:${host}`,q,facet].filter(Boolean).join(' ');
     add({
       category,
       url:searchUrl('https://html.duckduckgo.com/html/?q=',scopedQuery),
       authority:'discovery',
       jurisdiction:source.jurisdiction,
       query:scopedQuery,
       transport:'search-provider',
       subjectScoped:true,
       sourceIds:[...source.sourceIds],
       originalUrls:[...source.originalUrls],
       accessMode:source.accessMode,
       accessReason:source.accessReason,
     });
     if(out.length>=limit) return out.slice(0,limit);
   }
   add({
     category,
     url:`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`${host}/*`)}&output=json&filter=statuscode%3A200&filter=mimetype%3Atext%2Fhtml&collapse=urlkey&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype&limit=100`,
     authority:'archive',
     jurisdiction:source.jurisdiction,
     query:q,
     transport:'archive',
     sourceKind:'archive',
     subjectScoped:false,
     sourceIds:[...source.sourceIds],
     originalUrls:[...source.originalUrls],
     accessMode:source.accessMode,
     accessReason:source.accessReason,
   });
   if(out.length>=limit) return out.slice(0,limit);
 }
 return out.slice(0,limit);
}


export interface PantheonSourcePreflightIssue {
  originalUrl: string;
  reason: string;
  replacementUrl?: string;
  disposition?: 'replaced'|'excluded';
  accessRequirement?: 'public'|'contact-registration'|'excluded-invalid';
  sourceIds?: string[];
}

export function preflightPantheonSourceTargets(
  targets: readonly PantheonSourceTarget[],
  category: PantheonBackgroundCategory,
  subject: string,
  location?: string,
): { targets: PantheonSourceTarget[]; issues: PantheonSourcePreflightIssue[] } {
  const accepted: PantheonSourceTarget[] = [];
  const issues: PantheonSourcePreflightIssue[] = [];
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

export function buildPantheonBackgroundRegistryTargets(subject:string, location?:string, perCategory=10) {
 return PANTHEON_BACKGROUND_CATEGORIES.flatMap(category=>buildPantheonCategoryTargets(category,subject,location,perCategory));
}
