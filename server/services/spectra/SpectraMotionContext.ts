import { pool } from '../../db';

export interface SpectraMotionContext {
  id?: string;
  sessionId: string;
  userId?: string;
  provider?: string;
  sourceId?: string;
  observedAt: Date;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  confidence: number;
  vehicleCount?: number;
  averageVehicleSpeedMps?: number;
  dominantHeadingDegrees?: number;
  congestionRatio?: number;
  metadata?: Record<string, unknown>;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function normalizeHeading(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return ((Number(value) % 360) + 360) % 360;
}

export async function persistSpectraMotionContext(
  context: SpectraMotionContext,
): Promise<boolean> {
  if (!context.sessionId.trim() || !validCoordinate(context.latitude, context.longitude)) return false;
  const observedAt = context.observedAt instanceof Date ? context.observedAt : new Date(context.observedAt);
  if (!Number.isFinite(observedAt.getTime())) return false;

  try {
    await pool.query(
      `INSERT INTO public.spectra_motion_context
        (
          user_id, session_id, provider, source_id, observed_at,
          latitude, longitude, radius_meters, confidence,
          vehicle_count, average_vehicle_speed_mps, dominant_heading_degrees,
          congestion_ratio, metadata
        )
       VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12,
          $13, $14::jsonb
       )`,
      [
        context.userId || null,
        context.sessionId.trim(),
        context.provider || null,
        context.sourceId || null,
        observedAt,
        context.latitude,
        context.longitude,
        Math.max(5, Math.min(100_000, Number(context.radiusMeters) || 250)),
        Math.max(0.05, Math.min(1, Number(context.confidence) || 0.5)),
        Number.isFinite(context.vehicleCount) ? Math.max(0, Math.floor(Number(context.vehicleCount))) : null,
        Number.isFinite(context.averageVehicleSpeedMps) ? Math.max(0, Math.min(100, Number(context.averageVehicleSpeedMps))) : null,
        normalizeHeading(context.dominantHeadingDegrees) ?? null,
        Number.isFinite(context.congestionRatio) ? Math.max(0, Math.min(1, Number(context.congestionRatio))) : null,
        JSON.stringify(context.metadata || {}),
      ],
    );
    return true;
  } catch (error: any) {
    if (error?.code === '42P01') return false;
    throw error;
  }
}

function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radius = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
    * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function loadSpectraMotionContext(input: {
  sessionId: string;
  userId?: string;
  latitude: number;
  longitude: number;
  maxAgeMinutes?: number;
  maxDistanceMeters?: number;
  limit?: number;
}): Promise<SpectraMotionContext[]> {
  const sessionId = input.sessionId.trim();
  if (!sessionId || !validCoordinate(input.latitude, input.longitude)) return [];

  const maxAgeMinutes = Math.max(1, Math.min(180, Math.floor(input.maxAgeMinutes ?? 30)));
  const maxDistanceMeters = Math.max(50, Math.min(50_000, input.maxDistanceMeters ?? 10_000));
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 40)));

  try {
    const result = await pool.query(
      `SELECT
         id, user_id, session_id, provider, source_id, observed_at,
         latitude, longitude, radius_meters, confidence,
         vehicle_count, average_vehicle_speed_mps, dominant_heading_degrees,
         congestion_ratio, metadata
       FROM public.spectra_motion_context
       WHERE session_id = $1
         AND observed_at >= now() - ($2::text || ' minutes')::interval
         AND (
           ($3::text IS NULL AND user_id IS NULL)
           OR user_id = $3
         )
       ORDER BY observed_at DESC
       LIMIT $4`,
      [sessionId, String(maxAgeMinutes), input.userId || null, limit * 3],
    );

    return result.rows.flatMap((row: any) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      const distance = distanceMeters(input.latitude, input.longitude, latitude, longitude);
      const effectiveRadius = Math.max(maxDistanceMeters, Number(row.radius_meters) || 0);
      if (!validCoordinate(latitude, longitude) || distance > effectiveRadius) return [];

      return [{
        id: String(row.id),
        userId: row.user_id || undefined,
        sessionId: String(row.session_id),
        provider: row.provider || undefined,
        sourceId: row.source_id || undefined,
        observedAt: new Date(row.observed_at),
        latitude,
        longitude,
        radiusMeters: Number(row.radius_meters),
        confidence: Number(row.confidence),
        vehicleCount: row.vehicle_count == null ? undefined : Number(row.vehicle_count),
        averageVehicleSpeedMps: row.average_vehicle_speed_mps == null
          ? undefined
          : Number(row.average_vehicle_speed_mps),
        dominantHeadingDegrees: row.dominant_heading_degrees == null
          ? undefined
          : Number(row.dominant_heading_degrees),
        congestionRatio: row.congestion_ratio == null
          ? undefined
          : Number(row.congestion_ratio),
        metadata: {
          ...(row.metadata || {}),
          distanceMeters: distance,
        },
      } satisfies SpectraMotionContext];
    }).slice(0, limit);
  } catch (error: any) {
    if (error?.code === '42P01') return [];
    throw error;
  }
}
