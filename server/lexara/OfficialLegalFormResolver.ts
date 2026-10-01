import type { LexaraAuthorityResearch } from './LexaraAuthorityResearch';

export type OfficialFormRequirement = 'mandatory' | 'optional' | 'custom_allowed' | 'unverified';
export interface OfficialLegalForm {
  requirement: OfficialFormRequirement; title?: string; formNumber?: string; url?: string;
  sourceTitle?: string; issuingAuthority?: string; revision?: string;
  contentType?: 'pdf' | 'docx' | 'html' | 'unknown'; verifiedOfficial: boolean;
  localRules: string[]; companionDocuments: string[];
  provenance: Array<{ title: string; url: string; retrievedAt: string }>;
}
const OFFICIAL_HOST = /(?:\\.gov|\\.uscourts\\.gov|\\.courts?\\.[a-z]{2}\\.us|\\.judicial\\.[a-z]{2}\\.gov)$/i;
const FORM_HINT = /\\b(form|petition|complaint|motion|notice|summons|cover sheet|affidavit|application|order|pleading)\\b/i;
const MANDATORY_HINT = /\\b(must|required|shall|required form|prescribed form|use (?:this|the) form)\\b/i;
const OPTIONAL_HINT = /\\b(optional|may use|provided for convenience)\\b/i;
const CUSTOM_HINT = /\\b(no official form|no prescribed form|may be drafted|local form not required)\\b/i;
function official(url: string): boolean { try { const host=new URL(url).hostname.toLowerCase(); return host.endsWith('.gov') || host==='gov' || host.endsWith('.uscourts.gov') || /(?:^|\\.)courts?\\.[a-z]{2}\\.us$/.test(host); } catch { return false; } }
function typeOf(url: string): OfficialLegalForm['contentType'] {
  const clean=url.toLowerCase().split('?')[0]; if(clean.endsWith('.pdf')) return 'pdf';
  if(clean.endsWith('.docx')||clean.endsWith('.doc')) return 'docx'; if(clean.startsWith('http')) return 'html'; return 'unknown';
}
export function resolveOfficialLegalForm(research: LexaraAuthorityResearch | null, documentType: string): OfficialLegalForm {
  if(!research?.sources?.length) return { requirement:'unverified', verifiedOfficial:false, localRules:[], companionDocuments:[], provenance:[] };
  const relevant=research.sources.filter(source=>official(source.url) && FORM_HINT.test([source.title,source.excerpt].filter(Boolean).join(' ')));
  const documentTokens=String(documentType||'').toLowerCase().split(/[^a-z0-9]+/).filter(token=>token.length>=4 && !['form','legal','document','official'].includes(token));
  const scored=relevant.map(source=>{
    const haystack=[source.title,source.excerpt].filter(Boolean).join(' ').toLowerCase();
    const score=documentTokens.reduce((total,token)=>total+(haystack.includes(token)?1:0),0)
      +(typeOf(source.url)!=='html'?1:0);
    return {source,score,haystack};
  }).sort((a,b)=>b.score-a.score);
  const bestScore=scored[0]?.score||0;
  const specific=scored.filter(entry=>entry.score>0 && entry.score>=Math.max(1,bestScore-1));
  const requirementText=(specific.length?specific:scored.slice(0,1)).map(entry=>entry.haystack).join('\n');
  const combined=relevant.map(source=>[source.title,source.excerpt].filter(Boolean).join(' ')).join('\n');
  const requirement: OfficialFormRequirement = MANDATORY_HINT.test(requirementText) ? 'mandatory' : OPTIONAL_HINT.test(requirementText) ? 'optional' : CUSTOM_HINT.test(requirementText) ? 'custom_allowed' : 'unverified';
  const direct=(specific.find(entry=>FORM_HINT.test(entry.source.title) && typeOf(entry.source.url)!=='html') || specific[0] || scored.find(entry=>FORM_HINT.test(entry.source.title) && typeOf(entry.source.url)!=='html') || scored[0])?.source;
  const title=direct?.title;
  const directText=[direct?.title,direct?.excerpt].filter(Boolean).join(' ');
  const formNumber=directText.match(/\b(?:form|ao|dc|civ|fam|div|eoir|va|official form)\s*[-#:]*\s*([A-Z0-9.:-]{1,24})\b/i)?.[1];
  const revisionText=directText;
  const revision=revisionText.match(/\b(?:revision|revised|edition|effective|updated|rev\.?)\s*(?:date)?\s*[:#-]?\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4})\b/i)?.[1];
  const localRules=relevant.filter(s=>/\\b(local rule|court rule|filing requirement|instructions?)\\b/i.test([s.title,s.excerpt].filter(Boolean).join(' '))).map(s=>s.title).slice(0,8);
  const companionDocuments=relevant.filter(s=>/\\b(summons|civil cover sheet|fee waiver|service|appearance|proposed order)\\b/i.test([s.title,s.excerpt].filter(Boolean).join(' '))).map(s=>s.title).slice(0,8);
  return { requirement,title,formNumber,url:direct?.url,sourceTitle:direct?.title,revision,contentType:direct?.url?typeOf(direct.url):undefined,verifiedOfficial:!!direct,localRules,companionDocuments,provenance:relevant.slice(0,12).map(s=>({title:s.title,url:s.url,retrievedAt:research.searchedAt})) };
}
export function officialFormDirective(form: OfficialLegalForm): string {
  if(form.requirement==='mandatory') return ['A mandatory official form appears to apply. Do NOT substitute a custom-drafted pleading for that official form.',form.title ? 'Official form: '+form.title+'.' : '',form.formNumber ? 'Form number: '+form.formNumber+'.' : '',form.url ? 'Verified official source: '+form.url+'.' : '',form.companionDocuments.length ? 'Potential accompanying documents: '+form.companionDocuments.join('; ')+'.' : ''].filter(Boolean).join(' ');
  if(form.requirement==='optional') return 'An official form appears available'+(form.title?': '+form.title:'')+'. Use it when the user chooses the official-form path; a custom draft may be permissible only if the retrieved authority supports that conclusion.';
  if(form.requirement==='custom_allowed') return 'Retrieved official material indicates no prescribed form is required; custom drafting may proceed subject to the retrieved local rules.';
  return 'Official-form status could not be verified. Do not claim that a custom draft is an official, mandatory, or filing-ready form.';
}
