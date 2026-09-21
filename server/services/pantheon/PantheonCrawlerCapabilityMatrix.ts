import type { PantheonTransport } from './PantheonSovereignSourceRegistry';

/**
 * Authoritative PANTHEON background-report capability catalog.
 *
 * Every entry names the real implementation and function that owns the work.
 * Category routing is allow-listed; an unknown category cannot silently acquire
 * crawler access.
 */
export const PANTHEON_PRIMARY_CRAWLER_IDS = [
  'startrek',
  'birdofprey',
  'sixdegrees',
  'cerberus',
  'blizzard',
  'lich',
] as const;

export const PANTHEON_SECONDARY_CRAWLER_IDS = [
  'hydra',
  'wraith',
  'ice',
  'farm',
  'phantom',
  'nova',
] as const;

export const PANTHEON_RAZOR_SKILL_IDS = [
  'razor:identity',
  'razor:contact',
  'razor:address',
  'razor:social',
  'razor:record',
  'razor:asset',
  'razor:court',
  'razor:business',
  'razor:relation',
  'razor:media',
] as const;

export type PantheonPrimaryCrawlerId = typeof PANTHEON_PRIMARY_CRAWLER_IDS[number];
export type PantheonSecondaryCrawlerId = typeof PANTHEON_SECONDARY_CRAWLER_IDS[number];
export type PantheonRazorSkillId = typeof PANTHEON_RAZOR_SKILL_IDS[number];
export type PantheonCapabilityId =
  | PantheonPrimaryCrawlerId
  | PantheonSecondaryCrawlerId
  | PantheonRazorSkillId;

export const PANTHEON_REPORT_CATEGORY_LABELS = [
  'Identity & Identity Verification',
  'Phone Numbers',
  'Email Addresses',
  'Current Address',
  'Address History',
  'Relatives & Family',
  'Associates & Household Connections',
  'Social-Media Profiles',
  'Usernames & Online Accounts',
  'Photos & Public Images',
  'Employment History',
  'Education',
  'Professional Licenses & Credentials',
  'Business Ownership & Affiliations',
  'Property & Real Estate',
  'Vehicles & Transportation Records',
  'Court Records',
  'Criminal Records',
  'Arrest & Police Records',
  'Incarceration & Corrections',
  'Probation & Parole Information',
  'Warrants & Wanted-Person Records',
  'Sex-Offender Registries',
  'Civil Litigation & Judgments',
  'Bankruptcies, Liens & Financial Public Records',
  'Marriage, Divorce & Vital-Record Information',
  'News & Media Mentions',
  'Internet & Web Footprint',
  'Government, Political & Public-Service Records',
  'Relationship & Timeline Intelligence',
] as const;

export type PantheonReportCategoryLabel = typeof PANTHEON_REPORT_CATEGORY_LABELS[number];

export type PantheonCapabilityClass = 'primary-retrieval' | 'secondary-retrieval' | 'evidence-extraction';
export type PantheonTaskKind =
  | 'retrieve-source'
  | 'discover-related-sources'
  | 'extract-structured-evidence'
  | 'observe-source-transport';

export interface PantheonCapabilityDescriptor {
  id: PantheonCapabilityId;
  capabilityClass: PantheonCapabilityClass;
  skill: string;
  implementationPath: string;
  executableFunction: string;
  taskKind: PantheonTaskKind;
  transports: readonly PantheonTransport[];
  outputFields: readonly string[];
  reportEvidenceEligible: boolean;
}

const ALL_SOURCE_TRANSPORTS = [
  'direct-http',
  'browser',
  'search-provider',
  'specialized-adapter',
  'archive',
] as const satisfies readonly PantheonTransport[];

function capability(
  id: PantheonCapabilityId,
  capabilityClass: PantheonCapabilityClass,
  skill: string,
  implementationPath: string,
  executableFunction: string,
  taskKind: PantheonTaskKind,
  reportEvidenceEligible: boolean,
  outputFields: readonly string[],
): PantheonCapabilityDescriptor {
  return {
    id,
    capabilityClass,
    skill,
    implementationPath,
    executableFunction,
    taskKind,
    transports: ALL_SOURCE_TRANSPORTS,
    outputFields,
    reportEvidenceEligible,
  };
}

const SOURCE_OUTPUT = ['sourceUrl', 'content', 'confidence', 'retrievedAt'] as const;
const STRUCTURED_OUTPUT = ['sourceUrl', 'structuredData', 'confidence', 'extractionTimeMs'] as const;
const OBSERVATION_OUTPUT = ['sourceUrl', 'status', 'timingMs', 'retrievedAt'] as const;

export const PANTHEON_CRAWLER_CAPABILITY_MATRIX = {
  startrek: capability(
    'startrek',
    'primary-retrieval',
    'fast authoritative-source reconnaissance and page retrieval',
    'server/services/crawlers/StarTrekCrawler.ts',
    'StarTrekCrawler.warpTo',
    'retrieve-source',
    true,
    SOURCE_OUTPUT,
  ),
  birdofprey: capability(
    'birdofprey',
    'primary-retrieval',
    'bounded low-profile public-source retrieval',
    'server/services/crawlers/BirdOfPreyCrawler.ts',
    'BirdOfPreyCrawler.hunt',
    'retrieve-source',
    true,
    SOURCE_OUTPUT,
  ),
  sixdegrees: capability(
    'sixdegrees',
    'primary-retrieval',
    'public relationship and linked-source graph discovery',
    'server/services/crawlers/SixDegreesCrawler.ts',
    'SixDegreesCrawler.mapConnections',
    'discover-related-sources',
    true,
    ['sourceUrl', 'nodes', 'edges', 'retrievedAt'],
  ),
  cerberus: capability(
    'cerberus',
    'primary-retrieval',
    'adaptive public-record retrieval across independent heads',
    'server/services/crawlers/TrinityCrawlers.ts',
    'CerberusCrawler.attack',
    'retrieve-source',
    true,
    SOURCE_OUTPUT,
  ),
  blizzard: capability(
    'blizzard',
    'primary-retrieval',
    'bounded parallel public-source collection',
    'server/services/crawlers/TrinityCrawlers.ts',
    'BlizzardCrawler.deploy',
    'retrieve-source',
    true,
    SOURCE_OUTPUT,
  ),
  lich: capability(
    'lich',
    'primary-retrieval',
    'redundant public-source retrieval for chronology and corroboration',
    'server/services/crawlers/TrinityCrawlers.ts',
    'LichCrawler.castSpell',
    'retrieve-source',
    true,
    SOURCE_OUTPUT,
  ),
  hydra: capability(
    'hydra',
    'secondary-retrieval',
    'bounded related-link discovery',
    'server/services/pantheon/crawlers/hydra.ts',
    'HydraCrawler.execute',
    'discover-related-sources',
    false,
    OBSERVATION_OUTPUT,
  ),
  wraith: capability(
    'wraith',
    'secondary-retrieval',
    'source availability and response-timing observation',
    'server/services/pantheon/crawlers/wraith.ts',
    'WraithCrawler.execute',
    'observe-source-transport',
    false,
    OBSERVATION_OUTPUT,
  ),
  ice: capability(
    'ice',
    'secondary-retrieval',
    'metadata, table, form, and public-resource extraction',
    'server/services/pantheon/crawlers/ice.ts',
    'IceCrawler.execute',
    'extract-structured-evidence',
    false,
    STRUCTURED_OUTPUT,
  ),
  farm: capability(
    'farm',
    'secondary-retrieval',
    'public-evidence fingerprinting and deduplication support',
    'server/services/pantheon/crawlers/utility.ts',
    'FarmCrawler.execute',
    'observe-source-transport',
    false,
    OBSERVATION_OUTPUT,
  ),
  phantom: capability(
    'phantom',
    'secondary-retrieval',
    'low-overhead public-source observation',
    'server/services/pantheon/crawlers/utility.ts',
    'PhantomCrawler.execute',
    'observe-source-transport',
    false,
    OBSERVATION_OUTPUT,
  ),
  nova: capability(
    'nova',
    'secondary-retrieval',
    'short-budget public-source retrieval',
    'server/services/pantheon/crawlers/utility.ts',
    'NovaCrawler.execute',
    'retrieve-source',
    false,
    OBSERVATION_OUTPUT,
  ),
  'razor:identity': capability(
    'razor:identity',
    'evidence-extraction',
    'identity-field extraction from retrieved public content',
    'server/services/pantheon/razors/implementations.ts',
    'IdentityRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:contact': capability(
    'razor:contact',
    'evidence-extraction',
    'contact-field detection with sensitive output withholding',
    'server/services/pantheon/razors/implementations.ts',
    'ContactRazor.run',
    'extract-structured-evidence',
    false,
    STRUCTURED_OUTPUT,
  ),
  'razor:address': capability(
    'razor:address',
    'evidence-extraction',
    'address-field detection with sensitive output withholding',
    'server/services/pantheon/razors/implementations.ts',
    'AddressRazor.run',
    'extract-structured-evidence',
    false,
    STRUCTURED_OUTPUT,
  ),
  'razor:social': capability(
    'razor:social',
    'evidence-extraction',
    'public social-profile extraction',
    'server/services/pantheon/razors/implementations.ts',
    'SocialRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:record': capability(
    'razor:record',
    'evidence-extraction',
    'public-record identifier extraction',
    'server/services/pantheon/razors/implementations.ts',
    'RecordRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:asset': capability(
    'razor:asset',
    'evidence-extraction',
    'public asset and valuation extraction',
    'server/services/pantheon/razors/implementations.ts',
    'AssetRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:court': capability(
    'razor:court',
    'evidence-extraction',
    'court and docket field extraction',
    'server/services/pantheon/razors/implementations.ts',
    'CourtRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:business': capability(
    'razor:business',
    'evidence-extraction',
    'business and corporate field extraction',
    'server/services/pantheon/razors/implementations.ts',
    'BusinessRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:relation': capability(
    'razor:relation',
    'evidence-extraction',
    'relationship-field detection with sensitive output withholding',
    'server/services/pantheon/razors/implementations.ts',
    'RelationRazor.run',
    'extract-structured-evidence',
    false,
    STRUCTURED_OUTPUT,
  ),
  'razor:media': capability(
    'razor:media',
    'evidence-extraction',
    'news and media field extraction',
    'server/services/pantheon/razors/implementations.ts',
    'MediaRazor.run',
    'extract-structured-evidence',
    true,
    STRUCTURED_OUTPUT,
  ),
} satisfies Record<PantheonCapabilityId, PantheonCapabilityDescriptor>;

export interface PantheonTransportTask {
  transport: PantheonTransport;
  implementationPath: string;
  executableFunction: string;
  methods: readonly ('GET' | 'HEAD')[];
  task: string;
}

export const PANTHEON_TRANSPORT_TASKS = {
  'direct-http': {
    transport: 'direct-http',
    implementationPath: 'server/services/crawlers/PublicAcquisitionInfrastructure.ts',
    executableFunction: 'acquirePublicResource',
    methods: ['GET', 'HEAD'],
    task: 'canonical bounded public HTTP acquisition',
  },
  browser: {
    transport: 'browser',
    implementationPath: 'server/services/crawlers/PublicAcquisitionInfrastructure.ts',
    executableFunction: 'acquirePublicResource',
    methods: ['GET', 'HEAD'],
    task: 'canonical public read of a browser-classified source',
  },
  'search-provider': {
    transport: 'search-provider',
    implementationPath: 'server/services/crawlers/PublicAcquisitionInfrastructure.ts',
    executableFunction: 'acquirePublicResource',
    methods: ['GET', 'HEAD'],
    task: 'canonical public read of a search-provider result page',
  },
  'specialized-adapter': {
    transport: 'specialized-adapter',
    implementationPath: 'server/services/crawlers/PublicAcquisitionInfrastructure.ts',
    executableFunction: 'acquirePublicResource',
    methods: ['GET', 'HEAD'],
    task: 'canonical public read before specialized extraction',
  },
  archive: {
    transport: 'archive',
    implementationPath: 'server/services/crawlers/PublicAcquisitionInfrastructure.ts',
    executableFunction: 'acquirePublicResource',
    methods: ['GET', 'HEAD'],
    task: 'canonical public read of an archived source',
  },
} satisfies Record<PantheonTransport, PantheonTransportTask>;

const BASE_PUBLIC = ['startrek', 'blizzard', 'ice', 'farm', 'phantom', 'nova'] as const;
const IDENTITY = [...BASE_PUBLIC, 'birdofprey', 'razor:identity', 'razor:record'] as const;
const CONTACT = [...BASE_PUBLIC, 'birdofprey', 'razor:contact'] as const;
const ADDRESS = [...BASE_PUBLIC, 'birdofprey', 'razor:address', 'razor:record'] as const;
const RELATIONSHIP = [...BASE_PUBLIC, 'sixdegrees', 'lich', 'hydra', 'razor:relation'] as const;
const SOCIAL = [...BASE_PUBLIC, 'birdofprey', 'sixdegrees', 'hydra', 'razor:social', 'razor:media'] as const;
const BUSINESS = [...BASE_PUBLIC, 'birdofprey', 'razor:business', 'razor:record'] as const;
const ASSET = [...BASE_PUBLIC, 'cerberus', 'razor:asset', 'razor:record'] as const;
const LEGAL = [...BASE_PUBLIC, 'cerberus', 'birdofprey', 'razor:court', 'razor:record'] as const;
const MEDIA = [...BASE_PUBLIC, 'birdofprey', 'hydra', 'razor:media'] as const;

export const PANTHEON_CATEGORY_CAPABILITY_MATRIX = {
  'Identity & Identity Verification': IDENTITY,
  'Phone Numbers': CONTACT,
  'Email Addresses': CONTACT,
  'Current Address': ADDRESS,
  'Address History': [...ADDRESS, 'lich'],
  'Relatives & Family': RELATIONSHIP,
  'Associates & Household Connections': RELATIONSHIP,
  'Social-Media Profiles': SOCIAL,
  'Usernames & Online Accounts': SOCIAL,
  'Photos & Public Images': MEDIA,
  'Employment History': BUSINESS,
  'Education': [...BUSINESS, 'razor:identity'],
  'Professional Licenses & Credentials': [...BUSINESS, 'cerberus'],
  'Business Ownership & Affiliations': BUSINESS,
  'Property & Real Estate': ASSET,
  'Vehicles & Transportation Records': ASSET,
  'Court Records': LEGAL,
  'Criminal Records': LEGAL,
  'Arrest & Police Records': LEGAL,
  'Incarceration & Corrections': LEGAL,
  'Probation & Parole Information': LEGAL,
  'Warrants & Wanted-Person Records': LEGAL,
  'Sex-Offender Registries': LEGAL,
  'Civil Litigation & Judgments': LEGAL,
  'Bankruptcies, Liens & Financial Public Records': [...LEGAL, 'razor:asset'],
  'Marriage, Divorce & Vital-Record Information': [...RELATIONSHIP, 'cerberus', 'razor:record'],
  'News & Media Mentions': MEDIA,
  'Internet & Web Footprint': [...SOCIAL, 'wraith'],
  'Government, Political & Public-Service Records': [...LEGAL, 'razor:business'],
  'Relationship & Timeline Intelligence': [...RELATIONSHIP, 'razor:identity', 'razor:media'],
} satisfies Record<PantheonReportCategoryLabel, readonly PantheonCapabilityId[]>;

export interface PantheonExecutableWorkUnit {
  taskId: string;
  capabilityId: PantheonCapabilityId;
  categoryLabel: PantheonReportCategoryLabel;
  sourceUrl: string;
  transport: PantheonTransport;
  implementationPath: string;
  executableFunction: string;
  taskKind: PantheonTaskKind;
  skill: string;
  reportEvidenceEligible: boolean;
}

export function isPantheonReportCategoryLabel(value: string): value is PantheonReportCategoryLabel {
  return (PANTHEON_REPORT_CATEGORY_LABELS as readonly string[]).includes(value);
}

export function getPantheonCategoryCapabilities(label: string): PantheonCapabilityId[] {
  if (!isPantheonReportCategoryLabel(label)) return ['startrek', 'blizzard'];
  return [...PANTHEON_CATEGORY_CAPABILITY_MATRIX[label]];
}

export function getPantheonPrimaryCrawlerCapabilitiesForCategory(label: string): PantheonPrimaryCrawlerId[] {
  const primary = new Set<string>(PANTHEON_PRIMARY_CRAWLER_IDS);
  return getPantheonCategoryCapabilities(label)
    .filter((id): id is PantheonPrimaryCrawlerId => primary.has(id));
}

export function buildPantheonExecutableWorkUnits(input: {
  investigationId: string;
  categoryLabel: string;
  sourceUrl: string;
  transport: PantheonTransport;
}): PantheonExecutableWorkUnit[] {
  if (!isPantheonReportCategoryLabel(input.categoryLabel)) {
    throw new Error('Pantheon capability matrix rejected unknown report category: ' + input.categoryLabel);
  }
  return PANTHEON_CATEGORY_CAPABILITY_MATRIX[input.categoryLabel]
    .map(capabilityId => PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId])
    .filter(descriptor => descriptor.transports.includes(input.transport))
    .map(descriptor => ({
      taskId: [
        input.investigationId,
        input.categoryLabel,
        descriptor.id,
        input.transport,
        input.sourceUrl,
      ].join(':'),
      capabilityId: descriptor.id,
      categoryLabel: input.categoryLabel,
      sourceUrl: input.sourceUrl,
      transport: input.transport,
      implementationPath: descriptor.implementationPath,
      executableFunction: descriptor.executableFunction,
      taskKind: descriptor.taskKind,
      skill: descriptor.skill,
      reportEvidenceEligible: descriptor.reportEvidenceEligible,
    }));
}

export function validatePantheonCrawlerCapabilityMatrix(): {
  capabilityCount: number;
  categoryCount: number;
  transportCount: number;
} {
  const capabilityIds = Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[];
  const categoryLabels = Object.keys(PANTHEON_CATEGORY_CAPABILITY_MATRIX) as PantheonReportCategoryLabel[];
  const transportIds = Object.keys(PANTHEON_TRANSPORT_TASKS) as PantheonTransport[];

  if (categoryLabels.length !== 30) {
    throw new Error('Pantheon capability matrix must contain exactly 30 report categories');
  }
  for (const label of PANTHEON_REPORT_CATEGORY_LABELS) {
    const assigned = PANTHEON_CATEGORY_CAPABILITY_MATRIX[label];
    if (!assigned.length) throw new Error('Pantheon category has no executable capability: ' + label);
    if (!assigned.some(id => PANTHEON_CRAWLER_CAPABILITY_MATRIX[id].capabilityClass === 'primary-retrieval')) {
      throw new Error('Pantheon category has no primary retrieval task: ' + label);
    }
    if (!assigned.some(id => PANTHEON_CRAWLER_CAPABILITY_MATRIX[id].reportEvidenceEligible)) {
      throw new Error('Pantheon category has no report-evidence task: ' + label);
    }
  }

  for (const id of capabilityIds) {
    const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[id];
    if (!descriptor.implementationPath || !descriptor.executableFunction || !descriptor.skill) {
      throw new Error('Pantheon capability is not bound to executable work: ' + id);
    }
    if (!categoryLabels.some(label => PANTHEON_CATEGORY_CAPABILITY_MATRIX[label].includes(id))) {
      throw new Error('Pantheon capability is not permitted for any report category: ' + id);
    }
  }

  if (transportIds.length !== ALL_SOURCE_TRANSPORTS.length) {
    throw new Error('Pantheon transport task matrix is incomplete');
  }

  return {
    capabilityCount: capabilityIds.length,
    categoryCount: categoryLabels.length,
    transportCount: transportIds.length,
  };
}

export const PANTHEON_CAPABILITY_MATRIX_VALIDATION = validatePantheonCrawlerCapabilityMatrix();
