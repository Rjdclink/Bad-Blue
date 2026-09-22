import crypto from 'node:crypto';
import {
  isPantheonCapabilitySourceCompatible,
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  PANTHEON_PORTABLE_CAPABILITY_IDS,
  type PantheonExecutableSource,
  type PantheonPortableCapabilityId,
} from './PantheonCrawlerCapabilityMatrix';

export interface PantheonPortableCapabilityAudit {
  crawler: PantheonPortableCapabilityId;
  capabilityClass: 'pantheon-secondary';
  status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
  evidenceCount: number;
  attempts: number;
  targets: number;
  durationMs: number;
  sourceOutcomes: Array<{
    sourceUrl: string;
    status: 'completed_with_evidence' | 'completed_no_evidence' | 'failed' | 'timed_out';
    retrievedAt: string;
    durationMs: number;
    error?: string;
  }>;
  executionMode: 'credential-free-equivalent';
  replacementDisclosure: string;
  capabilityOutput?: {
    kind: string;
    contentHash: string;
    subjectTokenMatches: number;
    capabilitySignalMatches: number;
    discoveredLinkCount: number;
    extractedFieldCount: number;
    sourceCompatible: boolean;
  };
  error?: string;
}

const CAPABILITY_PATTERNS: Partial<Record<PantheonPortableCapabilityId, RegExp>> = {
  key: /(?:name|identity|born|resident|address|phone|email|license)/gi,
  chewer: /(?:table|record|case|docket|filing|profile|entry|document)/gi,
  computational: /(?:date|year|number|status|type|category|jurisdiction)/gi,
  usc: /(?:official|government|court|agency|department|public|source)/gi,
  woo: /(?:associate|relationship|family|member|officer|director|owner|employer)/gi,
  silence: /(?:unknown|unavailable|not found|no record|missing|redacted)/gi,
  'instant-legal': /(?:court|case|citation|statute|regulation|opinion|docket)/gi,
  'adaptive-legal': /(?:plaintiff|defendant|judge|claim|order|judgment|appeal)/gi,
  'legal-crawler': /(?:u\.s\.c\.|c\.f\.r\.|law|court|opinion|docket|filing)/gi,
  beneficial: /(?:beneficial|owner|ownership|affiliate|director|officer|company)/gi,
  'public-record': /(?:public record|record number|filed|registered|issued|effective)/gi,
  pacer: /(?:federal|district|bankruptcy|docket|recap|courtlistener|case)/gi,
  'state-court': /(?:state court|supreme court|court of appeals|docket|case)/gi,
  'county-court': /(?:county|clerk|court|docket|case)/gi,
  'warrant-database': /(?:warrant|wanted|fugitive|agency|case number)/gi,
  'sex-offender-registry': /(?:offender|registry|registration|jurisdiction)/gi,
  'fast-people-search': /(?:name|address|phone|email|resident)/gi,
  'true-people-search': /(?:identity|name|location|associate|relative)/gi,
  whitepages: /(?:phone|telephone|address|contact|directory)/gi,
  'social-media-scraper': /(?:profile|username|handle|social|linkedin|facebook|instagram|tiktok|x\.com)/gi,
  firecrawl: /(?:title|heading|paragraph|article|main|section|link)/gi,
  'openrouter-web-search': /(?:search|result|title|snippet|link|source)/gi,
  spiderfoot: /(?:domain|email|username|account|profile|organization|location)/gi,
  puppeteer: /(?:html|body|main|article|title|link|form)/gi,
  apify: /(?:item|record|result|dataset|page|source)/gi,
  'crawl4ai-pattern': /(?:entity|record|relationship|date|location|organization|person)/gi,
};

function plainText(content: string): string {
  return String(content || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250_000);
}

function links(content: string, sourceUrl: string): string[] {
  const values = new Set<string>();
  const pattern = /(?:href|src)\s*=\s*["']([^"'#]+)["']/gi;
  for (const match of String(content || '').matchAll(pattern)) {
    try {
      const url = new URL(match[1], sourceUrl);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !values.has(url.toString())) {
        values.add(url.toString());
      }
    } catch {
      // A malformed page link is an extraction miss, not executable work.
    }
    if (values.size >= 100) break;
  }
  return [...values];
}

function countMatches(value: string, pattern: RegExp | undefined): number {
  if (!pattern) return 0;
  pattern.lastIndex = 0;
  return Math.min(250, [...value.matchAll(pattern)].length);
}

function capabilityKind(capabilityId: PantheonPortableCapabilityId): string {
  if (capabilityId.startsWith('seed-') || capabilityId === 'social-media-scraper' || capabilityId === 'openrouter-web-search') {
    return 'link-discovery';
  }
  if (['mirror', 'usc'].includes(capabilityId)) return 'provenance-verification';
  if (capabilityId === 'silence') return 'coverage-gap-analysis';
  return 'structured-live-source-analysis';
}

/**
 * Executes production-safe equivalents for capabilities whose original adapter
 * needs a paid key, an account, or a separately hosted service.  Every outcome
 * is derived from content obtained by the canonical live acquisition gateway;
 * no generated, synthetic, or placeholder material is accepted as evidence.
 */
export async function runPortablePantheonCapabilities(input: {
  capabilityIds: readonly string[];
  sourceUrl: string;
  content: string;
  subject: string;
  location?: string;
  discoveredCandidates?: readonly unknown[];
  sourceContext?: Omit<PantheonExecutableSource, 'sourceUrl'>;
  signal?: AbortSignal;
}): Promise<PantheonPortableCapabilityAudit[]> {
  const requested = [...new Set(input.capabilityIds)]
    .filter((id): id is PantheonPortableCapabilityId =>
      (PANTHEON_PORTABLE_CAPABILITY_IDS as readonly string[]).includes(id));
  if (!requested.length) return [];

  const text = plainText(input.content);
  const discovered = [...new Set([
    ...links(input.content, input.sourceUrl),
    ...(input.discoveredCandidates || []).flatMap(value => {
      try {
        const url = new URL(String(value || ''), input.sourceUrl);
        return (url.protocol === 'http:' || url.protocol === 'https:') ? [url.toString()] : [];
      } catch {
        return [];
      }
    }),
  ])].slice(0, 100);
  const normalizedSubject = String(input.subject || '').toLowerCase().replace(/[^a-z0-9@.+-]+/g, ' ').trim();
  const subjectTokens = normalizedSubject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2);

  return requested.map(capabilityId => {
    const startedAt = Date.now();
    const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId];
    const sourceCompatible = !input.sourceContext || isPantheonCapabilitySourceCompatible(capabilityId, {
      sourceUrl: input.sourceUrl,
      ...input.sourceContext,
    });
    if (!sourceCompatible) {
      const durationMs = Date.now() - startedAt;
      const error = 'Source-skill admission rejected this capability for the supplied URL';
      return {
        crawler: capabilityId,
        capabilityClass: 'pantheon-secondary' as const,
        status: 'failed' as const,
        evidenceCount: 0,
        attempts: 1,
        targets: 1,
        durationMs,
        sourceOutcomes: [{
          sourceUrl: input.sourceUrl,
          status: 'failed' as const,
          retrievedAt: new Date().toISOString(),
          durationMs,
          error,
        }],
        executionMode: 'credential-free-equivalent' as const,
        replacementDisclosure: descriptor.replacementDisclosure || 'Credential-free local equivalent.',
        error,
      };
    }
    if (input.signal?.aborted) {
      const durationMs = Date.now() - startedAt;
      return {
        crawler: capabilityId,
        capabilityClass: 'pantheon-secondary' as const,
        status: 'timed_out' as const,
        evidenceCount: 0,
        attempts: 1,
        targets: 1,
        durationMs,
        sourceOutcomes: [{
          sourceUrl: input.sourceUrl,
          status: 'timed_out' as const,
          retrievedAt: new Date().toISOString(),
          durationMs,
          error: 'Capability deadline was cancelled',
        }],
        executionMode: 'credential-free-equivalent' as const,
        replacementDisclosure: descriptor.replacementDisclosure || 'Credential-free local equivalent.',
        error: 'Capability deadline was cancelled',
      };
    }

    if (!text) {
      const durationMs = Date.now() - startedAt;
      return {
        crawler: capabilityId,
        capabilityClass: 'pantheon-secondary' as const,
        status: 'failed' as const,
        evidenceCount: 0,
        attempts: 1,
        targets: 1,
        durationMs,
        sourceOutcomes: [{
          sourceUrl: input.sourceUrl,
          status: 'failed' as const,
          retrievedAt: new Date().toISOString(),
          durationMs,
          error: 'Canonical acquisition returned no analyzable live content',
        }],
        executionMode: 'credential-free-equivalent' as const,
        replacementDisclosure: descriptor.replacementDisclosure || 'Credential-free local equivalent.',
        error: 'Canonical acquisition returned no analyzable live content',
      };
    }

    const lowered = text.toLowerCase();
    const subjectTokenMatches = subjectTokens.filter(token => lowered.includes(token)).length;
    const subjectDigits = normalizedSubject.replace(/\D/g, '');
    const exactIdentifier = normalizedSubject.includes('@')
      ? lowered.includes(normalizedSubject)
      : subjectDigits.length >= 7
        ? lowered.replace(/\D/g, '').includes(subjectDigits)
        : false;
    const subjectMatched = exactIdentifier || (subjectTokens.length >= 2
      ? lowered.includes(subjectTokens.join(' '))
        || (lowered.includes(subjectTokens[0]) && lowered.includes(subjectTokens[subjectTokens.length - 1]))
      : subjectTokens.length === 1 && new RegExp(`\\b${subjectTokens[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    const capabilitySignalMatches = countMatches(text, CAPABILITY_PATTERNS[capabilityId]);
    const extractedFieldCount = new Set(
      (text.match(/\b(?:case|docket|license|record|filing|address|phone|email|date|name|status|agency|court)\b/gi) || [])
        .map(value => value.toLowerCase()),
    ).size;
    const kind = capabilityKind(capabilityId);
    const hasAttributableOutput = subjectMatched && (
      capabilitySignalMatches > 0
      || (kind === 'link-discovery' && discovered.length > 0)
      || ['mirror', 'usc', 'silence'].includes(capabilityId)
    );
    const durationMs = Date.now() - startedAt;
    const status = hasAttributableOutput ? 'completed_with_evidence' as const : 'completed_no_evidence' as const;
    return {
      crawler: capabilityId,
      capabilityClass: 'pantheon-secondary' as const,
      status,
      evidenceCount: hasAttributableOutput ? 1 : 0,
      attempts: 1,
      targets: 1,
      durationMs,
      sourceOutcomes: [{
        sourceUrl: input.sourceUrl,
        status,
        retrievedAt: new Date().toISOString(),
        durationMs,
      }],
      executionMode: 'credential-free-equivalent' as const,
      replacementDisclosure: descriptor.replacementDisclosure || 'Credential-free local equivalent.',
      capabilityOutput: {
        kind,
        contentHash: crypto.createHash('sha256').update(text).digest('hex'),
        subjectTokenMatches,
        capabilitySignalMatches,
        discoveredLinkCount: discovered.length,
        extractedFieldCount,
        sourceCompatible,
      },
    };
  });
}
