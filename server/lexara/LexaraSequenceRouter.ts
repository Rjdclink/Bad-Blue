import { decideLexaraResearchNeed, isLexaraConversationControl, isLexaraDocumentIntakeQuestion, type LexaraResearchDecision } from './LexaraResearchIntentRouter';

export type LexaraSequenceId =
  | 'simple-factual'
  | 'lexara-background'
  | 'lexara-legal'
  | 'combined-legal-background'
  | 'deep-recursive'
  | 'document-action'
  | 'conversation-only';

export interface LexaraSequencePlan {
  sequence: LexaraSequenceId;
  researchDecision: LexaraResearchDecision;
  useLegalResearch: boolean;
  useBackgroundResearch: boolean;
  recursive: boolean;
  classifyBackground: boolean;
  documentAction: boolean;
  reason: string;
}

const DEEP_PATTERN = /\b(?:deep|thorough|comprehensive|recursive|broaden|keep looking|look harder|search again|investigate|everything|full background|background report)\b/i;
const DOCUMENT_PATTERN = /\b(?:draft|prepare|create|generate|write|download|export|pdf|docx|documents?|forms?|paperwork|word document|demand|complaint|petition|motion|affidavit|declaration|letter|request)\b/i;
const ACTION_PATTERN = /\b(?:need|want|give|provide|make|prepare|draft|create|generate|write|download|export|file|serve|send)\b/i;

export function planLexaraSequence(
  prompt: string,
  previousUserTurns: string[] = [],
  researchDecisionOverride?: LexaraResearchDecision,
): LexaraSequencePlan {
  const text = String(prompt || '').trim();
  const currentDecision = researchDecisionOverride || decideLexaraResearchNeed(text, previousUserTurns);
  const priorResearchDecision = !currentDecision.needed
    ? [...previousUserTurns].reverse().map(turn => decideLexaraResearchNeed(turn, [])).find(decision => decision.needed)
    : undefined;
  const contextualContinuation = Boolean(priorResearchDecision)
    && text.split(/\s+/).length <= 12
    && /^(?:what|how|is|are|does|do|did|has|have|where|when|who|and|also)\b/i.test(text)
    && /\b(?:status|record|records|license|licenses|issue|law|case|result|results|that|it|her|his|their|same|one|ones)\b/i.test(text);
  const contextualPrompt = contextualContinuation && priorResearchDecision
    ? [priorResearchDecision.subject, text, priorResearchDecision.requestedFact !== 'none' ? priorResearchDecision.requestedFact.replace(/-/g, ' ') : '']
        .filter(Boolean).join(' ')
    : text;
  const contextualDecision = researchDecisionOverride?.needed
    ? currentDecision
    : contextualContinuation
      ? decideLexaraResearchNeed(contextualPrompt, previousUserTurns)
      : currentDecision;
  const researchDecision = contextualDecision.needed ? contextualDecision : currentDecision;
  if (isLexaraConversationControl(text)) return {
    sequence: 'conversation-only', researchDecision, useLegalResearch: false,
    useBackgroundResearch: false, recursive: false, classifyBackground: false,
    documentAction: false, reason: 'conversation history/control turn',
  };

  const legal = researchDecision.intent === 'legal' || researchDecision.intent === 'mixed';
  const factual = researchDecision.intent === 'factual' || researchDecision.intent === 'mixed';
  const documentAction = !isLexaraDocumentIntakeQuestion(text)
    && !/\b(?:do not|don't|dont|never)\s+(?:draft|prepare|create|generate|write)\b/i.test(text)
    && DOCUMENT_PATTERN.test(text) && ACTION_PATTERN.test(text);
  const deep = DEEP_PATTERN.test(text) && researchDecision.needed;

  if (documentAction) {
    return {
      sequence: 'document-action', researchDecision,
      useLegalResearch: legal || researchDecision.needed,
      useBackgroundResearch: factual,
      recursive: deep || factual,
      classifyBackground: factual,
      documentAction: true,
      reason: 'document/action objective with prerequisite Lexara research selected as needed',
    };
  }
  if (legal && factual) {
    return {
      sequence: 'combined-legal-background', researchDecision,
      useLegalResearch: true, useBackgroundResearch: true, recursive: deep,
      classifyBackground: true, documentAction: false,
      reason: 'legal and factual research run through connected Lexara legal and background routes',
    };
  }
  if (legal) {
    return {
      sequence: 'lexara-legal', researchDecision,
      useLegalResearch: true, useBackgroundResearch: false, recursive: deep,
      classifyBackground: false, documentAction: false,
      reason: 'legal authority/reasoning route',
    };
  }
  if (factual) {
    return {
      sequence: deep ? 'deep-recursive' : 'lexara-background', researchDecision,
      useLegalResearch: false, useBackgroundResearch: true, recursive: true,
      classifyBackground: true, documentAction: false,
      reason: deep ? 'deep factual research routed through Lexara background research' : 'factual research routed through Lexara background research',
    };
  }
  if (researchDecision.needed) {
    return {
      sequence: 'simple-factual', researchDecision,
      useLegalResearch: false, useBackgroundResearch: true, recursive: deep,
      classifyBackground: true, documentAction: false,
      reason: 'external factual research routed through Lexara background research',
    };
  }
  return {
    sequence: 'conversation-only', researchDecision,
    useLegalResearch: false, useBackgroundResearch: false, recursive: false,
    classifyBackground: false, documentAction: false,
    reason: 'no external research required',
  };
}
