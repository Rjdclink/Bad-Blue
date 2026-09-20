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

export interface PantheonSourceTarget {
  category: PantheonBackgroundCategory;
  url: string;
  authority: 'primary'|'secondary'|'discovery'|'archive';
  jurisdiction: string;
  query: string;
}

const AUTHORITIES = [
  ['https://www.usa.gov/','primary'],['https://www.uscourts.gov/','primary'],
  ['https://pacer.uscourts.gov/','primary'],['https://www.supremecourt.gov/','primary'],
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
 'https://www.google.com/search?q=','https://www.bing.com/search?q=',
 'https://search.brave.com/search?q=','https://www.google.com/search?q=site%3A.gov+',
 'https://www.google.com/search?q=site%3A.us+','https://www.google.com/search?q=site%3Acourts.',
] as const;

const facets = [
 'official record','historical record','current record','archive','filing','register','registry','database',
 'court','county','state','federal','municipal','license','discipline','enforcement','property','business',
 'professional','employment','education','address','contact','associate','news','document','report','index',
 'directory','docket','assessment','deed','lien','judgment','disclosure','ownership','officer','biography',
 'publication','sanction','procurement','contract','grant','corrections','inmate','warrant','case','appeal',
] as const;

function searchUrl(prefix:string, query:string) { return prefix + encodeURIComponent(query); }

/** At least 300 deterministic retrieval URLs per category, generated on demand. */
export function buildPantheonCategoryTargets(
 category: PantheonBackgroundCategory,
 subject: string,
 location?: string,
 limit = 300,
): PantheonSourceTarget[] {
 const identity = [subject.trim(), String(location||'').trim()].filter(Boolean).map(v=>`"${v}"`).join(' ');
 if (!identity) return [];
 const out:PantheonSourceTarget[]=[]; const seen=new Set<string>();
 const add=(x:PantheonSourceTarget)=>{ if(!seen.has(x.url)){seen.add(x.url);out.push(x);} };
 // Verified direct authorities are always attempted before generated discovery URLs.
 for (const source of [...PANTHEON_VERIFIED_SOURCES_BATCH_01, ...PANTHEON_VERIFIED_SOURCES_BATCH_02, ...PANTHEON_VERIFIED_SOURCES_BATCH_03, ...PANTHEON_VERIFIED_SOURCES_BATCH_04, ...PANTHEON_VERIFIED_SOURCES_BATCH_05, ...PANTHEON_VERIFIED_SOURCES_BATCH_06, ...PANTHEON_VERIFIED_SOURCES_BATCH_07, ...PANTHEON_VERIFIED_SOURCES_BATCH_08, ...PANTHEON_VERIFIED_SOURCES_BATCH_09, ...PANTHEON_VERIFIED_SOURCES_BATCH_10, ...PANTHEON_VERIFIED_SOURCES_BATCH_11, ...PANTHEON_VERIFIED_SOURCES_BATCH_12, ...PANTHEON_VERIFIED_SOURCES_BATCH_13, ...PANTHEON_VERIFIED_SOURCES_BATCH_14, ...PANTHEON_VERIFIED_SOURCES_BATCH_15, ...PANTHEON_VERIFIED_SOURCES_BATCH_16, ...PANTHEON_VERIFIED_SOURCES_BATCH_17, ...PANTHEON_VERIFIED_SOURCES_BATCH_18, ...PANTHEON_VERIFIED_SOURCES_BATCH_19, ...PANTHEON_VERIFIED_SOURCES_BATCH_20]) {
   if (!source.categories.includes(category)) continue;
   const q=`${identity} ${category}`;
   add({category,url:source.url,authority:source.authority,jurisdiction:source.jurisdiction,query:q});
   if(out.length>=limit) return out.slice(0,limit);
 }
 for(const [root,authority] of AUTHORITIES){
   const q=`${identity} ${category}`;
   add({category,url:searchUrl('https://www.google.com/search?q=',`site:${new URL(root).hostname} ${q}`),authority:'discovery',jurisdiction:'US',query:q});
 }
 for(const facet of facets){
   for(const host of DISCOVERY_HOSTS){
     const q=`${identity} ${category} ${facet}`;
     add({category,url:searchUrl(host,q),authority:'discovery',jurisdiction:location||'US',query:q});
     if(out.length>=limit) return out.slice(0,limit);
   }
 }
 return out.slice(0,limit);
}

export function buildPantheonBackgroundRegistryTargets(subject:string, location?:string, perCategory=300) {
 return PANTHEON_BACKGROUND_CATEGORIES.flatMap(category=>buildPantheonCategoryTargets(category,subject,location,perCategory));
}
