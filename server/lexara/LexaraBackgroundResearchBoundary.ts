/**
 * @deprecated Compatibility boundary for older Lexara imports.
 *
 * This facade now delegates only to Lexara's native background investigator.
 * It intentionally contains no Pantheon imports so an old import path cannot
 * silently reconnect the live Lexara conversation runtime to Pantheon.
 */
export {
  investigateLexaraBackgroundQuestion,
  formatLexaraBackgroundResearchForSystem,
  discoverLexaraBackgroundSourcesParallel,
} from './LexaraBackgroundInvestigation';

export type {
  LexaraBackgroundResearchResult,
  LexaraBackgroundProgressEvent,
} from './LexaraBackgroundInvestigation';

export {
  getLexaraSupplementalQueryHints,
  getLexaraSupplementalSources,
} from './LexaraSupplementalOsintSources';
