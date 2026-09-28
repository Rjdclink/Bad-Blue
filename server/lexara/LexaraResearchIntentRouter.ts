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

const LEGAL_AUTHORITY_INTENT_PATTERN = /\b(?:versus|case\s+law|court\s+(?:case|decision|opinion|holding)|holding|precedent|statute|u\.?s\.?c\.?|cfr|code\s+section|rule\s+\d|motion|appeal|lawsuit|cause\s+of\s+action|civil\s+(?:issue|case|claim|matter)|criminal\s+(?:issue|case|charge)|constitutional|jurisdiction|legal\s+(?:issue|question|claim|case|matter|right|remedy|defense))\b/i;
const CASE_CAPTION_PATTERN = /\b[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,4}\s+(?:v\.?|vs\.?|versus)\s+(?:the\s+)?[A-Z][A-Za-z.'’ -]{1,80}\b/i;
// Ordinary procedural questions often omit the word "legal". They must not
// become subject-background lookups merely because they are questions.
const PERSONAL_LEGAL_PROCEDURE_PATTERN = /\b(?:how\s+(?:do|can|should|would)\s+(?:i|we)|can\s+(?:i|we)|what\s+(?:forms?|rights?|remedies|options|steps|documents)\s+(?:do|can|are)|(?:i|we)\s+(?:need|want)\s+to)\b[\s\S]{0,180}\b(?:divorc\w*|custody|evict\w*|bankrupt\w*|probate|immigration|asylum|sue|appeal|file|filing|court|lease|tenant|landlord|restraining\s+order|protective\s+order)\b/i;

export function isLexaraLegalAuthorityIntent(text: string): boolean {
  const value = String(text || '').trim();
  return CASE_CAPTION_PATTERN.test(value) || LEGAL_AUTHORITY_INTENT_PATTERN.test(value) || PERSONAL_LEGAL_PROCEDURE_PATTERN.test(value);
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

  // Restore the established legal lane before generic external-fact routing.
  // A party name inside a case caption is a legal entity in this turn, not a
  // Pantheon background subject.
  if (isLexaraLegalAuthorityIntent(text)) {
    return { needed: true, reason: 'legal-authority', objective: text, objectiveKind: 'legal-authority' };
  }

  if (/\b(?:look\s+(?:it|this|that)\s+up|search|research|verify|find\s+out|check\s+(?:whether|if|the)|investigate)\b/i.test(text)) {
    return { needed: true, reason: 'explicit-research', objective: text, objectiveKind: 'explicit-research' };
  }

  const question = /\?|^(?:what|when|where|who|which|how|is|are|was|were|does|do|did|has|have)\b/i.test(text);
  // Natural spoken factual requests often arrive as statements/imperatives rather
  // than grammatical questions (for example, "tell me where X works"). Keep the
  // existing question default, but also recognize fact-seeking predicates when an
  // identifiable subject or concrete record/current attribute is present.
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
