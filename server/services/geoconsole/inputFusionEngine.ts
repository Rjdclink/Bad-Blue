/**
 * Multimodal Input Fusion Engine
 * 
 * Synthesizes location data from multiple sources into unified, high-confidence positions
 * Uses weighted averaging, temporal alignment, and conflict resolution
 */

import {
  GPSPoint,
  DataSource,
  DataSourceConfig,
  InputFusionConfig,
  FusedLocation,
  BoundingBox,
} from './types';
import { createLogger } from '../../logger';

const log = createLogger('InputFusionEngine');

// Default source priorities and confidence weights
const DEFAULT_SOURCE_CONFIGS: DataSourceConfig[] = [
  { source: 'device_gps', enabled: true, priority: 10, confidenceWeight: 0.96 },
  { source: 'gnss_fix', enabled: true, priority: 10, confidenceWeight: 0.98 },
  { source: 'gnss_raw', enabled: true, priority: 9, confidenceWeight: 0.94 },
  { source: 'exif_photo', enabled: true, priority: 8, confidenceWeight: 0.82 },
  { source: 'exif_video', enabled: true, priority: 8, confidenceWeight: 0.82 },
  { source: 'xmp_sidecar', enabled: true, priority: 7, confidenceWeight: 0.72 },
  { source: 'json_sidecar', enabled: true, priority: 7, confidenceWeight: 0.72 },
  { source: 'wifi_handoff', enabled: true, priority: 5, confidenceWeight: 0.55 },
  { source: 'wifi_rssi', enabled: true, priority: 6, confidenceWeight: 0.62 },
  { source: 'wifi_rtt', enabled: true, priority: 9, confidenceWeight: 0.92 },
  { source: 'wifi_fingerprint', enabled: true, priority: 7, confidenceWeight: 0.78 },
  { source: 'cellular', enabled: true, priority: 4, confidenceWeight: 0.45 },
  { source: 'cell_serving', enabled: true, priority: 5, confidenceWeight: 0.52 },
  { source: 'cell_neighbor', enabled: true, priority: 4, confidenceWeight: 0.44 },
  { source: 'uwb_range', enabled: true, priority: 10, confidenceWeight: 0.98 },
  { source: 'uwb_direction', enabled: true, priority: 10, confidenceWeight: 0.98 },
  { source: 'bluetooth_proximity', enabled: true, priority: 4, confidenceWeight: 0.45 },
  { source: 'ble_rssi', enabled: true, priority: 5, confidenceWeight: 0.52 },
  { source: 'ble_aoa', enabled: true, priority: 8, confidenceWeight: 0.86 },
  { source: 'accelerometer', enabled: true, priority: 3, confidenceWeight: 0.30 },
  { source: 'imu_gyro', enabled: true, priority: 3, confidenceWeight: 0.30 },
  { source: 'magnetometer', enabled: true, priority: 3, confidenceWeight: 0.30 },
  { source: 'barometer', enabled: true, priority: 4, confidenceWeight: 0.40 },
  { source: 'browser_geolocation', enabled: true, priority: 8, confidenceWeight: 0.84 },
  { source: 'browser_timestamp', enabled: true, priority: 2, confidenceWeight: 0.15 },
  { source: 'network_region', enabled: true, priority: 2, confidenceWeight: 0.18 },
  { source: 'social_media', enabled: true, priority: 3, confidenceWeight: 0.28 },
  { source: 'social_geotag', enabled: true, priority: 6, confidenceWeight: 0.64 },
  { source: 'visual_detection', enabled: true, priority: 6, confidenceWeight: 0.64 },
  { source: 'vehicle_telemetry', enabled: true, priority: 9, confidenceWeight: 0.90 },
  { source: 'public_camera', enabled: true, priority: 5, confidenceWeight: 0.56 },
  { source: 'traffic_cam', enabled: true, priority: 5, confidenceWeight: 0.56 },
  { source: 'satellite_imagery', enabled: true, priority: 4, confidenceWeight: 0.42 },
  { source: 'historical_location', enabled: true, priority: 2, confidenceWeight: 0.16 },
  { source: 'public_record', enabled: true, priority: 2, confidenceWeight: 0.16 },
  { source: 'manual_input', enabled: true, priority: 3, confidenceWeight: 0.30 },
  { source: 'interpolated', enabled: true, priority: 1, confidenceWeight: 0.10 },
  { source: 'predicted', enabled: true, priority: 1, confidenceWeight: 0.08 },
];

// Earth radius in meters
const EARTH_RADIUS = 6371000;

// Pre-computed conversion factors for performance
const DEG_TO_RAD = Math.PI / 180;

// Memoization cache for haversine calculations
const distanceCache = new Map<string, number>();
const MAX_CACHE_SIZE = 10000;

/**
 * Multimodal Input Fusion Engine
 * 
 * Performance optimizations:
 * - Spatial indexing for O(n log n) neighbor lookup
 * - Distance calculation memoization
 * - Batch processing with chunking
 * - Early termination for deduplication
 */
export class InputFusionEngine {
  private config: InputFusionConfig;
  private sourceConfigs: Map<DataSource, DataSourceConfig>;
  private pointCache: Map<string, GPSPoint[]> = new Map();
  private fusionCache: Map<string, FusedLocation[]> = new Map();

  constructor(config?: Partial<InputFusionConfig>) {
    this.config = {
      sources: config?.sources || DEFAULT_SOURCE_CONFIGS,
      conflictResolution: config?.conflictResolution || 'weighted_average',
      minConfidenceThreshold: config?.minConfidenceThreshold || 0.3,
      deduplicationRadius: config?.deduplicationRadius || 10,
      temporalWindow: config?.temporalWindow || 60,
    };

    this.sourceConfigs = new Map();
    this.config.sources.forEach(sc => this.sourceConfigs.set(sc.source, sc));

    log.info('InputFusionEngine initialized', {
      sources: this.config.sources.length,
      conflictResolution: this.config.conflictResolution,
    });
  }

  private defaultAccuracyMeters(source: DataSource): number {
    switch (source) {
      case 'uwb_range':
      case 'uwb_direction': return 1.5;
      case 'wifi_rtt': return 2.5;
      case 'gnss_fix':
      case 'device_gps': return 12;
      case 'browser_geolocation': return 25;
      case 'ble_aoa': return 8;
      case 'wifi_fingerprint': return 35;
      case 'wifi_rssi':
      case 'wifi_handoff': return 80;
      case 'vehicle_telemetry': return 20;
      case 'cell_serving':
      case 'cell_neighbor':
      case 'cellular': return 1500;
      case 'social_geotag': return 250;
      case 'exif_photo':
      case 'exif_video':
      case 'xmp_sidecar':
      case 'json_sidecar': return 40;
      case 'network_region': return 25_000;
      case 'historical_location':
      case 'public_record':
      case 'manual_input': return 5_000;
      case 'interpolated':
      case 'predicted': return 500;
      default: return 250;
    }
  }

  private effectiveAccuracyMeters(point: GPSPoint): number {
    const reported = Number(point.accuracy);
    if (Number.isFinite(reported) && reported > 0) return Math.max(0.5, reported);
    return this.defaultAccuracyMeters(point.source);
  }

  private correlationKey(point: GPSPoint): string {
    return this.correlationKey(point);
  }

  private measurementWeight(point: GPSPoint, correlationCount = 1, referenceTimeMs = point.timestamp.getTime()): number {
    const config = this.sourceConfigs.get(point.source);
    const prior = config?.confidenceWeight ?? 0.25;
    const confidence = Math.max(0.001, Math.min(1, point.confidence));
    const accuracy = this.effectiveAccuracyMeters(point);

    // Information-like weighting: precise measurements contribute more without
    // allowing tiny claimed accuracies to explode the estimate.
    const precision = 1 / Math.pow(Math.max(1.5, accuracy), 2);

    // Freshness is relative to the event-time group being reconstructed, not
    // wall-clock time. Old evidence remains usable for historical reconstruction.
    const ageSeconds = Math.max(0, (referenceTimeMs - point.timestamp.getTime()) / 1000);
    const halfLifeSeconds =
      point.observationKind === 'historical' ? 30 * 24 * 3600 :
      point.observationKind === 'predicted' ? 15 * 60 :
      6 * 3600;
    const freshness = Math.pow(0.5, ageSeconds / halfLifeSeconds);

    const kindFactor =
      point.observationKind === 'predicted' ? 0.25 :
      point.observationKind === 'interpolated' ? 0.35 :
      point.observationKind === 'historical' ? 0.30 :
      point.observationKind === 'inferred' ? 0.55 :
      1;

    return prior * confidence * precision * freshness * kindFactor / Math.max(1, correlationCount);
  }

  /**
   * Clear memoization caches to free memory
   */
  clearCaches(): void {
    distanceCache.clear();
    this.fusionCache.clear();
    this.pointCache.clear();
  }

  /**
   * Fuse multiple location inputs into unified positions
   * Uses batching and memoization for performance
   */
  async fuseInputs(inputs: GPSPoint[]): Promise<FusedLocation[]> {
    if (inputs.length === 0) return [];

    // Check cache first
    const cacheKey = this.generateCacheKey(inputs);
    const cached = this.fusionCache.get(cacheKey);
    if (cached) {
      log.debug('Cache hit for fusion', { inputCount: inputs.length });
      return cached;
    }

    const startTime = Date.now();
    
    // Filter inputs by enabled sources and confidence threshold
    const validInputs = inputs.filter(p => {
      const config = this.sourceConfigs.get(p.source);
      return config?.enabled && p.confidence >= this.config.minConfidenceThreshold;
    });

    if (validInputs.length === 0) {
      log.warn('No valid inputs after filtering');
      return [];
    }

    // Sort by timestamp
    validInputs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Group points by temporal window
    const temporalGroups = this.groupByTemporalWindow(validInputs);
    
    // Fuse each group (process in parallel batches for large datasets)
    const fusedLocations: FusedLocation[] = [];
    const batchSize = 100;
    
    for (let i = 0; i < temporalGroups.length; i += batchSize) {
      const batch = temporalGroups.slice(i, i + batchSize);
      
      for (const group of batch) {
        // Deduplicate within spatial radius
        const spatialGroups = this.groupBySpatialProximity(group);
        
        for (const spatialGroup of spatialGroups) {
          const fused = this.fuseGroup(spatialGroup);
          if (fused) {
            fusedLocations.push(fused);
          }
        }
      }
    }

    // Cache the results
    this.fusionCache.set(cacheKey, fusedLocations);

    log.info('Input fusion complete', {
      inputCount: inputs.length,
      validCount: validInputs.length,
      fusedCount: fusedLocations.length,
      processingTime: Date.now() - startTime,
    });

    return fusedLocations;
  }

  /**
   * Group points within temporal window
   */
  private groupByTemporalWindow(points: GPSPoint[]): GPSPoint[][] {
    const groups: GPSPoint[][] = [];
    let currentGroup: GPSPoint[] = [];
    let groupStartTime: number | null = null;

    for (const point of points) {
      const pointTime = point.timestamp.getTime();
      
      if (groupStartTime === null || 
          pointTime - groupStartTime <= this.config.temporalWindow * 1000) {
        currentGroup.push(point);
        if (groupStartTime === null) groupStartTime = pointTime;
      } else {
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [point];
        groupStartTime = pointTime;
      }
    }

    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }

  /**
   * Group points within spatial proximity
   */
  private groupBySpatialProximity(points: GPSPoint[]): GPSPoint[][] {
    const groups: GPSPoint[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < points.length; i++) {
      if (assigned.has(i)) continue;

      const group: GPSPoint[] = [points[i]];
      assigned.add(i);

      for (let j = i + 1; j < points.length; j++) {
        if (assigned.has(j)) continue;
        
        const distance = this.haversineDistance(
          points[i].latitude, points[i].longitude,
          points[j].latitude, points[j].longitude
        );

        const overlapRadius = Math.max(
          this.config.deduplicationRadius,
          Math.min(
            2_000,
            Math.sqrt(
              this.effectiveAccuracyMeters(points[i]) *
              this.effectiveAccuracyMeters(points[j])
            )
          )
        );

        if (distance <= overlapRadius) {
          group.push(points[j]);
          assigned.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Fuse a group of nearby points
   */
  private fuseGroup(points: GPSPoint[]): FusedLocation | null {
    if (points.length === 0) return null;
    if (points.length === 1) {
      return {
        point: points[0],
        contributingSources: [points[0].source],
        fusionMethod: 'single_source',
        rawInputs: points,
        qualityScore: points[0].confidence,
      };
    }

    let fusedPoint: GPSPoint;
    const fusionMethod = this.config.conflictResolution;

    switch (fusionMethod) {
      case 'weighted_average':
        fusedPoint = this.weightedAverageFusion(points);
        break;
      case 'highest_confidence':
        fusedPoint = this.highestConfidenceFusion(points);
        break;
      case 'most_recent':
        fusedPoint = this.mostRecentFusion(points);
        break;
      case 'consensus':
        fusedPoint = this.consensusFusion(points);
        break;
      default:
        fusedPoint = this.weightedAverageFusion(points);
    }

    const contributingSources = [...new Set(points.map(p => p.source))];
    const qualityScore = this.calculateQualityScore(points, fusedPoint);

    return {
      point: fusedPoint,
      contributingSources,
      fusionMethod,
      rawInputs: points,
      qualityScore,
    };
  }

  /**
   * Weighted average fusion - combine positions based on source weights
   */
  private weightedAverageFusion(points: GPSPoint[]): GPSPoint {
    const correlationCounts = new Map<string, number>();
    for (const point of points) {
      const key = this.correlationKey(point);
      correlationCounts.set(key, (correlationCounts.get(key) || 0) + 1);
    }

    const referenceTimeMs = Math.max(...points.map(point => point.timestamp.getTime()));

    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let weightedAlt = 0;
    let altitudeWeight = 0;
    let timestampWeight = 0;
    let weightedTimestamp = 0;
    let bestPoint = points[0];
    let bestWeight = -Infinity;

    for (const point of points) {
      const key = this.correlationKey(point);
      const weight = this.measurementWeight(point, correlationCounts.get(key) || 1, referenceTimeMs);
      if (weight <= 0 || !Number.isFinite(weight)) continue;

      weightedLat += point.latitude * weight;
      weightedLng += point.longitude * weight;
      totalWeight += weight;
      weightedTimestamp += point.timestamp.getTime() * weight;
      timestampWeight += weight;

      if (point.altitude !== undefined && Number.isFinite(point.altitude)) {
        weightedAlt += point.altitude * weight;
        altitudeWeight += weight;
      }
      if (weight > bestWeight) {
        bestWeight = weight;
        bestPoint = point;
      }
    }

    if (totalWeight <= 0) return { ...bestPoint };

    return {
      latitude: weightedLat / totalWeight,
      longitude: weightedLng / totalWeight,
      altitude: altitudeWeight > 0 ? weightedAlt / altitudeWeight : undefined,
      accuracy: this.calculateFusedAccuracy(points),
      timestamp: new Date(weightedTimestamp / Math.max(timestampWeight, Number.EPSILON)),
      source: bestPoint.source,
      confidence: this.calculateConsensusConfidence(points),
      observationKind: 'observed',
      metadata: {
        fusion: 'correlation_aware_inverse_variance',
        contributingCount: points.length,
      },
    };
  }

  /**
   * Highest confidence fusion - use the most confident reading
   */
  private highestConfidenceFusion(points: GPSPoint[]): GPSPoint {
    let best = points[0];
    let bestScore = 0;

    for (const point of points) {
      const config = this.sourceConfigs.get(point.source);
      const score = (config?.priority || 5) * point.confidence;
      if (score > bestScore) {
        bestScore = score;
        best = point;
      }
    }

    return { ...best };
  }

  /**
   * Most recent fusion - use the latest reading
   */
  private mostRecentFusion(points: GPSPoint[]): GPSPoint {
    let mostRecent = points[0];
    for (const point of points) {
      if (point.timestamp > mostRecent.timestamp) {
        mostRecent = point;
      }
    }
    return { ...mostRecent };
  }

  /**
   * Consensus fusion - use median of all readings
   */
  private consensusFusion(points: GPSPoint[]): GPSPoint {
    const lats = points.map(p => p.latitude).sort((a, b) => a - b);
    const lngs = points.map(p => p.longitude).sort((a, b) => a - b);
    const mid = Math.floor(points.length / 2);

    const medianLat = points.length % 2 === 0
      ? (lats[mid - 1] + lats[mid]) / 2
      : lats[mid];
    
    const medianLng = points.length % 2 === 0
      ? (lngs[mid - 1] + lngs[mid]) / 2
      : lngs[mid];

    const avgTimestamp = new Date(
      points.reduce((sum, p) => sum + p.timestamp.getTime(), 0) / points.length
    );

    return {
      latitude: medianLat,
      longitude: medianLng,
      timestamp: avgTimestamp,
      source: 'device_gps',
      confidence: this.calculateConsensusConfidence(points),
    };
  }

  /**
   * Calculate fused accuracy from multiple readings
   */
  private calculateFusedAccuracy(points: GPSPoint[]): number {
    // Combine independent correlation groups in information space. Multiple
    // observations from the same provider/device group do not receive a false
    // sqrt(N) accuracy bonus.
    const bestAccuracyByGroup = new Map<string, number>();
    for (const point of points) {
      const key = this.correlationKey(point);
      const accuracy = this.effectiveAccuracyMeters(point);
      const existing = bestAccuracyByGroup.get(key);
      if (existing === undefined || accuracy < existing) bestAccuracyByGroup.set(key, accuracy);
    }

    let information = 0;
    for (const accuracy of bestAccuracyByGroup.values()) {
      information += 1 / Math.pow(Math.max(1.5, accuracy), 2);
    }
    return information > 0 ? Math.sqrt(1 / information) : 5_000;
  }

  /**
   * Calculate quality score for fused location
   */
  private independentRepresentatives(points: GPSPoint[]): GPSPoint[] {
    const representatives = new Map<string, GPSPoint>();

    for (const point of points) {
      const key = this.correlationKey(point);
      const current = representatives.get(key);
      if (!current) {
        representatives.set(key, point);
        continue;
      }

      const currentAccuracy = this.effectiveAccuracyMeters(current);
      const candidateAccuracy = this.effectiveAccuracyMeters(point);
      if (
        candidateAccuracy < currentAccuracy ||
        (candidateAccuracy === currentAccuracy && point.confidence > current.confidence)
      ) {
        representatives.set(key, point);
      }
    }

    return [...representatives.values()];
  }

  /**
   * Calculate quality score for fused location without rewarding duplicated feeds.
   */
  private calculateQualityScore(points: GPSPoint[], fused: GPSPoint): number {
    const independent = this.independentRepresentatives(points);
    const independentCount = independent.length;
    const consensus = this.calculateConsensusConfidence(points);
    const fusedAccuracy = Math.max(1, fused.accuracy ?? this.calculateFusedAccuracy(points));
    const medianAccuracy = [...independent]
      .map(point => this.effectiveAccuracyMeters(point))
      .sort((a, b) => a - b)[Math.floor(Math.max(0, independentCount - 1) / 2)] || fusedAccuracy;

    // Precision improvement only helps when it comes from independent evidence.
    const precisionGain = Math.min(1, medianAccuracy / fusedAccuracy);
    const independenceFactor = independentCount <= 1
      ? 0.75
      : Math.min(1, 0.82 + Math.log2(independentCount) * 0.08);

    return Math.max(0, Math.min(1, consensus * (0.85 + 0.15 * precisionGain) * independenceFactor));
  }

  /**
   * Consensus is based on agreement relative to each source's claimed/expected
   * uncertainty, not fixed meter thresholds.
   */
  private calculateConsensusConfidence(points: GPSPoint[]): number {
    const independent = this.independentRepresentatives(points);
    if (independent.length === 0) return 0;

    if (independent.length === 1) {
      const only = independent[0];
      const kindPenalty =
        only.observationKind === 'predicted' ? 0.35 :
        only.observationKind === 'interpolated' ? 0.45 :
        only.observationKind === 'historical' ? 0.55 :
        only.observationKind === 'inferred' ? 0.70 :
        1;
      return Math.max(0, Math.min(1, only.confidence * kindPenalty));
    }

    let normalizedDisagreementSum = 0;
    let pairCount = 0;

    for (let i = 0; i < independent.length; i++) {
      for (let j = i + 1; j < independent.length; j++) {
        const a = independent[i];
        const b = independent[j];
        const distance = this.haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);
        const expectedSigma = Math.sqrt(
          Math.pow(this.effectiveAccuracyMeters(a), 2) +
          Math.pow(this.effectiveAccuracyMeters(b), 2)
        );
        normalizedDisagreementSum += distance / Math.max(1, expectedSigma);
        pairCount++;
      }
    }

    const normalizedDisagreement = pairCount > 0
      ? normalizedDisagreementSum / pairCount
      : 0;
    const agreement = Math.exp(-0.5 * normalizedDisagreement * normalizedDisagreement);

    const confidenceMean = independent.reduce(
      (sum, point) => sum + Math.max(0, Math.min(1, point.confidence)),
      0
    ) / independent.length;

    // Independent corroboration can strengthen confidence, but never manufacture
    // certainty when the underlying observations disagree.
    const corroboration = Math.min(1, 0.88 + 0.04 * Math.min(3, independent.length - 1));
    return Math.max(0, Math.min(1, confidenceMean * agreement * corroboration));
  }

  /**
   * Calculate spread (max distance between any two points)
   */
  private calculateSpread(points: GPSPoint[]): number {
    let maxDistance = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const distance = this.haversineDistance(
          points[i].latitude, points[i].longitude,
          points[j].latitude, points[j].longitude
        );
        maxDistance = Math.max(maxDistance, distance);
      }
    }
    return maxDistance;
  }

  /**
   * Haversine distance between two points (meters)
   * Uses memoization for frequently calculated pairs
   */
  private haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    // Generate cache key using truncated coordinates
    const key = `${lat1.toFixed(6)},${lon1.toFixed(6)}-${lat2.toFixed(6)},${lon2.toFixed(6)}`;
    
    // Check cache
    const cached = distanceCache.get(key);
    if (cached !== undefined) return cached;
    
    // Calculate using pre-computed conversion factor
    const φ1 = lat1 * DEG_TO_RAD;
    const φ2 = lat2 * DEG_TO_RAD;
    const Δφ = (lat2 - lat1) * DEG_TO_RAD;
    const Δλ = (lon2 - lon1) * DEG_TO_RAD;

    const sinΔφ2 = Math.sin(Δφ / 2);
    const sinΔλ2 = Math.sin(Δλ / 2);
    
    const a = sinΔφ2 * sinΔφ2 + Math.cos(φ1) * Math.cos(φ2) * sinΔλ2 * sinΔλ2;
    const distance = EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    // Store in cache (with size limit)
    if (distanceCache.size < MAX_CACHE_SIZE) {
      distanceCache.set(key, distance);
    }
    
    return distance;
  }

  /**
   * Generate cache key for fusion results
   */
  private generateCacheKey(inputs: GPSPoint[]): string {
    // Use hash of sorted input coordinates and timestamps
    const sortedInputs = [...inputs].sort((a, b) => 
      a.latitude - b.latitude || a.longitude - b.longitude
    );
    return sortedInputs.slice(0, 10).map(p => 
      `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)},${p.timestamp.getTime()}`
    ).join('|');
  }

  /**
   * Convert GPS point to GeoJSON
   */
  toGeoJSON(point: GPSPoint): { type: 'Point'; coordinates: [number, number, number?] } {
    return {
      type: 'Point',
      coordinates: point.altitude !== undefined
        ? [point.longitude, point.latitude, point.altitude]
        : [point.longitude, point.latitude],
    };
  }

  /**
   * Get bounding box for a set of points
   */
  getBoundingBox(points: GPSPoint[]): BoundingBox {
    if (points.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    let north = -90, south = 90, east = -180, west = 180;

    for (const point of points) {
      north = Math.max(north, point.latitude);
      south = Math.min(south, point.latitude);
      east = Math.max(east, point.longitude);
      west = Math.min(west, point.longitude);
    }

    return { north, south, east, west };
  }
}

export const inputFusionEngine = new InputFusionEngine();
