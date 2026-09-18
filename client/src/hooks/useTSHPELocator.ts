/**
 * TSHPE compatibility adapter.
 *
 * TSHPE's useful acquisition/prediction behavior now runs through the canonical
 * GeoConsole services. This file intentionally contains no independent Kalman
 * authority, random Monte-Carlo weighting, synthetic health telemetry, or
 * third-party client IP geolocation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

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
  network: TriangulationSource;
  vector: TriangulationSource;
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

const EMPTY_SOURCE: TriangulationSource = {
  active: false,
  weight: 0,
  accuracy: Number.MAX_SAFE_INTEGER,
  lastUpdate: 0,
};

const UNKNOWN_POSITION: Position = {
  lat: 0,
  lon: 0,
  accuracy: Number.MAX_SAFE_INTEGER,
  timestamp: 0,
  source: undefined,
};

function bearingDegrees(a: Position, b: Position): number {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function mapServerPoint(point: any): Position | null {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return null;
  }

  const timestamp = new Date(point?.timestamp || Date.now()).getTime();
  return {
    lat: latitude,
    lon: longitude,
    altitude: Number.isFinite(Number(point?.altitude)) ? Number(point.altitude) : undefined,
    accuracy: Number.isFinite(Number(point?.accuracy)) ? Number(point.accuracy) : undefined,
    heading: Number.isFinite(Number(point?.metadata?.averageHeadingDegrees))
      ? Number(point.metadata.averageHeadingDegrees)
      : undefined,
    speed: Number.isFinite(Number(point?.metadata?.averageSpeedMps))
      ? Number(point.metadata.averageSpeedMps)
      : undefined,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    source: 'fused',
  };
}

export function useTSHPELocator() {
  const [currentPosition, setCurrentPosition] = useState<Position>(UNKNOWN_POSITION);
  const [positionHistory, setPositionHistory] = useState<Position[]>([]);
  const [predictedCone, setPredictedCone] = useState<PredictedCone | null>(null);
  const [accuracy, setAccuracy] = useState(Number.MAX_SAFE_INTEGER);
  const [isTracking, setIsTracking] = useState(false);
  const [monteCarloScore, setMonteCarloScore] = useState(0);

  const [triangulationData, setTriangulationData] = useState<TriangulationData>({
    gps: { ...EMPTY_SOURCE },
    wifi: { ...EMPTY_SOURCE },
    cellular: { ...EMPTY_SOURCE },
    ip: { ...EMPTY_SOURCE },
    network: { ...EMPTY_SOURCE },
    vector: { ...EMPTY_SOURCE },
  });

  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    cpu: 0,
    memory: 0,
    thermal: 'normal',
    pollInterval: 5000,
  });

  const watchIdRef = useRef<number | null>(null);
  const historyRef = useRef<Position[]>([]);
  const futurecastRequestRef = useRef(0);
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateMeasuredBrowserHealth = useCallback(() => {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const memory = perf.memory && perf.memory.jsHeapSizeLimit > 0
      ? Math.round((perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit) * 100)
      : 0;

    setSystemHealth({
      cpu: 0,
      memory,
      thermal: 'normal',
      pollInterval: 5000,
    });
  }, []);

  const requestFuturecast = useCallback(async (history: Position[]) => {
    if (history.length < 3) {
      setPredictedCone(null);
      setMonteCarloScore(0);
      return;
    }

    const requestId = ++futurecastRequestRef.current;
    const recent = history.slice(-20);

    try {
      const response = await fetch('/api/geoconsole/futurecast', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: 1,
          recentPoints: recent.map(position => ({
            latitude: position.lat,
            longitude: position.lon,
            altitude: position.altitude,
            accuracy: position.accuracy,
            timestamp: new Date(position.timestamp || Date.now()).toISOString(),
            source: position.source === 'gps' ? 'device_gps' : 'interpolated',
            confidence: position.accuracy && Number.isFinite(position.accuracy)
              ? Math.max(0.35, Math.min(0.98, 1 - position.accuracy / 500))
              : 0.5,
            observationKind: 'observed',
            correlationGroup: position.source === 'gps'
              ? 'browser:navigator.geolocation'
              : undefined,
            provenance: position.source === 'gps'
              ? { provider: 'navigator.geolocation' }
              : undefined,
          })),
        }),
      });

      if (!response.ok) return;
      const payload = await response.json();
      if (requestId !== futurecastRequestRef.current) return;

      const predictions = Array.isArray(payload?.data?.predictions)
        ? payload.data.predictions
        : [];
      if (predictions.length === 0) {
        setPredictedCone(null);
        setMonteCarloScore(0);
        return;
      }

      const latestPrediction = predictions[predictions.length - 1];
      const predicted = mapServerPoint(latestPrediction);
      const current = history[history.length - 1];
      if (!predicted || !current) return;

      const averageConfidence = predictions.reduce(
        (sum: number, point: any) => sum + Number(point?.confidence || 0),
        0,
      ) / predictions.length;

      setPredictedCone({
        center: predicted,
        radiusNow: Math.max(1, current.accuracy || 1),
        radiusFuture: Math.max(
          current.accuracy || 1,
          Number(latestPrediction?.accuracy || current.accuracy || 1),
        ),
        angle: Number(
          latestPrediction?.metadata?.averageHeadingDegrees ??
          bearingDegrees(current, predicted),
        ),
        confidence: Math.max(0, Math.min(1, averageConfidence)),
      });
      setMonteCarloScore(Math.max(0, Math.min(1, averageConfidence)));
    } catch {
      // Server futurecast is the authority; do not invent a local prediction.
    }
  }, []);

  const ingestBrowserFix = useCallback(async (position: GeolocationPosition) => {
    const observed: Position = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading ?? undefined,
      speed: position.coords.speed ?? undefined,
      altitude: position.coords.altitude ?? undefined,
      timestamp: position.timestamp || Date.now(),
      source: 'gps',
    };

    const now = Date.now();
    setTriangulationData(previous => ({
      ...previous,
      gps: {
        active: true,
        weight: 1,
        accuracy: observed.accuracy || Number.MAX_SAFE_INTEGER,
        lastUpdate: now,
      },
      network: { ...previous.network, active: false, weight: 0 },
      vector: {
        ...previous.vector,
        active: historyRef.current.length > 1,
        weight: historyRef.current.length > 1 ? 1 : 0,
        lastUpdate: now,
      },
    }));

    let canonical = observed;

    try {
      const response = await fetch('/api/geoconsole/process', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [{
            latitude: observed.lat,
            longitude: observed.lon,
            altitude: observed.altitude,
            accuracy: observed.accuracy,
            timestamp: new Date(observed.timestamp || now).toISOString(),
            receivedAt: new Date(now).toISOString(),
            source: 'device_gps',
            confidence: observed.accuracy && Number.isFinite(observed.accuracy)
              ? Math.max(0.35, Math.min(0.98, 1 - observed.accuracy / 500))
              : 0.6,
            observationKind: 'observed',
            correlationGroup: 'browser:navigator.geolocation',
            provenance: {
              provider: 'navigator.geolocation',
              capturedAt: new Date(observed.timestamp || now).toISOString(),
            },
            metadata: {
              speed: observed.speed,
              heading: observed.heading,
            },
          }],
        }),
      });

      if (response.ok) {
        const payload = await response.json();
        const fused = Array.isArray(payload?.data?.fusedLocations)
          ? payload.data.fusedLocations
          : [];
        const serverPoint = fused.length > 0
          ? mapServerPoint(fused[fused.length - 1]?.point || fused[fused.length - 1])
          : null;
        if (serverPoint) {
          canonical = {
            ...serverPoint,
            heading: observed.heading,
            speed: observed.speed,
            source: 'fused',
          };
        }
      }
    } catch {
      // Preserve the real browser fix if server processing is temporarily unavailable.
    }

    setCurrentPosition(canonical);
    setAccuracy(canonical.accuracy ?? observed.accuracy ?? Number.MAX_SAFE_INTEGER);

    const updated = [...historyRef.current, canonical].slice(-10_000);
    historyRef.current = updated;
    setPositionHistory([...updated]);

    if (updated.length >= 3) {
      void requestFuturecast(updated);
    }
  }, [requestFuturecast]);

  const handleGPSError = useCallback(() => {
    setTriangulationData(previous => ({
      ...previous,
      gps: { ...previous.gps, active: false, weight: 0 },
    }));
  }, []);

  const startTracking = useCallback(() => {
    if (watchIdRef.current !== null) return;
    setIsTracking(true);

    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        position => void ingestBrowserFix(position),
        handleGPSError,
        {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        },
      );
    }

    updateMeasuredBrowserHealth();
    statusTimerRef.current = setInterval(updateMeasuredBrowserHealth, 5000);
  }, [handleGPSError, ingestBrowserFix, updateMeasuredBrowserHealth]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const getHistoryRange = useCallback((startTime: number, endTime: number): Position[] => {
    return historyRef.current.filter(position => {
      const timestamp = position.timestamp || 0;
      return timestamp >= startTime && timestamp <= endTime;
    });
  }, []);

  useEffect(() => stopTracking, [stopTracking]);

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
