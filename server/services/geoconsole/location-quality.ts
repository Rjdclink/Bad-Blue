import type { GPSPoint } from './types';

export interface LocationQualityIssue {
  index: number;
  code: 'invalid_timestamp' | 'missing_accuracy' | 'low_accuracy' | 'duplicate_point' | 'implausible_transition';
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface LocationQualityResult {
  points: GPSPoint[];
  issues: LocationQualityIssue[];
  acceptedCount: number;
  rejectedCount: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DUPLICATE_DISTANCE_METERS = 2;
const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = 350;

function distanceMeters(first: GPSPoint, second: GPSPoint): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = toRadians(second.latitude - first.latitude);
  const deltaLongitude = toRadians(second.longitude - first.longitude);
  const latitude1 = toRadians(first.latitude);
  const latitude2 = toRadians(second.latitude);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function assessLocationQuality(inputs: GPSPoint[]): LocationQualityResult {
  const issues: LocationQualityIssue[] = [];
  const accepted: Array<{ point: GPSPoint; index: number }> = [];

  inputs.forEach((point, index) => {
    if (!Number.isFinite(point.timestamp.getTime())) {
      issues.push({ index, code: 'invalid_timestamp', severity: 'error', message: 'Point was excluded because its timestamp is invalid.' });
      return;
    }

    let confidence = point.confidence;
    if (point.accuracy === undefined) {
      confidence *= 0.85;
      issues.push({ index, code: 'missing_accuracy', severity: 'info', message: 'Point has no reported accuracy; its confidence was reduced.' });
    } else if (point.accuracy > 1_000) {
      confidence *= 0.5;
      issues.push({ index, code: 'low_accuracy', severity: 'warning', message: 'Point accuracy exceeds one kilometer; its confidence was reduced.' });
    }

    accepted.push({ point: { ...point, confidence }, index });
  });

  accepted.sort((first, second) => first.point.timestamp.getTime() - second.point.timestamp.getTime());
  const qualityPoints: GPSPoint[] = [];

  for (const candidate of accepted) {
    const previous = qualityPoints[qualityPoints.length - 1];
    if (!previous) {
      qualityPoints.push(candidate.point);
      continue;
    }

    const elapsedSeconds = (candidate.point.timestamp.getTime() - previous.timestamp.getTime()) / 1_000;
    const distance = distanceMeters(previous, candidate.point);
    if (elapsedSeconds === 0 && distance <= DUPLICATE_DISTANCE_METERS) {
      issues.push({ index: candidate.index, code: 'duplicate_point', severity: 'info', message: 'Duplicate coordinate and timestamp were excluded.' });
      continue;
    }

    if (elapsedSeconds > 0 && distance / elapsedSeconds > MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND) {
      candidate.point.confidence *= 0.5;
      issues.push({ index: candidate.index, code: 'implausible_transition', severity: 'warning', message: 'An unusually fast transition reduced this point’s confidence.' });
    }

    qualityPoints.push(candidate.point);
  }

  return {
    points: qualityPoints,
    issues,
    acceptedCount: qualityPoints.length,
    rejectedCount: inputs.length - qualityPoints.length,
  };
}