/**
 * SPECTRA GeoConsole Radar Dashboard
 * 
 * Production-grade satellite tracking with TIGHT map lifecycle:
 * - Map created ONCE on mount, stored in ref
 * - Updates bound to DATA MUTATIONS (frame index, version), not UI flags
 * - No memoization that could freeze updates
 * - Direct imperative map updates on every frame change
 */

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Play, Pause, SkipBack, SkipForward, Clock, Activity, Layers,
  RefreshCw, Download, Satellite, Radio, Crosshair, Zap, Target,
  ChevronLeft, ChevronRight, Maximize2, Minimize2,
} from 'lucide-react';
import { useGeoRuntime, type GeoFrame } from '@/hooks/useGeoRuntime';
import type { GPSPoint } from '@shared/geoconsoleTypes';

// ============================================================================
// TYPES
// ============================================================================

interface GeoconsoleProps {
  initialData?: GPSPoint[];
  onProcess?: (data: GPSPoint[]) => Promise<void>;
  /**
   * Optional nav mode provided by the parent "People Finder" GeoConsole tabs.
   * When set, the dashboard will respond by switching to the appropriate view defaults.
   */
  navMode?: 'timeline' | 'map' | 'satellite';
}

interface LayerState {
  satellite: boolean;
  trail: boolean;
  heatmap: boolean;
  markers: boolean;
  futurecast: boolean;
  reticle: boolean;
}

type MapMode = 'satellite' | 'hybrid' | 'street' | 'dark';

// ============================================================================
// CONSTANTS
// ============================================================================

const TILE_LAYERS: Record<string, { url: string; attribution: string }> = {
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri' },
  street: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '© CartoDB' },
  labels: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', attribution: '' },
};

const SPEED_COLORS = { stationary: '#3b82f6', walking: '#22c55e', running: '#eab308', cycling: '#f97316', driving: '#ef4444' };
const MPS_TO_MPH = 2.237;

const SOURCE_KEYS = ['device_gps', 'wifi_handoff', 'public_record', 'interpolated'] as const;
type SourceKey = typeof SOURCE_KEYS[number];

// ============================================================================
// HELPERS
// ============================================================================

const formatTime = (date: Date): string => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
const formatDuration = (s: number): string => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const formatDistance = (m: number): string => m >= 1609.34 ? `${(m / 1609.34).toFixed(2)} mi` : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const formatSpeed = (mps: number): string => `${(mps * MPS_TO_MPH).toFixed(1)} mph`;
const getSpeedColor = (speed: number): string => speed < 0.5 ? SPEED_COLORS.stationary : speed < 2 ? SPEED_COLORS.walking : speed < 5 ? SPEED_COLORS.running : speed < 10 ? SPEED_COLORS.cycling : SPEED_COLORS.driving;

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ============================================================================
// ICONS
// ============================================================================

const createReticleIcon = (color: string, size = 40): L.DivIcon => L.divIcon({
  className: 'geo-reticle',
  html: `<div style="width:${size}px;height:${size}px;"><svg viewBox="0 0 100 100" style="width:100%;height:100%;filter:drop-shadow(0 0 8px ${color});"><circle cx="50" cy="50" r="45" fill="none" stroke="${color}" stroke-width="2" opacity="0.3"/><circle cx="50" cy="50" r="30" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/><circle cx="50" cy="50" r="15" fill="none" stroke="${color}" stroke-width="2"/><circle cx="50" cy="50" r="5" fill="${color}"/><line x1="50" y1="0" x2="50" y2="35" stroke="${color}" stroke-width="2"/><line x1="50" y1="65" x2="50" y2="100" stroke="${color}" stroke-width="2"/><line x1="0" y1="50" x2="35" y2="50" stroke="${color}" stroke-width="2"/><line x1="65" y1="50" x2="100" y2="50" stroke="${color}" stroke-width="2"/></svg></div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

const createDotIcon = (color: string, size = 10, opacity = 1): L.DivIcon => L.divIcon({
  className: 'geo-dot',
  html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 0 6px ${color};opacity:${opacity};"></div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

// ============================================================================
// MAP LAYER MANAGEMENT (Imperative - no React dependency)
// ============================================================================

interface MapLayerRefs {
  trailSegments: L.Polyline[];
  heatLayer: L.Layer | null;
  currentMarker: L.Marker | null;
  trailMarkers: L.Marker[];
  futurecastLine: L.Polyline | null;
  futurecastMarkers: L.Marker[];
}

// Clear all dynamic layers
function clearLayers(map: L.Map, refs: MapLayerRefs): void {
  refs.trailSegments.forEach(s => map.removeLayer(s));
  refs.trailSegments = [];
  if (refs.heatLayer) { map.removeLayer(refs.heatLayer); refs.heatLayer = null; }
  if (refs.currentMarker) { map.removeLayer(refs.currentMarker); refs.currentMarker = null; }
  refs.trailMarkers.forEach(m => map.removeLayer(m));
  refs.trailMarkers = [];
  if (refs.futurecastLine) { map.removeLayer(refs.futurecastLine); refs.futurecastLine = null; }
  refs.futurecastMarkers.forEach(m => map.removeLayer(m));
  refs.futurecastMarkers = [];
}

// Update map with current frame data - CALLED ON EVERY FRAME CHANGE
function renderFrame(
  map: L.Map,
  refs: MapLayerRefs,
  currentFrame: GeoFrame | null,
  trail: GeoFrame[],
  futurecast: GeoFrame[],
  layerCfg: LayerState,
  isLive: boolean,
  lockOnTarget: boolean
): void {
  // Always clear first - no conditional
  clearLayers(map, refs);

  // If no data, done
  if (!currentFrame && trail.length === 0) return;

  // Trail segments with speed coloring
  if (layerCfg.trail && trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const prev = trail[i - 1];
      const curr = trail[i];
      const segment = L.polyline(
        [[prev.position.latitude, prev.position.longitude], [curr.position.latitude, curr.position.longitude]],
        { color: getSpeedColor(curr.velocity?.speed || 0), weight: 4, opacity: 0.3 + (i / trail.length) * 0.7 }
      ).addTo(map);
      refs.trailSegments.push(segment);
    }
  }

  // Heatmap
  if (layerCfg.heatmap && trail.length > 0) {
    const data = trail.map((f, i) => [f.position.latitude, f.position.longitude, 0.3 + (i / trail.length) * 0.7] as [number, number, number]);
    refs.heatLayer = (L as any).heatLayer(data, { radius: 25, blur: 15, maxZoom: 17, gradient: { 0: '#0000ff', 0.25: '#00ffff', 0.5: '#00ff00', 0.75: '#ffff00', 1: '#ff0000' } }).addTo(map);
  }

  // Trail markers (sampled)
  if (layerCfg.markers && trail.length > 0) {
    const step = Math.max(1, Math.floor(trail.length / 15));
    for (let i = 0; i < trail.length; i += step) {
      const f = trail[i];
      const marker = L.marker([f.position.latitude, f.position.longitude], { icon: createDotIcon(getSpeedColor(f.velocity?.speed || 0), 10, 0.3 + (i / trail.length) * 0.7) }).addTo(map);
      marker.bindPopup(`<b>${formatTime(f.timestamp)}</b><br/>Speed: ${formatSpeed(f.velocity?.speed || 0)}`);
      refs.trailMarkers.push(marker);
    }
  }

  // Futurecast
  if (layerCfg.futurecast && futurecast.length > 0) {
    refs.futurecastLine = L.polyline(futurecast.map(f => [f.position.latitude, f.position.longitude] as [number, number]), { color: '#a855f7', weight: 3, opacity: 0.6, dashArray: '10, 10' }).addTo(map);
    futurecast.forEach((f, i) => {
      const marker = L.marker([f.position.latitude, f.position.longitude], { icon: createDotIcon('#a855f7', 8, 0.8 - (i / futurecast.length) * 0.5) }).addTo(map);
      marker.bindPopup(`<b>Predicted: ${formatTime(f.timestamp)}</b><br/>Conf: ${(f.confidence * 100).toFixed(0)}%`);
      refs.futurecastMarkers.push(marker);
    });
  }

  // Current position reticle
  if (layerCfg.reticle && currentFrame) {
    refs.currentMarker = L.marker(
      [currentFrame.position.latitude, currentFrame.position.longitude],
      { icon: createReticleIcon(isLive ? '#00ff00' : '#00f0ff', 50), zIndexOffset: 1000 }
    ).addTo(map);
    
    // Pan to current (when "FIX" lock is enabled)
    if (lockOnTarget) {
      map.panTo([currentFrame.position.latitude, currentFrame.position.longitude], { animate: true, duration: 0.2 });
    }
  }

  // Force redraw (guard zero-sized containers to avoid leaflet.heat canvas errors)
  try {
    const size = map.getSize();
    if (size.x > 0 && size.y > 0) map.invalidateSize();
  } catch {
    // ignore
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export const GeoconsoleRadarDashboard: React.FC<GeoconsoleProps> = ({ initialData = [], onProcess, navMode }) => {
  // Runtime hook - source of truth for frames
  const [state, actions] = useGeoRuntime(initialData, { tickInterval: 500, playbackSpeed: 1, interpolationEnabled: true, predictiveEnabled: true });

  useEffect(() => {
    actions.loadData(initialData);
  }, [actions.loadData, initialData]);

  // UI state (not affecting frame data)
  const [mapMode, setMapMode] = useState<MapMode>('satellite');
  const [layerCfg, setLayerCfg] = useState<LayerState>({ satellite: true, trail: true, heatmap: true, markers: true, futurecast: true, reticle: true });
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [lockOnTarget, setLockOnTarget] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Respond to external navigation ("nav links") from the embedding page.
  useEffect(() => {
    if (!navMode) return;
    if (navMode === 'satellite') setMapMode('satellite');
    if (navMode === 'map') setMapMode('street');
    // timeline mode focuses playback; we keep the operator-selected base layer.
  }, [navMode]);

  // Fullscreen mode: lock body scroll and force Leaflet to re-measure.
  useEffect(() => {
    const map = mapRef.current;
    const previousOverflow = document.body.style.overflow;
    if (isFullscreen) document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      try {
        map?.invalidateSize();
      } catch {
        // ignore
      }
    }, 50);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  // Source filter ("signal links")
  const [sourceCfg, setSourceCfg] = useState<Record<SourceKey, boolean>>({
    device_gps: true,
    wifi_handoff: true,
    public_record: true,
    interpolated: true,
  });

  const sourceEnabled = useCallback((s: string) => {
    if ((SOURCE_KEYS as readonly string[]).includes(s)) return sourceCfg[s as SourceKey];
    // Default allow for unknown/extra sources so we don't silently hide data.
    return true;
  }, [sourceCfg]);

  // Derive the frames actually rendered (filters affect map + stats + sources panel)
  const renderData = useMemo(() => {
    const trailWithIndex = state.trail.map((f, idx) => ({ f, idx }));
    const filteredTrail = trailWithIndex.filter(({ f }) => sourceEnabled(f.source));
    const filteredFuturecast = sourceEnabled('interpolated')
      ? state.futurecast
      : [];

    const current = filteredTrail.length > 0 ? filteredTrail[filteredTrail.length - 1].f : null;

    // Stats computed over the rendered trail
    let totalDistance = 0;
    let maxSpeed = 0;
    const speeds: number[] = [];
    for (let i = 1; i < filteredTrail.length; i++) {
      const prev = filteredTrail[i - 1].f;
      const curr = filteredTrail[i].f;
      totalDistance += haversineDistance(
        prev.position.latitude, prev.position.longitude,
        curr.position.latitude, curr.position.longitude
      );
      if (curr.velocity?.speed) {
        speeds.push(curr.velocity.speed);
        maxSpeed = Math.max(maxSpeed, curr.velocity.speed);
      }
    }
    const duration = filteredTrail.length >= 2
      ? (filteredTrail[filteredTrail.length - 1].f.timestamp.getTime() - filteredTrail[0].f.timestamp.getTime()) / 1000
      : 0;
    const averageSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

    return {
      trail: filteredTrail.map(x => x.f),
      currentFrame: current,
      futurecast: filteredFuturecast,
      stats: { totalDistance, averageSpeed, maxSpeed, duration },
      // for timeline list interaction
      trailIndices: filteredTrail.map(x => x.idx),
    };
  }, [state.trail, state.futurecast, sourceEnabled]);

  // Map refs - single instance
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const labelsRef = useRef<L.TileLayer | null>(null);
  const layerRefs = useRef<MapLayerRefs>({ trailSegments: [], heatLayer: null, currentMarker: null, trailMarkers: [], futurecastLine: null, futurecastMarkers: [] });
  const initRef = useRef(false);

  // Prevent post-unmount timeouts from touching Leaflet/state
  const mountedRef = useRef(true);
  const initInvalidateTimeoutRef = useRef<number | null>(null);
  const visibleInvalidateTimeoutRef = useRef<number | null>(null);
  const processResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (initInvalidateTimeoutRef.current) {
        window.clearTimeout(initInvalidateTimeoutRef.current);
        initInvalidateTimeoutRef.current = null;
      }
      if (visibleInvalidateTimeoutRef.current) {
        window.clearTimeout(visibleInvalidateTimeoutRef.current);
        visibleInvalidateTimeoutRef.current = null;
      }
      if (processResetTimeoutRef.current) {
        window.clearTimeout(processResetTimeoutRef.current);
        processResetTimeoutRef.current = null;
      }
    };
  }, []);

  // === MAP INITIALIZATION (ONCE) ===
  // PRODUCTION: Map center is determined dynamically from actual data
  // No hardcoded coordinates - center defaults to world view until real data arrives
  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    // Determine initial center from data or use world view (no hardcoded locations)
    const getInitialCenter = (): [number, number] => {
      // If we have initial data, center on first point
      if (initialData && initialData.length > 0) {
        const firstPoint = initialData[0];
        return [firstPoint.latitude, firstPoint.longitude];
      }
      // No data: default to world view (0,0 with low zoom)
      return [0, 0];
    };
    
    const initialCenter = getInitialCenter();
    const initialZoom = initialData && initialData.length > 0 ? 14 : 2;

    const map = L.map(containerRef.current, { center: initialCenter, zoom: initialZoom, zoomControl: false, attributionControl: false });
    L.control.zoom({ position: 'topleft' }).addTo(map);

    tileRef.current = L.tileLayer(TILE_LAYERS.satellite.url, { maxZoom: 19 }).addTo(map);
    labelsRef.current = L.tileLayer(TILE_LAYERS.labels.url, { maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    // CSS
    const style = document.createElement('style');
    style.id = 'geo-styles';
    style.textContent = '.geo-reticle,.geo-dot{background:transparent!important;border:none!important;}';
    if (!document.getElementById('geo-styles')) document.head.appendChild(style);

    initInvalidateTimeoutRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      // Avoid calling into Leaflet after map has been removed
      if (mapRef.current === map) map.invalidateSize();
    }, 100);

    return () => {
      if (initInvalidateTimeoutRef.current) {
        window.clearTimeout(initInvalidateTimeoutRef.current);
        initInvalidateTimeoutRef.current = null;
      }
      // Ensure dynamic layers are removed before teardown
      try {
        clearLayers(map, layerRefs.current);
      } catch {
        // ignore
      }
      map.remove();
      mapRef.current = null;
      initRef.current = false;
    };
  }, []);

  // === TILE LAYER CHANGE ===
  useEffect(() => {
    if (!mapRef.current || !tileRef.current) return;
    const effectiveMapMode: MapMode =
      !layerCfg.satellite && (mapMode === 'satellite' || mapMode === 'hybrid')
        ? 'street'
        : mapMode;

    const cfg = effectiveMapMode === 'hybrid' ? TILE_LAYERS.satellite : TILE_LAYERS[effectiveMapMode];
    tileRef.current.setUrl(cfg.url);
    
    if (labelsRef.current) {
      if (layerCfg.satellite && (effectiveMapMode === 'satellite' || effectiveMapMode === 'hybrid')) {
        if (!mapRef.current.hasLayer(labelsRef.current)) labelsRef.current.addTo(mapRef.current);
      } else {
        if (mapRef.current.hasLayer(labelsRef.current)) mapRef.current.removeLayer(labelsRef.current);
      }
    }
    mapRef.current.invalidateSize();
  }, [mapMode, layerCfg.satellite]);

  // === FRAME UPDATE - BOUND TO DATA, NOT FLAGS ===
  // Dependencies: currentIndex, _version (mutation counter), trail length, layerCfg
  // This ensures updates fire on actual data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Direct render - no memoization, no debounce
    renderFrame(
      map,
      layerRefs.current,
      renderData.currentFrame,
      renderData.trail,
      renderData.futurecast,
      layerCfg,
      state.isLive,
      lockOnTarget
    );

  }, [
    state.currentIndex,
    state._version,
    state.trail.length,
    state.futurecast.length,
    layerCfg,
    state.isLive,
    state.currentFrame,
    renderData,
    lockOnTarget,
  ]);

  // === RESIZE/VISIBILITY ===
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const safeInvalidate = () => {
      const el = containerRef.current;
      if (!el) return;
      // If the container is temporarily hidden or not laid out, skip.
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      try {
        map.invalidateSize();
      } catch {
        // ignore
      }
    };
    const onResize = () => safeInvalidate();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (visibleInvalidateTimeoutRef.current) {
        window.clearTimeout(visibleInvalidateTimeoutRef.current);
        visibleInvalidateTimeoutRef.current = null;
      }
      visibleInvalidateTimeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        if (mapRef.current === map) safeInvalidate();
      }, 50);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisible);
      if (visibleInvalidateTimeoutRef.current) {
        window.clearTimeout(visibleInvalidateTimeoutRef.current);
        visibleInvalidateTimeoutRef.current = null;
      }
    };
  }, []);

  // === STEP HANDLERS ===
  const stepBack = useCallback(() => actions.seekTo(Math.max(0, state.currentIndex - 1)), [actions, state.currentIndex]);
  const stepForward = useCallback(() => actions.seekTo(Math.min(state.totalFrames - 1, state.currentIndex + 1)), [actions, state.currentIndex, state.totalFrames]);

  // === PROCESS/EXPORT ===
  const handleProcess = useCallback(async () => {
    if (state.trail.length === 0) return;
    setProcessing(true);
    setProgressMsg('Processing...');
    try {
      const res = await fetch('/api/geoconsole/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: state.trail.map(f => ({ latitude: f.position.latitude, longitude: f.position.longitude, timestamp: f.timestamp.toISOString(), source: f.source, confidence: f.confidence })) }),
      });
      if (res.ok) { setProgressMsg('Done!'); if (onProcess) await onProcess(state.trail as any); }
      else setProgressMsg('Error');
    } catch (e) { setProgressMsg('Error'); }
    finally {
      if (processResetTimeoutRef.current) {
        window.clearTimeout(processResetTimeoutRef.current);
        processResetTimeoutRef.current = null;
      }
      processResetTimeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setProcessing(false);
        setProgressMsg('');
      }, 2000);
    }
  }, [state.trail, onProcess]);

  const handleExport = useCallback(() => {
    const frames = actions.exportTrail();
    const geo = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: frames.map(f => [f.position.longitude, f.position.latitude]) }, properties: { frames: frames.length } }] };
    const blob = new Blob([JSON.stringify(geo, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `geo-${Date.now()}.geojson`; a.click();
  }, [actions]);

  // Destructure
  const { isPlaying, isLive, timeline, totalFrames, currentIndex } = state;
  const { currentFrame } = renderData;
  const stats = renderData.stats;

  // Link status states for satellite, geo, fix, signal, and nav connections
  const [linkStatus, setLinkStatus] = useState({
    sat: { active: false, signal: 0, label: 'Satellite Link' },
    geo: { active: false, signal: 0, label: 'Geo Link' },
    fix: { active: false, signal: 0, label: 'Fix Link' },
    signal: { active: false, signal: 0, label: 'Signal Link' },
    nav: { active: false, signal: 0, label: 'Nav Link' },
  });

  // Connect and activate links based on data availability
  useEffect(() => {
    const hasData = state.trail.length > 0;
    const hasLiveData = state.isLive;
    const hasGPS = state.trail.some(f => f.source === 'device_gps');
    const hasWifi = state.trail.some(f => f.source === 'wifi_handoff');
    const hasPublicRecord = state.trail.some(f => f.source === 'public_record');
    
    setLinkStatus({
      sat: { 
        active: hasData && (hasGPS || state.trail.some(f => f.source === 'satellite_imagery')), 
        signal: hasData ? Math.min(100, 60 + state.trail.length * 2) : 0,
        label: 'Satellite Link'
      },
      geo: { 
        active: hasData, 
        signal: hasData ? Math.min(100, 50 + state.stats.totalDistance / 100) : 0,
        label: 'Geo Link'
      },
      fix: { 
        active: hasData && state.currentFrame !== null, 
        signal: state.currentFrame ? Math.min(100, state.currentFrame.confidence * 100) : 0,
        label: 'Fix Link'
      },
      signal: { 
        active: hasWifi || hasGPS, 
        signal: hasLiveData ? 95 : hasData ? 70 : 0,
        label: 'Signal Link'
      },
      nav: { 
        active: hasData && state.futurecast.length > 0, 
        signal: state.futurecast.length > 0 ? Math.min(100, 50 + state.futurecast.length * 5) : 0,
        label: 'Nav Link'
      },
    });
  }, [state.trail, state.isLive, state.currentFrame, state.futurecast, state.stats.totalDistance]);

  return (
    <div
      className={`${isFullscreen ? 'fixed inset-0 z-[5000]' : ''} flex flex-col h-full min-h-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/50 bg-slate-900/80 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Satellite className="w-5 h-5" />
            </div>
            {isLive && <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />}
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">SPECTRA GeoConsole</h1>
            <p className="text-xs text-slate-400">Satellite Intelligence</p>
          </div>
        </div>
        
        {/* Link Status Indicators - SAT, GEO, FIX, SIGNAL, NAV */}
        <div className="flex items-center gap-1">
          {Object.entries(linkStatus).map(([key, link]) => (
            <div 
              key={key} 
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono ${
                link.active 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                  : 'bg-slate-700/50 text-slate-500 border border-slate-600/30'
              }`}
              title={`${link.label}: ${link.signal}%`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${link.active ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="uppercase">{key}</span>
              {link.active && <span className="text-[10px] opacity-70">{link.signal}%</span>}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs ${isLive ? 'bg-green-500/20 text-green-400 animate-pulse' : isPlaying ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-700/50 text-slate-400'}`}>
            <Activity className="w-3 h-3 mr-1" />{isLive ? 'LIVE' : isPlaying ? 'Playing' : 'Paused'}
          </Badge>
          <Badge variant="outline" className="text-xs bg-purple-500/20 text-purple-400">{currentIndex + 1}/{totalFrames}</Badge>
          <div className="flex bg-slate-800/50 rounded-lg p-1">
            {(['satellite', 'hybrid', 'street', 'dark'] as MapMode[]).map(m => (
              <button key={m} onClick={() => setMapMode(m)} className={`px-2 py-1 text-xs rounded ${mapMode === m ? 'bg-cyan-500/30 text-cyan-400' : 'text-slate-400 hover:text-white'}`}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(v => !v)}
            className="bg-slate-800/50 border-slate-700 text-slate-200"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Main - Full Viewport Stretch */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Map Container - Stretches to Fill Available Space */}
        <div className="flex-1 relative min-h-0 min-w-0">
          <div ref={containerRef} className="absolute inset-0 z-0" style={{ background: '#1a1a2e' }} />
          {/* Zoom Controls Overlay */}
          <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
            <button 
              onClick={() => mapRef.current?.zoomIn()} 
              className="w-8 h-8 bg-slate-800/90 border border-slate-600/50 rounded text-white hover:bg-slate-700 flex items-center justify-center"
            >
              +
            </button>
            <button 
              onClick={() => mapRef.current?.zoomOut()} 
              className="w-8 h-8 bg-slate-800/90 border border-slate-600/50 rounded text-white hover:bg-slate-700 flex items-center justify-center"
            >
              −
            </button>
          </div>
          {/* Layer Quick Toggle */}
          <div className="absolute bottom-3 left-3 z-10 bg-slate-800/90 border border-slate-600/50 rounded-lg px-2 py-1">
            <span className="text-xs text-slate-400">Layers</span>
          </div>
        </div>

        {/* Stats Panel - Collapsible Sidebar */}
        <div className="w-64 xl:w-72 border-l border-slate-700/50 flex flex-col bg-slate-900/50 min-h-0 overflow-y-auto flex-shrink-0">
          {/* Controls */}
          <div className="p-2 border-b border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-cyan-400" />
                Controls
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLockOnTarget(v => !v)}
                  className={`h-6 text-xs ${lockOnTarget ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}
                  title={lockOnTarget ? 'FIX lock: on (auto-recenter)' : 'FIX lock: off'}
                >
                  FIX
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={actions.toggleLive}
                  className={`h-6 text-xs ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/40' : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}
                >
                  {isLive ? 'LIVE' : 'GO LIVE'}
                </Button>
              </div>
            </div>
            <div className="bg-slate-800/30 rounded-lg p-2 border border-slate-700/40">
              <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-slate-700/40">
                <Layers className="w-3 h-3 text-cyan-400" />
                <span className="text-xs font-medium">Layers</span>
              </div>
              {Object.entries(layerCfg).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-0.5">
                  <span className="text-[11px] text-slate-400 capitalize">{k}</span>
                  <Switch checked={v} onCheckedChange={c => setLayerCfg(p => ({ ...p, [k]: c }))} className="scale-[0.65]" />
                </div>
              ))}
            </div>
          </div>

          {/* Position */}
          {currentFrame && (
            <div className="p-2 border-b border-slate-700/50">
              <h3 className="text-xs font-medium mb-1.5 flex items-center gap-1.5"><Crosshair className="w-3 h-3 text-cyan-400" />Position</h3>
              <div className="space-y-0.5 text-[11px] font-mono bg-slate-800/30 rounded-lg p-1.5 border border-slate-700/40">
                <p><span className="text-slate-500">LAT:</span> <span className="text-cyan-400">{currentFrame.position.latitude.toFixed(6)}</span></p>
                <p><span className="text-slate-500">LNG:</span> <span className="text-cyan-400">{currentFrame.position.longitude.toFixed(6)}</span></p>
                <p><span className="text-slate-500">SPD:</span> <span className="text-green-400">{formatSpeed(currentFrame.velocity?.speed || 0)}</span></p>
                <p><span className="text-slate-500">HDG:</span> <span className="text-purple-400">{(currentFrame.velocity?.heading || 0).toFixed(1)}°</span></p>
              </div>
            </div>
          )}

          <div className="p-2 border-b border-slate-700/50">
            <h3 className="text-xs font-medium mb-1.5 flex items-center gap-1.5"><Activity className="w-3 h-3 text-cyan-400" />Stats</h3>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-slate-800/50 rounded p-1.5"><p className="text-[10px] text-slate-500">Distance</p><p className="font-bold text-sm text-cyan-400">{formatDistance(stats.totalDistance)}</p></div>
              <div className="bg-slate-800/50 rounded p-1.5"><p className="text-[10px] text-slate-500">Avg Spd</p><p className="font-bold text-sm text-green-400">{formatSpeed(stats.averageSpeed)}</p></div>
              <div className="bg-slate-800/50 rounded p-1.5"><p className="text-[10px] text-slate-500">Max Spd</p><p className="font-bold text-sm text-orange-400">{formatSpeed(stats.maxSpeed)}</p></div>
              <div className="bg-slate-800/50 rounded p-1.5"><p className="text-[10px] text-slate-500">Duration</p><p className="font-bold text-sm text-purple-400">{formatDuration(stats.duration)}</p></div>
            </div>
          </div>
          <div className="p-2 border-b border-slate-700/50">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-medium flex items-center gap-1.5"><Zap className="w-3 h-3 text-purple-400" />Futurecast</h3>
              <Badge variant="outline" className={`text-[10px] h-4 ${state.futurecast.length > 0 ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-700/50 text-slate-500'}`}>{state.futurecast.length > 0 ? 'Active' : 'Idle'}</Badge>
            </div>
            {state.futurecast.length > 0 ? (
              <div className="space-y-0.5">{state.futurecast.slice(0, 4).map((f, i) => (<div key={i} className="flex items-center text-[11px] bg-slate-800/30 rounded p-1"><Clock className="w-2.5 h-2.5 text-slate-500 mr-1" /><span className="text-slate-400 flex-1">{formatTime(f.timestamp)}</span><span className="text-purple-400">{(f.confidence * 100).toFixed(0)}%</span></div>))}</div>
            ) : <p className="text-[11px] text-slate-500">Play to generate</p>}
          </div>
          <div className="p-2 flex-1 min-h-0 overflow-auto">
            <h3 className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
              <Target className="w-3 h-3 text-cyan-400" />
              Sources
            </h3>
            {SOURCE_KEYS.map((s) => {
              const hasAny = state.trail.some(f => f.source === s);
              const enabled = sourceCfg[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSourceCfg(prev => ({ ...prev, [s]: !prev[s] }))}
                  className="w-full flex items-center justify-between text-[11px] py-0.5 hover:bg-slate-800/30 rounded px-1"
                  title={enabled ? 'Click to hide this source' : 'Click to show this source'}
                >
                  <span className={`capitalize ${enabled ? 'text-slate-200' : 'text-slate-500 line-through'}`}>{s.replace('_', ' ')}</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[9px] h-4 ${hasAny ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}
                    >
                      {hasAny ? 'Active' : 'Idle'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[9px] h-4 ${enabled ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'bg-slate-700/30 text-slate-500 border-slate-600/30'}`}
                    >
                      {enabled ? 'On' : 'Off'}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="p-2 border-t border-slate-700/50 bg-slate-900/80 flex-shrink-0">
        {processing && <div className="mb-2"><span className="text-xs text-slate-400">{progressMsg}</span><Progress value={50} className="h-1 mt-1" /></div>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1">
            <Button variant="ghost" size="icon" onClick={actions.stop} className="h-7 w-7 text-slate-400 hover:text-white"><SkipBack className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" onClick={stepBack} className="h-7 w-7 text-slate-400 hover:text-white"><ChevronLeft className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" onClick={isPlaying ? actions.pause : actions.play} className={`h-8 w-8 ${isPlaying ? 'text-cyan-400 bg-cyan-500/20' : 'text-white'}`}>
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={stepForward} className="h-7 w-7 text-slate-400 hover:text-white"><ChevronRight className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" onClick={() => actions.seekTo(totalFrames - 1)} className="h-7 w-7 text-slate-400 hover:text-white"><SkipForward className="w-3 h-3" /></Button>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Slider value={[currentIndex]} min={0} max={Math.max(0, totalFrames - 1)} step={1} onValueChange={([v]) => actions.seekTo(v)} className="cursor-pointer" />
            <div className="flex justify-between mt-0.5 text-[10px] text-slate-500">
              <span>{formatTime(timeline.start)}</span>
              <span className="text-cyan-400 font-medium">{formatTime(timeline.current)}</span>
              <span>{formatTime(timeline.end)}</span>
            </div>
          </div>
          <select onChange={e => actions.setPlaybackSpeed(Number(e.target.value))} defaultValue={1} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
            <option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={5}>5x</option><option value={10}>10x</option>
          </select>
          <Button variant="outline" size="sm" onClick={handleProcess} disabled={processing || totalFrames === 0} className="bg-slate-800/50 border-slate-700 h-7 text-xs">
            <RefreshCw className={`w-3 h-3 mr-1 ${processing ? 'animate-spin' : ''}`} />Process
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={totalFrames === 0} className="bg-slate-800/50 border-slate-700 h-7 text-xs">
            <Download className="w-3 h-3 mr-1" />Export
          </Button>
        </div>
      </div>

      {/* System Capabilities - Link Status Panel */}
      <div className="px-3 py-2 border-t border-slate-700/50 bg-slate-800/50 flex-shrink-0">
        <h3 className="text-xs font-semibold text-slate-400 mb-2">System Capabilities</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {/* Multimodal Fusion */}
          <div className={`p-2 rounded border ${linkStatus.geo.active ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700/50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Multimodal Fusion</span>
              <Badge variant="outline" className={`text-[10px] h-4 ${linkStatus.geo.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                {linkStatus.geo.active ? 'Active' : 'Idle'}
              </Badge>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Combine GPS, EXIF, Wi-Fi, Bluetooth</p>
          </div>

          {/* Monte Carlo Interpolation */}
          <div className={`p-2 rounded border ${linkStatus.fix.active ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700/50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Monte Carlo</span>
              <Badge variant="outline" className={`text-[10px] h-4 ${linkStatus.fix.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                {linkStatus.fix.active ? 'Active' : 'Idle'}
              </Badge>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Probabilistic path reconstruction</p>
          </div>

          {/* Futurecast Prediction */}
          <div className={`p-2 rounded border ${linkStatus.nav.active ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700/50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Futurecast</span>
              <Badge variant="outline" className={`text-[10px] h-4 ${linkStatus.nav.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                {linkStatus.nav.active ? 'Active' : 'Idle'}
              </Badge>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">6-hour trajectory forecasting</p>
          </div>

          {/* Satellite Link */}
          <div className={`p-2 rounded border ${linkStatus.sat.active ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700/50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Satellite Imagery</span>
              <Badge variant="outline" className={`text-[10px] h-4 ${linkStatus.sat.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                {linkStatus.sat.active ? 'Active' : 'Idle'}
              </Badge>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Sentinel, NASA, USGS layers</p>
          </div>

          {/* Signal Processing */}
          <div className={`p-2 rounded border ${linkStatus.signal.active ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700/50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Signal Fusion</span>
              <Badge variant="outline" className={`text-[10px] h-4 ${linkStatus.signal.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                {linkStatus.signal.active ? 'Active' : 'Idle'}
              </Badge>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Kalman filter signal processing</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeoconsoleRadarDashboard;
