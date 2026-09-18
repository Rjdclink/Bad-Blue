const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function has(source, pattern, message) {
  assert(pattern.test(source), message);
}
function lacks(source, pattern, message) {
  assert(!pattern.test(source), message);
}

const boot = read('server/index.ts');
const admin = read('server/services/cryptocrawl/api/admin-api.ts');
const dashboard = read('client/src/pages/cryptocrawler-dashboard.tsx');

lacks(boot, /automaticCryptoCrawlerRuntimeRequired/, 'server boot must not own CryptoCrawler automatic resume');
lacks(boot, /startCryptoCrawlerRuntime/, 'server boot must never invoke the CryptoCrawler start authority');
has(boot, /runtime remains STOPPED pending explicit master start/, 'server boot must explicitly preserve stopped-by-default intent');

has(admin, /lifecycle:\s*'STOPPED'/, 'canonical lifecycle must initialize STOPPED');
has(admin, /running:\s*false/, 'canonical lifecycle must initialize not running');
has(admin, /operatorStartRequired:\s*true/, 'status must expose operator-only start truth');
has(admin, /automaticStartEnabled:\s*false/, 'status must expose that automatic start is disabled');
lacks(admin, /startAutomaticCryptoCrawlerRuntime/, 'governance events must not own runtime activation');
has(admin, /router\.post\('\/start'/, 'canonical authenticated start endpoint must remain');
has(admin, /router\.post\('\/stop'/, 'canonical authenticated stop endpoint must remain');
has(admin, /pipeline\.stop\(\)/, 'stop authority must stop the canonical pipeline');
has(admin, /zeroCapitalEngine\.stop\(\)/, 'stop authority must stop zero-capital runtime context');
has(admin, /autonomousFaucet\.stop\(\)/, 'stop authority must stop the autonomous faucet');
has(admin, /cryptoCrawlState\.disable\(\)/, 'stop authority must stop crawler dependencies');

has(dashboard, /aria-label="CryptoCrawler master power"/, 'master dashboard must render the lifecycle power switch');
has(dashboard, /checked=\{isSystemRunning\}/, 'master switch must display backend runtime truth');
has(dashboard, /onCheckedChange=\{handleMasterPowerChange\}/, 'master switch must call the lifecycle handler');
has(dashboard, /apiRequest\('\/admin\/crypto\/start',\s*'POST'\)/, 'dashboard start must use canonical start endpoint');
has(dashboard, /apiRequest\('\/admin\/crypto\/stop',\s*'POST'\)/, 'dashboard stop must use canonical stop endpoint');

console.log('CRYPTOCRAWLER MANUAL MASTER LIFECYCLE VERIFIED');
