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
] as const;

function present(env: Environment, name: string): boolean {
  return typeof env[name] === 'string' && Boolean(env[name]?.trim());
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
      configured: groups.every(group => group.some(name => present(env, name))),
      requirements: groups.map(group => ({
        acceptedVariableNames: [...group],
        presentVariableNames: group.filter(name => present(env, name)),
      })),
    })),
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
