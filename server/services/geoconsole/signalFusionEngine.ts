/**
 * Advanced Signal Fusion Engine
 * 
 * Multi-source location fusion with sandbox simulation capabilities:
 * - Triangulation from GPS pings, Wi-Fi, cell towers
 * - Time-of-day pattern analysis
 * - Known facility geometry integration
 * - Public data feed integration (compliant sources only)
 * - Monte Carlo path prediction
 * - Pattern detection and anomaly spotting
 * 
 * Includes sandbox mode for testing with simulated city data
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../../logger';

const log = createLogger('SignalFusionEngine');

// ═══════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════

export interface SignalSource {
  type: 'gps' | 'wifi' | 'cell' | 'ip' | 'checkin' | 'camera' | 'manual';
  id: string;
  timestamp: Date;
  lat: number;
  lng: number;
  accuracy: number; // meters
  confidence: number; // 0-1
  metadata?: Record<string, unknown>;
}

export interface FusedPosition {
  lat: number;
  lng: number;
  accuracy: number;
  confidence: number;
  timestamp: Date;
  sources: SignalSource[];
  fusionMethod: 'weighted' | 'kalman' | 'particle';
}

export interface TimePattern {
  hour: number;
  dayOfWeek: number;
  frequency: number;
  locations: { lat: number; lng: number }[];
}

export interface FacilityGeometry {
  id: string;
  name: string;
  type: 'building' | 'parking' | 'campus' | 'transit';
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  floors?: number;
  entrances?: { lat: number; lng: number }[];
}

export interface MovementAnomaly {
  type: 'speed' | 'teleport' | 'pattern_break' | 'impossible';
  timestamp: Date;
  description: string;
  severity: 'low' | 'medium' | 'high';
  position?: FusedPosition;
}

export interface PredictedPath {
  id: string;
  probability: number;
  waypoints: FusedPosition[];
  estimatedArrival?: Date;
  confidence: number;
}

export interface SignalFusionConfig {
  // Fusion algorithm weights
  weights: {
    gps: number;
    wifi: number;
    cell: number;
    ip: number;
    checkin: number;
    camera: number;
    manual: number;
  };
  // Kalman filter parameters
  kalman: {
    processNoise: number;
    measurementNoise: number;
    initialCovariance: number;
  };
  // Monte Carlo parameters
  monteCarlo: {
    simulations: number;
    timeStepMs: number;
    maxSpeedMps: number;
  };
  // Anomaly detection thresholds
  anomalyThresholds: {
    maxSpeedMps: number; // Max realistic speed
    teleportDistanceM: number; // Min distance for teleport detection
    patternDeviationStd: number; // Standard deviations for pattern break
  };
  // Sandbox mode
  sandboxEnabled: boolean;
}

// ═══════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════

const DEFAULT_CONFIG: SignalFusionConfig = {
  weights: {
    gps: 1.0,
    wifi: 0.7,
    cell: 0.5,
    ip: 0.2,
    checkin: 0.8,
    camera: 0.9,
    manual: 0.95,
  },
  kalman: {
    processNoise: 0.01,
    measurementNoise: 1.0,
    initialCovariance: 1.0,
  },
  monteCarlo: {
    simulations: 500,
    timeStepMs: 60000, // 1 minute
    maxSpeedMps: 35, // ~78 mph
  },
  anomalyThresholds: {
    maxSpeedMps: 45, // ~100 mph
    teleportDistanceM: 10000, // 10 km
    patternDeviationStd: 3.0,
  },
  sandboxEnabled: false,
};

// ═══════════════════════════════════════════════════════
// EARTH CONSTANTS
// ═══════════════════════════════════════════════════════

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
/** Approximate meters per degree at equator for rough conversions */
const METERS_PER_DEGREE = 111000;

// ═══════════════════════════════════════════════════════
// SIGNAL FUSION ENGINE CLASS
// ═══════════════════════════════════════════════════════

export class SignalFusionEngine extends EventEmitter {
  private config: SignalFusionConfig;
  
  // Signal storage
  private signals: Map<string, SignalSource[]> = new Map();
  private fusedPositions: Map<string, FusedPosition[]> = new Map();
  
  // Pattern storage - using Map<targetId, Map<patternKey, TimePattern>> for O(1) lookups
  private timePatterns: Map<string, Map<string, TimePattern>> = new Map();
  private facilityGeometry: Map<string, FacilityGeometry> = new Map();
  
  // Kalman filter state per target
  private kalmanState: Map<string, KalmanState> = new Map();
  
  // Sandbox simulation
  private sandboxData: SandboxCity | null = null;

  constructor(config?: Partial<SignalFusionConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    log.info('SignalFusionEngine initialized', {
      sandboxEnabled: this.config.sandboxEnabled,
      simulations: this.config.monteCarlo.simulations,
    });
  }

  /** Generate composite key for time pattern lookup */
  private getPatternKey(hour: number, dayOfWeek: number): string {
    return `${hour}-${dayOfWeek}`;
  }

  // ═══════════════════════════════════════════════════════
  // SIGNAL INGESTION
  // ═══════════════════════════════════════════════════════

  /**
   * Ingest a new signal source
   */
  ingestSignal(targetId: string, signal: SignalSource): void {
    if (!this.signals.has(targetId)) {
      this.signals.set(targetId, []);
    }
    
    const signals = this.signals.get(targetId)!;
    signals.push(signal);
    
    // Keep last 1000 signals per target
    if (signals.length > 1000) {
      signals.shift();
    }
    
    // Update Kalman filter
    this.updateKalmanFilter(targetId, signal);
    
    // Check for anomalies
    this.detectAnomalies(targetId, signal);
    
    // Update time patterns
    this.updateTimePatterns(targetId, signal);
    
    this.emit('signal-ingested', { targetId, signal });
  }

  /**
   * Ingest multiple signals at once
   */
  ingestSignals(targetId: string, signals: SignalSource[]): void {
    for (const signal of signals) {
      this.ingestSignal(targetId, signal);
    }
  }

  // ═══════════════════════════════════════════════════════
  // POSITION FUSION
  // ═══════════════════════════════════════════════════════

  /**
   * Fuse signals into a single position estimate
   */
  fusePosition(targetId: string, timeWindow?: { start: Date; end: Date }): FusedPosition | null {
    const signals = this.getSignalsInWindow(targetId, timeWindow);
    
    if (signals.length === 0) {
      return null;
    }
    
    // Use Kalman filter for best estimate
    const kalman = this.kalmanState.get(targetId);
    if (kalman) {
      return this.createFusedPositionFromKalman(targetId, kalman, signals);
    }
    
    // Fallback to weighted average
    return this.weightedAverageFusion(signals);
  }

  /**
   * Weighted average fusion of multiple signals
   */
  private weightedAverageFusion(signals: SignalSource[]): FusedPosition {
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let minAccuracy = Infinity;
    
    for (const signal of signals) {
      const weight = this.config.weights[signal.type] * signal.confidence;
      totalWeight += weight;
      weightedLat += signal.lat * weight;
      weightedLng += signal.lng * weight;
      minAccuracy = Math.min(minAccuracy, signal.accuracy);
    }
    
    const lat = weightedLat / totalWeight;
    const lng = weightedLng / totalWeight;
    
    return {
      lat,
      lng,
      accuracy: minAccuracy,
      confidence: Math.min(1.0, totalWeight / signals.length),
      timestamp: new Date(),
      sources: signals,
      fusionMethod: 'weighted',
    };
  }

  // ═══════════════════════════════════════════════════════
  // KALMAN FILTER
  // ═══════════════════════════════════════════════════════

  /**
   * Update Kalman filter with new measurement
   */
  private updateKalmanFilter(targetId: string, signal: SignalSource): void {
    let state = this.kalmanState.get(targetId);
    
    if (!state) {
      // Initialize Kalman state
      state = {
        x: signal.lat,
        y: signal.lng,
        vx: 0,
        vy: 0,
        P: [
          [this.config.kalman.initialCovariance, 0, 0, 0],
          [0, this.config.kalman.initialCovariance, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ],
        lastUpdate: signal.timestamp,
      };
      this.kalmanState.set(targetId, state);
      return;
    }
    
    // Time since last update
    const dt = (signal.timestamp.getTime() - state.lastUpdate.getTime()) / 1000;
    if (dt <= 0) return;
    
    // Predict step
    const q = this.config.kalman.processNoise;
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    
    const Q = [
      [q * dt * dt / 4, 0, q * dt / 2, 0],
      [0, q * dt * dt / 4, 0, q * dt / 2],
      [q * dt / 2, 0, q, 0],
      [0, q * dt / 2, 0, q],
    ];
    
    // Predicted state
    const xPred = state.x + state.vx * dt;
    const yPred = state.y + state.vy * dt;
    
    // Predicted covariance
    const P_pred = this.matrixAdd(
      this.matrixMultiply(this.matrixMultiply(F, state.P), this.transpose(F)),
      Q
    );
    
    // Update step
    const weight = this.config.weights[signal.type] * signal.confidence;
    const R = this.config.kalman.measurementNoise / weight;
    
    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    
    const y = [signal.lat - xPred, signal.lng - yPred];
    
    const S = this.matrixAdd(
      this.matrixMultiply(this.matrixMultiply(H, P_pred), this.transpose(H)),
      [[R, 0], [0, R]]
    );
    
    const K = this.matrixMultiply(
      this.matrixMultiply(P_pred, this.transpose(H)),
      this.matrixInverse2x2(S)
    );
    
    // Update state
    state.x = xPred + K[0][0] * y[0] + K[0][1] * y[1];
    state.y = yPred + K[1][0] * y[0] + K[1][1] * y[1];
    state.vx = state.vx + K[2][0] * y[0] + K[2][1] * y[1];
    state.vy = state.vy + K[3][0] * y[0] + K[3][1] * y[1];
    
    // Update covariance
    const I_KH = this.matrixSubtract(
      [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      this.matrixMultiply(K, H)
    );
    state.P = this.matrixMultiply(I_KH, P_pred);
    state.lastUpdate = signal.timestamp;
  }

  private createFusedPositionFromKalman(
    targetId: string,
    kalman: KalmanState,
    signals: SignalSource[]
  ): FusedPosition {
    // Convert covariance to meters using METERS_PER_DEGREE
    const accuracy = Math.sqrt(kalman.P[0][0] + kalman.P[1][1]) * METERS_PER_DEGREE;
    
    return {
      lat: kalman.x,
      lng: kalman.y,
      accuracy: Math.max(1, accuracy),
      confidence: Math.min(1.0, 1 / (1 + accuracy / 100)),
      timestamp: kalman.lastUpdate,
      sources: signals,
      fusionMethod: 'kalman',
    };
  }

  // ═══════════════════════════════════════════════════════
  // PATTERN DETECTION
  // ═══════════════════════════════════════════════════════

  /**
   * Update time patterns from new signal
   */
  private updateTimePatterns(targetId: string, signal: SignalSource): void {
    if (!this.timePatterns.has(targetId)) {
      this.timePatterns.set(targetId, new Map());
    }
    
    const patterns = this.timePatterns.get(targetId)!;
    const hour = signal.timestamp.getHours();
    const dayOfWeek = signal.timestamp.getDay();
    const key = this.getPatternKey(hour, dayOfWeek);
    
    // O(1) lookup using composite key
    let pattern = patterns.get(key);
    
    if (!pattern) {
      pattern = { hour, dayOfWeek, frequency: 0, locations: [] };
      patterns.set(key, pattern);
    }
    
    pattern.frequency++;
    pattern.locations.push({ lat: signal.lat, lng: signal.lng });
    
    // Keep last 100 locations per pattern
    if (pattern.locations.length > 100) {
      pattern.locations.shift();
    }
  }

  /**
   * Get predicted location based on time patterns
   */
  getPredictedLocationFromPatterns(targetId: string, time?: Date): { lat: number; lng: number; confidence: number } | null {
    const patterns = this.timePatterns.get(targetId);
    if (!patterns || patterns.size === 0) return null;
    
    const t = time || new Date();
    const hour = t.getHours();
    const dayOfWeek = t.getDay();
    const key = this.getPatternKey(hour, dayOfWeek);
    
    // O(1) lookup
    const pattern = patterns.get(key);
    if (!pattern || pattern.locations.length === 0) return null;
    
    // Calculate centroid of pattern locations
    const centroid = pattern.locations.reduce(
      (acc, loc) => ({ lat: acc.lat + loc.lat, lng: acc.lng + loc.lng }),
      { lat: 0, lng: 0 }
    );
    
    return {
      lat: centroid.lat / pattern.locations.length,
      lng: centroid.lng / pattern.locations.length,
      confidence: Math.min(1.0, pattern.frequency / 10),
    };
  }

  // ═══════════════════════════════════════════════════════
  // ANOMALY DETECTION
  // ═══════════════════════════════════════════════════════

  /**
   * Detect movement anomalies
   */
  private detectAnomalies(targetId: string, signal: SignalSource): void {
    const signals = this.signals.get(targetId);
    if (!signals || signals.length < 2) return;
    
    const prevSignal = signals[signals.length - 2];
    const timeDiff = (signal.timestamp.getTime() - prevSignal.timestamp.getTime()) / 1000;
    
    if (timeDiff <= 0) return;
    
    const distance = this.haversineDistance(
      prevSignal.lat, prevSignal.lng,
      signal.lat, signal.lng
    );
    
    const speed = distance / timeDiff;
    
    // Check for speed anomaly
    if (speed > this.config.anomalyThresholds.maxSpeedMps) {
      const anomaly: MovementAnomaly = {
        type: 'speed',
        timestamp: signal.timestamp,
        description: `Excessive speed detected: ${(speed * 2.237).toFixed(1)} mph`,
        severity: speed > this.config.anomalyThresholds.maxSpeedMps * 2 ? 'high' : 'medium',
      };
      this.emit('anomaly-detected', { targetId, anomaly });
    }
    
    // Check for teleport
    if (distance > this.config.anomalyThresholds.teleportDistanceM && timeDiff < 60) {
      const anomaly: MovementAnomaly = {
        type: 'teleport',
        timestamp: signal.timestamp,
        description: `Possible teleport: ${(distance / 1000).toFixed(1)} km in ${timeDiff.toFixed(0)}s`,
        severity: 'high',
      };
      this.emit('anomaly-detected', { targetId, anomaly });
    }
  }

  // ═══════════════════════════════════════════════════════
  // MONTE CARLO PATH PREDICTION
  // ═══════════════════════════════════════════════════════

  /**
   * Generate predicted paths using Monte Carlo simulation
   */
  predictPaths(targetId: string, durationMs: number = 3600000): PredictedPath[] {
    const kalman = this.kalmanState.get(targetId);
    if (!kalman) return [];
    
    const paths: Map<string, { waypoints: FusedPosition[]; count: number }> = new Map();
    const { simulations, timeStepMs, maxSpeedMps } = this.config.monteCarlo;
    const steps = Math.ceil(durationMs / timeStepMs);
    
    for (let sim = 0; sim < simulations; sim++) {
      const waypoints: FusedPosition[] = [];
      let lat = kalman.x;
      let lng = kalman.y;
      let vx = kalman.vx;
      let vy = kalman.vy;
      
      for (let step = 0; step < steps; step++) {
        // Add random noise to velocity
        vx += (Math.random() - 0.5) * 0.0001;
        vy += (Math.random() - 0.5) * 0.0001;
        
        // Clamp speed (convert degree/s to m/s using METERS_PER_DEGREE)
        const speed = Math.sqrt(vx * vx + vy * vy) * METERS_PER_DEGREE;
        if (speed > maxSpeedMps) {
          const scale = maxSpeedMps / speed;
          vx *= scale;
          vy *= scale;
        }
        
        // Update position
        lat += vx * (timeStepMs / 1000);
        lng += vy * (timeStepMs / 1000);
        
        waypoints.push({
          lat,
          lng,
          accuracy: 50,
          confidence: 0.5,
          timestamp: new Date(Date.now() + step * timeStepMs),
          sources: [],
          fusionMethod: 'particle',
        });
      }
      
      // Discretize final position to cluster paths
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      const existing = paths.get(key);
      if (existing) {
        existing.count++;
      } else {
        paths.set(key, { waypoints, count: 1 });
      }
    }
    
    // Convert to predicted paths
    const result: PredictedPath[] = [];
    for (const [key, data] of paths.entries()) {
      result.push({
        id: randomUUID(),
        probability: data.count / simulations,
        waypoints: data.waypoints,
        confidence: data.count / simulations,
      });
    }
    
    // Sort by probability and return top 10
    return result.sort((a, b) => b.probability - a.probability).slice(0, 10);
  }

  // ═══════════════════════════════════════════════════════
  // FACILITY GEOMETRY
  // ═══════════════════════════════════════════════════════

  /**
   * Register facility geometry for improved accuracy
   */
  registerFacility(facility: FacilityGeometry): void {
    this.facilityGeometry.set(facility.id, facility);
    log.info('Facility registered', { id: facility.id, name: facility.name });
  }

  /**
   * Check if position is within a known facility
   */
  findContainingFacility(lat: number, lng: number): FacilityGeometry | null {
    for (const [, facility] of this.facilityGeometry) {
      if (
        lat >= facility.bounds.south &&
        lat <= facility.bounds.north &&
        lng >= facility.bounds.west &&
        lng <= facility.bounds.east
      ) {
        return facility;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════
  // SANDBOX SIMULATION
  // ═══════════════════════════════════════════════════════

  /**
   * Enable sandbox mode with simulated city data
   */
  enableSandbox(city: SandboxCity): void {
    this.sandboxData = city;
    this.config.sandboxEnabled = true;
    log.info('Sandbox mode enabled', { city: city.name });
    
    // Register sandbox facilities
    for (const facility of city.facilities) {
      this.registerFacility(facility);
    }
  }

  /**
   * Disable sandbox mode
   */
  disableSandbox(): void {
    this.sandboxData = null;
    this.config.sandboxEnabled = false;
    log.info('Sandbox mode disabled');
  }

  /**
   * Generate simulated signals for testing
   */
  generateSandboxSignals(targetId: string, count: number = 100): SignalSource[] {
    if (!this.sandboxData) {
      throw new Error('Sandbox mode not enabled');
    }
    
    const signals: SignalSource[] = [];
    const city = this.sandboxData;
    
    // Start at a random base station
    let currentLat = city.center.lat + (Math.random() - 0.5) * 0.05;
    let currentLng = city.center.lng + (Math.random() - 0.5) * 0.05;
    let currentTime = Date.now() - count * 60000; // Start in the past
    
    for (let i = 0; i < count; i++) {
      // Simulate movement
      currentLat += (Math.random() - 0.5) * 0.002;
      currentLng += (Math.random() - 0.5) * 0.002;
      currentTime += 60000 + Math.random() * 120000; // 1-3 minutes between signals
      
      // Choose random signal type
      const types: SignalSource['type'][] = ['gps', 'wifi', 'cell'];
      const type = types[Math.floor(Math.random() * types.length)];
      
      const signal: SignalSource = {
        type,
        id: randomUUID(),
        timestamp: new Date(currentTime),
        lat: currentLat,
        lng: currentLng,
        accuracy: type === 'gps' ? 10 : type === 'wifi' ? 30 : 100,
        confidence: 0.7 + Math.random() * 0.3,
        metadata: {
          sandboxGenerated: true,
          city: city.name,
        },
      };
      
      signals.push(signal);
    }
    
    return signals;
  }

  // ═══════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════

  private getSignalsInWindow(
    targetId: string,
    timeWindow?: { start: Date; end: Date }
  ): SignalSource[] {
    const signals = this.signals.get(targetId) || [];
    
    if (!timeWindow) {
      // Return last 5 minutes of signals
      const cutoff = Date.now() - 5 * 60 * 1000;
      return signals.filter(s => s.timestamp.getTime() > cutoff);
    }
    
    return signals.filter(
      s => s.timestamp >= timeWindow.start && s.timestamp <= timeWindow.end
    );
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = (lat2 - lat1) * DEG_TO_RAD;
    const dLng = (lng2 - lng1) * DEG_TO_RAD;
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * DEG_TO_RAD) *
        Math.cos(lat2 * DEG_TO_RAD) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return EARTH_RADIUS_M * c;
  }

  // Matrix operations for Kalman filter with boundary validation
  private matrixMultiply(A: number[][], B: number[][]): number[][] {
    // Validate matrices
    if (!A || !A.length || !A[0] || !B || !B.length || !B[0]) {
      return [];
    }
    
    const rowsA = A.length;
    const colsA = A[0].length;
    const rowsB = B.length;
    const colsB = B[0].length;
    
    // Validate dimensions match for multiplication
    if (colsA !== rowsB) {
      log.warn('Matrix multiplication dimension mismatch', { colsA, rowsB });
      return [];
    }
    
    const result: number[][] = [];
    
    for (let i = 0; i < rowsA; i++) {
      result[i] = [];
      for (let j = 0; j < colsB; j++) {
        result[i][j] = 0;
        for (let k = 0; k < colsA; k++) {
          result[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    
    return result;
  }

  private matrixAdd(A: number[][], B: number[][]): number[][] {
    if (!A || !A.length || !B || !B.length || A.length !== B.length) {
      return A || [];
    }
    return A.map((row, i) => row.map((val, j) => val + (B[i]?.[j] ?? 0)));
  }

  private matrixSubtract(A: number[][], B: number[][]): number[][] {
    if (!A || !A.length || !B || !B.length || A.length !== B.length) {
      return A || [];
    }
    return A.map((row, i) => row.map((val, j) => val - (B[i]?.[j] ?? 0)));
  }

  private transpose(A: number[][]): number[][] {
    if (!A || !A.length || !A[0]) return [];
    return A[0].map((_, i) => A.map(row => row[i]));
  }

  private matrixInverse2x2(A: number[][]): number[][] {
    if (!A || A.length < 2 || !A[0] || A[0].length < 2) {
      return [[0, 0], [0, 0]];
    }
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    if (det === 0) return [[0, 0], [0, 0]];
    
    return [
      [A[1][1] / det, -A[0][1] / det],
      [-A[1][0] / det, A[0][0] / det],
    ];
  }

  // ═══════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════

  getConfig(): SignalFusionConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SignalFusionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getSignalCount(targetId: string): number {
    return this.signals.get(targetId)?.length || 0;
  }

  getTimePatterns(targetId: string): TimePattern[] {
    const patternMap = this.timePatterns.get(targetId);
    if (!patternMap) return [];
    return Array.from(patternMap.values());
  }

  clearTarget(targetId: string): void {
    this.signals.delete(targetId);
    this.fusedPositions.delete(targetId);
    this.kalmanState.delete(targetId);
    this.timePatterns.delete(targetId);
  }

  clearAll(): void {
    this.signals.clear();
    this.fusedPositions.clear();
    this.kalmanState.clear();
    this.timePatterns.clear();
  }
}

// ═══════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════

interface KalmanState {
  x: number; // lat
  y: number; // lng
  vx: number; // velocity lat
  vy: number; // velocity lng
  P: number[][]; // covariance matrix
  lastUpdate: Date;
}

export interface SandboxCity {
  name: string;
  center: { lat: number; lng: number };
  baseStations: { id: string; lat: number; lng: number; type: 'cell' | 'wifi' }[];
  facilities: FacilityGeometry[];
}

// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════

export const signalFusionEngine = new SignalFusionEngine();
export default SignalFusionEngine;
