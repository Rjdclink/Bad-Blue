import * as cheerio from 'cheerio';

export type CitationVerificationStatus = 'verified' | 'unresolved';

export interface CitationVerification {
  citation: string;
  status: CitationVerificationStatus;
  sourceUrl?: string;
  caseTitle?: string;
  possibleNegativeTreatment: boolean;
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

async function fetchWithTimeout(url: string, timeoutMs = 4_000): Promise<Response | null> {
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
    return response;
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

async function possibleNegativeTreatment(citation: string): Promise<{ found: boolean; evidence?: string }> {
  const q = `"${citation}" AND (overruled OR abrogated OR superseded OR vacated)`;
  const url = `https://www.courtlistener.com/?type=o&q=${encodeURIComponent(q)}`;
  const response = await fetchWithTimeout(url, 3_500);
  if (!response?.ok) return { found: false };
  const html = await response.text().catch(() => '');
  if (!html) return { found: false };
  const $ = cheerio.load(html);
  const text = $('main').text().replace(/\s+/g, ' ').trim();
  const match = text.match(/.{0,110}\b(overruled|abrogated|superseded|vacated)\b.{0,170}/i);
  return match
    ? { found: true, evidence: match[0].trim().slice(0, 320) }
    : { found: false };
}

async function verifyOneCitation(item: ReturnType<typeof extractCaseCitations>[number]): Promise<CitationVerification> {
  const slug = REPORTER_SLUGS[normalizeReporter(item.reporter)];
  if (!slug) {
    return { citation: item.citation, status: 'unresolved', possibleNegativeTreatment: false };
  }

  const lookupUrl = `https://www.courtlistener.com/c/${slug}/${item.volume}/${item.page}/`;
  const [response, treatment] = await Promise.all([
    fetchWithTimeout(lookupUrl),
    possibleNegativeTreatment(item.citation),
  ]);
  if (!response?.ok) {
    return {
      citation: item.citation,
      status: 'unresolved',
      possibleNegativeTreatment: treatment.found,
      negativeTreatmentEvidence: treatment.evidence,
    };
  }

  const html = await response.text().catch(() => '');
  const normalizedBody = html.replace(/\s+/g, ' ').toLowerCase();
  const citationPresent = normalizedBody.includes(item.citation.toLowerCase())
    || response.url.includes('/opinion/')
    || response.url.includes(`/c/${slug}/${item.volume}/${item.page}/`);
  if (!citationPresent) {
    return { citation: item.citation, status: 'unresolved', possibleNegativeTreatment: false };
  }

  return {
    citation: item.citation,
    status: 'verified',
    sourceUrl: response.url || lookupUrl,
    caseTitle: titleFromHtml(html),
    possibleNegativeTreatment: treatment.found,
    negativeTreatmentEvidence: treatment.evidence,
  };
}

export async function verifyLegalCitationsInText(text: string): Promise<CitationVerification[]> {
  const citations = extractCaseCitations(text).slice(0, 8);
  if (!citations.length) return [];
  return Promise.all(citations.map(citation => verifyOneCitation(citation)));
}

export function formatCitationVerificationForCorrection(results: CitationVerification[]): string {
  if (!results.length) return '';
  return results.map(result => {
    const status = result.status === 'verified' ? 'VERIFIED' : 'UNRESOLVED';
    const treatment = result.possibleNegativeTreatment
      ? `; POSSIBLE NEGATIVE TREATMENT SIGNAL: ${result.negativeTreatmentEvidence || 'CourtListener search surfaced a negative-treatment term; verify before relying on the case'}`
      : '';
    const title = result.caseTitle ? `; case/source title: ${result.caseTitle}` : '';
    const source = result.sourceUrl ? `; verification source: ${result.sourceUrl}` : '';
    return `- ${result.citation}: ${status}${title}${source}${treatment}`;
  }).join('\n');
}
