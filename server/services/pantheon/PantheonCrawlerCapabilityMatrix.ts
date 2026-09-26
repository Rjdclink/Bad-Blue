import type {
  PantheonBackgroundCategory,
  PantheonSourceTarget,
  PantheonTransport,
} from './PantheonSovereignSourceRegistry';
export type { PantheonTransport } from './PantheonSovereignSourceRegistry';

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

/**
 * Non-crypto capabilities from the platform crawler inventory that are useful
 * to a public-record background report.  Credentialed vendors are represented
 * by a disclosed, credential-free local/public-source equivalent; they never
 * impersonate a paid or authenticated upstream service.
 */
export const PANTHEON_PORTABLE_CAPABILITY_IDS = [
  'mirror',
  'key',
  'chewer',
  'computational',
  'usc',
  'woo',
  'silence',
  'seed-startrek',
  'seed-birdofprey',
  'seed-trinity',
  'seed-sixdegrees',
  'instant-legal',
  'adaptive-legal',
  'legal-crawler',
  'beneficial',
  'public-record',
  'pacer',
  'state-court',
  'county-court',
  'warrant-database',
  'sex-offender-registry',
  'fast-people-search',
  'true-people-search',
  'whitepages',
  'social-media-scraper',
  'firecrawl',
  'openrouter-web-search',
  'spiderfoot',
  'puppeteer',
  'apify',
  'crawl4ai-pattern',
] as const;

export type PantheonPrimaryCrawlerId = typeof PANTHEON_PRIMARY_CRAWLER_IDS[number];
export type PantheonSecondaryCrawlerId = typeof PANTHEON_SECONDARY_CRAWLER_IDS[number];
export type PantheonRazorSkillId = typeof PANTHEON_RAZOR_SKILL_IDS[number];
export type PantheonPortableCapabilityId = typeof PANTHEON_PORTABLE_CAPABILITY_IDS[number];
export type PantheonCapabilityId =
  | PantheonPrimaryCrawlerId
  | PantheonSecondaryCrawlerId
  | PantheonRazorSkillId
  | PantheonPortableCapabilityId;

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

export interface PantheonCategoryExtractionSchema {
  objectiveFields: readonly string[];
  preferredRazors: readonly PantheonRazorSkillId[];
  evidenceHints: readonly string[];
}

/**
 * Explicit extraction objectives for every report category. This is the
 * category-to-extractor contract: retrieval can stay generic while analysis
 * knows exactly which facts make a page useful for the requested category.
 */
export const PANTHEON_CATEGORY_EXTRACTION_SCHEMAS: Record<PantheonReportCategoryLabel, PantheonCategoryExtractionSchema> = {
  'Identity & Identity Verification': { objectiveFields: ['name','aliases','age','dateOfBirth'], preferredRazors: ['razor:identity','razor:record'], evidenceHints: ['identity','born','age','alias'] },
  'Phone Numbers': { objectiveFields: ['phone'], preferredRazors: ['razor:contact','razor:identity'], evidenceHints: ['phone','telephone','contact'] },
  'Email Addresses': { objectiveFields: ['email'], preferredRazors: ['razor:contact','razor:identity'], evidenceHints: ['email','contact'] },
  'Current Address': { objectiveFields: ['currentAddress','city','state','zip'], preferredRazors: ['razor:address','razor:identity'], evidenceHints: ['address','resides','resident'] },
  'Address History': { objectiveFields: ['addresses','from','to'], preferredRazors: ['razor:address','razor:identity'], evidenceHints: ['address','formerly','previous'] },
  'Relatives & Family': { objectiveFields: ['relationship','name'], preferredRazors: ['razor:relation','razor:identity'], evidenceHints: ['relative','family','spouse','parent'] },
  'Associates & Household Connections': { objectiveFields: ['associate','relationship'], preferredRazors: ['razor:relation','razor:identity'], evidenceHints: ['associate','household','connection'] },
  'Social-Media Profiles': { objectiveFields: ['platform','profileUrl','handle'], preferredRazors: ['razor:social','razor:identity'], evidenceHints: ['profile','facebook','linkedin','instagram'] },
  'Usernames & Online Accounts': { objectiveFields: ['username','service','profileUrl'], preferredRazors: ['razor:social','razor:identity'], evidenceHints: ['username','handle','account'] },
  'Photos & Public Images': { objectiveFields: ['imageUrl','caption','publishedAt'], preferredRazors: ['razor:media','razor:identity'], evidenceHints: ['photo','image','caption'] },
  'Employment History': { objectiveFields: ['occupation','employer','title','from','to'], preferredRazors: ['razor:identity','razor:business','razor:record'], evidenceHints: ['employment','employer','works','occupation','position'] },
  'Education': { objectiveFields: ['school','degree','field','graduation'], preferredRazors: ['razor:identity','razor:record'], evidenceHints: ['education','university','college','degree'] },
  'Professional Licenses & Credentials': { objectiveFields: ['licenseType','licenseNumber','status','issued','expires'], preferredRazors: ['razor:record','razor:identity'], evidenceHints: ['license','credential','certification'] },
  'Business Ownership & Affiliations': { objectiveFields: ['business','role','status','filing'], preferredRazors: ['razor:business','razor:record'], evidenceHints: ['business','company','owner','manager','officer'] },
  'Property & Real Estate': { objectiveFields: ['property','parcel','ownership','value','mortgage','lien'], preferredRazors: ['razor:asset','razor:record'], evidenceHints: ['property','parcel','assessor','deed','mortgage','lien'] },
  'Vehicles & Transportation Records': { objectiveFields: ['vehicle','vin','registration'], preferredRazors: ['razor:asset','razor:record'], evidenceHints: ['vehicle','vin','registration'] },
  'Court Records': { objectiveFields: ['caseNumber','court','parties','filed','status'], preferredRazors: ['razor:court','razor:record'], evidenceHints: ['court','case','docket'] },
  'Criminal Records': { objectiveFields: ['caseNumber','charge','disposition','sentence'], preferredRazors: ['razor:court','razor:record'], evidenceHints: ['criminal','charge','conviction','sentence'] },
  'Arrest & Police Records': { objectiveFields: ['agency','arrestDate','offense','status'], preferredRazors: ['razor:record','razor:court'], evidenceHints: ['arrest','police','sheriff','booking'] },
  'Incarceration & Corrections': { objectiveFields: ['custodyStatus','facility','inmateNumber','releaseDate'], preferredRazors: ['razor:record','razor:identity'], evidenceHints: ['inmate','custody','incarcerated','corrections','prison'] },
  'Probation & Parole Information': { objectiveFields: ['supervisionType','status','agency','endDate'], preferredRazors: ['razor:record','razor:court'], evidenceHints: ['probation','parole','supervision'] },
  'Warrants & Wanted-Person Records': { objectiveFields: ['warrantStatus','agency','offense','issued'], preferredRazors: ['razor:record','razor:court'], evidenceHints: ['warrant','wanted'] },
  'Sex-Offender Registries': { objectiveFields: ['registryStatus','jurisdiction','record'], preferredRazors: ['razor:record','razor:identity'], evidenceHints: ['registry','offender'] },
  'Civil Litigation & Judgments': { objectiveFields: ['caseNumber','parties','judgment','status'], preferredRazors: ['razor:court','razor:record'], evidenceHints: ['civil','lawsuit','judgment'] },
  'Bankruptcies, Liens & Financial Public Records': { objectiveFields: ['bankruptcy','lien','judgment','filing'], preferredRazors: ['razor:court','razor:asset','razor:record'], evidenceHints: ['bankruptcy','lien','financial','judgment'] },
  'Marriage, Divorce & Vital-Record Information': { objectiveFields: ['eventType','date','parties','jurisdiction'], preferredRazors: ['razor:relation','razor:record','razor:identity'], evidenceHints: ['marriage','divorce','birth','death','vital'] },
  'News & Media Mentions': { objectiveFields: ['headline','publisher','date','author','url'], preferredRazors: ['razor:media','razor:identity'], evidenceHints: ['news','published','headline','article'] },
  'Internet & Web Footprint': { objectiveFields: ['url','service','username','mention'], preferredRazors: ['razor:social','razor:media','razor:identity'], evidenceHints: ['profile','website','account','mention'] },
  'Government, Political & Public-Service Records': { objectiveFields: ['agency','office','role','term','filing'], preferredRazors: ['razor:record','razor:business','razor:media'], evidenceHints: ['government','agency','office','public service'] },
  'Relationship & Timeline Intelligence': { objectiveFields: ['date','event','relationship','source'], preferredRazors: ['razor:relation','razor:identity','razor:media'], evidenceHints: ['timeline','relationship','associated','dated'] },
};

export function getPantheonCategoryExtractionSchema(label: string): PantheonCategoryExtractionSchema {
  if (!(PANTHEON_REPORT_CATEGORY_LABELS as readonly string[]).includes(label)) {
    throw new Error('Pantheon extraction schema rejected unknown report category: ' + label);
  }
  return PANTHEON_CATEGORY_EXTRACTION_SCHEMAS[label as PantheonReportCategoryLabel];
}


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
  executionMode?: 'native' | 'credential-free-equivalent';
  replacementDisclosure?: string;
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
  const transports: readonly PantheonTransport[] = capabilityClass === 'evidence-extraction'
    ? ALL_SOURCE_TRANSPORTS
    : taskKind === 'discover-related-sources'
      ? ['direct-http', 'browser', 'search-provider', 'archive']
      : taskKind === 'observe-source-transport'
        ? ['direct-http', 'browser', 'archive']
      : ['direct-http', 'browser', 'search-provider', 'specialized-adapter', 'archive'];
  return {
    id,
    capabilityClass,
    skill,
    implementationPath,
    executableFunction,
    taskKind,
    transports,
    outputFields,
    reportEvidenceEligible,
  };
}

const SOURCE_OUTPUT = ['sourceUrl', 'content', 'confidence', 'retrievedAt'] as const;
const STRUCTURED_OUTPUT = ['sourceUrl', 'structuredData', 'confidence', 'extractionTimeMs'] as const;
const OBSERVATION_OUTPUT = ['sourceUrl', 'status', 'timingMs', 'retrievedAt'] as const;

const PORTABLE_SPECS: ReadonlyArray<{
  id: PantheonPortableCapabilityId;
  skill: string;
  taskKind: PantheonTaskKind;
  disclosure: string;
}> = [
  { id: 'mirror', skill: 'source canonicalization and cross-source consistency comparison', taskKind: 'observe-source-transport', disclosure: 'Production deterministic mirror-equivalent over live source content.' },
  { id: 'key', skill: 'subject-token and identity-key extraction', taskKind: 'extract-structured-evidence', disclosure: 'Production deterministic identity-key equivalent over live source content.' },
  { id: 'chewer', skill: 'structured field and document-shape extraction', taskKind: 'extract-structured-evidence', disclosure: 'Production deterministic structured-extraction equivalent over live source content.' },
  { id: 'computational', skill: 'pattern frequency and corroboration analysis', taskKind: 'extract-structured-evidence', disclosure: 'Production deterministic pattern-analysis equivalent over live source content.' },
  { id: 'usc', skill: 'source consistency and provenance verification', taskKind: 'observe-source-transport', disclosure: 'Production deterministic coordination/verification equivalent over live source content.' },
  { id: 'woo', skill: 'co-occurrence and relationship signal analysis', taskKind: 'extract-structured-evidence', disclosure: 'Production deterministic relationship-analysis equivalent over live source content.' },
  { id: 'silence', skill: 'expected-field gap and blind-spot analysis', taskKind: 'extract-structured-evidence', disclosure: 'Production deterministic gap-analysis equivalent over live source content.' },
  { id: 'seed-startrek', skill: 'seed-page link and authority discovery', taskKind: 'discover-related-sources', disclosure: 'Local seed discovery replaces Firecrawl-dependent seed fetching.' },
  { id: 'seed-birdofprey', skill: 'seed-page DOM and navigation discovery', taskKind: 'discover-related-sources', disclosure: 'Local HTML/DOM discovery replaces remote-browser-dependent seed fetching.' },
  { id: 'seed-trinity', skill: 'seed response verification and link discovery', taskKind: 'discover-related-sources', disclosure: 'Canonical live acquisition supplies verified seed content.' },
  { id: 'seed-sixdegrees', skill: 'seed relationship-link graph extraction', taskKind: 'discover-related-sources', disclosure: 'Local relationship graph extraction over verified seed content.' },
  { id: 'instant-legal', skill: 'legal authority and citation signal extraction', taskKind: 'extract-structured-evidence', disclosure: 'Credential-free legal extraction over verified public sources.' },
  { id: 'adaptive-legal', skill: 'adaptive legal-document structure analysis', taskKind: 'extract-structured-evidence', disclosure: 'Credential-free deterministic legal pattern equivalent.' },
  { id: 'legal-crawler', skill: 'case-law statute and regulation field extraction', taskKind: 'extract-structured-evidence', disclosure: 'Public-source legal crawler equivalent uses the canonical acquisition result.' },
  { id: 'beneficial', skill: 'beneficial ownership and affiliation signal analysis', taskKind: 'extract-structured-evidence', disclosure: 'Public filing analysis replaces credentialed ownership enrichment.' },
  { id: 'public-record', skill: 'public-record identifier and change-signal extraction', taskKind: 'extract-structured-evidence', disclosure: 'Local public-record extractor over lawful live sources.' },
  { id: 'pacer', skill: 'federal docket signal extraction from public court/RECAP sources', taskKind: 'extract-structured-evidence', disclosure: 'No PACER access is claimed; public court opinions, RECAP pages, and open bulk records are used.' },
  { id: 'state-court', skill: 'state-court case and docket field extraction', taskKind: 'extract-structured-evidence', disclosure: 'Public state-court source adapter.' },
  { id: 'county-court', skill: 'county-court case and docket field extraction', taskKind: 'extract-structured-evidence', disclosure: 'Public county-court source adapter.' },
  { id: 'warrant-database', skill: 'official wanted-person and warrant field extraction', taskKind: 'extract-structured-evidence', disclosure: 'Official public warrant-source adapter; blocked portals remain disclosed.' },
  { id: 'sex-offender-registry', skill: 'official registry field extraction', taskKind: 'extract-structured-evidence', disclosure: 'Official public registry adapter; challenges are never bypassed.' },
  { id: 'fast-people-search', skill: 'identity contact and address signals from lawful public sources', taskKind: 'extract-structured-evidence', disclosure: 'Commercial site scraping is not claimed; lawful public-source equivalent is used.' },
  { id: 'true-people-search', skill: 'identity corroboration from lawful public sources', taskKind: 'extract-structured-evidence', disclosure: 'Commercial site scraping is not claimed; lawful public-source equivalent is used.' },
  { id: 'whitepages', skill: 'public contact-directory field extraction', taskKind: 'extract-structured-evidence', disclosure: 'Authenticated directory access is not claimed; lawful public-source equivalent is used.' },
  { id: 'social-media-scraper', skill: 'public social-profile link and handle extraction', taskKind: 'discover-related-sources', disclosure: 'Only public HTML links are analyzed; authentication and challenges are not bypassed.' },
  { id: 'firecrawl', skill: 'HTML-to-text and link extraction', taskKind: 'extract-structured-evidence', disclosure: 'Local Cheerio-style extraction replaces the Firecrawl cloud API.' },
  { id: 'openrouter-web-search', skill: 'deterministic search-result parsing and ranking', taskKind: 'discover-related-sources', disclosure: 'Deterministic parsing replaces OpenRouter and does not use generated evidence.' },
  { id: 'spiderfoot', skill: 'public identifier and relationship pivot extraction', taskKind: 'extract-structured-evidence', disclosure: 'Local passive OSINT pivots replace a remote SpiderFoot service.' },
  { id: 'puppeteer', skill: 'DOM-derived text link and metadata extraction', taskKind: 'extract-structured-evidence', disclosure: 'Local DOM parsing is used; remote browser credentials are not required.' },
  { id: 'apify', skill: 'bounded extraction task scheduling and result shaping', taskKind: 'extract-structured-evidence', disclosure: 'The internal bounded scheduler replaces the Apify cloud task runner.' },
  { id: 'crawl4ai-pattern', skill: 'adaptive semantic pattern extraction', taskKind: 'extract-structured-evidence', disclosure: 'Local deterministic pattern extraction replaces a separately hosted Crawl4AI service.' },
];

const PORTABLE_CAPABILITIES = Object.fromEntries(PORTABLE_SPECS.map(spec => [spec.id, {
  id: spec.id,
  capabilityClass: spec.taskKind === 'extract-structured-evidence' ? 'evidence-extraction' : 'secondary-retrieval',
  skill: spec.skill,
  implementationPath: 'server/services/pantheon/PantheonPortableCapabilityExecutor.ts',
  executableFunction: 'runPortablePantheonCapabilities',
  taskKind: spec.taskKind,
  transports: ALL_SOURCE_TRANSPORTS,
  outputFields: spec.taskKind === 'observe-source-transport' ? OBSERVATION_OUTPUT : STRUCTURED_OUTPUT,
  reportEvidenceEligible: false,
  executionMode: 'credential-free-equivalent',
  replacementDisclosure: spec.disclosure,
}])) as unknown as Record<PantheonPortableCapabilityId, PantheonCapabilityDescriptor>;

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
    true,
    STRUCTURED_OUTPUT,
  ),
  'razor:address': capability(
    'razor:address',
    'evidence-extraction',
    'address-field detection with sensitive output withholding',
    'server/services/pantheon/razors/implementations.ts',
    'AddressRazor.run',
    'extract-structured-evidence',
    true,
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
    true,
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
  ...PORTABLE_CAPABILITIES,
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

const UNIVERSAL_PORTABLE = [
  'mirror', 'key', 'chewer', 'computational', 'usc', 'woo', 'silence',
  'seed-startrek', 'seed-birdofprey', 'seed-trinity', 'seed-sixdegrees',
  'firecrawl', 'openrouter-web-search', 'spiderfoot', 'puppeteer', 'apify', 'crawl4ai-pattern',
] as const;
const PEOPLE_PORTABLE = ['fast-people-search', 'true-people-search', 'whitepages'] as const;
const LEGAL_PORTABLE = ['instant-legal', 'adaptive-legal', 'legal-crawler', 'public-record'] as const;
const BUSINESS_PORTABLE = ['beneficial', 'public-record'] as const;

const BASE_PUBLIC = ['startrek', 'blizzard', 'ice', 'farm', 'phantom', 'nova', ...UNIVERSAL_PORTABLE] as const;
const IDENTITY = [...BASE_PUBLIC, ...PEOPLE_PORTABLE, 'birdofprey', 'razor:identity', 'razor:record'] as const;
const CONTACT = [...BASE_PUBLIC, ...PEOPLE_PORTABLE, 'birdofprey', 'razor:contact'] as const;
const ADDRESS = [...BASE_PUBLIC, ...PEOPLE_PORTABLE, 'birdofprey', 'razor:address', 'razor:record'] as const;
const RELATIONSHIP = [...BASE_PUBLIC, 'sixdegrees', 'lich', 'hydra', 'razor:relation'] as const;
const SOCIAL = [...BASE_PUBLIC, 'social-media-scraper', 'birdofprey', 'sixdegrees', 'hydra', 'razor:social', 'razor:media'] as const;
const BUSINESS = [...BASE_PUBLIC, ...BUSINESS_PORTABLE, 'birdofprey', 'razor:business', 'razor:record'] as const;
const ASSET = [...BASE_PUBLIC, 'public-record', 'cerberus', 'razor:asset', 'razor:record'] as const;
const LEGAL = [...BASE_PUBLIC, ...LEGAL_PORTABLE, 'cerberus', 'birdofprey', 'razor:court', 'razor:record'] as const;
const COURT = [...LEGAL, 'pacer', 'state-court', 'county-court'] as const;
const REGIONAL_LEGAL = [...LEGAL, 'state-court', 'county-court'] as const;
const WARRANT = [...LEGAL, 'warrant-database'] as const;
const SEX_OFFENDER = [...LEGAL, 'sex-offender-registry'] as const;
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
  'Court Records': COURT,
  'Criminal Records': COURT,
  'Arrest & Police Records': REGIONAL_LEGAL,
  'Incarceration & Corrections': LEGAL,
  'Probation & Parole Information': LEGAL,
  'Warrants & Wanted-Person Records': WARRANT,
  'Sex-Offender Registries': SEX_OFFENDER,
  'Civil Litigation & Judgments': COURT,
  'Bankruptcies, Liens & Financial Public Records': [...COURT, 'razor:asset'],
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
  applicable: boolean;
  sourceUrl?: string;
  transport?: PantheonTransport;
  sourceRegistryCategory?: PantheonBackgroundCategory;
  sourceKind?: NonNullable<PantheonSourceTarget['sourceKind']>;
  sourceAuthority?: PantheonSourceTarget['authority'];
  sourceJurisdiction?: string;
  workType?: PantheonExecutableSource['workType'];
  subjectScoped?: boolean;
  implementationPath: string;
  executableFunction: string;
  taskKind: PantheonTaskKind;
  skill: string;
  reportEvidenceEligible: boolean;
  state: 'pending' | 'running' | 'retryable' | 'completed' | 'failed' | 'timed_out' | 'unavailable' | 'not_applicable';
  attempts: number;
  attemptedSourceUrls: string[];
  outcome?: string;
  reason?: string;
  executionMode: 'native' | 'credential-free-equivalent';
  replacementDisclosure?: string;
}

export const PANTHEON_CAPABILITY_MAX_ATTEMPTS = 3;

export interface PantheonExecutableSource {
  sourceUrl: string;
  transport: PantheonTransport;
  registryCategory?: PantheonBackgroundCategory;
  sourceKind?: NonNullable<PantheonSourceTarget['sourceKind']>;
  authority?: PantheonSourceTarget['authority'];
  jurisdiction?: string;
  workType?: 'authoritative-source' | 'discovery-search' | 'source-navigation' | 'candidate-validation' | 'corroboration';
  subjectScoped?: boolean;
  priority?: number;
}

const SEARCH_PAGE_CAPABILITIES = new Set<PantheonCapabilityId>([
  ...PANTHEON_PRIMARY_CRAWLER_IDS.filter(id => id !== 'sixdegrees'),
  'seed-startrek',
  'seed-birdofprey',
  'seed-trinity',
  'seed-sixdegrees',
  'openrouter-web-search',
]);

const PEOPLE_SOURCE_CATEGORIES = new Set<PantheonBackgroundCategory>([
  'identity', 'residence', 'contacts', 'relatives', 'associates', 'social',
  'usernames', 'professional-web', 'identity-resolution', 'historical',
]);
const SOCIAL_SOURCE_CATEGORIES = new Set<PantheonBackgroundCategory>([
  'social', 'usernames', 'internet', 'professional-web', 'domain-web',
]);
const BUSINESS_SOURCE_CATEGORIES = new Set<PantheonBackgroundCategory>([
  'employment', 'education', 'credentials', 'business', 'corporate',
  'organizations', 'nonprofits', 'professional-discipline',
]);
const LEGAL_SOURCE_CATEGORIES = new Set<PantheonBackgroundCategory>([
  'courts', 'civil-litigation', 'criminal', 'arrests', 'corrections',
  'probation-parole', 'warrants', 'sex-offender', 'bankruptcy',
  'financial-public', 'family-probate', 'vital-records', 'regulatory',
  'sanctions', 'government-employment', 'campaign-finance', 'lobbying',
  'government-contracting',
]);

function sourceHostAndPath(sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return sourceUrl.toLowerCase();
  }
}

/**
 * Source-skill admission gate.
 *
 * Pantheon follows the same separation used by mature crawler frontiers:
 * discovery pages discover URLs, while record-specific extractors execute only
 * on admitted authoritative candidates that fit their declared skill. A
 * transport match alone is deliberately insufficient.
 */
export function isPantheonCapabilitySourceCompatible(
  capabilityId: PantheonCapabilityId,
  source: PantheonExecutableSource,
): boolean {
  const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId];
  if (!descriptor.transports.includes(source.transport)) return false;

  const category = source.registryCategory;
  const sourceKind = source.sourceKind || (source.transport === 'search-provider' ? 'search' : 'public-page');
  const discoveryPage = source.transport === 'search-provider'
    || sourceKind === 'search'
    || source.workType === 'discovery-search';
  if (discoveryPage) return SEARCH_PAGE_CAPABILITIES.has(capabilityId);

  if (capabilityId === 'openrouter-web-search') return false;
  if (capabilityId === 'social-media-scraper') return Boolean(category && SOCIAL_SOURCE_CATEGORIES.has(category));
  if (['fast-people-search', 'true-people-search', 'whitepages'].includes(capabilityId)) {
    return Boolean(category && PEOPLE_SOURCE_CATEGORIES.has(category));
  }
  if (capabilityId === 'beneficial') return Boolean(category && BUSINESS_SOURCE_CATEGORIES.has(category));
  if (['instant-legal', 'adaptive-legal', 'legal-crawler'].includes(capabilityId)) {
    return Boolean(category && LEGAL_SOURCE_CATEGORIES.has(category));
  }
  if (capabilityId === 'warrant-database') return category === 'warrants';
  if (capabilityId === 'sex-offender-registry') return category === 'sex-offender';

  const hostAndPath = sourceHostAndPath(source.sourceUrl);
  if (capabilityId === 'pacer') {
    return Boolean(category && ['courts', 'civil-litigation', 'bankruptcy'].includes(category))
      && /(?:courtlistener|recap|uscourts|pacer|bankruptcy|district-court|govinfo)/.test(hostAndPath);
  }
  if (capabilityId === 'state-court') {
    return Boolean(category && LEGAL_SOURCE_CATEGORIES.has(category))
      && (/^US-[A-Z]{2}$/i.test(source.jurisdiction || '')
        || /(?:state\.[a-z]{2}\.us|judicial|judiciary|courts?\.)/.test(hostAndPath));
  }
  if (capabilityId === 'county-court') {
    return Boolean(category && LEGAL_SOURCE_CATEGORIES.has(category))
      && /(?:county|clerk|circuitcourt|districtcourt|municipalcourt)/.test(hostAndPath);
  }

  // Every remaining capability is already category allow-listed. Non-search
  // sources may therefore be routed by that declared category skill.
  return true;
}

export function isPantheonExecutableWorkSchedulable(
  unit: Pick<PantheonExecutableWorkUnit, 'state'>,
): boolean {
  return unit.state === 'pending' || unit.state === 'retryable';
}

export function isPantheonReportCategoryLabel(value: string): value is PantheonReportCategoryLabel {
  return (PANTHEON_REPORT_CATEGORY_LABELS as readonly string[]).includes(value);
}

function categoryCapabilities(label: PantheonReportCategoryLabel): readonly PantheonCapabilityId[] {
  return PANTHEON_CATEGORY_CAPABILITY_MATRIX[label] as readonly PantheonCapabilityId[];
}

export function getPantheonCategoryCapabilities(label: string): PantheonCapabilityId[] {
  if (!isPantheonReportCategoryLabel(label)) {
    throw new Error('Pantheon capability matrix rejected unknown report category: ' + label);
  }
  return [...categoryCapabilities(label)];
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
  registryCategory?: PantheonBackgroundCategory;
  sourceKind?: NonNullable<PantheonSourceTarget['sourceKind']>;
  authority?: PantheonSourceTarget['authority'];
  jurisdiction?: string;
  workType?: PantheonExecutableSource['workType'];
  subjectScoped?: boolean;
  priority?: number;
}): PantheonExecutableWorkUnit[] {
  if (!isPantheonReportCategoryLabel(input.categoryLabel)) {
    throw new Error('Pantheon capability matrix rejected unknown report category: ' + input.categoryLabel);
  }
  const categoryLabel: PantheonReportCategoryLabel = input.categoryLabel;
  const source: PantheonExecutableSource = input;
  return categoryCapabilities(categoryLabel)
    .map(capabilityId => PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId])
    .filter(descriptor => isPantheonCapabilitySourceCompatible(descriptor.id, source))
    .map(descriptor => ({
      taskId: [
        input.investigationId,
        input.categoryLabel,
        descriptor.id,
        input.transport,
        input.sourceUrl,
      ].join(':'),
      capabilityId: descriptor.id,
      categoryLabel,
      applicable: true,
      sourceUrl: input.sourceUrl,
      transport: input.transport,
      sourceRegistryCategory: input.registryCategory,
      sourceKind: input.sourceKind,
      sourceAuthority: input.authority,
      sourceJurisdiction: input.jurisdiction,
      workType: input.workType,
      subjectScoped: input.subjectScoped,
      implementationPath: descriptor.implementationPath,
      executableFunction: descriptor.executableFunction,
      taskKind: descriptor.taskKind,
      skill: descriptor.skill,
      reportEvidenceEligible: descriptor.reportEvidenceEligible,
      state: 'pending' as const,
      attempts: 0,
      attemptedSourceUrls: [],
      executionMode: descriptor.executionMode || 'native',
      replacementDisclosure: descriptor.replacementDisclosure,
    }));
}

/**
 * Builds one persisted logical work unit for every configured capability.
 *
 * Applicable capabilities are bound to a transport-compatible live source.
 * Capabilities outside the category are explicitly persisted as
 * `not_applicable`; a missing compatible source is explicit `unavailable`.
 * Previous terminal work remains terminal on resume, while interrupted or
 * retryable work can only return as `retryable` and receive an eligible source.
 */
export function buildPantheonCapabilityWorkLedger(input: {
  investigationId: string;
  categoryLabel: string;
  sources: readonly PantheonExecutableSource[];
  unavailableReasons?: Partial<Record<PantheonCapabilityId, string>>;
  previous?: readonly PantheonExecutableWorkUnit[];
}): PantheonExecutableWorkUnit[] {
  if (!isPantheonReportCategoryLabel(input.categoryLabel)) {
    throw new Error('Pantheon capability matrix rejected unknown report category: ' + input.categoryLabel);
  }
  const categoryLabel = input.categoryLabel;
  const permitted = new Set(categoryCapabilities(categoryLabel));
  const previousByCapability = new Map((input.previous || []).map(unit => [unit.capabilityId, unit]));
  const uniqueSources = [...new Map(input.sources.map(source => [
    `${source.transport}:${source.sourceUrl}`,
    source,
  ])).values()];
  const executableByCapability = new Map<PantheonCapabilityId, PantheonExecutableWorkUnit[]>();

  for (const source of uniqueSources) {
    for (const unit of buildPantheonExecutableWorkUnits({
      investigationId: input.investigationId,
      categoryLabel,
      ...source,
    })) {
      const current = executableByCapability.get(unit.capabilityId) || [];
      current.push(unit);
      executableByCapability.set(unit.capabilityId, current);
    }
  }

  let assignmentIndex = 0;
  return (Object.keys(PANTHEON_CRAWLER_CAPABILITY_MATRIX) as PantheonCapabilityId[]).map(capabilityId => {
    const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[capabilityId];
    const previous = previousByCapability.get(capabilityId);
    const base = {
      taskId: `${input.investigationId}:${categoryLabel}:${capabilityId}`,
      capabilityId,
      categoryLabel,
      implementationPath: descriptor.implementationPath,
      executableFunction: descriptor.executableFunction,
      taskKind: descriptor.taskKind,
      skill: descriptor.skill,
      reportEvidenceEligible: descriptor.reportEvidenceEligible,
      attempts: Number(previous?.attempts || 0),
      attemptedSourceUrls: [...(previous?.attemptedSourceUrls || [])],
      executionMode: descriptor.executionMode || 'native' as const,
      replacementDisclosure: descriptor.replacementDisclosure,
    };

    if (!permitted.has(capabilityId)) {
      return {
        ...base,
        applicable: false,
        state: 'not_applicable' as const,
        reason: 'Capability is not permitted for this report category by the capability matrix',
      };
    }

    const unavailableReason = input.unavailableReasons?.[capabilityId];
    if (unavailableReason) {
      return {
        ...base,
        applicable: true,
        state: 'unavailable' as const,
        reason: unavailableReason,
      };
    }

    const compatible = [...(executableByCapability.get(capabilityId) || [])].sort((left, right) => {
      const preference = (transport: PantheonTransport | undefined) => {
        if (descriptor.taskKind === 'discover-related-sources') return transport === 'search-provider' ? 0 : 1;
        if (descriptor.taskKind === 'extract-structured-evidence' || descriptor.taskKind === 'observe-source-transport') {
          return transport === 'search-provider' ? 2 : 0;
        }
        return transport === 'search-provider' ? 2 : 0;
      };
      return preference(left.transport) - preference(right.transport);
    });
    const previousCompatible = previous?.sourceUrl
      ? compatible.find(unit => unit.sourceUrl === previous.sourceUrl && unit.transport === previous.transport)
      : undefined;
    const previousCompletedSourceCompatible = previous?.sourceUrl && previous.transport
      && previous.sourceRegistryCategory
      ? isPantheonCapabilitySourceCompatible(capabilityId, {
          sourceUrl: previous.sourceUrl,
          transport: previous.transport,
          registryCategory: previous.sourceRegistryCategory,
          sourceKind: previous.sourceKind,
          authority: previous.sourceAuthority,
          jurisdiction: previous.sourceJurisdiction,
          workType: previous.workType,
          subjectScoped: previous.subjectScoped,
        })
      : Boolean(previousCompatible);
    if (previous?.state === 'completed' && previousCompletedSourceCompatible) {
      return { ...previous, attemptedSourceUrls: [...previous.attemptedSourceUrls] };
    }
    if (previous && ['failed', 'timed_out'].includes(previous.state)
      && previous.attempts >= PANTHEON_CAPABILITY_MAX_ATTEMPTS) {
      return {
        ...previous,
        state: previous.state,
        attemptedSourceUrls: [...previous.attemptedSourceUrls],
        reason: previous.reason || 'Capability retry budget exhausted',
      };
    }
    if (!compatible.length) {
      return {
        ...base,
        applicable: true,
        state: 'unavailable' as const,
        reason: 'No admitted live source matches this capability\'s declared skill, category, and transport requirements',
      };
    }

    const candidate = previousCompatible || compatible[assignmentIndex++ % compatible.length];
    const resumed = previous && ['running', 'retryable', 'failed', 'timed_out'].includes(previous.state);
    return {
      ...base,
      applicable: true,
      sourceUrl: candidate.sourceUrl,
      transport: candidate.transport,
      sourceRegistryCategory: candidate.sourceRegistryCategory,
      sourceKind: candidate.sourceKind,
      sourceAuthority: candidate.sourceAuthority,
      sourceJurisdiction: candidate.sourceJurisdiction,
      workType: candidate.workType,
      subjectScoped: candidate.subjectScoped,
      state: resumed ? 'retryable' as const : 'pending' as const,
      ...(resumed ? { reason: previous.reason || 'Interrupted capability work is eligible for controlled retry' } : {}),
    };
  });
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
    const extractionSchema = PANTHEON_CATEGORY_EXTRACTION_SCHEMAS[label];
    if (!extractionSchema || !extractionSchema.objectiveFields.length || !extractionSchema.preferredRazors.length || !extractionSchema.evidenceHints.length) {
      throw new Error('Pantheon category has no complete extraction schema: ' + label);
    }
    const assigned = categoryCapabilities(label);
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
    if (!categoryLabels.some(label => categoryCapabilities(label).includes(id))) {
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
