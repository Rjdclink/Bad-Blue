import type { LexaraAuthorityResearch } from './LexaraAuthorityResearch';

export type OfficialFormRequirement = 'mandatory' | 'optional' | 'custom_allowed' | 'unverified';
export interface OfficialLegalForm {
  requirement: OfficialFormRequirement; title?: string; formNumber?: string; url?: string;
  sourceTitle?: string; issuingAuthority?: string; revision?: string;
  contentType?: 'pdf' | 'docx' | 'html' | 'unknown'; verifiedOfficial: boolean;
  trustedOfficialDomains?: string[];
  localRules: string[]; companionDocuments: string[];
  provenance: Array<{ title: string; url: string; retrievedAt: string }>;
}
const OFFICIAL_HOST = /(?:\.gov|\.uscourts\.gov|\.courts?\.[a-z]{2}\.us|\.judicial\.[a-z]{2}\.gov)$/i;
const FORM_HINT = /\b(form|petition|complaint|motion|notice|summons|cover sheet|affidavit|application|request|order|pleading)\b/i;
const MANDATORY_HINT = /\b(?:required\s+(?:official\s+)?form|mandatory\s+(?:official\s+)?form|prescribed form|must\s+(?:use|complete|file|submit)\s+(?:(?:this|the)\s+)?form|shall\s+(?:use|file|submit)\s+(?:(?:this|the)\s+)?form|use (?:this|the) form)\b/i;
const OPTIONAL_HINT = /\b(optional|may use|provided for convenience)\b/i;
const CUSTOM_HINT = /\b(no official form|no prescribed form|may be drafted|local form not required)\b/i;
const RETIRED_FORM_HINT = /\b(?:superseded|obsolete|archived|withdrawn|discontinued|replaced by|no longer (?:valid|accepted|used))\b/i;
function official(url: string, trustedDomains?: readonly string[]): boolean {
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:') return false;
    const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
    // State courts sometimes publish on official .org domains. Trust those
    // only when obtained from the jurisdiction's court-resource directory.
    if(trustedDomains?.some(domain=>{
      const expected=domain.toLowerCase().replace(/^www\./,'');
      return host===expected || host.endsWith('.'+expected);
    })) return true;
    return host.endsWith('.gov') || host==='gov' || host.endsWith('.uscourts.gov')
      || /(?:^|\.)courts?\.[a-z]{2}\.us$/.test(host);
  } catch { return false; }
}
function typeOf(url: string): OfficialLegalForm['contentType'] {
  const clean=url.toLowerCase().split('?')[0]; if(clean.endsWith('.pdf')) return 'pdf';
  if(clean.endsWith('.docx')) return 'docx'; if(clean.startsWith('http')) return 'html'; return 'unknown';
}
export function resolveOfficialLegalForm(research: LexaraAuthorityResearch | null, documentType: string, requestedFormNumber?: string, issuingDomains?: readonly string[]): OfficialLegalForm {
  if(!research?.sources?.length) return { requirement:'unverified', verifiedOfficial:false, localRules:[], companionDocuments:[], provenance:[] };
  const escapedNumber = requestedFormNumber?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numberPattern = escapedNumber
    ? new RegExp(`(?:^|[^a-z0-9${/^\d+$/.test(requestedFormNumber || '') ? '' : '.:-'}])${escapedNumber}(?![a-z0-9.-]|:[a-z0-9])`, 'i')
    : null;
  // An unrelated agency's .gov file is not a form issued by this court.
  const matchesIssuer=(url:string) => !issuingDomains?.length || issuingDomains.some(domain=>{
    try {
      const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
      const expected=domain.toLowerCase().replace(/^www\./,'');
      return host===expected || host.endsWith('.'+expected);
    } catch { return false; }
  });
  const relevant=research.sources.filter(source=>official(source.url,issuingDomains) && matchesIssuer(source.url)
    && source.kind!=='secondary' && source.kind!=='web'
    && FORM_HINT.test([source.title,source.excerpt].filter(Boolean).join(' '))
    && !RETIRED_FORM_HINT.test([source.title,source.excerpt].filter(Boolean).join(' '))
    && (!numberPattern || numberPattern.test([source.title,source.excerpt,source.url].filter(Boolean).join(' '))));
  // Official publishers often use "Application to Modify" while users ask
  // for "Modification of" the same obligation. Match the instrument's
  // meaning without requiring the user's conversational words in its title.
  const comparable=(value:string)=>String(value||'').toLowerCase()
    .replace(/\\b(?:modification|modifying|modified)\\b/g,'modify')
    .replace(/\\b(?:petitions?)\\b/g,'petition');
  const documentTokens=comparable(documentType).split(/[^a-z0-9]+/)
    .filter(token=>token.length>=4
      && !['form','legal','document','official','requested','please','county','obligation'].includes(token));
  const scored=relevant.filter(source => !requestedFormNumber || !/\b(?:instructions?|guide|guidance|checklist)\b/i.test(source.title)).map(source=>{
    const haystack=comparable([source.title,source.excerpt].filter(Boolean).join(' '));
    const tokenScore=documentTokens.reduce((total,token)=>total+(haystack.includes(token)?1:0),0);
    const titleScore=documentTokens.reduce((total,token)=>total+(comparable(source.title).includes(token)?1:0),0);
    const exactFormScore=numberPattern ? 3 : 0;
    const score=tokenScore+titleScore*3+exactFormScore+(typeOf(source.url)!=='html'?1:0);
    return {source,score,tokenScore,titleScore,haystack};
  }).filter(entry=>Boolean(requestedFormNumber)
    || (entry.tokenScore>0 && (entry.titleScore>0 || entry.source.provider==='official-form-directory'
      || (entry.tokenScore>=2 && /(?:\.pdf|\.docx|\/download|\/embedDocument)(?:[?#/]|$)/i.test(entry.source.url)))))
    .sort((a,b)=>b.score-a.score);
  const bestScore=scored[0]?.score||0;
  const specific=scored.filter(entry=>entry.score>=Math.max(1,bestScore-1));
  if (!specific.length) return { requirement:'unverified', verifiedOfficial:false, localRules:[], companionDocuments:[], provenance:[] };
  const requirementText=specific.map(entry=>entry.haystack).join('\n');
  const combined=relevant.map(source=>[source.title,source.excerpt].filter(Boolean).join(' ')).join('\n');
  const requirement: OfficialFormRequirement = MANDATORY_HINT.test(requirementText) ? 'mandatory' : OPTIONAL_HINT.test(requirementText) ? 'optional' : CUSTOM_HINT.test(requirementText) ? 'custom_allowed' : 'unverified';
  // Instructions can establish requirements, but are not the court form to
  // complete. Courts often expose the actual form at extensionless URLs.
  const formEntries=specific.filter(entry=>FORM_HINT.test(entry.source.title) && !/\b(?:instructions?|guide|guidance|checklist)\b/i.test(entry.source.title));
  const direct=(formEntries.find(entry=>typeOf(entry.source.url)!=='html') || formEntries[0])?.source;
  const title=direct?.title;
  const directText=[direct?.title,direct?.excerpt].filter(Boolean).join(' ');
  const formNumber=requestedFormNumber || directText.match(/\b(?:form|ao|dc|civ|fam|div|eoir|va|official form)\s*[-#:]*\s*([A-Z0-9.:-]{1,24})\b/i)?.[1];
  const revisionText=directText;
  const revision=revisionText.match(/\b(?:revision|revised|edition|effective|updated|rev\.?)\s*(?:date)?\s*[:#-]?\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4})\b/i)?.[1];
  const localRules=relevant.filter(s=>/\b(local rule|court rule|filing requirement|instructions?)\b/i.test([s.title,s.excerpt].filter(Boolean).join(' '))).map(s=>s.title).slice(0,8);
  const companionDocuments=relevant.filter(s=>/\b(summons|civil cover sheet|fee waiver|service|appearance|proposed order)\b/i.test([s.title,s.excerpt].filter(Boolean).join(' '))).map(s=>s.title).slice(0,8);
  return { requirement,title,formNumber,url:direct?.url,sourceTitle:direct?.title,revision,contentType:direct?.url?typeOf(direct.url):undefined,verifiedOfficial:Boolean(direct && matchesIssuer(direct.url) && official(direct.url,issuingDomains)),trustedOfficialDomains:issuingDomains?.slice(0,18),localRules,companionDocuments,provenance:relevant.slice(0,12).map(s=>({title:s.title,url:s.url,retrievedAt:research.searchedAt})) };
}
/**
 * Alternative official forms are drawn only from jurisdiction-matched,
 * already-discovered sources. The user's description need not contain the
 * court's exact name or form number.
 */
export interface OfficialFormCandidate {
  form: OfficialLegalForm;
  score: number;
}

export function rankOfficialLegalForms(
  research: LexaraAuthorityResearch | null,
  purpose: string,
  requestedFormNumber?: string,
  issuingDomains?: readonly string[],
): OfficialFormCandidate[] {
  if (!research?.sources?.length) return [];
  const comparable=(value:string)=>String(value||'').toLowerCase()
    .replace(/\b(?:modification|modify|modifying|modified|change|changing|adjust|reduce|increase|decrease)\b/g,'modify')
    .replace(/\b(?:applications?|requests?)\b/g,'application')
    .replace(/\b(?:petitions?)\b/g,'petition')
    .replace(/\b(?:visitation|parenting time)\b/g,'parenting');
  const words=(value:string)=>[...new Set(comparable(value).split(/[^a-z0-9]+/)
    .filter(token=>token.length>=4 && !['form','court','legal','official','county',
      'need','want','find','please','file','obligation','document','order','paperwork',
      'this','that','only','application'].includes(token)))];
  const objective=words(purpose);
  if (!objective.length && !requestedFormNumber) return [];
  const results: OfficialFormCandidate[]=[];
  const seen=new Set<string>();
  for (const source of research.sources) {
    if (!FORM_HINT.test(source.title)
      || /\b(?:instructions?|guide|guidance|checklist|directory|index)\b/i.test(source.title)) continue;
    const form=resolveOfficialLegalForm({
      ...research, sources:[source],
    },purpose,requestedFormNumber,issuingDomains);
    if (!form.verifiedOfficial || !form.url || !form.title) continue;
    const titleWords=words(source.title);
    const titleOverlap=objective.filter(word=>titleWords.includes(word)).length;
    const excerptOverlap=objective.filter(word=>words(source.excerpt||'').includes(word)).length;
    if (!requestedFormNumber && titleOverlap===0
      && !(excerptOverlap>=2 && /(?:\.pdf|\.docx|\/download|\/embedDocument)(?:[?#/]|$)/i.test(source.url))) continue;
    let score=titleOverlap*5 + Math.min(excerptOverlap,4)
      + (/(?:\.pdf|\.docx|\/download|\/embedDocument)(?:[?#]|$)/i.test(source.url)?1:0);
    if (requestedFormNumber) score+=20;
    // Companion paperwork cannot displace the application being requested.
    if (/\b(?:confidential|certificate of service|notice of service|fee waiver|instructions)\b/i.test(source.title)
      && !/\b(?:confidential|certificate|service|fee waiver|instructions)\b/i.test(purpose)) score-=8;
    const host=new URL(form.url).hostname.toLowerCase().replace(/^www\./,'');
    const identifier=String(form.formNumber||'').match(/\d{2,5}(?!.*\d)/)?.[0];
    const key=host+'|'+(identifier || comparable(form.title).replace(/[^a-z0-9]+/g,''));
    if(seen.has(key))continue;
    seen.add(key);
    results.push({form,score});
  }
  return results.sort((a,b)=>b.score-a.score || String(a.form.title).localeCompare(String(b.form.title))).slice(0,5);
}

export function officialFormNeedsClarification(candidates: OfficialFormCandidate[], requestedFormNumber?: string): boolean {
  if (requestedFormNumber || candidates.length<2) return false;
  const [first,second]=candidates;
  return first.score>=5 && second.score>=5 && second.score>=first.score-2
    && first.form.url!==second.form.url;
}

export function selectClarifiedOfficialForm(
  candidates: OfficialFormCandidate[],
  answer: string,
  offeredUrls: readonly string[],
): OfficialLegalForm | null {
  const offered=candidates.filter(candidate=>candidate.form.url && offeredUrls.includes(candidate.form.url));
  const normalized=String(answer||'').toLowerCase().trim();
  const position=/^(?:1|one|first|option 1|number 1)\b/i.test(normalized) ? 0
    : /^(?:2|two|second|option 2|number 2)\b/i.test(normalized) ? 1 : -1;
  if(position>=0){
    const sourceUrl=offeredUrls[position];
    return offered.find(candidate=>candidate.form.url===sourceUrl)?.form || null;
  }
  const court=/(?:\b(?:court|judge|district court)\b)/i.test(normalized);
  const agency=/(?:\b(?:agency|administrative|support services|department)\b)/i.test(normalized);
  if(court!==agency) {
    const eligible=offered.filter(({form})=>{
      const domain=new URL(form.url!).hostname;
      const looksCourt=/\b(?:court|judicial)\b/i.test(String(form.title)) || /(?:courts?|judicial|uscourts)/i.test(domain);
      return court ? looksCourt : !looksCourt;
    });
    if(eligible.length===1) return eligible[0].form;
  }
  const matched=offered.filter(({form})=>{
    const name=String(form.title||'').toLowerCase();
    return normalized.length>=6 && (name.includes(normalized) || normalized.includes(name));
  });
  return matched.length===1 ? matched[0].form : null;
}

export function officialFormDirective(form: OfficialLegalForm): string {
  if(form.requirement==='mandatory') return ['A mandatory official form appears to apply. Do NOT substitute a custom-drafted pleading for that official form.',form.title ? 'Official form: '+form.title+'.' : '',form.formNumber ? 'Form number: '+form.formNumber+'.' : '',form.url ? 'Verified official source: '+form.url+'.' : '',form.companionDocuments.length ? 'Potential accompanying documents: '+form.companionDocuments.join('; ')+'.' : ''].filter(Boolean).join(' ');
  if(form.requirement==='optional') return 'An official form appears available'+(form.title?': '+form.title:'')+'. Use it when the user chooses the official-form path; a custom draft may be permissible only if the retrieved authority supports that conclusion.';
  if(form.requirement==='custom_allowed') return 'Retrieved official material indicates no prescribed form is required; custom drafting may proceed subject to the retrieved local rules.';
  return 'Official-form status could not be verified. Do not claim that a custom draft is an official, mandatory, or filing-ready form.';
}
