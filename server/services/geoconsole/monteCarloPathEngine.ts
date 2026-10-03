/**
 * Monte Carlo Path Interpolation Engine
 * 
 * Generates probabilistic motion paths between known location points
 * Uses Monte Carlo simulation for realistic trajectory reconstruction
 * Produces weather-radar-style probability heatmaps
 * 
 * Performance optimizations:
 * - Path caching with LRU eviction
 * - Pre-computed trigonometric values
 * - Parallel simulation batches
 * - Early termination for converged paths
 */

import {
  GPSPoint,
  MonteCarloConfig,
  InterpolatedPath,
  ProbabilityHeatmap,
  MotionTrail,
  TrailPoint,
  TrailSegment,
  StopPoint,
  BoundingBox,
} from './types';
import { createLogger } from '../../logger';
import { randomUUID } from 'crypto';

const log = createLogger('MonteCarloPathEngine');

// Earth radius in meters
const EARTH_RADIUS = 6371000;

// Pre-computed conversion factors
const DEG_TO_RAD = Math.PI / 180;

// Default Monte Carlo configuration
const DEFAULT_CONFIG: MonteCarloConfig = {
  iterations: 1000,
  stepSize: 10, // meters
  maxSpeed: 30, // m/s (~67 mph for driving)
  accelerationVariance: 2, // m/s²
  directionVariance: 30, // degrees
  terrainAwareness: false,
  roadNetworkConstraint: false,
  probabilityThreshold: 0.01,
};

// Speed thresholds for activity classification
const SPEED_THRESHOLDS = {
  stationary: 0.5, // m/s
  walking: 2.0, // m/s (~4.5 mph)
  running: 5.0, // m/s (~11 mph)
  cycling: 10.0, // m/s (~22 mph)
  driving: 30.0, // m/s (~67 mph)
};

// Cache configuration
const MAX_PATH_CACHE_SIZE = 100;
const MAX_SIMULATION_STEPS = 240;
const MAX_HEATMAP_AXIS_CELLS = 512;
const MIN_HEATMAP_RESOLUTION_METERS = 20;
const OPERATOR_TRAIL_WINDOW_MS = 60 * 60 * 1000;

export interface FuturecastMotionContext {
  observedAt?: Date;
  confidence: number;
  averageVehicleSpeedMps?: number;
  dominantHeadingDegrees?: number;
  congestionRatio?: number;
  distanceMeters?: number;
}

/**
 * Monte Carlo Path Interpolation Engine
 */
export class MonteCarloPathEngine {
  private config: MonteCarloConfig;
  private pathCache: Map<string, InterpolatedPath> = new Map();
  private cacheOrder: string[] = []; // LRU tracking

  constructor(config?: Partial<MonteCarloConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    log.info('MonteCarloPathEngine initialized', this.config);
  }

  /**
   * Clear path cache to free memory
   */
  clearCache(): void {
    this.pathCache.clear();
    this.cacheOrder = [];
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(key: string, path: InterpolatedPath): void {
    if (this.pathCache.has(key)) {
      this.cacheOrder = this.cacheOrder.filter(existing => existing !== key);
    } else if (this.pathCache.size >= MAX_PATH_CACHE_SIZE) {
      const oldest = this.cacheOrder.shift();
      if (oldest) this.pathCache.delete(oldest);
    }

    this.pathCache.set(key, path);
    this.cacheOrder.push(key);
  }

  /**
   * Interpolate path between two points using Monte Carlo simulation
   * Uses caching to avoid recomputation for identical inputs
   */
  async interpolatePath(
    startPoint: GPSPoint,
    endPoint: GPSPoint,
    options?: Partial<MonteCarloConfig>
  ): Promise<InterpolatedPath> {
    const config = { ...this.config, ...options };
    const cacheKey = this.getCacheKey(startPoint, endPoint, config);
    
    // Check cache first
    const cached = this.pathCache.get(cacheKey);
    if (cached) {
      // True LRU: a hit refreshes recency instead of leaving hot entries at
      // the front of the eviction queue.
      this.cacheOrder = this.cacheOrder.filter(key => key !== cacheKey);
      this.cacheOrder.push(cacheKey);
      log.debug('Cache hit for path interpolation', { cacheKey });
      return cached;
    }
    
    const startTime = Date.now();
    const pathId = randomUUID();

    log.info('Starting path interpolation', {
      pathId,
      start: `${startPoint.latitude.toFixed(6)},${startPoint.longitude.toFixed(6)}`,
      end: `${endPoint.latitude.toFixed(6)},${endPoint.longitude.toFixed(6)}`,
      iterations: config.iterations,
    });

    // Calculate direct distance and time
    const directDistance = this.haversineDistance(
      startPoint.latitude, startPoint.longitude,
      endPoint.latitude, endPoint.longitude
    );
    
    const timeDelta = endPoint.timestamp.getTime() - startPoint.timestamp.getTime();

    // Determine if Monte Carlo is needed or if linear interpolation suffices
    if (directDistance < 50 || timeDelta < 60000) {
      // Short distance/time - use linear interpolation
      const linearPath = this.linearInterpolation(startPoint, endPoint, pathId);
      this.addToCache(cacheKey, linearPath);
      return linearPath;
    }

    // Run Monte Carlo simulation
    const simulations = this.runSimulations(startPoint, endPoint, config);
    
    // Build probability heatmap
    const heatmap = this.buildProbabilityHeatmap(simulations, startPoint, endPoint);
    
    // Extract most likely path
    const interpolatedPoints = this.extractMostLikelyPath(
      simulations,
      heatmap,
      startPoint,
      endPoint
    );

    const path: InterpolatedPath = {
      id: pathId,
      startPoint,
      endPoint,
      interpolatedPoints,
      probabilityDistribution: heatmap,
      confidence: this.calculatePathConfidence(simulations, interpolatedPoints),
      method: 'monte_carlo',
      metadata: {
        iterations: simulations.length,
        computeTime: Date.now() - startTime,
        pathLength: this.calculatePathLength(interpolatedPoints),
        estimatedDuration: timeDelta / 1000,
      },
    };

    // Cache the result using LRU cache
    this.addToCache(cacheKey, path);

    log.info('Path interpolation complete', {
      pathId,
      pointCount: interpolatedPoints.length,
      confidence: path.confidence.toFixed(3),
      computeTime: path.metadata.computeTime,
    });

    return path;
  }

  /**
   * Run Monte Carlo simulations
   */
  private seededRandom(seedText: string): () => number {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      seed ^= seedText.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    return () => {
      seed += 0x6D2B79F5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Run bounded, reproducible Monte Carlo simulations. Compute is adaptive so a
   * long evidence gap cannot allocate millions of intermediate points.
   */
  private runSimulations(
    start: GPSPoint,
    end: GPSPoint,
    config: MonteCarloConfig
  ): GPSPoint[][] {
    const timeDeltaSeconds = Math.max(
      1,
      (end.timestamp.getTime() - start.timestamp.getTime()) / 1000
    );
    const directDistance = this.haversineDistance(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude
    );

    const spatialSteps = Math.ceil(directDistance / Math.max(5, config.stepSize));
    const temporalSteps = Math.ceil(timeDeltaSeconds / 15);
    const steps = Math.max(
      4,
      Math.min(MAX_SIMULATION_STEPS, Math.max(spatialSteps, temporalSteps))
    );
    const iterations = Math.max(50, Math.min(1000, Math.floor(config.iterations)));
    const seedBase = this.getCacheKey(start, end, config);

    const simulations: GPSPoint[][] = [];
    for (let i = 0; i < iterations; i++) {
      const random = this.seededRandom(`${seedBase}:${i}`);
      simulations.push(this.simulateSinglePath(start, end, steps, config, random));
    }

    return simulations;
  }

  /**
   * Simulate one reconstruction hypothesis between two known observations.
   */
  private simulateSinglePath(
    start: GPSPoint,
    end: GPSPoint,
    steps: number,
    config: MonteCarloConfig,
    random: () => number
  ): GPSPoint[] {
    const path: GPSPoint[] = [start];
    const timeDelta = Math.max(1, end.timestamp.getTime() - start.timestamp.getTime());
    const timeStep = timeDelta / steps;
    const directDistance = this.haversineDistance(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude
    );
    const observedSpeed = directDistance / (timeDelta / 1000);

    let currentLat = start.latitude;
    let currentLng = start.longitude;
    let currentHeading = this.calculateBearing(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude
    );
    let currentSpeed = Math.max(
      0.1,
      Math.min(config.maxSpeed, Number.isFinite(observedSpeed) ? observedSpeed : config.maxSpeed * 0.25)
    );

    const endpointConfidence = Math.max(
      0.05,
      Math.min(1, Math.min(start.confidence ?? 0.5, end.confidence ?? 0.5))
    );
    const gapHours = timeDelta / 3_600_000;
    const gapPenalty = Math.exp(-0.35 * gapHours);

    for (let step = 1; step < steps; step++) {
      const targetBearing = this.calculateBearing(
        currentLat,
        currentLng,
        end.latitude,
        end.longitude
      );

      const headingDiff = this.normalizeAngle(targetBearing - currentHeading);
      const blendFactor = 0.35 + random() * 0.35;
      currentHeading = (currentHeading + headingDiff * blendFactor + 360) % 360;
      currentHeading = (
        currentHeading +
        (random() - 0.5) * config.directionVariance +
        360
      ) % 360;

      const speedChange = (random() - 0.5) * config.accelerationVariance;
      currentSpeed = Math.max(0.05, Math.min(config.maxSpeed, currentSpeed + speedChange));

      const distance = currentSpeed * (timeStep / 1000);
      const newPos = this.movePoint(currentLat, currentLng, currentHeading, distance);
      currentLat = newPos.lat;
      currentLng = newPos.lng;

      const progress = step / steps;
      const midpointPenalty = 1 - 0.45 * Math.sin(Math.PI * progress);
      const confidence = Math.max(
        0.05,
        Math.min(0.8, endpointConfidence * gapPenalty * midpointPenalty * 0.75)
      );
      const accuracy = Math.max(
        start.accuracy ?? 25,
        end.accuracy ?? 25,
        directDistance * 0.08 * Math.sin(Math.PI * progress)
      );

      path.push({
        latitude: currentLat,
        longitude: currentLng,
        accuracy,
        timestamp: new Date(start.timestamp.getTime() + step * timeStep),
        receivedAt: new Date(),
        source: 'interpolated',
        confidence,
        observationKind: 'interpolated',
        correlationGroup: 'interpolation:monte_carlo',
        provenance: {
          provider: 'canonical_geoconsole_interpolator',
          transformedBy: ['bounded_seeded_monte_carlo'],
        },
        metadata: {
          interpolation: true,
          method: 'bounded_seeded_monte_carlo',
          progress,
        },
      });
    }

    path.push(end);
    return path;
  }

  /**
   * Build probability heatmap from simulations
   */
  private buildProbabilityHeatmap(
    simulations: GPSPoint[][],
    start: GPSPoint,
    end: GPSPoint
  ): ProbabilityHeatmap {
    const bounds = this.calculateBounds(simulations, start, end);
    const rawLatRange = Math.abs(bounds.north - bounds.south);
    const rawLngRange = Math.abs(bounds.east - bounds.west);
    const latRange = Math.max(rawLatRange, 1e-9);
    const lngRange = Math.max(rawLngRange, 1e-9);

    const latMeters = Math.max(1, rawLatRange * 111_000);
    const lngMeters = Math.max(
      1,
      rawLngRange * 111_000 * Math.max(0.05, Math.abs(Math.cos(start.latitude * DEG_TO_RAD)))
    );
    const resolution = Math.max(
      MIN_HEATMAP_RESOLUTION_METERS,
      Math.ceil(latMeters / MAX_HEATMAP_AXIS_CELLS),
      Math.ceil(lngMeters / MAX_HEATMAP_AXIS_CELLS)
    );
    const latCells = Math.max(1, Math.min(MAX_HEATMAP_AXIS_CELLS, Math.ceil(latMeters / resolution)));
    const lngCells = Math.max(1, Math.min(MAX_HEATMAP_AXIS_CELLS, Math.ceil(lngMeters / resolution)));

    const grid: number[][] = Array.from(
      { length: latCells },
      () => Array(lngCells).fill(0)
    );

    let maxCount = 0;
    let peakLat = start.latitude;
    let peakLng = start.longitude;
    let totalVisits = 0;

    for (const path of simulations) {
      for (const point of path) {
        const latIdx = latCells === 1
          ? 0
          : Math.max(0, Math.min(latCells - 1,
              Math.floor((point.latitude - bounds.south) / latRange * latCells)));
        const pointLongitude = this.unwrapLongitude(point.longitude, start.longitude);
        const lngIdx = lngCells === 1
          ? 0
          : Math.max(0, Math.min(lngCells - 1,
              Math.floor((pointLongitude - bounds.west) / lngRange * lngCells)));

        grid[latIdx][lngIdx]++;
        totalVisits++;
        if (grid[latIdx][lngIdx] > maxCount) {
          maxCount = grid[latIdx][lngIdx];
          peakLat = latCells === 1
            ? (bounds.north + bounds.south) / 2
            : bounds.south + (latIdx + 0.5) * latRange / latCells;
          const peakLongitudeUnwrapped = lngCells === 1
            ? (bounds.east + bounds.west) / 2
            : bounds.west + (lngIdx + 0.5) * lngRange / lngCells;
          peakLng = this.normalizeLongitude(peakLongitudeUnwrapped);
        }
      }
    }

    const denominator = Math.max(1, totalVisits);
    for (let i = 0; i < latCells; i++) {
      for (let j = 0; j < lngCells; j++) {
        grid[i][j] /= denominator;
      }
    }

    return {
      bounds,
      resolution,
      grid,
      peakProbability: {
        lat: peakLat,
        lng: peakLng,
        value: maxCount / denominator,
      },
    };
  }

  /**
   * Extract most likely path from simulations
   */
  private extractMostLikelyPath(
    simulations: GPSPoint[][],
    heatmap: ProbabilityHeatmap,
    start: GPSPoint,
    end: GPSPoint
  ): GPSPoint[] {
    // Use the path that best follows the probability heatmap
    let bestPath = simulations[0];
    let bestScore = 0;
    
    for (const path of simulations) {
      const score = this.scorePath(path, heatmap);
      if (score > bestScore) {
        bestScore = score;
        bestPath = path;
      }
    }
    
    // Smooth the best path
    return this.smoothPath(bestPath);
  }

  /**
   * Score a path based on probability heatmap
   */
  private scorePath(path: GPSPoint[], heatmap: ProbabilityHeatmap): number {
    let score = 0;
    const { bounds, grid } = heatmap;
    const latRange = Math.max(Math.abs(bounds.north - bounds.south), 1e-9);
    const lngRange = Math.max(Math.abs(bounds.east - bounds.west), 1e-9);
    const latCells = grid.length;
    const lngCells = grid[0]?.length || 1;
    
    for (const point of path) {
      const latIdx = Math.floor((point.latitude - bounds.south) / latRange * (latCells - 1));
      const referenceLongitude = (bounds.west + bounds.east) / 2;
      const pointLongitude = this.unwrapLongitude(point.longitude, referenceLongitude);
      const lngIdx = Math.floor((pointLongitude - bounds.west) / lngRange * (lngCells - 1));
      
      if (latIdx >= 0 && latIdx < latCells && lngIdx >= 0 && lngIdx < lngCells) {
        score += grid[latIdx][lngIdx];
      }
    }
    
    return path.length > 0 ? score / path.length : 0;
  }

  /**
   * Smooth path using moving average
   */
  private smoothPath(path: GPSPoint[]): GPSPoint[] {
    if (path.length < 5) return path;
    
    const smoothed: GPSPoint[] = [path[0]];
    const windowSize = 3;
    
    for (let i = 1; i < path.length - 1; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(path.length, i + windowSize + 1);
      const window = path.slice(start, end);
      
      const avgLat = window.reduce((sum, p) => sum + p.latitude, 0) / window.length;
      const referenceLongitude = path[i].longitude;
      const avgLngUnwrapped =
        window.reduce(
          (sum, p) => sum + this.unwrapLongitude(p.longitude, referenceLongitude),
          0,
        ) / window.length;

      smoothed.push({
        ...path[i],
        latitude: avgLat,
        longitude: this.normalizeLongitude(avgLngUnwrapped),
      });
    }
    
    smoothed.push(path[path.length - 1]);
    return smoothed;
  }

  private normalizeLongitude(longitude: number): number {
    let normalized = longitude;
    while (normalized > 180) normalized -= 360;
    while (normalized <= -180) normalized += 360;
    return normalized;
  }

  private unwrapLongitude(longitude: number, reference: number): number {
    let unwrapped = longitude;
    while (unwrapped - reference > 180) unwrapped -= 360;
    while (unwrapped - reference < -180) unwrapped += 360;
    return unwrapped;
  }

  /**
   * Linear interpolation for short distances
   */
  private linearInterpolation(
    start: GPSPoint,
    end: GPSPoint,
    pathId: string
  ): InterpolatedPath {
    const points: GPSPoint[] = [start];
    const numSteps = 10;
    const timeDelta = Math.max(1, end.timestamp.getTime() - start.timestamp.getTime());
    const directDistance = this.haversineDistance(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude
    );
    const endpointConfidence = Math.max(
      0.05,
      Math.min(1, Math.min(start.confidence ?? 0.5, end.confidence ?? 0.5))
    );
    const gapHours = timeDelta / 3_600_000;
    const pathConfidence = Math.max(
      0.05,
      Math.min(0.85, endpointConfidence * Math.exp(-0.45 * gapHours) * 0.75)
    );

    const endLongitudeUnwrapped = this.unwrapLongitude(end.longitude, start.longitude);

    for (let i = 1; i < numSteps; i++) {
      const progress = i / numSteps;
      points.push({
        latitude: start.latitude + (end.latitude - start.latitude) * progress,
        longitude: this.normalizeLongitude(
          start.longitude + (endLongitudeUnwrapped - start.longitude) * progress
        ),
        accuracy: Math.max(
          start.accuracy ?? 25,
          end.accuracy ?? 25,
          directDistance * 0.05 * Math.sin(Math.PI * progress)
        ),
        timestamp: new Date(start.timestamp.getTime() + timeDelta * progress),
        receivedAt: new Date(),
        source: 'interpolated',
        confidence: Math.max(0.05, pathConfidence * (1 - 0.25 * Math.sin(Math.PI * progress))),
        observationKind: 'interpolated',
        correlationGroup: 'interpolation:linear',
        provenance: {
          provider: 'canonical_geoconsole_interpolator',
          transformedBy: ['linear_interpolation'],
        },
        metadata: {
          interpolation: true,
          method: 'linear',
          progress,
        },
      });
    }

    points.push(end);
    const bounds = this.calculateBoundsFromPoints(points);

    return {
      id: pathId,
      startPoint: start,
      endPoint: end,
      interpolatedPoints: points,
      probabilityDistribution: {
        bounds,
        resolution: Math.max(10, Math.ceil(directDistance / 64)),
        grid: [[1]],
        peakProbability: {
          lat: (start.latitude + end.latitude) / 2,
          lng: this.normalizeLongitude(
            (start.longitude + endLongitudeUnwrapped) / 2
          ),
          value: pathConfidence,
        },
      },
      confidence: pathConfidence,
      method: 'linear',
      metadata: {
        iterations: 1,
        computeTime: 1,
        pathLength: directDistance,
        estimatedDuration: timeDelta / 1000,
      },
    };
  }

  /**
   * Generate complete motion trail from points
   */
  async generateMotionTrail(points: GPSPoint[]): Promise<MotionTrail> {
    if (points.length === 0) {
      throw new Error('At least 1 point required for motion trail');
    }

    const trailId = randomUUID();
    const sortedPoints = [...points].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const latestEventTime = sortedPoints[sortedPoints.length - 1].timestamp.getTime();

    const trailPoints: TrailPoint[] = [];
    const segments: TrailSegment[] = [];
    const stops: StopPoint[] = [];
    let totalDistance = 0;
    let supportedDuration = 0;
    let currentSegmentStart = 0;
    let currentSegmentType: TrailSegment['segmentType'] = 'unknown';
    let activeStopIndex: number | null = null;

    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      let speed = 0;
      let heading = 0;
      const gapBreak = i > 0 && Number(point.metadata?.gapBeforeSeconds || 0) > 0;

      if (gapBreak) {
        if (activeStopIndex !== null && i > 0) {
          const stop = stops[activeStopIndex];
          const departure = sortedPoints[i - 1].timestamp;
          stop.departureTime = departure;
          stop.duration = Math.max(
            0,
            (departure.getTime() - stop.arrivalTime.getTime()) / 1000,
          );
          activeStopIndex = null;
        }

        if (i - 1 > currentSegmentStart) {
          segments.push(this.createSegment(
            sortedPoints,
            currentSegmentStart,
            i - 1,
            currentSegmentType
          ));
        }
        currentSegmentStart = i;
        currentSegmentType = 'unknown';
      } else if (i > 0) {
        const prevPoint = sortedPoints[i - 1];
        const distance = this.haversineDistance(
          prevPoint.latitude,
          prevPoint.longitude,
          point.latitude,
          point.longitude
        );
        const timeDelta = (point.timestamp.getTime() - prevPoint.timestamp.getTime()) / 1000;

        speed = timeDelta > 0 ? distance / timeDelta : 0;
        heading = this.calculateBearing(
          prevPoint.latitude,
          prevPoint.longitude,
          point.latitude,
          point.longitude
        );
        totalDistance += distance;
        if (timeDelta > 0) supportedDuration += timeDelta;

        const newType = this.classifyActivity(speed);
        if (currentSegmentType === 'unknown') {
          currentSegmentType = newType;
        } else if (newType !== currentSegmentType) {
          if (i - 1 > currentSegmentStart) {
            segments.push(this.createSegment(
              sortedPoints,
              currentSegmentStart,
              i - 1,
              currentSegmentType
            ));
          }
          currentSegmentStart = Math.max(0, i - 1);
          currentSegmentType = newType;
        }

        if (speed < SPEED_THRESHOLDS.stationary) {
          if (activeStopIndex === null) {
            stops.push({
              position: point,
              arrivalTime: point.timestamp,
              duration: 0,
            });
            activeStopIndex = stops.length - 1;
          }
        } else if (activeStopIndex !== null) {
          const stop = stops[activeStopIndex];
          // The previous observation is the last evidence still consistent with
          // being stopped. Do not count the subsequent travel interval as dwell.
          const departure = prevPoint.timestamp;
          stop.departureTime = departure;
          stop.duration = Math.max(
            0,
            (departure.getTime() - stop.arrivalTime.getTime()) / 1000,
          );
          activeStopIndex = null;
        }
      }

      const age = Math.max(0, latestEventTime - point.timestamp.getTime());
      const opacity = Math.max(0.1, 1 - age / OPERATOR_TRAIL_WINDOW_MS);

      const hasSupportedVelocity = i > 0 && !gapBreak;
      trailPoints.push({
        position: point,
        velocity: hasSupportedVelocity ? { speed, heading } : undefined,
        interpolated:
          point.observationKind === 'interpolated' ||
          point.source === 'interpolated',
        opacity,
        color: hasSupportedVelocity ? this.getSpeedColor(speed) : undefined,
      });
    }

    if (sortedPoints.length - 1 > currentSegmentStart) {
      segments.push(this.createSegment(
        sortedPoints,
        currentSegmentStart,
        sortedPoints.length - 1,
        currentSegmentType
      ));
    }

    if (activeStopIndex !== null) {
      const stop = stops[activeStopIndex];
      const lastEvidenceTime = sortedPoints[sortedPoints.length - 1].timestamp;
      stop.duration = Math.max(
        0,
        (lastEvidenceTime.getTime() - stop.arrivalTime.getTime()) / 1000,
      );
    }

    const duration =
      (sortedPoints[sortedPoints.length - 1].timestamp.getTime() -
       sortedPoints[0].timestamp.getTime()) / 1000;

    return {
      id: trailId,
      points: trailPoints,
      startTime: sortedPoints[0].timestamp,
      endTime: sortedPoints[sortedPoints.length - 1].timestamp,
      totalDistance,
      averageSpeed: supportedDuration > 0 ? totalDistance / supportedDuration : 0,
      maxSpeed: Math.max(0, ...trailPoints.map(point => point.velocity?.speed || 0)),
      stops,
      segments,
    };
  }

  /**
   * Generate futurecast prediction
   */
  async generateFuturecast(
    recentPoints: GPSPoint[],
    hours: number = 1,
    motionContext: FuturecastMotionContext[] = [],
  ): Promise<GPSPoint[]> {
    if (recentPoints.length < 3) return [];

    const usable = recentPoints
      .filter(point =>
        Number.isFinite(point.timestamp.getTime()) &&
        point.observationKind !== 'predicted' &&
        point.source !== 'predicted'
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(-12);
    if (usable.length < 3) return [];

    let totalWeight = 0;
    let weightedSpeed = 0;
    let headingX = 0;
    let headingY = 0;
    const maxPlausibleSpeed = Math.max(80, this.config.maxSpeed * 3);

    const kindWeight = (point: GPSPoint): number => {
      switch (point.observationKind) {
        case 'observed': return 1;
        case 'inferred': return 0.65;
        case 'interpolated': return 0.45;
        case 'historical': return 0.35;
        default: return point.source === 'interpolated' ? 0.45 : 0.8;
      }
    };

    for (let i = 1; i < usable.length; i++) {
      const older = usable[i - 1];
      const newer = usable[i];
      const elapsedSeconds = (newer.timestamp.getTime() - older.timestamp.getTime()) / 1000;
      if (elapsedSeconds <= 0) continue;

      const speed = this.calculateSpeed(older, newer);
      if (!Number.isFinite(speed) || speed > maxPlausibleSpeed) continue;

      const heading = this.calculateBearing(
        older.latitude,
        older.longitude,
        newer.latitude,
        newer.longitude
      );
      const evidenceConfidence = Math.sqrt(
        Math.max(0.01, Math.min(1, older.confidence ?? 0.5)) *
        Math.max(0.01, Math.min(1, newer.confidence ?? 0.5))
      );
      const sourceWeight = Math.min(kindWeight(older), kindWeight(newer));
      const recencyWeight = i / Math.max(1, usable.length - 1);
      const weight = evidenceConfidence * sourceWeight * (0.35 + 0.65 * recencyWeight);
      if (weight <= 0) continue;

      totalWeight += weight;
      weightedSpeed += speed * weight;
      headingX += Math.cos(heading * DEG_TO_RAD) * weight;
      headingY += Math.sin(heading * DEG_TO_RAD) * weight;
    }

    if (totalWeight <= 0) return [];

    const evidenceSpeed = Math.max(0, Math.min(maxPlausibleSpeed, weightedSpeed / totalWeight));
    const evidenceHeading = (Math.atan2(headingY, headingX) * 180 / Math.PI + 360) % 360;
    const latest = usable[usable.length - 1];

    // When the canonical hidden-state estimator has already solved velocity,
    // preserve that posterior as an additional motion constraint instead of
    // throwing it away and reconstructing velocity only from point-to-point
    // deltas. The blend remains bounded so raw temporal evidence still matters.
    const latestStateEstimator = latest.metadata?.stateEstimator;
    const stateRecord = latestStateEstimator && typeof latestStateEstimator === 'object'
      ? latestStateEstimator as Record<string, unknown>
      : null;
    const stateSpeedRaw = Number(stateRecord?.speedMps);
    const stateHeadingRaw = Number(stateRecord?.headingDegrees);
    const stateRadius95 = Number(stateRecord?.confidenceRadius95Meters);
    const hasStateVelocity =
      Number.isFinite(stateSpeedRaw)
      && stateSpeedRaw >= 0
      && stateSpeedRaw <= maxPlausibleSpeed
      && Number.isFinite(stateHeadingRaw)
      && stateHeadingRaw >= 0
      && stateHeadingRaw <= 360;

    const radiusTrust = Number.isFinite(stateRadius95) && stateRadius95 > 0
      ? Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, stateRadius95)) / 5))
      : 0.5;
    const stateEstimatorInfluence = hasStateVelocity
      ? Math.max(0.2, Math.min(0.7, 0.25 + 0.45 * radiusTrust))
      : 0;

    let avgSpeed = evidenceSpeed;
    let avgHeading = evidenceHeading;
    if (hasStateVelocity) {
      avgSpeed = Math.max(
        0,
        Math.min(
          maxPlausibleSpeed,
          evidenceSpeed * (1 - stateEstimatorInfluence)
            + stateSpeedRaw * stateEstimatorInfluence,
        ),
      );

      const evidenceRadians = evidenceHeading * DEG_TO_RAD;
      const stateRadians = stateHeadingRaw * DEG_TO_RAD;
      avgHeading = (
        Math.atan2(
          Math.sin(evidenceRadians) * (1 - stateEstimatorInfluence)
            + Math.sin(stateRadians) * stateEstimatorInfluence,
          Math.cos(evidenceRadians) * (1 - stateEstimatorInfluence)
            + Math.cos(stateRadians) * stateEstimatorInfluence,
        ) * 180 / Math.PI + 360
      ) % 360;
    }

    const vehicleClass = (point: GPSPoint): boolean => {
      if (point.source === 'vehicle_telemetry') return true;
      const objectClass = String(
        point.metadata?.objectClass
        ?? point.metadata?.trackClass
        ?? point.metadata?.motionClass
        ?? ''
      ).toLowerCase();
      return /^(?:vehicle|car|truck|bus|motorcycle|motorbike|van|suv)$/.test(objectClass);
    };
    const likelyVehicleMotion = usable.some(vehicleClass);

    const contextRows = likelyVehicleMotion
      ? motionContext.filter(context =>
          Number.isFinite(context.confidence)
          && context.confidence > 0
          && (
            Number.isFinite(context.averageVehicleSpeedMps)
            || Number.isFinite(context.dominantHeadingDegrees)
          )
        )
      : [];

    let motionContextInfluence = 0;
    let motionContextSpeed: number | undefined;
    let motionContextHeading: number | undefined;
    let motionContextCongestion: number | undefined;

    if (contextRows.length) {
      let contextWeight = 0;
      let contextSpeedWeight = 0;
      let contextSpeedSum = 0;
      let contextHeadingX = 0;
      let contextHeadingY = 0;
      let congestionWeight = 0;
      let congestionSum = 0;
      const nowMs = Date.now();

      for (const context of contextRows) {
        const ageMinutes = context.observedAt instanceof Date
          ? Math.max(0, (nowMs - context.observedAt.getTime()) / 60_000)
          : 0;
        const recency = Math.exp(-ageMinutes / 30);
        const proximity = Number.isFinite(context.distanceMeters)
          ? Math.exp(-Math.max(0, Number(context.distanceMeters)) / 10_000)
          : 1;
        const weight = Math.max(0, Math.min(1, context.confidence)) * recency * proximity;
        if (weight <= 0) continue;

        contextWeight += weight;
        if (Number.isFinite(context.averageVehicleSpeedMps)) {
          contextSpeedSum += Number(context.averageVehicleSpeedMps) * weight;
          contextSpeedWeight += weight;
        }
        if (Number.isFinite(context.dominantHeadingDegrees)) {
          const radians = Number(context.dominantHeadingDegrees) * DEG_TO_RAD;
          contextHeadingX += Math.cos(radians) * weight;
          contextHeadingY += Math.sin(radians) * weight;
        }
        if (Number.isFinite(context.congestionRatio)) {
          congestionSum += Math.max(0, Math.min(1, Number(context.congestionRatio))) * weight;
          congestionWeight += weight;
        }
      }

      if (contextWeight > 0) {
        motionContextInfluence = Math.min(0.35, 0.12 + 0.23 * Math.min(1, contextWeight));
        motionContextSpeed = contextSpeedWeight > 0
          ? Math.max(0, Math.min(maxPlausibleSpeed, contextSpeedSum / contextSpeedWeight))
          : undefined;
        motionContextHeading = (
          Math.abs(contextHeadingX) + Math.abs(contextHeadingY) > 1e-9
        )
          ? (Math.atan2(contextHeadingY, contextHeadingX) * 180 / Math.PI + 360) % 360
          : undefined;
        motionContextCongestion = congestionWeight > 0
          ? Math.max(0, Math.min(1, congestionSum / congestionWeight))
          : undefined;

        if (motionContextSpeed !== undefined) {
          avgSpeed = Math.max(
            0,
            Math.min(
              maxPlausibleSpeed,
              evidenceSpeed * (1 - motionContextInfluence)
              + motionContextSpeed * motionContextInfluence,
            ),
          );
        }

        if (motionContextHeading !== undefined) {
          const evidenceRadians = evidenceHeading * DEG_TO_RAD;
          const contextRadians = motionContextHeading * DEG_TO_RAD;
          const blendedX =
            Math.cos(evidenceRadians) * (1 - motionContextInfluence)
            + Math.cos(contextRadians) * motionContextInfluence;
          const blendedY =
            Math.sin(evidenceRadians) * (1 - motionContextInfluence)
            + Math.sin(contextRadians) * motionContextInfluence;
          avgHeading = (Math.atan2(blendedY, blendedX) * 180 / Math.PI + 360) % 360;
        }
      }
    }
    const baseTime = latest.timestamp.getTime();
    const stepMinutes = 5;
    const steps = Math.max(1, Math.min(12, Math.floor((Math.min(hours, 1) * 60) / stepMinutes)));
    const baseAccuracy = Math.max(5, latest.accuracy ?? 35);
    const baseConfidence = Math.max(0.1, Math.min(0.95, latest.confidence ?? 0.5));

    const futurePoints: GPSPoint[] = [];
    let currentLat = latest.latitude;
    let currentLng = latest.longitude;

    for (let i = 1; i <= steps; i++) {
      const distance = avgSpeed * stepMinutes * 60;
      const newPos = this.movePoint(currentLat, currentLng, avgHeading, distance);
      const horizonRatio = i / steps;

      const futurePoint: GPSPoint = {
        latitude: newPos.lat,
        longitude: newPos.lng,
        accuracy:
          baseAccuracy
          + Math.max(25, distance * 0.08) * i
          + (
            motionContextInfluence > 0
              ? Math.max(10, distance * (0.04 + 0.08 * (motionContextCongestion ?? 0))) * i
              : 0
          ),
        timestamp: new Date(baseTime + i * stepMinutes * 60 * 1000),
        receivedAt: new Date(),
        source: 'predicted',
        confidence: Math.max(0.05, baseConfidence * Math.exp(-2.2 * horizonRatio)),
        observationKind: 'predicted',
        correlationGroup: 'prediction:deterministic_recency_weighted_motion',
        provenance: {
          provider: 'canonical_geoconsole_futurecast',
          transformedBy: ['deterministic_recency_weighted_motion'],
        },
        metadata: {
          predicted: true,
          model: 'deterministic_recency_weighted_motion',
          horizonMinutes: i * stepMinutes,
          averageSpeedMps: avgSpeed,
          averageHeadingDegrees: avgHeading,
          weightedTransitions: totalWeight,
          stateEstimatorSeeded: hasStateVelocity,
          stateEstimatorInfluence,
          stateEstimatorSpeedMps: hasStateVelocity ? stateSpeedRaw : undefined,
          stateEstimatorHeadingDegrees: hasStateVelocity ? stateHeadingRaw : undefined,
          stateEstimatorRadius95Meters:
            Number.isFinite(stateRadius95) ? stateRadius95 : undefined,
          motionContextApplied: motionContextInfluence > 0,
          motionContextInfluence,
          motionContextSpeedMps: motionContextSpeed,
          motionContextHeadingDegrees: motionContextHeading,
          motionContextCongestionRatio: motionContextCongestion,
          motionContextCount: contextRows.length,
        },
      };

      futurePoints.push(futurePoint);
      currentLat = newPos.lat;
      currentLng = newPos.lng;
    }

    return futurePoints;
  }

  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  private normalizeAngle(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }

  private movePoint(lat: number, lng: number, bearing: number, distance: number): { lat: number; lng: number } {
    const φ1 = lat * DEG_TO_RAD;
    const λ1 = lng * DEG_TO_RAD;
    const θ = bearing * DEG_TO_RAD;
    const d = distance / EARTH_RADIUS;

    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(d) +
      Math.cos(φ1) * Math.sin(d) * Math.cos(θ)
    );

    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
    );

    return {
      lat: (φ2 * 180) / Math.PI,
      lng: this.normalizeLongitude((λ2 * 180) / Math.PI),
    };
  }

  private calculateSpeed(p1: GPSPoint, p2: GPSPoint): number {
    const distance = this.haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    const timeDelta = Math.abs(p2.timestamp.getTime() - p1.timestamp.getTime()) / 1000;
    return timeDelta > 0 ? distance / timeDelta : 0;
  }

  private classifyActivity(speed: number): TrailSegment['segmentType'] {
    if (speed < SPEED_THRESHOLDS.stationary) return 'stationary';
    if (speed < SPEED_THRESHOLDS.walking) return 'walking';
    if (speed < SPEED_THRESHOLDS.running) return 'walking'; // Running classified as walking
    if (speed < SPEED_THRESHOLDS.cycling) return 'transit'; // Cycling classified as transit
    if (speed < SPEED_THRESHOLDS.driving) return 'transit';
    return 'driving';
  }

  private createSegment(
    points: GPSPoint[],
    startIdx: number,
    endIdx: number,
    segmentType: TrailSegment['segmentType']
  ): TrailSegment {
    let distance = 0;
    for (let i = startIdx; i < endIdx; i++) {
      distance += this.haversineDistance(
        points[i].latitude, points[i].longitude,
        points[i + 1].latitude, points[i + 1].longitude
      );
    }
    
    const duration = (points[endIdx].timestamp.getTime() - points[startIdx].timestamp.getTime()) / 1000;
    
    return {
      startIndex: startIdx,
      endIndex: endIdx,
      segmentType,
      averageSpeed: duration > 0 ? distance / duration : 0,
      distance,
      duration,
    };
  }

  private getSpeedColor(speed: number): string {
    if (speed < SPEED_THRESHOLDS.stationary) return '#3b82f6'; // blue
    if (speed < SPEED_THRESHOLDS.walking) return '#22c55e'; // green
    if (speed < SPEED_THRESHOLDS.cycling) return '#eab308'; // yellow
    if (speed < SPEED_THRESHOLDS.driving) return '#f97316'; // orange
    return '#ef4444'; // red
  }

  private calculatePathConfidence(simulations: GPSPoint[][], path: GPSPoint[]): number {
    // Base confidence on path consistency across simulations
    let consistentPaths = 0;
    
    for (const sim of simulations) {
      let matches = 0;
      for (let i = 0; i < path.length; i++) {
        if (i < sim.length) {
          const dist = this.haversineDistance(
            path[i].latitude, path[i].longitude,
            sim[i].latitude, sim[i].longitude
          );
          const tolerance = Math.max(
            25,
            path[i].accuracy ?? 0,
            sim[i].accuracy ?? 0
          );
          if (dist <= tolerance) matches++;
        }
      }
      if (path.length > 0 && matches / path.length > 0.8) consistentPaths++;
    }
    
    return simulations.length > 0 ? consistentPaths / simulations.length : 0;
  }

  private calculatePathLength(points: GPSPoint[]): number {
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      length += this.haversineDistance(
        points[i].latitude, points[i].longitude,
        points[i + 1].latitude, points[i + 1].longitude
      );
    }
    return length;
  }

  private calculateBounds(simulations: GPSPoint[][], start: GPSPoint, end: GPSPoint): BoundingBox {
    const referenceLongitude = start.longitude;
    const startLongitude = this.unwrapLongitude(start.longitude, referenceLongitude);
    const endLongitude = this.unwrapLongitude(end.longitude, referenceLongitude);

    let north = Math.max(start.latitude, end.latitude);
    let south = Math.min(start.latitude, end.latitude);
    let east = Math.max(startLongitude, endLongitude);
    let west = Math.min(startLongitude, endLongitude);

    for (const path of simulations) {
      for (const point of path) {
        const longitude = this.unwrapLongitude(point.longitude, referenceLongitude);
        north = Math.max(north, point.latitude);
        south = Math.min(south, point.latitude);
        east = Math.max(east, longitude);
        west = Math.min(west, longitude);
      }
    }

    const latPad = Math.max((north - south) * 0.1, 1e-6);
    const lngPad = Math.max((east - west) * 0.1, 1e-6);

    return {
      north: north + latPad,
      south: south - latPad,
      east: east + lngPad,
      west: west - lngPad,
    };
  }

  private calculateBoundsFromPoints(points: GPSPoint[]): BoundingBox {
    if (points.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    const referenceLongitude = points[0].longitude;
    let north = points[0].latitude;
    let south = points[0].latitude;
    let east = this.unwrapLongitude(points[0].longitude, referenceLongitude);
    let west = east;

    for (const point of points.slice(1)) {
      const longitude = this.unwrapLongitude(point.longitude, referenceLongitude);
      north = Math.max(north, point.latitude);
      south = Math.min(south, point.latitude);
      east = Math.max(east, longitude);
      west = Math.min(west, longitude);
    }

    return { north, south, east, west };
  }

  private getCacheKey(
    start: GPSPoint,
    end: GPSPoint,
    config: MonteCarloConfig = this.config,
  ): string {
    const pointKey = (point: GPSPoint) => [
      point.latitude.toFixed(7),
      point.longitude.toFixed(7),
      point.altitude ?? '',
      point.accuracy ?? '',
      point.timestamp.getTime(),
      point.source,
      point.confidence.toFixed(6),
      point.observationKind ?? '',
      point.correlationGroup ?? '',
      point.provenance?.provider ?? '',
      point.provenance?.recordId ?? '',
    ].join(',');

    const configKey = [
      config.iterations,
      config.stepSize,
      config.maxSpeed,
      config.accelerationVariance,
      config.directionVariance,
      config.terrainAwareness,
      config.roadNetworkConstraint,
      config.probabilityThreshold,
    ].join(',');

    return `${pointKey(start)}->${pointKey(end)}|${configKey}`;
  }
}

export const monteCarloPathEngine = new MonteCarloPathEngine();
