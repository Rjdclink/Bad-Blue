export interface SpectraInfrastructureIdentifiers {
  providerId: string;
  macAddress?: string;
  clientId?: string;
  deviceId?: string;
  username?: string;
  ipAddress?: string;
  apId?: string;
  siteId?: string;
  mapId?: string;
  floorId?: string;
}

export interface SpectraInfrastructureBinding {
  sessionId?: string;
  subjectLabel?: string;
  correlationGroup: string;
  identifiers: string[];
}

function normalizeMac(value: unknown): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  const hex = raw.replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return undefined;
  return hex.match(/.{2}/g)?.join(':');
}

function normalizeText(value: unknown, maxLength = 240): string | undefined {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizedIdentifierEntries(input: SpectraInfrastructureIdentifiers): string[] {
  const provider = normalizeText(input.providerId, 120)?.toLowerCase() || 'provider';
  const entries = [
    normalizeMac(input.macAddress) ? `mac:${normalizeMac(input.macAddress)}` : undefined,
    normalizeText(input.clientId) ? `client:${normalizeText(input.clientId)}` : undefined,
    normalizeText(input.deviceId) ? `device:${normalizeText(input.deviceId)}` : undefined,
    normalizeText(input.username) ? `user:${normalizeText(input.username)?.toLowerCase()}` : undefined,
    normalizeText(input.ipAddress) ? `ip:${normalizeText(input.ipAddress)?.toLowerCase()}` : undefined,
    normalizeText(input.apId) ? `ap:${normalizeText(input.apId)?.toLowerCase()}` : undefined,
    normalizeText(input.siteId) ? `site:${normalizeText(input.siteId)?.toLowerCase()}` : undefined,
    normalizeText(input.mapId) ? `map:${normalizeText(input.mapId)?.toLowerCase()}` : undefined,
    normalizeText(input.floorId) ? `floor:${normalizeText(input.floorId)?.toLowerCase()}` : undefined,
  ].filter(Boolean) as string[];

  return [...new Set(entries.map(entry => `${provider}:${entry}`))];
}

function configuredBindings(): Array<Record<string, any>> {
  try {
    const parsed = JSON.parse(String(process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS || '[]'));
    return Array.isArray(parsed) ? parsed.slice(0, 1000) : [];
  } catch {
    return [];
  }
}

function bindingMatches(
  providerId: string,
  identifiers: string[],
  candidate: Record<string, any>,
): boolean {
  const provider = normalizeText(candidate.providerId, 120)?.toLowerCase();
  if (provider && provider !== providerId.toLowerCase()) return false;

  const rawIdentifier = normalizeText(candidate.identifier, 300)?.toLowerCase();
  if (!rawIdentifier) return false;

  const qualified = rawIdentifier.includes(':')
    ? rawIdentifier
    : `${providerId.toLowerCase()}:${rawIdentifier}`;
  return identifiers.some(identifier =>
    identifier.toLowerCase() === qualified
    || identifier.toLowerCase().endsWith(`:${rawIdentifier}`)
  );
}

export function resolveSpectraInfrastructureBinding(
  input: SpectraInfrastructureIdentifiers,
): SpectraInfrastructureBinding {
  const providerId = normalizeText(input.providerId, 120) || 'provider';
  const identifiers = normalizedIdentifierEntries({ ...input, providerId });

  const configured = configuredBindings()
    .find(candidate => bindingMatches(providerId, identifiers, candidate));

  const preferredIdentity =
    identifiers.find(identifier => identifier.includes(':mac:'))
    || identifiers.find(identifier => identifier.includes(':client:'))
    || identifiers.find(identifier => identifier.includes(':device:'))
    || identifiers.find(identifier => identifier.includes(':user:'))
    || identifiers[0]
    || `${providerId.toLowerCase()}:unknown`;

  return {
    sessionId: normalizeText(configured?.sessionId, 200),
    subjectLabel: normalizeText(configured?.subjectLabel, 500),
    correlationGroup: `infrastructure:${preferredIdentity}`.slice(0, 300),
    identifiers,
  };
}

export function spectraInfrastructureIdentityMetadata(
  input: SpectraInfrastructureIdentifiers,
): Record<string, unknown> {
  const binding = resolveSpectraInfrastructureBinding(input);
  return {
    infrastructureIdentifiers: binding.identifiers,
    infrastructureCorrelationGroup: binding.correlationGroup,
    infrastructureProvider: normalizeText(input.providerId, 120),
    macAddress: normalizeMac(input.macAddress),
    clientId: normalizeText(input.clientId),
    deviceId: normalizeText(input.deviceId),
    username: normalizeText(input.username),
    ipAddress: normalizeText(input.ipAddress),
    apId: normalizeText(input.apId),
    siteId: normalizeText(input.siteId),
    mapId: normalizeText(input.mapId),
    floorId: normalizeText(input.floorId),
  };
}
