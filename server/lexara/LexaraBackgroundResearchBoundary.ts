// Lexara owns this research surface; underlying utilities remain shared and unchanged.
export {
  investigatePersonQuestion as investigateLexaraBackgroundQuestion,
  formatPantheonInvestigationForSystem as formatLexaraBackgroundResearchForSystem,
} from './LexaraPantheonInvestigation';
export type {
  LexaraPersonInvestigation as LexaraBackgroundResearchResult,
  LexaraPantheonProgressEvent as LexaraBackgroundProgressEvent,
} from './LexaraPantheonInvestigation';
export { discoverPantheonSourcesParallel as discoverLexaraBackgroundSourcesParallel } from '../services/pantheon/PantheonDiscoveryCoordinator';

export {
  getLexaraSupplementalQueryHints,
  getLexaraSupplementalSources,
} from './LexaraSupplementalOsintSources';
