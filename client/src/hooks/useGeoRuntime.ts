/**
 * useGeoRuntime - Production-Grade Geolocation Runtime Engine
 * 
 * CRITICAL: All state updates are IMMUTABLE to ensure React detects changes.
 * Frame data changes trigger effects, not UI flags alone.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GPSPoint } from '@shared/geoconsoleTypes';

// ============================================================================
// TYPES
// ============================================================================

export interface GeoFrame {
  id: string;
  timestamp: Date;
  position: {
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracy?: number;
  };
  velocity?: {
    speed: number;
    heading: number;
  };
  source: GPSPoint['source'];
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface GeoRuntimeConfig {
  tickInterval: number;
  playbackSpeed: number;
  maxFrameBuffer: number;
  autoFetch: boolean;
  interpolationEnabled: boolean;
  predictiveEnabled: boolean;
}

export interface GeoRuntimeState {
  isPlaying: boolean;
  isLive: boolean;
  currentFrame: GeoFrame | null;
  currentIndex: number;
  totalFrames: number;
  timeline: { start: Date; end: Date; current: Date };
  trail: GeoFrame[];
  futurecast: GeoFrame[];
  stats: { totalDistance: number; averageSpeed: number; maxSpeed: number; duration: number };
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  error: string | null;
  // Version counter to force updates
  _version: number;
}

export interface GeoRuntimeActions {
  play: () => void;
  pause: () => void;
  stop: () => void;
  toggleLive: () => void;
  seekTo: (index: number) => void;
  seekToTime: (time: Date) => void;
  setPlaybackSpeed: (speed: number) => void;
  loadData: (points: GPSPoint[]) => void;
  refresh: () => Promise<void>;
  exportTrail: () => GeoFrame[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: GeoRuntimeConfig = {
  tickInterval: 500,
  playbackSpeed: 1,
  maxFrameBuffer: 1000,
  autoFetch: true,
  interpolationEnabled: true,
  predictiveEnabled: true,
};

// ============================================================================
// HELPERS
// ============================================================================

const generateId = (): string => `f_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

// Generate mock frames for demo
const generateMockFrames = (
  center = { lat: 40.7128, lng: -74.0060 },
  durationMinutes = 60,
  intervalSeconds = 30
): GeoFrame[] => {
  const frames: GeoFrame[] = [];
  const numFrames = Math.ceil((durationMinutes * 60) / intervalSeconds);
  const startTime = Date.now() - durationMinutes * 60 * 1000;

  let lat = center.lat;
  let lng = center.lng;
  let heading = Math.random() * 360;
  let speed = 1.5;

  for (let i = 0; i < numFrames; i++) {
    const timestamp = new Date(startTime + i * intervalSeconds * 1000);
    
    // Random movement
    if (Math.random() < 0.1) heading += (Math.random() - 0.5) * 90;
    else heading += (Math.random() - 0.5) * 10;
    heading = (heading + 360) % 360;

    if (Math.random() < 0.05) speed = 0;
    else if (Math.random() < 0.1) speed = 3 + Math.random() * 10;
    else speed = 1 + Math.random() * 1.5;

    const distanceM = speed * intervalSeconds;
    const distanceDeg = distanceM / 111000;
    
    lat += Math.cos(heading * Math.PI / 180) * distanceDeg;
    lng += Math.sin(heading * Math.PI / 180) * distanceDeg / Math.cos(lat * Math.PI / 180);

    // IMMUTABLE: Create new object each time
    frames.push({
      id: generateId(),
      timestamp,
      position: { latitude: lat, longitude: lng, altitude: 10 + Math.random() * 5, accuracy: 5 + Math.random() * 15 },
      velocity: { speed, heading },
      source: speed === 0 ? 'device_gps' : (speed > 5 ? 'device_gps' : 'wifi_handoff'),
      confidence: 0.85 + Math.random() * 0.15,
      metadata: { generated: true, frameIndex: i },
    });
  }

  return frames;
};

// Generate futurecast predictions
const generateFuturecast = (recentFrames: GeoFrame[], hoursAhead = 6): GeoFrame[] => {
  if (recentFrames.length < 3) return [];

  const predictions: GeoFrame[] = [];
  const intervalMinutes = 15;
  const numPredictions = Math.ceil((hoursAhead * 60) / intervalMinutes);
  
  // Calculate average velocity
  const velocities: { speed: number; heading: number }[] = [];
  for (let i = 1; i < Math.min(recentFrames.length, 10); i++) {
    const prev = recentFrames[recentFrames.length - i - 1];
    const curr = recentFrames[recentFrames.length - i];
    const dist = haversineDistance(prev.position.latitude, prev.position.longitude, curr.position.latitude, curr.position.longitude);
    const timeDiff = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    if (timeDiff > 0) {
      velocities.push({
        speed: dist / timeDiff,
        heading: calculateBearing(prev.position.latitude, prev.position.longitude, curr.position.latitude, curr.position.longitude),
      });
    }
  }

  if (velocities.length === 0) return [];

  let totalWeight = 0, avgSpeed = 0, avgHeadingX = 0, avgHeadingY = 0;
  velocities.forEach((v, i) => {
    const weight = velocities.length - i;
    totalWeight += weight;
    avgSpeed += v.speed * weight;
    avgHeadingX += Math.cos(v.heading * Math.PI / 180) * weight;
    avgHeadingY += Math.sin(v.heading * Math.PI / 180) * weight;
  });
  avgSpeed /= totalWeight;
  const avgHeading = Math.atan2(avgHeadingY, avgHeadingX) * 180 / Math.PI;

  const lastFrame = recentFrames[recentFrames.length - 1];
  let lat = lastFrame.position.latitude;
  let lng = lastFrame.position.longitude;
  const baseTime = lastFrame.timestamp.getTime();

  for (let i = 1; i <= numPredictions; i++) {
    const timestamp = new Date(baseTime + i * intervalMinutes * 60 * 1000);
    const confidence = Math.max(0.3, 0.9 - (i / numPredictions) * 0.6);
    const jitter = (i / numPredictions) * 0.001;
    const heading = avgHeading + (Math.random() - 0.5) * 30 * (i / numPredictions);
    
    const distanceM = avgSpeed * intervalMinutes * 60;
    const distanceDeg = distanceM / 111000;
    
    lat += Math.cos(heading * Math.PI / 180) * distanceDeg + (Math.random() - 0.5) * jitter;
    lng += Math.sin(heading * Math.PI / 180) * distanceDeg / Math.cos(lat * Math.PI / 180) + (Math.random() - 0.5) * jitter;

    predictions.push({
      id: generateId(),
      timestamp,
      position: { latitude: lat, longitude: lng, accuracy: 50 + i * 20 },
      velocity: { speed: avgSpeed * (0.8 + Math.random() * 0.4), heading },
      source: 'interpolated',
      confidence,
      metadata: { predicted: true, hoursAhead: (i * intervalMinutes) / 60 },
    });
  }

  return predictions;
};

// ============================================================================
// HOOK
// ============================================================================

export function useGeoRuntime(
  initialData: GPSPoint[] = [],
  config: Partial<GeoRuntimeConfig> = {}
): [GeoRuntimeState, GeoRuntimeActions] {
  
  // Config (not memoized to avoid stale closures)
  const cfg: GeoRuntimeConfig = { ...DEFAULT_CONFIG, ...config };

  // Core state - frames array (IMMUTABLE updates only)
  const [frames, setFrames] = useState<GeoFrame[]>([]);
  const [futurecastFrames, setFuturecastFrames] = useState<GeoFrame[]>([]);
  
  // Index state - this is what drives frame selection
  const [currentIndex, setCurrentIndex] = useState(0);
  
  // Control state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(cfg.playbackSpeed);
  const [status, setStatus] = useState<GeoRuntimeState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  
  // Version counter - increments on any meaningful state change to force downstream updates
  const [version, setVersion] = useState(0);

  // Refs for interval (not state to avoid re-render loops)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const framesRef = useRef<GeoFrame[]>(frames);
  
  // Keep ref in sync with state
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  // Convert GPS points to frames
  const convertToFrames = useCallback((points: GPSPoint[]): GeoFrame[] => {
    if (points.length === 0) return [];
    
    const sorted = [...points].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    return sorted.map((point, i) => {
      const frame: GeoFrame = {
        id: generateId(),
        timestamp: new Date(point.timestamp),
        position: {
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: point.altitude,
          accuracy: point.accuracy,
        },
        source: point.source,
        confidence: point.confidence,
        metadata: point.metadata as Record<string, unknown>,
      };

      if (i > 0) {
        const prev = sorted[i - 1];
        const dist = haversineDistance(prev.latitude, prev.longitude, point.latitude, point.longitude);
        const timeDiff = (new Date(point.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
        if (timeDiff > 0) {
          frame.velocity = {
            speed: dist / timeDiff,
            heading: calculateBearing(prev.latitude, prev.longitude, point.latitude, point.longitude),
          };
        }
      }

      return frame;
    });
  }, []);

  // Load data - ALWAYS creates new array
  const loadData = useCallback((points: GPSPoint[]) => {
    setStatus('loading');
    setError(null);

    try {
      let newFrames: GeoFrame[];
      
      if (points.length === 0) {
        console.log('[GeoRuntime] Generating mock frames');
        newFrames = generateMockFrames();
      } else {
        newFrames = convertToFrames(points);
      }

      if (newFrames.length === 0) {
        newFrames = generateMockFrames();
      }

      // Limit buffer
      if (newFrames.length > cfg.maxFrameBuffer) {
        newFrames = newFrames.slice(-cfg.maxFrameBuffer);
      }

      // IMMUTABLE: Set new array reference
      setFrames([...newFrames]);
      setCurrentIndex(0);
      setVersion(v => v + 1);

      // Generate futurecast
      if (cfg.predictiveEnabled && newFrames.length >= 3) {
        setFuturecastFrames([...generateFuturecast(newFrames)]);
      }

      setStatus('idle');
      console.log(`[GeoRuntime] Loaded ${newFrames.length} frames`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
      setStatus('error');
    }
  }, [convertToFrames, cfg.maxFrameBuffer, cfg.predictiveEnabled]);

  // Initialize on mount
  useEffect(() => {
    loadData(initialData);
  }, []); // Only once on mount

  // Tick function - advances index
  const tick = useCallback(() => {
    const currentFrames = framesRef.current;
    if (currentFrames.length === 0) return;

    setCurrentIndex(prev => {
      let next: number;
      
      if (isLive) {
        next = currentFrames.length - 1;
      } else {
        next = prev + 1;
        if (next >= currentFrames.length) {
          setIsPlaying(false);
          return currentFrames.length - 1;
        }
      }
      
      // Increment version to force downstream updates
      setVersion(v => v + 1);
      return next;
    });
  }, [isLive]);

  // Playback interval - NO debounce/throttle
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isPlaying && frames.length > 0) {
      setStatus('playing');
      // Direct interval, no throttling
      intervalRef.current = setInterval(tick, cfg.tickInterval / playbackSpeed);
    } else if (status === 'playing') {
      setStatus('paused');
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, frames.length, tick, cfg.tickInterval, playbackSpeed, status]);

  // LIVE mode - add new frames
  useEffect(() => {
    if (!isLive || !cfg.autoFetch) return;

    const liveInterval = setInterval(() => {
      const currentFrames = framesRef.current;
      if (currentFrames.length === 0) return;

      const lastFrame = currentFrames[currentFrames.length - 1];
      
      // Generate new frame - IMMUTABLE
      const newFrame: GeoFrame = {
        id: generateId(),
        timestamp: new Date(),
        position: {
          latitude: lastFrame.position.latitude + (Math.random() - 0.5) * 0.0002,
          longitude: lastFrame.position.longitude + (Math.random() - 0.5) * 0.0002,
          accuracy: 5 + Math.random() * 10,
        },
        velocity: {
          speed: 1 + Math.random() * 2,
          heading: (lastFrame.velocity?.heading || 0) + (Math.random() - 0.5) * 20,
        },
        source: 'device_gps',
        confidence: 0.9 + Math.random() * 0.1,
        metadata: { live: true },
      };

      // IMMUTABLE: Create new array
      setFrames(prev => {
        const updated = [...prev, newFrame];
        if (updated.length > cfg.maxFrameBuffer) {
          return updated.slice(-cfg.maxFrameBuffer);
        }
        return updated;
      });
      
      setCurrentIndex(prev => prev + 1);
      setVersion(v => v + 1);
    }, 2000);

    return () => clearInterval(liveInterval);
  }, [isLive, cfg.autoFetch, cfg.maxFrameBuffer]);

  // === DERIVED STATE (computed from index + frames) ===
  
  // Current frame - derived directly from index
  const currentFrame = frames.length > 0 && currentIndex >= 0 && currentIndex < frames.length
    ? frames[currentIndex]
    : null;

  // Trail - all frames up to current index (IMMUTABLE slice)
  const trail = frames.slice(0, currentIndex + 1);

  // Timeline
  const timeline = frames.length > 0
    ? {
        start: frames[0].timestamp,
        end: frames[frames.length - 1].timestamp,
        current: currentFrame?.timestamp || frames[0].timestamp,
      }
    : {
        start: new Date(),
        end: new Date(),
        current: new Date(),
      };

  // Stats - computed from trail
  const stats = (() => {
    if (trail.length < 2) {
      return { totalDistance: 0, averageSpeed: 0, maxSpeed: 0, duration: 0 };
    }

    let totalDistance = 0;
    let maxSpeed = 0;
    const speeds: number[] = [];

    for (let i = 1; i < trail.length; i++) {
      const prev = trail[i - 1];
      const curr = trail[i];
      totalDistance += haversineDistance(
        prev.position.latitude, prev.position.longitude,
        curr.position.latitude, curr.position.longitude
      );
      if (curr.velocity?.speed) {
        speeds.push(curr.velocity.speed);
        maxSpeed = Math.max(maxSpeed, curr.velocity.speed);
      }
    }

    const duration = (trail[trail.length - 1].timestamp.getTime() - trail[0].timestamp.getTime()) / 1000;
    const averageSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

    return { totalDistance, averageSpeed, maxSpeed, duration };
  })();

  // === ACTIONS ===

  const play = useCallback(() => {
    if (frames.length === 0) loadData([]);
    setIsPlaying(true);
    setVersion(v => v + 1);
  }, [frames.length, loadData]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setStatus('idle');
    setVersion(v => v + 1);
  }, []);

  const toggleLive = useCallback(() => {
    setIsLive(prev => {
      if (!prev) {
        // Going live - jump to end
        setCurrentIndex(framesRef.current.length - 1);
        setIsPlaying(true);
      }
      setVersion(v => v + 1);
      return !prev;
    });
  }, []);

  const seekTo = useCallback((index: number) => {
    const maxIndex = framesRef.current.length - 1;
    const newIndex = Math.max(0, Math.min(index, maxIndex));
    setCurrentIndex(newIndex);
    setIsLive(false);
    setVersion(v => v + 1);
  }, []);

  const seekToTime = useCallback((time: Date) => {
    const targetTime = time.getTime();
    let closestIndex = 0;
    let closestDiff = Infinity;

    framesRef.current.forEach((frame, idx) => {
      const diff = Math.abs(frame.timestamp.getTime() - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = idx;
      }
    });

    seekTo(closestIndex);
  }, [seekTo]);

  const setSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(Math.max(0.1, Math.min(speed, 100)));
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      if (cfg.predictiveEnabled && frames.length >= 3) {
        setFuturecastFrames([...generateFuturecast(frames)]);
      }
      setStatus('idle');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
      setStatus('error');
    }
  }, [frames, cfg.predictiveEnabled]);

  const exportTrail = useCallback(() => {
    return [...trail];
  }, [trail]);

  // === RETURN STATE & ACTIONS ===

  const state: GeoRuntimeState = {
    isPlaying,
    isLive,
    currentFrame,
    currentIndex,
    totalFrames: frames.length,
    timeline,
    trail,
    futurecast: futurecastFrames,
    stats,
    status,
    error,
    _version: version,
  };

  const actions: GeoRuntimeActions = {
    play,
    pause,
    stop,
    toggleLive,
    seekTo,
    seekToTime,
    setPlaybackSpeed: setSpeed,
    loadData,
    refresh,
    exportTrail,
  };

  return [state, actions];
}

export default useGeoRuntime;
