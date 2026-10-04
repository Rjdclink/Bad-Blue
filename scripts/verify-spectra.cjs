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
const activeAcquisition = read('server/services/spectra/SpectraActiveAcquisition.ts');
const anchorRegistry = read('server/services/spectra/SpectraAnchorRegistry.ts');
const providerNormalizer = read('server/services/spectra/SpectraProviderTelemetryNormalizer.ts');
const advancedRadioNormalizer = read('server/services/spectra/SpectraAdvancedRadioNormalizer.ts');
const externalLocationNormalizer = read('server/services/spectra/SpectraExternalLocationNormalizer.ts');
const liveConfidence = read('server/services/spectra/SpectraLiveConfidence.ts');
const constraintSolver = read('server/services/spectra/SpectraConstraintSolver.ts');
const gnssIntegrity = read('server/services/spectra/SpectraGnssIntegrity.ts');
const identityBinding = read('server/services/spectra/SpectraIdentityBinding.ts');
const posteriorCalibration = read('scripts/verify-spectra-posterior-calibration.ts');
const genericPull = read('server/services/spectra/SpectraGenericPullAdapters.ts');
const realtimeBridge = read('server/services/spectra/SpectraRealtimeBridge.ts');
const telemetryImport = read('server/services/spectra/SpectraTelemetryImport.ts');
const acquisitionPersistence = read('server/services/spectra/SpectraAcquisitionPersistence.ts');
const placeContext = read('server/services/spectra/SpectraPlaceContext.ts');
const publicInfrastructure = read('server/services/spectra/SpectraPublicInfrastructureContext.ts');
const publicFeedRegistry = read('server/services/spectra/SpectraPublicFeedRegistry.ts');
const gtfsRealtimeContext = read('server/services/spectra/SpectraGtfsRealtimeContext.ts');
const arcGisCameraDiscovery = read('server/services/spectra/SpectraArcGisPublicCameraDiscovery.ts');
const floorplanTransformer = read('server/services/spectra/SpectraFloorplanTransformer.ts');
const infrastructureIdentity = read('server/services/spectra/SpectraInfrastructureIdentity.ts');
const acquisitionControl = read('server/services/spectra/SpectraAcquisitionControl.ts');
const apiContract = read('server/services/spectra/SpectraApiContract.ts');
const resourceGovernor = read('server/services/spectra/SpectraResourceGovernor.ts');
const observability = read('server/services/spectra/SpectraObservability.ts');
const tenantScope = read('server/services/spectra/SpectraTenantScope.ts');
const providerSessionAccess = read('server/services/spectra/SpectraProviderSessionAccess.ts');
const mapRendererAdapter = read('client/src/components/geoconsole/MapRendererAdapter.ts');
const geoconsoleCore = read('server/services/geoconsole/index.ts');
const railwayEnvExample = read('.env.railway.example');
const legalProviderMesh = read('server/lexara/LegalProviderMesh.ts');
const hootenannyContext = read('server/services/spectra/SpectraHootenannyContext.ts');
const mylnikovResolver = read('server/services/spectra/SpectraMylnikovResolver.ts');
const wigleResolver = read('server/services/spectra/SpectraWigleRadioResolver.ts');
const unwiredResolver = read('server/services/spectra/SpectraUnwiredRadioResolver.ts');
const radioConsensus = read('server/services/spectra/SpectraRadioConsensus.ts');
const radioConsensusVerifier = read('scripts/verify-spectra-radio-consensus.ts');
const openSourceBridgeNormalizer = read('server/services/spectra/SpectraOpenSourceBridgeNormalizer.ts');
const openSourceBridgeVerifier = read('scripts/verify-spectra-open-source-bridges.ts');
const infrastructureNormalizer = read('server/services/spectra/SpectraInfrastructureProviderNormalizer.ts');
const arubaStreamDecoder = read('server/services/spectra/SpectraArubaStreamDecoder.ts');
const providerStreamCoordinator = read('server/services/spectra/SpectraProviderStreamCoordinator.ts');
const mqttProviderCoordinator = read('server/services/spectra/SpectraMqttProviderCoordinator.ts');
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
const spectraTenantHistoryIndexMigration = read('server/migrations/069_spectra_tenant_history_indexes.sql');
const spectraAcquisitionControlMigration = read('server/migrations/070_spectra_acquisition_control.sql');
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
  spectra.includes("await acquireTarget(targetRef.current || target, message)"));
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
test('SPECTRA acquisition uses adaptive prioritized source waves with policy-bounded discovery',
  routes.includes('buildSpectraDiscoveryWaves') &&
  routes.includes('buildSpectraAdaptiveQuery') &&
  routes.includes('SPECTRA_DISCOVERY_POLICY') &&
  routes.includes('discoveryQueriesAttempted >= SPECTRA_DISCOVERY_POLICY.maxQueries') &&
  routes.includes('discoveryResults.length >= SPECTRA_DISCOVERY_POLICY.maxCandidates') &&
  routes.includes('.slice(0, SPECTRA_DISCOVERY_POLICY.maxCandidates)'));
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
  geoconsoleRoutes.includes('processSpectraTelemetryBatch(batch, true, userId, adapterId)'));
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
  spectra.includes('sessionOverride ||') &&
  spectra.includes('spectraSessionIdRef.current ||') &&
  spectra.includes('sessionId: resolvedSessionId') &&
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
test('SPECTRA active acquisition uses managed-device identifiers and canonical telemetry processing',
  routes.includes('acquireSpectraActiveTelemetry') &&
  routes.includes('resolveSpectraNormalizedTelemetryBatch') &&
  routes.includes('activeAcquisitionPositionCount') &&
  activeAcquisition.includes("target: 'device'") &&
  activeAcquisition.includes("'canonical-telemetry'") &&
  activeAcquisition.includes('SPECTRA_ACTIVE_PROVIDER_ADAPTERS') &&
  activeAcquisition.includes('SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE') &&
  !activeAcquisition.includes("target: 'phone'") &&
  !activeAcquisition.includes('SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL') &&
  adapterRegistry.includes("id: 'android-managed-location-active'") &&
  adapterRegistry.includes("id: 'apple-managed-location-active'") &&
  adapterRegistry.includes("id: 'cisco-spaces-active-location'") &&
  adapterRegistry.includes("id: 'active-provider-adapters'") &&
  activeAcquisition.includes('SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE') &&
  activeAcquisition.includes('SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE'));
test('Constraint solver is wired before posterior confidence and Futurecast',
  geoconsoleRoutes.includes('solveSpectraConstraintLayer(quality.points)') &&
  geoconsoleRoutes.indexOf('solveSpectraConstraintLayer(quality.points)') <
    geoconsoleRoutes.indexOf('assessSpectraLiveLocation(constrainedPoints)') &&
  geoconsoleRoutes.includes('hybridGeoconsole.processLocationData(constrainedPoints, sessionId)') &&
  constraintSolver.includes('buildSpectraSpatialConstraints') &&
  constraintSolver.includes('dependencyGraph') &&
  constraintSolver.includes('spectra_forward_backward_motion_smoother'));
test('Ranging keeps anchor geometry for the common constraint layer',
  geoconsoleRoutes.includes('constraintAnchors: anchors.map(anchor => ({') &&
  geoconsoleRoutes.includes('bearingUncertaintyDegrees: anchor.raw.bearingUncertaintyDegrees'));

test('Configured anchor identities are resolved before trusted ranging multilateration',
  anchorRegistry.includes('SPECTRA_ANCHOR_CATALOG_JSON') &&
  anchorRegistry.includes('resolveConfiguredSpectraAnchor') &&
  advancedRadioNormalizer.includes('resolveConfiguredSpectraAnchor') &&
  geoconsoleRoutes.includes('coalesceTrustedRangingMeasurements') &&
  geoconsoleRoutes.includes('resolveSpectraNormalizedTelemetryBatch'));
test('Cisco Spaces active-client REST responses preserve location freshness and AP context',
  externalLocationNormalizer.includes('wrapped.body.results') &&
  externalLocationNormalizer.includes('event.lastLocationAt') &&
  externalLocationNormalizer.includes('event.confidenceFactor') &&
  externalLocationNormalizer.includes('event.numDetectingAps') &&
  externalLocationNormalizer.includes("providerKind: 'cisco-spaces-location'"));
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
test('Advanced radio normalizers stay on the signed canonical provider bridge',
  geoconsoleRoutes.includes("router.post('/telemetry/provider/:providerId/normalize/:kind'") &&
  providerNormalizer.includes('SPECTRA_ADVANCED_RADIO_NORMALIZER_KINDS') &&
  providerNormalizer.includes('normalizeSpectraAdvancedRadioPayload') &&
  advancedRadioNormalizer.includes("'bluetooth-channel-sounding'") &&
  advancedRadioNormalizer.includes("'ble-direction-finding'") &&
  advancedRadioNormalizer.includes("'android-wifi-ranging'") &&
  advancedRadioNormalizer.includes("'android-ranging-manager'") &&
  advancedRadioNormalizer.includes("'android-cellular'") &&
  advancedRadioNormalizer.includes("'android-raw-gnss'") &&
  advancedRadioNormalizer.includes("'apple-nearby-interaction'") &&
  advancedRadioNormalizer.includes("'android-radio-collector'") &&
  advancedRadioNormalizer.includes("'ble-gateway'") &&
  advancedRadioNormalizer.includes("'lorawan-observation'") &&
  advancedRadioNormalizer.includes("'universal-radio-log'"));
test('Bluetooth adapters preserve Channel Sounding PBR/RTT plus AoA/AoD direction data',
  advancedRadioNormalizer.includes('pbrDistanceMeters') &&
  advancedRadioNormalizer.includes('rttDistanceMeters') &&
  advancedRadioNormalizer.includes("methodRaw === 'aod'") &&
  advancedRadioNormalizer.includes('antennaArrayId') &&
  advancedRadioNormalizer.includes("'bluetooth_channel_sounding'") &&
  advancedRadioNormalizer.includes("'ble_aod'") &&
  advancedRadioNormalizer.includes("'ble_aoa'"));
test('Android Wi-Fi adapter preserves 802.11az NTB, responder location and Wi-Fi Aware context',
  advancedRadioNormalizer.includes("'802.11az-ntb'") &&
  advancedRadioNormalizer.includes('responderLocation') &&
  advancedRadioNormalizer.includes('wifiAwarePeer') &&
  advancedRadioNormalizer.includes("source: 'wifi_rtt'"));
test('Android RangingManager adapter unifies UWB, Channel Sounding, Wi-Fi NAN RTT and BLE RSSI',
  advancedRadioNormalizer.includes("'android-ranging-manager'") &&
  advancedRadioNormalizer.includes("providerKind: 'android-ranging-manager'") &&
  advancedRadioNormalizer.includes("'wifi-nan-rtt'") &&
  advancedRadioNormalizer.includes("'bluetooth_channel_sounding'") &&
  advancedRadioNormalizer.includes("'uwb_direction'") &&
  advancedRadioNormalizer.includes("'ble_rssi'") &&
  adapterRegistry.includes("id: 'android-ranging-manager-ingest'"));
test('5G NR positioning adapter preserves PRS TDOA RTT angle and NLOS evidence',
  advancedRadioNormalizer.includes("'nr-positioning'") &&
  advancedRadioNormalizer.includes("'dl-tdoa'") &&
  advancedRadioNormalizer.includes("'ul-tdoa'") &&
  advancedRadioNormalizer.includes("'multi-rtt'") &&
  advancedRadioNormalizer.includes("'carrier-phase'") &&
  advancedRadioNormalizer.includes('prsRsrpDbm') &&
  advancedRadioNormalizer.includes('referenceSignalTimeDifferenceNanos') &&
  advancedRadioNormalizer.includes('nlosProbability') &&
  advancedRadioNormalizer.includes("source: 'nr_positioning'") &&
  adapterRegistry.includes("id: 'nr-positioning-ingest'"));
test('Android UWB sensor fusion distinguishes precise imprecise and drifting estimates',
  advancedRadioNormalizer.includes("'android-uwb-sensor-fusion'") &&
  advancedRadioNormalizer.includes("estimateType === 'drifting'") &&
  advancedRadioNormalizer.includes("providerKind: 'android-uwb-sensor-fusion'") &&
  advancedRadioNormalizer.includes('dataStalenessThresholdMillis') &&
  adapterRegistry.includes("id: 'android-uwb-sensor-fusion-ingest'"));
test('Rich cellular schema preserves radio generation, PCI/ARFCN and NR/legacy signal metrics',
  geoconsoleRoutes.includes('physicalCellId: z.number()') &&
  geoconsoleRoutes.includes('arfcn: z.number()') &&
  geoconsoleRoutes.includes('ssRsrpDbm: z.number()') &&
  geoconsoleRoutes.includes('csiRsrpDbm: z.number()') &&
  geoconsoleRoutes.includes('csiSinrDb: z.number()') &&
  geoconsoleRoutes.includes('cqi: z.number()') &&
  geoconsoleRoutes.includes('rscpDbm: z.number()') &&
  geoconsoleRoutes.includes('bitErrorRate: z.number()') &&
  geoconsoleRoutes.includes('sanitizedCellTowers') &&
  advancedRadioNormalizer.includes('newRadioCellId') &&
  advancedRadioNormalizer.includes('physicalCellId') &&
  advancedRadioNormalizer.includes('signalMetrics'));
test('Raw GNSS adapter preserves clock, pseudorange/rate, ADR, carrier frequency and C/N0',
  advancedRadioNormalizer.includes('fullBiasNanos') &&
  advancedRadioNormalizer.includes('biasUncertaintyNanos') &&
  advancedRadioNormalizer.includes('pseudorangeMeters') &&
  advancedRadioNormalizer.includes('pseudorangeRateMetersPerSecond') &&
  advancedRadioNormalizer.includes('accumulatedDeltaRangeMeters') &&
  advancedRadioNormalizer.includes('carrierFrequencyHz') &&
  advancedRadioNormalizer.includes('cn0DbHz') &&
  geoconsoleRoutes.includes("'gnss_raw'"));
test('GNSS integrity evaluates ADR continuity multipath authentication and interference',
  advancedRadioNormalizer.includes('assessSpectraGnssIntegrity') &&
  gnssIntegrity.includes('ADR_STATE_CYCLE_SLIP') &&
  gnssIntegrity.includes('MULTIPATH_DETECTED') &&
  gnssIntegrity.includes('carrierPhaseReady') &&
  gnssIntegrity.includes('dualFrequencyReady') &&
  gnssIntegrity.includes('multiConstellationReady') &&
  gnssIntegrity.includes('navigationAuthenticationStatus') &&
  gnssIntegrity.includes('spoofingSuspected') &&
  gnssIntegrity.includes('jammingSuspected') &&
  gnssIntegrity.includes('lineOfSightProbability') &&
  gnssIntegrity.includes('excessPathLengthMeters') &&
  gnssIntegrity.includes('measurementCorrectionCoverage') &&
  gnssIntegrity.includes('correlationVectorSatelliteCount') &&
  advancedRadioNormalizer.includes('probabilityLineOfSight') &&
  advancedRadioNormalizer.includes('phaseCenterVariationCorrectionCount'));
test('Precision GNSS adapter preserves RTK PPP NTRIP RTCM HAS covariance and protection levels',
  advancedRadioNormalizer.includes("'gnss-precision-solution'") &&
  advancedRadioNormalizer.includes("'rtk-fixed'") &&
  advancedRadioNormalizer.includes("'network-rtk'") &&
  advancedRadioNormalizer.includes("'ppp-rtk'") &&
  advancedRadioNormalizer.includes('correctionAgeSeconds') &&
  advancedRadioNormalizer.includes('ntripMountpoint') &&
  advancedRadioNormalizer.includes('rtcmMessages') &&
  advancedRadioNormalizer.includes('correctionService') &&
  advancedRadioNormalizer.includes('correctionServiceLevel') &&
  advancedRadioNormalizer.includes('correctionCapabilities') &&
  advancedRadioNormalizer.includes('ambiguityRatio') &&
  advancedRadioNormalizer.includes('horizontalProtectionLevelMeters') &&
  adapterRegistry.includes("id: 'gnss-precision-solution-ingest'"));
test('Apple Nearby Interaction adapter covers UWB, EDM, DL-TDOA and Bluetooth Channel Sounding',
  advancedRadioNormalizer.includes("'uwb-edm'") &&
  advancedRadioNormalizer.includes("'dl-tdoa'") &&
  advancedRadioNormalizer.includes("'bluetooth-channel-sounding'") &&
  advancedRadioNormalizer.includes("'bluetooth_channel_sounding'") &&
  advancedRadioNormalizer.includes("'uwb_direction'") &&
  advancedRadioNormalizer.includes("'uwb_range'") &&
  geoconsoleRoutes.includes("'bluetooth_channel_sounding'") &&
  geoconsoleRoutes.includes("'ble_aod'"));
test('Managed-device, enterprise sensor, IoT and vehicle feeds share the signed provider bridge',
  providerNormalizer.includes('SPECTRA_EXTERNAL_LOCATION_NORMALIZER_KINDS') &&
  providerNormalizer.includes('normalizeSpectraExternalLocationPayload') &&
  externalLocationNormalizer.includes("'android-managed-lost-mode'") &&
  externalLocationNormalizer.includes("'apple-managed-lost-mode'") &&
  externalLocationNormalizer.includes("'meraki-scanning'") &&
  externalLocationNormalizer.includes("'cisco-spaces-location'") &&
  externalLocationNormalizer.includes("'aws-iot-device-location'") &&
  externalLocationNormalizer.includes("'arcore-geospatial-pose'") &&
  externalLocationNormalizer.includes("'connected-vehicle-location'") &&
  adapterRegistry.includes("id: 'android-managed-lost-mode-ingest'") &&
  adapterRegistry.includes("id: 'apple-managed-lost-mode-ingest'") &&
  adapterRegistry.includes("id: 'meraki-scanning-ingest'") &&
  adapterRegistry.includes("id: 'cisco-spaces-location-ingest'") &&
  adapterRegistry.includes("id: 'aws-iot-device-location-ingest'") &&
  adapterRegistry.includes("id: 'arcore-geospatial-pose-ingest'") &&
  adapterRegistry.includes("id: 'connected-vehicle-location-ingest'"));
test('ARCore Geospatial VPS preserves calibrated visual-positioning accuracy without double-counting same-device GNSS',
  externalLocationNormalizer.includes("'arcore-geospatial-pose'") &&
  externalLocationNormalizer.includes("source: 'visual_positioning'") &&
  externalLocationNormalizer.includes("accuracyConfidenceLevel: 0.68") &&
  externalLocationNormalizer.includes("correlationDomain: deviceRef") &&
  adapterRegistry.includes("id: 'arcore-geospatial-pose-ingest'") &&
  geoconsoleRoutes.includes("'visual_positioning'") &&
  fusion.includes("source: 'visual_positioning'") &&
  liveConfidence.includes("point.source === 'visual_positioning'"));
test('CAMARA verification and reachability remain corroboration context rather than fabricated positions',
  externalLocationNormalizer.includes("'camara-location-verification'") &&
  externalLocationNormalizer.includes("'camara-reachability'") &&
  externalLocationNormalizer.includes("'location_verification'") &&
  externalLocationNormalizer.includes("'network_reachability'") &&
  geoconsoleRoutes.includes("'location_verification', 'network_reachability'"));
test('SPECTRA live confidence is posterior/covariance driven with no hard-coded 99 percent gate',
  routes.includes('assessSpectraLiveLocation(solvedLocationObservations)') &&
  routes.includes('liveLocationAssessment.confidenceScore') &&
  routes.includes('liveLocationRadius99Meters') &&
  liveConfidence.includes('radiusToSigma') &&
  liveConfidence.includes('metadataCovarianceSigma') &&
  liveConfidence.includes('confidenceRadius(posteriorSigma, 0.99)') &&
  liveConfidence.includes('chiSquareSurvivalApprox') &&
  liveConfidence.includes('Huber-style continuous down-weighting') &&
  liveConfidence.includes('combinedIndependentReliability') &&
  liveConfidence.includes('correlationWeight') &&
  liveConfidence.includes('protectionLevelFloor') &&
  liveConfidence.includes('temporalInflationMeters') &&
  liveConfidence.includes('measurementQualityWeight') &&
  liveConfidence.includes('independentDomainCount') &&
  liveConfidence.includes("'visual-positioning'") &&
  liveConfidence.includes('precisionReadinessScore') &&
  liveConfidence.includes('ambiguityRatio') &&
  liveConfidence.includes('satellitesUsed') &&
  liveConfidence.includes('correctionAgeSeconds') &&
  !liveConfidence.includes('0.991') &&
  !liveConfidence.includes('exceedsNinetyNinePercent') &&
  !liveConfidence.includes('strongConsensus.length < 3') &&
  !liveConfidence.includes('precisionFamilyCount < 2'));
test('Main SPECTRA acquisition uses the constraint solver before fusion confidence and persistence',
  routes.includes("import { solveSpectraConstraintLayer } from '../services/spectra/SpectraConstraintSolver'") &&
  routes.includes('const constraintSolution = solveSpectraConstraintLayer(qualityLocationObservations)') &&
  routes.includes('const solvedLocationObservations = constraintSolution.points') &&
  routes.includes('inputFusionEngine.fuseInputs(solvedLocationObservations)') &&
  routes.includes('assessSpectraLiveLocation(solvedLocationObservations)') &&
  routes.includes('observations: solvedLocationObservations') &&
  routes.includes('constraintSolverDiagnostics: constraintSolution.diagnostics'));
test('Telemetry persistence and realtime publish the same constrained points used by posterior and Futurecast',
  geoconsoleRoutes.includes('const constrainedPoints = constraintSolution.points') &&
  geoconsoleRoutes.includes('assessSpectraLiveLocation(constrainedPoints)') &&
  geoconsoleRoutes.includes('hybridGeoconsole.processLocationData(constrainedPoints, sessionId)') &&
  geoconsoleRoutes.includes('points: constrainedPoints'));

test('Carrier identity bindings are persisted, reloaded and fused conservatively with spatial confidence',
  acquisitionPersistence.includes('loadSpectraSessionIdentityBindings') &&
  acquisitionPersistence.includes("measurement.source !== 'identity_binding'") &&
  routes.includes('loadSpectraSessionIdentityBindings') &&
  routes.includes('assessSpectraIdentityBinding') &&
  routes.includes('conservativeJointConfidence') &&
  routes.includes('subjectLiveLocationConfidence') &&
  identityBinding.includes('camara-number-verification') &&
  identityBinding.includes('camara-device-identifier') &&
  identityBinding.includes('camara-kyc-match') &&
  identityBinding.includes('Fréchet-Hoeffding lower bound'));
test('Posterior calibration verifies independent and correlated 99 percent containment without a runtime score floor',
  posteriorCalibration.includes('TRIALS = 10_000') &&
  posteriorCalibration.includes('empiricalContainment >= 0.99') &&
  posteriorCalibration.includes('CORRELATED_TRIALS = 5_000') &&
  posteriorCalibration.includes('correlatedContainment >= 0.99') &&
  posteriorCalibration.includes("correlationDomain: 'same-device-a'") &&
  posteriorCalibration.includes('assessment.confidenceScore > 0.99') &&
  posteriorCalibration.includes('confidenceRadiusMeters99') &&
  posteriorCalibration.includes('calibration regression test, not a runtime threshold') &&
  !liveConfidence.includes('Math.max(score, 0.99') &&
  !liveConfidence.includes('exceedsNinetyNinePercent'));
test('CDMA cell identity preserves SID NID and BID through the canonical radio schema',
  advancedRadioNormalizer.includes('cell.systemId ?? cell.sid') &&
  advancedRadioNormalizer.includes('cell.networkId ?? cell.nid') &&
  advancedRadioNormalizer.includes('cell.baseStationId ?? cell.bid') &&
  advancedRadioNormalizer.includes("type === 'cdma' ? systemId") &&
  advancedRadioNormalizer.includes("type === 'cdma' ? networkId") &&
  advancedRadioNormalizer.includes("type === 'cdma' ? baseStationId"));
test('Universal radio-log importer recognizes CSV Android GNSS Logger and RTKLIB precision records',
  advancedRadioNormalizer.includes("import { parse as parseCsv } from 'csv-parse/sync'") &&
  advancedRadioNormalizer.includes('/^#\\s*Raw,/i') &&
  advancedRadioNormalizer.includes("recordType: 'gnsslogger-raw'") &&
  advancedRadioNormalizer.includes('parseRtklibPosRecords') &&
  advancedRadioNormalizer.includes("recordType: 'rtklib-pos'") &&
  advancedRadioNormalizer.includes("kind: 'rtklib-solution'") &&
  advancedRadioNormalizer.includes('signedSquareRootCovarianceToCovariance') &&
  advancedRadioNormalizer.includes('rtklibCalendarTimestamp') &&
  advancedRadioNormalizer.includes("timeSystem: 'GPST' | 'UTC' | 'JST'") &&
  advancedRadioNormalizer.includes('inputTimeSystem') &&
  advancedRadioNormalizer.includes("kind === 'gnss-precision-solution' ? { solutions: [row]") &&
  advancedRadioNormalizer.includes('UtcTimeMillis') &&
  advancedRadioNormalizer.includes('CarrierFrequencyHz') &&
  advancedRadioNormalizer.includes('AccumulatedDeltaRangeMeters'));
test('BLE gateway, LoRa and universal radio-log lanes are registered and bounded',
  adapterRegistry.includes("id: 'ble-gateway-ingest'") &&
  adapterRegistry.includes("id: 'lorawan-observation-ingest'") &&
  adapterRegistry.includes("id: 'universal-radio-log-ingest'") &&
  advancedRadioNormalizer.includes('observations.slice(0, 4000)') &&
  advancedRadioNormalizer.includes('uplinks.slice(0, 1024)') &&
  advancedRadioNormalizer.includes('rows.slice(0, 5000)'));
test('Advanced adapter registry exposes all requested radio families',
  adapterRegistry.includes("id: 'bluetooth-channel-sounding-ingest'") &&
  adapterRegistry.includes("id: 'ble-direction-finding-ingest'") &&
  adapterRegistry.includes("id: 'android-wifi-ranging-ingest'") &&
  adapterRegistry.includes("id: 'android-ranging-manager-ingest'") &&
  adapterRegistry.includes("id: 'android-cellular-measurements-ingest'") &&
  adapterRegistry.includes("id: 'android-raw-gnss-ingest'") &&
  adapterRegistry.includes("id: 'apple-nearby-interaction-ingest'") &&
  adapterRegistry.includes("id: 'android-radio-collector-ingest'"));
test('CAMARA provider normalization preserves circle and polygon uncertainty',
  providerNormalizer.includes("areaType === 'CIRCLE'") &&
  providerNormalizer.includes("areaType === 'POLYGON'") &&
  providerNormalizer.includes('camaraPolygonCenter') &&
  providerNormalizer.includes('confidenceForAccuracy'));
test('Public infrastructure context adds FCC antenna and NOAA CORS sources without promoting them to target observations',
  publicInfrastructure.includes('FCC Antenna Structure Registration') &&
  publicInfrastructure.includes('NOAA CORS Network') &&
  publicInfrastructure.includes('contextOnly: true') &&
  placeContext.includes('acquireSpectraPublicInfrastructureContext') &&
  routes.includes("sourceFamilies.push('public-infrastructure')") &&
  !publicInfrastructure.includes('spectra_location_observations'));
test('Public GTFS-Realtime catalog discovery is keyless, bounded and context-only',
  publicFeedRegistry.includes('https://files.mobilitydatabase.org/feeds_v2.csv') &&
  publicFeedRegistry.includes("authenticationType === 0") &&
  publicFeedRegistry.includes("record.entityTypes.includes('vp')") &&
  geoconsoleRoutes.includes("router.get('/public-feed-catalog'") &&
  geoconsoleRoutes.includes('contextOnly: true') &&
  routes.includes("sourceFamilies.push('public-mobility-feed')"));
test('GTFS-Realtime parser is bounded and handles vehicle-position protobuf fields without adding target evidence',
  gtfsRealtimeContext.includes('class ProtobufReader') &&
  gtfsRealtimeContext.includes('parseVehiclePosition') &&
  gtfsRealtimeContext.includes('bytes.length > 8_000_000') &&
  gtfsRealtimeContext.includes('contextOnly: true'));
test('ArcGIS public camera discovery is spatially bounded and rejects private/reserved service targets',
  arcGisCameraDiscovery.includes('https://www.arcgis.com/sharing/rest/search') &&
  arcGisCameraDiscovery.includes("'bbox'") &&
  arcGisCameraDiscovery.includes("type:\"Feature Service\"") &&
  arcGisCameraDiscovery.includes("lookup(host, { all: true, verbatim: true })") &&
  arcGisCameraDiscovery.includes('isPrivateIpv4') &&
  arcGisCameraDiscovery.includes('isPrivateIpv6') &&
  arcGisCameraDiscovery.includes("host.endsWith('.local')") &&
  arcGisCameraDiscovery.includes('assertPublicServiceUrl') &&
  geoconsoleRoutes.includes('discoverPublicArcGisCameraLayers') &&
  adapterRegistry.includes("id: 'public-arcgis-camera-discovery'"));
test('Infrastructure floorplan and identity helper utilities remain bounded and configuration-driven',
  floorplanTransformer.includes('SPECTRA_FLOORPLAN_CALIBRATIONS_JSON') &&
  floorplanTransformer.includes('affine-three-point') &&
  infrastructureIdentity.includes('SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS') &&
  infrastructureIdentity.includes('infrastructureCorrelationGroup'));

test('SPECTRA exposes a pinned v1 interface with OpenAPI and compatibility mounts',
  apiContract.includes("export const SPECTRA_API_VERSION = '1'") &&
  apiContract.includes("openapi: '3.1.0'") &&
  apiContract.includes("'/acquire'") &&
  apiContract.includes("'/telemetry-history/{sessionId}'") &&
  routes.includes("router.get('/openapi.json'") &&
  serverRoutes.includes("app.use('/api/spectra/v1', spectraRoutes.default)") &&
  serverRoutes.includes("app.use('/api/geoconsole/v1', geoconsoleRoutes.default)"));
test('SPECTRA API responses advertise stable API and schema versions',
  apiContract.includes('X-Spectra-Api-Version') &&
  apiContract.includes('X-Spectra-Schema-Version') &&
  routes.includes('spectraApiVersionHeaders') &&
  geoconsoleRoutes.includes('spectraApiVersionHeaders'));
test('Durable observations are canonical and reports rehydrate bounded history after cache loss or restart',
  spectraMigration.includes('CREATE TABLE IF NOT EXISTS public.spectra_location_observations') &&
  acquisitionPersistence.includes('loadSpectraSessionObservationRange') &&
  geoconsoleRoutes.includes('const durableRange = await loadSpectraSessionObservationRange') &&
  geoconsoleRoutes.includes('await hybridGeoconsole.processLocationData(durableRange.points, sessionId)') &&
  geoconsoleRoutes.includes('durableHistoryTruncated: durableRange.truncated') &&
  geoconsoleRoutes.includes('durable SPECTRA observations remain in PostgreSQL/Supabase'));
test('Provider and renderer layers are replaceable rather than hard-wired',
  adapterRegistry.includes("id: 'generic-https-json-pull'") &&
  providerNormalizer.includes('SPECTRA_PROVIDER_NORMALIZER_KINDS') &&
  legalProviderMesh.includes('export interface LegalMeshCandidate') &&
  legalProviderMesh.includes("provider:'tavily'") &&
  legalProviderMesh.includes("provider:'searxng'") &&
  mapRendererAdapter.includes("export interface GeoconsoleMapRendererAdapter") &&
  mapRendererAdapter.includes("id: 'maplibre'") &&
  mapRendererAdapter.includes("id: 'mapbox-global'") &&
  intelligenceMap.includes('resolveGeoconsoleMapRenderer'));
test('Cross-replica resource governance uses PostgreSQL advisory locks with bounded waiting',
  resourceGovernor.includes('pg_try_advisory_lock') &&
  resourceGovernor.includes('SPECTRA_MAX_CONCURRENT_ACQUISITIONS') &&
  resourceGovernor.includes('SPECTRA_MAX_CONCURRENT_ACQUISITIONS_PER_TENANT') &&
  resourceGovernor.includes('SPECTRA_RESOURCE_ACQUIRE_TIMEOUT_MS') &&
  routes.includes('acquireSpectraResourcePermit') &&
  routes.includes("res.status(429)") &&
  spectra.includes("response.status === 429") &&
  spectra.includes("response.headers.get('Retry-After')"));
test('GeoConsole max concurrency and compute budget are active controls, not descriptive settings',
  geoconsoleCore.includes('acquireProcessingPermit') &&
  geoconsoleCore.includes('this.orchestrationState.activeTasks += 1') &&
  geoconsoleCore.includes('this.orchestrationState.computeUsage += units') &&
  geoconsoleCore.includes('this.orchestrationConfig.maxConcurrentOperations') &&
  geoconsoleCore.includes('this.orchestrationConfig.computeBudget') &&
  geoconsoleCore.includes('GeoConsole processing queue is saturated'));
test('Railway-facing resource controls are documented for reproducible configuration',
  railwayEnvExample.includes('SPECTRA_MAX_CONCURRENT_ACQUISITIONS=4') &&
  railwayEnvExample.includes('SPECTRA_MAX_CONCURRENT_ACQUISITIONS_PER_TENANT=2') &&
  railwayEnvExample.includes('SPECTRA_RESOURCE_ACQUIRE_TIMEOUT_MS=1500'));
test('SPECTRA exposes liveness, readiness, detailed health and Prometheus metrics',
  routes.includes("router.get('/live'") &&
  routes.includes("router.get('/ready'") &&
  routes.includes("router.get('/health'") &&
  routes.includes("router.get('/metrics'") &&
  routes.includes("pool.query('SELECT 1 AS ok')") &&
  observability.includes('# TYPE spectra_acquisitions_total counter') &&
  observability.includes('# TYPE spectra_acquisition_active gauge') &&
  observability.includes('# TYPE spectra_provider_events_total counter'));
test('Provider health includes active pulls plus WSS and MQTT stream state',
  activeAcquisition.includes('getSpectraActiveAcquisitionHealth') &&
  routes.includes('getSpectraActiveAcquisitionHealth') &&
  routes.includes('getSpectraProviderStreamHealth') &&
  routes.includes('getSpectraMqttProviderHealth'));
test('Tenant isolation is explicit and all owned provider writes require a provider-session binding',
  tenantScope.includes("model: 'user-v1'") &&
  acquisitionPersistence.includes('WHERE session_id = $1 AND user_id = $2') &&
  geoconsoleRoutes.includes('providerMayWriteOwnedSpectraSession') &&
  providerSessionAccess.includes('SPECTRA_PROVIDER_SESSION_BINDINGS') &&
  providerSessionAccess.includes('ownerTenantId') &&
  spectraAccessMigration.includes('FROM PUBLIC, anon, authenticated') &&
  spectraAccessMigration.includes('TO service_role'));
test('Provider traffic context cannot attach to an owned tenant session without an explicit binding',
  geoconsoleRoutes.includes('Traffic-context provider is not bound to this tenant session.') &&
  geoconsoleRoutes.includes('providerMayWriteOwnedSpectraSession({') &&
  railwayEnvExample.includes('SPECTRA_PROVIDER_SESSION_BINDINGS=[]'));

test('Long-running durable history returns freshest bounded evidence and supports opaque cursor pagination',
  acquisitionPersistence.includes('ORDER BY observed_at DESC, id DESC') &&
  acquisitionPersistence.includes('encodeObservationCursor') &&
  acquisitionPersistence.includes('decodeObservationCursor') &&
  acquisitionPersistence.includes('loadSpectraSessionObservationRange') &&
  geoconsoleRoutes.includes("cursor: z.string().trim().min(1).max(1_000).optional()") &&
  geoconsoleRoutes.includes("order: 'newest-first'") &&
  apiContract.includes('opaque nextCursor') &&
  spectraTenantHistoryIndexMigration.includes('user_id') &&
  spectraTenantHistoryIndexMigration.includes('session_id') &&
  spectraTenantHistoryIndexMigration.includes('observed_at DESC') &&
  dockerfile.includes('069_spectra_tenant_history_indexes.sql'));
test('Report rehydration can span a bounded durable time range instead of only the oldest cache window',
  geoconsoleRoutes.includes('loadSpectraSessionObservationRange') &&
  geoconsoleRoutes.includes('maxPoints: 20_000') &&
  geoconsoleRoutes.includes('durableHistoryTruncated') &&
  acquisitionPersistence.includes('maxPoints ?? 20_000'));
test('Global GeoConsole configuration and cache mutation require administrator authorization',
  geoconsoleRoutes.includes("router.post('/config', adminAuthMiddleware") &&
  geoconsoleRoutes.includes("router.post('/clear-cache', adminAuthMiddleware"));
test('Expensive GeoConsole routes share cross-replica resource governance',
  geoconsoleRoutes.includes('const spectraResourceMiddleware') &&
  geoconsoleRoutes.includes("router.post('/process', spectraResourceMiddleware") &&
  geoconsoleRoutes.includes("router.post('/report', spectraResourceMiddleware") &&
  geoconsoleRoutes.includes("router.post('/interpolate', spectraResourceMiddleware") &&
  geoconsoleRoutes.includes("router.post('/futurecast', spectraResourceMiddleware"));
test('Provider telemetry and motion context cannot create or append owned data without a tenant-scoped session binding',
  providerSessionAccess.includes('resolveSpectraProviderSessionBinding') &&
  providerSessionAccess.includes('Boolean(binding?.tenantId') &&
  geoconsoleRoutes.includes('SPECTRA provider telemetry requires an explicit tenant-scoped session binding.') &&
  geoconsoleRoutes.includes('Traffic-context provider requires a tenant-scoped session binding.') &&
  geoconsoleRoutes.includes('userId: boundTenantId') &&
  motionContext.includes('OR user_id = $3'));
test('Detailed health reports provider binding counts without exposing bound session identifiers',
  routes.includes('getConfiguredSpectraProviderSessionBindingSummary') &&
  providerSessionAccess.includes('tenantScopedCount') &&
  !routes.includes('getConfiguredSpectraProviderSessionBindings()'));
test('Map renderer abstraction permits registered alternate renderers and falls back to MapLibre',
  mapRendererAdapter.includes('registerGeoconsoleMapRenderer') &&
  mapRendererAdapter.includes("adapters.set(id, adapter)") &&
  mapRendererAdapter.includes("active: 'maplibre'") &&
  intelligenceMap.includes('renderer.adapter.createMap') &&
  intelligenceMap.includes('renderer.adapter.createPopup'));
test('Configured provider fan-out is explicitly bounded',
  activeAcquisition.includes('parsed.slice(0, 16)') &&
  genericPull.includes('parsed.slice(0, 64)') &&
  providerStreamCoordinator.includes('parsed.slice(0, 32)') &&
  mqttProviderCoordinator.includes('parsed.slice(0, 32)'));
test('Retry and reconnect loops use bounded jitter instead of synchronized fixed retries',
  spectra.includes('jitteredAcquisitionDelay') &&
  providerStreamCoordinator.includes('Math.random()') &&
  mqttProviderCoordinator.includes('Math.random()'));
test('Cross-replica governor fails closed unless local fallback is explicitly enabled',
  resourceGovernor.includes('SPECTRA_ALLOW_LOCAL_GOVERNOR_FALLBACK') &&
  railwayEnvExample.includes('SPECTRA_ALLOW_LOCAL_GOVERNOR_FALLBACK=false'));

test('Hootenanny is an additive conflated-map context provider rather than target telemetry',
  hootenannyContext.includes('/osm/api/0.6/map/') &&
  hootenannyContext.includes('/conflation/execute') &&
  hootenannyContext.includes('contextOnly: true') &&
  placeContext.includes('acquireSpectraHootenannyContext') &&
  placeContext.includes('conflatedMap: true') &&
  adapterRegistry.includes("id: 'hootenanny-conflated-map-context'") &&
  !hootenannyContext.includes('spectra_location_observations'));
test('Mylnikov open radio geolocation runs alongside the existing radio providers',
  mylnikovResolver.includes('https://api.mylnikov.org/geolocation/wifi') &&
  mylnikovResolver.includes('https://api.mylnikov.org/geolocation/cell') &&
  mylnikovResolver.includes("endpoint.searchParams.set('data', 'open')") &&
  mylnikovResolver.includes('slice(0, 12)') &&
  geoconsoleRoutes.includes('resolveSpectraMylnikovRadio') &&
  geoconsoleRoutes.includes('mylnikovOutcome') &&
  geoconsoleRoutes.includes('googleRadioPoint(measurement)') &&
  geoconsoleRoutes.includes('beaconDbRadioPoint(measurement)') &&
  geoconsoleRoutes.includes('openCellIdPoint(measurement)') &&
  adapterRegistry.includes("id: 'mylnikov-open-radio-geolocation'"));
test('WiGLE exact-BSSID resolver participates in the bounded radio mesh',
  wigleResolver.includes('https://api.wigle.net/api/v2/network/search') &&
  wigleResolver.includes("endpoint.searchParams.set('netid', bssid)") &&
  wigleResolver.includes('SPECTRA_WIGLE_API_TOKEN') &&
  wigleResolver.includes('slice(0, 6)') &&
  geoconsoleRoutes.includes('resolveSpectraWigleWifi') &&
  geoconsoleRoutes.includes('wigleOutcome') &&
  geoconsoleRoutes.includes('wigle: spectraWigleConfigured()') &&
  adapterRegistry.includes("id: 'wigle-bssid-geolocation'"));
test('Traccar-style Unwired resolver participates in the bounded radio mesh',
  unwiredResolver.includes('SPECTRA_UNWIRED_GEOLOCATION_URL') &&
  unwiredResolver.includes('SPECTRA_UNWIRED_GEOLOCATION_TOKEN') &&
  unwiredResolver.includes("url.protocol === 'https:'") &&
  unwiredResolver.includes('slice(0, 32)') &&
  geoconsoleRoutes.includes('resolveSpectraUnwiredRadio') &&
  geoconsoleRoutes.includes('unwiredOutcome') &&
  geoconsoleRoutes.includes('unwiredCompatible: spectraUnwiredConfigured()') &&
  adapterRegistry.includes("id: 'unwired-compatible-radio-geolocation'"));
test('Radio mesh runs independent resolvers in parallel and records corroboration',
  ['googleRadioPoint(measurement)','beaconDbRadioPoint(measurement)','openCellIdPoint(measurement)',
   'resolveSpectraMylnikovRadio','resolveSpectraWigleWifi','resolveSpectraUnwiredRadio']
    .every(marker => geoconsoleRoutes.includes(marker)) &&
  geoconsoleRoutes.includes('radioCorroboration'));
test('Radio mesh rejects outliers and never manufactures precision below the strongest agreeing source',
  radioConsensus.includes('uniqueByProvider') &&
  radioConsensus.includes('clusterAround') &&
  radioConsensus.includes('radioExcludedProviders') &&
  radioConsensus.includes('Math.max(\n    bestClaimedAccuracy') &&
  geoconsoleRoutes.includes('resolveSpectraRadioConsensus(candidates)') &&
  radioConsensusVerifier.includes('outlier-provider') &&
  radioConsensusVerifier.includes('must not claim accuracy tighter'));
test('Open-source acquisition bridge normalizers cover the high-value GitHub bridge set',
  [
    'owntracks-location',
    'chirpstack-location',
    'find3-location',
    'espresense-observation',
    'kismet-device-location',
    'openwisp-wifi-session',
    'traccar-position',
    'meshtastic-position',
    'cot-location',
    'homeassistant-device-tracker',
    'gpsd-tpv',
    'omlox-location',
    'mqtt-room-presence',
    'openmqttgateway-ble',
    'frigate-event',
  ].every(kind => openSourceBridgeNormalizer.includes(`'${kind}'`)) &&
  providerNormalizer.includes('SPECTRA_OPEN_SOURCE_BRIDGE_KINDS') &&
  providerNormalizer.includes('normalizeSpectraOpenSourceBridgePayload'));
test('OwnTracks preserves GPS accuracy, motion and stable MQTT topic device identity',
  openSourceBridgeNormalizer.includes('row.tst') &&
  openSourceBridgeNormalizer.includes('speedKmh / 3.6') &&
  openSourceBridgeNormalizer.includes("topicParts[0].toLowerCase() === 'owntracks'") &&
  openSourceBridgeNormalizer.includes('ownTracksMqttTopic'));
test('ChirpStack preserves LocationEvent accuracy and device/application identity',
  openSourceBridgeNormalizer.includes('chirpStackDeviceId') &&
  openSourceBridgeNormalizer.includes('chirpStackLocationSource') &&
  openSourceBridgeNormalizer.includes('chirpStackApplicationId') &&
  openSourceBridgeNormalizer.includes('location.accuracy'));
test('Frigate camera events add conservative configured-camera visual detections',
  openSourceBridgeNormalizer.includes("'frigate-event'") &&
  openSourceBridgeNormalizer.includes("acquisitionMethod: 'frigate-camera-event'") &&
  openSourceBridgeNormalizer.includes('camera-coverage-region-not-object-pixel-geolocation') &&
  adapterRegistry.includes("id: 'frigate-camera-events'") &&
  railwayEnvExample.includes('"normalizerKind":"frigate-event"') &&
  openSourceBridgeVerifier.includes('const frigate = normalizeSpectraOpenSourceBridgePayload'));
test('OpenMQTTGateway adds raw BLE scanner ranging through the existing MQTT and anchor mesh',
  openSourceBridgeNormalizer.includes("'openmqttgateway-ble'") &&
  openSourceBridgeNormalizer.includes('OpenMQTTGateway BLE payload requires') &&
  openSourceBridgeNormalizer.includes("acquisitionMethod: 'openmqttgateway-ble'") &&
  adapterRegistry.includes("id: 'openmqttgateway-ble'") &&
  railwayEnvExample.includes('"normalizerKind":"openmqttgateway-ble"') &&
  openSourceBridgeVerifier.includes('const openMqttGateway ='));
test('omlox and MQTT Room add standardized RTLS and room-ranging acquisition paths',
  openSourceBridgeNormalizer.includes("'omlox-location'") &&
  openSourceBridgeNormalizer.includes('location_updates:geojson') &&
  openSourceBridgeNormalizer.includes('resolveSpectraFloorplanCoordinate') &&
  openSourceBridgeNormalizer.includes("'mqtt-room-presence'") &&
  openSourceBridgeNormalizer.includes("acquisitionMethod: 'mqtt-room-presence'") &&
  adapterRegistry.includes("id: 'omlox-location-hub'") &&
  adapterRegistry.includes("id: 'mqtt-room-presence'") &&
  railwayEnvExample.includes('"normalizerKind":"omlox-location"') &&
  railwayEnvExample.includes('"normalizerKind":"mqtt-room-presence"'));
test('FIND3 and ESPresense add independent indoor positioning paths',
  openSourceBridgeNormalizer.includes('find3-fingerprint-classification') &&
  openSourceBridgeNormalizer.includes('find3Probability') &&
  openSourceBridgeNormalizer.includes('espresense-ble-ranging') &&
  openSourceBridgeNormalizer.includes("kind: 'ranging'") &&
  openSourceBridgeNormalizer.includes("source: 'ble_rssi'") &&
  openSourceBridgeNormalizer.includes('resolveConfiguredSpectraAnchor'));
test('Kismet, OpenWISP and Traccar bridges preserve their native location-bearing evidence',
  openSourceBridgeNormalizer.includes('kismet.common.location.geopoint') &&
  openSourceBridgeNormalizer.includes('kismet.device.base.macaddr') &&
  openSourceBridgeNormalizer.includes('openwisp-wifi-session') &&
  openSourceBridgeNormalizer.includes('infrastructureAssociation: true') &&
  openSourceBridgeNormalizer.includes('traccar-position') &&
  openSourceBridgeNormalizer.includes('traccarNetwork'));
test('Open-source bridge identities resolve through configured target-session bindings',
  openSourceBridgeNormalizer.includes('applyConfiguredBridgeIdentity') &&
  openSourceBridgeNormalizer.includes('resolveSpectraInfrastructureBinding') &&
  openSourceBridgeNormalizer.includes('sessionId: binding.sessionId || batch.sessionId') &&
  openSourceBridgeNormalizer.includes('subjectLabel: binding.subjectLabel || batch.subjectLabel'));
test('Continuous active acquisition paces each provider/target with bounded poll cooldown',
  activeAcquisition.includes('lastPollByTarget') &&
  activeAcquisition.includes('pollDelayRemaining') &&
  activeAcquisition.includes('Provider poll cooldown active') &&
  activeAcquisition.includes('lastPollByTarget.size > 5_000') &&
  activeAcquisition.includes('minPollIntervalMs: minPollIntervalMs(item)'));
test('Active acquisition has built-in FIND3, Traccar, Kismet, OpenWISP and OwnTracks lanes',
  activeAcquisition.includes('builtInFind3Adapter') &&
  activeAcquisition.includes('builtInTraccarAdapter') &&
  activeAcquisition.includes('builtInKismetAdapter') &&
  activeAcquisition.includes('builtInOpenWispAdapter') &&
  activeAcquisition.includes('builtInOwnTracksAdapter') &&
  activeAcquisition.includes('SPECTRA_FIND3_LOCATION_URL_TEMPLATE') &&
  activeAcquisition.includes('SPECTRA_TRACCAR_POSITION_URL_TEMPLATE') &&
  activeAcquisition.includes('SPECTRA_KISMET_DEVICE_URL_TEMPLATE') &&
  activeAcquisition.includes('SPECTRA_OPENWISP_WIFI_SESSIONS_URL_TEMPLATE') &&
  activeAcquisition.includes('SPECTRA_OWNTRACKS_LOCATION_URL_TEMPLATE'));
test('Active adapter secrets may be supplied as headers or query parameters without embedding credentials in URLs',
  activeAcquisition.includes('queryFromEnv?: Record<string, string>') &&
  activeAcquisition.includes('url.searchParams.set(parameter, value)') &&
  activeAcquisition.includes("{ KISMET: 'SPECTRA_KISMET_API_KEY' }") &&
  activeAcquisition.includes('headersFromEnv'));
test('WSS and MQTT bridge transports preserve arrays, session binding and provider subscriptions',
  providerStreamCoordinator.includes("Array.isArray(parsed)") &&
  providerStreamCoordinator.includes("? { data: parsed }") &&
  providerStreamCoordinator.includes('sessionId: runtime.config.sessionId') &&
  providerStreamCoordinator.includes('sessionBound: Boolean(config.sessionId)') &&
  providerStreamCoordinator.includes('openMessages?: Array<Record<string, unknown>>') &&
  providerStreamCoordinator.includes('socket.send(encoded)') &&
  providerStreamCoordinator.includes('openMessageCount') &&
  mqttProviderCoordinator.includes("Array.isArray(payload)") &&
  mqttProviderCoordinator.includes("? { data: payload }") &&
  mqttProviderCoordinator.includes('sessionId: runtime.config.sessionId') &&
  mqttProviderCoordinator.includes('sessionBound: Boolean(config.sessionId)'));
test('Open-source bridge configuration is documented without inventing credentials or endpoints',
  railwayEnvExample.includes('SPECTRA_FIND3_LOCATION_URL_TEMPLATE=') &&
  railwayEnvExample.includes('SPECTRA_TRACCAR_POSITION_URL_TEMPLATE=') &&
  railwayEnvExample.includes('SPECTRA_KISMET_DEVICE_URL_TEMPLATE=') &&
  railwayEnvExample.includes('SPECTRA_OPENWISP_WIFI_SESSIONS_URL_TEMPLATE=') &&
  railwayEnvExample.includes('SPECTRA_OWNTRACKS_LOCATION_URL_TEMPLATE=') &&
  railwayEnvExample.includes('SPECTRA_HOOTENANNY_BASE_URL=') &&
  railwayEnvExample.includes('SPECTRA_WIGLE_API_TOKEN=') &&
  railwayEnvExample.includes('SPECTRA_UNWIRED_GEOLOCATION_URL=') &&
  railwayEnvExample.includes('headersFromEnv/queryFromEnv'));
test('Focused bridge behavior verifier exercises the complete open-source normalizer set',
  [
    'owntracks-location',
    'chirpstack-location',
    'find3-location',
    'espresense-observation',
    'kismet-device-location',
    'openwisp-wifi-session',
    'traccar-position',
    'meshtastic-position',
    'cot-location',
    'homeassistant-device-tracker',
    'gpsd-tpv',
    'omlox-location',
    'mqtt-room-presence',
    'openmqttgateway-ble',
    'frigate-event',
  ].every(kind => openSourceBridgeVerifier.includes(`'${kind}'`)));

test('SPECTRA recursively reacquires until page exit with one stable session',
  spectra.includes('CONTINUOUS_ACQUISITION_DELAY_MS') &&
  spectra.includes('startContinuousAcquisition') &&
  spectra.includes('continuousAcquisitionActiveRef.current') &&
  spectra.includes('recursivePassRef.current') &&
  spectra.includes('queryStartedAtRef.current') &&
  spectra.includes("backgroundPass: true") &&
  spectra.includes("sessionId: resolvedSessionId"));
test('SPECTRA hard-stops local and server acquisition when the viewer exits',
  spectra.includes("window.addEventListener('pagehide'") &&
  spectra.includes("navigator.sendBeacon('/api/spectra/acquisition/stop'") &&
  spectra.includes("keepalive: true") &&
  spectra.includes("hardStopRef.current('back_button', true)") &&
  spectra.includes("hardStopRef.current('new_target', true)") &&
  routes.includes("router.post('/acquisition/stop'") &&
  routes.includes('stopSpectraAcquisitionSession'));
test('Hard stop coordinates in-flight and delayed acquisition across replicas',
  acquisitionControl.includes('controllers: Set<AbortController>') &&
  acquisitionControl.includes('controller.abort') &&
  acquisitionControl.includes('spectra_acquisition_control') &&
  acquisitionControl.includes('SHARED_STOP_POLL_MS = 500') &&
  acquisitionControl.includes('assertSpectraAcquisitionSessionActive') &&
  acquisitionControl.includes('INSERT INTO public.spectra_acquisition_control') &&
  spectraAcquisitionControlMigration.includes('PRIMARY KEY (user_id, session_id)') &&
  spectraAcquisitionControlMigration.includes('FROM PUBLIC, anon, authenticated') &&
  spectraAcquisitionControlMigration.includes('TO service_role') &&
  dockerfile.includes('070_spectra_acquisition_control.sql') &&
  routes.includes('await assertSpectraAcquisitionSessionActive') &&
  routes.includes('await stopSpectraAcquisitionSession') &&
  routes.includes('acquisitionLease.cancel') &&
  routes.includes('throwIfAcquisitionStopped(acquisitionLease.signal)'));
test('Recursive discovery and active provider pulls inherit the acquisition abort signal',
  routes.includes('externalSignal?: AbortSignal') &&
  routes.includes("signal: acquisitionLease.signal") &&
  routes.includes('acquisitionLease.signal') &&
  activeAcquisition.includes('signal?: AbortSignal') &&
  activeAcquisition.includes("input.signal?.addEventListener('abort'"));
test('Continuous passes broaden source-wave and adaptive-query coverage instead of freezing on pass zero',
  routes.includes('const outerPass = Math.max(0, recursivePass)') &&
  routes.includes('(outerPass * 4) % waveQueries.length') &&
  routes.includes('combinedPass % 8') &&
  routes.includes("'newly available evidence'"));

test('Infrastructure client association can fall back to configured AP anchors without inventing AP coordinates',
  infrastructureNormalizer.includes('resolveConfiguredSpectraAnchor') &&
  infrastructureNormalizer.includes('const associatedAnchor = ids.apId') &&
  infrastructureNormalizer.includes("coordinateSource: 'configured-anchor'") &&
  infrastructureNormalizer.includes('? 0.72') &&
  providerNormalizer.includes("'unifi-client-location'"));
test('Major infrastructure feeds normalize through the canonical SPECTRA provider path',
  infrastructureNormalizer.includes("'mist-location'") &&
  infrastructureNormalizer.includes("'extreme-location'") &&
  infrastructureNormalizer.includes("'unifi-client-location'") &&
  infrastructureNormalizer.includes("'aruba-location-json'") &&
  infrastructureNormalizer.includes('resolveSpectraFloorplanCoordinate') &&
  infrastructureNormalizer.includes('resolveSpectraInfrastructureBinding') &&
  infrastructureNormalizer.includes('row.clientMac') &&
  infrastructureNormalizer.includes('row.sensorMac') &&
  infrastructureNormalizer.includes('row.siteName') &&
  infrastructureNormalizer.includes('row.floorName') &&
  providerNormalizer.includes('SPECTRA_INFRASTRUCTURE_PROVIDER_KINDS'));
test('Aruba Central WSS decoder implements documented CloudEvents and location protobuf fields',
  arubaStreamDecoder.includes('parseCloudEvent') &&
  arubaStreamDecoder.includes('parseWifiClientLocation') &&
  arubaStreamDecoder.includes('sta_eth_mac') &&
  arubaStreamDecoder.includes('reporting_ap_serial') &&
  arubaStreamDecoder.includes('error_level'));
test('Provider-neutral WSS coordinator is reconnectable, authenticated and wired into canonical telemetry',
  providerStreamCoordinator.includes('SPECTRA_WSS_PROVIDER_ADAPTERS') &&
  providerStreamCoordinator.includes("decoder === 'aruba-location-protobuf'") &&
  providerStreamCoordinator.includes('Authorization') &&
  providerStreamCoordinator.includes('oauthClientIdEnv') &&
  providerStreamCoordinator.includes('https://sso.common.cloud.hpe.com/as/token.oauth2') &&
  providerStreamCoordinator.includes("grant_type: 'client_credentials'") &&
  providerStreamCoordinator.includes('accessTokenExpiresAt') &&
  providerStreamCoordinator.includes('scheduleReconnect') &&
  geoconsoleRoutes.includes('startSpectraProviderStreams') &&
  geoconsoleRoutes.includes("'wss-provider-stream'"));
test('Provider-neutral MQTT transport uses TLS, subscription, reconnect and QoS1 acknowledgement',
  mqttProviderCoordinator.includes('SPECTRA_MQTT_PROVIDER_ADAPTERS') &&
  mqttProviderCoordinator.includes("url.protocol === 'mqtts:'") &&
  mqttProviderCoordinator.includes('subscribePacket') &&
  mqttProviderCoordinator.includes('pubAckPacket') &&
  mqttProviderCoordinator.includes('scheduleReconnect') &&
  geoconsoleRoutes.includes('startSpectraMqttProviderStreams') &&
  geoconsoleRoutes.includes("'mqtts-provider-stream'"));
test('Native Meraki Scanning API validator, payload secret and v2 observation shape are supported',
  geoconsoleRoutes.includes("mode === 'meraki-scanning-secret'") &&
  geoconsoleRoutes.includes("normalize/meraki-scanning', (req") &&
  geoconsoleRoutes.includes('entry?.validatorEnv') &&
  geoconsoleRoutes.includes("String(body.secret || '').trim()") &&
  externalLocationNormalizer.includes('const singleLocation = record(observation.location)') &&
  externalLocationNormalizer.includes('?? location.unc') &&
  externalLocationNormalizer.includes("type.includes('BLUETOOTH')") &&
  adapterRegistry.includes("id: 'meraki-scanning-ingest'") &&
  railwayEnvExample.includes('"mode":"meraki-scanning-secret"'));

test('Infrastructure webhook ingress uses per-provider credentials and Mist SHA-256 validation before normalization',
  geoconsoleRoutes.includes('SPECTRA_INFRASTRUCTURE_WEBHOOK_AUTH') &&
  geoconsoleRoutes.includes("mode === 'mist-hmac-sha256'") &&
  geoconsoleRoutes.includes("req.header('x-mist-signature-v2')") &&
  geoconsoleRoutes.includes("createHmac('sha256', secret)") &&
  geoconsoleRoutes.includes("router.post('/telemetry/infrastructure/:providerId/normalize/:kind'") &&
  geoconsoleRoutes.includes('timingSafeEqual(actualBuffer, expectedBuffer)') &&
  geoconsoleRoutes.includes('normalizeSpectraProviderPayload(kind, providerId, req.body)'));
test('UniFi client observations have a built-in authenticated pull adapter',
  activeAcquisition.includes('SPECTRA_UNIFI_CLIENT_URL_TEMPLATE') &&
  activeAcquisition.includes('SPECTRA_UNIFI_API_KEY') &&
  activeAcquisition.includes("'X-API-Key': 'SPECTRA_UNIFI_API_KEY'") &&
  activeAcquisition.includes("normalizerKind: 'unifi-client-location'"));
test('Infrastructure adapter registry advertises Mist, Extreme, Aruba, UniFi, WSS and MQTT lanes',
  adapterRegistry.includes("id: 'mist-location-webhook'") &&
  adapterRegistry.includes("id: 'extreme-location-webhook'") &&
  adapterRegistry.includes("id: 'aruba-location-stream'") &&
  adapterRegistry.includes("id: 'unifi-client-location'") &&
  adapterRegistry.includes("id: 'provider-neutral-wss-stream'") &&
  adapterRegistry.includes("id: 'provider-neutral-mqtt-stream'") &&
  adapterRegistry.includes('SPECTRA_INFRASTRUCTURE_WEBHOOK_AUTH') &&
  adapterRegistry.includes('SPECTRA_UNIFI_CLIENT_URL_TEMPLATE'));

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
  motionContext.includes('($3::text IS NULL AND user_id IS NULL)') &&
  motionContext.includes('OR user_id = $3') &&
  geoconsoleRoutes.includes("error: 'SPECTRA session not found.'") &&
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
test('SPECTRA API is mounted with legacy and stable v1 compatibility paths',
  serverRoutes.includes("app.use('/api/spectra/v1', spectraRoutes.default)") &&
  serverRoutes.includes("app.use('/api/spectra', spectraRoutes.default)") &&
  serverRoutes.includes("app.use('/api/geoconsole/v1', geoconsoleRoutes.default)") &&
  serverRoutes.includes("app.use('/api/geoconsole', geoconsoleRoutes.default)"));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
