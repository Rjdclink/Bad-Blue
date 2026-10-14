import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

export type SpectraRecursiveClueKind =
  | 'email'
  | 'phone'
  | 'social-handle'
  | 'profile-url'
  | 'linked-url';

export interface SpectraRecursiveClue {
  kind: SpectraRecursiveClueKind;
  value: string;
  sourceUrl: string;
}

function clean(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function publicUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.replace(/[),.;!?]+$/g, ''));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (/\/(?:login|signin|signup|account|privacy|terms)(?:[/?#]|$)/i.test(url.pathname)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function urlKind(url: URL): SpectraRecursiveClueKind {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return /(?:facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|x\.com|twitter\.com|bsky\.app|mastodon)/i.test(host)
    ? 'profile-url'
    : 'linked-url';
}

export function extractSpectraRecursiveClues(
  records: readonly SpectraRetrievedEvidence[],
  limit = 24,
): SpectraRecursiveClue[] {
  const out: SpectraRecursiveClue[] = [];
  const seen = new Set<string>();
  const add = (kind: SpectraRecursiveClueKind, value: string, sourceUrl: string) => {
    const normalized = clean(value);
    if (!normalized) return;
    const key = `${kind}:${normalized.toLowerCase()}`;
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push({ kind, value: normalized, sourceUrl });
  };

  for (const record of records) {
    if (out.length >= limit) break;
    const text = clean([record.title, record.textExcerpt].filter(Boolean).join(' '));
    if (!text) continue;

    for (const email of text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []) {
      add('email', email.toLowerCase(), record.url);
    }

    for (const candidate of text.match(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/g) || []) {
      const digits = candidate.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) add('phone', candidate, record.url);
    }

    for (const match of text.matchAll(/(?:^|\s)@([A-Za-z0-9._-]{3,40})\b/g)) {
      add('social-handle', '@' + match[1], record.url);
    }

    for (const raw of text.match(/https?:\/\/[^\s<>"']+/gi) || []) {
      const url = publicUrl(raw);
      if (url) add(urlKind(url), url.toString(), record.url);
    }
  }

  return out;
}

export function buildSpectraRecursiveClueQueries(
  subject: string,
  records: readonly SpectraRetrievedEvidence[],
  seenClues: Set<string>,
  limit = 4,
): string[] {
  const quotedSubject = subject.trim()
    ? `"${subject.replace(/"/g, '')}"`
    : '';
  const queries: string[] = [];

  for (const clue of extractSpectraRecursiveClues(records, 32)) {
    const key = `${clue.kind}:${clue.value.toLowerCase()}`;
    if (seenClues.has(key)) continue;
    seenClues.add(key);

    const objective =
      clue.kind === 'email' ? 'profile address location public record'
      : clue.kind === 'phone' ? 'address profile public record'
      : clue.kind === 'social-handle' || clue.kind === 'profile-url'
        ? 'public profile city location'
        : 'identity location corroboration';

    queries.push([
      quotedSubject,
      `"${clue.value.replace(/"/g, '')}"`,
      objective,
    ].filter(Boolean).join(' '));

    if (queries.length >= Math.max(1, limit)) break;
  }

  return queries;
}
