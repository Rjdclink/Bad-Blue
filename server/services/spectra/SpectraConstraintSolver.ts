import type { GPSPoint } from '../geoconsole/types';

export type SpectraConstraintKind =
  | 'coordinate'
  | 'range'
  | 'bearing'
  | 'range_difference'
  | 'region'
  | 'road'
  | 'terrain'
  | 'motion';

export interface SpectraSpatialConstraint {
  id: string;
  kind: SpectraConstraintKind;
  timestamp: Date;
  dependencyKey: string;
  weight: number;
  sigmaMeters: number;
  sourcePointIndex: number;
  target?: { latitude: number; longitude: number };
  anchor?: { latitude: number; longitude: number };
  anchorB?: { latitude: number; longitude: number };
  distanceMeters?: number;
  distanceDifferenceMeters?: number;
  bearingDegrees?: number;
  bearingSigmaDegrees?: number;
  radiusMeters?: number;
  roadPolyline?: Array<{ latitude: number; longitude: number }>;
}

export interface SpectraConstraintSolveResult {
  points: GPSPoint[];
  constraints: SpectraSpatialConstraint[];
  dependencyGraph: Record<string, string[]>;
  diagnostics: {
    independentDependencyCount: number;
    constraintCount: number;
    backwardSmoothingApplied: boolean;
    contradictoryConstraintCount: number;
    meanResidualMeters: number;
  };
}

const EARTH_RADIUS = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function finite(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function dependencyKey(point: GPSPoint): string {
  const metadata = point.metadata || {};
  const explicit = String(
    metadata.dependencyGroup
    ?? metadata.correlationDomain
    ?? point.correlationGroup
    ?? '',
  ).trim();
  if (explicit) return explicit;
  const provider = point.provenance?.provider || 'unknown';
  const record = point.provenance?.recordId || '';
  return record ? `${provider}:${record}` : `${point.source}:${provider}`;
}

function localMeters(
  latitude: number,
  longitude: number,
  originLatitude: number,
  originLongitude: number,
): { x: number; y: number } {
  const originLatRad = originLatitude * DEG_TO_RAD;
  return {
    x: (longitude - originLongitude) * DEG_TO_RAD * EARTH_RADIUS * Math.cos(originLatRad),
    y: (latitude - originLatitude) * DEG_TO_RAD * EARTH_RADIUS,
  };
}

function fromLocalMeters(
  x: number,
  y: number,
  originLatitude: number,
  originLongitude: number,
): { latitude: number; longitude: number } {
  const originLatRad = originLatitude * DEG_TO_RAD;
  return {
    latitude: originLatitude + (y / EARTH_RADIUS) * RAD_TO_DEG,
    longitude: originLongitude + (x / (EARTH_RADIUS * Math.max(1e-6, Math.cos(originLatRad)))) * RAD_TO_DEG,
  };
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const p1 = a.latitude * DEG_TO_RAD;
  const p2 = b.latitude * DEG_TO_RAD;
  const dp = (b.latitude - a.latitude) * DEG_TO_RAD;
  const dl = (b.longitude - a.longitude) * DEG_TO_RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function closestPointOnPolyline(
  point: { latitude: number; longitude: number },
  polyline: Array<{ latitude: number; longitude: number }>,
): { latitude: number; longitude: number; distanceMeters: number } | null {
  if (polyline.length < 2) return null;
  const origin = point;
  let best: { latitude: number; longitude: number; distanceMeters: number } | null = null;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = localMeters(polyline[i].latitude, polyline[i].longitude, origin.latitude, origin.longitude);
    const b = localMeters(polyline[i + 1].latitude, polyline[i + 1].longitude, origin.latitude, origin.longitude);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const denom = abx * abx + aby * aby;
    const t = denom <= 1e-9 ? 0 : clamp((-(a.x * abx + a.y * aby)) / denom, 0, 1);
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    const distanceMeters = Math.hypot(x, y);
    if (!best || distanceMeters < best.distanceMeters) {
      const geo = fromLocalMeters(x, y, origin.latitude, origin.longitude);
      best = { ...geo, distanceMeters };
    }
  }
  return best;
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseLatLng(value: unknown): { latitude: number; longitude: number } | null {
  const o = metadataObject(value);
  if (!o) return null;
  const latitude = finite(o.latitude ?? o.lat);
  const longitude = finite(o.longitude ?? o.lng ?? o.lon);
  if (
    latitude === undefined || longitude === undefined
    || latitude < -90 || latitude > 90
    || longitude < -180 || longitude > 180
  ) return null;
  return { latitude, longitude };
}

function normalizedWeight(point: GPSPoint, sigmaMeters: number): number {
  const confidence = clamp(Number(point.confidence) || 0, 0.01, 1);
  const kindPenalty =
    point.observationKind === 'predicted' ? 0.2 :
    point.observationKind === 'interpolated' ? 0.35 :
    point.observationKind === 'historical' ? 0.3 :
    point.observationKind === 'inferred' ? 0.65 :
    1;
  return confidence * kindPenalty / Math.max(1, sigmaMeters * sigmaMeters);
}

export function buildSpectraSpatialConstraints(points: GPSPoint[]): SpectraSpatialConstraint[] {
  const constraints: SpectraSpatialConstraint[] = [];

  points.forEach((point, sourcePointIndex) => {
    const dep = dependencyKey(point);
    const sigma = Math.max(0.25, finite(point.accuracy) ?? 250);
    constraints.push({
      id: `p:${sourcePointIndex}`,
      kind: 'coordinate',
      timestamp: point.timestamp,
      dependencyKey: dep,
      weight: normalizedWeight(point, sigma),
      sigmaMeters: sigma,
      sourcePointIndex,
      target: { latitude: point.latitude, longitude: point.longitude },
    });

    const metadata = point.metadata || {};

    const rawAnchors = Array.isArray(metadata.constraintAnchors)
      ? metadata.constraintAnchors
      : Array.isArray(metadata.anchors)
        ? metadata.anchors
        : [];

    rawAnchors.forEach((raw, anchorIndex) => {
      const o = metadataObject(raw);
      if (!o) return;
      const anchor = parseLatLng(o);
      if (!anchor) return;
      const distanceMeters = finite(o.distanceMeters ?? o.rangeMeters ?? o.rttDistanceMeters);
      const uncertainty = Math.max(0.1, finite(o.uncertaintyMeters ?? o.sigmaMeters) ?? sigma);
      if (distanceMeters !== undefined && distanceMeters >= 0) {
        constraints.push({
          id: `p:${sourcePointIndex}:range:${anchorIndex}`,
          kind: 'range',
          timestamp: point.timestamp,
          dependencyKey: String(o.dependencyKey || dep),
          weight: normalizedWeight(point, uncertainty),
          sigmaMeters: uncertainty,
          sourcePointIndex,
          anchor,
          distanceMeters,
        });
      }
      const bearingDegrees = finite(o.bearingDegrees ?? o.aoaDegrees ?? o.aodDegrees);
      if (bearingDegrees !== undefined) {
        const bearingSigmaDegrees = Math.max(0.5, finite(o.bearingUncertaintyDegrees ?? o.bearingSigmaDegrees) ?? 12);
        constraints.push({
          id: `p:${sourcePointIndex}:bearing:${anchorIndex}`,
          kind: 'bearing',
          timestamp: point.timestamp,
          dependencyKey: String(o.dependencyKey || dep),
          weight: normalizedWeight(point, Math.max(uncertainty, 1)),
          sigmaMeters: Math.max(uncertainty, 1),
          sourcePointIndex,
          anchor,
          bearingDegrees,
          bearingSigmaDegrees,
        });
      }
    });

    const tdoa = Array.isArray(metadata.tdoaConstraints) ? metadata.tdoaConstraints : [];
    tdoa.forEach((raw, index) => {
      const o = metadataObject(raw);
      if (!o) return;
      const anchor = parseLatLng(o.anchorA);
      const anchorB = parseLatLng(o.anchorB);
      const distanceDifferenceMeters = finite(o.distanceDifferenceMeters ?? o.rangeDifferenceMeters);
      if (!anchor || !anchorB || distanceDifferenceMeters === undefined) return;
      const uncertainty = Math.max(0.25, finite(o.uncertaintyMeters ?? o.sigmaMeters) ?? sigma);
      constraints.push({
        id: `p:${sourcePointIndex}:tdoa:${index}`,
        kind: 'range_difference',
        timestamp: point.timestamp,
        dependencyKey: String(o.dependencyKey || dep),
        weight: normalizedWeight(point, uncertainty),
        sigmaMeters: uncertainty,
        sourcePointIndex,
        anchor,
        anchorB,
        distanceDifferenceMeters,
      });
    });

    const regionCenter =
      parseLatLng(metadata.regionCenter)
      || parseLatLng(metadata.cellCenter)
      || parseLatLng(metadata.sectorCenter);
    const regionRadius = finite(
      metadata.regionRadiusMeters
      ?? metadata.cellRadiusMeters
      ?? metadata.sectorRadiusMeters
      ?? metadata.cellRangeMeters
    );
    if (regionCenter && regionRadius !== undefined && regionRadius > 0) {
      constraints.push({
        id: `p:${sourcePointIndex}:region`,
        kind: 'region',
        timestamp: point.timestamp,
        dependencyKey: dep,
        weight: normalizedWeight(point, Math.max(regionRadius / 2, sigma)),
        sigmaMeters: Math.max(regionRadius / 2, sigma),
        sourcePointIndex,
        target: regionCenter,
        radiusMeters: regionRadius,
      });
    }

    const roadRaw = Array.isArray(metadata.roadPolyline) ? metadata.roadPolyline : [];
    const roadPolyline = roadRaw.flatMap(value => {
      const parsed = parseLatLng(value);
      return parsed ? [parsed] : [];
    });
    if (roadPolyline.length >= 2) {
      constraints.push({
        id: `p:${sourcePointIndex}:road`,
        kind: 'road',
        timestamp: point.timestamp,
        dependencyKey: String(metadata.roadDependencyGroup || 'map:road'),
        weight: normalizedWeight(point, Math.max(1, finite(metadata.roadSnapSigmaMeters) ?? 8)),
        sigmaMeters: Math.max(1, finite(metadata.roadSnapSigmaMeters) ?? 8),
        sourcePointIndex,
        roadPolyline,
        radiusMeters: Math.max(1, finite(metadata.roadMaxOffsetMeters) ?? 35),
      });
    }

    const terrainCenter = parseLatLng(metadata.terrainAllowedCenter);
    const terrainRadius = finite(metadata.terrainAllowedRadiusMeters);
    if (terrainCenter && terrainRadius !== undefined && terrainRadius > 0) {
      constraints.push({
        id: `p:${sourcePointIndex}:terrain`,
        kind: 'terrain',
        timestamp: point.timestamp,
        dependencyKey: String(metadata.terrainDependencyGroup || 'map:terrain'),
        weight: normalizedWeight(point, Math.max(5, terrainRadius / 3)),
        sigmaMeters: Math.max(5, terrainRadius / 3),
        sourcePointIndex,
        target: terrainCenter,
        radiusMeters: terrainRadius,
      });
    }
  });

  return constraints;
}

function dependencyAdjustedWeights(constraints: SpectraSpatialConstraint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of constraints) counts.set(c.dependencyKey, (counts.get(c.dependencyKey) || 0) + 1);
  const result = new Map<string, number>();
  for (const c of constraints) {
    const count = counts.get(c.dependencyKey) || 1;
    result.set(c.id, c.weight / Math.sqrt(count));
  }
  return result;
}

function buildDependencyGraph(constraints: SpectraSpatialConstraint[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const c of constraints) {
    if (!graph[c.dependencyKey]) graph[c.dependencyKey] = [];
    graph[c.dependencyKey].push(c.id);
  }
  return graph;
}

function solveOnePoint(
  initial: GPSPoint,
  relevant: SpectraSpatialConstraint[],
  effectiveWeights: Map<string, number>,
): { point: GPSPoint; residuals: number[]; contradictions: number } {
  const origin = { latitude: initial.latitude, longitude: initial.longitude };
  let state = { x: 0, y: 0 };
  let contradictions = 0;
  const residuals: number[] = [];

  for (let iteration = 0; iteration < 10; iteration += 1) {
    let gx = 0;
    let gy = 0;
    let denom = 0;

    for (const c of relevant) {
      const w = effectiveWeights.get(c.id) || 0;
      if (!(w > 0)) continue;

      if (c.kind === 'coordinate' && c.target) {
        const t = localMeters(c.target.latitude, c.target.longitude, origin.latitude, origin.longitude);
        gx += (t.x - state.x) * w;
        gy += (t.y - state.y) * w;
        denom += w;
        continue;
      }

      if ((c.kind === 'range' || c.kind === 'bearing') && c.anchor) {
        const a = localMeters(c.anchor.latitude, c.anchor.longitude, origin.latitude, origin.longitude);
        const dx = state.x - a.x;
        const dy = state.y - a.y;
        const d = Math.max(0.1, Math.hypot(dx, dy));

        if (c.kind === 'range' && c.distanceMeters !== undefined) {
          const residual = d - c.distanceMeters;
          gx += (-residual * dx / d) * w;
          gy += (-residual * dy / d) * w;
          denom += w;
        } else if (c.kind === 'bearing' && c.bearingDegrees !== undefined) {
          const expected = ((c.bearingDegrees % 360) + 360) % 360;
          const observed = (Math.atan2(dx, dy) * RAD_TO_DEG + 360) % 360;
          let delta = observed - expected;
          while (delta > 180) delta -= 360;
          while (delta < -180) delta += 360;
          const targetAngle = expected * DEG_TO_RAD;
          const desiredX = a.x + Math.sin(targetAngle) * d;
          const desiredY = a.y + Math.cos(targetAngle) * d;
          const angularScale = clamp(Math.abs(delta) / Math.max(1, c.bearingSigmaDegrees || 12), 0.05, 4);
          gx += (desiredX - state.x) * w * angularScale;
          gy += (desiredY - state.y) * w * angularScale;
          denom += w * angularScale;
        }
        continue;
      }

      if (c.kind === 'range_difference' && c.anchor && c.anchorB && c.distanceDifferenceMeters !== undefined) {
        const a = localMeters(c.anchor.latitude, c.anchor.longitude, origin.latitude, origin.longitude);
        const b = localMeters(c.anchorB.latitude, c.anchorB.longitude, origin.latitude, origin.longitude);
        const dax = state.x - a.x;
        const day = state.y - a.y;
        const dbx = state.x - b.x;
        const dby = state.y - b.y;
        const da = Math.max(0.1, Math.hypot(dax, day));
        const db = Math.max(0.1, Math.hypot(dbx, dby));
        const residual = (da - db) - c.distanceDifferenceMeters;
        gx += -residual * ((dax / da) - (dbx / db)) * w;
        gy += -residual * ((day / da) - (dby / db)) * w;
        denom += w;
        continue;
      }

      if ((c.kind === 'region' || c.kind === 'terrain') && c.target && c.radiusMeters !== undefined) {
        const center = localMeters(c.target.latitude, c.target.longitude, origin.latitude, origin.longitude);
        const dx = state.x - center.x;
        const dy = state.y - center.y;
        const d = Math.max(0.1, Math.hypot(dx, dy));
        if (d > c.radiusMeters) {
          const excess = d - c.radiusMeters;
          gx += (-excess * dx / d) * w;
          gy += (-excess * dy / d) * w;
          denom += w;
        }
        continue;
      }

      if (c.kind === 'road' && c.roadPolyline?.length) {
        const geo = fromLocalMeters(state.x, state.y, origin.latitude, origin.longitude);
        const nearest = closestPointOnPolyline(geo, c.roadPolyline);
        if (nearest && nearest.distanceMeters > (c.radiusMeters ?? 35)) {
          const t = localMeters(nearest.latitude, nearest.longitude, origin.latitude, origin.longitude);
          gx += (t.x - state.x) * w;
          gy += (t.y - state.y) * w;
          denom += w;
        }
      }
    }

    if (denom <= 0) break;
    const stepScale = 0.55;
    state.x += (gx / denom) * stepScale;
    state.y += (gy / denom) * stepScale;
    if (Math.hypot(gx / denom, gy / denom) < 0.01) break;
  }

  const solvedGeo = fromLocalMeters(state.x, state.y, origin.latitude, origin.longitude);

  for (const c of relevant) {
    let residual = 0;
    let contradiction = false;

    if (c.kind === 'coordinate' && c.target) {
      residual = haversineMeters(solvedGeo, c.target);
    } else if (c.kind === 'range' && c.anchor && c.distanceMeters !== undefined) {
      residual = Math.abs(haversineMeters(solvedGeo, c.anchor) - c.distanceMeters);
    } else if (c.kind === 'bearing' && c.anchor && c.bearingDegrees !== undefined) {
      const anchorLocal = localMeters(
        c.anchor.latitude,
        c.anchor.longitude,
        solvedGeo.latitude,
        solvedGeo.longitude,
      );
      // Vector from anchor -> solved point is the negative of solved-origin
      // anchor coordinates. atan2(east, north) yields true-north bearing.
      const observed = (
        Math.atan2(-anchorLocal.x, -anchorLocal.y) * RAD_TO_DEG + 360
      ) % 360;
      const expected = ((c.bearingDegrees % 360) + 360) % 360;
      let angularError = observed - expected;
      while (angularError > 180) angularError -= 360;
      while (angularError < -180) angularError += 360;

      const rangeMeters = Math.max(0.1, haversineMeters(solvedGeo, c.anchor));
      // Chord distance at the observed range gives the bearing disagreement a
      // meter-domain residual without the 180-degree blind spot of sin(delta).
      residual = 2 * rangeMeters * Math.sin(
        Math.abs(angularError) * DEG_TO_RAD / 2,
      );
      contradiction = Math.abs(angularError) > Math.max(
        5,
        (c.bearingSigmaDegrees ?? 12) * 4,
      );
    } else if (c.kind === 'range_difference' && c.anchor && c.anchorB && c.distanceDifferenceMeters !== undefined) {
      residual = Math.abs(
        haversineMeters(solvedGeo, c.anchor)
        - haversineMeters(solvedGeo, c.anchorB)
        - c.distanceDifferenceMeters
      );
    } else if ((c.kind === 'region' || c.kind === 'terrain') && c.target && c.radiusMeters !== undefined) {
      residual = Math.max(0, haversineMeters(solvedGeo, c.target) - c.radiusMeters);
    } else if (c.kind === 'road' && c.roadPolyline?.length) {
      residual = closestPointOnPolyline(solvedGeo, c.roadPolyline)?.distanceMeters ?? 0;
    }

    residuals.push(residual);
    if (
      contradiction
      || (
        c.kind !== 'bearing'
        && residual > Math.max(10, c.sigmaMeters * 4)
      )
    ) {
      contradictions += 1;
    }
  }

  const independentKeys = new Set(relevant.map(c => c.dependencyKey));
  const information = [...independentKeys].reduce((sum, key) => {
    const best = relevant
      .filter(c => c.dependencyKey === key)
      .reduce((m, c) => Math.max(m, effectiveWeights.get(c.id) || 0), 0);
    return sum + best;
  }, 0);
  const residualRms = residuals.length
    ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length)
    : finite(initial.accuracy) ?? 250;
  const informationSigma = information > 0 ? Math.sqrt(1 / information) : finite(initial.accuracy) ?? 250;
  const solvedAccuracy = Math.max(0.25, informationSigma, residualRms * 0.5);
  const initialAccuracy = Math.max(0.25, finite(initial.accuracy) ?? solvedAccuracy);
  const finalAccuracy = contradictions > 0
    ? Math.max(initialAccuracy, solvedAccuracy)
    : independentKeys.size >= 2
      ? Math.min(initialAccuracy, solvedAccuracy)
      : Math.max(initialAccuracy, solvedAccuracy);
  const consistencyPenalty = 1 / (1 + contradictions);

  return {
    point: {
      ...initial,
      latitude: solvedGeo.latitude,
      longitude: solvedGeo.longitude,
      accuracy: finalAccuracy,
      confidence: Math.min(initial.confidence, clamp(initial.confidence * consistencyPenalty, 0, 1)),
      provenance: {
        ...(initial.provenance || {}),
        transformedBy: [
          ...(initial.provenance?.transformedBy || []),
          'spectra_universal_constraint_solver',
        ],
      },
      metadata: {
        ...(initial.metadata || {}),
        constraintSolver: {
          constraintCount: relevant.length,
          independentDependencyCount: independentKeys.size,
          residualRmsMeters: residualRms,
          contradictionCount: contradictions,
        },
      },
    },
    residuals,
    contradictions,
  };
}

function physicalSpeedLimit(point: GPSPoint): number {
  const metadata = point.metadata || {};
  const explicit = finite(metadata.maxPhysicalSpeedMps ?? metadata.motionMaxSpeedMps);
  if (explicit !== undefined && explicit > 0) return clamp(explicit, 0.2, 120);
  const mode = String(metadata.motionMode || metadata.segmentType || '').toLowerCase();
  if (mode.includes('walk')) return 3;
  if (mode.includes('bike')) return 15;
  if (mode.includes('drive') || point.source === 'vehicle_telemetry') return 70;
  return 55;
}

function smoothTrajectory(points: GPSPoint[]): { points: GPSPoint[]; applied: boolean } {
  if (points.length < 2) return { points, applied: false };
  const sorted = points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => a.point.timestamp.getTime() - b.point.timestamp.getTime());

  const forward = sorted.map(item => ({ ...item.point }));
  for (let i = 1; i < forward.length; i += 1) {
    const prev = forward[i - 1];
    const cur = forward[i];
    const dt = Math.max(0.001, (cur.timestamp.getTime() - prev.timestamp.getTime()) / 1000);
    const maxDistance = Math.max(1, physicalSpeedLimit(cur) * dt);
    const distance = haversineMeters(prev, cur);
    if (distance > maxDistance) {
      const origin = prev;
      const local = localMeters(cur.latitude, cur.longitude, origin.latitude, origin.longitude);
      const scale = maxDistance / Math.max(distance, 1e-6);
      const projected = fromLocalMeters(local.x * scale, local.y * scale, origin.latitude, origin.longitude);
      cur.latitude = projected.latitude;
      cur.longitude = projected.longitude;
      cur.accuracy = Math.max(cur.accuracy ?? 1, distance - maxDistance);
      cur.confidence = Math.min(cur.confidence, 0.75);
    }
  }

  for (let i = forward.length - 2; i >= 0; i -= 1) {
    const cur = forward[i];
    const next = forward[i + 1];
    const dt = Math.max(0.001, (next.timestamp.getTime() - cur.timestamp.getTime()) / 1000);
    const maxDistance = Math.max(1, physicalSpeedLimit(next) * dt);
    const distance = haversineMeters(cur, next);
    if (distance > maxDistance) {
      const local = localMeters(cur.latitude, cur.longitude, next.latitude, next.longitude);
      const scale = maxDistance / Math.max(distance, 1e-6);
      const projected = fromLocalMeters(local.x * scale, local.y * scale, next.latitude, next.longitude);
      cur.latitude = projected.latitude;
      cur.longitude = projected.longitude;
      cur.accuracy = Math.max(cur.accuracy ?? 1, distance - maxDistance);
      cur.confidence = Math.min(cur.confidence, 0.75);
    }

    if (i > 0) {
      const previous = forward[i - 1];
      const dtPrev = Math.max(0.001, (cur.timestamp.getTime() - previous.timestamp.getTime()) / 1000);
      const dtNext = Math.max(0.001, (next.timestamp.getTime() - cur.timestamp.getTime()) / 1000);
      if (dtPrev < 120 && dtNext < 120) {
        const p = localMeters(previous.latitude, previous.longitude, cur.latitude, cur.longitude);
        const n = localMeters(next.latitude, next.longitude, cur.latitude, cur.longitude);
        const predictedX = (p.x * dtNext + n.x * dtPrev) / (dtPrev + dtNext);
        const predictedY = (p.y * dtNext + n.y * dtPrev) / (dtPrev + dtNext);
        const blend = clamp(
          ((cur.accuracy ?? 50) / Math.max(1, (previous.accuracy ?? 50) + (next.accuracy ?? 50))),
          0.05,
          0.35,
        );
        const smoothed = fromLocalMeters(predictedX * blend, predictedY * blend, cur.latitude, cur.longitude);
        cur.latitude = smoothed.latitude;
        cur.longitude = smoothed.longitude;
      }
    }
  }

  const restored = points.map(point => ({ ...point }));
  sorted.forEach((item, sortedIndex) => {
    restored[item.index] = {
      ...forward[sortedIndex],
      provenance: {
        ...(forward[sortedIndex].provenance || {}),
        transformedBy: [
          ...(forward[sortedIndex].provenance?.transformedBy || []),
          'spectra_forward_backward_motion_smoother',
        ],
      },
      metadata: {
        ...(forward[sortedIndex].metadata || {}),
        trajectorySmoothing: 'forward_backward_physical_motion',
      },
    };
  });
  return { points: restored, applied: true };
}

export function solveSpectraConstraintLayer(points: GPSPoint[]): SpectraConstraintSolveResult {
  if (!points.length) {
    return {
      points: [],
      constraints: [],
      dependencyGraph: {},
      diagnostics: {
        independentDependencyCount: 0,
        constraintCount: 0,
        backwardSmoothingApplied: false,
        contradictoryConstraintCount: 0,
        meanResidualMeters: 0,
      },
    };
  }

  const constraints = buildSpectraSpatialConstraints(points);
  const dependencyGraph = buildDependencyGraph(constraints);
  const solved: GPSPoint[] = [];
  let contradictoryConstraintCount = 0;
  const allResiduals: number[] = [];

  points.forEach((point, index) => {
    const relevant = constraints.filter(c =>
      c.sourcePointIndex === index
      || Math.abs(c.timestamp.getTime() - point.timestamp.getTime()) <= 1_500
    );
    // Correlation penalties apply only to evidence that can influence this
    // timestamp. Distant history must not weaken an otherwise identical fix.
    const effectiveWeights = dependencyAdjustedWeights(relevant);
    const result = solveOnePoint(point, relevant, effectiveWeights);
    solved.push(result.point);
    contradictoryConstraintCount += result.contradictions;
    allResiduals.push(...result.residuals);
  });

  const smoothed = smoothTrajectory(solved);
  const meanResidualMeters = allResiduals.length
    ? allResiduals.reduce((sum, value) => sum + value, 0) / allResiduals.length
    : 0;

  return {
    points: smoothed.points,
    constraints,
    dependencyGraph,
    diagnostics: {
      independentDependencyCount: Object.keys(dependencyGraph).length,
      constraintCount: constraints.length,
      backwardSmoothingApplied: smoothed.applied,
      contradictoryConstraintCount,
      meanResidualMeters,
    },
  };
}
