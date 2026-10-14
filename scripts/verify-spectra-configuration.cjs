// Offline configuration checks. No credentials, HTTP requests, or personal data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let passed = 0;
const check = (name, work) => { work(); passed++; console.log(`PASS ${name}`); };
function load(relative, env = {}, dependencies = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    process: { env }, fetch() { throw new Error('Configuration checks must not make requests'); },
  }, { filename: relative })(name => {
    assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const modulePath = 'server/services/spectra/SpectraConfigurationDiagnostics.ts';
const d = load(modulePath);
const row = (report, id) => report.credentials.find(item => item.integration === id);
const marker = 'PRIVATE_FIXTURE_VALUE_MUST_NOT_BE_SERIALIZED';
check('absent and blank credentials remain unconfigured', () => {
  const report = d.getSpectraConfigurationDiagnostics({ TAVILY_API_KEY: '  ', SERPAPI_KEY: '' });
  assert(report.credentials.every(item => !item.configured));
  assert.equal(report.authenticationStatus, 'not-tested');
  assert.equal(report.connectionStatus, 'not-tested');
});
check('supported aliases are recognized without revealing their values', () => {
  for (const name of ['SPECTRA_GOOGLE_GEOLOCATION_API_KEY', 'GOOGLE_GEOLOCATION_API_KEY', 'GOOGLE_MAPS_API_KEY']) {
    const report = d.getSpectraConfigurationDiagnostics({ [name]: marker });
    assert.equal(row(report, 'google-radio').configured, true);
    assert.equal(row(report, 'google-radio').requirements[0].presentVariableNames[0], name);
    assert(!JSON.stringify(report).includes(marker));
  }
  assert(row(d.getSpectraConfigurationDiagnostics({ SERPAPI_API_KEY: marker }), 'serpapi').configured);
});
check('blank priority keys do not hide a usable fallback', () => {
  const names = ['SPECTRA_GOOGLE_GEOLOCATION_API_KEY', 'GOOGLE_GEOLOCATION_API_KEY', 'GOOGLE_MAPS_API_KEY'];
  assert.equal(d.readSpectraEnvironmentValue(names, { [names[0]]: '  ', [names[1]]: ` ${marker} ` }), marker);
  assert.equal(d.readSpectraEnvironmentValue(names, { [names[0]]: 'primary', [names[1]]: marker }), 'primary');
  assert.equal(d.readSpectraEnvironmentValue(names, {}), undefined);
});
check('multi-part provider configuration requires both parts', () => {
  assert.equal(row(d.getSpectraConfigurationDiagnostics({ TRAFFICLAND_API_KEY: marker }), 'trafficland').configured, false);
  assert.equal(row(d.getSpectraConfigurationDiagnostics({ TRAFFICLAND_API_KEY: marker, TRAFFICLAND_SYSTEM: marker }), 'trafficland').configured, true);
});
check('enrolled live-source readiness is configuration-only and value-safe', () => {
  const report = d.getSpectraConfigurationDiagnostics({
    SPECTRA_ANDROID_RADIO_COLLECTOR_URL_TEMPLATE: 'https://collector.example/{{deviceRef}}',
    SPECTRA_ANDROID_RADIO_COLLECTOR_TOKEN: marker,
    SPECTRA_APPLE_DEVICE_COLLECTOR_URL_TEMPLATE: 'https://apple.example/{{deviceRef}}',
    SPECTRA_APPLE_DEVICE_COLLECTOR_TOKEN: marker,
    SPECTRA_OWNTRACKS_RECORDER_URL: 'https://owntracks.example',
    SPECTRA_OWNTRACKS_USERNAME: 'fixture-user',
    SPECTRA_OWNTRACKS_PASSWORD: marker,
    SPECTRA_TRACCAR_URL: 'https://traccar.example',
    SPECTRA_TRACCAR_TOKEN: marker,
    SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL: 'https://camara.example/retrieve',
    SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN: marker,
    SPECTRA_VONAGE_LOCATION_TOKEN: marker,
    SPECTRA_PHONEINFOGA_URL: 'https://phoneinfoga.example',
    NEON_DATABASE_URL: marker,
  });
  for (const id of [
    'android-radio-collector', 'apple-device-collector', 'traccar',
    'camara-location', 'vonage-location', 'phoneinfoga',
  ]) assert.equal(row(report, id).configured, true);
  assert.equal(report.enrolledSources.enrollmentRegistryConfigured, true);
  assert.equal(report.enrolledSources.ownTracksConfigured, true);
  assert.equal(report.enrolledSources.ownTracksAuthenticationConfigured, true);
  assert.equal(report.enrolledSources.camaraDeviceIdentificationMode, 'phone');
  assert(!JSON.stringify(report).includes(marker));

  const tokenBound = d.getSpectraConfigurationDiagnostics({
    SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL: 'https://camara.example/retrieve',
    SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN: marker,
    SPECTRA_CAMARA_LOCATION_DEVICE_SOURCE: 'token',
  });
  assert.equal(row(tokenBound, 'camara-location').configured, true);
  assert.equal(tokenBound.enrolledSources.camaraDeviceIdentificationMode, 'token');

  const invalidMode = d.getSpectraConfigurationDiagnostics({
    SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL: 'https://camara.example/retrieve',
    SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN: marker,
    SPECTRA_CAMARA_LOCATION_DEVICE_SOURCE: 'invalid-fixture',
  });
  assert.equal(row(invalidMode, 'camara-location').configured, false);
  assert.equal(invalidMode.enrolledSources.camaraDeviceIdentificationMode, 'invalid');

  const renewableVonage = d.getSpectraConfigurationDiagnostics({
    SPECTRA_VONAGE_APPLICATION_ID: 'fixture-app-id',
    SPECTRA_VONAGE_PRIVATE_KEY: marker,
    SPECTRA_VONAGE_OAUTH_SCOPE: 'fixture-location-scope',
  });
  assert.equal(row(renewableVonage, 'vonage-location').configured, true);
  const incompleteVonage = d.getSpectraConfigurationDiagnostics({
    SPECTRA_VONAGE_APPLICATION_ID: 'fixture-app-id',
    SPECTRA_VONAGE_PRIVATE_KEY: marker,
  });
  assert.equal(row(incompleteVonage, 'vonage-location').configured, false);
});
check('Census key presence does not imply geocoder use', () => {
  const report = d.getSpectraConfigurationDiagnostics({ CENSUS_API_KEY: marker });
  assert.equal(report.censusGeocoder.censusDataKeyPresent, true);
  assert.equal(report.censusGeocoder.censusDataKeyUsedByGeocoder, false);
  assert.equal(report.censusGeocoder.keyRequired, false);
  assert(!JSON.stringify(report).includes(marker));
});
check('diagnostics omit unrelated variables and all credential values', () => {
  const report = d.getSpectraConfigurationDiagnostics({ DATABASE_URL: marker, UNRELATED_PRIVATE_SETTING: marker, TAVILY_API_KEY: marker });
  const serialized = JSON.stringify(report);
  for (const value of [marker, 'DATABASE_URL', 'UNRELATED_PRIVATE_SETTING']) assert(!serialized.includes(value));
  assert.equal(row(report, 'tavily').configured, true);
});
check('real registry keeps configuration separate from connection and observations', () => {
  const registry = load('server/services/spectra/SpectraAdapterRegistry.ts', { SPECTRA_TELEMETRY_HMAC_SECRET: marker }, {
    './SpectraActiveAcquisition': { getSpectraActiveAcquisitionCapabilities: () => [] },
    './SpectraConfigurationDiagnostics': d,
  });
  const adapters = registry.getSpectraAdapterCapabilities();
  assert(adapters.length > 0);
  assert(adapters.every(item => item.connectionStatus === 'not-tested' && item.observationStatus === 'not-checked'));
  const webhooks = adapters.filter(item => item.mode === 'provider-webhook');
  assert(webhooks.length > 0);
  assert(webhooks.every(item => item.configured && item.configurationScope === 'ingestion-authentication-only'));
  assert.equal(adapters.find(item => item.id === 'google-radio-geolocation').configurationStatus, 'missing');
  assert(!JSON.stringify(adapters).includes(marker));
});
check('authenticated capabilities handler exposes only configuration diagnostics', () => {
  const source = fs.readFileSync(path.join(root, 'server/routes/geoconsole.routes.ts'), 'utf8');
  const start = source.indexOf("router.get('/telemetry-capabilities'");
  const end = source.indexOf('\ntype SpectraImportSource', start);
  const auth = source.indexOf('router.use(isAuthenticated)');
  assert(auth >= 0 && start > auth && end > start);
  let handler;
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const env = { SPECTRA_GOOGLE_GEOLOCATION_API_KEY: ' ', GOOGLE_MAPS_API_KEY: marker, OPENCELLID_API_KEY: ' ', SPECTRA_TELEMETRY_HMAC_SECRET: ' ' };
  vm.runInNewContext(compiled, {
    router: { get(_path, callback) { handler = callback; } }, process: { env },
    getSpectraConfigurationDiagnostics: () => d.getSpectraConfigurationDiagnostics(env),
    readSpectraEnvironmentValue: names => d.readSpectraEnvironmentValue(names, env),
    spectraRealtimeBridgeConfigured: () => false, getSpectraAdapterCapabilities: () => [],
    getSpectraEnrolledAcquisitionCapabilities: () => [], getConfiguredSpectraAnchorCount: () => 0,
    getSpectraGenericPullAdapters: () => [],
  });
  let response;
  handler({}, { json(value) { response = value; } });
  assert.equal(response.data.radioGeolocationProviders.google, true);
  assert.equal(response.data.radioGeolocationProviders.openCellId, false);
  assert.equal(response.data.providerWebhookConfigured, false);
  assert.equal(response.data.configurationDiagnostics.scope, 'configuration-only');
  assert(!JSON.stringify(response).includes(marker));
});
console.log(`${passed} configuration checks passed`);
