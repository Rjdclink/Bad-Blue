import { createHash } from 'node:crypto';
import type { CriminalSearchQuery, CriminalRecord } from './types';
import { criminalSourceRoutes } from './CriminalSourceCatalog';
import { retrieveFederalCriminalCases, retrieveFederalCustody, retrieveOfficialCriminalPages, retrieveOklahomaCases, type CriminalRetrievalResult } from './CriminalRecordRetrieval';

export class CriminalRecordsAggregator {
  private cache = new Map<string, { expires:number; record:CriminalRecord }>();

  async search(query: CriminalSearchQuery, signal?:AbortSignal): Promise<CriminalRecord> {
    const normalized={...query,fullName:query.fullName.trim().replace(/\s+/g,' '),state:query.state?.toUpperCase(),county:query.county?.trim()};
    const key=createHash('sha256').update(JSON.stringify(normalized)+String(process.env.COURTLISTENER_API_TOKEN||'')).digest('hex');
    const cached=this.cache.get(key);
    if(cached && cached.expires>Date.now())return structuredClone(cached.record);
    const controller=new AbortController(),relay=()=>controller.abort(signal?.reason);
    if(signal?.aborted)controller.abort(signal.reason);else signal?.addEventListener('abort',relay,{once:true});
    const timer=setTimeout(()=>controller.abort(),12_000);
    let settled:PromiseSettledResult<CriminalRetrievalResult>[];
    try {
      settled=await Promise.allSettled([
        retrieveFederalCriminalCases(normalized,controller.signal),
        retrieveFederalCustody(normalized,controller.signal),
        retrieveOklahomaCases(normalized,controller.signal),
        retrieveOfficialCriminalPages(normalized,controller.signal),
      ]);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',relay);}
    const completed=settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
    const caseCandidates=[...new Map(completed.flatMap(result=>result.cases).map(item=>[item.sourceUrl,item])).values()].slice(0,16);
    const custodyCandidates=[...new Map(completed.flatMap(result=>result.custody).map(item=>[item.sourceUrl+':'+item.inmateNumber,item])).values()].slice(0,8);
    const searchedCoverage=completed.flatMap(result=>result.coverage);
    const coverage=[...searchedCoverage,...criminalSourceRoutes(normalized).filter(route=>!searchedCoverage.some(source=>source.url===route.url))];
    const candidateCount=caseCandidates.length+custodyCandidates.length;
    const record:CriminalRecord={fullName:normalized.fullName,dateOfBirth:normalized.dateOfBirth,
      // Candidates are kept separate from established facts about this person.
      charges:[],arrests:[],convictions:[],activeWarrants:[],incarcerationHistory:[],
      sexOffenderStatus:{registered:null,searchStatus:'not_checked'},riskScore:null,confidence:0,
      source:'Retrieved public criminal-case and custody candidates',scrapedAt:new Date(),
      searchStatus:candidateCount?'partial_results':coverage.some(item=>item.status==='checked')?'no_matches_in_checked_sources':'sources_unavailable',
      caseCandidates,custodyCandidates,coverage,recordsDetermined:false,coverageLimited:true,
      coverageNote:'These are source records and possible identity matches, not a verified complete criminal history. Confirm the person, court, case number and dates before attributing charges or outcomes. Arrests and charges are not convictions. Unsearched, inaccessible and sealed records remain unknown. Registry and warrant status were not determined.',
    };
    console.info('[CriminalRecords] Retrieval completed',{caseCandidates:caseCandidates.length,custodyCandidates:custodyCandidates.length,checkedSources:coverage.filter(c=>c.status==='checked').length,partialSources:coverage.filter(c=>c.status==='partial').length,claudeCalls:0,paidPacerFetches:0});
    // Do not turn an outage into a cached negative result.
    if(candidateCount&&!controller.signal.aborted){while(this.cache.size>=40)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{expires:Date.now()+180_000,record:structuredClone(record)});}
    return record;
  }
}
export const criminalRecordsAggregator = new CriminalRecordsAggregator();

export function formatCriminalRecordEvidence(record:CriminalRecord):string {
  const cases=(record.caseCandidates||[]).slice(0,6).map(c=>[
    `UNCONFIRMED IDENTITY MATCH — ${c.title}. Court: ${c.court}. Case number: ${c.caseNumber}.`,
    `SOURCE: ${c.sourceUrl}\nRETRIEVED: ${c.retrievedAt}`,
    ...c.charges.map(charge=>`SOURCE-REPORTED COUNT: ${charge.description}; statute: ${charge.statute||'not provided'}; offense date: ${charge.offenseDate||'not provided'}; disposition: ${charge.disposition||'not provided'}.`),
    ...c.documents.map(doc=>`DOCUMENT: ${doc.title}\nSOURCE: ${doc.sourceUrl}\nEXTRACT: ${doc.excerpt.slice(0,3000)}`),
  ].join('\n'));
  const custody=(record.custodyCandidates||[]).slice(0,4).map(c=>`CUSTODY RECORD (${c.identityStatus}) — ${c.fullName}; BOP number: ${c.inmateNumber}; facility: ${c.facility||'not provided'}; source status: ${c.status}; release date: ${c.releaseDate||'not provided'}. Custody is not proof of conviction.\nSOURCE: ${c.sourceUrl}\nRETRIEVED: ${c.retrievedAt}`);
  return [record.coverageNote,...cases,...custody,'SEARCH COVERAGE:',...(record.coverage||[]).map(c=>`${c.source}: ${c.status}; ${c.note}`)].filter(Boolean).join('\n\n');
}
