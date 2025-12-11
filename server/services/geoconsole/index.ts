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
  LocationIntelligenceReport,
  GeoconsoleOrchestrationConfig,
  OrchestrationState,
  ProgressUpdate,
  BoundingBox,
  GeoJSONFeatureCollection,
  FrequentLocation,
  MotionPattern,
  LocationAnomaly,
  DataSourceSummary,
} from './types';
import { InputFusionEngine } from './inputFusionEngine';
import { MonteCarloPathEngine } from './monteCarloPathEngine';
import { createLogger } from '../../logger';

const log = createLogger('HybridGeoconsole');

// Default timeline configuration
const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  historyDays: 3,
  futurecastHours: 6,
  playbackSpeed: 60, // 1 minute = 1 second
  animationFps: 30,
  trailFadeSeconds: 86400, // 24 hours
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
    
    this.inputFusionEngine = new InputFusionEngine(fusionConfig);
    this.monteCarloEngine = new MonteCarloPathEngine(monteCarloConfig);
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

  /**
   * Process raw location inputs through the full pipeline
   */
  async processLocationData(
    inputs: GPSPoint[],
    sessionId?: string
  ): Promise<{
    fusedLocations: FusedLocation[];
    trail: MotionTrail;
    futurecast: GPSPoint[];
  }> {
    const taskId = sessionId || randomUUID();
    const startTime = Date.now();

    this.emitProgress(taskId, 'fusion', 0, 'Starting multimodal input fusion...');
    
    try {
      // Step 1: Fuse inputs from multiple sources
      this.emitProgress(taskId, 'fusion', 20, 'Fusing location data from multiple sources...');
      const fusedLocations = await this.inputFusionEngine.fuseInputs(inputs);
      
      if (fusedLocations.length === 0) {
        throw new Error('No valid locations after fusion');
      }

      // Step 2: Generate motion trail with interpolation
      this.emitProgress(taskId, 'interpolation', 40, 'Running Monte Carlo path interpolation...');
      const sortedPoints = fusedLocations
        .map(f => f.point)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Interpolate gaps in the data
      const interpolatedPoints = await this.interpolateGaps(sortedPoints);
      
      // Step 3: Generate motion trail
      this.emitProgress(taskId, 'trail', 60, 'Generating motion trail...');
      const trail = await this.monteCarloEngine.generateMotionTrail(interpolatedPoints);
      
      // Step 4: Generate futurecast
      this.emitProgress(taskId, 'futurecast', 80, 'Computing futurecast prediction...');
      const recentPoints = interpolatedPoints.slice(-20);
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
        fusedCount: fusedLocations.length,
        trailPoints: trail.points.length,
        futurecastPoints: futurecast.length,
        processingTime: Date.now() - startTime,
      });

      return { fusedLocations, trail, futurecast };
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
    const maxGapMinutes = 30; // Interpolate gaps longer than 30 minutes

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const gapMinutes = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 60000;

      if (gapMinutes > maxGapMinutes) {
        // Run Monte Carlo interpolation for this gap
        const path = await this.monteCarloEngine.interpolatePath(prev, curr);
        
        // Add interpolated points (excluding start and end)
        for (let j = 1; j < path.interpolatedPoints.length - 1; j++) {
          result.push(path.interpolatedPoints[j]);
        }
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
    const clusterRadius = 50; // meters

    for (const point of points) {
      let assigned = false;
      
      for (const [key, cluster] of clusters) {
        const center = cluster[0];
        const distance = this.haversineDistance(
          point.latitude, point.longitude,
          center.latitude, center.longitude
        );
        
        if (distance <= clusterRadius) {
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

      frequentLocations.push({
        position: {
          latitude: avgLat,
          longitude: avgLng,
          timestamp: sorted[0].timestamp,
          source: 'device_gps',
          confidence: 0.9,
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
    // Determine primary mode of transport
    let walkingTime = 0, drivingTime = 0, transitTime = 0, stationaryTime = 0;
    
    if (trail) {
      for (const segment of trail.segments) {
        switch (segment.segmentType) {
          case 'walking': walkingTime += segment.duration; break;
          case 'driving': drivingTime += segment.duration; break;
          case 'transit': transitTime += segment.duration; break;
          case 'stationary': stationaryTime += segment.duration; break;
        }
      }
    }

    const totalTime = walkingTime + drivingTime + transitTime;
    let primaryMode: MotionPattern['primaryMode'] = 'mixed';
    
    if (walkingTime > totalTime * 0.6) primaryMode = 'walking';
    else if (drivingTime > totalTime * 0.6) primaryMode = 'driving';
    else if (transitTime > totalTime * 0.6) primaryMode = 'transit';

    // Analyze activity by hour of day
    const hourlyActivity: number[] = Array(24).fill(0);
    for (const point of points) {
      const hour = point.timestamp.getHours();
      hourlyActivity[hour]++;
    }

    // Find active periods
    const activityPeriods: { start: number; end: number; activity: string }[] = [];
    let periodStart = -1;
    
    for (let h = 0; h < 24; h++) {
      if (hourlyActivity[h] > 0 && periodStart === -1) {
        periodStart = h;
      } else if (hourlyActivity[h] === 0 && periodStart !== -1) {
        activityPeriods.push({
          start: periodStart,
          end: h,
          activity: primaryMode,
        });
        periodStart = -1;
      }
    }
    
    if (periodStart !== -1) {
      activityPeriods.push({
        start: periodStart,
        end: 24,
        activity: primaryMode,
      });
    }

    // Analyze by day of week
    const weekdayPattern: Record<string, number[]> = {};
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (const point of points) {
      const day = days[point.timestamp.getDay()];
      const hour = point.timestamp.getHours();
      
      if (!weekdayPattern[day]) {
        weekdayPattern[day] = Array(24).fill(0);
      }
      weekdayPattern[day][hour]++;
    }

    return {
      primaryMode,
      activityPeriods,
      weekdayPattern,
      regularRoutes: [], // Would require more complex analysis
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
        if (speed > 50) { // > 50 m/s = ~112 mph
          anomalies.push({
            type: 'speed_anomaly',
            timestamp: trail.points[i].position.timestamp,
            location: trail.points[i].position,
            description: `Unusually high speed detected: ${(speed * 2.237).toFixed(1)} mph`,
            severity: speed > 100 ? 'high' : 'medium',
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
      if (gap > 12) { // > 12 hour gap
        anomalies.push({
          type: 'gap',
          timestamp: sorted[i - 1].timestamp,
          location: sorted[i - 1],
          description: `${gap.toFixed(1)} hour gap in location data`,
          severity: gap > 24 ? 'high' : 'medium',
        });
      }
    }

    // Detect unusual times (late night activity if unusual)
    const lateNightPoints = points.filter(p => {
      const hour = p.timestamp.getHours();
      return hour >= 1 && hour <= 5;
    });

    if (lateNightPoints.length > 0 && lateNightPoints.length < points.length * 0.1) {
      for (const point of lateNightPoints) {
        anomalies.push({
          type: 'unusual_time',
          timestamp: point.timestamp,
          location: point,
          description: 'Activity detected during unusual hours (1-5 AM)',
          severity: 'low',
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

    // Add point features
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
          altitude: point.altitude,
        },
      });
    }

    // Add trail as LineString
    if (trail && trail.points.length > 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: trail.points.map(p => [
            p.position.longitude,
            p.position.latitude,
          ]),
        },
        properties: {
          type: 'motion_trail',
          startTime: trail.startTime.toISOString(),
          endTime: trail.endTime.toISOString(),
          totalDistance: trail.totalDistance,
          averageSpeed: trail.averageSpeed,
        },
      });
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

    const avgConfidence = points.reduce((sum, p) => sum + p.confidence, 0) / points.length;
    const sources = new Set(points.map(p => p.source)).size;
    const sourceBonus = Math.min(sources * 0.1, 0.3);
    
    return Math.min(avgConfidence + sourceBonus, 1);
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
