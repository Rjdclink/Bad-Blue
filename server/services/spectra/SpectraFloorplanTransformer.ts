export interface SpectraFloorplanCalibrationPoint {
  x: number;
  y: number;
  latitude: number;
  longitude: number;
}

export interface SpectraFloorplanCalibration {
  provider?: string;
  mapId?: string;
  floorId?: string;
  siteId?: string;
  accuracyMeters?: number;
  points: SpectraFloorplanCalibrationPoint[];
}

export interface SpectraFloorplanCoordinateInput {
  provider?: string;
  mapId?: string;
  floorId?: string;
  siteId?: string;
  x: number;
  y: number;
}

export interface SpectraFloorplanCoordinate {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  method: 'affine-three-point' | 'similarity-two-point';
  calibrationKey: string;
}

const EARTH_RADIUS_METERS = 6_378_137;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function validCalibrationPoint(value: any): SpectraFloorplanCalibrationPoint | null {
  const x = finite(value?.x);
  const y = finite(value?.y);
  const latitude = finite(value?.latitude ?? value?.lat);
  const longitude = finite(value?.longitude ?? value?.lng ?? value?.lon);
  if (
    x === null || y === null || latitude === null || longitude === null
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) return null;
  return { x, y, latitude, longitude };
}

function loadCalibrations(): SpectraFloorplanCalibration[] {
  try {
    const parsed = JSON.parse(String(process.env.SPECTRA_FLOORPLAN_CALIBRATIONS_JSON || '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 250).flatMap((entry: any) => {
      const points = Array.isArray(entry?.points)
        ? entry.points.slice(0, 8).map(validCalibrationPoint).filter(Boolean) as SpectraFloorplanCalibrationPoint[]
        : [];
      if (points.length < 2) return [];
      return [{
        provider: String(entry?.provider || '').trim().slice(0, 120) || undefined,
        mapId: String(entry?.mapId || '').trim().slice(0, 200) || undefined,
        floorId: String(entry?.floorId || '').trim().slice(0, 200) || undefined,
        siteId: String(entry?.siteId || '').trim().slice(0, 200) || undefined,
        accuracyMeters: Math.max(1, Math.min(5_000, Number(entry?.accuracyMeters || 20))),
        points,
      }];
    });
  } catch {
    return [];
  }
}

function matchesCalibration(
  calibration: SpectraFloorplanCalibration,
  input: SpectraFloorplanCoordinateInput,
): boolean {
  const checks: Array<[string | undefined, string | undefined]> = [
    [calibration.provider, input.provider],
    [calibration.mapId, input.mapId],
    [calibration.floorId, input.floorId],
    [calibration.siteId, input.siteId],
  ];
  return checks.every(([expected, actual]) =>
    !expected || normalizedText(expected) === normalizedText(actual)
  );
}

function calibrationSpecificity(calibration: SpectraFloorplanCalibration): number {
  return [
    calibration.provider,
    calibration.mapId,
    calibration.floorId,
    calibration.siteId,
  ].filter(Boolean).length;
}

function toLocalMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): { x: number; y: number } {
  const lat0 = originLatitude * Math.PI / 180;
  return {
    x: (longitude - originLongitude) * Math.PI / 180
      * EARTH_RADIUS_METERS * Math.cos(lat0),
    y: (latitude - originLatitude) * Math.PI / 180 * EARTH_RADIUS_METERS,
  };
}

function fromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const lat0 = originLatitude * Math.PI / 180;
  return {
    latitude: originLatitude + y / EARTH_RADIUS_METERS * 180 / Math.PI,
    longitude: originLongitude
      + x / (EARTH_RADIUS_METERS * Math.max(1e-8, Math.cos(lat0))) * 180 / Math.PI,
  };
}

function solveAffine(
  calibration: SpectraFloorplanCalibration,
  x: number,
  y: number,
): SpectraFloorplanCoordinate | null {
  if (calibration.points.length < 3) return null;
  const [p1, p2, p3] = calibration.points;
  const originLatitude = p1.latitude;
  const originLongitude = p1.longitude;
  const g1 = toLocalMeters(p1.latitude, p1.longitude, originLatitude, originLongitude);
  const g2 = toLocalMeters(p2.latitude, p2.longitude, originLatitude, originLongitude);
  const g3 = toLocalMeters(p3.latitude, p3.longitude, originLatitude, originLongitude);

  const a11 = p2.x - p1.x;
  const a12 = p2.y - p1.y;
  const a21 = p3.x - p1.x;
  const a22 = p3.y - p1.y;
  const determinant = a11 * a22 - a12 * a21;
  if (Math.abs(determinant) < 1e-9) return null;

  const dx = x - p1.x;
  const dy = y - p1.y;
  const u = (dx * a22 - dy * a12) / determinant;
  const v = (a11 * dy - a21 * dx) / determinant;

  const localX = g1.x + u * (g2.x - g1.x) + v * (g3.x - g1.x);
  const localY = g1.y + u * (g2.y - g1.y) + v * (g3.y - g1.y);
  const geo = fromLocalMeters(localX, localY, originLatitude, originLongitude);
  if (
    !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)
    || geo.latitude < -90 || geo.latitude > 90
    || geo.longitude < -180 || geo.longitude > 180
  ) return null;

  return {
    ...geo,
    accuracyMeters: Math.max(1, Number(calibration.accuracyMeters || 20)),
    method: 'affine-three-point',
    calibrationKey: [
      calibration.provider || '*',
      calibration.siteId || '*',
      calibration.mapId || '*',
      calibration.floorId || '*',
    ].join(':'),
  };
}

function solveSimilarity(
  calibration: SpectraFloorplanCalibration,
  x: number,
  y: number,
): SpectraFloorplanCoordinate | null {
  if (calibration.points.length < 2) return null;
  const [p1, p2] = calibration.points;
  const sourceDx = p2.x - p1.x;
  const sourceDy = p2.y - p1.y;
  const sourceDistance = Math.hypot(sourceDx, sourceDy);
  if (sourceDistance < 1e-6) return null;

  const originLatitude = p1.latitude;
  const originLongitude = p1.longitude;
  const g2 = toLocalMeters(p2.latitude, p2.longitude, originLatitude, originLongitude);
  const targetDistance = Math.hypot(g2.x, g2.y);
  if (targetDistance < 1e-6) return null;

  const scale = targetDistance / sourceDistance;
  const sourceAngle = Math.atan2(sourceDy, sourceDx);
  const targetAngle = Math.atan2(g2.y, g2.x);
  const rotation = targetAngle - sourceAngle;

  const dx = x - p1.x;
  const dy = y - p1.y;
  const localX = scale * (dx * Math.cos(rotation) - dy * Math.sin(rotation));
  const localY = scale * (dx * Math.sin(rotation) + dy * Math.cos(rotation));
  const geo = fromLocalMeters(localX, localY, originLatitude, originLongitude);
  if (
    !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)
    || geo.latitude < -90 || geo.latitude > 90
    || geo.longitude < -180 || geo.longitude > 180
  ) return null;

  return {
    ...geo,
    accuracyMeters: Math.max(3, Number(calibration.accuracyMeters || 30)),
    method: 'similarity-two-point',
    calibrationKey: [
      calibration.provider || '*',
      calibration.siteId || '*',
      calibration.mapId || '*',
      calibration.floorId || '*',
    ].join(':'),
  };
}

export function resolveSpectraFloorplanCoordinate(
  input: SpectraFloorplanCoordinateInput,
): SpectraFloorplanCoordinate | null {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;

  const calibration = loadCalibrations()
    .filter(item => matchesCalibration(item, input))
    .sort((a, b) => calibrationSpecificity(b) - calibrationSpecificity(a))[0];
  if (!calibration) return null;

  return solveAffine(calibration, input.x, input.y)
    || solveSimilarity(calibration, input.x, input.y);
}
