/**
 * Public-page geotags are coordinates of places mentioned on a webpage, not
 * authenticated observations of the queried person or their device.
 * Keep them inspectable as source context but out of the subject GPS pipeline.
 */
import type {
  SpectraRetrievedEvidence,
  SpectraRetrievedObservation,
} from './SpectraPublicRetrieval';

export function unboundPublicGeoContext(
  observations: readonly SpectraRetrievedObservation[],
): Array<SpectraRetrievedObservation & {
  kind: 'public_source_geospatial_context';
  subjectMatchConfidence: 0;
  currentPositionVerified: false;
}> {
  return observations.map(point => ({
    ...point,
    kind: 'public_source_geospatial_context' as const,
    subjectMatchConfidence: 0 as const,
    currentPositionVerified: false as const,
  }));
}

export function mergePublicRetrievedMetadata(
  previous: Record<string, unknown> | undefined,
  evidence: SpectraRetrievedEvidence,
): Record<string, unknown> {
  return {
    ...(previous || {}),
    requestedUrl: evidence.requestedUrl,
    sourceUrl: evidence.url,
    retrievedAt: evidence.retrievedAt,
    // Absence of publication metadata after fetching is not evidence that an
    // older date from the discovery provider should be discarded.
    publishedAt: evidence.publishedAt ?? previous?.publishedAt,
    fetchedTitle: evidence.title ?? previous?.fetchedTitle,
    fetchedExcerpt: evidence.textExcerpt ?? previous?.fetchedExcerpt,
    retrievedLocationEvidence: unboundPublicGeoContext(evidence.observations),
  };
}

export function stripUnboundPublicGeoContext(
  sourceMetadata: unknown,
): Record<string, unknown> {
  if (!sourceMetadata || typeof sourceMetadata !== 'object' || Array.isArray(sourceMetadata)) {
    return {};
  }
  const { retrievedLocationEvidence: _unboundPageCoordinates, ...subjectSafeMetadata } =
    sourceMetadata as Record<string, unknown>;
  return subjectSafeMetadata;
}


/**
 * Venue geotags are useful geospatial search evidence, even when they are NOT
 * observations of the person being searched. Return them as a separate, cited
 * channel so the SPECTRA API and console can use the coordinates instead of
 * silently hiding them in discovery metadata.
 */
export interface PublicVenueCoordinateEvidence {
  kind: 'public_venue_coordinate';
  latitude: number;
  longitude: number;
  venueLabel: string;
  sourceUrl: string;
  requestedUrl?: string;
  retrievedAt?: string;
  publishedAt?: string;
  extractionMethod: string;
  subjectPresenceVerified: false;
}

interface PublicVenueDiscoverySource {
  title?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

function publicHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !parsed.username && !parsed.password
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

export function collectPublicVenueCoordinateEvidence(
  results: readonly PublicVenueDiscoverySource[],
): PublicVenueCoordinateEvidence[] {
  const collected: PublicVenueCoordinateEvidence[] = [];
  const seen = new Set<string>();

  for (const result of results.slice(0, 200)) {
    const sourceMetadata = result.metadata;
    if (!sourceMetadata || typeof sourceMetadata !== 'object') continue;
    const rawPoints = sourceMetadata.retrievedLocationEvidence;
    if (!Array.isArray(rawPoints)) continue;

    for (const point of rawPoints.slice(0, 100)) {
      if (!point || typeof point !== 'object'
          || point.kind !== 'public_source_geospatial_context') continue;
      const { latitude, longitude } = point;
      if (typeof latitude !== 'number' || typeof longitude !== 'number'
          || !Number.isFinite(latitude) || !Number.isFinite(longitude)
          || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        continue;
      }
      // A coordinate with an explicit invalid source must not inherit an
      // unrelated page's URL as though it were its own provenance.
      const sourceUrl = point.sourceUrl
        ? publicHttpUrl(point.sourceUrl)
        : publicHttpUrl(sourceMetadata.sourceUrl) || publicHttpUrl(result.url);
      if (!sourceUrl) continue;
      const key = `${sourceUrl}|${latitude.toFixed(7)}|${longitude.toFixed(7)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const pointMetadata = point.metadata && typeof point.metadata === 'object'
        && !Array.isArray(point.metadata)
        ? point.metadata as Record<string, unknown>
        : {};
      collected.push({
        kind: 'public_venue_coordinate',
        latitude,
        longitude,
        venueLabel: optionalText(pointMetadata.name, 200)
          || optionalText(sourceMetadata.fetchedTitle, 200)
          || optionalText(result.title, 200)
          || 'Geotagged public webpage',
        sourceUrl,
        requestedUrl: publicHttpUrl(sourceMetadata.requestedUrl),
        retrievedAt: optionalText(sourceMetadata.retrievedAt, 40),
        publishedAt: optionalText(sourceMetadata.publishedAt, 40),
        extractionMethod: optionalText(point.acquisitionMethod, 100)
          || 'public-web-geospatial-metadata',
        subjectPresenceVerified: false,
      });
      if (collected.length >= 40) return collected;
    }
  }
  return collected;
}
