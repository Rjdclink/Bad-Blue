/**
 * SPECTRA GeoConsole
 *
 * Operator shell over the canonical MapLibre renderer and server-side
 * geospatial fusion/prediction pipeline. Technical subsystems stay behind
 * the map while the operator receives one coherent timeline and map state.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Play, Pause, SkipBack, SkipForward, Clock, Activity, Layers,
  Download, Satellite, Radio, Crosshair, Zap, Target,
  ChevronLeft, ChevronRight, Maximize2, Minimize2,
} from 'lucide-react';
import { useGeoRuntime, type GeoFrame } from '@/hooks/useGeoRuntime';
import type { GPSPoint, LocationCandidate } from '@shared/geoconsoleTypes';
import MapLibreIntelligenceMap from './MapLibreIntelligenceMap';

// ============================================================================
// TYPES
// ============================================================================

interface GeoconsoleProps {
  initialData?: GPSPoint[];
  candidateLocations?: LocationCandidate[];
  onProcess?: (data: GPSPoint[]) => Promise<void>;
  /**
   * Optional nav mode provided by the parent "People Finder" GeoConsole tabs.
   * When set, the dashboard will respond by switching to the appropriate view defaults.
   */
  navMode?: 'timeline' | 'map' | 'satellite';
  spectraShell?: boolean;
}

interface LayerState {
  satellite: boolean;
  earthObservation: boolean;
  trail: boolean;
  heatmap: boolean;
  markers: boolean;
  futurecast: boolean;
  reticle: boolean;
  weather: boolean;
  terrain: boolean;
  buildings: boolean;
  uncertainty: boolean;
  streetImagery: boolean;
}

type MapMode = 'satellite' | 'hybrid' | 'street' | 'dark';

// ============================================================================
// CONSTANTS
// ============================================================================

const MPS_TO_MPH = 2.237;

const DEFAULT_SOURCE_VISIBILITY: Record<string, boolean> = {};
const EMPTY_GPS_POINTS: GPSPoint[] = [];

// ============================================================================
// HELPERS
// ============================================================================

const formatTime = (date: Date): string => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
const formatDuration = (s: number): string => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const formatDistance = (m: number): string => m >= 1609.34 ? `${(m / 1609.34).toFixed(2)} mi` : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const formatSpeed = (mps: number): string => `${(mps * MPS_TO_MPH).toFixed(1)} mph`;

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
// COMPONENT
// ============================================================================

export const GeoconsoleRadarDashboard: React.FC<GeoconsoleProps> = ({ initialData = EMPTY_GPS_POINTS, candidateLocations = [], onProcess: _onProcess, navMode, spectraShell = false }) => {
  // Runtime hook - source of truth for frames
  const [state, actions] = useGeoRuntime(initialData, { tickInterval: 500, playbackSpeed: 1, interpolationEnabled: true, predictiveEnabled: true });

  useEffect(() => {
    void actions.loadData(initialData);
  }, [actions.loadData, initialData]);

  // UI state (not affecting frame data)
  const [mapMode, setMapMode] = useState<MapMode>('satellite');
  const [layerCfg, setLayerCfg] = useState<LayerState>({ satellite: true, earthObservation: false, trail: true, heatmap: true, markers: true, futurecast: true, reticle: true, weather: false, terrain: true, buildings: true, uncertainty: true, streetImagery: false });
  const [lockOnTarget, setLockOnTarget] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    spectraShell ? false : (typeof window === 'undefined' ? true : window.innerWidth >= 768)
  );
  const [timelineOffsetMinutes, setTimelineOffsetMinutes] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelinePlaybackSpeed, setTimelinePlaybackSpeed] = useState(1);

  const applyMapPreset = useCallback((preset: 'satellite' | 'terrain' | 'weather' | 'evidence' | 'street') => {
    if (preset === 'satellite') {
      setMapMode('satellite');
      setLayerCfg(prev => ({ ...prev, satellite: true, earthObservation: false, terrain: false, buildings: false, weather: false, streetImagery: false }));
    } else if (preset === 'terrain') {
      setMapMode('hybrid');
      setLayerCfg(prev => ({ ...prev, satellite: true, earthObservation: false, terrain: true, buildings: true, weather: false, streetImagery: false }));
    } else if (preset === 'weather') {
      setMapMode('hybrid');
      setLayerCfg(prev => ({ ...prev, satellite: true, earthObservation: false, terrain: true, weather: true, streetImagery: false }));
    } else if (preset === 'evidence') {
      setMapMode('dark');
      setLayerCfg(prev => ({ ...prev, satellite: false, earthObservation: false, terrain: false, buildings: false, weather: false, heatmap: true, markers: true, uncertainty: true, futurecast: true, streetImagery: false }));
    } else {
      setMapMode('street');
      setLayerCfg(prev => ({ ...prev, satellite: false, earthObservation: false, terrain: false, weather: false, buildings: true, streetImagery: true }));
    }
  }, []);

  // Respond to external navigation ("nav links") from the embedding page.
  useEffect(() => {
    if (!navMode) return;
    if (navMode === 'satellite') setMapMode('satellite');
    if (navMode === 'map') setMapMode('street');
    // timeline mode focuses playback; we keep the operator-selected base layer.
  }, [navMode]);

  // Fullscreen mode only controls page scroll; MapLibre resizes itself.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (isFullscreen) document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  // Source filter ("signal links")
  const [sourceCfg, setSourceCfg] = useState<Record<string, boolean>>(DEFAULT_SOURCE_VISIBILITY);

  const sourceEnabled = useCallback((source: string) => sourceCfg[source] !== false, [sourceCfg]);

  const presentSources = useMemo(
    () => Array.from(new Set([...state.trail, ...state.futurecast].map(frame => frame.source))).sort(),
    [state.trail, state.futurecast]
  );

  // Derive the frames actually rendered. Filtering a source may remove an
  // intermediate observation, so the remaining points are explicitly separated
  // instead of being connected as if the hidden evidence never existed.
  const renderData = useMemo(() => {
    const trailWithIndex = state.trail.map((frame, index) => ({ frame, index }));
    const filtered = trailWithIndex.filter(({ frame }) => sourceEnabled(frame.source));
    const renderedTrail = filtered.map((entry, filteredIndex) => {
      if (filteredIndex === 0) return entry.frame;
      const previous = filtered[filteredIndex - 1];
      if (entry.index === previous.index + 1) return entry.frame;

      const gapSeconds = Math.max(
        1,
        (entry.frame.timestamp.getTime() - previous.frame.timestamp.getTime()) / 1000,
      );
      return {
        ...entry.frame,
        metadata: {
          ...(entry.frame.metadata || {}),
          gapBeforeSeconds: Math.max(
            gapSeconds,
            Number(entry.frame.metadata?.gapBeforeSeconds || 0),
          ),
          continuity: 'filtered_discontinuity',
        },
      };
    });

    const filteredFuturecast = state.futurecast.filter(frame => sourceEnabled(frame.source));
    const current = renderedTrail.length > 0 ? renderedTrail[renderedTrail.length - 1] : null;

    let totalDistance = 0;
    let supportedDuration = 0;
    let maxSpeed = 0;
    const speeds: number[] = [];

    for (let i = 1; i < renderedTrail.length; i++) {
      const prev = renderedTrail[i - 1];
      const curr = renderedTrail[i];
      const gapBreak = Number(curr.metadata?.gapBeforeSeconds || 0) > 0;
      if (!gapBreak) {
        totalDistance += haversineDistance(
          prev.position.latitude,
          prev.position.longitude,
          curr.position.latitude,
          curr.position.longitude,
        );
        const elapsed = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
        if (elapsed > 0) supportedDuration += elapsed;
      }
      if (curr.velocity?.speed !== undefined && !gapBreak) {
        speeds.push(curr.velocity.speed);
        maxSpeed = Math.max(maxSpeed, curr.velocity.speed);
      }
    }

    const averageSpeed = supportedDuration > 0
      ? totalDistance / supportedDuration
      : speeds.length > 0
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : 0;

    return {
      trail: renderedTrail,
      currentFrame: current,
      futurecast: filteredFuturecast,
      stats: {
        totalDistance,
        averageSpeed,
        maxSpeed,
        duration: supportedDuration,
      },
      trailIndices: filtered.map(entry => entry.index),
    };
  }, [state.trail, state.futurecast, sourceEnabled]);

  const timelineFrames = useMemo(
    () => [...renderData.trail, ...renderData.futurecast]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
    [renderData.trail, renderData.futurecast]
  );

  const observedAnchor = renderData.trail.length > 0
    ? renderData.trail[renderData.trail.length - 1]
    : null;
  const observedAnchorMs = observedAnchor?.timestamp.getTime() ?? Date.now();
  const anchorIsCurrent = !!observedAnchor && Math.abs(Date.now() - observedAnchorMs) <= 5 * 60_000;
  const timelineCenterLabel = anchorIsCurrent ? 'Now' : 'Latest';

  const timelineFrame = useMemo(() => {
    if (timelineFrames.length === 0) return null;

    const targetMs = observedAnchorMs + timelineOffsetMinutes * 60_000;
    const pool = timelineOffsetMinutes > 0
      ? timelineFrames.filter(frame =>
          frame.observationKind === 'predicted' || frame.source === 'predicted'
        )
      : timelineFrames.filter(frame =>
          frame.observationKind !== 'predicted' && frame.source !== 'predicted'
        );

    if (pool.length === 0) return null;

    let nearest = pool[0];
    let nearestDistance = Math.abs(nearest.timestamp.getTime() - targetMs);
    for (let i = 1; i < pool.length; i++) {
      const distance = Math.abs(pool[i].timestamp.getTime() - targetMs);
      if (distance < nearestDistance) {
        nearest = pool[i];
        nearestDistance = distance;
      }
    }

    // 5-minute Futurecast frames and reconstructed history should put evidence
    // close to the selected minute. Never snap across a large empty interval.
    return nearestDistance <= 5 * 60_000 ? nearest : null;
  }, [timelineFrames, observedAnchorMs, timelineOffsetMinutes]);

  const timelineIsPrediction = !!timelineFrame && (
    timelineFrame.observationKind === 'predicted' ||
    timelineFrame.source === 'predicted'
  );

  useEffect(() => {
    if (!timelinePlaying) return;
    const delay = Math.max(100, Math.round(1000 / Math.max(0.25, timelinePlaybackSpeed)));
    const timer = window.setInterval(() => {
      setTimelineOffsetMinutes(current => {
        if (current >= 60) {
          setTimelinePlaying(false);
          return 60;
        }
        return Math.min(60, current + 1);
      });
    }, delay);
    return () => window.clearInterval(timer);
  }, [timelinePlaying, timelinePlaybackSpeed]);



  // === EXPORT ===
  const handleExport = useCallback(() => {
    const frames = actions.exportTrail();
    const pointFeatures = frames.map(frame => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          frame.position.longitude,
          frame.position.latitude,
          ...(frame.position.altitude !== undefined ? [frame.position.altitude] : []),
        ],
      },
      properties: {
        timestamp: frame.timestamp.toISOString(),
        receivedAt: frame.receivedAt?.toISOString(),
        source: frame.source,
        confidence: frame.confidence,
        accuracy: frame.position.accuracy,
        verticalAccuracy: frame.position.verticalAccuracy,
        observationKind: frame.observationKind,
        correlationGroup: frame.correlationGroup,
        provenance: frame.provenance,
        metadata: frame.metadata,
      },
    }));

    const trailSegments: GeoFrame[][] = [];
    let exportSegment: GeoFrame[] = [];
    for (const frame of frames) {
      if (Number(frame.metadata?.gapBeforeSeconds || 0) > 0 && exportSegment.length > 0) {
        if (exportSegment.length > 1) trailSegments.push(exportSegment);
        exportSegment = [];
      }
      exportSegment.push(frame);
    }
    if (exportSegment.length > 1) trailSegments.push(exportSegment);

    const trailFeature = trailSegments.map(segment => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: segment.map(frame => [
          frame.position.longitude,
          frame.position.latitude,
          ...(frame.position.altitude !== undefined ? [frame.position.altitude] : []),
        ]),
      },
      properties: {
        kind: 'observed_trail',
        frames: segment.length,
        supportedContinuity: true,
      },
    }));

    const predictionFeatures = state.futurecast.map(frame => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [frame.position.longitude, frame.position.latitude],
      },
      properties: {
        kind: 'prediction',
        timestamp: frame.timestamp.toISOString(),
        confidence: frame.confidence,
        accuracy: frame.position.accuracy,
        source: frame.source,
        metadata: frame.metadata,
      },
    }));

    const geo = {
      type: 'FeatureCollection',
      features: [...trailFeature, ...pointFeatures, ...predictionFeatures],
    };
    const blob = new Blob([JSON.stringify(geo, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectra-${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }, [actions, state.futurecast]);

  const { isLive } = state;
  const stats = renderData.stats;

  const telemetryStatus = useMemo(() => {
    const current = renderData.currentFrame;
    const ageSeconds = current
      ? Math.max(0, Math.round((Date.now() - current.timestamp.getTime()) / 1000))
      : null;
    const accuracy = current?.position.accuracy;
    const independentGroups = new Set(
      renderData.trail.map(frame =>
        frame.correlationGroup ||
        `${frame.source}:${frame.provenance?.provider || 'unknown'}`
      )
    );
    const forecastConfidence = renderData.futurecast.length
      ? renderData.futurecast.reduce((sum, frame) => sum + frame.confidence, 0) / renderData.futurecast.length
      : null;

    const formatAge = (seconds: number | null) => {
      if (seconds === null) return '—';
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
      return `${Math.round(seconds / 3600)}h`;
    };
    const formatAccuracy = (meters: number | undefined) => {
      if (meters === undefined || !Number.isFinite(meters)) return '—';
      return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
    };

    return {
      obs: { active: renderData.trail.length > 0, value: String(renderData.trail.length), label: 'Timestamped observations' },
      age: { active: ageSeconds !== null, value: formatAge(ageSeconds), label: 'Age of latest observation' },
      acc: { active: accuracy !== undefined, value: formatAccuracy(accuracy), label: 'Reported horizontal accuracy' },
      src: {
        active: independentGroups.size > 0,
        value: String(independentGroups.size),
        label: 'Independent evidence groups represented',
      },
      nav: {
        active: forecastConfidence !== null,
        value: forecastConfidence !== null ? `${Math.round(forecastConfidence * 100)}%` : '—',
        label: 'Average Futurecast confidence',
      },
    };
  }, [renderData.currentFrame, renderData.trail, renderData.futurecast, state._version]);


  return (
    <div
      className={`${isFullscreen ? 'fixed inset-0 z-[5000]' : ''} flex flex-col h-full min-h-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden`}
    >
      {!spectraShell && <>
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
        
        <div className="hidden lg:flex items-center gap-1">
          {Object.entries(telemetryStatus).map(([key, item]) => (
            <div
              key={key}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono ${
                item.active
                  ? 'bg-green-500/15 text-green-300 border border-green-500/25'
                  : 'bg-slate-700/50 text-slate-500 border border-slate-600/30'
              }`}
              title={item.label}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-green-400' : 'bg-slate-500'}`} />
              <span className="uppercase">{key}</span>
              <span className="text-[10px] opacity-80">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs ${isLive ? 'bg-green-500/20 text-green-400 animate-pulse' : timelinePlaying ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-700/50 text-slate-400'}`}>
            <Activity className="w-3 h-3 mr-1" />{isLive ? 'LIVE' : timelinePlaying ? 'Playing' : 'Ready'}
          </Badge>
          <Badge variant="outline" className="text-xs bg-purple-500/20 text-purple-400">
            {timelineOffsetMinutes === 0
              ? timelineCenterLabel.toUpperCase()
              : timelineOffsetMinutes > 0
                ? `+${timelineOffsetMinutes}m`
                : `${timelineOffsetMinutes}m`}
          </Badge>
          <div className="hidden xl:flex bg-slate-800/50 rounded-lg p-1">
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
      </>}

      {/* Main - Full Viewport Stretch */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Map Container - Stretches to Fill Available Space */}
        <div className="flex-1 relative min-h-0 min-w-0">
          <MapLibreIntelligenceMap
            currentFrame={timelineFrame}
            trail={renderData.trail}
            futurecast={renderData.futurecast}
            candidateLocations={candidateLocations}
            mapMode={mapMode}
            layers={layerCfg}
            isLive={state.isLive}
            lockOnTarget={lockOnTarget}
            onUserInteraction={() => setLockOnTarget(false)}
          />
          {spectraShell && !lockOnTarget && (timelineFrame || candidateLocations.length > 0) && (
            <button
              type="button"
              onClick={() => setLockOnTarget(true)}
              className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-600/60 bg-slate-950/85 text-cyan-300 shadow-xl backdrop-blur hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              title="Recenter target"
              aria-label="Recenter target"
            >
              <Target className="h-4 w-4" />
            </button>
          )}
          {!spectraShell && <div className="absolute bottom-3 left-3 right-3 z-10 flex items-end justify-between gap-2 pointer-events-none">
            <div className="pointer-events-auto flex max-w-[calc(100%-3rem)] gap-1 overflow-x-auto rounded-xl border border-slate-600/50 bg-slate-900/90 p-1 shadow-xl backdrop-blur">
              {(['satellite', 'terrain', 'weather', 'evidence', 'street'] as const).map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyMapPreset(preset)}
                  className="min-h-10 shrink-0 rounded-lg px-3 text-xs font-medium text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(value => !value)}
              className="pointer-events-auto min-h-10 min-w-10 rounded-xl border border-slate-600/50 bg-slate-900/90 px-3 text-xs font-medium text-slate-200 shadow-xl backdrop-blur hover:bg-slate-800"
              aria-expanded={inspectorOpen}
            >
              {inspectorOpen ? 'Hide' : 'Info'}
            </button>
          </div>}
        </div>

        {/* Context inspector: docked on desktop, overlay on mobile. */}
        {!spectraShell && inspectorOpen && <div className="absolute md:relative inset-y-0 right-0 z-20 w-[min(88vw,20rem)] md:w-64 xl:w-72 border-l border-slate-700/50 flex flex-col bg-slate-950/95 md:bg-slate-900/70 min-h-0 overflow-y-auto flex-shrink-0 shadow-2xl md:shadow-none backdrop-blur">
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
                  className={`min-h-10 text-xs ${lockOnTarget ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}
                  title={lockOnTarget ? 'FIX lock: on (auto-recenter)' : 'FIX lock: off'}
                >
                  FIX
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={actions.toggleLive}
                  className={`min-h-10 text-xs ${isLive ? 'bg-green-500/20 text-green-400 border-green-500/40' : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}
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
                  <span className="text-[11px] text-slate-400 capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <Switch checked={v} onCheckedChange={c => setLayerCfg(p => ({ ...p, [k]: c }))} className="" />
                </div>
              ))}
            </div>
          </div>

          {/* Position */}
          {timelineFrame && (
            <div className="p-2 border-b border-slate-700/50">
              <h3 className="text-xs font-medium mb-1.5 flex items-center gap-1.5"><Crosshair className="w-3 h-3 text-cyan-400" />Position</h3>
              <div className="space-y-0.5 text-[11px] font-mono bg-slate-800/30 rounded-lg p-1.5 border border-slate-700/40">
                <p><span className="text-slate-500">LAT:</span> <span className="text-cyan-400">{timelineFrame.position.latitude.toFixed(6)}</span></p>
                <p><span className="text-slate-500">LNG:</span> <span className="text-cyan-400">{timelineFrame.position.longitude.toFixed(6)}</span></p>
                <p>
                  <span className="text-slate-500">SPD:</span>{' '}
                  <span className="text-green-400">
                    {timelineFrame.velocity?.speed !== undefined
                      ? formatSpeed(timelineFrame.velocity.speed)
                      : '—'}
                  </span>
                </p>
                <p>
                  <span className="text-slate-500">HDG:</span>{' '}
                  <span className="text-purple-400">
                    {timelineFrame.velocity?.heading !== undefined
                      ? `${timelineFrame.velocity.heading.toFixed(1)}°`
                      : '—'}
                  </span>
                </p>
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
            ) : <p className="text-[11px] text-slate-500">Needs three continuous observations</p>}
          </div>
          <div className="p-2 flex-1 min-h-0 overflow-auto">
            <h3 className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
              <Target className="w-3 h-3 text-cyan-400" />
              Sources
            </h3>
            {presentSources.length === 0 && <p className="text-[11px] text-slate-500">No timestamped sources yet.</p>}
            {presentSources.map((s) => {
              const hasAny = state.trail.some(f => f.source === s) || state.futurecast.some(f => f.source === s);
              const enabled = sourceEnabled(s);
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
        </div>}
      </div>

      {/* Rolling previous-hour / one-hour Futurecast timeline */}
      {(!spectraShell || timelineFrames.length > 0) && <div className="p-2 border-t border-slate-700/50 bg-slate-900/80 flex-shrink-0">

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1">
            <Button variant="ghost" size="icon" onClick={() => setTimelineOffsetMinutes(-60)} className="h-10 w-10 text-slate-400 hover:text-white"><SkipBack className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setTimelineOffsetMinutes(value => Math.max(-60, value - 5))} className="h-10 w-10 text-slate-400 hover:text-white"><ChevronLeft className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setTimelinePlaying(v => !v)} className={`h-10 w-10 ${timelinePlaying ? 'text-cyan-400 bg-cyan-500/20' : 'text-white'}`}>
              {timelinePlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setTimelineOffsetMinutes(value => Math.min(60, value + 5))} className="h-10 w-10 text-slate-400 hover:text-white"><ChevronRight className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" onClick={() => setTimelineOffsetMinutes(60)} className="h-10 w-10 text-slate-400 hover:text-white"><SkipForward className="w-3 h-3" /></Button>
          </div>

          <div className="flex-1 min-w-[200px]">
            <Slider
              value={[timelineOffsetMinutes]}
              min={-60}
              max={60}
              step={1}
              onValueChange={([value]) => {
                setTimelineOffsetMinutes(value);
                setTimelinePlaying(false);
              }}
              className="cursor-pointer"
            />
            <div className="flex justify-between mt-0.5 text-[10px] text-slate-500">
              <span>-1 hour</span>
              <span className={timelineIsPrediction ? 'text-purple-300 font-medium' : 'text-cyan-400 font-medium'}>
                {timelineFrame
                  ? `${formatTime(timelineFrame.timestamp)} · ${timelineIsPrediction ? 'Futurecast' : 'Observed'}`
                  : timelineOffsetMinutes > 0
                    ? 'No Futurecast'
                    : 'No observation'}
              </span>
              <span>+1 hour</span>
            </div>
          </div>

          {!spectraShell && <select
            onChange={e => setTimelinePlaybackSpeed(Number(e.target.value))}
            value={timelinePlaybackSpeed}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-2 text-xs min-h-10"
            aria-label="Timeline playback speed"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
          </select>}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimelineOffsetMinutes(0)}
            disabled={timelineFrames.length === 0}
            className="bg-slate-800/50 border-slate-700 min-h-10 text-xs"
          >
            {timelineCenterLabel}
          </Button>
          {!spectraShell && <Button variant="outline" size="sm" onClick={handleExport} disabled={timelineFrames.length === 0} className="bg-slate-800/50 border-slate-700 min-h-10 text-xs">
            <Download className="w-3 h-3 mr-1" />Export
          </Button>}
        </div>
      </div>}

      {!spectraShell && <div className="hidden lg:block px-3 py-2 border-t border-slate-700/50 bg-slate-800/50 flex-shrink-0">
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'GPU Map', active: true, detail: 'MapLibre WebGL renderer' },
            { label: '3D Terrain', active: layerCfg.terrain, detail: 'DEM terrain + hillshade' },
            { label: 'Weather Context', active: true, detail: 'Radar data available to SPECTRA in background' },
            { label: 'Futurecast', active: state.futurecast.length > 0, detail: 'Server-authoritative prediction' },
            { label: 'Confidence', active: !!timelineFrame?.position.accuracy, detail: 'Confidence derived from source quality and agreement' },
          ].map(item => (
            <div key={item.label} className={`p-2 rounded border ${item.active ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800/50 border-slate-700/50'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300">{item.label}</span>
                <Badge variant="outline" className={`text-[10px] h-4 ${item.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                  {item.active ? 'On' : 'Off'}
                </Badge>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
};

export default GeoconsoleRadarDashboard;
