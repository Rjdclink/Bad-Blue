import { AICollaborationOrchestrator } from '../aiCollaborationOrchestrator';
import { getConfiguredHarmonyProviders } from '../aiHarmonyModelRegistry';
import { UsageContext } from '../aiTokenGovernor';
import { TaskComplexity, TaskPriority } from '../aiModelSelector';

export interface LexaraResearchPlan {
  queries: string[];
  providers: string[];
}

function queriesFromAnswer(answer: string, original: string): string[] {
  return [...new Set(answer.split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter(line => line.length >= 8 && line.length <= 220
      && !/^https?:/i.test(line)
      && line.toLowerCase() !== original.toLowerCase()))].slice(0, 4);
}

/**
 * Fallback-only query planning. Claude leads/synthesizes while Gemini and xAI
 * contribute redundant independent approaches. Suggested queries are never
 * evidence; the Lexara search mesh must still retrieve and verify sources.
 */
export async function planLexaraResearchQueries(
  query: string,
  context: {
    subject?: string;
    requestedFact?: string;
    jurisdiction?: string;
    signal?: AbortSignal;
  } = {},
): Promise<LexaraResearchPlan> {
  const providers=getConfiguredHarmonyProviders('legalwhat');
  if(!providers.length || context.signal?.aborted) return {queries:[],providers:[]};
  const prompt=[
    'Generate up to four distinct, short public-record/search queries for this unresolved research objective.',
    'Preserve the subject, requested fact, and jurisdiction. Prefer official registries and government sources.',
    'Do not state or invent a finding. Output only one search query per line.',
    context.subject ? `Subject: ${context.subject}` : '',
    context.requestedFact ? `Requested fact: ${context.requestedFact}` : '',
    context.jurisdiction ? `Jurisdiction: ${context.jurisdiction}` : '',
    `Objective: ${query.slice(0,900)}`,
  ].filter(Boolean).join('\n');

  try{
    const result=await AICollaborationOrchestrator.orchestrateCollaboration(
      'lexara-research-query-planning',
      prompt,
      {
        context:UsageContext.USER,
        complexity:TaskComplexity.MODERATE,
        priority:TaskPriority.HIGH,
        needsReasoning:true,
        needsVerification:true,
        needsSearchGrounding:true,
        needsFastResponse:false,
        estimatedTokens:350,
      },
      providers,
      {
        providerPolicy:'legalwhat',
        maxParticipants:3,
        maxFallbacks:2,
        requestTimeoutMs:9_000,
        signal:context.signal,
      },
    );
    return {
      queries:queriesFromAnswer(result.finalAnswer,query),
      providers:result.providersUsed.map(String),
    };
  }catch{
    return {queries:[],providers:[]};
  }
}
