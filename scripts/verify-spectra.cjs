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
const voiceMode = read('client/src/hooks/useVoiceMode.ts');
const evidenceProof = read('server/services/geoconsole/evidence-proof.ts');
const intelligenceMap = read('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx');
const runtime = read('client/src/hooks/useGeoRuntime.ts');
const fusion = read('server/services/geoconsole/inputFusionEngine.ts');
const dockerfile = read('Dockerfile');
const exifTool = read('server/services/locationIntelligence/ExifToolExtractor.ts');
const spectraSources = read('server/services/spectra/SpectraSourceRegistry.ts');
const pantheonSources = read('server/services/pantheon/PantheonSovereignSourceRegistry.ts');
const geocoder = read('server/services/geoconsole/city-state-geocoder.ts');

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
test('Voice turn-taking prevents SPECTRA from transcribing itself',
  spectra.includes('voiceSynthesis.isLoading || voiceSynthesis.isSpeaking') &&
  spectra.includes('!voiceMode.isSuspended') &&
  spectra.includes('voiceMode.suspendListening()') &&
  spectra.includes('lastSpokenTextRef'));
test('Voice recognition suppresses duplicate finals and exposes confidence',
  voiceMode.includes('recentFinalTranscriptRef') &&
  voiceMode.includes('confidence?: number') &&
  spectra.includes('meta.confidence < 0.45'));
test('Media intelligence is folded into the conversation',
  spectra.includes('/api/gps/extract-upload') &&
  spectra.includes('handleMediaEvidence') &&
  spectra.includes('Paperclip'));
test('SPECTRA map exposes simplified shell',
  dashboard.includes('spectraShell?: boolean') &&
  dashboard.includes('!spectraShell && inspectorOpen'));
test('SPECTRA map is unconditional from initial load',
  spectra.includes('const showMap = true') &&
  spectra.includes('<GeoconsoleRadarDashboard') &&
  !spectra.includes("const showMap =\n    phase === 'acquiring'"));
test('Map is progressively populated from supplied clues',
  spectra.includes('/api/geoconsole/geocode-city-state') &&
  spectra.includes('Regional context mapped; broadening identity discovery') &&
  spectra.includes('Acquired so far'));
test('Natural-language clues are decomposed into address and regional candidates',
  geocoder.includes('extractStreetAddressHint') &&
  geocoder.includes('extractLocationClues') &&
  geocoder.includes('geocodeBestLocation') &&
  geocoder.includes("strategy, 'structured_address'") === false &&
  geocoder.includes("queryGeocoder(structured, 'structured_address')") &&
  geocoder.includes("queryGeocoder(direct, 'normalized_freeform')"));
test('Geocoder failures are classified without logging raw clue text',
  geocoder.includes("'[SPECTRA_GEOCODER] request_failed'") &&
  geocoder.includes("'[SPECTRA_GEOCODER] no_match'") &&
  geocoder.includes('errorType') &&
  !geocoder.includes('console.warn(input)'));
test('Direct media evidence is sent to the server and preserved immediately',
  spectra.includes('directEvidence: extraEvidence.map') &&
  routes.includes('directEvidenceSchema') &&
  routes.includes('directEvidence.map'));
test('Regional candidates remain separate from timed observations',
  spectra.includes('candidateLocations={candidateLocations}') &&
  routes.includes('candidateLocations') &&
  routes.includes("basis: 'regional_context'") &&
  routes.includes('accuracyMeters: region.accuracyMeters'));
test('One-hour previous/future timeline remains available',
  dashboard.includes('min={-60}') && dashboard.includes('max={60}'));

test('Temporary Solution X keeps SPECTRA visible but disables the welcome card',
  welcome.includes('SPECTRA') &&
  welcome.includes('disabled') &&
  welcome.includes('aria-disabled="true"') &&
  welcome.includes('Temporarily out of order. Contact contact.badblue@gmail.com for assistance.') &&
  !welcome.includes("setLocation('/spectra')"));
test('People Finder route converges on SPECTRA',
  app.includes('<Route path="/people-finder" component={SpectraPage} />'));
test('Location Intelligence route converges on SPECTRA',
  app.includes('<Route path="/location-intel" component={SpectraPage} />'));
test('TSHPE routes converge on SPECTRA',
  app.includes('<Route path="/tshpe" component={SpectraPage} />') &&
  app.includes('<Route path="/tshpe-locator" component={SpectraPage} />'));
test('Geo-console public redirect converges on SPECTRA',
  app.includes("setLocation('/spectra', { replace: true })"));
test('No stale GeoConsole component reference remains in App',
  !app.includes('GeoConsolePage') &&
  !app.includes('GeoConsoleCommandPage') &&
  !app.includes('GeoConsoleProcessPage') &&
  !app.includes('GeoConsoleReportPage'));
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
test('SPECTRA acquisition uses existing OSINT engine with a route-local timeout',
  routes.includes('conductFullOSINT') &&
  routes.includes('settleWithin(') &&
  routes.includes('SPECTRA_OSINT_TIMEOUT_MS'));
test('SPECTRA broad discovery runs independently of deep OSINT',
  routes.includes('runDiscoveryPass') &&
  routes.includes('Promise.allSettled') &&
  routes.includes('unifiedSearch') &&
  routes.includes("category: 'general'"));
test('SPECTRA automatically broadens when the first discovery pass is narrow',
  routes.includes('firstPassSourceCount < 12') &&
  routes.includes('discoveryQueries.secondPass') &&
  routes.includes('discoveryPasses += 1'));
test('Generic target classes resolve identity without treating city/state as a person name',
  routes.includes('const genericTarget = GENERIC_TARGET_RE.test(normalizedTarget)') &&
  routes.includes('extractLikelyName(details)') &&
  routes.includes('looksLikeLocation') &&
  routes.includes('extractCityStateHint(firstSegment)') &&
  routes.includes('resolvedTargetLabel') &&
  routes.includes('const searchQuery = resolvedName || details'));
test('SPECTRA only maps qualified explicitly timestamped coordinates',
  routes.includes('explicitTimestamp') &&
  routes.includes('hasLocationContext') &&
  routes.includes('Number.isFinite(latitude)') &&
  routes.includes('timestamp'));
test('Timestamp normalization handles Unix seconds and rejects implausible dates',
  routes.includes('numeric < 100_000_000_000') &&
  routes.includes('Date.UTC(1900, 0, 1)') &&
  routes.includes('Date.now() + 24 * 60 * 60 * 1000'));
test('Canonical fusion is the sole location-confidence authority',
  routes.includes('inputFusionEngine.fuseInputs') &&
  routes.includes('canonicalLatest?.qualityScore') &&
  !routes.includes('function locationEvidenceConfidence') &&
  !spectra.includes('combinedLocationConfidence'));
test('SPECTRA applies canonical location-quality checks before headline confidence',
  routes.includes('assessLocationQuality(normalizedLocationObservations)') &&
  routes.includes('qualityLocationObservations') &&
  routes.includes('rejectedObservationCount') &&
  routes.includes('qualityIssueCount'));
test('Unsigned client location claims cannot manufacture precision',
  evidenceProof.includes('Math.max(5_000, reportedAccuracy)') &&
  evidenceProof.includes("source: 'manual_input'") &&
  evidenceProof.includes('claimedAccuracy: point.accuracy'));
test('Generic targets do not launch untethered broad discovery',
  routes.includes('const strongIdentityAnchor = quotedName || quotedPhone') &&
  routes.includes('const secondPass = strongIdentityAnchor ?') &&
  routes.includes("? suppliedName || ''"));
test('Failed map providers stay locally disabled across UI updates',
  intelligenceMap.includes("providerStatus.terrain !== 'unavailable'") &&
  intelligenceMap.includes("providerStatus.weather !== 'unavailable'") &&
  intelligenceMap.includes("providerStatus.satellite !== 'unavailable'"));
test('Social media cannot be mislabeled as EXIF and explicit social geotags are distinct',
  routes.includes('const isSocial =') &&
  routes.includes("return 'social_geotag'") &&
  routes.includes("return 'social_media'") &&
  routes.includes('media classification to explicit artifact/metadata language'));
test('Canonical fusion clamps optimistic third-party precision',
  fusion.includes('minimumReportedAccuracyMeters') &&
  fusion.includes("case 'social_geotag': return 25") &&
  fusion.includes("case 'public_record':") &&
  fusion.includes('this.minimumReportedAccuracyMeters(point.source)'));
test('Live browser fixes use browser evidence semantics without fabricated velocity components',
  runtime.includes("source: 'browser_geolocation'") &&
  runtime.includes('clamp(1 - accuracy / 100, 0.1, 0.75)') &&
  runtime.includes('speed !== undefined && heading !== undefined') &&
  !runtime.includes('{ speed: speed ?? 0, heading: heading ?? 0 }'));
test('Production media fallback is installed and parses QuickTime ISO-6709',
  dockerfile.includes('libimage-exiftool-perl') &&
  exifTool.includes('parseIso6709') &&
  exifTool.includes('metadata.GPSCoordinates'));
test('Partial media GPS falls through to ExifTool for absolute GPS UTC recovery',
  read('server/services/locationIntelligence/MediaMetadataExtractor.ts').includes('!gps.timestamp') &&
  exifTool.includes('parseGpsUtcTimestamp') &&
  exifTool.includes('metadata.GPSDateStamp') &&
  exifTool.includes('metadata.GPSTimeStamp'));
test('Independent evidence is preserved while duplicate source counting is prevented',
  routes.includes('const evidenceGroup =') &&
  spectra.includes('const evidenceGroup =') &&
  spectra.includes('setSourceCount(payload.acquisition?.sourceCount ?? 0)'));
test('Regional geocoder uncertainty is preserved',
  read('server/services/geoconsole/city-state-geocoder.ts').includes('accuracyMeters') &&
  read('client/src/components/geoconsole/MapLibreIntelligenceMap.tsx').includes('spectra-candidate-area'));
test('SPECTRA has the complete canonical verified source inventory available',
  pantheonSources.includes('PANTHEON_VERIFIED_SOURCE_INVENTORY') &&
  spectraSources.includes('PANTHEON_VERIFIED_SOURCE_INVENTORY') &&
  spectraSources.includes('SPECTRA_SOURCE_CATALOG'));
test('SPECTRA source catalog is priority compiled and directly retrievable',
  spectraSources.includes("'critical' | 'high' | 'supporting'") &&
  spectraSources.includes('SPECTRA_SOURCE_CATALOG_BY_ID') &&
  spectraSources.includes('getSpectraSources'));
test('SPECTRA acquisition pipes prioritized source waves into discovery',
  routes.includes('buildSpectraDiscoveryWaves') &&
  routes.includes('criticalSourceQueries') &&
  routes.includes('highSourceQueries') &&
  routes.includes('supportingSourceQueries'));
test('SPECTRA API is mounted',
  serverRoutes.includes("app.use('/api/spectra', spectraRoutes.default)"));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
