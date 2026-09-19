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

const backgroundAdapter = fs.readFileSync('server/services/crawlers/PantheonRetrievalAdapter.ts', 'utf8');
const backgroundPeopleSearch = fs.readFileSync('server/peopleSearch.ts', 'utf8');
const capabilityRouter = fs.readFileSync('server/services/peopleSearch/router/CapabilityRouter.ts', 'utf8');
const apiDiscovery = fs.readFileSync('server/services/peopleSearch/extractor/ApiDiscoveryProvider.ts', 'utf8');
const zenRows = fs.readFileSync('server/services/peopleSearch/extractor/ZenRowsProvider.ts', 'utf8');
const starTrek = fs.readFileSync('server/services/crawlers/StarTrekCrawler.ts', 'utf8');
const trinity = fs.readFileSync('server/services/crawlers/TrinityCrawlers.ts', 'utf8');
const twoStage = fs.readFileSync('server/services/pantheon/razors/TwoStageDeployer.ts', 'utf8');
const pantheonOrchestrator = fs.readFileSync('server/services/pantheonCrawlerOrchestrator.ts', 'utf8');
const pantheonIce = fs.readFileSync('server/services/pantheon/crawlers/ice.ts', 'utf8');
const usc = fs.readFileSync('server/services/crawlers/SixCrawlerInitiative.ts', 'utf8');
const cain = fs.readFileSync('server/services/crawlers/CainAndReaper.ts', 'utf8');

if (!backgroundAdapter.includes('deployBackgroundReport') || !backgroundAdapter.includes('capabilityClass')) {
  fail('background reports are not wired to extended PANTHEON capability execution');
}
if (
  !twoStage.includes('FarmCrawler') ||
  !twoStage.includes('PhantomCrawler') ||
  !twoStage.includes('NovaCrawler') ||
  !twoStage.includes('sensitive_personal_data')
) {
  fail('background-report two-stage deployment must execute all secondary species with sensitive-output redaction');
}
if (
  capabilityRouter.includes('simulate the capability') ||
  capabilityRouter.includes('Constructed name from query') ||
  !capabilityRouter.includes('searchWikipedia') ||
  !capabilityRouter.includes('searchWikidata')
) {
  fail('people-search capability router regressed to simulated query-derived data');
}
if (apiDiscovery.includes('TODO: Parse inline JSON data') || !apiDiscovery.includes('extractInlineState')) {
  fail('inline application-state extraction is not executable');
}
if (zenRows.includes('ZenRowsProvider.extract() not implemented') || !zenRows.includes('new HttpProvider()')) {
  fail('rendered HTML extraction remains unimplemented');
}
if (
  starTrek.includes('.example.com') ||
  starTrek.includes('Simulate 70% success rate') ||
  !starTrek.includes('setNavigationSeeds') ||
  !starTrek.includes('no responsive predicted deep URL')
) {
  fail('StarTrek still contains fabricated navigation or transport success');
}
if (trinity.includes('return Promise.race([this.leftHead.attack') || !trinity.includes('firstSuccessful')) {
  fail('Trinity crawler parallel paths can still fail on the first rejected head');
}
if (pantheonOrchestrator.includes('confidence: result.confidence ||')) {
  fail('PANTHEON orchestrator still converts real zero-confidence failures into positive evidence');
}
if (pantheonIce.includes('extractGPSFromFile') || !pantheonIce.includes("createHash('sha256')")) {
  fail('ICE resource extraction must use bounded public metadata rather than precise GPS harvesting');
}
if (
  !backgroundPeopleSearch.includes('buildPantheonSearchTargets') ||
  backgroundPeopleSearch.includes('pantheonOrchestrator.search([name]')
) {
  fail('people-search PANTHEON fallback still passes a person name as a URL');
}
if (usc.includes('Simulate task execution') || !usc.includes('registerTaskHandler')) {
  fail('USC task execution remains simulated');
}
if (cain.includes('Would be retrieved from persistent storage in production') || !cain.includes('recalculateEvolutionaryDebt')) {
  fail('Cain evolutionary debt remains a hard-coded placeholder');
}
if (!process.exitCode) ok('background-report PANTHEON runtime uses real fail-closed utilities with extended safe capability wiring');

const payoutVerification = fs.readFileSync('server/services/cryptocrawl/compensation/compensationGuarantee.ts', 'utf8');
if (payoutVerification.includes('Math.random() > 0.05')) fail('verification crawlers still use simulated random truth');
if (!payoutVerification.includes('Read-only deterministic evidence verification')) fail('verification crawlers are not deterministic/read-only');
const snake = fs.readFileSync('server/services/cryptocrawl/agents/starburst-snake.ts', 'utf8');
if (!snake.includes('lastObservation') || !snake.includes('getObservation()')) fail('legacy Snake crawler remains inert');
if (!process.exitCode) ok('legacy/verification crawler capabilities are deterministic and observational');

if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA crawler capability verification passed.');