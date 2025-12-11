/**
 * Monte Carlo Path Interpolation Engine
 * 
 * Generates probabilistic motion paths between known location points
 * Uses Monte Carlo simulation for realistic trajectory reconstruction
 * Produces weather-radar-style probability heatmaps
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

// Default Monte Carlo configuration
const DEFAULT_CONFIG: MonteCarloConfig = {
  iterations: 1000,
  stepSize: 10, // meters
  maxSpeed: 30, // m/s (~67 mph for driving)
  accelerationVariance: 2, // m/s²
  directionVariance: Math.PI / 6, // 30 degrees
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

/**
 * Monte Carlo Path Interpolation Engine
 */
export class MonteCarloPathEngine {
  private config: MonteCarloConfig;
  private pathCache: Map<string, InterpolatedPath> = new Map();

  constructor(config?: Partial<MonteCarloConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    log.info('MonteCarloPathEngine initialized', this.config);
  }

  /**
   * Interpolate path between two points using Monte Carlo simulation
   */
  async interpolatePath(
    startPoint: GPSPoint,
    endPoint: GPSPoint,
    options?: Partial<MonteCarloConfig>
  ): Promise<InterpolatedPath> {
    const config = { ...this.config, ...options };
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
    const avgSpeed = directDistance / (timeDelta / 1000);

    // Determine if Monte Carlo is needed or if linear interpolation suffices
    if (directDistance < 50 || timeDelta < 60000) {
      // Short distance/time - use linear interpolation
      return this.linearInterpolation(startPoint, endPoint, pathId);
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
        iterations: config.iterations,
        computeTime: Date.now() - startTime,
        pathLength: this.calculatePathLength(interpolatedPoints),
        estimatedDuration: timeDelta / 1000,
      },
    };

    // Cache the result
    const cacheKey = this.getCacheKey(startPoint, endPoint);
    this.pathCache.set(cacheKey, path);

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
  private runSimulations(
    start: GPSPoint,
    end: GPSPoint,
    config: MonteCarloConfig
  ): GPSPoint[][] {
    const simulations: GPSPoint[][] = [];
    const timeDelta = end.timestamp.getTime() - start.timestamp.getTime();
    const steps = Math.ceil(timeDelta / 1000 / (config.stepSize / config.maxSpeed));

    for (let i = 0; i < config.iterations; i++) {
      const path = this.simulateSinglePath(start, end, steps, config);
      simulations.push(path);
    }

    return simulations;
  }

  /**
   * Simulate a single random walk path
   */
  private simulateSinglePath(
    start: GPSPoint,
    end: GPSPoint,
    steps: number,
    config: MonteCarloConfig
  ): GPSPoint[] {
    const path: GPSPoint[] = [start];
    
    let currentLat = start.latitude;
    let currentLng = start.longitude;
    let currentHeading = this.calculateBearing(
      start.latitude, start.longitude,
      end.latitude, end.longitude
    );
    let currentSpeed = config.maxSpeed * 0.5;
    
    const timeDelta = end.timestamp.getTime() - start.timestamp.getTime();
    const timeStep = timeDelta / steps;

    for (let step = 1; step < steps; step++) {
      // Add random variation to heading (biased toward destination)
      const targetBearing = this.calculateBearing(
        currentLat, currentLng,
        end.latitude, end.longitude
      );
      
      // Blend current heading with target heading
      const headingDiff = this.normalizeAngle(targetBearing - currentHeading);
      const blendFactor = 0.3 + Math.random() * 0.4; // 30-70% toward target
      currentHeading += headingDiff * blendFactor;
      
      // Add random heading variation
      currentHeading += (Math.random() - 0.5) * config.directionVariance;
      
      // Add random speed variation
      const speedChange = (Math.random() - 0.5) * config.accelerationVariance;
      currentSpeed = Math.max(0.5, Math.min(config.maxSpeed, currentSpeed + speedChange));
      
      // Calculate distance for this step
      const distance = currentSpeed * (timeStep / 1000);
      
      // Move to new position
      const newPos = this.movePoint(currentLat, currentLng, currentHeading, distance);
      currentLat = newPos.lat;
      currentLng = newPos.lng;
      
      // Create interpolated point
      const timestamp = new Date(start.timestamp.getTime() + step * timeStep);
      path.push({
        latitude: currentLat,
        longitude: currentLng,
        timestamp,
        source: 'interpolated',
        confidence: 0.5 * (1 - step / steps), // Confidence decreases over time
      });
    }

    // Ensure path ends at destination
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
    // Calculate bounds with padding
    const bounds = this.calculateBounds(simulations, start, end);
    const resolution = 20; // meters per cell
    
    // Calculate grid dimensions
    const latRange = bounds.north - bounds.south;
    const lngRange = bounds.east - bounds.west;
    const latCells = Math.ceil(latRange * 111000 / resolution);
    const lngCells = Math.ceil(lngRange * 111000 * Math.cos(start.latitude * Math.PI / 180) / resolution);
    
    // Initialize grid
    const grid: number[][] = Array(latCells).fill(null).map(() => Array(lngCells).fill(0));
    
    // Count visits per cell
    let maxCount = 0;
    let peakLat = start.latitude;
    let peakLng = start.longitude;
    
    for (const path of simulations) {
      for (const point of path) {
        const latIdx = Math.floor((point.latitude - bounds.south) / latRange * (latCells - 1));
        const lngIdx = Math.floor((point.longitude - bounds.west) / lngRange * (lngCells - 1));
        
        if (latIdx >= 0 && latIdx < latCells && lngIdx >= 0 && lngIdx < lngCells) {
          grid[latIdx][lngIdx]++;
          if (grid[latIdx][lngIdx] > maxCount) {
            maxCount = grid[latIdx][lngIdx];
            peakLat = bounds.south + (latIdx + 0.5) * latRange / latCells;
            peakLng = bounds.west + (lngIdx + 0.5) * lngRange / lngCells;
          }
        }
      }
    }
    
    // Normalize to probabilities
    const totalVisits = simulations.length * (simulations[0]?.length || 1);
    for (let i = 0; i < latCells; i++) {
      for (let j = 0; j < lngCells; j++) {
        grid[i][j] = grid[i][j] / totalVisits;
      }
    }
    
    return {
      bounds,
      resolution,
      grid,
      peakProbability: {
        lat: peakLat,
        lng: peakLng,
        value: maxCount / totalVisits,
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
    const latRange = bounds.north - bounds.south;
    const lngRange = bounds.east - bounds.west;
    const latCells = grid.length;
    const lngCells = grid[0]?.length || 1;
    
    for (const point of path) {
      const latIdx = Math.floor((point.latitude - bounds.south) / latRange * (latCells - 1));
      const lngIdx = Math.floor((point.longitude - bounds.west) / lngRange * (lngCells - 1));
      
      if (latIdx >= 0 && latIdx < latCells && lngIdx >= 0 && lngIdx < lngCells) {
        score += grid[latIdx][lngIdx];
      }
    }
    
    return score / path.length;
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
      const avgLng = window.reduce((sum, p) => sum + p.longitude, 0) / window.length;
      
      smoothed.push({
        ...path[i],
        latitude: avgLat,
        longitude: avgLng,
      });
    }
    
    smoothed.push(path[path.length - 1]);
    return smoothed;
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
    const timeDelta = end.timestamp.getTime() - start.timestamp.getTime();
    
    for (let i = 1; i < numSteps; i++) {
      const t = i / numSteps;
      points.push({
        latitude: start.latitude + (end.latitude - start.latitude) * t,
        longitude: start.longitude + (end.longitude - start.longitude) * t,
        timestamp: new Date(start.timestamp.getTime() + timeDelta * t),
        source: 'interpolated',
        confidence: 0.8,
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
        resolution: 10,
        grid: [[1]],
        peakProbability: {
          lat: (start.latitude + end.latitude) / 2,
          lng: (start.longitude + end.longitude) / 2,
          value: 1,
        },
      },
      confidence: 0.9,
      method: 'linear',
      metadata: {
        iterations: 1,
        computeTime: 1,
        pathLength: this.haversineDistance(
          start.latitude, start.longitude,
          end.latitude, end.longitude
        ),
        estimatedDuration: timeDelta / 1000,
      },
    };
  }

  /**
   * Generate complete motion trail from points
   */
  async generateMotionTrail(points: GPSPoint[]): Promise<MotionTrail> {
    if (points.length < 2) {
      throw new Error('At least 2 points required for motion trail');
    }

    const trailId = randomUUID();
    const sortedPoints = [...points].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    const trailPoints: TrailPoint[] = [];
    const segments: TrailSegment[] = [];
    const stops: StopPoint[] = [];
    
    let totalDistance = 0;
    let currentSegmentStart = 0;
    let currentSegmentType: TrailSegment['segmentType'] = 'unknown';

    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      let speed = 0;
      let heading = 0;

      if (i > 0) {
        const prevPoint = sortedPoints[i - 1];
        const distance = this.haversineDistance(
          prevPoint.latitude, prevPoint.longitude,
          point.latitude, point.longitude
        );
        const timeDelta = (point.timestamp.getTime() - prevPoint.timestamp.getTime()) / 1000;
        
        speed = timeDelta > 0 ? distance / timeDelta : 0;
        heading = this.calculateBearing(
          prevPoint.latitude, prevPoint.longitude,
          point.latitude, point.longitude
        );
        totalDistance += distance;

        // Detect activity type changes
        const newType = this.classifyActivity(speed);
        if (newType !== currentSegmentType && i > 0) {
          segments.push(this.createSegment(
            sortedPoints,
            currentSegmentStart,
            i - 1,
            currentSegmentType
          ));
          currentSegmentStart = i;
          currentSegmentType = newType;
        }

        // Detect stops
        if (speed < SPEED_THRESHOLDS.stationary && i > 1) {
          const prevSpeed = this.calculateSpeed(sortedPoints[i - 2], sortedPoints[i - 1]);
          if (prevSpeed >= SPEED_THRESHOLDS.stationary) {
            stops.push({
              position: point,
              arrivalTime: point.timestamp,
              duration: 0,
            });
          }
        }
      }

      // Calculate opacity for trail fade effect
      const age = Date.now() - point.timestamp.getTime();
      const maxAge = 3 * 24 * 60 * 60 * 1000; // 3 days
      const opacity = Math.max(0.1, 1 - age / maxAge);

      trailPoints.push({
        position: point,
        velocity: { speed, heading },
        interpolated: point.source === 'interpolated',
        opacity,
        color: this.getSpeedColor(speed),
      });
    }

    // Add final segment
    if (sortedPoints.length > 1) {
      segments.push(this.createSegment(
        sortedPoints,
        currentSegmentStart,
        sortedPoints.length - 1,
        currentSegmentType
      ));
    }

    // Update stop durations
    for (let i = 0; i < stops.length - 1; i++) {
      stops[i].duration = (stops[i + 1].arrivalTime.getTime() - stops[i].arrivalTime.getTime()) / 1000;
    }

    const duration = (sortedPoints[sortedPoints.length - 1].timestamp.getTime() -
                     sortedPoints[0].timestamp.getTime()) / 1000;

    return {
      id: trailId,
      points: trailPoints,
      startTime: sortedPoints[0].timestamp,
      endTime: sortedPoints[sortedPoints.length - 1].timestamp,
      totalDistance,
      averageSpeed: duration > 0 ? totalDistance / duration : 0,
      maxSpeed: Math.max(...trailPoints.map(p => p.velocity?.speed || 0)),
      stops,
      segments,
    };
  }

  /**
   * Generate futurecast prediction
   */
  async generateFuturecast(
    recentPoints: GPSPoint[],
    hours: number = 6
  ): Promise<GPSPoint[]> {
    if (recentPoints.length < 3) return [];

    const sorted = [...recentPoints].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
    
    const recent = sorted.slice(0, Math.min(10, sorted.length));
    
    // Calculate average velocity
    let totalSpeed = 0;
    let avgHeading = 0;
    
    for (let i = 0; i < recent.length - 1; i++) {
      totalSpeed += this.calculateSpeed(recent[i + 1], recent[i]);
      avgHeading += this.calculateBearing(
        recent[i + 1].latitude, recent[i + 1].longitude,
        recent[i].latitude, recent[i].longitude
      );
    }
    
    const avgSpeed = totalSpeed / (recent.length - 1);
    avgHeading = avgHeading / (recent.length - 1);

    // Generate future points
    const futurePoints: GPSPoint[] = [];
    let currentPos = recent[0];
    const stepMinutes = 15;
    const steps = (hours * 60) / stepMinutes;

    for (let i = 1; i <= steps; i++) {
      const distance = avgSpeed * stepMinutes * 60;
      const newPos = this.movePoint(
        currentPos.latitude,
        currentPos.longitude,
        avgHeading,
        distance
      );

      const futurePoint: GPSPoint = {
        latitude: newPos.lat,
        longitude: newPos.lng,
        timestamp: new Date(currentPos.timestamp.getTime() + stepMinutes * 60 * 1000 * i),
        source: 'interpolated',
        confidence: Math.max(0.1, 0.8 - i * 0.1),
      };

      futurePoints.push(futurePoint);
      currentPos = futurePoint;
    }

    return futurePoints;
  }

  // ============ HELPER METHODS ============

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    return Math.atan2(y, x);
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  private movePoint(lat: number, lng: number, bearing: number, distance: number): { lat: number; lng: number } {
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lng * Math.PI) / 180;
    const d = distance / EARTH_RADIUS;

    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(d) +
      Math.cos(φ1) * Math.sin(d) * Math.cos(bearing)
    );
    
    const λ2 = λ1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
    );

    return {
      lat: (φ2 * 180) / Math.PI,
      lng: (λ2 * 180) / Math.PI,
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
    if (speed < SPEED_THRESHOLDS.cycling) return 'walking';
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
          if (dist < 50) matches++;
        }
      }
      if (matches / path.length > 0.8) consistentPaths++;
    }
    
    return consistentPaths / simulations.length;
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
    let north = Math.max(start.latitude, end.latitude);
    let south = Math.min(start.latitude, end.latitude);
    let east = Math.max(start.longitude, end.longitude);
    let west = Math.min(start.longitude, end.longitude);

    for (const path of simulations) {
      for (const point of path) {
        north = Math.max(north, point.latitude);
        south = Math.min(south, point.latitude);
        east = Math.max(east, point.longitude);
        west = Math.min(west, point.longitude);
      }
    }

    // Add 10% padding
    const latPad = (north - south) * 0.1;
    const lngPad = (east - west) * 0.1;

    return {
      north: north + latPad,
      south: south - latPad,
      east: east + lngPad,
      west: west - lngPad,
    };
  }

  private calculateBoundsFromPoints(points: GPSPoint[]): BoundingBox {
    let north = -90, south = 90, east = -180, west = 180;
    
    for (const point of points) {
      north = Math.max(north, point.latitude);
      south = Math.min(south, point.latitude);
      east = Math.max(east, point.longitude);
      west = Math.min(west, point.longitude);
    }

    return { north, south, east, west };
  }

  private getCacheKey(start: GPSPoint, end: GPSPoint): string {
    return `${start.latitude.toFixed(6)},${start.longitude.toFixed(6)}-${end.latitude.toFixed(6)},${end.longitude.toFixed(6)}-${start.timestamp.getTime()}-${end.timestamp.getTime()}`;
  }
}

export const monteCarloPathEngine = new MonteCarloPathEngine();
