import { callClaude } from '../claude';
import { CURRENT_AI_MODELS } from '../aiHarmonyModelRegistry';
import { hasMultipleLexaraBackgroundSubjectCandidates, resolveLexaraBackgroundSubject, type LexaraBackgroundSubjectKind } from './LexaraBackgroundSubject';
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
  subjectKind?: string;
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
  preferSemantic = false,
): string | undefined {
  const candidate = String(semanticSubject || '').trim().replace(/\s+/g, ' ');
  const corpus = [prompt, ...previousUserTurns].join(' ').toLowerCase();
  const meaningful = candidate.toLowerCase().split(/\s+/).filter(token => token.length > 1);
  const semanticSupported = Boolean(
    candidate && candidate.length <= 140
    && meaningful.length && meaningful.every(token => corpus.includes(token))
  );
  if (preferSemantic && semanticSupported) return candidate;

  const resolved = resolveLexaraBackgroundSubject(prompt, previousUserTurns)?.name;
  if (resolved) return resolved;
  return semanticSupported ? candidate : undefined;
}

function requestedFactFromSemantic(value: string | undefined): LexaraRequestedFact {
  const normalized = String(value || '').trim() as LexaraRequestedFact;
  return REQUESTED_FACTS.has(normalized) ? normalized : 'general-public-record';
}

function subjectKindFromSemantic(value: string | undefined): LexaraBackgroundSubjectKind | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'person' || normalized === 'organization' || normalized === 'place' || normalized === 'entity'
    ? normalized
    : undefined;
}

function deterministicSubjectNeedsSemanticReview(subject?: string): boolean {
  const value = String(subject || '').trim();
  return !value
    || /^(?:hello|hi|hey|good|thanks|thank|okay|ok|alright|sure|so|well|actually|anyway|what|who|where|when|how|does|did|has|have|is|are|can|could|would|should)(?:\b|[.])/i.test(value)
    || /[.!?]\s*(?:what|who|where|when|how|does|did|has|have|is|are|can|could|would|should|tell|find|check|show|look)\b/i.test(value);
}

/**
 * Semantic fallback for background or mixed legal/background intent.
 *
 * The deterministic planner remains the zero-latency fast path for already
 * recognized factual/mixed turns. Claude semantically reviews otherwise
 * conversational or legal-only turns so hidden background dependencies do not
 * require magic words, while pure legal-only routing remains unchanged when
 * no external factual dependency exists.
 */
export async function resolveLexaraResearchDecisionSemantic(
  prompt: string,
  previousUserTurns: string[] = [],
  signal?: AbortSignal,
  conversationContext?: string,
): Promise<LexaraResearchDecision> {
  const text = String(prompt || '').trim();
  const deterministic = decideLexaraResearchNeed(text, previousUserTurns);
  const deterministicFactual = deterministic.intent === 'factual' || deterministic.intent === 'mixed';
  const needsSubjectReview = deterministicFactual && (
    deterministicSubjectNeedsSemanticReview(deterministic.subject)
    || hasMultipleLexaraBackgroundSubjectCandidates(text)
  );
  if ((deterministicFactual && !needsSubjectReview)
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
  "subject": "exact subject from the conversation or empty string",
  "subjectKind": "person" | "organization" | "place" | "entity",
  "objective": "one short description of exactly what external fact must be established"
}

Examples:
<example>User: Tell me about Avery Morgan Example.\nOutput: {"needed":true,"intent":"factual","requestedFact":"general-public-record","subject":"Avery Morgan Example","subjectKind":"person","objective":"Find the background facts the user is asking about for Avery Morgan Example."}</example>
<example>User: What does eBay do?\nOutput: {"needed":true,"intent":"factual","requestedFact":"business","subject":"eBay","subjectKind":"organization","objective":"Determine the business activity of eBay."}</example>
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
    const intent: LexaraResearchIntent = deterministic.intent === 'legal' ? 'mixed' : semanticIntent;

    const subject = supportedSubject(semantic.subject, text, previousUserTurns, needsSubjectReview);
    const subjectKind = subjectKindFromSemantic(semantic.subjectKind);
    const requestedFact = requestedFactFromSemantic(semantic.requestedFact);
    const effectiveFact = requestedFact === 'none' ? 'general-public-record' : requestedFact;
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
      subjectKind,
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
