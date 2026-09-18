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
    verticalAccuracy?: number;
  };
  receivedAt?: Date;
  observationKind?: GPSPoint['observationKind'];
  correlationGroup?: string;
  provenance?: GPSPoint['provenance'];
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

const ONE_HOUR_MS = 60 * 60 * 1000;
const FUTURECAST_HOURS = 1;

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

const generateId = (): string => `f_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

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

// Local deterministic fallback only. The server endpoint is the authoritative
// futurecast source; this exists so the UI degrades gracefully if that request fails.
const movePoint = (lat: number, lng: number, bearing: number, distanceMeters: number) => {
  const earthRadius = 6_371_000;
  const angularDistance = distanceMeters / earthRadius;
  const bearingRad = bearing * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { latitude: lat2 * 180 / Math.PI, longitude: lng2 * 180 / Math.PI };
};

const generateLocalFuturecastFallback = (recentFrames: GeoFrame[], hoursAhead = FUTURECAST_HOURS): GeoFrame[] => {
  if (recentFrames.length < 3) return [];

  const recent = [...recentFrames]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-10);

  let totalWeight = 0;
  let weightedSpeed = 0;
  let headingX = 0;
  let headingY = 0;

  for (let i = 1; i < recent.length; i++) {
    const older = recent[i - 1];
    const newer = recent[i];
    const elapsed = (newer.timestamp.getTime() - older.timestamp.getTime()) / 1000;
    if (elapsed <= 0) continue;

    const distance = haversineDistance(
      older.position.latitude,
      older.position.longitude,
      newer.position.latitude,
      newer.position.longitude
    );
    const speed = distance / elapsed;
    const heading = calculateBearing(
      older.position.latitude,
      older.position.longitude,
      newer.position.latitude,
      newer.position.longitude
    );
    const weight = i;
    totalWeight += weight;
    weightedSpeed += speed * weight;
    headingX += Math.cos(heading * Math.PI / 180) * weight;
    headingY += Math.sin(heading * Math.PI / 180) * weight;
  }

  if (totalWeight === 0) return [];

  const avgSpeed = weightedSpeed / totalWeight;
  const avgHeading = (Math.atan2(headingY, headingX) * 180 / Math.PI + 360) % 360;
  const lastFrame = recent[recent.length - 1];
  const baseTime = lastFrame.timestamp.getTime();
  const intervalMinutes = 15;
  const numPredictions = Math.max(1, Math.ceil((hoursAhead * 60) / intervalMinutes));
  const predictions: GeoFrame[] = [];
  let lat = lastFrame.position.latitude;
  let lng = lastFrame.position.longitude;

  for (let i = 1; i <= numPredictions; i++) {
    const moved = movePoint(lat, lng, avgHeading, avgSpeed * intervalMinutes * 60);
    lat = moved.latitude;
    lng = moved.longitude;
    const ratio = i / numPredictions;

    predictions.push({
      id: generateId(),
      timestamp: new Date(baseTime + i * intervalMinutes * 60 * 1000),
      position: {
        latitude: lat,
        longitude: lng,
        accuracy: Math.max(50, (lastFrame.position.accuracy ?? 35) + i * 25),
      },
      velocity: { speed: avgSpeed, heading: avgHeading },
      source: 'predicted',
      confidence: Math.max(0.08, 0.88 * Math.exp(-2.2 * ratio)),
      metadata: {
        predicted: true,
        authority: 'client_fallback',
        model: 'deterministic_recency_weighted_motion',
        horizonMinutes: i * intervalMinutes,
      },
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
  const liveFuturecastLastRequestRef = useRef(0);
  
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
          verticalAccuracy: point.verticalAccuracy,
        },
        receivedAt: point.receivedAt ? new Date(point.receivedAt) : undefined,
        observationKind: point.observationKind,
        correlationGroup: point.correlationGroup,
        provenance: point.provenance,
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

  const futurecastRequestRef = useRef(0);

  const predictionPayloadToFrames = useCallback((predictions: any[]): GeoFrame[] => (
    predictions
      .map((point: any) => ({
        id: generateId(),
        timestamp: new Date(point.timestamp),
        position: {
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          altitude: point.altitude !== undefined ? Number(point.altitude) : undefined,
          accuracy: point.accuracy !== undefined ? Number(point.accuracy) : undefined,
          verticalAccuracy: point.verticalAccuracy !== undefined ? Number(point.verticalAccuracy) : undefined,
        },
        receivedAt: point.receivedAt ? new Date(point.receivedAt) : undefined,
        observationKind: point.observationKind || 'predicted',
        correlationGroup: point.correlationGroup,
        provenance: point.provenance,
        source: point.source || 'predicted',
        confidence: Number(point.confidence ?? 0),
        metadata: {
          ...(point.metadata || {}),
          predicted: true,
          authority: 'server',
        },
      }))
      .filter((frame: GeoFrame) =>
        Number.isFinite(frame.position.latitude) &&
        Number.isFinite(frame.position.longitude) &&
        Number.isFinite(frame.timestamp.getTime())
      )
  ), []);

  const requestAuthoritativeFuturecast = useCallback(async (sourceFrames: GeoFrame[]) => {
    if (!cfg.predictiveEnabled || sourceFrames.length < 3) {
      setFuturecastFrames([]);
      return;
    }

    const requestId = ++futurecastRequestRef.current;
    const recent = sourceFrames.slice(-20);

    try {
      const response = await fetch('/api/geoconsole/futurecast', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: FUTURECAST_HOURS,
          recentPoints: recent.map(frame => ({
            latitude: frame.position.latitude,
            longitude: frame.position.longitude,
            altitude: frame.position.altitude,
            accuracy: frame.position.accuracy,
            verticalAccuracy: frame.position.verticalAccuracy,
            timestamp: frame.timestamp.toISOString(),
            receivedAt: frame.receivedAt?.toISOString(),
            source: frame.source,
            confidence: frame.confidence,
            observationKind: frame.observationKind,
            correlationGroup: frame.correlationGroup,
            provenance: frame.provenance,
            metadata: frame.metadata,
          })),
        }),
      });

      if (!response.ok) throw new Error(`Futurecast request failed: ${response.status}`);
      const payload = await response.json();
      if (requestId !== futurecastRequestRef.current) return;

      const predictions = Array.isArray(payload?.data?.predictions)
        ? payload.data.predictions
        : [];

      setFuturecastFrames(predictionPayloadToFrames(predictions));
    } catch {
      if (requestId !== futurecastRequestRef.current) return;
      setFuturecastFrames(generateLocalFuturecastFallback(sourceFrames));
    }
  }, [cfg.predictiveEnabled, predictionPayloadToFrames]);

  // Load data through the canonical server fusion pipeline automatically.
  const loadData = useCallback(async (points: GPSPoint[]) => {
    setStatus('loading');
    setError(null);

    try {
      if (points.length === 0) {
        framesRef.current = [];
        setFrames([]);
        setFuturecastFrames([]);
        setCurrentIndex(0);
        setIsPlaying(false);
        setIsLive(false);
        setVersion(v => v + 1);
        setStatus('idle');
        return;
      }

      let canonicalPoints = points;
      let canonicalFuturecast: GeoFrame[] | null = null;

      try {
        const response = await fetch('/api/geoconsole/process', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputs: points.map(point => ({
              ...point,
              timestamp: new Date(point.timestamp).toISOString(),
              receivedAt: point.receivedAt ? new Date(point.receivedAt).toISOString() : undefined,
              provenance: point.provenance
                ? {
                    ...point.provenance,
                    capturedAt: point.provenance.capturedAt
                      ? new Date(point.provenance.capturedAt).toISOString()
                      : undefined,
                  }
                : undefined,
            })),
          }),
        });

        if (response.ok) {
          const payload = await response.json();
          const fusedLocations = Array.isArray(payload?.data?.fusedLocations)
            ? payload.data.fusedLocations
            : [];
          const fusedPoints = fusedLocations
            .map((entry: any) => entry?.point || entry)
            .filter((point: any) =>
              Number.isFinite(Number(point?.latitude)) &&
              Number.isFinite(Number(point?.longitude)) &&
              point?.timestamp
            );

          if (fusedPoints.length > 0) {
            canonicalPoints = fusedPoints as GPSPoint[];
          }

          const predictions = Array.isArray(payload?.data?.futurecast)
            ? payload.data.futurecast
            : [];
          if (predictions.length > 0) {
            canonicalFuturecast = predictionPayloadToFrames(predictions);
          }
        }
      } catch {
        // Raw observations remain valid fallback input when the fusion endpoint
        // is temporarily unavailable. No synthetic positions are introduced.
      }

      let newFrames = convertToFrames(canonicalPoints);
      if (newFrames.length === 0) {
        framesRef.current = [];
        setFrames([]);
        setFuturecastFrames([]);
        setCurrentIndex(0);
        setIsPlaying(false);
        setIsLive(false);
        setVersion(v => v + 1);
        setStatus('idle');
        return;
      }

      const latestObservedMs = newFrames[newFrames.length - 1].timestamp.getTime();
      newFrames = newFrames.filter(
        frame => frame.timestamp.getTime() >= latestObservedMs - ONE_HOUR_MS
      );

      if (newFrames.length > cfg.maxFrameBuffer) {
        newFrames = newFrames.slice(-cfg.maxFrameBuffer);
      }

      framesRef.current = [...newFrames];
      setFrames([...newFrames]);
      setCurrentIndex(Math.max(0, newFrames.length - 1));
      setVersion(v => v + 1);

      if (canonicalFuturecast && canonicalFuturecast.length > 0) {
        setFuturecastFrames(canonicalFuturecast);
      } else {
        void requestAuthoritativeFuturecast(newFrames);
      }

      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
      setStatus('error');
    }
  }, [
    convertToFrames,
    cfg.maxFrameBuffer,
    predictionPayloadToFrames,
    requestAuthoritativeFuturecast,
  ]);


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
    // REAL-WORLD ONLY: use the device geolocation provider (no synthetic motion).
    // If permissions are denied or geolocation is unavailable, LIVE mode will not fabricate frames.
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setError('Geolocation is unavailable in this environment');
      setStatus('error');
      return;
    }

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = new Date(pos.timestamp || Date.now());
        const coords = pos.coords;

        const latitude = coords.latitude;
        const longitude = coords.longitude;
        const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : undefined;
        const altitude = Number.isFinite(coords.altitude) ? coords.altitude ?? undefined : undefined;

        const prevFrames = framesRef.current;
        const last = prevFrames.length > 0 ? prevFrames[prevFrames.length - 1] : null;

        // Prefer provider-reported values when available.
        let speed = Number.isFinite(coords.speed) ? (coords.speed ?? undefined) : undefined;
        let heading = Number.isFinite(coords.heading) ? (coords.heading ?? undefined) : undefined;

        // If the provider does not report speed/heading, compute from last fix.
        if (last) {
          const dt = Math.max(1, (now.getTime() - last.timestamp.getTime()) / 1000);
          const dist = haversineDistance(last.position.latitude, last.position.longitude, latitude, longitude);
          if (speed === undefined) speed = dist / dt;
          if (heading === undefined) heading = calculateBearing(last.position.latitude, last.position.longitude, latitude, longitude);
        }

        const confidence = accuracy !== undefined ? clamp(1 - accuracy / 100, 0.1, 1) : 0.85;

        const newFrame: GeoFrame = {
          id: generateId(),
          timestamp: now,
          position: {
            latitude,
            longitude,
            altitude,
            accuracy,
            verticalAccuracy: Number.isFinite(coords.altitudeAccuracy) ? coords.altitudeAccuracy ?? undefined : undefined,
          },
          receivedAt: new Date(),
          observationKind: 'observed',
          correlationGroup: 'browser:navigator.geolocation',
          provenance: {
            provider: 'navigator.geolocation',
            capturedAt: now.toISOString(),
          },
          velocity: speed !== undefined || heading !== undefined
            ? { speed: speed ?? 0, heading: heading ?? 0 }
            : undefined,
          source: 'device_gps',
          confidence,
          metadata: {
            live: true,
            provider: 'navigator.geolocation',
            headingAccuracyAvailable: false,
          },
        };

        const cutoff = newFrame.timestamp.getTime() - ONE_HOUR_MS;
        const updated = [...framesRef.current, newFrame]
          .filter(frame => frame.timestamp.getTime() >= cutoff);
        const trimmed = updated.length > cfg.maxFrameBuffer ? updated.slice(-cfg.maxFrameBuffer) : updated;
        framesRef.current = trimmed;
        setFrames([...trimmed]);
        setCurrentIndex(trimmed.length - 1);

        const nowMs = Date.now();
        if (
          trimmed.length >= 3 &&
          nowMs - liveFuturecastLastRequestRef.current >= 30_000
        ) {
          liveFuturecastLastRequestRef.current = nowMs;
          void requestAuthoritativeFuturecast(trimmed);
        }

        setStatus('playing');
        setError(null);
        setVersion((v) => v + 1);
      },
      (err) => {
        setError(err?.message || 'Geolocation watch failed');
        setStatus('error');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10_000,
      }
    );

    return () => {
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {
        // ignore
      }
    };
  }, [isLive, cfg.autoFetch, cfg.maxFrameBuffer, requestAuthoritativeFuturecast]);

  // === DERIVED STATE (computed from index + frames) ===
  
  // Current frame - derived directly from index
  const currentFrame = frames.length > 0 && currentIndex >= 0 && currentIndex < frames.length
    ? frames[currentIndex]
    : null;

  // Trail - all frames up to current index (IMMUTABLE slice)
  const trail = frames.slice(0, currentIndex + 1);

  // Weather-map-style window: previous hour through one-hour Futurecast.
  const anchorTime = frames.length > 0
    ? frames[frames.length - 1].timestamp
    : new Date();
  const timeline = {
    start: new Date(anchorTime.getTime() - ONE_HOUR_MS),
    end: new Date(anchorTime.getTime() + ONE_HOUR_MS),
    current: currentFrame?.timestamp || anchorTime,
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
    if (framesRef.current.length === 0) {
      // Nothing to play
      return;
    }
    setIsPlaying(true);
    setVersion(v => v + 1);
  }, []);

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
      const next = !prev;
      if (next) {
        // LIVE can start from an empty buffer; navigator.geolocation supplies
        // the first real observation instead of requiring synthetic seed data.
        setCurrentIndex(Math.max(0, framesRef.current.length - 1));
        setIsPlaying(true);
        setStatus(framesRef.current.length > 0 ? 'playing' : 'loading');
      } else {
        setIsPlaying(false);
        setStatus(framesRef.current.length > 0 ? 'paused' : 'idle');
      }
      setVersion(v => v + 1);
      return next;
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
      await requestAuthoritativeFuturecast(frames);
      setStatus('idle');
      setVersion(v => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
      setStatus('error');
    }
  }, [frames, requestAuthoritativeFuturecast]);

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
