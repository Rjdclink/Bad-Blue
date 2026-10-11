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
    fetchedAddressBlocks: evidence.addressBlocks,
    fetchedContentType: evidence.contentType,
    fetchedRecord: evidence.structuredRecord,
    fetchedRecordOmitted: evidence.structuredRecordOmitted === true,
    retrievedLocationEvidence: unboundPublicGeoContext(evidence.observations),
  };
}

export function stripUnboundPublicGeoContext(
  sourceMetadata: unknown,
): Record<string, unknown> {
  if (!sourceMetadata || typeof sourceMetadata !== 'object' || Array.isArray(sourceMetadata)) {
    return {};
  }
  const {
    retrievedLocationEvidence: _unboundPageCoordinates,
    // Raw archived source bodies can contain arbitrary place coordinates.
    // They are available for inspection, never implicit subject observations.
    fetchedRecord: _archivedSourceRecord,
    fetchedAddressBlocks: _sourceAddresses,
    ...subjectSafeMetadata
  } =
    sourceMetadata as Record<string, unknown>;
  return subjectSafeMetadata;
}
