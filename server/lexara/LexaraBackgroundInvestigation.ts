/**
 * LEXARA-owned entry point for supplemental background investigation.
 *
 * The implementation remains shared during the surgical migration so working
 * retrieval behavior is not regenerated or forked. LEXARA is the caller and
 * answer authority; this module only exposes background evidence utilities.
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
