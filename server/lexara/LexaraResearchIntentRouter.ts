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

  if (/\b(?:look\s+(?:it|this|that)\s+up|search|research|verify|find\s+out|check\s+(?:whether|if|the)|investigate)\b/i.test(text)) {
    return { needed: true, reason: 'explicit-research', objective: text, objectiveKind: 'explicit-research' };
  }

  const question = /\?|^(?:what|when|where|who|which|how|is|are|was|were|does|do|did|has|have)\b/i.test(text);
  // Substantive fact-seeking questions default to grounded research. Conversational
  // control turns are handled before this router by the immediate-acknowledgement lane.
  // This prevents unknown phrasings from silently falling through to model recollection.
  if (question) {
    return { needed: true, reason: 'external-fact-question', objective: text, objectiveKind: /\b(?:record|filing|docket|license|mortgage|inmate|incarcerat|property)\b/i.test(text) ? 'record-lookup' : /\b(?:current|currently|latest|today|now|recent)\b/i.test(text) ? 'current-information' : 'external-fact' };
  }

  const followUp = /\b(?:try\s+again|look\s+harder|search\s+again|keep\s+looking|broaden|verify\s+that|check\s+again)\b/i.test(text);
  if (followUp && previousUserTurns.some(turn => decideLexaraResearchNeed(turn, []).needed)) {
    const priorObjective = [...previousUserTurns].reverse().find(turn => decideLexaraResearchNeed(turn, []).needed) || text;
    return { needed: true, reason: 'research-follow-up', objective: priorObjective + ' FOLLOW-UP: ' + text, objectiveKind: decideLexaraResearchNeed(priorObjective, []).objectiveKind };
  }

  return { needed: false, reason: 'none', objective: text, objectiveKind: 'none' };
}
