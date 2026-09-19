const fs = require('fs');

function fail(message) {
  console.error('LEXARA CRAWLER VERIFY FAIL:', message);
  process.exitCode = 1;
}
function ok(message) {
  console.log('✓', message);
}

const registryPath = 'server/lexara/LexaraCrawlerCapabilityRegistry.ts';
const registry = fs.readFileSync(registryPath, 'utf8');
const entryPattern = /c\('([^']+)',\s*'([^']+)',\s*'[^']+',\s*'([^']+)'/g;
const entries = [];
let match;
while ((match = entryPattern.exec(registry))) {
  entries.push({ id: match[1], name: match[2], path: match[3] });
}

if (entries.length < 63) fail(`crawler capability pool unexpectedly small: ${entries.length}`);
else ok(`crawler capability pool inventories ${entries.length} executable/callable capabilities`);

const ids = new Set();
for (const entry of entries) {
  if (ids.has(entry.id)) fail(`duplicate crawler id: ${entry.id}`);
  ids.add(entry.id);
  if (!fs.existsSync(entry.path)) fail(`missing implementation for ${entry.name}: ${entry.path}`);
}
if (ids.size === entries.length) ok('crawler ids are unique and every registry implementation path exists');

const requiredNames = [
  'StarTrekCrawler', 'BirdOfPreyCrawler', 'SixDegreesCrawler', 'BlizzardCrawler', 'CerberusCrawler', 'LichCrawler',
  'MirrorCrawler', 'KeyCrawler', 'ChewerCrawler', 'ComputationalCrawler', 'USCCrawler', 'WooCrawler', 'SilenceCrawler',
  'IceCrawler', 'HydraCrawler', 'WraithCrawler', 'FarmCrawler', 'PhantomCrawler', 'NovaCrawler',
  'IdentityRazor', 'ContactRazor', 'AddressRazor', 'SocialRazor', 'RecordRazor', 'AssetRazor', 'CourtRazor',
  'BusinessRazor', 'RelationRazor', 'MediaRazor',
  'SeedFetchStarTrek', 'SeedFetchBirdOfPrey', 'SeedFetchTrinity', 'SeedFetchSixDegrees',
  'InstantLegalCrawler', 'AdaptiveCrawler', 'LegalCrawler', 'BeneficialCrawler', 'PublicRecordScraper',
  'PACERScraper', 'StateCourtScraper', 'CountyCourtScraper', 'WarrantDatabaseScraper', 'SexOffenderRegistryScraper',
  'FastPeopleSearchScraper', 'TruePeopleSearchScraper', 'WhitePagesScraper', 'SocialMediaScraperService',
  'Firecrawl', 'OpenRouter Web Search', 'SpiderFoot', 'Puppeteer', 'Apify', 'Crawl4AI Adaptive Pattern',
  'CainCrawler', 'ConjoinedTwinCrawler', 'EnhancedMicroCrawler', 'CainTwinHybrid', 'GravityCrawler',
  'DiscoBallCrawler', 'Starburst Dynamic Crawler Pool', 'Starburst Micro-Crawlers',
  'Verification Crawlers', 'SnakeAgent Legacy Crawler',
];
for (const name of requiredNames) {
  if (!entries.some(entry => entry.name === name)) fail(`missing crawler capability: ${name}`);
}
if (!process.exitCode) ok('full crawler inventory is represented in Lexara capability selection');

const pacer = fs.readFileSync('server/services/criminalRecords/sources/PACERScraper.ts', 'utf8');
if (
  !pacer.includes('pacer.login.uscourts.gov/services/cso-auth') ||
  !pacer.includes('pcl.uscourts.gov/pcl-public-api/rest') ||
  !pacer.includes("'X-NEXT-GEN-CSO'") ||
  pacer.includes("page.goto('https://pacer.uscourts.gov/'")
) {
  fail('PACER must use supported Authentication/PCL API flow');
} else {
  ok('PACER uses supported Authentication/PCL API flow');
}

for (const path of [
  'server/services/criminalRecords/sources/StateCourtScraper.ts',
  'server/services/criminalRecords/sources/CountyCourtScraper.ts',
  'server/services/criminalRecords/sources/WarrantDatabaseScraper.ts',
  'server/services/criminalRecords/sources/SexOffenderRegistryScraper.ts',
]) {
  const source = fs.readFileSync(path, 'utf8');
  if (/placeholder|actual selectors|actual implementation/i.test(source)) fail(`${path} still contains placeholder record extraction`);
  if (!source.includes('discoverCriminalRecordSources')) fail(`${path} does not use verified official-source discovery`);
}
if (!process.exitCode) ok('criminal-record crawler adapters no longer fabricate generic selector results');

const utility = fs.readFileSync('server/services/pantheon/crawlers/utility.ts', 'utf8');
for (const name of ['FarmCrawler', 'PhantomCrawler', 'NovaCrawler']) {
  if (!utility.includes(`class ${name}`)) fail(`${name} has no concrete implementation`);
}
if (!process.exitCode) ok('previously declaration-only PANTHEON species have concrete bounded implementations');

const pantheonPage = fs.readFileSync('client/src/pages/pantheon.tsx', 'utf8');
const pantheonSelector = fs.readFileSync('client/src/components/DoomsdayClockSelector.tsx', 'utf8');
const pantheonProgress = fs.readFileSync('client/src/components/PantheonProgressTracker.tsx', 'utf8');
const pantheonReportConfig = fs.readFileSync('shared/pantheonReportConfig.ts', 'utf8');
const pantheonReportJobs = fs.readFileSync('server/services/pantheon/PantheonBackgroundReportJob.ts', 'utf8');
const pantheonRoutes = fs.readFileSync('server/routes.ts', 'utf8');
const crawlerSelection = fs.readFileSync('server/services/crawlers/CrawlerSelectionUtility.ts', 'utf8');
const seedFirstConfig = fs.readFileSync('server/lib/seedFirstConfig.ts', 'utf8');
const backgroundPeopleSearch = fs.readFileSync('server/peopleSearch.ts', 'utf8');
const backgroundAdapter = fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts', 'utf8');
const backgroundOrchestrator = fs.readFileSync('server/services/pantheonCrawlerOrchestrator.ts', 'utf8');
const starTrek = fs.readFileSync('server/services/crawlers/StarTrekCrawler.ts', 'utf8');
const birdOfPrey = fs.readFileSync('server/services/crawlers/BirdOfPreyCrawler.ts', 'utf8');
const sixDegrees = fs.readFileSync('server/services/crawlers/SixDegreesCrawler.ts', 'utf8');
const trinity = fs.readFileSync('server/services/crawlers/TrinityCrawlers.ts', 'utf8');
const cain = fs.readFileSync('server/services/crawlers/CainAndReaper.ts', 'utf8');
const twoStage = fs.readFileSync('server/services/pantheon/razors/TwoStageDeployer.ts', 'utf8');
const pantheonIce = fs.readFileSync('server/services/pantheon/crawlers/ice.ts', 'utf8');
const spiderfoot = fs.readFileSync('server/services/spiderfootClient.ts', 'utf8');
const stealth = fs.readFileSync('server/services/stealth/StealthInfrastructure.ts', 'utf8');

if (
  !pantheonReportConfig.includes("1: 5 * 60_000") ||
  !pantheonReportConfig.includes("2: 10 * 60_000") ||
  !pantheonReportConfig.includes("3: 20 * 60_000") ||
  !pantheonReportConfig.includes("4: 30 * 60_000") ||
  !pantheonSelector.includes('PANTHEON_REPORT_DURATION_LABELS') ||
  !pantheonProgress.includes('PANTHEON_REPORT_DURATIONS_MS')
) {
  fail('Pantheon report durations are not canonically wired to 5/10/20/30 minutes');
}
if (
  !pantheonPage.includes('Generated Background Report') ||
  !pantheonPage.includes("/api/osint/report-jobs") ||
  pantheonPage.includes("/api/osint/full-search") ||
  pantheonPage.includes('new AbortController()') ||
  !pantheonPage.includes('pantheon.activeReportJobId') ||
  !pantheonPage.includes('isPeopleSearchReport')
) {
  fail('Pantheon page is not using the durable refresh-safe report workspace');
}
if (
  !pantheonRoutes.includes("app.post('/api/osint/report-jobs'") ||
  !pantheonRoutes.includes("app.get('/api/osint/report-jobs/:reportId'") ||
  !pantheonReportJobs.includes('forceAllCrawlers: true') ||
  !pantheonReportJobs.includes('resumePantheonReportJobFromRecord')
) {
  fail('Pantheon server-side report jobs are not durable/recoverable');
}
if (
  !crawlerSelection.includes("request.purpose === 'background_report'") ||
  !crawlerSelection.includes('depth controls effort, not participation') ||
  !seedFirstConfig.includes('DEFAULT_DISABLED_CRAWLERS: readonly PermittedCrawlerName[] = [] as const')
) {
  fail('Pantheon background reports do not preserve the complete crawler roster');
}
if (
  !backgroundAdapter.includes('deployBackgroundReport') ||
  !backgroundAdapter.includes("request.purpose === 'background_report'") ||
  !twoStage.includes('FarmCrawler') ||
  !twoStage.includes('PhantomCrawler') ||
  !twoStage.includes('NovaCrawler')
) {
  fail('background-report adapter must execute the real extended PANTHEON capability set');
}
if (
  starTrek.includes('.example.com') ||
  starTrek.includes('Simulate 70% success rate') ||
  !starTrek.includes('setNavigationSeeds') ||
  !starTrek.includes('no responsive predicted deep URL')
) {
  fail('StarTrek background-report retrieval contains fabricated navigation or success');
}
if (
  birdOfPrey.includes('generateRandomIP') ||
  birdOfPrey.includes('generateQuantumFingerprint') ||
  !birdOfPrey.includes('Crawler request failed: HTTP')
) {
  fail('BirdOfPrey background-report retrieval still fabricates identity metadata or accepts failed HTTP as evidence');
}
if (!sixDegrees.includes('Crawler request failed: HTTP')) {
  fail('SixDegrees background-report retrieval accepts non-success HTTP as evidence');
}
if (
  !trinity.includes('firstSuccessful') ||
  trinity.includes('return Promise.race([this.leftHead.attack') ||
  trinity.includes('X-Fingerprint-Canvas') ||
  trinity.includes('X-Fingerprint-WebGL')
) {
  fail('Trinity background-report retrieval can fail on the first rejected head or still fabricates browser fingerprints');
}
if (backgroundOrchestrator.includes('confidence: result.confidence ||')) {
  fail('PANTHEON background-report orchestrator converts real zero-confidence failures into positive evidence');
}
if (
  pantheonIce.includes('extractGPSFromFile') ||
  !pantheonIce.includes("createHash('sha256')")
) {
  fail('ICE background-report resource extraction must use bounded public metadata, not precise GPS harvesting');
}
if (
  !spiderfoot.includes('waitForScanCompletion') ||
  !backgroundPeopleSearch.includes('waitForScanCompletion(scanId')
) {
  fail('background reports read SpiderFoot results before the scan reaches a terminal state');
}
if (
  backgroundPeopleSearch.includes('pantheonOrchestrator.search([name]') ||
  !backgroundPeopleSearch.includes('buildPantheonSearchTargets')
) {
  fail('background-report PANTHEON fallbacks pass a person name as though it were a URL');
}
if (
  backgroundPeopleSearch.includes('total omniscience') ||
  backgroundPeopleSearch.includes('all 60+ data sources')
) {
  fail('background-report status text overclaims capabilities beyond returned evidence');
}
if (
  stealth.includes("route: ['VPN', `Tor:${torPort}`]") ||
  stealth.includes("route: ['VPN', `Tor:${torPort}`, 'ProxyChain']")
) {
  fail('background-report crawler transport reports Tor/proxy routes that fetch does not actually use');
}
if (
  cain.includes('Would be retrieved from persistent storage in production') ||
  !cain.includes('recalculateEvolutionaryDebt')
) {
  fail('background-report Cain/Reaper supervision still reports hard-coded evolutionary debt');
}
if (!process.exitCode) ok('background-report crawler path is real, fail-closed, scope-bounded, and evidence-truthful');

const payoutVerification = fs.readFileSync('server/services/cryptocrawl/compensation/compensationGuarantee.ts', 'utf8');
if (payoutVerification.includes('Math.random() > 0.05')) fail('verification crawlers still use simulated random truth');
if (!payoutVerification.includes('Read-only deterministic evidence verification')) fail('verification crawlers are not deterministic/read-only');
const snake = fs.readFileSync('server/services/cryptocrawl/agents/starburst-snake.ts', 'utf8');
if (!snake.includes('lastObservation') || !snake.includes('getObservation()')) fail('legacy Snake crawler remains inert');
if (!process.exitCode) ok('legacy/verification crawler capabilities are deterministic and observational');

if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA crawler capability verification passed.');