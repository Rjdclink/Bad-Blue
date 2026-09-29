/**
 * LEXARA supplemental background-intelligence surface.
 *
 * This is intentionally additive: it exposes Pantheon's proven public-source,
 * query-planning, evidence and investigation-intelligence primitives to LEXARA
 * without replacing or modifying LEXARA's crawler pool.
 *
 * Keep execution ownership in LEXARA. These exports are research/evidence
 * utilities only; they do not create a second answer/reasoning authority.
 */
export {
  PANTHEON_BACKGROUND_CATEGORIES as LEXARA_BACKGROUND_CATEGORIES,
  buildPantheonCategoryTargets as buildLexaraBackgroundCategoryTargets,
  buildPantheonBackgroundRegistryTargets as buildLexaraBackgroundRegistryTargets,
  preflightPantheonSourceTargets as preflightLexaraBackgroundSourceTargets,
} from '../services/pantheon/PantheonSovereignSourceRegistry';

export type {
  PantheonBackgroundCategory as LexaraBackgroundCategory,
  PantheonSourceTarget as LexaraBackgroundSourceTarget,
  PantheonSourcePreflightIssue as LexaraBackgroundSourcePreflightIssue,
} from '../services/pantheon/PantheonSovereignSourceRegistry';

export {
  PANTHEON_IDENTIFIER_KINDS as LEXARA_BACKGROUND_IDENTIFIER_KINDS,
  normalizePantheonStartingIdentifier as normalizeLexaraBackgroundStartingIdentifier,
  buildPantheonControlledQueryPlan as buildLexaraBackgroundQueryPlan,
  pantheonQuerySubject as lexaraBackgroundQuerySubject,
} from '../services/pantheon/PantheonQueryPlan';

export type {
  PantheonIdentifierKind as LexaraBackgroundIdentifierKind,
  PantheonStartingIdentifier as LexaraBackgroundStartingIdentifier,
  PantheonControlledQueryPlan as LexaraBackgroundQueryPlan,
} from '../services/pantheon/PantheonQueryPlan';

export {
  discoverPantheonSourcesParallel as discoverLexaraBackgroundSourcesParallel,
} from '../services/pantheon/PantheonDiscoveryCoordinator';

export {
  buildPantheonInvestigationIntelligence as buildLexaraBackgroundInvestigationIntelligence,
} from '../services/pantheon/PantheonInvestigationIntelligence';

export type {
  PantheonInvestigationIntelligence as LexaraBackgroundInvestigationIntelligence,
} from '../services/pantheon/PantheonInvestigationIntelligence';

export {
  PANTHEON_REPORT_CATEGORY_LABELS as LEXARA_BACKGROUND_REPORT_CATEGORY_LABELS,
  PANTHEON_PRIMARY_CRAWLER_IDS as LEXARA_BACKGROUND_PRIMARY_CRAWLER_IDS,
  PANTHEON_SECONDARY_CRAWLER_IDS as LEXARA_BACKGROUND_SECONDARY_CRAWLER_IDS,
  PANTHEON_RAZOR_SKILL_IDS as LEXARA_BACKGROUND_RAZOR_SKILL_IDS,
  PANTHEON_PORTABLE_CAPABILITY_IDS as LEXARA_BACKGROUND_PORTABLE_CAPABILITY_IDS,
} from '../services/pantheon/PantheonCrawlerCapabilityMatrix';

export type {
  PantheonReportCategoryLabel as LexaraBackgroundReportCategoryLabel,
  PantheonPrimaryCrawlerId as LexaraBackgroundPrimaryCrawlerId,
} from '../services/pantheon/PantheonCrawlerCapabilityMatrix';

export { matchPantheonSubject as matchLexaraBackgroundSubject } from '../services/pantheon/PantheonEntityResolution';
export { validatePantheonSourceResult as validateLexaraBackgroundSourceResult } from '../services/pantheon/PantheonSourceResult';
export { rememberPantheonDiscoveryOutcome as rememberLexaraBackgroundDiscoveryOutcome } from '../services/pantheon/PantheonDiscoveryLearning';
export {
  createPantheonRegistrationAuthority as createLexaraRegistrationAuthority,
  ensurePantheonContactRegistration as ensureLexaraContactRegistration,
} from '../services/pantheon/PantheonContactRegistrationBroker';
export type { PantheonRegistrationAuthority as LexaraRegistrationAuthority } from '../services/pantheon/PantheonContactRegistrationBroker';
