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
