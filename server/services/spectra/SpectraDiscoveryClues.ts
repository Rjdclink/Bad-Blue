import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

export interface SpectraDiscoveryClue {
  kind: 'phone' | 'email' | 'social-handle' | 'profile-url';
  value: string;
  sourceUrl: string;
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function safeProfileUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!/(?:facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|tiktok\.com|bsky\.app|mastodon\.)$/.test(host)
      && !host.endsWith('.mastodon.social')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Extract a small, auditable set of new discovery clues from source pages that
 * SPECTRA actually retrieved. Search-result snippets never enter this function.
 */
export function extractSpectraDiscoveryClues(
  records: readonly SpectraRetrievedEvidence[],
  limit = 16,
): SpectraDiscoveryClue[] {
  const out: SpectraDiscoveryClue[] = [];
  const seen = new Set<string>();

  const add = (clue: SpectraDiscoveryClue) => {
    const key = `${clue.kind}:${clue.value.toLowerCase()}`;
    if (!seen.has(key) && out.length < limit) {
      seen.add(key);
      out.push(clue);
    }
  };

  for (const record of records) {
    if (out.length >= limit) break;
    const text = normalized([record.title, record.textExcerpt].filter(Boolean).join(' '));
    if (!text) continue;

    for (const email of text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []) {
      add({ kind: 'email', value: email.toLowerCase(), sourceUrl: record.url });
    }

    for (const candidate of text.match(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,15}/g) || []) {
      const digits = candidate.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      add({ kind: 'phone', value: candidate.trim(), sourceUrl: record.url });
    }

    for (const raw of text.match(/https?:\/\/[^\s<>()"']+/gi) || []) {
      const url = safeProfileUrl(raw.replace(/[.,;:!?]+$/g, ''));
      if (url) add({ kind: 'profile-url', value: url, sourceUrl: record.url });
    }

    for (const match of text.matchAll(/(?:^|\s)@([A-Za-z0-9._-]{3,40})\b/g)) {
      add({ kind: 'social-handle', value: '@' + match[1], sourceUrl: record.url });
    }
  }
  return out;
}

export function buildSpectraClueExpansionQueries(
  subject: string,
  records: readonly SpectraRetrievedEvidence[],
  seenClues: Set<string>,
  limit = 4,
): string[] {
  const queries: string[] = [];
  for (const clue of extractSpectraDiscoveryClues(records, 24)) {
    const key = `${clue.kind}:${clue.value.toLowerCase()}`;
    if (seenClues.has(key)) continue;
    seenClues.add(key);
    const quotedSubject = subject.trim() ? `"${subject.replace(/"/g, '')}"` : '';
    const suffix = clue.kind === 'profile-url' || clue.kind === 'social-handle'
      ? 'profile location city'
      : clue.kind === 'email'
        ? 'profile address location'
        : 'address profile location';
    queries.push([quotedSubject, `"${clue.value.replace(/"/g, '')}"`, suffix].filter(Boolean).join(' '));
    if (queries.length >= Math.max(1, limit)) break;
  }
  return queries;
}
