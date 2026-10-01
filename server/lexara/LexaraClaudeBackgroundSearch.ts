import { callClaudeWebSearch } from '../claude';
import type { LegalMeshCandidate } from './LegalProviderMesh';
import type { LexaraBackgroundSubject } from './LexaraBackgroundSubject';
import type { LexaraResearchDecision } from './LexaraResearchIntentRouter';

export interface LexaraClaudeCitationEvidence {
  url: string;
  content: string;
  retrievedAt: string;
}

export interface LexaraClaudeBackgroundSearchResult {
  candidates: LegalMeshCandidate[];
  citationEvidence: LexaraClaudeCitationEvidence[];
  searches: number;
}

/**
 * Claude runs beside Lexara's native discovery lanes as an independent web
 * research lane. Its prose is internal only; user-facing answers still come
 * from Lexara after evidence scoring and synthesis.
 */
export async function searchLexaraBackgroundWithClaude(input: {
  prompt: string;
  subject?: LexaraBackgroundSubject | null;
  decision: LexaraResearchDecision;
  jurisdiction?: string;
  signal?: AbortSignal;
}): Promise<LexaraClaudeBackgroundSearchResult> {
  const subjectName = input.subject?.name || input.decision.subject || '';
  const location = input.jurisdiction || input.subject?.location || '';
  const requestedFact = input.decision.requestedFact === 'none'
    ? 'the exact external fact requested by the user'
    : input.decision.requestedFact.replace(/-/g, ' ');

  const prompt = [
    'Use web search now as an independent background-research lane.',
    'Research only the exact factual objective below. Search broadly enough to find the requested fact if it is publicly available, and prefer current or official sources when the fact is current or record-based.',
    'Corroborate with more than one independent source when practical. Do not invent facts, and do not treat absence from one source as proof of absence.',
    'Do not produce a biography or unrelated background. Your final text is internal research notes and must stay narrowly focused on the requested fact.',
    subjectName ? `Subject: ${subjectName}` : '',
    location ? `Location/jurisdiction context: ${location}` : '',
    `Requested fact: ${requestedFact}`,
    `Research objective: ${input.decision.objective || input.prompt}`,
    `Original user wording: ${input.prompt}`,
  ].filter(Boolean).join('\n');

  try {
    const result = await callClaudeWebSearch(prompt, {
      maxTokens: 1024,
      maxUses: 4,
      signal: input.signal,
      systemPrompt: [
        'You are an internal public-web background researcher for Lexara.',
        'Always use the provided web search tool for this task instead of relying on model memory.',
        'Stay tightly scoped to the requested fact. Prefer reliable sources and preserve uncertainty.',
        'Do not reveal unrelated personal information merely because you encounter it.',
      ].join(' '),
    });

    const now = new Date().toISOString();
    const candidates: LegalMeshCandidate[] = [];
    const citationEvidence: LexaraClaudeCitationEvidence[] = [];
    const seen = new Set<string>();

    for (const source of result.sources) {
      const url = String(source.url || '').trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      candidates.push({
        url,
        title: source.title || 'Claude web-search result',
        excerpt: source.citedText?.slice(0, 1200),
        tier: 3,
        provider: 'claude-web-search',
      });
      if (source.citedText?.trim()) {
        citationEvidence.push({
          url,
          content: [source.title, source.citedText].filter(Boolean).join('\n').trim(),
          retrievedAt: now,
        });
      }
    }

    return {
      candidates,
      citationEvidence,
      searches: result.searches,
    };
  } catch (error) {
    console.warn('[LEXARA Background] Claude parallel web-search lane unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { candidates: [], citationEvidence: [], searches: 0 };
  }
}
