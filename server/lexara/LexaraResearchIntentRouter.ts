export type LexaraResearchReason =
  | 'explicit-research'
  | 'current-external-fact'
  | 'legal-authority'
  | 'research-follow-up'
  | 'none';

export interface LexaraResearchDecision {
  needed: boolean;
  reason: LexaraResearchReason;
  objective: string;
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
  if (!text) return { needed: false, reason: 'none', objective: '' };

  if (/\b(?:look\s+(?:it|this|that)\s+up|search|research|verify|find\s+out|check\s+(?:whether|if|the)|investigate)\b/i.test(text)) {
    return { needed: true, reason: 'explicit-research', objective: text };
  }

  const question = /\?|^(?:what|when|where|who|which|how|is|are|was|were|does|do|did|has|have)\b/i.test(text);
  const externallyVariable = /\b(?:current|currently|latest|today|now|recent|status|record|filing|docket|case|court|license|rule|regulation|statute|deadline|statistics|rate|government|agency)\b/i.test(text);
  if (question && externallyVariable) {
    return { needed: true, reason: 'current-external-fact', objective: text };
  }

  const legalAuthority = /\b(?:law|legal|case\s*law|precedent|holding|statute|code\s+section|regulation|court\s+rule|jurisdiction|venue|limitations|appeal|sentencing)\b/i.test(text);
  if (question && legalAuthority) {
    return { needed: true, reason: 'legal-authority', objective: text };
  }

  const followUp = /\b(?:try\s+again|look\s+harder|search\s+again|keep\s+looking|broaden|verify\s+that|check\s+again)\b/i.test(text);
  if (followUp && previousUserTurns.some(turn => decideLexaraResearchNeed(turn, []).needed)) {
    const priorObjective = [...previousUserTurns].reverse().find(turn => decideLexaraResearchNeed(turn, []).needed) || text;
    return { needed: true, reason: 'research-follow-up', objective: priorObjective + ' FOLLOW-UP: ' + text };
  }

  return { needed: false, reason: 'none', objective: text };
}
