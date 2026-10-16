import * as cheerio from 'cheerio';
import { lexaraCourtListenerJson } from './LexaraCourtListenerClient';

export type CitationVerificationStatus = 'verified' | 'unresolved' | 'unavailable';

export interface CitationVerification {
  citation: string;
  status: CitationVerificationStatus;
  sourceUrl?: string;
  caseTitle?: string;
  possibleNegativeTreatment: boolean;
  /** Whether a later-court-treatment search returned readable results; not a good-law guarantee. */
  treatmentChecked?: boolean;
  negativeTreatmentEvidence?: string;
}

const REPORTER_SLUGS: Record<string, string> = {
  'u.s.': 'us',
  's.ct.': 's-ct',
  'l.ed.': 'l-ed',
  'l.ed.2d': 'l-ed-2d',
  'f.': 'f',
  'f.2d': 'f2d',
  'f.3d': 'f3d',
  'f.4th': 'f4th',
  'f.supp.': 'f-supp',
  'f.supp.2d': 'f-supp-2d',
  'f.supp.3d': 'f-supp-3d',
  'a.': 'a',
  'a.2d': 'a2d',
  'a.3d': 'a3d',
  'n.e.': 'ne',
  'n.e.2d': 'ne2d',
  'n.e.3d': 'ne3d',
  'n.w.': 'nw',
  'n.w.2d': 'nw2d',
  'n.w.3d': 'nw3d',
  'p.': 'p',
  'p.2d': 'p2d',
  'p.3d': 'p3d',
  's.e.': 'se',
  's.e.2d': 'se2d',
  's.w.': 'sw',
  's.w.2d': 'sw2d',
  's.w.3d': 'sw3d',
  'so.': 'so',
  'so.2d': 'so2d',
  'so.3d': 'so3d',
  'cal.rptr.': 'cal-rptr',
  'cal.rptr.2d': 'cal-rptr-2d',
  'cal.rptr.3d': 'cal-rptr-3d',
};

const REPORTER_PATTERN = [
  'U\\.?\\s*S\\.?',
  'S\\.?\\s*Ct\\.?',
  'L\\.?\\s*Ed\\.?\\s*2d',
  'L\\.?\\s*Ed\\.?',
  'F\\.?\\s*Supp\\.?\\s*3d',
  'F\\.?\\s*Supp\\.?\\s*2d',
  'F\\.?\\s*Supp\\.?',
  'F\\.?\\s*4th',
  'F\\.?\\s*3d',
  'F\\.?\\s*2d',
  'F\\.?',
  'A\\.?\\s*3d',
  'A\\.?\\s*2d',
  'A\\.?',
  'N\\.?\\s*E\\.?\\s*3d',
  'N\\.?\\s*E\\.?\\s*2d',
  'N\\.?\\s*E\\.?',
  'N\\.?\\s*W\\.?\\s*3d',
  'N\\.?\\s*W\\.?\\s*2d',
  'N\\.?\\s*W\\.?',
  'P\\.?\\s*3d',
  'P\\.?\\s*2d',
  'P\\.?',
  'S\\.?\\s*E\\.?\\s*2d',
  'S\\.?\\s*E\\.?',
  'S\\.?\\s*W\\.?\\s*3d',
  'S\\.?\\s*W\\.?\\s*2d',
  'S\\.?\\s*W\\.?',
  'So\\.?\\s*3d',
  'So\\.?\\s*2d',
  'So\\.?',
  'Cal\\.?\\s*Rptr\\.?\\s*3d',
  'Cal\\.?\\s*Rptr\\.?\\s*2d',
  'Cal\\.?\\s*Rptr\\.?',
].join('|');

const CASE_CITATION_RE = new RegExp(
  `\\b(\\d{1,4})\\s+(${REPORTER_PATTERN})\\s+(\\d{1,6})\\b`,
  'gi',
);

function normalizeReporter(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizedCitation(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\.\s+/g, '.').trim();
}

export function extractCaseCitations(text: string): Array<{ citation: string; volume: string; reporter: string; page: string }> {
  const found: Array<{ citation: string; volume: string; reporter: string; page: string }> = [];
  const seen = new Set<string>();
  CASE_CITATION_RE.lastIndex = 0;
  for (let match = CASE_CITATION_RE.exec(text); match; match = CASE_CITATION_RE.exec(text)) {
    const volume = match[1];
    const reporter = normalizedCitation(match[2]);
    const page = match[3];
    const citation = `${volume} ${reporter} ${page}`;
    const key = citation.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ citation, volume, reporter, page });
    if (found.length >= 20) break;
  }
  return found;
}

interface CitationSourcePage {
  ok: boolean;
  status: number;
  url: string;
  html: string;
}

async function fetchWithTimeout(url: string, timeoutMs = 2_500): Promise<CitationSourcePage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'LegalWhat-Lexara-CitationVerifier/1.0 (+https://legalwhat.com)',
      },
    });
    // The timeout includes downloading the body, not merely response headers.
    const html = response.ok ? await response.text() : '';
    if (controller.signal.aborted) return null;
    return { ok: response.ok, status: response.status, url: response.url, html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function titleFromHtml(html: string): string | undefined {
  try {
    const $ = cheerio.load(html);
    const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
    if (heading && heading.length <= 240) return heading;
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    return title ? title.replace(/\s*[–—-]\s*CourtListener.*$/i, '').slice(0, 240) : undefined;
  } catch {
    return undefined;
  }
}

async function possibleNegativeTreatment(citation: string): Promise<{ found: boolean; checked: boolean; evidence?: string }> {
  const q = `"${citation}" AND (overruled OR abrogated OR superseded OR vacated)`;
  const url = `https://www.courtlistener.com/?type=o&q=${encodeURIComponent(q)}`;
  // Use the existing authenticated CourtListener search when available.
  // The public HTML search sometimes rejects Railway with HTTP 403.
  const [api, response] = await Promise.all([
    lexaraCourtListenerJson('search/?' + new URLSearchParams({ q, type: 'o' }).toString()),
    fetchWithTimeout(url, 2_500),
  ]);
  // Treat API snippets as possible signals, never conclusive good-law status.
  const apiResults = Array.isArray(api?.results) ? api.results : null;
  const resultTexts: string[] = (apiResults || []).slice(0, 20).map((item: any) =>
    [item.caseName, item.snippet, ...(Array.isArray(item.opinions)
      ? item.opinions.map((opinion: any) => opinion.snippet) : [])]
      .filter(Boolean).join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  ).filter(Boolean);
  if (response?.ok && response.html) {
    const $ = cheerio.load(response.html);
    // Never scan the query itself: it contains the negative-treatment words.
    $('a[href*="/opinion/"]').each((_index, element) => {
      const anchor = $(element);
      const container = anchor.closest('article, li, .search-result, .v-offset-below-2').first();
      const text = (container.length ? container.text() : anchor.parent().text())
        .replace(/\s+/g, ' ').trim();
      if (text) resultTexts.push(text);
    });
  }
  if (!apiResults && !(response?.ok && response.html)) return { found: false, checked: false };
  for (const text of resultTexts.slice(0, 20)) {
    const match = text.match(/.{0,110}\b(overruled|abrogated|superseded|vacated)\b.{0,170}/i);
    if (match) return { found: true, checked: true, evidence: match[0].trim().slice(0, 320) };
  }
  return { found: false, checked: true };
}

async function verifyOneCitation(item: ReturnType<typeof extractCaseCitations>[number]): Promise<CitationVerification> {
  const slug = REPORTER_SLUGS[normalizeReporter(item.reporter)];
  if (!slug) {
    return { citation: item.citation, status: 'unresolved', possibleNegativeTreatment: false, treatmentChecked: false };
  }

  const lookupUrl = `https://www.courtlistener.com/c/${slug}/${item.volume}/${item.page}/`;
  const [response, treatment, lookup] = await Promise.all([
    fetchWithTimeout(lookupUrl),
    possibleNegativeTreatment(item.citation),
    lexaraCourtListenerJson('search/?' + new URLSearchParams({ q: item.citation, type: 'o' }).toString()),
  ]);
  // Match exact reporter citations in CourtListener's authenticated case
  // metadata. Search-result rank or URL resemblance alone is not verification.
  const citationKey = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = (Array.isArray(lookup?.results) ? lookup.results : []).find((row: any) =>
    (Array.isArray(row.citation) ? row.citation : [row.citation])
      .some((value: unknown) => citationKey(value) === citationKey(item.citation)));
  if (matched) {
    const path = String(matched.absolute_url || '');
    return {
      citation: item.citation,
      status: 'verified',
      sourceUrl: /^\/opinion\/\d+\//.test(path) ? 'https://www.courtlistener.com' + path : lookupUrl,
      caseTitle: String(matched.caseName || matched.case_name || '').slice(0, 240) || undefined,
      possibleNegativeTreatment: treatment.found,
      treatmentChecked: treatment.checked,
      negativeTreatmentEvidence: treatment.evidence,
    };
  }
  if (!response) {
    return {
      citation: item.citation,
      status: 'unavailable',
      possibleNegativeTreatment: treatment.found,
      treatmentChecked: treatment.checked,
      negativeTreatmentEvidence: treatment.evidence,
    };
  }
  if (!response.ok) {
    const unavailable = response.status === 403 || response.status === 429 || response.status >= 500;
    return {
      citation: item.citation,
      status: unavailable ? 'unavailable' : 'unresolved',
      possibleNegativeTreatment: treatment.found,
      treatmentChecked: treatment.checked,
      negativeTreatmentEvidence: treatment.evidence,
    };
  }

  const html = response.html;
  const normalizedBody = html.replace(/\s+/g, ' ').toLowerCase();
  const citationPresent = normalizedBody.includes(item.citation.toLowerCase());
  if (!citationPresent) {
    return { citation: item.citation, status: 'unresolved', possibleNegativeTreatment: treatment.found,
      treatmentChecked: treatment.checked, negativeTreatmentEvidence: treatment.evidence };
  }

  return {
    citation: item.citation,
    status: 'verified',
    sourceUrl: response.url || lookupUrl,
    caseTitle: titleFromHtml(html),
    possibleNegativeTreatment: treatment.found,
    treatmentChecked: treatment.checked,
    negativeTreatmentEvidence: treatment.evidence,
  };
}

export async function verifyLegalCitationsInText(text: string, maxCitations = 8): Promise<CitationVerification[]> {
  const limit = Math.max(1, Math.min(20, Math.trunc(maxCitations) || 8));
  const citations = extractCaseCitations(text).slice(0, limit);
  if (!citations.length) return [];

  const results = new Array<CitationVerification>(citations.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < citations.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await verifyOneCitation(citations[index]);
    }
  };
  const concurrency = Math.min(8, citations.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export function formatCitationVerificationForCorrection(results: CitationVerification[]): string {
  if (!results.length) return '';
  return results.map(result => {
    const status = result.status === 'verified'
      ? 'VERIFIED'
      : result.status === 'unavailable'
        ? 'VERIFICATION SOURCE UNAVAILABLE'
        : 'UNRESOLVED';
    const treatment = result.possibleNegativeTreatment
      ? `; POSSIBLE NEGATIVE TREATMENT SIGNAL: ${result.negativeTreatmentEvidence || 'CourtListener search surfaced a negative-treatment term; verify before relying on the case'}`
      : result.treatmentChecked === true
        ? '; LIMITED LATER-TREATMENT SEARCH FOUND NO SIGNAL; continued precedential validity is NOT established'
        : '; LATER-COURT TREATMENT UNVERIFIED; do not describe the case as still binding or not overruled';
    const title = result.caseTitle ? `; case/source title: ${result.caseTitle}` : '';
    const source = result.sourceUrl ? `; verification source: ${result.sourceUrl}` : '';
    return `- ${result.citation}: ${status}${title}${source}${treatment}`;
  }).join('\n');
}
