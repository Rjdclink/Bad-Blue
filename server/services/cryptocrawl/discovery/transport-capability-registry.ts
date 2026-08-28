import type { CryptoCrawlerCexVenue } from './venue-capability-registry.js';

export type VenueTransportProtocol = 'rest' | 'json_ws' | 'sbe' | 'fix' | 'grpc';

export interface VenueTransportCapability {
  venue: CryptoCrawlerCexVenue;
  protocol: VenueTransportProtocol;
  documented: boolean;
  accountEntitled: boolean;
  schemaVersion: string | null;
  conformanceFixturePassed: boolean;
  benchmarkPassed: boolean;
  measuredSerializationP95Us: number | null;
  measuredNetworkP95Ms: number | null;
  enabled: boolean;
  fallback: VenueTransportProtocol | null;
  reason: string;
}

const measurements = new Map<string, Pick<VenueTransportCapability,
  'conformanceFixturePassed' | 'benchmarkPassed' | 'measuredSerializationP95Us' | 'measuredNetworkP95Ms'>>();

function entitlement(venue: CryptoCrawlerCexVenue, protocol: VenueTransportProtocol): boolean {
  if (protocol === 'rest' || protocol === 'json_ws') return true;
  return process.env[`CRYPTO_${venue.toUpperCase()}_${protocol.toUpperCase()}_ENTITLED`] === 'true';
}

function baseCapability(venue: CryptoCrawlerCexVenue, protocol: VenueTransportProtocol): VenueTransportCapability {
  const isCanonicalVenue = ['coinbase','kraken','okx'].includes(venue);
  const documented = protocol === 'rest' || (protocol === 'json_ws' && isCanonicalVenue);
  const accountEntitled = documented && entitlement(venue, protocol);
  const key = `${venue}:${protocol}`;
  const measured = measurements.get(key);
  const conformanceFixturePassed = protocol === 'rest' || protocol === 'json_ws'
    ? documented
    : measured?.conformanceFixturePassed === true;
  const benchmarkPassed = protocol === 'rest' || protocol === 'json_ws'
    ? documented
    : measured?.benchmarkPassed === true;
  const enabled = documented && accountEntitled && conformanceFixturePassed && benchmarkPassed;
  return {
    venue,
    protocol,
    documented,
    accountEntitled,
    schemaVersion: protocol === 'rest' || protocol === 'json_ws' ? 'venue_native_current' : null,
    conformanceFixturePassed,
    benchmarkPassed,
    measuredSerializationP95Us: measured?.measuredSerializationP95Us ?? null,
    measuredNetworkP95Ms: measured?.measuredNetworkP95Ms ?? null,
    enabled,
    fallback: protocol === 'rest' ? null : 'rest',
    reason: enabled
      ? 'venue-native transport is documented, entitled, conformant, and benchmark-eligible'
      : protocol === 'sbe' || protocol === 'fix' || protocol === 'grpc'
        ? 'binary/specialized transport remains disabled until venue documentation, account entitlement, exact schema conformance, and measured benchmark evidence all pass'
        : 'transport is unavailable for this venue capability',
  };
}

export function getVenueTransportCapabilities(venue: CryptoCrawlerCexVenue): VenueTransportCapability[] {
  return (['rest','json_ws','sbe','fix','grpc'] as const).map(protocol => baseCapability(venue, protocol));
}

export function getPreferredVenueTransport(venue: CryptoCrawlerCexVenue): VenueTransportCapability | null {
  // Specialized transports are only considered after every promotion gate passes.
  for (const protocol of ['sbe','fix','grpc','json_ws','rest'] as const) {
    const capability = baseCapability(venue, protocol);
    if (capability.enabled) return capability;
  }
  return null;
}

export function recordTransportConformanceBenchmark(input: {
  venue: CryptoCrawlerCexVenue;
  protocol: Exclude<VenueTransportProtocol, 'rest' | 'json_ws'>;
  schemaVersion: string;
  conformanceFixturePassed: boolean;
  serializationP95Us: number;
  networkP95Ms: number;
  benchmarkPassed: boolean;
}): void {
  if (!input.schemaVersion.trim()) throw new Error('Specialized transport benchmark requires exact schema/version identity');
  if (!Number.isFinite(input.serializationP95Us) || input.serializationP95Us < 0) throw new Error('Transport serialization benchmark must be measured');
  if (!Number.isFinite(input.networkP95Ms) || input.networkP95Ms < 0) throw new Error('Transport network benchmark must be measured');
  measurements.set(`${input.venue}:${input.protocol}`, {
    conformanceFixturePassed: input.conformanceFixturePassed,
    benchmarkPassed: input.benchmarkPassed,
    measuredSerializationP95Us: input.serializationP95Us,
    measuredNetworkP95Ms: input.networkP95Ms,
  });
}

export function getTransportRegistryHealth() {
  return {
    protocols: ['rest','json_ws','sbe','fix','grpc'] as const,
    specializedTransportPromotionRequires: ['documented','account_entitled','exact_schema_conformance','measured_benchmark'] as const,
    inventedGenericBinaryProtocolAllowed: false as const,
    jsonRestFallbackRetained: true as const,
    executionAuthority: false as const,
  };
}
