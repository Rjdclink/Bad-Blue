export type VenueTransport = 'rest' | 'json_ws' | 'sbe' | 'fix' | 'grpc';

export interface VenueTransportCapability {
  venue: string;
  transport: VenueTransport;
  documented: boolean;
  entitled: boolean;
  schemaConformant: boolean;
  benchmarkSamples: number;
  latencyP99Ms: number | null;
  errorRate: number | null;
  promoted: boolean;
  lastValidatedAt: number | null;
}

const capabilities = new Map<string, VenueTransportCapability>();

function key(venue: string, transport: VenueTransport): string {
  return `${venue.trim().toLowerCase()}:${transport}`;
}

export function registerVenueTransportCapability(input: VenueTransportCapability): void {
  if (!input.venue.trim()) throw new Error('Venue transport capability requires venue');
  if (input.promoted && (!input.documented || !input.entitled || !input.schemaConformant || input.benchmarkSamples < 20 || input.latencyP99Ms === null || input.errorRate === null)) {
    throw new Error(`Cannot promote unproven ${input.venue}/${input.transport} transport`);
  }
  capabilities.set(key(input.venue, input.transport), { ...input });
}

export function chooseVenueTransport(venue: string, fallback: VenueTransport = 'rest'): VenueTransport {
  const candidates = [...capabilities.values()]
    .filter(item => item.venue.toLowerCase() === venue.toLowerCase() && item.promoted && item.documented && item.entitled && item.schemaConformant)
    .sort((a,b) => (a.latencyP99Ms ?? Number.MAX_SAFE_INTEGER) - (b.latencyP99Ms ?? Number.MAX_SAFE_INTEGER));
  return candidates[0]?.transport || fallback;
}

export function promoteVenueTransport(venue: string, transport: VenueTransport): boolean {
  const capability = capabilities.get(key(venue, transport));
  if (!capability || !capability.documented || !capability.entitled || !capability.schemaConformant) return false;
  if (capability.benchmarkSamples < 20 || capability.latencyP99Ms === null || capability.errorRate === null || capability.errorRate > 0.01) return false;
  capability.promoted = true;
  capability.lastValidatedAt = Date.now();
  return true;
}

export function demoteVenueTransport(venue: string, transport: VenueTransport): void {
  const capability = capabilities.get(key(venue, transport));
  if (capability) capability.promoted = false;
}

export function getVenueTransportPolicyHealth() {
  return {
    capabilities: [...capabilities.values()].map(item => ({ ...item })),
    specializedTransports: ['sbe','fix','grpc'] as const,
    fallbackPreserved: ['rest','json_ws'] as const,
    promotionRequiresDocumentation: true as const,
    promotionRequiresEntitlement: true as const,
    promotionRequiresSchemaConformance: true as const,
    promotionRequiresMeasuredBenchmark: true as const,
    fabricatedBinaryProtocolAllowed: false as const,
    executionAuthority: false as const,
  };
}
