/**
 * SPECTRA GeoConsole Radar Dashboard
 * 
 * Production-grade satellite tracking with TIGHT map lifecycle:
 * - Map created ONCE on mount, stored in ref
 * - Updates bound to DATA MUTATIONS (frame index, version), not UI flags
 * - No memoization that could freeze updates
 * - Direct imperative map updates on every frame change
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useGeoRuntime, type GeoFrame } from '@/hooks/useGeoRuntime';
import type { GPSPoint } from '@shared/geoconsoleTypes';

// ============================================================================
// TYPES
// ============================================================================

interface GeoconsoleProps {
  initialData?: GPSPoint[];
  onProcess?: (data: GPSPoint[]) => Promise<void>;
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

// ============================================================================
// HELPERS
// ============================================================================

const formatTime = (date: Date): string => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
const formatDuration = (s: number): string => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const formatDistance = (m: number): string => m >= 1609.34 ? `${(m / 1609.34).toFixed(2)} mi` : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const formatSpeed = (mps: number): string => `${(mps * MPS_TO_MPH).toFixed(1)} mph`;
const getSpeedColor = (speed: number): string => speed < 0.5 ? SPEED_COLORS.stationary : speed < 2 ? SPEED_COLORS.walking : speed < 5 ? SPEED_COLORS.running : speed < 10 ? SPEED_COLORS.cycling : SPEED_COLORS.driving;

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
  isLive: boolean
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
    
    // Pan to current
    map.panTo([currentFrame.position.latitude, currentFrame.position.longitude], { animate: true, duration: 0.2 });
  }

  // Force redraw
  map.invalidateSize();
}

// ============================================================================
// COMPONENT
// ============================================================================

export const GeoconsoleRadarDashboard: React.FC<GeoconsoleProps> = ({ initialData = [], onProcess }) => {
  // Runtime hook - source of truth for frames
  const [state, actions] = useGeoRuntime(initialData, { tickInterval: 500, playbackSpeed: 1, interpolationEnabled: true, predictiveEnabled: true });

  // UI state (not affecting frame data)
  const [mapMode, setMapMode] = useState<MapMode>('satellite');
  const [layerCfg, setLayerCfg] = useState<LayerState>({ satellite: true, trail: true, heatmap: true, markers: true, futurecast: true, reticle: true });
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

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
  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    const map = L.map(containerRef.current, { center: [40.7128, -74.0060], zoom: 14, zoomControl: false, attributionControl: false });
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
    const cfg = mapMode === 'hybrid' ? TILE_LAYERS.satellite : TILE_LAYERS[mapMode];
    tileRef.current.setUrl(cfg.url);
    
    if (labelsRef.current) {
      if (mapMode === 'satellite' || mapMode === 'hybrid') {
        if (!mapRef.current.hasLayer(labelsRef.current)) labelsRef.current.addTo(mapRef.current);
      } else {
        if (mapRef.current.hasLayer(labelsRef.current)) mapRef.current.removeLayer(labelsRef.current);
      }
    }
    mapRef.current.invalidateSize();
  }, [mapMode]);

  // === FRAME UPDATE - BOUND TO DATA, NOT FLAGS ===
  // Dependencies: currentIndex, _version (mutation counter), trail length, layerCfg
  // This ensures updates fire on actual data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Direct render - no memoization, no debounce
    renderFrame(map, layerRefs.current, state.currentFrame, state.trail, state.futurecast, layerCfg, state.isLive);

  }, [state.currentIndex, state._version, state.trail.length, state.futurecast.length, layerCfg, state.isLive, state.currentFrame]);

  // === RESIZE/VISIBILITY ===
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onResize = () => map.invalidateSize();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (visibleInvalidateTimeoutRef.current) {
        window.clearTimeout(visibleInvalidateTimeoutRef.current);
        visibleInvalidateTimeoutRef.current = null;
      }
      visibleInvalidateTimeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        if (mapRef.current === map) map.invalidateSize();
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
  const { currentFrame, isPlaying, isLive, stats, timeline, totalFrames, currentIndex } = state;

  return (
    <div className="flex flex-col min-h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white" style={{ minHeight: '100%', overflow: 'visible' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900/80">
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
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1" style={{ minHeight: '400px' }}>
        {/* Map */}
        <div className="flex-1 relative" style={{ minHeight: '400px' }}>
          <div ref={containerRef} className="absolute inset-0" style={{ background: '#1a1a2e', minHeight: '400px' }} />
          
          {/* Layer Controls */}
          <div className="absolute top-4 right-4 bg-slate-900/90 rounded-lg p-3 border border-slate-700/50 z-[1000]">
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/50"><Layers className="w-4 h-4 text-cyan-400" /><span className="text-sm font-medium">Layers</span></div>
            {Object.entries(layerCfg).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1">
                <span className="text-xs text-slate-400 capitalize">{k}</span>
                <Switch checked={v} onCheckedChange={c => setLayerCfg(p => ({ ...p, [k]: c }))} className="scale-75" />
              </div>
            ))}
          </div>

          {/* Position */}
          {currentFrame && (
            <div className="absolute bottom-4 left-4 bg-slate-900/90 rounded-lg p-3 border border-slate-700/50 z-[1000] min-w-[180px]">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/50"><Crosshair className="w-4 h-4 text-cyan-400" /><span className="text-sm font-medium">Position</span></div>
              <div className="space-y-1 text-xs font-mono">
                <p><span className="text-slate-500">LAT:</span> <span className="text-cyan-400">{currentFrame.position.latitude.toFixed(6)}</span></p>
                <p><span className="text-slate-500">LNG:</span> <span className="text-cyan-400">{currentFrame.position.longitude.toFixed(6)}</span></p>
                <p><span className="text-slate-500">SPD:</span> <span className="text-green-400">{formatSpeed(currentFrame.velocity?.speed || 0)}</span></p>
                <p><span className="text-slate-500">HDG:</span> <span className="text-purple-400">{(currentFrame.velocity?.heading || 0).toFixed(1)}°</span></p>
              </div>
            </div>
          )}

          {/* LIVE */}
          <button onClick={actions.toggleLive} className={`absolute top-4 left-4 px-4 py-2 rounded-lg font-bold text-sm z-[1000] ${isLive ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-slate-800/90 text-slate-400 border border-slate-700/50'}`}>
            <Radio className="w-4 h-4 inline mr-2" />{isLive ? 'LIVE' : 'GO LIVE'}
          </button>
        </div>

        {/* Stats Panel - Full visibility with scroll */}
        <div className="w-64 border-l border-slate-700/50 flex flex-col bg-slate-900/50" style={{ maxHeight: '100%', overflow: 'auto' }}>
          <div className="p-3 border-b border-slate-700/50">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" />Stats</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-800/50 rounded p-2"><p className="text-xs text-slate-500">Distance</p><p className="font-bold text-cyan-400">{formatDistance(stats.totalDistance)}</p></div>
              <div className="bg-slate-800/50 rounded p-2"><p className="text-xs text-slate-500">Avg Spd</p><p className="font-bold text-green-400">{formatSpeed(stats.averageSpeed)}</p></div>
              <div className="bg-slate-800/50 rounded p-2"><p className="text-xs text-slate-500">Max Spd</p><p className="font-bold text-orange-400">{formatSpeed(stats.maxSpeed)}</p></div>
              <div className="bg-slate-800/50 rounded p-2"><p className="text-xs text-slate-500">Duration</p><p className="font-bold text-purple-400">{formatDuration(stats.duration)}</p></div>
            </div>
          </div>
          <div className="p-3 border-b border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium flex items-center gap-2"><Zap className="w-4 h-4 text-purple-400" />Futurecast</h3>
              <Badge variant="outline" className={state.futurecast.length > 0 ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-700/50 text-slate-500'}>{state.futurecast.length > 0 ? 'Active' : 'Idle'}</Badge>
            </div>
            {state.futurecast.length > 0 ? (
              <div className="space-y-1">{state.futurecast.slice(0, 4).map((f, i) => (<div key={i} className="flex items-center text-xs bg-slate-800/30 rounded p-1"><Clock className="w-3 h-3 text-slate-500 mr-1" /><span className="text-slate-400 flex-1">{formatTime(f.timestamp)}</span><span className="text-purple-400">{(f.confidence * 100).toFixed(0)}%</span></div>))}</div>
            ) : <p className="text-xs text-slate-500">Play to generate</p>}
          </div>
          <div className="p-3 flex-1 overflow-auto">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Target className="w-4 h-4 text-cyan-400" />Sources</h3>
            {['device_gps', 'wifi_handoff', 'public_record', 'interpolated'].map(s => {
              const active = state.trail.some(f => f.source === s);
              return (<div key={s} className="flex items-center justify-between text-xs py-1"><span className="text-slate-400 capitalize">{s.replace('_', ' ')}</span><Badge variant="outline" className={active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}>{active ? 'Active' : 'Idle'}</Badge></div>);
            })}
          </div>
        </div>
      </div>

      {/* Timeline - Sticky footer with full visibility */}
      <div className="p-3 border-t border-slate-700/50 bg-slate-900/95 backdrop-blur-sm" style={{ position: 'sticky', bottom: 0, zIndex: 100, flexShrink: 0 }}>
        {processing && <div className="mb-2"><span className="text-xs text-slate-400">{progressMsg}</span><Progress value={50} className="h-1 mt-1" /></div>}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1">
            <Button variant="ghost" size="icon" onClick={actions.stop} className="h-8 w-8 text-slate-400 hover:text-white"><SkipBack className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" onClick={stepBack} className="h-8 w-8 text-slate-400 hover:text-white"><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" onClick={isPlaying ? actions.pause : actions.play} className={`h-10 w-10 ${isPlaying ? 'text-cyan-400 bg-cyan-500/20' : 'text-white'}`}>
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={stepForward} className="h-8 w-8 text-slate-400 hover:text-white"><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => actions.seekTo(totalFrames - 1)} className="h-8 w-8 text-slate-400 hover:text-white"><SkipForward className="w-4 h-4" /></Button>
          </div>
          <div className="flex-1">
            <Slider value={[currentIndex]} min={0} max={Math.max(0, totalFrames - 1)} step={1} onValueChange={([v]) => actions.seekTo(v)} className="cursor-pointer" />
            <div className="flex justify-between mt-1 text-xs text-slate-500">
              <span>{formatTime(timeline.start)}</span>
              <span className="text-cyan-400 font-medium">{formatTime(timeline.current)}</span>
              <span>{formatTime(timeline.end)}</span>
            </div>
          </div>
          <select onChange={e => actions.setPlaybackSpeed(Number(e.target.value))} defaultValue={1} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
            <option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={5}>5x</option><option value={10}>10x</option>
          </select>
          <Button variant="outline" size="sm" onClick={handleProcess} disabled={processing || totalFrames === 0} className="bg-slate-800/50 border-slate-700">
            <RefreshCw className={`w-4 h-4 mr-1 ${processing ? 'animate-spin' : ''}`} />Process
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={totalFrames === 0} className="bg-slate-800/50 border-slate-700">
            <Download className="w-4 h-4 mr-1" />Export
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GeoconsoleRadarDashboard;
