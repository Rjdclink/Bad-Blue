const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const test = (name, condition) => {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
};

const spectra = read('client/src/pages/spectra.tsx');
const dashboard = read('client/src/components/geoconsole/GeoconsoleRadarDashboard.tsx');
const welcome = read('client/src/pages/welcome.tsx');
const app = read('client/src/App.tsx');
const routes = read('server/routes/spectra.routes.ts');
const serverRoutes = read('server/routes.ts');
const masterPanels = read('client/src/components/MasterPanelNavigator.tsx');

console.log('\nSPECTRA UNIFIED EXPERIENCE\n');

test('First prompt is exact target question',
  spectra.includes("const FIRST_PROMPT = 'What is it that you want to locate?'"));
test('Second prompt is exact information question',
  spectra.includes("const DETAILS_PROMPT = 'What information can you give me about the target?'"));
test('Second question waits for first response',
  spectra.includes("if (phase === 'awaiting_target')") &&
  spectra.includes("setPhase('awaiting_details')") &&
  spectra.includes("addMessage('spectra', DETAILS_PROMPT)"));
test('Acquisition begins only after details phase',
  spectra.includes("if (phase === 'awaiting_details')") &&
  spectra.includes("await acquireTarget(target, message)"));
test('SPECTRA uses one canonical GeoConsole map',
  spectra.includes('<GeoconsoleRadarDashboard') &&
  spectra.includes('spectraShell'));
test('Legacy fake People Radar panel is gone',
  !spectra.includes('PeopleRadarMap') &&
  !spectra.includes('Satellite imagery is not configured on this panel'));
test('No manual coordinate UI in SPECTRA',
  !spectra.includes('Latitude') &&
  !spectra.includes('Longitude') &&
  !spectra.includes('Add Point'));
test('SPECTRA supports natural text input',
  spectra.includes('Tell SPECTRA what you want to locate'));
test('Voice is optional rather than mandatory',
  spectra.includes('toggleVoice') && !spectra.includes('getUserMedia({'));
test('Media intelligence is folded into the conversation',
  spectra.includes('/api/gps/extract-upload') &&
  spectra.includes('handleMediaEvidence') &&
  spectra.includes('Paperclip'));
test('SPECTRA map exposes simplified shell',
  dashboard.includes('spectraShell?: boolean') &&
  dashboard.includes('!spectraShell && inspectorOpen'));
test('One-hour previous/future timeline remains available',
  dashboard.includes('min={-60}') && dashboard.includes('max={60}'));

test('Welcome card opens SPECTRA',
  welcome.includes("setLocation('/spectra')") &&
  welcome.includes('SPECTRA'));
test('People Finder route converges on SPECTRA',
  app.includes('<Route path="/people-finder" component={SpectraPage} />'));
test('Location Intelligence route converges on SPECTRA',
  app.includes('<Route path="/location-intel" component={SpectraPage} />'));
test('TSHPE routes converge on SPECTRA',
  app.includes('<Route path="/tshpe" component={SpectraPage} />') &&
  app.includes('<Route path="/tshpe-locator" component={SpectraPage} />'));
test('Geo-console public redirect converges on SPECTRA',
  app.includes("setLocation('/spectra', { replace: true })"));
test('Legacy GeoConsole screens route to SPECTRA',
  app.includes('<Route path="/geoconsole" component={SpectraPage} />') &&
  app.includes('<Route path="/geoconsole-command" component={SpectraPage} />') &&
  app.includes('<Route path="/geoconsole-process" component={SpectraPage} />') &&
  app.includes('<Route path="/geoconsole-report" component={SpectraPage} />'));
test('Folded geospatial tools are not separate master tabs',
  !masterPanels.includes("label: 'GeoConsole'") &&
  !masterPanels.includes("label: 'GeoConsole Command'") &&
  !masterPanels.includes("label: 'GeoConsole Process'") &&
  !masterPanels.includes("label: 'GeoConsole Report'") &&
  !masterPanels.includes("label: 'Location Intelligence'") &&
  !masterPanels.includes("label: 'TSHPE'"));

test('SPECTRA acquisition API requires authentication',
  routes.includes('router.use(isAuthenticated)'));
test('SPECTRA acquisition uses existing OSINT engine',
  routes.includes('conductFullOSINT'));
test('Generic target classes defer identity details to second response',
  routes.includes('GENERIC_TARGET_RE') &&
  routes.includes('const searchQuery = GENERIC_TARGET_RE.test(target)'));
test('SPECTRA only maps explicitly timestamped coordinates',
  routes.includes('explicitTimestamp') &&
  routes.includes('Number.isFinite(latitude)') &&
  routes.includes('timestamp'));
test('SPECTRA API is mounted',
  serverRoutes.includes("app.use('/api/spectra', spectraRoutes.default)"));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
