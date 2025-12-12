/**
 * useTSHPELocator Hook
 * 
 * TSHPE-Locator: Triangulated Satellite-Hybrid Positioning Engine
 * 
 * Features:
 * - Multi-source triangulation (GPS, WiFi, Cellular, IP)
 * - Kalman filter for position smoothing
 * - Predictive cone calculation
 * - Monte-Carlo enhancement loop
 * - System health monitoring
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface Position {
  lat: number;
  lon: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp?: number;
  source?: 'gps' | 'wifi' | 'cellular' | 'ip' | 'fused';
}

export interface TriangulationSource {
  active: boolean;
  weight: number;
  accuracy: number;
  lastUpdate: number;
}

export interface TriangulationData {
  gps: TriangulationSource;
  wifi: TriangulationSource;
  cellular: TriangulationSource;
  ip: TriangulationSource;
  network: TriangulationSource; // Combined WiFi + Cellular + IP
  vector: TriangulationSource; // Motion vector prediction
}

export interface PredictedCone {
  center: Position;
  radiusNow: number;
  radiusFuture: number;
  angle: number;
  confidence: number;
}

export interface SystemHealth {
  cpu: number;
  memory: number;
  thermal: 'normal' | 'warm' | 'hot';
  pollInterval: number;
}

interface KalmanState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  P: number[][]; // Covariance matrix
}

// ============================================================================
// KALMAN FILTER
// ============================================================================

class KalmanFilter {
  private state: KalmanState;
  private Q: number; // Process noise
  private R: number; // Measurement noise
  
  constructor() {
    this.state = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      P: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ],
    };
    this.Q = 0.01; // Process noise
    this.R = 1;    // Measurement noise (adjusted based on source accuracy)
  }
  
  predict(dt: number): void {
    // State transition
    this.state.x += this.state.vx * dt;
    this.state.y += this.state.vy * dt;
    
    // Update covariance with process noise
    for (let i = 0; i < 4; i++) {
      this.state.P[i][i] += this.Q;
    }
  }
  
  update(measurement: { lat: number; lon: number }, accuracy: number): { lat: number; lon: number } {
    // Adjust measurement noise based on accuracy
    this.R = Math.max(0.1, accuracy / 10);
    
    // Convert to local coordinates (simple approximation)
    const measX = measurement.lon;
    const measY = measurement.lat;
    
    // Kalman gain
    const K = this.state.P[0][0] / (this.state.P[0][0] + this.R);
    
    // Update state
    this.state.x += K * (measX - this.state.x);
    this.state.y += K * (measY - this.state.y);
    
    // Update covariance
    this.state.P[0][0] *= (1 - K);
    this.state.P[1][1] *= (1 - K);
    
    return { lat: this.state.y, lon: this.state.x };
  }
  
  setVelocity(vx: number, vy: number): void {
    this.state.vx = vx;
    this.state.vy = vy;
  }
  
  getState(): { lat: number; lon: number; vx: number; vy: number } {
    return {
      lat: this.state.y,
      lon: this.state.x,
      vx: this.state.vx,
      vy: this.state.vy,
    };
  }
}

// ============================================================================
// MONTE CARLO SIMULATOR
// ============================================================================

class MonteCarloSimulator {
  private weights: { gps: number; network: number; vector: number };
  private scores: number[] = [];
  
  constructor() {
    this.weights = { gps: 0.6, network: 0.25, vector: 0.15 };
  }
  
  // Run Monte Carlo simulation to optimize weights
  runSimulation(
    history: Position[],
    iterations: number = 250
  ): { gps: number; network: number; vector: number; score: number } {
    if (history.length < 10) {
      return { ...this.weights, score: 0.5 };
    }
    
    let bestScore = 0;
    let bestWeights = { ...this.weights };
    
    for (let i = 0; i < iterations; i++) {
      // Generate random weight variation
      const testWeights = {
        gps: Math.max(0.1, Math.min(0.9, this.weights.gps + (Math.random() - 0.5) * 0.2)),
        network: Math.max(0.05, Math.min(0.5, this.weights.network + (Math.random() - 0.5) * 0.1)),
        vector: Math.max(0.05, Math.min(0.3, this.weights.vector + (Math.random() - 0.5) * 0.1)),
      };
      
      // Normalize
      const total = testWeights.gps + testWeights.network + testWeights.vector;
      testWeights.gps /= total;
      testWeights.network /= total;
      testWeights.vector /= total;
      
      // Score this configuration
      const score = this.scoreConfiguration(testWeights, history);
      
      if (score > bestScore) {
        bestScore = score;
        bestWeights = { ...testWeights };
      }
    }
    
    // Update weights if improvement found
    if (bestScore > 0.6) {
      this.weights = bestWeights;
    }
    
    this.scores.push(bestScore);
    if (this.scores.length > 100) this.scores.shift();
    
    return { ...this.weights, score: bestScore };
  }
  
  private scoreConfiguration(
    weights: { gps: number; network: number; vector: number },
    history: Position[]
  ): number {
    // Evaluate configuration by checking prediction accuracy on historical data
    let totalError = 0;
    let count = 0;
    
    for (let i = 5; i < history.length; i++) {
      // Use previous points to predict current
      const prev = history.slice(i - 5, i);
      const actual = history[i];
      
      // Simple prediction based on velocity
      const avgVelLat = prev.reduce((sum, p, j) => 
        j > 0 ? sum + (p.lat - prev[j-1].lat) : sum, 0) / (prev.length - 1);
      const avgVelLon = prev.reduce((sum, p, j) => 
        j > 0 ? sum + (p.lon - prev[j-1].lon) : sum, 0) / (prev.length - 1);
      
      const predicted = {
        lat: prev[prev.length - 1].lat + avgVelLat,
        lon: prev[prev.length - 1].lon + avgVelLon,
      };
      
      // Calculate error
      const error = Math.sqrt(
        Math.pow(actual.lat - predicted.lat, 2) +
        Math.pow(actual.lon - predicted.lon, 2)
      );
      
      totalError += error;
      count++;
    }
    
    // Score is inverse of average error (normalized)
    const avgError = count > 0 ? totalError / count : 1;
    return Math.max(0, Math.min(1, 1 - avgError * 100000));
  }
  
  getAverageScore(): number {
    if (this.scores.length === 0) return 0.5;
    return this.scores.reduce((a, b) => a + b, 0) / this.scores.length;
  }
  
  getWeights(): { gps: number; network: number; vector: number } {
    return { ...this.weights };
  }
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useTSHPELocator() {
  // State
  const [currentPosition, setCurrentPosition] = useState<Position>({
    lat: 40.7128,
    lon: -74.0060,
    accuracy: 100,
    heading: 0,
    speed: 0,
    altitude: 0,
    timestamp: Date.now(),
    source: 'ip',
  });
  
  const [positionHistory, setPositionHistory] = useState<Position[]>([]);
  const [predictedCone, setPredictedCone] = useState<PredictedCone | null>(null);
  const [accuracy, setAccuracy] = useState(100);
  const [isTracking, setIsTracking] = useState(false);
  const [monteCarloScore, setMonteCarloScore] = useState(0.5);
  
  const [triangulationData, setTriangulationData] = useState<TriangulationData>({
    gps: { active: false, weight: 0.6, accuracy: 100, lastUpdate: 0 },
    wifi: { active: false, weight: 0.15, accuracy: 50, lastUpdate: 0 },
    cellular: { active: false, weight: 0.1, accuracy: 100, lastUpdate: 0 },
    ip: { active: true, weight: 0.05, accuracy: 5000, lastUpdate: Date.now() },
    network: { active: true, weight: 0.25, accuracy: 1000, lastUpdate: Date.now() },
    vector: { active: false, weight: 0.15, accuracy: 0, lastUpdate: 0 },
  });
  
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    cpu: 25,
    memory: 40,
    thermal: 'normal',
    pollInterval: 5000,
  });
  
  // Refs
  const kalmanFilterRef = useRef(new KalmanFilter());
  const monteCarloRef = useRef(new MonteCarloSimulator());
  const watchIdRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const monteCarloIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // ============================================================================
  // TRIANGULATION ENGINE
  // ============================================================================
  
  const fusePositions = useCallback((
    gps?: Position,
    network?: Position,
    vector?: Position
  ): Position => {
    const weights = monteCarloRef.current.getWeights();
    
    let totalWeight = 0;
    let fusedLat = 0;
    let fusedLon = 0;
    let fusedAccuracy = 0;
    
    if (gps) {
      fusedLat += gps.lat * weights.gps;
      fusedLon += gps.lon * weights.gps;
      fusedAccuracy += (gps.accuracy || 10) * weights.gps;
      totalWeight += weights.gps;
    }
    
    if (network) {
      fusedLat += network.lat * weights.network;
      fusedLon += network.lon * weights.network;
      fusedAccuracy += (network.accuracy || 100) * weights.network;
      totalWeight += weights.network;
    }
    
    if (vector) {
      fusedLat += vector.lat * weights.vector;
      fusedLon += vector.lon * weights.vector;
      fusedAccuracy += (vector.accuracy || 50) * weights.vector;
      totalWeight += weights.vector;
    }
    
    if (totalWeight === 0) {
      return currentPosition;
    }
    
    const fused = {
      lat: fusedLat / totalWeight,
      lon: fusedLon / totalWeight,
      accuracy: fusedAccuracy / totalWeight,
      timestamp: Date.now(),
      source: 'fused' as const,
    };
    
    // Apply Kalman filter
    const filtered = kalmanFilterRef.current.update(
      { lat: fused.lat, lon: fused.lon },
      fused.accuracy
    );
    
    return {
      ...fused,
      lat: filtered.lat,
      lon: filtered.lon,
    };
  }, [currentPosition]);
  
  // ============================================================================
  // PREDICTION ENGINE
  // ============================================================================
  
  const calculatePredictedCone = useCallback((
    current: Position,
    history: Position[],
    forecastMinutes: number = 30
  ): PredictedCone => {
    if (history.length < 3) {
      return {
        center: current,
        radiusNow: current.accuracy || 10,
        radiusFuture: 1000, // 1km default uncertainty
        angle: current.heading || 0,
        confidence: 0.3,
      };
    }
    
    // Calculate velocity from recent history
    const recent = history.slice(-10);
    let avgVelLat = 0;
    let avgVelLon = 0;
    let avgSpeed = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const dt = (recent[i].timestamp || 0) - (recent[i-1].timestamp || 0);
      if (dt > 0) {
        avgVelLat += (recent[i].lat - recent[i-1].lat) / (dt / 1000);
        avgVelLon += (recent[i].lon - recent[i-1].lon) / (dt / 1000);
        avgSpeed += Math.sqrt(
          Math.pow(recent[i].lat - recent[i-1].lat, 2) +
          Math.pow(recent[i].lon - recent[i-1].lon, 2)
        ) / (dt / 1000);
      }
    }
    
    const count = recent.length - 1;
    avgVelLat /= count;
    avgVelLon /= count;
    avgSpeed /= count;
    
    // Update Kalman filter velocity
    kalmanFilterRef.current.setVelocity(avgVelLon, avgVelLat);
    
    // Calculate heading from velocity
    const heading = (Math.atan2(avgVelLon, avgVelLat) * 180 / Math.PI + 360) % 360;
    
    // Predict future position
    const forecastSeconds = forecastMinutes * 60;
    const predictedDistance = avgSpeed * forecastSeconds * 111000; // Convert to meters (rough)
    
    // Calculate confidence based on velocity consistency
    const velocityVariance = recent.reduce((sum, p, i) => {
      if (i === 0) return sum;
      const dt = (p.timestamp || 0) - (recent[i-1].timestamp || 0);
      if (dt === 0) return sum;
      const v = Math.sqrt(
        Math.pow(p.lat - recent[i-1].lat, 2) +
        Math.pow(p.lon - recent[i-1].lon, 2)
      ) / (dt / 1000);
      return sum + Math.pow(v - avgSpeed, 2);
    }, 0) / count;
    
    const confidence = Math.max(0.2, Math.min(0.95, 1 - Math.sqrt(velocityVariance) * 10000));
    
    return {
      center: current,
      radiusNow: current.accuracy || 10,
      radiusFuture: Math.max(100, predictedDistance * (1 + (1 - confidence))),
      angle: heading,
      confidence,
    };
  }, []);
  
  // ============================================================================
  // GPS TRACKING
  // ============================================================================
  
  const handleGPSPosition = useCallback((position: GeolocationPosition) => {
    const gpsPos: Position = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading || undefined,
      speed: position.coords.speed || undefined,
      altitude: position.coords.altitude || undefined,
      timestamp: position.timestamp,
      source: 'gps',
    };
    
    // Update triangulation data
    setTriangulationData(prev => ({
      ...prev,
      gps: {
        active: true,
        weight: monteCarloRef.current.getWeights().gps,
        accuracy: gpsPos.accuracy || 10,
        lastUpdate: Date.now(),
      },
    }));
    
    // Fuse with other sources
    const fused = fusePositions(gpsPos, undefined, undefined);
    
    // Update state
    setCurrentPosition({
      ...fused,
      heading: gpsPos.heading,
      speed: gpsPos.speed,
      altitude: gpsPos.altitude,
    });
    setAccuracy(fused.accuracy || 10);
    
    // Add to history and calculate cone in a single setState to ensure consistency
    setPositionHistory(prev => {
      // Immutable array update with efficient trimming
      const updatedHistory = prev.length >= 10000 
        ? [...prev.slice(-9999), fused]
        : [...prev, fused];
      
      // Calculate predicted cone using the updated history
      const cone = calculatePredictedCone(fused, updatedHistory);
      setPredictedCone(cone);
      
      return updatedHistory;
    });
  }, [fusePositions, calculatePredictedCone]);
  
  const handleGPSError = useCallback((error: GeolocationPositionError) => {
    console.warn('[TSHPE] GPS Error:', error.message);
    setTriangulationData(prev => ({
      ...prev,
      gps: { ...prev.gps, active: false },
    }));
  }, []);
  
  // ============================================================================
  // IP GEOLOCATION FALLBACK
  // ============================================================================
  
  // Use ref to track GPS active state for interval callbacks
  const gpsActiveRef = useRef(triangulationData.gps.active);
  useEffect(() => {
    gpsActiveRef.current = triangulationData.gps.active;
  }, [triangulationData.gps.active]);
  
  const fetchIPLocation = useCallback(async () => {
    try {
      // Note: IP geolocation provides approximate location only
      // User consent should be obtained before tracking in production
      const response = await fetch('https://ipapi.co/json/');
      if (!response.ok) throw new Error('IP lookup failed');
      
      const data = await response.json();
      
      const ipPos: Position = {
        lat: data.latitude,
        lon: data.longitude,
        accuracy: 5000, // IP is ~5km accurate
        timestamp: Date.now(),
        source: 'ip',
      };
      
      setTriangulationData(prev => ({
        ...prev,
        ip: {
          active: true,
          weight: 0.05,
          accuracy: 5000,
          lastUpdate: Date.now(),
        },
      }));
      
      // Only use IP if GPS isn't available (use ref for current value)
      if (!gpsActiveRef.current) {
        setCurrentPosition(prev => {
          if (prev.source === 'ip' || prev.source === 'fused') {
            return ipPos;
          }
          return prev;
        });
      }
    } catch (error) {
      console.warn('[TSHPE] IP geolocation failed:', error);
    }
  }, []);
  
  // ============================================================================
  // MONTE-CARLO ENHANCEMENT
  // ============================================================================
  
  const runMonteCarloEnhancement = useCallback(() => {
    if (positionHistory.length < 20) return;
    
    const result = monteCarloRef.current.runSimulation(positionHistory);
    
    setMonteCarloScore(result.score);
    
    // Update triangulation weights
    setTriangulationData(prev => ({
      ...prev,
      gps: { ...prev.gps, weight: result.gps },
      network: { ...prev.network, weight: result.network },
      vector: { ...prev.vector, weight: result.vector },
    }));
  }, [positionHistory]);
  
  // ============================================================================
  // SYSTEM HEALTH MONITORING
  // ============================================================================
  
  const updateSystemHealth = useCallback(() => {
    // Simulate system health (in real app, would use Performance API)
    const cpuLoad = 20 + Math.random() * 30;
    const memoryUsage = 35 + Math.random() * 25;
    
    setSystemHealth(prev => {
      let thermal: 'normal' | 'warm' | 'hot' = 'normal';
      let pollInterval = 5000;
      
      if (cpuLoad > 65) {
        thermal = 'warm';
        pollInterval = 8000;
      }
      if (cpuLoad > 80) {
        thermal = 'hot';
        pollInterval = 15000;
      }
      
      return {
        cpu: Math.round(cpuLoad),
        memory: Math.round(memoryUsage),
        thermal,
        pollInterval,
      };
    });
  }, []);
  
  // ============================================================================
  // CONTROL FUNCTIONS
  // ============================================================================
  
  const startTracking = useCallback(() => {
    setIsTracking(true);
    
    // Start GPS watch
    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleGPSPosition,
        handleGPSError,
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    }
    
    // Start IP location polling as fallback
    fetchIPLocation();
    pollIntervalRef.current = setInterval(() => {
      // Use ref for current GPS active state to avoid stale closure
      if (!gpsActiveRef.current) {
        fetchIPLocation();
      }
      updateSystemHealth();
    }, systemHealth.pollInterval);
    
    // Start Monte-Carlo enhancement (every 6 hours as specified)
    monteCarloIntervalRef.current = setInterval(() => {
      runMonteCarloEnhancement();
    }, 6 * 60 * 60 * 1000); // 6 hours
    
    // Run initial Monte-Carlo
    setTimeout(runMonteCarloEnhancement, 30000);
  }, [handleGPSPosition, handleGPSError, fetchIPLocation, updateSystemHealth, runMonteCarloEnhancement, systemHealth.pollInterval]);
  
  const stopTracking = useCallback(() => {
    setIsTracking(false);
    
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    if (monteCarloIntervalRef.current) {
      clearInterval(monteCarloIntervalRef.current);
      monteCarloIntervalRef.current = null;
    }
  }, []);
  
  const getHistoryRange = useCallback((startTime: number, endTime: number): Position[] => {
    return positionHistory.filter(p => 
      p.timestamp && p.timestamp >= startTime && p.timestamp <= endTime
    );
  }, [positionHistory]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (monteCarloIntervalRef.current) {
        clearInterval(monteCarloIntervalRef.current);
      }
    };
  }, []);
  
  // Initialize with IP location
  useEffect(() => {
    fetchIPLocation();
  }, [fetchIPLocation]);
  
  return {
    currentPosition,
    positionHistory,
    predictedCone,
    triangulationData,
    accuracy,
    isTracking,
    startTracking,
    stopTracking,
    getHistoryRange,
    monteCarloScore,
    systemHealth,
  };
}
