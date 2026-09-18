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

if (entries.length < 60) fail(`crawler capability pool unexpectedly small: ${entries.length}`);
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
  'DiscoBallCrawler', 'Starburst Dynamic Crawler Pool',
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

if (process.exitCode) process.exit(process.exitCode);
console.log('LEXARA crawler capability verification passed.');
