import { callClaude } from '../claude';
import { CURRENT_AI_MODELS } from '../aiHarmonyModelRegistry';
import { resolveLexaraBackgroundSubject } from './LexaraBackgroundSubject';
import {
  decideLexaraResearchNeed,
  isLexaraConversationControl,
  objectiveKindForFact,
  sourceCategoriesForFact,
  type LexaraRequestedFact,
  type LexaraResearchDecision,
  type LexaraResearchIntent,
} from './LexaraResearchIntentRouter';

const REQUESTED_FACTS = new Set<LexaraRequestedFact>([
  'age-dob',
  'professional-license',
  'marriage-divorce',
  'employment',
  'property',
  'court-record',
  'incarceration',
  'business',
  'financial-professional',
  'healthcare-professional',
  'sanctions-discipline',
  'intellectual-property',
  'domain-web',
  'news-history',
  'identity',
  'contact-address',
  'relatives-associates',
  'social-online',
  'public-image',
  'government-public',
  'education',
  'vehicle',
  'criminal-arrest',
  'probation-parole',
  'warrant',
  'sex-offender',
  'bankruptcy-financial',
  'relationship-timeline',
  'general-public-record',
  'none',
]);

const LOW_VALUE_CONVERSATION = /^(?:ok(?:ay)?|yes|no|yeah|yep|nope|thanks?|thank\s+you|got\s+it|understood|hello|hi|hey|good\s+(?:morning|afternoon|evening)|bye|goodbye)[.! ]*$/i;

interface SemanticIntentPayload {
  needed?: boolean;
  intent?: LexaraResearchIntent;
  requestedFact?: string;
  subject?: string;
  objective?: string;
}

function cleanJson(value: string): string {
  return value
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function supportedSubject(
  semanticSubject: string | undefined,
  prompt: string,
  previousUserTurns: readonly string[],
): string | undefined {
  // The whole-utterance semantic interpretation is the authoritative handoff
  // when it identifies a subject that is actually grounded in the conversation.
  // Raw capitalization parsing is fallback-only and must never override it.
  const candidate = String(semanticSubject || '').trim().replace(/\s+/g, ' ');
  if (candidate && candidate.length <= 140) {
    const corpus = [prompt, ...previousUserTurns].join(' ').toLowerCase();
    const meaningful = candidate.toLowerCase().split(/\s+/).filter(token => token.length > 1);
    if (meaningful.length && meaningful.every(token => corpus.includes(token))) return candidate;
  }

  return resolveLexaraBackgroundSubject(prompt, previousUserTurns)?.name;
}

function requestedFactFromSemantic(value: string | undefined): LexaraRequestedFact {
  const normalized = String(value || '').trim() as LexaraRequestedFact;
  return REQUESTED_FACTS.has(normalized) ? normalized : 'general-public-record';
}

/**
 * Semantic authority for background or mixed legal/background intent.
 *
 * The deterministic planner remains a failure-safe fallback, but substantive
 * turns are interpreted from the whole utterance and conversation context so a
 * capitalization heuristic cannot silently replace Lexara's understood subject.
 */
export async function resolveLexaraResearchDecisionSemantic(
  prompt: string,
  previousUserTurns: string[] = [],
  signal?: AbortSignal,
  conversationContext?: string,
): Promise<LexaraResearchDecision> {
  const text = String(prompt || '').trim();
  const deterministic = decideLexaraResearchNeed(text, previousUserTurns);
  if ((deterministic.intent === 'factual' || deterministic.intent === 'mixed')
    || !text || isLexaraConversationControl(text) || LOW_VALUE_CONVERSATION.test(text)) {
    return deterministic;
  }

  const userTurnContext = previousUserTurns.slice(-6).map((turn, index) => `USER_${index + 1}: ${turn}`).join('\n');
  const prior = String(conversationContext || userTurnContext).trim().slice(-5_000);
  const classificationPrompt = `Classify whether this turn needs EXTERNAL BACKGROUND FACT RESEARCH.

This classifier exists only to detect:
- factual/background research about a real person, organization, place, record, event, status, or other externally verifiable subject; or
- a mixed turn that needs BOTH legal analysis and external background facts.

Do not require special words such as search, research, verify, find, background, records, or a question mark. Infer the user's meaning from ordinary language and the conversation context. A statement, shorthand follow-up, or broad request can require background research when that is the clear meaning.

Do NOT upgrade pure legal-only questions, casual conversation, acknowledgements, document drafting, or facts the user is merely supplying about themselves unless external verification is actually needed.

Return JSON only:
{
  "needed": boolean,
  "intent": "factual" | "mixed" | "legal" | "conversation",
  "requestedFact": "age-dob" | "professional-license" | "marriage-divorce" | "employment" | "property" | "court-record" | "incarceration" | "business" | "financial-professional" | "healthcare-professional" | "sanctions-discipline" | "intellectual-property" | "domain-web" | "news-history" | "identity" | "contact-address" | "relatives-associates" | "social-online" | "public-image" | "government-public" | "education" | "vehicle" | "criminal-arrest" | "probation-parole" | "warrant" | "sex-offender" | "bankruptcy-financial" | "relationship-timeline" | "general-public-record" | "none",
  "subject": "exact subject from the conversation or empty string; preserve a user-supplied location qualifier such as 'of Hartley, Iowa' when it identifies the subject",
  "objective": "one short description of exactly what external fact must be established"
}

Examples:
<example>User: Tell me about Avery Morgan Example.\nOutput: {"needed":true,"intent":"factual","requestedFact":"general-public-record","subject":"Avery Morgan Example","objective":"Find the background facts the user is asking about for Avery Morgan Example."}</example>
<example>User: Hello. What can you tell me about Sarah Loretta Graves of Hartley, Iowa?\nOutput: {"needed":true,"intent":"factual","requestedFact":"general-public-record","subject":"Sarah Loretta Graves of Hartley, Iowa","objective":"Find the background facts the user is asking about for Sarah Loretta Graves of Hartley, Iowa."}</example>
<example>User: Jordan Riley Example of Des Moines, Iowa is employed, right?\nOutput: {"needed":true,"intent":"factual","requestedFact":"employment","subject":"Jordan Riley Example","objective":"Determine whether Jordan Riley Example is currently employed."}</example>
<example>Prior context researched Avery Example. User: And she still does the same thing?
Output: {"needed":true,"intent":"factual","requestedFact":"employment","subject":"Avery Example","objective":"Determine whether Avery Example is still in the previously discussed employment."}</example>
<example>User: The officer who arrested me was fired for misconduct. Does that affect my suppression motion?
Output: {"needed":true,"intent":"mixed","requestedFact":"sanctions-discipline","subject":"the officer who arrested me","objective":"Verify the officer misconduct/employment fact that may affect the legal analysis."}</example>
<example>User: How do I file for divorce in Iowa?
Output: {"needed":false,"intent":"legal","requestedFact":"none","subject":"","objective":""}</example>
<example>User: Thanks, that makes sense.
Output: {"needed":false,"intent":"conversation","requestedFact":"none","subject":"","objective":""}</example>

CONVERSATION CONTEXT:
${prior || '(none)'}

CURRENT TURN:
${text}`;

  try {
    const response = await callClaude(classificationPrompt, {
      model: CURRENT_AI_MODELS.claudeFast,
      maxTokens: 320,
      useJSON: true,
      providerPolicy: 'legalwhat',
      signal,
    });
    const semantic = JSON.parse(cleanJson(response.content)) as SemanticIntentPayload;
    const semanticIntent = semantic.intent;
    if (semantic.needed !== true || (semanticIntent !== 'factual' && semanticIntent !== 'mixed')) return deterministic;
    const intent: LexaraResearchIntent =
      deterministic.intent === 'legal' || deterministic.intent === 'mixed' ? 'mixed' : semanticIntent;

    const subject = supportedSubject(semantic.subject, text, previousUserTurns);
    const requestedFact = requestedFactFromSemantic(semantic.requestedFact);
    const effectiveFact = requestedFact === 'none'
      ? deterministic.requestedFact !== 'none' ? deterministic.requestedFact : 'general-public-record'
      : requestedFact;
    const sourceCategories = sourceCategoriesForFact(effectiveFact, text);
    const objective = String(semantic.objective || text).trim().slice(0, 600) || text;
    const standaloneQuery = [subject, objective, effectiveFact.replace(/-/g, ' ')]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      needed: true,
      reason: intent === 'mixed' ? 'legal-authority' : 'external-fact-question',
      objective,
      objectiveKind: objectiveKindForFact(effectiveFact, text),
      intent,
      requestedFact: effectiveFact,
      sourceCategories: sourceCategories.length ? sourceCategories : ['general-public-records'],
      subject,
      standaloneQuery,
      inferred: true,
    };
  } catch (error) {
    console.warn('[LEXARA SemanticIntent] semantic background inference unavailable; preserving deterministic routing', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministic;
  }
}
