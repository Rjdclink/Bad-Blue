/** Configuration diagnostics only: never make requests or expose credentials. */
type Environment = Readonly<Record<string, string | undefined>>;

const credentialGroups = [
  { id: 'tavily', groups: [['TAVILY_API_KEY']] },
  { id: 'serpapi', groups: [['SERPAPI_KEY', 'SERPAPI_API_KEY']] },
  { id: 'scrapingbee', groups: [['SCRAPINGBEE_API_KEY']] },
  { id: 'geonames', groups: [['GEONAMES_USERNAME']] },
  { id: 'flickr', groups: [['FLICKR_API_KEY']] },
  { id: 'google-radio', groups: [['SPECTRA_GOOGLE_GEOLOCATION_API_KEY', 'GOOGLE_GEOLOCATION_API_KEY', 'GOOGLE_MAPS_API_KEY']] },
  { id: 'opencellid', groups: [['OPENCELLID_API_KEY']] },
  { id: 'trafficland', groups: [['TRAFFICLAND_API_KEY'], ['TRAFFICLAND_SYSTEM']] },
  { id: 'telemetry-ingestion', groups: [['SPECTRA_TELEMETRY_HMAC_SECRET']] },
  { id: 'android-radio-collector', groups: [['SPECTRA_ANDROID_RADIO_COLLECTOR_URL_TEMPLATE'], ['SPECTRA_ANDROID_RADIO_COLLECTOR_TOKEN']] },
  { id: 'apple-device-collector', groups: [['SPECTRA_APPLE_DEVICE_COLLECTOR_URL_TEMPLATE'], ['SPECTRA_APPLE_DEVICE_COLLECTOR_TOKEN']] },
  { id: 'traccar', groups: [['SPECTRA_TRACCAR_URL'], ['SPECTRA_TRACCAR_TOKEN']] },
  { id: 'camara-location', groups: [['SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL'], ['SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN']] },
  {
    id: 'vonage-location',
    groups: [
      ['SPECTRA_VONAGE_LOCATION_TOKEN', 'SPECTRA_VONAGE_APPLICATION_ID'],
      ['SPECTRA_VONAGE_LOCATION_TOKEN', 'SPECTRA_VONAGE_PRIVATE_KEY'],
      ['SPECTRA_VONAGE_LOCATION_TOKEN', 'SPECTRA_VONAGE_OAUTH_SCOPE'],
    ],
  },
  { id: 'phoneinfoga', groups: [['SPECTRA_PHONEINFOGA_URL']] },
] as const;

function present(env: Environment, name: string): boolean {
  return typeof env[name] === 'string' && Boolean(env[name]?.trim());
}

function hasBootstrapEnrollment(env: Environment): boolean {
  const raw = String(env.SPECTRA_ENROLLED_DEVICES_JSON || '').trim();
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
}

function camaraDeviceSource(env: Environment): 'phone' | 'invalid' {
  const raw = String(env.SPECTRA_CAMARA_LOCATION_DEVICE_SOURCE || 'phone')
    .trim().toLowerCase();
  return raw === 'phone' ? 'phone' : 'invalid';
}

/** Server-only credential selection; callers must not serialize the value. */
export function readSpectraEnvironmentValue(names: readonly string[], env: Environment = process.env): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getSpectraConfigurationDiagnostics(env: Environment = process.env) {
  return {
    scope: 'configuration-only' as const,
    // A defined key is not proof of valid credentials, coverage, or a live feed.
    authenticationStatus: 'not-tested' as const,
    connectionStatus: 'not-tested' as const,
    credentials: credentialGroups.map(({ id, groups }) => ({
      integration: id,
      configured:
        groups.every(group => group.some(name => present(env, name)))
        && (id !== 'camara-location' || camaraDeviceSource(env) !== 'invalid'),
      requirements: groups.map(group => ({
        acceptedVariableNames: [...group],
        presentVariableNames: group.filter(name => present(env, name)),
      })),
    })),
    enrolledSources: {
      enrollmentRegistryConfigured: hasBootstrapEnrollment(env)
        || present(env, 'NEON_DATABASE_URL')
        || present(env, 'DATABASE_URL')
        || present(env, 'SUPABASE_DATABASE_URL'),
      ownTracksConfigured: present(env, 'SPECTRA_OWNTRACKS_RECORDER_URL'),
      ownTracksAuthenticationConfigured:
        present(env, 'SPECTRA_OWNTRACKS_AUTHORIZATION')
        || (present(env, 'SPECTRA_OWNTRACKS_USERNAME') && present(env, 'SPECTRA_OWNTRACKS_PASSWORD')),
      androidManagedLocationConfigured:
        present(env, 'SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE')
        && present(env, 'SPECTRA_ANDROID_MDM_LOCATION_TOKEN'),
      appleManagedLocationConfigured:
        present(env, 'SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE')
        && present(env, 'SPECTRA_APPLE_MDM_LOCATION_TOKEN'),
      camaraDeviceIdentificationMode: camaraDeviceSource(env),
    },
    censusGeocoder: {
      keyRequired: false,
      censusDataKeyPresent: present(env, 'CENSUS_API_KEY'),
      censusDataKeyUsedByGeocoder: false,
    },
  };
}

export function describeSpectraAdapterConfiguration(mode: string, configured: boolean) {
  return {
    configurationStatus: configured ? 'available' as const : 'missing' as const,
    configurationScope: mode === 'provider-webhook'
      ? 'ingestion-authentication-only' as const
      : 'adapter-prerequisites-only' as const,
    connectionStatus: 'not-tested' as const,
    observationStatus: 'not-checked' as const,
  };
}
