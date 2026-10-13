import { parseSpectraVisualSceneAssessment, type SpectraVisualSceneAssessment } from './SpectraVisualSceneAnalysis';

/** Recency priority for locations embedded in publicly fetched PHOTOGRAPHS.
 * This ranks dated capture scenes, not a person's current or historical presence.
 * Retrieval and post-publication timestamps never substitute for a capture date.
 */
export interface SpectraPublicMediaRecord {
  url: string;
  retrievedAt: string;
  publishedAt?: string;
  structuredRecord?: unknown;
}

export interface SpectraPrioritizedMediaScene {
  imageUrl: string;
  sourcePostUrl: string;
  sourcePlatform: string;
  contentSha256: string;
  retrievedAt: string;
  publishedAt?: string;
  capturedAt: string | null;
  captureTimeStatus: string;
  captureGps: { latitude: number; longitude: number } | null;
  sceneAnalysis?: SpectraVisualSceneAssessment;
  recencyWeight: number;
  ageDays: number | null;
  priorityBand: 'recent_scene' | 'historical_scene' | 'undated_scene' | 'no_geotag';
  evidenceRole: 'media_capture_scene';
  subjectPresenceVerified: false;
  currentPositionVerified: false;
  sourcePostUrls: string[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 30;

/** A recency weight is a ranking signal, NOT a location accuracy/confidence probability. */
export function prioritizeSpectraPublicMediaScenes(
  records: readonly SpectraPublicMediaRecord[], asOf: Date = new Date(), limit = 24,
): SpectraPrioritizedMediaScene[] {
  const now = asOf.getTime();
  if (!Number.isFinite(now)) throw new TypeError('A valid evaluation time is required.');
  const collected = new Map<string, SpectraPrioritizedMediaScene>();
  for (const record of records.slice(0, 320)) {
    if (typeof record.url !== 'string' || typeof record.retrievedAt !== 'string') continue;
    const item = object(record.structuredRecord);
    if (!item || item.evidenceRole !== 'media_capture_scene'
      || item.captureLocationIsSubjectPosition !== false || item.currentPositionVerified !== false) continue;
    const sha = item.contentSha256;
    const post = item.sourcePostUrl;
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/i.test(sha)
      || typeof post !== 'string' || !/^https:\/\/[^\s/]+\//.test(post)) continue;
    const geo = object(item.captureGps);
    const lat = geo?.latitude, lon = geo?.longitude;
    const validGps = typeof lat === 'number' && typeof lon === 'number'
      && Number.isFinite(lat) && Number.isFinite(lon)
      && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    const gps = validGps ? { latitude: lat as number, longitude: lon as number } : null;
    const originalCaptureTime = item.captureTimeStatus === 'utc_offset_present'
      && typeof item.capturedAt === 'string' ? Date.parse(item.capturedAt) : NaN;
    const validTime = Number.isFinite(originalCaptureTime)
      && originalCaptureTime >= Date.UTC(1900, 0, 1)
      && originalCaptureTime <= now + 5 * 60_000;
    const ageDays = validTime ? Math.max(0, now - originalCaptureTime) / DAY_MS : null;
    const recencyWeight = validGps && ageDays !== null
      ? Math.pow(0.5, ageDays / HALF_LIFE_DAYS) : 0;
    // Never forward arbitrary source-provided model fields. Rebuild a bounded
    // allowlisted assessment, validating its byte hash and provenance marker.
    const sceneCandidate = object(item.sceneAnalysis);
    const sceneAnalysis = sceneCandidate?.evidenceRole === 'model_interpreted_scene_context'
      && sceneCandidate?.validation === 'unverified_model_output'
      && sceneCandidate?.method === 'claude_image_classification'
      && typeof sceneCandidate?.contentSha256 === 'string'
      && sceneCandidate.contentSha256.toLowerCase() === sha.toLowerCase()
      ? parseSpectraVisualSceneAssessment(JSON.stringify(sceneCandidate), sha)
      : null;
    const scene: SpectraPrioritizedMediaScene = {
      imageUrl: record.url,
      sourcePostUrl: post,
      sourcePlatform: typeof item.sourcePlatform === 'string' ? item.sourcePlatform.slice(0, 50) : 'Web',
      contentSha256: sha,
      retrievedAt: record.retrievedAt,
      publishedAt: record.publishedAt,
      capturedAt: validTime ? new Date(originalCaptureTime).toISOString() : null,
      captureTimeStatus: typeof item.captureTimeStatus === 'string' ? item.captureTimeStatus : 'missing',
      captureGps: gps,
      ...(sceneAnalysis ? { sceneAnalysis } : {}),
      ageDays,
      recencyWeight,
      priorityBand: !validGps ? 'no_geotag'
        : ageDays === null ? 'undated_scene'
          : ageDays < 30 ? 'recent_scene' : 'historical_scene',
      evidenceRole: 'media_capture_scene',
      subjectPresenceVerified: false,
      currentPositionVerified: false,
      sourcePostUrls: [post],
    };
    // Identical file hashes are one scene, however many posts copied them.
    const prior = collected.get(sha);
    if (!prior) collected.set(sha, scene);
    else {
      if (!prior.sourcePostUrls.includes(post) && prior.sourcePostUrls.length < 8) {
        prior.sourcePostUrls.push(post);
      }
      if (!prior.sceneAnalysis && scene.sceneAnalysis) prior.sceneAnalysis = scene.sceneAnalysis;
    }
  }
  return [...collected.values()].sort((a, b) =>
    b.recencyWeight - a.recencyWeight
    || Number(Boolean(b.captureGps)) - Number(Boolean(a.captureGps))
    || a.imageUrl.localeCompare(b.imageUrl)
  ).slice(0, Math.max(0, Math.min(50, Math.floor(limit))));
}
