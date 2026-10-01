// Compatibility boundary retained for callers that have not yet moved to the direct
// Lexara import. It must resolve only to Lexara-native background research.
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
