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
  { source: 'device_gps', enabled: true, priority: 10, confidenceWeight: 0.95 },
  { source: 'exif_photo', enabled: true, priority: 9, confidenceWeight: 0.90 },
  { source: 'exif_video', enabled: true, priority: 9, confidenceWeight: 0.88 },
  { source: 'xmp_sidecar', enabled: true, priority: 8, confidenceWeight: 0.85 },
  { source: 'json_sidecar', enabled: true, priority: 8, confidenceWeight: 0.85 },
  { source: 'wifi_handoff', enabled: true, priority: 6, confidenceWeight: 0.70 },
  { source: 'bluetooth_proximity', enabled: true, priority: 5, confidenceWeight: 0.60 },
  { source: 'accelerometer', enabled: true, priority: 4, confidenceWeight: 0.50 },
  { source: 'browser_timestamp', enabled: true, priority: 3, confidenceWeight: 0.40 },
  { source: 'social_media', enabled: true, priority: 7, confidenceWeight: 0.75 },
  { source: 'public_camera', enabled: true, priority: 6, confidenceWeight: 0.70 },
  { source: 'traffic_cam', enabled: true, priority: 6, confidenceWeight: 0.70 },
  { source: 'satellite_imagery', enabled: true, priority: 5, confidenceWeight: 0.60 },
  { source: 'public_record', enabled: true, priority: 8, confidenceWeight: 0.80 },
  { source: 'manual_input', enabled: true, priority: 7, confidenceWeight: 0.75 },
  { source: 'interpolated', enabled: true, priority: 2, confidenceWeight: 0.30 },
];

// Earth radius in meters
const EARTH_RADIUS = 6371000;

/**
 * Multimodal Input Fusion Engine
 */
export class InputFusionEngine {
  private config: InputFusionConfig;
  private sourceConfigs: Map<DataSource, DataSourceConfig>;
  private pointCache: Map<string, GPSPoint[]> = new Map();

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

  /**
   * Fuse multiple location inputs into unified positions
   */
  async fuseInputs(inputs: GPSPoint[]): Promise<FusedLocation[]> {
    if (inputs.length === 0) return [];

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
    
    // Fuse each group
    const fusedLocations: FusedLocation[] = [];
    
    for (const group of temporalGroups) {
      // Deduplicate within spatial radius
      const spatialGroups = this.groupBySpatialProximity(group);
      
      for (const spatialGroup of spatialGroups) {
        const fused = this.fuseGroup(spatialGroup);
        if (fused) {
          fusedLocations.push(fused);
        }
      }
    }

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

        if (distance <= this.config.deduplicationRadius) {
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
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let weightedAlt = 0;
    let altCount = 0;

    for (const point of points) {
      const config = this.sourceConfigs.get(point.source);
      const weight = (config?.confidenceWeight || 0.5) * point.confidence;
      
      weightedLat += point.latitude * weight;
      weightedLng += point.longitude * weight;
      totalWeight += weight;

      if (point.altitude !== undefined) {
        weightedAlt += point.altitude * weight;
        altCount++;
      }
    }

    // Calculate average timestamp
    const avgTimestamp = new Date(
      points.reduce((sum, p) => sum + p.timestamp.getTime(), 0) / points.length
    );

    return {
      latitude: weightedLat / totalWeight,
      longitude: weightedLng / totalWeight,
      altitude: altCount > 0 ? weightedAlt / totalWeight : undefined,
      accuracy: this.calculateFusedAccuracy(points),
      timestamp: avgTimestamp,
      source: 'device_gps', // Primary source attribution
      confidence: totalWeight / points.length,
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
    const accuracies = points
      .filter(p => p.accuracy !== undefined)
      .map(p => p.accuracy!);
    
    if (accuracies.length === 0) return 15; // Default 15m

    // Fused accuracy improves with more sources (RSS reduction)
    const rss = Math.sqrt(
      accuracies.reduce((sum, a) => sum + a * a, 0) / accuracies.length
    );
    
    // Improvement factor based on number of sources
    const improvementFactor = Math.sqrt(accuracies.length);
    return rss / improvementFactor;
  }

  /**
   * Calculate quality score for fused location
   */
  private calculateQualityScore(points: GPSPoint[], fused: GPSPoint): number {
    // Base score from confidence
    let score = fused.confidence;

    // Bonus for multiple sources
    const uniqueSources = new Set(points.map(p => p.source)).size;
    score *= (1 + 0.1 * Math.min(uniqueSources - 1, 4));

    // Penalty for high spread
    const spread = this.calculateSpread(points);
    if (spread > 50) score *= 0.8;
    else if (spread > 20) score *= 0.9;

    return Math.min(score, 1);
  }

  /**
   * Calculate consensus confidence
   */
  private calculateConsensusConfidence(points: GPSPoint[]): number {
    // High confidence if points are tightly clustered
    const spread = this.calculateSpread(points);
    if (spread < 5) return 0.95;
    if (spread < 10) return 0.85;
    if (spread < 20) return 0.75;
    if (spread < 50) return 0.60;
    return 0.40;
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
   */
  private haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    
    return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
