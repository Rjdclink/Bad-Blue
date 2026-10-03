/**
 * Hybrid Geoconsole - Main Integration Module
 * 
 * Enterprise-grade location intelligence platform combining:
 * - Multimodal input fusion
 * - Monte Carlo path interpolation
 * - Real-time tracking with weather-radar-style timeline
 * - 4Ji orchestration for compute optimization
 * - Professional UI rendering
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  GPSPoint,
  DataSource,
  InputFusionConfig,
  MonteCarloConfig,
  TimelineConfig,
  FusedLocation,
  InterpolatedPath,
  MotionTrail,
  TrailPoint,
  LocationIntelligenceReport,
  GeoconsoleOrchestrationConfig,
  OrchestrationState,
  ProgressUpdate,
  GeoJSONFeatureCollection,
  FrequentLocation,
  MotionPattern,
  LocationAnomaly,
  DataSourceSummary,
} from './types';
import { InputFusionEngine, inputFusionEngine } from './inputFusionEngine';
import { MonteCarloPathEngine, monteCarloPathEngine } from './monteCarloPathEngine';
import { createLogger } from '../../logger';
import {
  estimateSpectraConstraintState,
  type SpectraConstraintStateSummary,
} from '../spectra/SpectraConstraintStateEstimator';

const log = createLogger('HybridGeoconsole');

// Unit conversion constants
const MPS_TO_MPH = 2.237; // meters per second to miles per hour

// Default timeline configuration
const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  historyDays: 3, // retained for reports/analytics, not the operator playback window
  futurecastHours: 1,
  playbackSpeed: 60, // 1 minute = 1 second
  animationFps: 30,
  trailFadeSeconds: 3600, // rolling previous hour
};

// Default orchestration configuration
const DEFAULT_ORCHESTRATION_CONFIG: GeoconsoleOrchestrationConfig = {
  maxConcurrentOperations: 4,
  computeBudget: 1000,
  cacheStrategy: 'aggressive',
  prefetchDepth: 3,
  refinementPasses: 2,
  adaptiveResolution: true,
  gpuAcceleration: false,
};

// Processing configuration
const DEFAULT_PROCESSING_CONFIG = {
  minInterpolationGapSeconds: 60,
  maxInterpolationGapMinutes: 30,
  maxInterpolationSpeedMps: 90,
  clusterRadius: 50, // meters for frequent location clustering
  anomalySpeedThreshold: 50, // m/s for speed anomaly detection
  largeGapHours: 12, // hours for gap anomaly detection
};

/**
 * Hybrid Geoconsole - Main Class
 */
export class HybridGeoconsole extends EventEmitter {
  private inputFusionEngine: InputFusionEngine;
  private monteCarloEngine: MonteCarloPathEngine;
  private timelineConfig: TimelineConfig;
  private orchestrationConfig: GeoconsoleOrchestrationConfig;
  private orchestrationState: OrchestrationState;
  
  // In-memory storage (NO disk writes)
  private locationCache: Map<string, GPSPoint[]> = new Map();
  private evidenceCache: Map<string, GPSPoint[]> = new Map();
  private pathCache: Map<string, InterpolatedPath> = new Map();
  private trailCache: Map<string, MotionTrail> = new Map();
  private reportCache: Map<string, LocationIntelligenceReport> = new Map();
  
  // Processing queues
  private processingQueue: Array<{ id: string; task: () => Promise<void> }> = [];
  private isProcessing = false;

  constructor(
    fusionConfig?: Partial<InputFusionConfig>,
    monteCarloConfig?: Partial<MonteCarloConfig>,
    timelineConfig?: Partial<TimelineConfig>,
    orchestrationConfig?: Partial<GeoconsoleOrchestrationConfig>
  ) {
    super();

    // The engine modules already own canonical default instances. Reuse those for
    // the default HybridGeoconsole instead of constructing a second identical pair
    // during route import. Explicit custom configs still receive isolated engines,
    // preserving configurability and test injection semantics.
    this.inputFusionEngine = fusionConfig ? new InputFusionEngine(fusionConfig) : inputFusionEngine;
    this.monteCarloEngine = monteCarloConfig ? new MonteCarloPathEngine(monteCarloConfig) : monteCarloPathEngine;
    this.timelineConfig = { ...DEFAULT_TIMELINE_CONFIG, ...timelineConfig };
    this.orchestrationConfig = { ...DEFAULT_ORCHESTRATION_CONFIG, ...orchestrationConfig };
    
    this.orchestrationState = {
      activeTasks: 0,
      queuedTasks: 0,
      computeUsage: 0,
      cacheHitRate: 0,
      lastOptimizationPass: new Date(),
      nextScheduledPass: new Date(Date.now() + 60000),
    };

    log.info('HybridGeoconsole initialized', {
      cacheStrategy: this.orchestrationConfig.cacheStrategy,
      historyDays: this.timelineConfig.historyDays,
      futurecastHours: this.timelineConfig.futurecastHours,
    });
  }

  private selectPrimaryFusedTimeline(locations: FusedLocation[]): FusedLocation[] {
    if (locations.length <= 1) return [...locations];

    const sorted = [...locations].sort(
      (a, b) => a.point.timestamp.getTime() - b.point.timestamp.getTime()
    );
    const groups: FusedLocation[][] = [];
    let group: FusedLocation[] = [];
    let groupStart = 0;
    const eventWindowMs = 5_000;

    for (const location of sorted) {
      const timestamp = location.point.timestamp.getTime();
      if (group.length === 0 || timestamp - groupStart <= eventWindowMs) {
        if (group.length === 0) groupStart = timestamp;
        group.push(location);
      } else {
        groups.push(group);
        group = [location];
        groupStart = timestamp;
      }
    }
    if (group.length) groups.push(group);

    // Alternate hypotheses remain available in fusedLocations. Only the most
    // strongly supported candidate per event window can drive physical motion.
    return groups.map(candidates =>
      [...candidates].sort((a, b) =>
        b.qualityScore - a.qualityScore ||
        b.point.confidence - a.point.confidence ||
        (a.point.accuracy ?? Number.MAX_SAFE_INTEGER) -
          (b.point.accuracy ?? Number.MAX_SAFE_INTEGER)
      )[0]
    );
  }

  private mergeSessionEvidence(sessionId: string, incoming: GPSPoint[]): GPSPoint[] {
    if (!incoming.length) return [];

    const previous = this.evidenceCache.get(sessionId) || [];
    const incomingTimes = incoming
      .map(point => point.timestamp.getTime())
      .filter(Number.isFinite);
    if (!incomingTimes.length) return incoming;

    const minimumIncomingTime = Math.min(...incomingTimes);
    const maximumIncomingTime = Math.max(...incomingTimes);
    const historyCutoff = minimumIncomingTime - 15 * 60_000;

    // Reuse only the immediately preceding evidence window. This lets successive
    // live telemetry batches constrain one continuous hidden state without
    // allowing unrelated old observations to pull a new trajectory backward.
    const relevantPrevious = previous.filter(point => {
      const timestamp = point.timestamp.getTime();
      return Number.isFinite(timestamp)
        && timestamp >= historyCutoff
        && timestamp <= maximumIncomingTime;
    });

    const deduplicated = new Map<string, GPSPoint>();
    for (const point of [...relevantPrevious, ...incoming]) {
      const key = [
        point.timestamp.getTime(),
        point.latitude.toFixed(7),
        point.longitude.toFixed(7),
        point.source,
        point.correlationGroup || '',
        point.provenance?.provider || '',
        point.provenance?.recordId || '',
      ].join('|');
      deduplicated.set(key, point);
    }

    const merged = [...deduplicated.values()].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const cacheCutoff = maximumIncomingTime - 60 * 60_000;
    const cache = merged
      .filter(point =>
        point.timestamp.getTime() >= cacheCutoff
        && point.observationKind !== 'predicted'
        && point.source !== 'predicted'
        && point.observationKind !== 'interpolated'
        && point.source !== 'interpolated'
      )
      .slice(-500);
    this.evidenceCache.set(sessionId, cache);

    return merged;
  }

  /**
   * Process raw location inputs through the full pipeline
   */
  async processLocationData(
    inputs: GPSPoint[],
    sessionId?: string
  ): Promise<{
    fusedLocations: FusedLocation[];
    primaryFusedLocations: FusedLocation[];
    stateEstimatedPoints: GPSPoint[];
    constraintState: SpectraConstraintStateSummary;
    trail: MotionTrail;
    futurecast: GPSPoint[];
  }> {
    const taskId = sessionId || randomUUID();
    const startTime = Date.now();

    this.emitProgress(taskId, 'fusion', 0, 'Starting multimodal input fusion...');
    
    try {
      // Step 1: Fuse inputs from multiple sources. Successive batches attached
      // to the same session retain a bounded recent evidence window so the
      // hidden motion state can be estimated across updates rather than from
      // isolated snapshots.
      this.emitProgress(taskId, 'fusion', 20, 'Fusing location data from multiple sources...');
      const evidenceInputs = this.mergeSessionEvidence(taskId, inputs);
      const fusedLocations = await this.inputFusionEngine.fuseInputs(evidenceInputs);
      
      if (fusedLocations.length === 0) {
        throw new Error('No valid locations after fusion');
      }

      // Step 2: Keep alternate hypotheses, but resolve one physical timeline.
      const primaryFusedLocations = this.selectPrimaryFusedTimeline(fusedLocations);

      // Step 2a: Treat the physical timeline as a hidden state rather than a
      // sequence of unrelated dots. The constant-velocity Kalman filter rejects
      // inconsistent measurements softly, while the backward RTS pass lets a
      // later observation refine earlier positions in the same continuous
      // segment. Raw canonical fused locations remain available unchanged.
      const constraintState = estimateSpectraConstraintState(
        primaryFusedLocations
          .map(location => location.point)
          .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      );
      const stateEstimatedPoints = constraintState.points.length
        ? constraintState.points
        : primaryFusedLocations
            .map(location => location.point)
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      this.emitProgress(taskId, 'interpolation', 40, 'Reconstructing supported movement gaps...');
      const interpolatedPoints = await this.interpolateGaps(stateEstimatedPoints);
      
      // Step 3: Generate motion trail
      this.emitProgress(taskId, 'trail', 60, 'Generating motion trail...');
      const trail = await this.monteCarloEngine.generateMotionTrail(interpolatedPoints);
      
      // Step 4: Futurecast only from the latest continuous evidence segment.
      this.emitProgress(taskId, 'futurecast', 80, 'Computing futurecast prediction...');
      let continuousStart = 0;
      for (let i = interpolatedPoints.length - 1; i >= 0; i--) {
        const gapBefore = Number(interpolatedPoints[i].metadata?.gapBeforeSeconds || 0);
        if (gapBefore > 0) {
          continuousStart = i;
          break;
        }
      }
      const recentPoints = interpolatedPoints.slice(continuousStart).slice(-20);
      const futurecast = await this.monteCarloEngine.generateFuturecast(
        recentPoints,
        this.timelineConfig.futurecastHours
      );

      // Cache results
      this.trailCache.set(taskId, trail);
      this.locationCache.set(taskId, interpolatedPoints);

      this.emitProgress(taskId, 'complete', 100, 'Processing complete');

      log.info('Location data processed', {
        taskId,
        inputCount: inputs.length,
        retainedEvidenceCount: evidenceInputs.length,
        fusedCount: fusedLocations.length,
        stateEstimatedCount: stateEstimatedPoints.length,
        constraintSegments: constraintState.summary.segmentCount,
        robustlyDownweightedMeasurements: constraintState.summary.robustlyDownweightedCount,
        trailPoints: trail.points.length,
        futurecastPoints: futurecast.length,
        processingTime: Date.now() - startTime,
      });

      return {
        fusedLocations,
        primaryFusedLocations,
        stateEstimatedPoints,
        constraintState: constraintState.summary,
        trail,
        futurecast,
      };
    } catch (error) {
      log.error('Location processing failed', { taskId, error });
      this.emitProgress(taskId, 'error', 0, `Processing failed: ${error}`);
      throw error;
    }
  }

  /**
   * Interpolate gaps between known points
   */
  private async interpolateGaps(points: GPSPoint[]): Promise<GPSPoint[]> {
    if (points.length < 2) return points;

    const result: GPSPoint[] = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const gapSeconds = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
      const gapMinutes = gapSeconds / 60;
      const distanceMeters = this.haversineDistance(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude,
      );
      const requiredSpeed = gapSeconds > 0
        ? distanceMeters / gapSeconds
        : Number.POSITIVE_INFINITY;

      const kindOf = (point: GPSPoint): GPSPoint['observationKind'] =>
        point.observationKind || (
          point.source === 'historical_location' || point.source === 'public_record'
            ? 'historical'
            : point.source === 'interpolated'
              ? 'interpolated'
              : point.source === 'predicted'
                ? 'predicted'
                : 'observed'
        );
      const supportsMotion =
        kindOf(prev) === 'observed' &&
        kindOf(curr) === 'observed';

      const discontinuityReason =
        gapSeconds <= 0
          ? 'non_monotonic_event_time'
          : !supportsMotion
            ? 'unsupported_evidence_continuity'
            : requiredSpeed > DEFAULT_PROCESSING_CONFIG.maxInterpolationSpeedMps
              ? 'implausible_required_speed'
              : gapMinutes > DEFAULT_PROCESSING_CONFIG.maxInterpolationGapMinutes
                ? 'gap_exceeds_interpolation_window'
                : null;

      if (discontinuityReason) {
        result.push({
          ...curr,
          metadata: {
            ...(curr.metadata || {}),
            gapBeforeSeconds: Math.max(1, gapSeconds),
            continuity: 'discontinuous',
            discontinuityReason,
            requiredSpeedMps: Number.isFinite(requiredSpeed) ? requiredSpeed : undefined,
          },
        });
        continue;
      }

      if (gapSeconds >= DEFAULT_PROCESSING_CONFIG.minInterpolationGapSeconds) {
        const path = await this.monteCarloEngine.interpolatePath(prev, curr);
        for (let j = 1; j < path.interpolatedPoints.length - 1; j++) {
          result.push(path.interpolatedPoints[j]);
        }
        result.push(curr);
        continue;
      }

      result.push(curr);
    }

    return result;
  }

  /**
   * Generate comprehensive location intelligence report
   */
  async generateIntelligenceReport(
    sessionId: string,
    subject: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<LocationIntelligenceReport> {
    const reportId = randomUUID();
    const startTime = Date.now();

    // Get cached data
    const points = this.locationCache.get(sessionId) || [];
    const trail = this.trailCache.get(sessionId);

    if (points.length === 0) {
      throw new Error('No location data found for session');
    }

    // Calculate time range
    const sortedPoints = [...points].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    const effectiveRange = timeRange || {
      start: sortedPoints[0].timestamp,
      end: sortedPoints[sortedPoints.length - 1].timestamp,
    };

    // Filter points within range
    const rangePoints = sortedPoints.filter(
      p => p.timestamp >= effectiveRange.start && p.timestamp <= effectiveRange.end
    );

    // Analyze frequent locations
    const frequentLocations = this.analyzeFrequentLocations(rangePoints);
    
    // Analyze motion patterns
    const motionPattern = this.analyzeMotionPattern(rangePoints, trail);
    
    // Detect anomalies
    const anomalies = this.detectAnomalies(rangePoints, trail);
    
    // Summarize data sources
    const dataSources = this.summarizeDataSources(rangePoints);
    
    // Generate GeoJSON
    const geojson = this.generateGeoJSON(rangePoints, trail);

    // Calculate summary statistics
    const totalDistance = trail?.totalDistance || this.calculateTotalDistance(rangePoints);
    const uniqueLocations = this.countUniqueLocations(rangePoints, 100); // 100m radius

    const report: LocationIntelligenceReport = {
      id: reportId,
      generatedAt: new Date(),
      subject,
      timeRange: effectiveRange,
      summary: {
        totalLocations: rangePoints.length,
        uniqueLocations,
        totalDistance,
        averageSpeed: trail?.averageSpeed || 0,
        dataQuality: this.calculateDataQuality(rangePoints),
      },
      frequentLocations,
      motionPattern,
      trails: trail ? [trail] : [],
      anomalies,
      dataSources,
      geojson,
    };

    // Cache report
    this.reportCache.set(reportId, report);

    log.info('Intelligence report generated', {
      reportId,
      subject,
      pointCount: rangePoints.length,
      frequentLocations: frequentLocations.length,
      anomalies: anomalies.length,
      processingTime: Date.now() - startTime,
    });

    return report;
  }

  /**
   * Analyze frequent locations (clustering)
   */
  private analyzeFrequentLocations(points: GPSPoint[]): FrequentLocation[] {
    const clusters: Map<string, GPSPoint[]> = new Map();

    for (const point of points) {
      let assigned = false;
      
      for (const cluster of clusters.values()) {
        const center = cluster[0];
        const distance = this.haversineDistance(
          point.latitude, point.longitude,
          center.latitude, center.longitude
        );
        
        if (distance <= DEFAULT_PROCESSING_CONFIG.clusterRadius) {
          cluster.push(point);
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
        clusters.set(key, [point]);
      }
    }

    // Convert clusters to frequent locations
    const frequentLocations: FrequentLocation[] = [];
    
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;

      const sorted = [...cluster].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );
      
      // Calculate average position
      const avgLat = cluster.reduce((sum, p) => sum + p.latitude, 0) / cluster.length;
      const avgLng = cluster.reduce((sum, p) => sum + p.longitude, 0) / cluster.length;

      // Calculate total duration (estimate based on timestamps)
      let totalDuration = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = (sorted[i + 1].timestamp.getTime() - sorted[i].timestamp.getTime()) / 1000;
        if (gap < 3600) { // Only count gaps less than 1 hour
          totalDuration += gap;
        }
      }

      const clusterConfidence =
        cluster.reduce((sum, point) => sum + point.confidence, 0) / cluster.length;
      const clusterAccuracy = Math.max(
        DEFAULT_PROCESSING_CONFIG.clusterRadius,
        ...cluster.map(point => point.accuracy ?? DEFAULT_PROCESSING_CONFIG.clusterRadius)
      );

      frequentLocations.push({
        position: {
          latitude: avgLat,
          longitude: avgLng,
          accuracy: clusterAccuracy,
          timestamp: sorted[sorted.length - 1].timestamp,
          source: 'historical_location',
          confidence: Math.max(0.05, Math.min(0.85, clusterConfidence * 0.8)),
          observationKind: 'inferred',
          correlationGroup: 'report:frequent_location_cluster',
          provenance: {
            provider: 'canonical_geoconsole_report',
            transformedBy: ['spatial_cluster_centroid'],
          },
          metadata: {
            inferredCentroid: true,
            contributingPoints: cluster.length,
          },
        },
        visitCount: cluster.length,
        totalDuration,
        averageVisitDuration: totalDuration / cluster.length,
        firstVisit: sorted[0].timestamp,
        lastVisit: sorted[sorted.length - 1].timestamp,
      });
    }

    return frequentLocations.sort((a, b) => b.visitCount - a.visitCount);
  }

  /**
   * Analyze motion patterns
   */
  private analyzeMotionPattern(points: GPSPoint[], trail?: MotionTrail): MotionPattern {
    let walkingTime = 0;
    let drivingTime = 0;
    let transitTime = 0;

    if (trail) {
      for (const segment of trail.segments) {
        switch (segment.segmentType) {
          case 'walking': walkingTime += Math.max(0, segment.duration); break;
          case 'driving': drivingTime += Math.max(0, segment.duration); break;
          case 'transit': transitTime += Math.max(0, segment.duration); break;
        }
      }
    }

    const totalTime = walkingTime + drivingTime + transitTime;
    let primaryMode: MotionPattern['primaryMode'] = 'mixed';
    if (totalTime > 0) {
      if (walkingTime > totalTime * 0.6) primaryMode = 'walking';
      else if (drivingTime > totalTime * 0.6) primaryMode = 'driving';
      else if (transitTime > totalTime * 0.6) primaryMode = 'transit';
    }

    return {
      primaryMode,
      // Time-of-day routines require a verified target-local timezone. They are
      // intentionally left empty rather than using the server's timezone.
      activityPeriods: [],
      weekdayPattern: {},
      regularRoutes: [],
    };
  }

  /**
   * Detect location anomalies
   */
  private detectAnomalies(points: GPSPoint[], trail?: MotionTrail): LocationAnomaly[] {
    const anomalies: LocationAnomaly[] = [];

    // Detect speed anomalies
    if (trail) {
      for (let i = 1; i < trail.points.length; i++) {
        const speed = trail.points[i].velocity?.speed || 0;
        if (speed > DEFAULT_PROCESSING_CONFIG.anomalySpeedThreshold) {
          anomalies.push({
            type: 'speed_anomaly',
            timestamp: trail.points[i].position.timestamp,
            location: trail.points[i].position,
            description: `Unusually high speed detected: ${(speed * MPS_TO_MPH).toFixed(1)} mph`,
            severity: speed > DEFAULT_PROCESSING_CONFIG.anomalySpeedThreshold * 2 ? 'high' : 'medium',
          });
        }
      }
    }

    // Detect large gaps in data
    const sorted = [...points].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime()) / 3600000;
      if (gap > DEFAULT_PROCESSING_CONFIG.largeGapHours) {
        anomalies.push({
          type: 'gap',
          timestamp: sorted[i - 1].timestamp,
          location: sorted[i - 1],
          description: `${gap.toFixed(1)} hour gap in location data`,
          severity: gap > DEFAULT_PROCESSING_CONFIG.largeGapHours * 2 ? 'high' : 'medium',
        });
      }
    }

    return anomalies.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  /**
   * Summarize data sources
   */
  private summarizeDataSources(points: GPSPoint[]): DataSourceSummary[] {
    const sourceMap: Map<DataSource, GPSPoint[]> = new Map();

    for (const point of points) {
      if (!sourceMap.has(point.source)) {
        sourceMap.set(point.source, []);
      }
      sourceMap.get(point.source)!.push(point);
    }

    const summaries: DataSourceSummary[] = [];
    
    for (const [source, sourcePoints] of sourceMap) {
      const sorted = [...sourcePoints].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );
      
      summaries.push({
        source,
        pointCount: sourcePoints.length,
        averageConfidence: sourcePoints.reduce((sum, p) => sum + p.confidence, 0) / sourcePoints.length,
        timeRange: {
          start: sorted[0].timestamp,
          end: sorted[sorted.length - 1].timestamp,
        },
      });
    }

    return summaries.sort((a, b) => b.pointCount - a.pointCount);
  }

  /**
   * Generate GeoJSON from location data
   */
  private generateGeoJSON(points: GPSPoint[], trail?: MotionTrail): GeoJSONFeatureCollection {
    const features: GeoJSONFeatureCollection['features'] = [];

    for (const point of points) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          timestamp: point.timestamp.toISOString(),
          source: point.source,
          confidence: point.confidence,
          accuracy: point.accuracy,
          observationKind: point.observationKind,
          altitude: point.altitude,
        },
      });
    }

    if (trail && trail.points.length > 1) {
      const segments: TrailPoint[][] = [];
      let segment: TrailPoint[] = [];
      for (const trailPoint of trail.points) {
        const gapBefore = Number(trailPoint.position.metadata?.gapBeforeSeconds || 0);
        if (gapBefore > 0 && segment.length > 0) {
          if (segment.length > 1) segments.push(segment);
          segment = [];
        }
        segment.push(trailPoint);
      }
      if (segment.length > 1) segments.push(segment);

      for (const continuous of segments) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: continuous.map(point => [
              point.position.longitude,
              point.position.latitude,
            ]),
          },
          properties: {
            type: 'motion_trail',
            startTime: continuous[0].position.timestamp.toISOString(),
            endTime: continuous[continuous.length - 1].position.timestamp.toISOString(),
            supportedContinuity: true,
          },
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  // ============ HELPER METHODS ============

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private calculateTotalDistance(points: GPSPoint[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      if (Number(points[i].metadata?.gapBeforeSeconds || 0) > 0) continue;
      total += this.haversineDistance(
        points[i - 1].latitude, points[i - 1].longitude,
        points[i].latitude, points[i].longitude
      );
    }
    return total;
  }

  private countUniqueLocations(points: GPSPoint[], radius: number): number {
    const visited: GPSPoint[] = [];
    
    for (const point of points) {
      let isUnique = true;
      for (const v of visited) {
        if (this.haversineDistance(point.latitude, point.longitude, v.latitude, v.longitude) < radius) {
          isUnique = false;
          break;
        }
      }
      if (isUnique) visited.push(point);
    }
    
    return visited.length;
  }

  private calculateDataQuality(points: GPSPoint[]): number {
    if (points.length === 0) return 0;

    const avgConfidence =
      points.reduce((sum, point) => sum + Math.max(0, Math.min(1, point.confidence)), 0) /
      points.length;
    const independentGroups = new Set(
      points.map(point =>
        point.correlationGroup ||
        `${point.source}:${point.provenance?.provider || 'unknown'}`
      )
    ).size;
    const independenceBonus = Math.min(Math.max(0, independentGroups - 1) * 0.04, 0.12);

    return Math.max(0, Math.min(1, avgConfidence + independenceBonus));
  }

  private emitProgress(taskId: string, stage: string, progress: number, message: string): void {
    const update: ProgressUpdate = {
      taskId,
      stage,
      progress,
      message,
    };
    this.emit('progress', update);
    log.debug('Progress update', update);
  }

  /**
   * Clear all caches (memory management)
   */
  clearCaches(): void {
    this.locationCache.clear();
    this.pathCache.clear();
    this.trailCache.clear();
    this.reportCache.clear();
    log.info('All caches cleared');
  }

  /**
   * Get orchestration state
   */
  getOrchestrationState(): OrchestrationState {
    return { ...this.orchestrationState };
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    timeline?: Partial<TimelineConfig>;
    orchestration?: Partial<GeoconsoleOrchestrationConfig>;
  }): void {
    if (config.timeline) {
      this.timelineConfig = { ...this.timelineConfig, ...config.timeline };
    }
    if (config.orchestration) {
      this.orchestrationConfig = { ...this.orchestrationConfig, ...config.orchestration };
    }
    log.info('Configuration updated', config);
  }
}

// Singleton instance
export const hybridGeoconsole = new HybridGeoconsole();
