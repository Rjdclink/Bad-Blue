import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';
import { compareSpectraPhotoEvidence } from './SpectraVisualSceneAnalysis';
import { prioritizeSpectraPublicMediaScenes } from './SpectraPublicMediaPriority';

/**
 * A bounded, content-only correlation pass over images actually downloaded
 * during this acquisition. No face matching, account identity resolution, or
 * conversion of scene coordinates into a person's location is performed.
 * This summary is persisted privately, not added to map-facing response data.
 */
export interface SpectraMediaCorrelationSummary {
  inspectedImageRecords: number;
  distinctImageHashes: number;
  duplicateImageRecords: number;
  classifiedSceneFiles: number;
  comparableScenePairs: number;
  highGenericSceneOverlapPairs: number;
  strongestGenericTagOverlap: number | null;
  faceComparisons: 0;
  verifiedPersonLocations: 0;
}

const MAX_RECORDS = 80;
const MAX_SCENES = 24;
const HASH = /^[a-f0-9]{64}$/i;
const HIGH_OVERLAP = 0.8;

function imageHash(record: SpectraRetrievedEvidence): string | null {
  const payload = record.structuredRecord;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const item = payload as Record<string, unknown>;
  if (item.evidenceRole !== 'media_capture_scene'
    || item.captureLocationIsSubjectPosition !== false
    || item.currentPositionVerified !== false
    || typeof item.contentSha256 !== 'string'
    || !HASH.test(item.contentSha256)) return null;
  return item.contentSha256.toLowerCase();
}

export function summarizeSpectraMediaEvidence(
  records: readonly SpectraRetrievedEvidence[],
  asOf: Date = new Date(),
): SpectraMediaCorrelationSummary {
  const imageRecords = records.slice(0, MAX_RECORDS);
  const hashes = imageRecords.map(imageHash).filter((hash): hash is string => hash !== null);
  // Images with an invalid/unknown content hash are not compared.
  const distinctImageHashes = new Set(hashes).size;
  const scenes = prioritizeSpectraPublicMediaScenes(imageRecords, asOf, MAX_SCENES)
    .filter(item => Boolean(item.sceneAnalysis));
  let comparableScenePairs = 0;
  let highGenericSceneOverlapPairs = 0;
  let strongestGenericTagOverlap: number | null = null;
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const result = compareSpectraPhotoEvidence(
        { contentSha256: scenes[i].contentSha256, scene: scenes[i].sceneAnalysis },
        { contentSha256: scenes[j].contentSha256, scene: scenes[j].sceneAnalysis },
      );
      if (result.genericSceneTagOverlap === null) continue;
      comparableScenePairs++;
      strongestGenericTagOverlap = Math.max(strongestGenericTagOverlap ?? 0, result.genericSceneTagOverlap);
      if (result.genericSceneTagOverlap >= HIGH_OVERLAP) highGenericSceneOverlapPairs++;
    }
  }
  return {
    inspectedImageRecords: hashes.length,
    distinctImageHashes,
    duplicateImageRecords: hashes.length - distinctImageHashes,
    classifiedSceneFiles: scenes.length,
    comparableScenePairs,
    highGenericSceneOverlapPairs,
    strongestGenericTagOverlap,
    faceComparisons: 0,
    verifiedPersonLocations: 0,
  };
}
