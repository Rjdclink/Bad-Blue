export interface SpectraAnchorDefinition {
  id: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracyMeters?: number;
  aliases: string[];
  kind?: string;
  metadata?: Record<string, unknown>;
}

let cachedRaw = '';
let cachedAnchors = new Map<string, SpectraAnchorDefinition>();

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readConfiguredAnchors(): Map<string, SpectraAnchorDefinition> {
  const raw = String(process.env.SPECTRA_ANCHOR_CATALOG_JSON || '').trim();
  if (raw === cachedRaw) return cachedAnchors;

  cachedRaw = raw;
  cachedAnchors = new Map();
  if (!raw) return cachedAnchors;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return cachedAnchors;

    for (const item of parsed.slice(0, 10_000)) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const latitude = finite(row.latitude ?? row.lat);
      const longitude = finite(row.longitude ?? row.lng ?? row.lon);
      if (
        latitude === undefined
        || longitude === undefined
        || latitude < -90 || latitude > 90
        || longitude < -180 || longitude > 180
      ) continue;

      const primary = String(
        row.id
        ?? row.anchorId
        ?? row.deviceId
        ?? row.macAddress
        ?? row.bssid
        ?? row.beaconId
        ?? '',
      ).trim();
      if (!primary) continue;

      const aliasValues = [
        primary,
        row.anchorId,
        row.deviceId,
        row.peerRef,
        row.peerId,
        row.macAddress,
        row.bssid,
        row.beaconId,
        row.locatorId,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
      ];
      const aliases = [...new Set(
        aliasValues.map(normalizeKey).filter(Boolean),
      )];

      const definition: SpectraAnchorDefinition = {
        id: primary.slice(0, 300),
        latitude,
        longitude,
        altitude: finite(row.altitude),
        accuracyMeters: finite(row.accuracyMeters ?? row.accuracy),
        aliases,
        kind: typeof row.kind === 'string' ? row.kind.slice(0, 80) : undefined,
        metadata:
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata as Record<string, unknown>
            : undefined,
      };

      for (const alias of aliases) cachedAnchors.set(alias, definition);
    }
  } catch {
    cachedAnchors = new Map();
  }

  return cachedAnchors;
}

export function resolveConfiguredSpectraAnchor(
  value: unknown,
): SpectraAnchorDefinition | null {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const candidates = [
    source.id,
    source.anchorId,
    source.deviceId,
    source.peerRef,
    source.peerId,
    source.macAddress,
    source.bssid,
    source.beaconId,
    source.locatorId,
  ].map(normalizeKey).filter(Boolean);

  const anchors = readConfiguredAnchors();
  for (const candidate of candidates) {
    const match = anchors.get(candidate);
    if (match) return match;
  }
  return null;
}

export function getConfiguredSpectraAnchorCount(): number {
  const anchors = readConfiguredAnchors();
  return new Set([...anchors.values()].map(anchor => anchor.id)).size;
}
