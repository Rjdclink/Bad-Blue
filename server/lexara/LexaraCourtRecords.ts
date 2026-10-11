import type { LexaraAuthorityResearchContext, LexaraAuthoritySource } from './LexaraAuthorityResearch';
import { isLexaraConversationControl, isLexaraDocumentIntakeQuestion, isLexaraOfficialFormQuestion } from './LexaraResearchIntentRouter';
import { lexaraCourtListenerJson as courtJson } from './LexaraCourtListenerClient';

export interface LexaraCourtRecordPlan {
  objective: string;
  docketNumber?: string;
  subject?: string;
  lookupQuery?: string;
  discoveryQuery: string;
  neededDocuments: string[];
  jurisdiction?: string;
}

const RECORD_CUE = /\b(?:court records?|court case|docket|case\s*(?:no\.?|number)|filings?|judgments?|lawsuits?|litigation|summons|served|foreclos\w*|evict\w*|sentenc\w*|indict\w*|court order|bankrupt\w*|appeal|custody order|divorce decree)\b/i;
const MAX_DOCUMENTS = 3;

const cleanText = (value: unknown) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const quoted = (value: string) => '"' + value.replace(/["\\]/g, ' ').trim().slice(0, 180) + '"';

function federalDocket(value: string) {
  const match = value.match(/\b(?:(\d{1,2}):)?(\d{2,4})[-\s]*(cv|cr|bk|ap|mc|civ)\.?[-\s]*(\d{2,7})/i);
  return match ? { office: match[1], year: match[2].slice(-2), type: match[3].toLowerCase().replace('civ', 'cv'), number: Number(match[4]), digits: match[4] } : undefined;
}

export function sameLexaraDocket(expected: string, actual: string): boolean {
  const left = federalDocket(expected), right = federalDocket(actual);
  if (left && right) return left.year === right.year && left.type === right.type && left.number === right.number
    && (!left.office || !right.office || left.office === right.office);
  return expected.replace(/[^a-z0-9]/gi, '').toLowerCase() === actual.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Select case evidence, not an unrelated person's background report. No model call. */
export function planLexaraCourtRecords(
  question: string,
  context: LexaraAuthorityResearchContext = {},
  previousQuestions: string[] = [],
): LexaraCourtRecordPlan | undefined {
  if (isLexaraConversationControl(question) || isLexaraDocumentIntakeQuestion(question)
    || isLexaraOfficialFormQuestion(question)) return undefined;
  const followUp = /\b(?:that|this|same|it|they|the (?:case|order|judgment|filing|sale|notice)|try again|look harder|search again|who got|how much)\b/i.test(question)
    && question.length < 300;
  const prior = followUp ? [...previousQuestions].reverse().slice(0, 3)
    .map(text => planLexaraCourtRecords(text, { jurisdiction: context.jurisdiction }))
    .find(plan => plan?.lookupQuery) : undefined;
  const directDocket = question.match(/\b(?:\d{1,2}:)?\d{2,4}-(?:cv|cr|bk|ap|mc|civ)-\d{2,7}(?:-[a-z]{1,8})?\b/i)?.[0]
    || question.match(/\b(?:case|docket)\s*(?:no\.?|number|#)?\s*[:#]?\s*([a-z]{2,5}\d{4,12}|\d{2}-\d{3,7})\b/i)?.[1];
  const caption = question.match(/\b([A-Z][\w.'’]*(?:\s+(?:[A-Z][\w.'’]*|of|the|&)){0,8}\s+[vV]\.?\s+[A-Z][\w.'’]*(?:\s+(?:[A-Z][\w.'’]*|of|the|&)){0,8})/)?.[1]?.replace(/[.,;!?]+$/, '').trim();
  if (!RECORD_CUE.test(question) && context.requestedFact !== 'court-record' && !prior && !directDocket
    && !(caption && /\b(?:find|retrieve|pull|fetch|show|link|download|read|look up|get|summariz\w*)\b/i.test(question)
      && !/\b(?:holding|hold|held|precedent|require\w*|legal standard|case law)\b/i.test(question)
      && documentTerms(question).length)) return undefined;
  const docketNumber = directDocket || (!caption ? prior?.docketNumber : undefined);
  const subject = caption || context.subject?.trim() || prior?.subject;
  const selectionQuestion = [question, !directDocket && !caption ? prior?.objective : undefined].filter(Boolean).join(' ');
  const neededDocuments = /foreclos|sheriff.?s? sale|sale proceeds|surplus/i.test(selectionQuestion)
    ? ['judgment', 'notice of sale', 'sale report', 'distribution order', 'disbursement accounting']
    : /evict|landlord|tenant/i.test(selectionQuestion)
      ? ['complaint', 'proof of service', 'hearing notice', 'judgment', 'writ of possession']
      : /sentenc|criminal|indict|convict|2255|2254/i.test(selectionQuestion)
        ? ['indictment', 'plea agreement', 'judgment', 'sentencing order', 'appeal decision']
        : /divorc|custody|support/i.test(selectionQuestion)
          ? ['petition', 'proof of service', 'temporary order', 'decree', 'latest custody or support order']
          : /bankrupt/i.test(selectionQuestion)
            ? ['petition', 'claims register', 'discharge order', 'dismissal order']
            : /appeal/i.test(selectionQuestion)
              ? ['judgment', 'notice of appeal', 'appellate decision', 'mandate']
              : ['complaint', 'proof of service', 'relevant motion', 'latest order', 'judgment'];
  const federal = docketNumber ? federalDocket(docketNumber) : undefined;
  const searchNumber = federal ? `${federal.year}-${federal.type}-${federal.digits}` : docketNumber;
  const lookupQuery = searchNumber ? `docketNumber:${quoted(searchNumber)}`
    : caption ? `caseName:${quoted(caption)}` : prior?.lookupQuery || (subject ? quoted(subject) : undefined);
  return {
    objective: question.slice(0, 1800), docketNumber, subject, lookupQuery,
    discoveryQuery: [context.jurisdiction, docketNumber || subject, question.slice(0, 500), 'court docket records', neededDocuments.slice(0, 3).join(' ')].filter(Boolean).join(' '),
    neededDocuments, jurisdiction: context.jurisdiction,
  };
}

const DOCUMENT_TERMS = /\b(?:plea agreements?|claims registers?|sale reports?|disbursement accounting|appeal decisions?|proof of service|notice of sale|notice of appeal|sentencing orders?|distribution orders?|discharge orders?|dismissal orders?|writ of possession|custody orders?|support orders?|complaints?|petitions?|orders?|judgments?|indictments?|decrees?|mandates?|notices?|distribution|discharge|motions?|service)\b/gi;

function documentTerms(text: string): string[] {
  return [...new Set((text.match(DOCUMENT_TERMS) || []).map(word => word.toLowerCase()
    .replace(/\b(agreement|register|report|decision|order|complaint|petition|judgment|indictment|decree|mandate|notice|motion)s\b/g, '$1')))];
}

const filingDescription = (doc: any) => [...new Set([cleanText(doc.short_description), cleanText(doc.description)].filter(Boolean))].join(' | ');

/** Keep a requested complaint ahead of answers and motions merely mentioning it. */
function filingScore(description: string, term: string): number {
  if (description.includes(' | ')) return Math.max(...description.split(' | ').map(field => filingScore(field, term)));
  const text = description.toLowerCase();
  if (term === 'complaint' && /\b(?:answer|response|dismiss|motion)\b/.test(text)) return 0;
  if (term === 'order' && /\b(?:proposed|request|motion|letter)\b/.test(text) && !/^order\b/.test(text)) return 0;
  if (!new RegExp(`\\b${term}\\b`).test(text)) return 0;
  return new RegExp(`^(?:(?:amended|final|supplemental|memorandum|opinion|and|\\d+)\\s+)*${term}\\b`).test(text) ? 3 : 1;
}

/** Only skip general legal research for an identified, factual record request. */
export function isLexaraCourtRecordLookup(plan: LexaraCourtRecordPlan): boolean {
  return Boolean(plan.lookupQuery) && /\b(?:find|retrieve|show|pull|link|summariz\w*|records?|filings?|docket|what (?:does|do|did)|who got|how much)\b/i.test(plan.objective)
    && !/\b(?:can i|should i|must i|am i|do i|my rights|legal|law|precedent|holding|hold|held|require\w*|statute|rule|deadline|appeal|challenge|enforce|sue|liable|binding|controlling)\b/i.test(plan.objective);
}

function publicCourtUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value || ''), 'https://www.courtlistener.com');
    return url.protocol === 'https:' && url.hostname === 'www.courtlistener.com'
      && /^\/(?:docket|opinion)\//.test(url.pathname) ? url.toString() : undefined;
  } catch { return undefined; }
}

/** Read existing RECAP copies only. Never purchase PACER files or refresh a paid docket. */
export async function searchLexaraCourtRecords(
  plan: LexaraCourtRecordPlan,
  signal?: AbortSignal,
): Promise<LexaraAuthoritySource[]> {
  if (!plan.lookupQuery || signal?.aborted) return [];
  const results = await courtJson('search/?' + new URLSearchParams({ q: plan.lookupQuery, type: 'r', order_by: 'score desc' }), signal);
  const candidates = (Array.isArray(results?.results) ? results.results : []).slice(0, 4);
  const sources: LexaraAuthoritySource[] = [];
  const matchedDockets = new Map<string, { title: string; metadata: string }>();
  const documentCandidates: Array<{ id: number; url: string; title: string; metadata: string; description: string }> = [];
  for (const item of candidates) {
    if (plan.docketNumber && !sameLexaraDocket(plan.docketNumber, cleanText(item.docketNumber))) continue;
    const url = publicCourtUrl(item.docket_absolute_url || item.absolute_url);
    if (!url) continue;
    const metadata = [item.court && `Court: ${cleanText(item.court)}`, item.docketNumber && `Case number: ${cleanText(item.docketNumber)}`,
      item.dateFiled && `Filed: ${item.dateFiled}`].filter(Boolean).join('; ');
    const title = cleanText(item.caseName) || 'Federal docket';
    matchedDockets.set(new URL(url).pathname.split('/')[2], { title, metadata });
    sources.push({ title, url, kind: 'secondary', provider: 'courtlistener-recap',
      recordType: 'docket', evidenceLevel: 'metadata',
      excerpt: `${metadata}. Candidate case: match the court and parties to the user's matter before attributing it. This is docket metadata, not the contents of a filing.` });
    for (const doc of Array.isArray(item.recap_documents) ? item.recap_documents : []) {
      const docUrl = publicCourtUrl(doc.absolute_url);
      const id = Number(doc.id || doc.recap_document_id);
      if (docUrl && new URL(docUrl).pathname.split('/')[2] === new URL(url).pathname.split('/')[2]
        && Number.isSafeInteger(id) && id > 0) documentCandidates.push({ id, url: docUrl,
        title: `${title}: ${cleanText(doc.short_description || doc.description) || 'filing'}`, metadata,
        description: filingDescription(doc) });
    }
  }
  // Search within the identified case for issue-relevant filings, beyond the
  // three documents nested in each docket search result.
  if (matchedDockets.size && !signal?.aborted) {
    // A stable case/document query can be reused on follow-ups. Description
    // fields find the filing type instead of every document quoting that word.
    const terms = [...new Set([...documentTerms(plan.objective), ...documentTerms(plan.neededDocuments.join(' '))])].slice(0, 8).sort();
    const descriptions = terms.map(term => {
      const value = term.includes(' ') ? quoted(term) : term;
      return `(short_description:${value}^${term === 'complaint' ? 8 : 2} OR description:${value})`;
    });
    const documents = await courtJson('search/?' + new URLSearchParams({ type: 'rd',
      q: `docket_id:(${[...matchedDockets.keys()].join(' OR ')}) AND (${descriptions.join(' OR ')})`, available_only: 'on', order_by: 'score desc' }), signal);
    const relevantDocuments: typeof documentCandidates = [];
    for (const doc of (Array.isArray(documents?.results) ? documents.results : []).slice(0, 20)) {
      const url = publicCourtUrl(doc.absolute_url);
      const id = Number(doc.id || doc.recap_document_id);
      const docket = url ? matchedDockets.get(new URL(url).pathname.split('/')[2]) : undefined;
      if (url && docket && Number.isSafeInteger(id) && id > 0) relevantDocuments.push({ id, url,
        title: `${docket.title}: ${cleanText(doc.short_description || doc.description) || 'filing'}`,
        description: filingDescription(doc),
        metadata: [docket.metadata, doc.entry_date_filed && `Document filed: ${cleanText(doc.entry_date_filed)}`].filter(Boolean).join('; ') });
    }
    documentCandidates.unshift(...relevantDocuments);
  }
  const unique = [...new Map(documentCandidates.map(doc => [doc.id, doc])).values()];
  const requested = documentTerms(plan.objective);
  const priorities = requested.length ? requested : documentTerms(plan.neededDocuments.join(' '));
  const documents: typeof documentCandidates = [];
  for (const term of priorities) {
    const best = unique.filter(doc => !documents.some(selected => selected.id === doc.id))
      .sort((a, b) => filingScore(b.description, term) - filingScore(a.description, term))[0];
    if (best && filingScore(best.description, term) > 0) documents.push(best);
    if (documents.length >= MAX_DOCUMENTS) break;
  }
  // Explicit requests should not spend a third read on an unrelated filing.
  const remaining = unique.filter(doc => !documents.some(selected => selected.id === doc.id)
    && (!requested.length || priorities.some(term => filingScore(doc.description, term) > 0)));
  documents.push(...remaining.slice(0, MAX_DOCUMENTS - documents.length));
  const extracted = await Promise.all(documents.map(async doc => {
    const record = await courtJson(`recap-documents/${doc.id}/`, signal);
    if (publicCourtUrl(record?.absolute_url) !== doc.url) return null;
    const content = cleanText(record?.plain_text);
    if (!content || record?.is_available === false) return null;
    return { title: doc.title, url: doc.url, kind: 'secondary' as const, provider: 'courtlistener-recap-document',
      recordType: 'filing' as const, evidenceLevel: 'document' as const,
      excerpt: `${doc.metadata}\nRetrieved filing text (bounded extract): ${courtRecordExcerpt(content, plan)}` };
  }));
  const filings = extracted.filter((item): item is NonNullable<typeof item> => Boolean(item));
  console.info('[LEXARA CourtRecords]', { candidateCount: candidates.length, docketCount: sources.length, filingCount: filings.length,
    identifiedCase: Boolean(plan.lookupQuery), paidFetches: 0 });
  return [...filings, ...sources];
}

/** Preserve the opening identification and issue-relevant passages later in the file. */
export function courtRecordExcerpt(content: string, plan: LexaraCourtRecordPlan): string {
  if (content.length <= 3000) return content;
  const terms = [...new Set((plan.objective + ' ' + plan.neededDocuments.join(' ')).toLowerCase()
    .match(/[a-z]{5,}/g) || [])].filter(word => !['court', 'records', 'please', 'about', 'which'].includes(word));
  const passages: string[] = [content.slice(0, 900)];
  const lower = content.toLowerCase();
  let remaining = 2000;
  const starts = new Set<number>();
  for (const term of terms) {
    const index = lower.indexOf(term, 900);
    if (index < 0 || remaining < 200) continue;
    const start = Math.max(900, index - 200);
    if ([...starts].some(prior => Math.abs(prior - start) < 600)) continue;
    starts.add(start);
    const passage = content.slice(start, start + Math.min(800, remaining));
    passages.push(passage);
    remaining -= passage.length;
  }
  return passages.join(' [...extract gap...] ');
}

export function formatLexaraCourtRecordPlan(plan?: LexaraCourtRecordPlan): string {
  if (!plan) return '';
  return `\n\nCOURT RECORD OBJECTIVE\nDocuments potentially needed: ${plan.neededDocuments.join(', ')}.
${plan.lookupQuery ? 'Candidate records require a match on case number, court, parties, and relevant dates; names and docket numbers alone are not unique.' : 'No case identifier is established. Give useful legal guidance, then ask for the court/state and case number or party names if actual case filings are necessary.'}
Case law explains legal rules; a docket lists events; a filing contains allegations; an order states what the judge decided. Keep those roles separate. Search snippets and metadata are discovery leads, not proof of filing contents. Read the supplied document extract before attributing a finding. Do not infer notice, money distribution, service, or a deadline from a case title. Never describe an archived docket as current without a current record. An unavailable or empty search is not proof that no case exists. State/county online access varies and sealed records are unavailable. No PACER purchase was performed. If the needed document is missing, identify it and offer its official court/clerk route or ask the user to upload it. In the written answer link the relevant case/filing when available; in voice cite the court and document naturally without reading URLs. Do not turn general legal guidance into a background report. For a brief filing lookup, use one short sentence per distinct requested document, at most three sentences and 60 words excluding source URLs. Say what the complaint alleges or the order decides and attach that document link; if the extract omits a requested finding, say so briefly. Do not repeat duplicate filing copies, lists of remedies, procedural history, or general cautions unless requested or essential to accuracy.`;
}
