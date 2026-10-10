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
const publicMap = read('client/src/pages/spectra-public.tsx');
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
const regionalInference = read('server/services/spectra/SpectraRegionalInference.ts');
const cityDiscoveryPolicy = read('server/services/spectra/SpectraCityDiscoveryPolicy.ts');
const cityAccuracyFixtures = read('scripts/verify-spectra-city-synthetic-regressions.ts');
const locationQuality = read('server/services/geoconsole/location-quality.ts');
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
const publicRetrieval = read('server/services/spectra/SpectraPublicRetrieval.ts');
const publicProvenance = read('server/services/spectra/SpectraPublicEvidenceProvenance.ts');
const gpsRoutes = read('server/routes/gps.routes.ts');
const mediaEvidence = read('server/services/spectra/SpectraMediaEvidence.ts');
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
test('SPECTRA searches public profiles automatically and stops only on actual corroborated city claims',
  spectraSources.includes("'public-profile-city'") &&
  spectraSources.includes("'social-location'") &&
  cityDiscoveryPolicy.includes('assessSpectraCityDiscoveryReadiness') &&
  cityDiscoveryPolicy.includes('chooseSpectraPublicRetrievalUrls') &&
  cityDiscoveryPolicy.includes('Boolean(city)') &&
  routes.includes('chooseSpectraPublicRetrievalUrls(enrichedResults, 8)') &&
  routes.includes('if (readiness.sufficientToStop) break;'));

test('Media GPS remains dated scene context with explicit freshness and uncertainty',
  gpsRoutes.includes('assessSpectraMediaCapture(metadata)') &&
  gpsRoutes.includes("mediaAssessment.status === 'accepted'") &&
  gpsRoutes.includes("observationKind: 'historical'") &&
  gpsRoutes.includes("evidenceRole: 'media_capture_scene'") &&
  gpsRoutes.includes("currentPositionVerified: false") &&
  mediaEvidence.includes("status: 'conflicting_gps'") &&
  mediaEvidence.includes("status: 'future_capture_time'") &&
  spectra.includes('Capture age:') &&
  spectra.includes('historical scene evidence') &&
  spectra.includes('Conflicting GPS metadata was excluded'));
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
test('SPECTRA rejects missing or impossible provider coordinates before mapping',
  geocoder.includes('function parseGeocoderCoordinates(') &&
  geocoder.includes("typeof value !== 'string' && typeof value !== 'number'") &&
  geocoder.includes('Math.abs(latitude) > 90') &&
  geocoder.includes('Math.abs(longitude) > 180') &&
  geocoder.includes("'[SPECTRA_GEOCODER] invalid_payload'") &&
  (geocoder.match(/parseGeocoderCoordinates\(/g) || []).length >= 6);
test('General location quality rejects impossible fixes without inventing precision',
  locationQuality.includes("code: 'invalid_coordinate'") &&
  locationQuality.includes("code: 'invalid_confidence'") &&
  locationQuality.includes("code: 'invalid_accuracy'") &&
  locationQuality.includes('timestampValue instanceof Date') &&
  locationQuality.includes('Number.isFinite(point.latitude)') &&
  locationQuality.includes('Number.isFinite(point.longitude)'));

test('Regional uncertainty rejects empty bounding-box edges instead of coercing them to zero',
  geocoder.includes('const southWest = parseGeocoderCoordinates(boundingbox[0], boundingbox[2])') &&
  geocoder.includes('const northEast = parseGeocoderCoordinates(boundingbox[1], boundingbox[3])') &&
  !geocoder.includes('const south = Number(boundingbox[0])'));
test('Parallel requests reserve sequential public geocoder slots',
  geocoder.includes('let geocoderSlotQueue: Promise<void> = Promise.resolve()') &&
  geocoder.includes('geocoderSlotQueue.then(async () => {') &&
  geocoder.includes('geocoderSlotQueue = slot.catch(() => undefined)'));

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
  routes.includes('const locationObservations = solvedLocationObservations') &&
  routes.includes('if (locationObservations.length === 0)') &&
  routes.includes('candidateLocations.push({') &&
  routes.includes("basis: 'regional_context'") &&
  routes.includes('region.accuracyMeters,'));
test('Unbound public-page coordinates cannot enter the subject GPS pipeline',
  routes.includes('stripUnboundPublicGeoContext(result?.metadata)') &&
  routes.includes('mergePublicRetrievedMetadata(existing.metadata, evidence)') &&
  routes.includes('byUrl.get(evidence.requestedUrl) || byUrl.get(evidence.url)'));

test('SPECTRA can use corroborated public city context without claiming a live position',
  routes.includes('inferCorroboratedRegionalCity(') &&
  routes.includes('discoveryResults,') &&
  routes.includes('if (!region && corroboratedCity)') &&
  regionalInference.includes('winner.domains.size < 2') &&
  regionalInference.includes('currentPositionVerified: false') &&
  regionalInference.includes('HISTORICAL_LANGUAGE_RE') &&
  geocoder.includes('const context = commaSeparated[1].match('));

test('Search clues cannot impersonate independently discovered current cities',
  routes.indexOf('if (!region && corroboratedCity)') <
    routes.indexOf('for (const locationInput of locationInputs)') &&
  routes.includes('(supplied search clue; current city not verified)') &&
  routes.includes('(corroborated public residence; not a live location)') &&
  routes.includes('confidence: cityCorroborationUsed ? 0.35 : 0.05') &&
  regionalInference.includes('const residenceClause = residence[1].split(') &&
  regionalInference.includes('extractCityStateHint(residenceClause)'));

test('Broad-city corroboration filters stale, copied and contradictory evidence',
  regionalInference.includes('MAX_DATED_SOURCE_AGE_MS') &&
  regionalInference.includes('item.metadata?.publishedAt') &&
  regionalInference.includes('hasUsablePublicationDate(item, asOf.getTime())') &&
  regionalInference.includes('winner.domains.size < 2 || ranked.length !== 1') &&
  regionalInference.includes('const uniqueClaims = new Set<string>()') &&
  regionalInference.includes('if (independentDomains.length < 2) return null'));
test('Synthetic city regression suite records both correct matches and abstentions',
  cityAccuracyFixtures.includes('correctCityPredictions') &&
  cityAccuracyFixtures.includes('falseCityPredictions') &&
  cityAccuracyFixtures.includes('correctlyAbstained') &&
  cityAccuracyFixtures.includes('not real-world accuracy'));

test('Public evidence publication time reaches SPECTRA city corroboration',
  publicRetrieval.includes('publishedAt?: string') &&
  publicRetrieval.includes("meta.get('article:published_time')") &&
  publicRetrieval.includes("meta.get('datepublished')") &&
  publicRetrieval.includes("candidate['@type']") &&
  publicRetrieval.includes('publishedAt: extracted.publishedAt') &&
  routes.includes('mergePublicRetrievedMetadata(existing.metadata, evidence)') &&
  publicProvenance.includes('publishedAt: evidence.publishedAt ?? previous?.publishedAt') &&
  publicProvenance.includes('fetchedExcerpt: evidence.textExcerpt ?? previous?.fetchedExcerpt'));

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
test('SPECTRA recursively broadens until corroborated city evidence or diminishing returns',
  routes.includes('SPECTRA_DISCOVERY_POLICY.maxPasses') &&
  cityDiscoveryPolicy.includes('SPECTRA_DISCOVERY_POLICY.sufficientConfidence') &&
  routes.includes('if (readiness.sufficientToStop) break;') &&
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
test('Cisco Spaces Cartesian coordinates cannot masquerade as latitude/longitude',
  externalLocationNormalizer.includes('coordinateSystem: \'wgs84-explicit\'') &&
  externalLocationNormalizer.includes('confidenceFactor: finite(event.confidenceFactor)') &&
  externalLocationNormalizer.includes('location.longitude ?? location.lng ?? location.lon,') &&
  !externalLocationNormalizer.includes('location.lat ?? coordinates[0]') &&
  activeAcquisition.includes('Active provider returned telemetry for a different device.'));

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
test('Public webpage text recovery prioritizes article content over long navigation menus',
  publicRetrieval.includes("const semanticRoot = $('main, article, [role=\"main\"]')") &&
  publicRetrieval.includes("const MAX_TEXT = 320_000") &&
  publicRetrieval.includes("slice(0, 8_000)"));

test('Public discovery retrieves source pages without promoting unbound venue GPS',
  routes.includes('retrieveSpectraPublicEvidence') &&
  publicRetrieval.includes('MAX_TARGETS = 8') &&
  publicRetrieval.includes('application/ld+json') &&
  publicRetrieval.includes('json-geospatial-field-extraction') &&
  routes.includes('mergePublicRetrievedMetadata(existing.metadata, evidence)') &&
  routes.includes('stripUnboundPublicGeoContext(result?.metadata)') &&
  publicProvenance.includes('subjectMatchConfidence: 0') &&
  publicProvenance.includes('currentPositionVerified: false'));
test('SPECTRA attachment flow accepts both media and structured telemetry files',
  spectra.includes('/api/gps/extract-upload') &&
  spectra.includes('/api/geoconsole/telemetry/import-file') &&
  spectra.includes('handleTargetFile') &&
  spectra.includes("['geojson', 'json', 'gpx', 'kml', 'nmea', 'csv', 'ndjson', 'jsonl', 'log', 'txt']") &&
  !/accept=["'][^"']*image\/\*/.test(spectra));
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
test('SPECTRA map restores layers on style changes without waiting for every tile',
  intelligenceMap.includes("map.on('style.load', handleStyleReady)") &&
  intelligenceMap.includes('initializeRuntimeLayers(map);') &&
  intelligenceMap.includes("map.off('style.load', handleStyleReady)") &&
  !intelligenceMap.includes("if (!map.isStyleLoaded()) return;") &&
  !intelligenceMap.includes("map.once('style.load'"));
test('SPECTRA map adjusts to split-panel and fullscreen size changes',
  intelligenceMap.includes('new ResizeObserver(() => map.resize())') &&
  intelligenceMap.includes('resizeObserver?.disconnect()'));
test('One forecast observation renders as a point rather than invalid LineString',
  intelligenceMap.includes('features: futurecast.length > 1') &&
  intelligenceMap.includes(': futurecast.map(pointFeature),'));
test('Superseded timeline loads cannot override newer investigations',
  runtime.includes('const loadRequestRef = useRef(0);') &&
  runtime.includes('const loadRequestId = ++loadRequestRef.current;') &&
  (runtime.match(/loadRequestId !== loadRequestRef\.current/g) || []).length >= 3);
test('Superseded forecast requests are invalidated before the minimum-frame check',
  runtime.includes('const requestId = ++futurecastRequestRef.current;\n    if (!cfg.predictiveEnabled || sourceFrames.length < 3)') &&
  runtime.includes('++futurecastRequestRef.current;\n    setStatus(\'loading\')'));

test('Canonical acquisition candidates cannot be replaced by a late regional preview',
  spectra.includes('let previewOpen = true;') &&
  spectra.includes('if (!previewOpen || requestId !== requestRef.current) return;') &&
  spectra.includes('previewOpen = false;') &&
  spectra.includes('if (previewOpen && requestId === requestRef.current)'));

test('SPECTRA provides a general map without login, subscription, or device-location permission',
  app.includes('const SpectraPublicPage = lazyWithRetry(') &&
  app.includes('SPECTRA_PUBLIC_ROUTES.map(path => (') &&
  app.includes('<Route key={path} path={path} component={SpectraPublicPage} />') &&
  app.includes('if (isLoading && !isSpectraMapRoute)') &&
  publicMap.includes('<MapLibreIntelligenceMap') &&
  publicMap.includes('currentFrame={null}') &&
  publicMap.includes('trail={NO_OBSERVATIONS}') &&
  publicMap.includes('futurecast={NO_OBSERVATIONS}') &&
  publicMap.includes('isLive={false}') &&
  !publicMap.includes('navigator.geolocation') &&
  !publicMap.includes('/api/spectra/acquire') &&
  !publicMap.includes('/api/geoconsole/telemetry'));

test('Private person-specific acquisition and saved records retain server authentication',
  app.includes('isAuthenticated && hasPaidAccess') &&
  routes.includes('router.use(isAuthenticated)') &&
  geoconsoleRoutes.includes('router.use(isAuthenticated)'));

test('SPECTRA removes the browser-device-location control and watcher for its own shell',
  spectra.includes('allowDeviceLocation={false}') &&
  dashboard.includes('allowDeviceLocation?: boolean') &&
  dashboard.includes('autoFetch: allowDeviceLocation') &&
  dashboard.includes('{allowDeviceLocation && (') &&
  dashboard.includes('{allowDeviceLocation && state.isLive && ('));


test('SPECTRA Back follows browser history with the standard authorized fallback',
  spectra.includes("import { BackButton } from '@/components/BackButton'") &&
  spectra.includes('<BackButton fallbackRoute="/lexara-consent"') &&
  !spectra.includes("onClick={() => setLocation('/lexara-consent')}"));

test('Persisted SPECTRA sessions bind to full subject tokens, not name substrings',
  acquisitionPersistence.includes('function isOrderedWholeTokenRefinement(') &&
  acquisitionPersistence.includes('isOrderedWholeTokenRefinement(existing, incoming)') &&
  acquisitionPersistence.includes('isOrderedWholeTokenRefinement(existingSubject, incomingSubject)') &&
  !acquisitionPersistence.includes('return existing.includes(incoming) || incoming.includes(existing)') &&
  !acquisitionPersistence.includes('incomingSubject.includes(existingSubject)'));

test('SPECTRA API is mounted',
  serverRoutes.includes("app.use('/api/spectra', spectraRoutes.default)"));

console.log(`\nPassed: ${passed}  Failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);

