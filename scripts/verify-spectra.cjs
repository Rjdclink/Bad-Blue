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
const geoconsoleRoutes = read('server/routes/geoconsole.routes.ts');
const adapterRegistry = read('server/services/spectra/SpectraAdapterRegistry.ts');
const providerNormalizer = read('server/services/spectra/SpectraProviderTelemetryNormalizer.ts');
const genericPull = read('server/services/spectra/SpectraGenericPullAdapters.ts');
const realtimeBridge = read('server/services/spectra/SpectraRealtimeBridge.ts');
const telemetryImport = read('server/services/spectra/SpectraTelemetryImport.ts');
const acquisitionPersistence = read('server/services/spectra/SpectraAcquisitionPersistence.ts');
const placeContext = read('server/services/spectra/SpectraPlaceContext.ts');
const publicRetrieval = read('server/services/spectra/SpectraPublicRetrieval.ts');
const cameraDirectories = read('server/services/spectra/SpectraCameraDirectoryAdapters.ts');
const motionContext = read('server/services/spectra/SpectraMotionContext.ts');
const monteCarlo = read('server/services/geoconsole/monteCarloPathEngine.ts');
const lexaraConversation = read('client/src/components/LexaraConversation.tsx');
const spectraMigration = read('server/migrations/064_spectra_durable_observations.sql');
const motionContextMigration = read('server/migrations/067_spectra_motion_context.sql');
const motionContextAccessMigration = read('server/migrations/068_spectra_motion_context_server_only_access.sql');
const spectraAccessMigration = read('server/migrations/065_spectra_server_only_access.sql');
const spectraIndexMigration = read('server/migrations/066_spectra_foreign_key_indexes.sql');
const landing = read('client/src/pages/landing.tsx');
const login = read('client/src/pages/login.tsx');

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

test('SPECTRA stays hidden from the normal library and launches contextually from Lexara',
  !welcome.includes('name: "SPECTRA"') &&
  !welcome.includes('route: "/spectra"') &&
  lexaraConversation.includes('data-testid="lexara-spectra-launch"') &&
  lexaraConversation.includes("setLocation('/spectra')"));
test('Landing acknowledgement restores signup/Square flow while master access still bypasses payment',
  landing.includes("onClick={() => setLocation('/login')}") &&
  !landing.includes("onClick={() => setLocation('/welcome')}") &&
  login.includes('/api/local-register') &&
  login.includes('/api/subscription/checkout') &&
  login.includes('/api/master-login') &&
  app.includes('isAuthenticated && hasPaidAccess') &&
  app.includes('<Route path="/welcome"><Redirect to="/lexara-consent" /></Route>') &&
  app.includes('<Route path="/lexara-consent" component={LexaraConsentPage} />') &&
  app.includes('<Route path="/lexara-consent/:domainId" component={LexaraConsentPage} />') &&
  app.includes('<Route path="/legal-consultation/:domainId" component={ConsultationPage} />'));

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
test('SPECTRA uses a route-local research budget and Lexara-native background lane',
  routes.includes('investigateLexaraBackgroundQuestion') &&
  routes.includes('settleWithin(') &&
  routes.includes('SPECTRA_OSINT_TIMEOUT_MS'));
test('SPECTRA broad discovery runs through independent native and Claude research lanes',
  routes.includes('runDiscoveryPass') &&
  routes.includes('Promise.allSettled') &&
  routes.includes('discoverLegalMeshTier3') &&
  routes.includes('callClaudeWebSearch') &&
  routes.includes('allowFetch: true'));
test('SPECTRA recursively broadens until evidence sufficiency or diminishing returns',
  routes.includes('SPECTRA_DISCOVERY_POLICY.maxPasses') &&
  routes.includes('SPECTRA_DISCOVERY_POLICY.sufficientConfidence') &&
  routes.includes('SPECTRA_DISCOVERY_POLICY.diminishingReturnFloor') &&
  routes.includes('buildSpectraAdaptiveQuery'));
test('Generic target classes resolve identity without treating city/state as a person name',
  routes.includes('const genericTarget = GENERIC_TARGET_RE.test(normalizedTarget)') &&
  routes.includes('extractLikelyName(details)') &&
  routes.includes('looksLikeLocation') &&
  routes.includes('extractCityStateHint(firstSegment)') &&
  routes.includes('resolvedTargetLabel'));
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
test('All supplied clues may seed discovery without a mandatory name-or-phone gate',
  routes.includes('const identityAnchor = quotedName || quotedPhone ||') &&
  routes.includes("[identityAnchor, compactDetails, 'media geotag timestamp']") &&
  !routes.includes('const secondPass = strongIdentityAnchor ?'));
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
test('SPECTRA is independent of Pantheon discovery and search routing',
  !spectraSources.includes('Pantheon') &&
  !spectraSources.includes('pantheon') &&
  !routes.includes('conductFullOSINT') &&
  !routes.includes('unifiedSearch'));
test('SPECTRA source registry includes the major geospatial evidence families',
  spectraSources.includes("'critical' | 'high' | 'supporting'") &&
  spectraSources.includes("'media-location'") &&
  spectraSources.includes("'camera-context'") &&
  spectraSources.includes("'map-context'") &&
  spectraSources.includes("'weather-context'") &&
  spectraSources.includes("'earth-observation'"));
test('SPECTRA acquisition uses adaptive prioritized source waves without fixed 36/24/12 caps',
  routes.includes('buildSpectraDiscoveryWaves') &&
  routes.includes('buildSpectraAdaptiveQuery') &&
  routes.includes('SPECTRA_DISCOVERY_POLICY') &&
  !routes.includes('.slice(0, 36)') &&
  !routes.includes('.slice(0, 24)') &&
  !routes.includes('.slice(0, 12)'));
test('SPECTRA has nationwide public camera adapters with optional provider expansion',
  geoconsoleRoutes.includes("router.get('/public-cameras'") &&
  geoconsoleRoutes.includes('api.trafficland.com/v2.2/json/video_feeds/poi') &&
  geoconsoleRoutes.includes('SPECTRA_CAMERA_ARCGIS_FEEDS'));
test('SPECTRA has geotagged public-media context adapters',
  geoconsoleRoutes.includes("router.get('/public-geotagged-media'") &&
  geoconsoleRoutes.includes('commons.wikimedia.org/w/api.php') &&
  geoconsoleRoutes.includes('FLICKR_API_KEY'));
test('SPECTRA has weather and earth-observation context adapters',
  geoconsoleRoutes.includes("router.get('/environment-context'") &&
  geoconsoleRoutes.includes('api.weather.gov/stations/') &&
  geoconsoleRoutes.includes('stac.dataspace.copernicus.eu/v1/search'));
test('US address geocoding has an independent Census fallback',
  geocoder.includes('geocoding.geo.census.gov/geocoder/locations/onelineaddress') &&
  geocoder.includes('queryCensusAddressGeocoder(address)'));
test('SPECTRA universal telemetry gateway accepts browser, provider, radio and ranging evidence',
  geoconsoleRoutes.includes("router.post('/telemetry-ingest'") &&
  geoconsoleRoutes.includes("router.post('/telemetry/provider/:providerId'") &&
  geoconsoleRoutes.includes('googleRadioPoint') &&
  geoconsoleRoutes.includes('beaconDbRadioPoint') &&
  geoconsoleRoutes.includes('openCellIdPoint') &&
  geoconsoleRoutes.includes('rangingPoint'));
test('Structured telemetry imports cover the supported interchange formats',
  geoconsoleRoutes.includes("router.post('/telemetry/import'") &&
  ['geojson','gpx','kml','nmea','csv','ndjson'].every(format => telemetryImport.includes(`'${format}'`)));
test('Configured HTTPS pull adapters are bounded and enter the canonical telemetry pipeline',
  geoconsoleRoutes.includes("router.post('/telemetry/pull/:adapterId'") &&
  genericPull.includes("Generic SPECTRA pull adapters require HTTPS.") &&
  genericPull.includes('rows.slice(0, 500)') &&
  geoconsoleRoutes.includes('processTelemetryBatch(batch, true, userId, adapterId)'));
test('Durable SPECTRA persistence stores investigations, clues and deduplicated observations',
  acquisitionPersistence.includes('spectra_investigations') &&
  acquisitionPersistence.includes('spectra_clues') &&
  acquisitionPersistence.includes('spectra_location_observations') &&
  acquisitionPersistence.includes('evidence_fingerprint') &&
  routes.includes('persistSpectraAcquisition'));
test('SPECTRA migration enables PostGIS, RLS and guarded Realtime publication',
  spectraMigration.includes('CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions') &&
  spectraMigration.includes('DO $') &&
  spectraMigration.includes('ADD TABLE public.spectra_location_observations') &&
  (spectraMigration.match(/ENABLE ROW LEVEL SECURITY/g) || []).length === 4);
test('SPECTRA persistence tables remain server-only',
  spectraAccessMigration.includes('REVOKE ALL ON TABLE') &&
  spectraAccessMigration.includes('FROM PUBLIC, anon, authenticated') &&
  spectraAccessMigration.includes('TO service_role') &&
  dockerfile.includes('065_spectra_server_only_access.sql'));
test('SPECTRA persistence foreign keys have covering indexes',
  spectraIndexMigration.includes('spectra_location_observations_investigation_idx') &&
  spectraIndexMigration.includes('spectra_location_observations_telemetry_event_idx') &&
  spectraIndexMigration.includes('spectra_telemetry_events_investigation_idx') &&
  dockerfile.includes('066_spectra_foreign_key_indexes.sql'));
test('Realtime observations work locally and across replicas when Supabase Realtime is configured',
  geoconsoleRoutes.includes("router.get('/telemetry-stream/:sessionId'") &&
  geoconsoleRoutes.includes('telemetryPushEmitter') &&
  geoconsoleRoutes.includes('subscribeSpectraDatabaseObservations') &&
  realtimeBridge.includes("table: 'spectra_location_observations'"));
test('SPECTRA acquisition session stays attached to GeoRuntime without callback churn',
  spectra.includes('sessionId={spectraSessionId}') &&
  spectra.includes('sessionId: sessionOverride || spectraSessionId || undefined') &&
  dashboard.includes('sessionId?: string | null') &&
  dashboard.includes('sessionId: sessionId || undefined') &&
  runtime.includes('const sessionIdRef = useRef<string | null>') &&
  runtime.includes('sessionIdRef.current = canonicalSessionId') &&
  runtime.includes("sessionId: configuredSessionId || undefined") &&
  runtime.includes('/api/geoconsole/telemetry-stream/'));
test('SPECTRA adapter capability registry truthfully exposes optional and built-in lanes',
  adapterRegistry.includes("id: 'browser-geolocation'") &&
  adapterRegistry.includes("id: 'signed-provider-webhook'") &&
  adapterRegistry.includes("id: 'beacondb-radio-geolocation'") &&
  adapterRegistry.includes("id: 'structured-telemetry-import'") &&
  adapterRegistry.includes("id: 'trafficland'") &&
  adapterRegistry.includes("id: 'overpass-place-context'") &&
  adapterRegistry.includes("id: 'geonames-place-context'"));
test('SPECTRA signed provider bridge normalizes carrier, BLE and accessory-network telemetry',
  geoconsoleRoutes.includes("router.post('/telemetry/provider/:providerId/normalize/:kind'") &&
  geoconsoleRoutes.includes('normalizeSpectraProviderPayload') &&
  geoconsoleRoutes.includes('providerTelemetryAuthorized(req)') &&
  adapterRegistry.includes("id: 'camara-location-retrieval-ingest'") &&
  adapterRegistry.includes("id: 'bluetooth-scanner-ingest'") &&
  adapterRegistry.includes("id: 'accessory-network-ingest'") &&
  providerNormalizer.includes("'camara-location-retrieval'") &&
  providerNormalizer.includes("'bluetooth-scanner'") &&
  providerNormalizer.includes("'accessory-network'") &&
  providerNormalizer.includes("source: 'network_region'") &&
  providerNormalizer.includes("kind: 'ranging'"));
test('CAMARA provider normalization preserves circle and polygon uncertainty',
  providerNormalizer.includes("areaType === 'CIRCLE'") &&
  providerNormalizer.includes("areaType === 'POLYGON'") &&
  providerNormalizer.includes('camaraPolygonCenter') &&
  providerNormalizer.includes('confidenceForAccuracy'));
test('Place context uses independent OpenStreetMap and GeoNames lanes',
  geoconsoleRoutes.includes("router.get('/place-context'") &&
  placeContext.includes('overpass-api.de/api/interpreter') &&
  placeContext.includes('secure.geonames.org/findNearbyJSON') &&
  placeContext.includes('Promise.allSettled'));
test('Radio positioning has independent Google, beaconDB and OpenCellID lanes',
  geoconsoleRoutes.includes('www.googleapis.com/geolocation/v1/geolocate') &&
  geoconsoleRoutes.includes('api.beacondb.net/v1/geolocate') &&
  geoconsoleRoutes.includes('opencellid.org/cell/get') &&
  geoconsoleRoutes.includes('Promise.allSettled([') &&
  adapterRegistry.includes("id: 'beacondb-radio-geolocation'"));
test('Public discovery retrieves underlying pages before admitting coordinate evidence',
  routes.includes('retrieveSpectraPublicEvidence') &&
  publicRetrieval.includes('MAX_TARGETS = 6') &&
  publicRetrieval.includes('application/ld+json') &&
  publicRetrieval.includes('json-geospatial-field-extraction') &&
  routes.includes('subjectMatchConfidence: 0.35') &&
  routes.includes('timestampConfidence: observation.timestamp ? 0.75 : 0'));
test('SPECTRA attachment flow accepts both media and structured telemetry files',
  spectra.includes('/api/gps/extract-upload') &&
  spectra.includes('/api/geoconsole/telemetry/import-file') &&
  spectra.includes('handleTargetFile') &&
  spectra.includes('.geojson,.gpx,.kml,.nmea,.csv,.ndjson,.jsonl,.log,.txt'));
test('Lexara exposes the SPECTRA icon only on matching location command responses',
  lexaraConversation.includes('spectraTargetFromPrompt') &&
  lexaraConversation.includes('data-testid="lexara-spectra-launch"') &&
  lexaraConversation.includes("message.role === 'lexara' && message.spectraLaunch") &&
  lexaraConversation.includes("sessionStorage.setItem('legalwhat:spectra-launch'") &&
  spectra.includes("sessionStorage.getItem('legalwhat:spectra-launch'") &&
  spectra.includes('void acquireTarget(targetValue, detailsValue)'));
test('External camera directories are provider-neutral, bounded and spatially filtered',
  geoconsoleRoutes.includes('acquireConfiguredSpectraCameras') &&
  cameraDirectories.includes('SPECTRA_CAMERA_JSON_FEEDS') &&
  cameraDirectories.includes('Camera directory adapters require HTTPS.') &&
  cameraDirectories.includes('rows.slice(0, 500)') &&
  cameraDirectories.includes('haversineMeters(latitude, longitude, lat, lon) > radiusMeters'));
test('Camera directory health marks stale feeds and excludes disabled cameras',
  geoconsoleRoutes.includes('CAMERA_STALE_MS = 24 * 60 * 60_000') &&
  geoconsoleRoutes.includes('normalizeCameraFreshness') &&
  geoconsoleRoutes.includes('camera.status?.disabled === true'));
test('Aggregate camera motion context is stored separately from target observations',
  geoconsoleRoutes.includes("router.post('/traffic-context'") &&
  geoconsoleRoutes.includes("router.post('/traffic-context/provider/:providerId'") &&
  geoconsoleRoutes.includes("router.get('/traffic-context/:sessionId'") &&
  motionContext.includes('spectra_motion_context') &&
  motionContextMigration.includes('CREATE TABLE IF NOT EXISTS public.spectra_motion_context') &&
  adapterRegistry.includes("id: 'aggregate-camera-motion-context'"));
test('Motion-context schema and access migrations are packaged in order and remain server-only',
  dockerfile.includes('067_spectra_motion_context.sql') &&
  dockerfile.includes('068_spectra_motion_context_server_only_access.sql') &&
  motionContextMigration.includes('CREATE TABLE IF NOT EXISTS public.spectra_motion_context') &&
  motionContextAccessMigration.includes('REVOKE ALL ON TABLE public.spectra_motion_context') &&
  motionContextAccessMigration.includes('FROM PUBLIC, anon, authenticated') &&
  motionContextAccessMigration.includes('TO service_role'));
test('Aggregate camera traffic context never becomes a target location observation',
  geoconsoleRoutes.includes("contextKind: 'aggregate_traffic_flow'") &&
  geoconsoleRoutes.includes('persistSpectraMotionContext({') &&
  !motionContext.includes('spectra_location_observations') &&
  !routes.includes('observations.push(...motionContext'));
test('Aggregate vehicle-flow context can refine Futurecast only behind a vehicle-motion gate',
  geoconsoleRoutes.includes('loadSpectraMotionContext') &&
  geoconsoleRoutes.includes('motionContextApplied') &&
  geoconsoleRoutes.includes('WHERE session_id = $1 AND user_id = $2') &&
  monteCarlo.includes('const likelyVehicleMotion = usable.some(vehicleClass)') &&
  monteCarlo.includes('motionContextInfluence = Math.min(0.35') &&
  monteCarlo.includes('motionContextCongestionRatio') &&
  runtime.includes('sessionId: sessionIdRef.current || configuredSessionId || undefined'));
test('WorldCam discovery is additive and camera-directory integration stays provider-neutral',
  spectraSources.includes("sourceId") &&
  spectraSources.includes("'worldcam-directory'") &&
  spectraSources.includes('site:worldcam.io webcam camera live') &&
  cameraDirectories.includes('SPECTRA_CAMERA_JSON_FEEDS') &&
  adapterRegistry.includes("id: 'external-camera-json'"));
test('Generic vehicle/camera feeds preserve track identity and velocity context',
  genericPull.includes('trackIdPath?: string') &&
  genericPull.includes('cameraIdPath?: string') &&
  genericPull.includes('objectClassPath?: string') &&
  genericPull.includes('speedPath?: string') &&
  genericPull.includes('headingPath?: string') &&
  geoconsoleRoutes.includes('trackId: z.string()') &&
  geoconsoleRoutes.includes('cameraId: z.string()') &&
  geoconsoleRoutes.includes('objectClass: z.string()') &&
  geoconsoleRoutes.includes("typeof inputMetadata.trackId === 'string'") &&
  geoconsoleRoutes.includes('velocity: (') &&
  geoconsoleRoutes.includes(': inputMetadata.velocity'));
test('SPECTRA API is mounted',
  serverRoutes.includes("app.use('/api/spectra', spectraRoutes.default)"));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
