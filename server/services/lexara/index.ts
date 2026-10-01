/**
 * Canonical Lexara service entry point.
 *
 * Runtime code should import Lexara through this module. The historical
 * ../alexara path remains only as a compatibility implementation surface while
 * callers are migrated without a big-bang rename.
 */
export {
  Lexara,
  getLexara,
} from '../alexara';

export type {
  LexaraConfig,
  LegalResearchRequest,
  LegalResearchResult,
  DocumentGenerationRequest,
  DocumentGenerationResult,
  LexaraStatus,
  CrawlerSchedule,
  EvidenceInput,
  EvidenceAnalysisResult,
  DraftRequest,
  DraftResult,
  DocumentDraftType,
  TonePreference,
  LegalQuery,
  LegalResult,
  LegalData,
} from '../alexara';

export { default } from '../alexara';
