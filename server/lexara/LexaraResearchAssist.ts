import { AICollaborationOrchestrator } from '../aiCollaborationOrchestrator';
import { getConfiguredHarmonyProviders } from '../aiHarmonyModelRegistry';
import { AIProvider, UsageContext } from '../aiTokenGovernor';
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
 * Fallback-only query planning. Claude alone may suggest alternate searches;
 * scarce Gemini/xAI inference is reserved for material user-answer support.
 * Suggested queries are never evidence; the search mesh still verifies sources.
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
  const providers=getConfiguredHarmonyProviders('legalwhat')
    .filter(provider => provider === AIProvider.CLAUDE);
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
        complexity:TaskComplexity.LIGHTWEIGHT,
        priority:TaskPriority.HIGH,
        // Query suggestions are not evidence. A verification/synthesis chain here
        // only burns the live research budget before real retrieval can run.
        needsReasoning:false,
        needsVerification:false,
        needsSearchGrounding:false,
        needsFastResponse:true,
        estimatedTokens:250,
      },
      providers,
      {
        providerPolicy:'legalwhat',
        maxParticipants:1,
        maxFallbacks:0,
        requestTimeoutMs:2_500,
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
