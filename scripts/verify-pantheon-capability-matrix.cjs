const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const matrixPath = 'server/services/pantheon/PantheonCrawlerCapabilityMatrix.ts';
const matrix = read(matrixPath);
const controller = read('server/services/pantheon/PantheonInvestigationController.ts');
const workflow = read('server/services/pantheon/PantheonCategoryWorkflow.ts');
const orchestrator = read('server/services/pantheonCrawlerOrchestrator.ts');
const twoStage = read('server/services/pantheon/razors/TwoStageDeployer.ts');
const acquisition = read('server/services/crawlers/PublicAcquisitionInfrastructure.ts');

const primary = ['startrek','birdofprey','sixdegrees','cerberus','blizzard','lich'];
const secondary = ['hydra','wraith','ice','farm','phantom','nova'];
const razors = ['identity','contact','address','social','record','asset','court','business','relation','media'];
const transports = ['direct-http','browser','search-provider','specialized-adapter','archive'];
const executableFunctions = [
  'StarTrekCrawler.warpTo',
  'BirdOfPreyCrawler.hunt',
  'SixDegreesCrawler.mapConnections',
  'CerberusCrawler.attack',
  'BlizzardCrawler.deploy',
  'LichCrawler.castSpell',
  'HydraCrawler.execute',
  'WraithCrawler.execute',
  'IceCrawler.execute',
  'FarmCrawler.execute',
  'PhantomCrawler.execute',
  'NovaCrawler.execute',
  'IdentityRazor.run',
  'ContactRazor.run',
  'AddressRazor.run',
  'SocialRazor.run',
  'RecordRazor.run',
  'AssetRazor.run',
  'CourtRazor.run',
  'BusinessRazor.run',
  'RelationRazor.run',
  'MediaRazor.run',
];

for (const token of [
  'PANTHEON_CRAWLER_CAPABILITY_MATRIX',
  'PANTHEON_CATEGORY_CAPABILITY_MATRIX',
  'PANTHEON_TRANSPORT_TASKS',
  'buildPantheonExecutableWorkUnits',
  'validatePantheonCrawlerCapabilityMatrix',
  'satisfies Record<PantheonCapabilityId',
  'satisfies Record<PantheonReportCategoryLabel',
  'satisfies Record<PantheonTransport',
]) {
  if (!matrix.includes(token)) throw new Error('Capability matrix missing invariant: ' + token);
}

for (const id of [...primary, ...secondary]) {
  if (!matrix.includes("'" + id + "'")) throw new Error('Capability matrix missing crawler: ' + id);
}
for (const id of razors) {
  if (!matrix.includes("'razor:" + id + "'")) throw new Error('Capability matrix missing razor skill: ' + id);
}
for (const transport of transports) {
  if (!matrix.includes("'" + transport + "'")) throw new Error('Capability matrix missing transport: ' + transport);
}
for (const fn of executableFunctions) {
  if (!matrix.includes("'" + fn + "'")) throw new Error('Capability matrix missing executable function: ' + fn);
}

const categoryEntries = [...matrix.matchAll(/^  '(?:[^']+)': (?:IDENTITY|CONTACT|ADDRESS|RELATIONSHIP|SOCIAL|BUSINESS|ASSET|LEGAL|MEDIA|\[)/gm)];
if (categoryEntries.length !== 30) throw new Error('Capability matrix must declare exactly 30 category routes; found ' + categoryEntries.length);

if (!controller.includes('getPantheonPrimaryCrawlerCapabilitiesForCategory')) {
  throw new Error('Investigation controller is not driven by the capability matrix');
}
if (!workflow.includes('PantheonReportCategoryLabel')) {
  throw new Error('Workflow categories are not type-checked against the capability matrix');
}
if (!orchestrator.includes('PantheonPrimaryCrawlerId[]')) {
  throw new Error('Crawler orchestrator does not consume the matrix crawler id contract');
}

for (const token of ['this.startrek.warpTo','this.birdofprey.hunt','this.sixdegrees.mapConnections','this.cerberus.attack','this.blizzard.deploy','this.lich.castSpell']) {
  if (!orchestrator.includes(token)) throw new Error('Primary executable binding missing: ' + token);
}
for (const token of ['new HydraCrawler','new WraithCrawler','new IceCrawler','new FarmCrawler','new PhantomCrawler','new NovaCrawler']) {
  if (!twoStage.includes(token)) throw new Error('Secondary executable binding missing: ' + token);
}
for (const token of ['createAllRazors','razor.run']) {
  if (!twoStage.includes(token)) throw new Error('Razor executable binding missing: ' + token);
}
if (!acquisition.includes('export async function acquirePublicResource')) {
  throw new Error('Canonical public transport executor missing');
}

console.log('Pantheon crawler-capability matrix verification passed: 22 capabilities, 5 transports, 30 report categories.');
