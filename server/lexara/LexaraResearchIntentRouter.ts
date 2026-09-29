export type LexaraResearchReason =
  | 'explicit-research'
  | 'current-external-fact'
  | 'external-fact-question'
  | 'legal-authority'
  | 'research-follow-up'
  | 'none';

export type LexaraResearchObjectiveKind =
  | 'external-fact'
  | 'legal-authority'
  | 'record-lookup'
  | 'current-information'
  | 'explicit-research'
  | 'none';

export interface LexaraResearchDecision {
  needed: boolean;
  reason: LexaraResearchReason;
  objective: string;
  objectiveKind: LexaraResearchObjectiveKind;
}

// Conversation repair refers to the dialogue, never to an outside person/record.
export function isLexaraRepeatRequest(text: string): boolean {
  return /^(?:(?:sorry|please|lexara)[, ]+)*(?:(?:what (?:did|do) you (?:just )?say)|(?:can|could|would) you (?:please )?(?:repeat (?:that|your (?:last )?(?:answer|response))|say that again)|repeat (?:that|your (?:last )?(?:answer|response))|say (?:that|it) again|i (?:didn't|did not|couldn't|could not) hear (?:you|that))[?.! ]*$/i.test(text.trim());
}

export function isLexaraConversationControl(text: string): boolean {
  return isLexaraRepeatRequest(text) || /^(?:(?:please|lexara)[, ]+)*(?:what do you mean|can you explain (?:that|your answer)|explain that|could you clarify|are you (?:still )?there|can you hear me|did you hear me|are you listening|how are you|who are you|what can you do|can you help me)[?.! ]*$/i.test(text.trim());
}

const LEGAL_AUTHORITY_INTENT_PATTERN = /\b(?:versus|case\s+law|court\s+(?:case|decision|opinion|holding)|holding|precedent|statute|u\.?s\.?c\.?|cfr|code\s+section|rule\s+\d|motion|appeal|lawsuit|cause\s+of\s+action|civil\s+(?:issue|case|claim|matter)|criminal\s+(?:issue|case|charge)|constitutional|jurisdiction|legal\s+(?:issue|question|claim|case|matter|right|remedy|defense|option|analysis|advice)s?)\b/i;
const LOCAL_REGULATORY_LEGAL_PATTERN = /\\b(?:ordinance|municipal|city\\s+code|county\\s+code|local\\s+(?:law|rule|ordinance)|nuisance|animal\\s+control|leash|dog\\s+at\\s+large|zoning|landlord|tenant|eviction|property\\s+boundary|trespass|noise\\s+ordinance|traffic\\s+(?:law|ordinance)|licensing|permit)\\b/i;
const CASE_CAPTION_PATTERN = /\b[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,4}\s+(?:v\.?|vs\.?|versus)\s+(?:the\s+)?[A-Z][A-Za-z.'’ -]{1,80}\b/i;
// Ordinary procedural questions often omit the word "legal". They must not
// become subject-background lookups merely because they are questions.
const PERSONAL_LEGAL_PROCEDURE_PATTERN = /\b(?:how\s+(?:do|can|should|would)\s+(?:i|we)|can\s+(?:i|we)|what\s+(?:forms?|rights?|remedies|options|steps|documents)\s+(?:do|can|are)|(?:i|we)\s+(?:need|want)\s+to)\b[\s\S]{0,180}\b(?:divorc\w*|custody|evict\w*|bankrupt\w*|probate|immigration|asylum|sue|appeal|file|filing|court|lease|tenant|landlord|restraining\s+order|protective\s+order)\b/i;

export function isLexaraLegalAuthorityIntent(text: string): boolean {
  const value = String(text || '').trim();
  return CASE_CAPTION_PATTERN.test(value) || LEGAL_AUTHORITY_INTENT_PATTERN.test(value) || PERSONAL_LEGAL_PROCEDURE_PATTERN.test(value) || LOCAL_REGULATORY_LEGAL_PATTERN.test(value);
}

/**
 * Fast local routing decision. This does not answer the question; it decides
 * whether Lexara needs grounded external research instead of model recollection.
 */
export function decideLexaraResearchNeed(
  prompt: string,
  previousUserTurns: string[] = [],
): LexaraResearchDecision {
  const text = String(prompt || '').trim();
  if (!text) return { needed: false, reason: 'none', objective: '', objectiveKind: 'none' };
  if (isLexaraConversationControl(text)) return { needed: false, reason: 'none', objective: text, objectiveKind: 'none' };

  // Restore the established legal lane before generic external-fact routing.
  // A party name inside a case caption is a legal entity in this turn, not a
  // Pantheon background subject.
  if (isLexaraLegalAuthorityIntent(text)) {
    return { needed: true, reason: 'legal-authority', objective: text, objectiveKind: 'legal-authority' };
  }

  if (/\b(?:look\s+(?:it|this|that)\s+up|search|research|verify|find\s+out|check\s+(?:whether|if|the)|investigate)\b/i.test(text)) {
    return { needed: true, reason: 'explicit-research', objective: text, objectiveKind: 'explicit-research' };
  }

  // A question mark alone is not an external-research objective. Conversation
  // recall and ordinary legal discussion stay with Lexara.
  const externalAttribute = /\b(?:birth(?:day|date)?|born|age|employ(?:er|ment|ed|s|ing)?|works?\s+(?:at|for)|address|residen(?:ce|tial|t)|license|record|filing|docket|property|mortgage|occupation|job|business|owner|ownership|spouse|married|income|current|currently|latest|today|recent|where\s+.+\s+(?:live|work)|who\s+(?:owns|is)|when\s+(?:was|did))\b/i.test(text);
  const question = /\?|^(?:what|when|where|who|which|how|is|are|was|were|does|do|did|has|have)\b/i.test(text) && externalAttribute;
  // Spoken factual requests also arrive as statements and imperatives.
  const factualRequest = /\b(?:tell\s+me|find|locate|identify|determine|show|give\s+me|need\s+to\s+know|want\s+to\s+know)\b/i.test(text)
    && /\b(?:employ(?:er|ment|ed|s|ing)?|works?\s+(?:at|for)|address|residen(?:ce|tial|t)|license|record|filing|docket|property|mortgage|occupation|job|business|owner|ownership|spouse|married|income|current|currently|where|who|when|what)\b/i.test(text);
  if (question || factualRequest) {
    return { needed: true, reason: 'external-fact-question', objective: text, objectiveKind: /\b(?:record|filing|docket|license|mortgage|inmate|incarcerat|property)\b/i.test(text) ? 'record-lookup' : /\b(?:current|currently|latest|today|now|recent)\b/i.test(text) ? 'current-information' : 'external-fact' };
  }

  const followUp = /\b(?:try\s+again|look\s+harder|search\s+again|keep\s+looking|broaden|verify\s+that|check\s+again)\b/i.test(text);
  const priorResearchTurn = [...previousUserTurns].reverse().find(turn => decideLexaraResearchNeed(turn, []).needed);
  const priorDecision = priorResearchTurn ? decideLexaraResearchNeed(priorResearchTurn, []) : null;
  // Spoken clarifications often contain only a court/circuit/year/docket/location clue.
  // Keep that clue attached to the immediately preceding research objective instead
  // of silently resetting the turn to model recollection.
  const contextualResearchClue = Boolean(priorDecision?.needed) && (
    /\b(?:federal|state|district|circuit|court|appeals?|appellate|supreme|docket|case\s*(?:no|number)|citation|reporter|jurisdiction|venue)\b/i.test(text)
    || /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|d\.?c\.?)\s+circuit\b/i.test(text)
    || /\b(?:19|20)\d{2}\b/.test(text)
  );
  if ((followUp || contextualResearchClue) && priorResearchTurn && priorDecision) {
    return {
      needed: true,
      reason: 'research-follow-up',
      objective: priorResearchTurn + ' FOLLOW-UP CLUE: ' + text,
      objectiveKind: priorDecision.objectiveKind,
    };
  }

  return { needed: false, reason: 'none', objective: text, objectiveKind: 'none' };
}
