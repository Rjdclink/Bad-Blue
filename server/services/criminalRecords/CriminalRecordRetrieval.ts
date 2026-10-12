import { load } from 'cheerio';
import { lexaraCourtListenerJson } from '../../lexara/LexaraCourtListenerClient';
import { STATE_COURT_PORTALS, CRIMINAL_CASE_PORTALS } from './CriminalSourceCatalog';
import type { CriminalSearchQuery, CriminalCaseCandidate, CriminalCustodyCandidate, CriminalSourceCoverage } from './types';

export interface CriminalRetrievalResult {
  cases: CriminalCaseCandidate[];
  custody: CriminalCustodyCandidate[];
  coverage: CriminalSourceCoverage[];
}
const empty = (): CriminalRetrievalResult => ({ cases: [], custody: [], coverage: [] });
const text = (value: unknown) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const quote = (value: string) => '"' + value.replace(/["\\]/g, ' ').trim() + '"';
function nameParts(value: string) {
  const parts = value.trim().split(/\s+/); return { first:parts[0], middle:parts.slice(1,-1).join(' '), last:parts.at(-1)! };
}
export function criminalNameMatches(expected: string, actual: string): boolean {
  const parts = nameParts(expected), words = new Set(normalize(actual).split(' '));
  return normalize(parts.first).length > 1 && words.has(normalize(parts.first)) && words.has(normalize(parts.last))
    && normalize(parts.middle).split(' ').filter(Boolean).every(word => words.has(word));
}
function row(source: string, url: string, status: CriminalSourceCoverage['status'], recordsFound: number, note: string): CriminalSourceCoverage {
  return { source, url, status, recordsFound, note, retrievedAt:new Date().toISOString() };
}
export function criminalCourtUrl(raw: unknown): string | undefined {
  try {
    const url = new URL(String(raw || ''), 'https://www.courtlistener.com');
    return url.protocol === 'https:' && url.hostname === 'www.courtlistener.com' && /^\/docket\/\d+\//.test(url.pathname) ? url.toString() : undefined;
  } catch { return undefined; }
}

/** Archived filings only, using the existing CourtListener credential/cache. */
export async function retrieveFederalCriminalCases(query: CriminalSearchQuery, signal?: AbortSignal): Promise<CriminalRetrievalResult> {
  const out = empty(), source = 'CourtListener RECAP', root = 'https://www.courtlistener.com/recap/';
  if (!process.env.COURTLISTENER_API_TOKEN?.trim()) {
    out.coverage.push(row(source,root,'not_configured',0,'Existing CourtListener credential is unavailable. No account was created.')); return out;
  }
  const search = `caseName:${quote(query.fullName)}${query.docketNumber ? ` AND docketNumber:${quote(query.docketNumber)}` : ''}`;
  let path: string | undefined = 'search/?' + new URLSearchParams({ q:search,type:'r',order_by:'score desc' });
  let truncated = false, failed = false;
  for (let page=0; path && page<2 && !signal?.aborted; page++) {
    const payload = await lexaraCourtListenerJson(path,signal);
    if (!payload || !Array.isArray(payload.results)) { failed = true; break; }
    for (const item of payload.results) {
      const caseNumber = text(item.docketNumber), title = text(item.caseNameFull || item.caseName);
      const sourceUrl = criminalCourtUrl(item.docket_absolute_url || item.absolute_url);
      if (!sourceUrl || !/\bcr\b/i.test(caseNumber) || !criminalNameMatches(query.fullName,title)) continue;
      if (query.docketNumber && normalize(caseNumber) !== normalize(query.docketNumber)) continue;
      if (out.cases.some(c => c.sourceUrl === sourceUrl)) continue;
      out.cases.push({ caseNumber,title,court:text(item.court),sourceUrl,filedAt:text(item.dateFiled)||undefined,
        retrievedAt:new Date().toISOString(),identityStatus:'unconfirmed',charges:[],documents:[] });
      if (out.cases.length>=8) { truncated = true; break; }
    }
    path = undefined;
    if (payload.next) {
      try { const next=new URL(payload.next); if(next.origin==='https://www.courtlistener.com' && next.pathname==='/api/rest/v4/search/' && next.searchParams.get('q')===search && next.searchParams.get('type')==='r') path='search/'+next.search; else truncated=true; } catch { truncated=true; }
    }
    if(out.cases.length>=8) break;
  }
  if(path) truncated=true;
  // Three case-specific document reads at most; metadata never becomes a conviction.
  for(const candidate of out.cases.slice(0,3)) {
    if(signal?.aborted) break;
    const docketId=new URL(candidate.sourceUrl).pathname.split('/')[2];
    const docs=await lexaraCourtListenerJson('search/?'+new URLSearchParams({type:'rd',q:`docket_id:${docketId} AND (description:judgment OR description:sentencing OR description:indictment OR description:plea)`,available_only:'on',order_by:'score desc'}),signal);
    const selected=(Array.isArray(docs?.results)?docs.results:[]).find((doc:any)=>criminalCourtUrl(doc.absolute_url)?.split('/')[4]===docketId && Number.isSafeInteger(Number(doc.id)));
    if(!selected) continue;
    const record=await lexaraCourtListenerJson(`recap-documents/${Number(selected.id)}/`,signal);
    if(!record || record.is_available===false || criminalCourtUrl(record.absolute_url)!==criminalCourtUrl(selected.absolute_url)) continue;
    const content=text(record.plain_text); if(!content) continue;
    candidate.documents.push({title:text(selected.description||selected.short_description)||'Archived criminal filing',sourceUrl:criminalCourtUrl(selected.absolute_url)!,excerpt:content.slice(0,6000),retrievedAt:new Date().toISOString()});
  }
  out.coverage.push(row(source,root,failed||truncated||signal?.aborted?'partial':'checked',out.cases.length,
    'Searched archived federal criminal-case candidates. Name matches remain unconfirmed; missing archive records do not prove no record exists.'+(truncated?' Search results were capped.':'')+(failed?' The provider did not complete every request.':'')));
  return out;
}

async function boundedNativeResponse(url: string, init: RequestInit, signal?: AbortSignal): Promise<string> {
  const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(6000),...(signal?[signal]:[])])});
  if(!response.ok || !response.body) throw new Error('Official source unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[]; let size=0;
  while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>1_000_000){await reader.cancel();throw new Error('Official response exceeded limit');} chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}

/** BOP custody records, not charges or proof of a conviction. */
export async function retrieveFederalCustody(query: CriminalSearchQuery, signal?: AbortSignal): Promise<CriminalRetrievalResult> {
  const out=empty(),root='https://www.bop.gov/inmateloc/',parts=nameParts(query.fullName);
  try {
    const form=new URLSearchParams({todo:'query',output:'json',nameFirst:parts.first,nameMiddle:parts.middle,nameLast:parts.last,race:'',age:'',sex:'',...(query.inmateNumber?{inmateNum:query.inmateNumber,inmateNumType:'IRN'}:{})});
    const raw=await boundedNativeResponse('https://www.bop.gov/PublicInfo/execute/inmateloc',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json','user-agent':'LegalWhat/1.0'},body:form.toString()},signal);
    const payload=JSON.parse(raw);
    if(payload.Captcha || !Array.isArray(payload.InmateLocator)) throw new Error('BOP lookup incomplete');
    for(const item of payload.InmateLocator.slice(0,30)) {
      const fullName=text([item.nameFirst,item.nameMiddle,item.nameLast].filter(Boolean).join(' '));
      if(!criminalNameMatches(query.fullName,fullName))continue;
      const inmateNumber=text(item.inmateNum); if(!inmateNumber)continue;
      if(query.dateOfBirth && Number.isFinite(Number(item.age))) {
        const birth=new Date(query.dateOfBirth+'T00:00:00Z'),now=new Date();
        const age=now.getUTCFullYear()-birth.getUTCFullYear()-(now.getUTCMonth()<birth.getUTCMonth()||now.getUTCMonth()===birth.getUTCMonth()&&now.getUTCDate()<birth.getUTCDate()?1:0);
        if(Number(item.age)!==age)continue;
      }
      if(query.inmateNumber && inmateNumber!==query.inmateNumber)continue;
      out.custody.push({fullName,inmateNumber,facility:text(item.faclName)||undefined,age:Number(item.age)||undefined,
        status:text(item.releaseCode)||'Not specified by source',releaseDate:text(item.actRelDate||item.projRelDate)||undefined,
        identityStatus:query.inmateNumber?'identifier_matched':'unconfirmed',sourceUrl:root,retrievedAt:new Date().toISOString()});
      if(out.custody.length>=8)break;
    }
    out.coverage.push(row('Federal Bureau of Prisons',root,payload.InmateLocator.length>8?'partial':'checked',out.custody.length,'BOP custody records have limited historical coverage. A name match is not confirmed identity, and custody does not establish a conviction.'));
  } catch {out.coverage.push(row('Federal Bureau of Prisons',root,'unavailable',0,'The source could not complete the search. This is not a negative custody finding.'));}
  return out;
}

export function parseOklahomaCase(html: string, sourceUrl: string, query: CriminalSearchQuery): CriminalCaseCandidate | null {
  const url=new URL(sourceUrl); if(url.origin!=='https://www.oscn.net'||url.pathname.toLowerCase()!=='/dockets/getcaseinformation.aspx')return null;
  const $=load(html),caseNumber=text($('.text-casenumber').first().text()) || text($('.caseStyle td').toArray().map(el => $(el).text()).join(' ')).match(/\b(?:CF|CM)-\d{4}-\d+\b/i)?.[0];
  if(!caseNumber || !/^(?:CF|CM)-\d{4}-\d+$/i.test(caseNumber))return null;
  if(query.docketNumber && normalize(query.docketNumber)!==normalize(caseNumber))return null;
  const caseText=text($('.caseStyle').text());
  if(!caseText || !$('.CountsContainer').length)return null;
  const charges:CriminalCaseCandidate['charges']=[];
  $('.CountsContainer').each((_i,element)=>{
    const section=$(element),description=text(section.find('.CountDescription').text());
    const dispositions=section.find('.Disposition tbody tr').toArray().filter(tr=>criminalNameMatches(query.fullName,text($(tr).find('.countpartyname').text())));
    for(const tr of dispositions) {
      const disposition=text($(tr).find('.countdisposition').text());
      charges.push({count:text(section.find('.Counts strong').first().text()),description:description.match(/Count as Filed:\s*(.*?)(?:,?\s*in violation of|Date of Offense:|$)/i)?.[1]||description,
        statute:text(section.find('.CountDescription a').first().text())||undefined,
        offenseDate:description.match(/Date of Offense:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1],
        disposition:disposition||undefined,dispositionDate:disposition.match(/Disposed:\s*[^,]+,\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]});
    }
  });
  if(!charges.length)return null;
  const docket=$('h2.dockets').nextAll().clone();docket.find('script,style').remove();
  const excerpt=text(docket.text()).slice(0,6000);
  return {caseNumber,title:caseText.slice(0,500),court:text($('.styletop').first().text()),sourceUrl,retrievedAt:new Date().toISOString(),identityStatus:'unconfirmed',charges,
    documents:excerpt?[{title:'Official docket entries; consult the court minute for complete sentence information',sourceUrl,excerpt,retrievedAt:new Date().toISOString()}]:[]};
}

export async function retrieveOklahomaCases(query: CriminalSearchQuery, signal?: AbortSignal): Promise<CriminalRetrievalResult> {
  const out=empty(),root='https://www.oscn.net/dockets/Search.aspx';
  if(query.state!=='OK')return out;
  try {
    const form=load(await boundedNativeResponse(root,{headers:{'user-agent':'LegalWhat/1.0'}},signal));
    const counties=form('select[name="db"] option').toArray().map(el=>({key:form(el).attr('value')!,label:normalize(form(el).text().replace(/County District Court/i,''))}));
    const requestedCounty=query.county;
    const county=requestedCounty?counties.find(c=>c.label===normalize(requestedCounty.replace(/County$/i,''))):undefined;
    if(query.county&&!county)throw new Error('County could not be resolved');
    const parts=nameParts(query.fullName),params=new URLSearchParams({db:county?.key||'all',lname:parts.last,fname:parts.first,mname:parts.middle,partytype:'',number:query.docketNumber||''});
    if(query.dateOfBirth){const [year,month,day]=query.dateOfBirth.split('-');params.set('DoBMin',`${month}/${day}/${year}`);params.set('DoBMax',`${month}/${day}/${year}`);}
    const resultsUrl='https://www.oscn.net/dockets/Results.aspx?'+params;
    const html=await boundedNativeResponse(resultsUrl,{headers:{'user-agent':'LegalWhat/1.0'}},signal),$=load(html);
    if(!/OSCN|Oklahoma State Courts Network/i.test(html)||/captcha|verify you are human/i.test($('title').text()))throw new Error('Search unavailable');
    const links=[...new Set($('a[href*="GetCaseInformation.aspx"]').toArray().map(el=>new URL($(el).attr('href')!,resultsUrl).toString()))]
      .filter(link=>new URL(link).origin==='https://www.oscn.net' && /(?:CF|CM)-\d{4}-\d+/i.test(link));
    const records=await Promise.allSettled(links.slice(0,4).map(async link=>parseOklahomaCase(await boundedNativeResponse(link,{headers:{'user-agent':'LegalWhat/1.0'}},signal),link,query)));
    for(const record of records)if(record.status==='fulfilled'&&record.value)out.cases.push(record.value);
    const complete=(links.length>0||/no (?:cases|records|results|matches)|0 cases/i.test($('body').text())) && links.length<=4 && records.every(r=>r.status==='fulfilled');
    out.coverage.push(row('Oklahoma OSCN',root,complete?'checked':'partial',out.cases.length,'Retrieved criminal count and disposition entries for matching party names. Identity remains unconfirmed; results are limited to accessible OSCN records.'));
  } catch {out.coverage.push(row('Oklahoma OSCN',root,'unavailable',0,'The public lookup did not complete. No negative criminal-history finding was made.'));}
  return out;
}

export function isCriminalOfficialUrl(raw:string,state?:string):boolean {
  try {
    const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)return false;
    const host=u.hostname.toLowerCase();
    if(host==='www.nsopw.gov'||host==='nsopw.gov'||host==='public.courts.in.gov'||host.endsWith('.in.gov')&&/mycase/i.test(u.pathname)||/ujspars\.sd\.gov$/.test(host))return false;
    const known=[state&&STATE_COURT_PORTALS[state],state&&CRIMINAL_CASE_PORTALS[state]?.url].filter(Boolean).map(v=>new URL(v as string).hostname.replace(/^www\./,''));
    return host.endsWith('.gov')||/\.(?:courts?|judicial|state)\.[a-z]{2}\.us$/.test(host)||known.some(root=>host===root||host===`www.${root}`);
  }catch{return false;}
}

/** Read discovered official pages; search snippets are never record findings. */
export async function retrieveOfficialCriminalPages(query:CriminalSearchQuery,signal?:AbortSignal):Promise<CriminalRetrievalResult> {
  const out=empty();
  const { discoverLegalMeshTier3 } = await import('../../lexara/LegalProviderMesh');
  const { lexaraRetrievalAdapter } = await import('../../lexara/LexaraRetrievalBoundary');
  const portal = query.state && (CRIMINAL_CASE_PORTALS[query.state]?.url || STATE_COURT_PORTALS[query.state]);
  const domain = portal ? new URL(portal).hostname : '';
  const objective=[quote(query.fullName),query.state,query.county,query.docketNumber,'criminal court case conviction disposition',domain ? `(site:.gov OR site:${domain})` : 'site:.gov'].filter(Boolean).join(' ');
  const leads=await discoverLegalMeshTier3(objective,signal,{categories:['criminal-records','courts'],jurisdiction:query.state,subject:query.fullName,requestedFact:'criminal-arrest',queryAlreadyPlanned:true,allowClaudePlanning:false,firstUseful:true}).catch(()=>[]);
  const targets=[...new Set(leads.map(l=>l.url).filter(u=>isCriminalOfficialUrl(u,query.state)))].slice(0,6);
  const retrieval=targets.length?await lexaraRetrievalAdapter.retrieve({purpose:'lexara_legal_research',targets,signal}).catch(()=>({evidence:[]})):{evidence:[]};
  for(const evidence of retrieval.evidence) {
    if(!criminalNameMatches(query.fullName,evidence.content)||! /\b(?:criminal|convict|sentenc|indictment|charge|arrest)\w*\b/i.test(evidence.content))continue;
    // An excerpt is a lead requiring review, never an inferred charge/conviction.
    const caseNumber=evidence.content.match(/\b(?:CF|CM|CR|FE|SR|AG|OW)[- ]?\d{2,4}[- ]?\d{3,10}\b/i)?.[0];
    if(query.docketNumber && (!caseNumber || normalize(caseNumber)!==normalize(query.docketNumber)))continue;
    if(!caseNumber)continue;
    out.cases.push({caseNumber,title:text(leads.find(l=>l.url===evidence.target)?.title)||'Official criminal-record source',court:new URL(evidence.target).hostname,sourceUrl:evidence.target,
      retrievedAt:evidence.retrievedAt,identityStatus:'unconfirmed',charges:[],documents:[{title:'Retrieved official-source text; person and case match require review',sourceUrl:evidence.target,excerpt:evidence.content.slice(0,6000),retrievedAt:evidence.retrievedAt}]});
  }
  out.coverage.push(row('Official public-source discovery','https://www.usa.gov/state-courts',retrieval.evidence.length?'partial':'unavailable',out.cases.length,'Used existing search providers and read accessible official pages. This is not a comprehensive state/county search; no result does not establish a clear history.'));
  return out;
}
