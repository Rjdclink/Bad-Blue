export type LexaraCrawlerCapability =
  | 'legal-authority'
  | 'case-law'
  | 'statutes'
  | 'regulations'
  | 'federal-docket'
  | 'criminal-records'
  | 'public-records'
  | 'people-search'
  | 'social-graph'
  | 'social-media'
  | 'identity'
  | 'contact'
  | 'address'
  | 'assets'
  | 'business'
  | 'relationships'
  | 'media'
  | 'web-discovery'
  | 'deep-crawl'
  | 'semantic-extraction'
  | 'change-detection'
  | 'verification'
  | 'pattern-analysis'
  | 'blind-spot-analysis'
  | 'structured-extraction'
  | 'market-observation'
  | 'crypto-observation'
  | 'occupation'
  | 'incarceration'
  | 'vital-records';

export type LexaraCrawlerFamily =
  | 'pantheon-core'
  | 'seven-crawler'
  | 'pantheon-secondary'
  | 'razor'
  | 'seed-first'
  | 'legal'
  | 'criminal'
  | 'people'
  | 'external'
  | 'crypto-observational';

export type LexaraCrawlerExecutionMode =
  | 'retrieval'
  | 'analysis'
  | 'extractor'
  | 'external'
  | 'observational';

export interface LexaraCrawlerDescriptor {
  id: string;
  displayName: string;
  family: LexaraCrawlerFamily;
  implementationPath: string;
  capabilities: readonly LexaraCrawlerCapability[];
  executionMode: LexaraCrawlerExecutionMode;
  latencyClass: 'instant' | 'fast' | 'deep';
  configured?: () => boolean;
  notes?: string;
}

const always = () => true;
const hasPacer = () => !!(process.env.PACER_USERNAME?.trim() && process.env.PACER_PASSWORD?.trim());
const hasSpiderFoot = () => !!process.env.SPIDERFOOT_URL?.trim();
const hasBrowser = () => !!process.env.BROWSER_WS_ENDPOINT?.trim();

function c(
  id: string,
  displayName: string,
  family: LexaraCrawlerFamily,
  implementationPath: string,
  capabilities: readonly LexaraCrawlerCapability[],
  executionMode: LexaraCrawlerExecutionMode,
  latencyClass: 'instant' | 'fast' | 'deep',
  configured: () => boolean = always,
  notes?: string,
): LexaraCrawlerDescriptor {
  return { id, displayName, family, implementationPath, capabilities, executionMode, latencyClass, configured, notes };
}

/**
 * Canonical Lexara crawler capability inventory.
 *
 * Every real crawler/scraper/retrieval component in the platform is represented
 * here once. Selection is need-driven: Lexara never fans out to the whole pool
 * merely because it exists.
 */
export const LEXARA_CRAWLER_CAPABILITY_POOL: readonly LexaraCrawlerDescriptor[] = [
  c('startrek', 'StarTrekCrawler', 'pantheon-core', 'server/services/crawlers/StarTrekCrawler.ts', ['web-discovery', 'deep-crawl'], 'retrieval', 'fast'),
  c('birdofprey', 'BirdOfPreyCrawler', 'pantheon-core', 'server/services/crawlers/BirdOfPreyCrawler.ts', ['web-discovery', 'deep-crawl'], 'retrieval', 'fast'),
  c('sixdegrees', 'SixDegreesCrawler', 'pantheon-core', 'server/services/crawlers/SixDegreesCrawler.ts', ['social-graph', 'relationships', 'verification'], 'retrieval', 'deep'),
  c('blizzard', 'BlizzardCrawler', 'pantheon-core', 'server/services/crawlers/TrinityCrawlers.ts', ['web-discovery', 'deep-crawl'], 'retrieval', 'deep'),
  c('cerberus', 'CerberusCrawler', 'pantheon-core', 'server/services/crawlers/TrinityCrawlers.ts', ['web-discovery', 'verification', 'deep-crawl'], 'retrieval', 'deep'),
  c('lich', 'LichCrawler', 'pantheon-core', 'server/services/crawlers/TrinityCrawlers.ts', ['deep-crawl', 'verification'], 'retrieval', 'deep'),

  c('mirror', 'MirrorCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['verification', 'pattern-analysis'], 'analysis', 'fast'),
  c('key', 'KeyCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['identity', 'vital-records', 'verification', 'pattern-analysis'], 'analysis', 'fast'),
  c('chewer', 'ChewerCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['structured-extraction', 'occupation', 'vital-records', 'incarceration', 'pattern-analysis'], 'analysis', 'fast'),
  c('computational', 'ComputationalCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['pattern-analysis', 'verification'], 'analysis', 'fast'),
  c('usc', 'USCCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['verification', 'pattern-analysis'], 'analysis', 'fast'),
  c('woo', 'WooCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['pattern-analysis'], 'analysis', 'fast'),
  c('silence', 'SilenceCrawler', 'seven-crawler', 'server/services/crawlers/SixCrawlerInitiative.ts', ['blind-spot-analysis', 'verification'], 'analysis', 'fast'),

  c('ice', 'IceCrawler', 'pantheon-secondary', 'server/services/pantheon/crawlers/ice.ts', ['structured-extraction', 'public-records', 'occupation', 'vital-records', 'incarceration', 'change-detection'], 'retrieval', 'fast'),
  c('hydra', 'HydraCrawler', 'pantheon-secondary', 'server/services/pantheon/crawlers/hydra.ts', ['web-discovery', 'deep-crawl'], 'retrieval', 'deep'),
  c('wraith', 'WraithCrawler', 'pantheon-secondary', 'server/services/pantheon/crawlers/wraith.ts', ['web-discovery', 'verification'], 'retrieval', 'fast'),
  c('farm', 'FarmCrawler', 'pantheon-secondary', 'server/services/pantheon/crawlers/utility.ts', ['verification', 'structured-extraction', 'change-detection'], 'retrieval', 'fast', always, 'Public-evidence fingerprinting and deduplication only.'),
  c('phantom', 'PhantomCrawler', 'pantheon-secondary', 'server/services/pantheon/crawlers/utility.ts', ['web-discovery', 'verification'], 'retrieval', 'fast'),
  c('nova', 'NovaCrawler', 'pantheon-secondary', 'server/services/pantheon/crawlers/utility.ts', ['web-discovery', 'legal-authority'], 'retrieval', 'instant'),

  c('razor-identity', 'IdentityRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['identity', 'vital-records', 'occupation', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-contact', 'ContactRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['contact', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-address', 'AddressRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['address', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-social', 'SocialRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['social-media', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-record', 'RecordRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['public-records', 'incarceration', 'occupation', 'vital-records', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-asset', 'AssetRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['assets', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-court', 'CourtRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['case-law', 'public-records', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-business', 'BusinessRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['business', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-relation', 'RelationRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['relationships', 'structured-extraction'], 'extractor', 'instant'),
  c('razor-media', 'MediaRazor', 'razor', 'server/services/pantheon/razors/implementations.ts', ['media', 'structured-extraction'], 'extractor', 'instant'),

  c('seed-birdofprey', 'SeedFetchBirdOfPrey', 'seed-first', 'server/services/crawlers/seedFirst/SeedFetchBirdOfPrey.ts', ['web-discovery', 'deep-crawl'], 'retrieval', 'fast', hasBrowser),
  c('seed-trinity', 'SeedFetchTrinity', 'seed-first', 'server/services/crawlers/seedFirst/SeedFetchTrinity.ts', ['web-discovery', 'verification'], 'retrieval', 'fast'),
  c('seed-sixdegrees', 'SeedFetchSixDegrees', 'seed-first', 'server/services/crawlers/seedFirst/SeedFetchSixDegrees.ts', ['social-graph', 'relationships'], 'retrieval', 'deep'),

  c('instant-legal', 'InstantLegalCrawler', 'legal', 'server/services/alexara/instantLegalCrawler.ts', ['legal-authority', 'case-law', 'statutes', 'regulations'], 'retrieval', 'fast'),
  c('adaptive-legal', 'AdaptiveCrawler', 'legal', 'server/services/legalIntelligence/adaptiveCrawler.ts', ['legal-authority', 'semantic-extraction', 'deep-crawl'], 'retrieval', 'deep'),
  c('legal-crawler', 'LegalCrawler', 'legal', 'server/legalCrawler.ts', ['legal-authority', 'case-law', 'statutes', 'regulations'], 'retrieval', 'deep'),
  c('beneficial', 'BeneficialCrawler', 'legal', 'server/beneficialCrawler.ts', ['verification', 'pattern-analysis'], 'analysis', 'deep'),
  c('public-record', 'PublicRecordScraper', 'legal', 'server/services/iceEngine/scraping/PublicRecordScraper.ts', ['public-records', 'occupation', 'vital-records', 'incarceration', 'change-detection'], 'retrieval', 'fast'),

  c('pacer', 'PACERScraper', 'criminal', 'server/services/criminalRecords/sources/PACERScraper.ts', ['federal-docket', 'criminal-records', 'case-law'], 'retrieval', 'deep', hasPacer, 'PACER is billable in production and executes only when credentials are configured.'),
  c('state-court', 'StateCourtScraper', 'criminal', 'server/services/criminalRecords/sources/StateCourtScraper.ts', ['criminal-records', 'case-law'], 'retrieval', 'deep', always),
  c('county-court', 'CountyCourtScraper', 'criminal', 'server/services/criminalRecords/sources/CountyCourtScraper.ts', ['criminal-records', 'case-law'], 'retrieval', 'deep', always),
  c('warrant-database', 'WarrantDatabaseScraper', 'criminal', 'server/services/criminalRecords/sources/WarrantDatabaseScraper.ts', ['criminal-records', 'public-records'], 'retrieval', 'deep', always),
  c('sex-offender-registry', 'SexOffenderRegistryScraper', 'criminal', 'server/services/criminalRecords/sources/SexOffenderRegistryScraper.ts', ['criminal-records', 'public-records'], 'retrieval', 'deep', always),

  c('fast-people-search', 'FastPeopleSearchScraper', 'people', 'server/services/peopleSearch/sources/FastPeopleSearchScraper.ts', ['people-search', 'identity', 'contact', 'address'], 'retrieval', 'deep', hasBrowser),
  c('true-people-search', 'TruePeopleSearchScraper', 'people', 'server/services/peopleSearch/sources/TruePeopleSearchScraper.ts', ['people-search', 'identity', 'contact', 'address'], 'retrieval', 'deep', hasBrowser),
  c('whitepages', 'WhitePagesScraper', 'people', 'server/services/peopleSearch/sources/WhitePagesScraper.ts', ['people-search', 'identity', 'contact', 'address'], 'retrieval', 'deep', hasBrowser),
  c('social-media-scraper', 'SocialMediaScraperService', 'people', 'server/services/socialMediaScraper.ts', ['social-media', 'identity'], 'retrieval', 'deep'),

  c('spiderfoot', 'SpiderFoot', 'external', 'server/services/spiderfootClient.ts', ['people-search', 'identity', 'social-media', 'verification'], 'external', 'deep', hasSpiderFoot),
  c('puppeteer', 'Puppeteer', 'external', 'server/services/crawlers/seedFirst/SeedFetchBirdOfPrey.ts', ['web-discovery', 'deep-crawl'], 'external', 'deep', hasBrowser),
  c('apify', 'Apify', 'external', 'server/services/volumeEngine/stealth/ApifyIntegration.ts', ['web-discovery', 'deep-crawl'], 'external', 'deep'),
  c('crawl4ai-pattern', 'Crawl4AI Adaptive Pattern', 'external', 'server/services/legalIntelligence/adaptiveCrawler.ts', ['semantic-extraction', 'deep-crawl'], 'external', 'deep'),

  // Crypto-domain crawlers are available to Lexara only as read-only evidence
  // producers. They never receive trading/execution authority.
  c('cain', 'CainCrawler', 'crypto-observational', 'server/services/cryptocrawl/core/cain-crawler.ts', ['crypto-observation', 'pattern-analysis'], 'observational', 'fast'),
  c('conjoined-twin', 'ConjoinedTwinCrawler', 'crypto-observational', 'server/services/cryptocrawl/agents/conjoined-twin-crawler.ts', ['crypto-observation', 'verification'], 'observational', 'fast'),
  c('enhanced-micro', 'EnhancedMicroCrawler', 'crypto-observational', 'server/services/cryptocrawl/agents/enhanced-micro-crawler.ts', ['crypto-observation', 'market-observation'], 'observational', 'fast'),
  c('cain-twin-hybrid', 'CainTwinHybrid', 'crypto-observational', 'server/services/cryptocrawl/agents/cain-twin-hybrid.ts', ['crypto-observation', 'pattern-analysis'], 'observational', 'fast'),
  c('gravity', 'GravityCrawler', 'crypto-observational', 'server/services/cryptocrawl/intelligence/gravity-reaper.ts', ['crypto-observation', 'market-observation'], 'observational', 'instant'),
  c('disco-ball', 'DiscoBallCrawler', 'crypto-observational', 'server/services/cryptocrawl/strategies/disco-ball-mirror.ts', ['crypto-observation', 'market-observation'], 'observational', 'fast'),
  c('starburst-dynamic', 'Starburst Dynamic Crawler Pool', 'crypto-observational', 'server/services/cryptocrawl/capital-free/starburst-scaling.ts', ['crypto-observation', 'market-observation'], 'observational', 'fast'),
  c('starburst-micro', 'Starburst Micro-Crawlers', 'crypto-observational', 'server/services/cryptocrawl/capital-free/starburst-scaling.ts', ['crypto-observation', 'market-observation'], 'observational', 'instant'),
  c('verification-crawlers', 'Verification Crawlers', 'crypto-observational', 'server/services/cryptocrawl/compensation/compensationGuarantee.ts', ['verification', 'crypto-observation'], 'observational', 'instant', always, 'Read-only deterministic payout-evidence verification; no execution or settlement authority.'),
  c('snake-agent', 'SnakeAgent Legacy Crawler', 'crypto-observational', 'server/services/cryptocrawl/agents/starburst-snake.ts', ['crypto-observation', 'pattern-analysis'], 'observational', 'instant', always, 'Compatibility crawler is read-only and cannot submit trades.'),
] as const;

export interface LexaraCrawlerSelectionInput {
  prompt: string;
  jurisdiction?: string;
  domainName?: string;
  hasDiscoveredUrls?: boolean;
  maxCrawlers?: number;
}

function desiredCapabilities(input: LexaraCrawlerSelectionInput): Set<LexaraCrawlerCapability> {
  const text = `${input.domainName || ''} ${input.jurisdiction || ''} ${input.prompt || ''}`.toLowerCase();
  const desired = new Set<LexaraCrawlerCapability>(['legal-authority', 'web-discovery', 'verification']);

  if (/federal|pacer|district court|bankruptcy|appellate|circuit court|docket/.test(text)) desired.add('federal-docket');
  if (/criminal|arrest|charge|conviction|warrant|sex offender|sentenc/.test(text)) desired.add('criminal-records');
  if (/case|precedent|holding|opinion|docket/.test(text)) desired.add('case-law');
  if (/statute|code section|u\.s\.c|law says|legislation/.test(text)) desired.add('statutes');
  if (/regulation|c\.f\.r|agency rule/.test(text)) desired.add('regulations');
  if (/person|people|phone|address|relative|associate|locate|born|birthday|date of birth|dob|employ|occupation|job|works? at|works? for|inmate|incarcerat|prison|jail|custody/.test(text)) desired.add('people-search');
  if (/born|birthday|date of birth|dob|marriage|divorc|death|deceased/.test(text)) desired.add('vital-records');
  if (/employ|occupation|job|works? at|works? for|profession/.test(text)) desired.add('occupation');
  if (/inmate|incarcerat|prison|jail|custody|corrections/.test(text)) desired.add('incarceration');
  if (/social media|facebook|instagram|linkedin|twitter|x\.com|tiktok/.test(text)) desired.add('social-media');
  if (/property|asset|parcel|vehicle|business|company|corporation|llc/.test(text)) desired.add('public-records');
  if (/crypto|blockchain|token|exchange|arbitrage|wallet|defi/.test(text)) desired.add('crypto-observation');
  if (input.hasDiscoveredUrls) {
    desired.add('semantic-extraction');
    desired.add('structured-extraction');
  }
  return desired;
}

export type LexaraDynamicCrawlerRole = 'primary' | 'secondary' | 'tertiary';

export interface LexaraDynamicCrawlerAssignment {
  crawler: LexaraCrawlerDescriptor;
  roles: LexaraDynamicCrawlerRole[];
  matchedCapabilities: LexaraCrawlerCapability[];
  priorityScore: number;
  explorationRequired: boolean;
}

function rolesForCrawler(item: LexaraCrawlerDescriptor, desired: ReadonlySet<LexaraCrawlerCapability>): LexaraDynamicCrawlerRole[] {
  const matched = item.capabilities.filter(capability => desired.has(capability));
  const roles = new Set<LexaraDynamicCrawlerRole>();
  if (item.executionMode === 'retrieval' || item.executionMode === 'external') roles.add('primary');
  if (matched.some(capability => ['web-discovery','deep-crawl','social-graph','people-search','legal-authority','public-records'].includes(capability))) roles.add('secondary');
  if (item.executionMode === 'analysis' || item.executionMode === 'extractor'
    || matched.some(capability => ['structured-extraction','semantic-extraction','verification','pattern-analysis','blind-spot-analysis','identity'].includes(capability))) roles.add('tertiary');
  return [...roles];
}

export function buildLexaraDynamicCrawlerAssignments(input: LexaraCrawlerSelectionInput): LexaraDynamicCrawlerAssignment[] {
  const desired = desiredCapabilities(input);
  // Dynamic assignment deliberately considers the complete configured pool.
  // maxCrawlers limits the convenience shortlist returned by
  // selectLexaraCrawlerPlan; it must never starve mandatory exploration.
  return LEXARA_CRAWLER_CAPABILITY_POOL
    .filter(item => item.configured?.() !== false)
    .map(item => {
      const matchedCapabilities = item.capabilities.filter(capability => desired.has(capability));
      const roles = rolesForCrawler(item, desired);
      const priorityScore = matchedCapabilities.length * 3
        + (item.latencyClass === 'instant' ? 2 : item.latencyClass === 'fast' ? 1 : 0);
      return { crawler: item, roles, matchedCapabilities, priorityScore, explorationRequired: matchedCapabilities.length > 0 };
    })
    .filter(assignment => assignment.matchedCapabilities.length > 0 && assignment.roles.length > 0)
    .sort((left, right) => right.priorityScore - left.priorityScore);
}

export function selectLexaraCrawlerPlan(input: LexaraCrawlerSelectionInput): LexaraCrawlerDescriptor[] {
  const max = Math.max(1, Math.min(input.maxCrawlers ?? 8, 16));
  return buildLexaraDynamicCrawlerAssignments(input).slice(0, max).map(assignment => assignment.crawler);
}

export function getLexaraCrawlerCapabilityPool(): readonly LexaraCrawlerDescriptor[] {
  return LEXARA_CRAWLER_CAPABILITY_POOL;
}

export function getLexaraCrawlerReadiness(): Array<{
  id: string;
  displayName: string;
  configured: boolean;
  capabilities: readonly LexaraCrawlerCapability[];
}> {
  return LEXARA_CRAWLER_CAPABILITY_POOL.map(item => ({
    id: item.id,
    displayName: item.displayName,
    configured: item.configured?.() !== false,
    capabilities: item.capabilities,
  }));
}