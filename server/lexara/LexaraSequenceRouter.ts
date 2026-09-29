import { decideLexaraResearchNeed, isLexaraLegalAuthorityIntent, isLexaraConversationControl, type LexaraResearchDecision } from './LexaraResearchIntentRouter';
import { resolveLexaraBackgroundSubject } from './LexaraBackgroundSubject';
import {
  classifyLexaraBackgroundSemanticCategories,
  isContextualReference,
  isFullLexaraBackgroundReportIntent,
} from './LexaraBackgroundSemanticIntent';

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
  useBackground: boolean;
  recursive: boolean;
  classifyBackground: boolean;
  documentAction: boolean;
  reason: string;
}

// Keep this classifier aligned with Lexara's background report
// categories. The investigation layer has the detailed category rules; this
// boundary only decides whether the turn must enter that evidence pipeline.
const BACKGROUND_PATTERN = /\b(?:background|identit\w*|alias\w*|date\s+of\s+birth|dob|age\w*|phone\w*|telephone\w*|email\w*|e-mail\w*|address\w*|residen\w*|lived|relativ\w*|famil\w*|associat\w*|affiliat\w*|household\w*|social\s+media|facebook|instagram|linkedin|tiktok|twitter|username\w*|online\s+account\w*|photo\w*|image\w*|employ\w*|occupation\w*|job\w*|work\w*|education\w*|school\w*|college\w*|university|degree\w*|license\w*|credential\w*|certification\w*|business\w*|compan\w*|corporat\w*|ownership|property\w*|real\s+estate|vehicle\w*|car\w*|truck\w*|vin\w*|court\w*|case\w*|docket\w*|criminal\w*|conviction\w*|arrest\w*|police|inmate\w*|incarcerat\w*|prison\w*|jail\w*|probation|parole|warrant\w*|wanted|sex[-\s]+offender\w*|civil\s+litigation|judgment\w*|bankrupt\w*|lien\w*|mortgage\w*|financial\w*|marriage\w*|married|spouse\w*|divorc\w*|vital\w*|news|media|internet|web\s+footprint|government\w*|political\w*|public\s+service|timeline\w*|chronolog\w*|relationship\w*|history|record\w*|filing\w*|misconduct\w*)/i;
const DEEP_PATTERN = /\b(?:deep|thorough|comprehensive|recursive|broaden|keep looking|look harder|search again|investigate|everything|full background|background report)\b/i;
const DOCUMENT_PATTERN = /\b(?:draft|prepare|create|generate|write|download|export|pdf|docx|word document|demand|complaint|petition|motion|affidavit|declaration|letter|request)\b/i;
const ACTION_PATTERN = /\b(?:need|want|give|provide|make|prepare|draft|create|generate|write|download|export|file|serve|send)\b/i;
const BACKGROUND_OBJECTIVE_PATTERN = /\b(?:background|investigat\w*|search|find|look\s*up|verify|locate|identity|alias|employment|work(?:s|ed)?\s+(?:at|for)|address|residen\w*|records?\s+(?:of|on|for|about)|criminal\s+record|property\s+(?:owned|ownership)|who\s+owns|where\s+.+\s+(?:live|work)|report)\b/i;

function hasIdentifiableSubject(text: string): boolean {
  return /\b[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,5}\b/.test(text)
    || /\b(?:the\s+)?(?:company|corporation|business|employer|officer|defendant|plaintiff|spouse|husband|wife|party)\b/i.test(text);
}

export function planLexaraSequence(prompt: string, previousUserTurns: string[] = []): LexaraSequencePlan {
  const text = String(prompt || '').trim();
  const researchDecision = decideLexaraResearchNeed(text, previousUserTurns);
  if (isLexaraConversationControl(text)) return {
    sequence: 'conversation-only', researchDecision, useLegalResearch: false,
    useBackground: false, recursive: false, classifyBackground: false,
    documentAction: false, reason: 'conversation history/control turn',
  };
  const legal = isLexaraLegalAuthorityIntent(text) || researchDecision.objectiveKind === 'legal-authority';
  const subject = resolveLexaraBackgroundSubject(text, previousUserTurns);
  const semanticCategories = classifyLexaraBackgroundSemanticCategories(text, previousUserTurns);
  const priorBackground = previousUserTurns.slice(-4).some(turn =>
    BACKGROUND_PATTERN.test(turn) || classifyLexaraBackgroundSemanticCategories(turn).length > 0,
  );
  const contextualFollowup = Boolean(subject && priorBackground && isContextualReference(text));
  const fullReport = isFullLexaraBackgroundReportIntent(text);
  const background = Boolean(
    ((semanticCategories.length > 0 || BACKGROUND_PATTERN.test(text) || fullReport)
      && (!legal || fullReport || BACKGROUND_OBJECTIVE_PATTERN.test(text))
      && (subject?.identifiable || hasIdentifiableSubject(text)
        || Boolean(subject && priorBackground && isContextualReference(text))))
    || (contextualFollowup && (researchDecision.needed || semanticCategories.length > 0))
  );
  const documentAction = DOCUMENT_PATTERN.test(text) && ACTION_PATTERN.test(text);
  const deep = DEEP_PATTERN.test(text) && researchDecision.needed;

  if (documentAction) {
    return {
      sequence: 'document-action', researchDecision,
      useLegalResearch: legal || !background,
      useBackground: background,
      recursive: deep || background,
      classifyBackground: background,
      documentAction: true,
      reason: 'document/action objective with prerequisite research selected as needed',
    };
  }
  if (legal && background) {
    return {
      sequence: 'combined-legal-background', researchDecision,
      useLegalResearch: true, useBackground: true, recursive: deep,
      classifyBackground: true, documentAction: false,
      reason: 'legal analysis and identifiable background facts are both material',
    };
  }
  if (legal) {
    return {
      sequence: 'lexara-legal', researchDecision,
      useLegalResearch: true, useBackground: false, recursive: deep,
      classifyBackground: false, documentAction: false,
      reason: 'legal authority/reasoning route',
    };
  }
  if (background) {
    return {
      sequence: deep ? 'deep-recursive' : 'lexara-background', researchDecision,
      useLegalResearch: false, useBackground: true, recursive: true,
      classifyBackground: true, documentAction: false,
      reason: deep ? 'deep identifiable-subject investigation' : 'identifiable-subject background/fact route',
    };
  }
  if (deep) {
    return {
      sequence: 'deep-recursive', researchDecision,
      useLegalResearch: false, useBackground: true, recursive: true,
      classifyBackground: true, documentAction: false,
      reason: 'explicit deep/recursive external research route',
    };
  }
  if (researchDecision.needed) {
    return {
      sequence: 'simple-factual', researchDecision,
      useLegalResearch: false, useBackground: true, recursive: semanticCategories.length > 0,
      classifyBackground: semanticCategories.length > 0, documentAction: false,
      reason: 'ordinary external fact/current-information route',
    };
  }
  return {
    sequence: 'conversation-only', researchDecision,
    useLegalResearch: false, useBackground: false, recursive: false,
    classifyBackground: false, documentAction: false,
    reason: 'no external research required',
  };
}
