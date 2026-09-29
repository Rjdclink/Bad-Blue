/**
 * LEXARA-owned entry point for supplemental background investigation.
 * The proven implementation remains single-source; Lexara owns invocation,
 * reasoning, status and user-facing behavior.
 */
export {
  investigatePersonQuestion as investigateLexaraBackgroundQuestion,
  formatLexaraBackgroundInvestigationForSystem,
  retrieveLexaraConversationalSource,
} from './LexaraPantheonInvestigation';

export type {
  LexaraPersonInvestigation as LexaraBackgroundInvestigation,
  LexaraPantheonProgressEvent as LexaraBackgroundProgressEvent,
} from './LexaraPantheonInvestigation';
