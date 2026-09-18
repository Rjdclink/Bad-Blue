/**
 * SPECTRA MapLibre Intelligence Map
 *
 * Canonical GPU map renderer for People Finder / GeoConsole.
 * Uses only no-key defaults:
 * - OpenFreeMap vector basemap
 * - public AWS Terrarium elevation tiles
 * - IEM/NEXRAD current CONUS radar mosaic
 * - KartaView public street-level imagery API
 *
 * Provider URLs are configurable so self-hosted Martin/PMTiles services can
 * replace any public source without changing the rendering contract.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoFrame } from '@/hooks/useGeoRuntime';
import type { LocationCandidate } from '@shared/geoconsoleTypes';

export type IntelligenceMapMode = 'satellite' | 'hybrid' | 'street' | 'dark';

export interface IntelligenceLayerState {
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

interface Props {
  currentFrame: GeoFrame | null;
  trail: GeoFrame[];
  futurecast: GeoFrame[];
  candidateLocations?: LocationCandidate[];
  displayTime?: Date;
  mapMode: IntelligenceMapMode;
  layers: IntelligenceLayerState;
  isLive: boolean;
  lockOnTarget: boolean;
  onUserInteraction?: () => void;
}

interface KartaViewPhoto {
  id?: string | number;
  lat?: string | number;
  lng?: string | number;
  fileurl?: string;
  fileurlProc?: string;
  fileurlTh?: string;
  heading?: string | number;
  shotDate?: string;
}

const OPENFREEMAP_LIBERTY =
  (import.meta.env?.VITE_MAP_STYLE_URL as string | undefined) ||
  'https://tiles.openfreemap.org/styles/liberty';
const OPENFREEMAP_DARK =
  (import.meta.env?.VITE_MAP_DARK_STYLE_URL as string | undefined) ||
  'https://tiles.openfreemap.org/styles/dark';

const SATELLITE_TILES =
  (import.meta.env?.VITE_SATELLITE_TILES_URL as string | undefined) ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const TERRAIN_TILES =
  (import.meta.env?.VITE_TERRAIN_TILES_URL as string | undefined) ||
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const NASA_GIBS_TEMPLATE =
  (import.meta.env?.VITE_NASA_GIBS_TILES_URL as string | undefined) ||
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';

const WEATHER_RADAR_TEMPLATE =
  (import.meta.env?.VITE_WEATHER_RADAR_TILES_URL as string | undefined) ||
  'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/{layer}/{z}/{x}/{y}.png';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const utcDateKey = (date: Date) => date.toISOString().slice(0, 10);
const nasaGibsTilesFor = (date: Date) => {
  // Earth-observation imagery is historical/current, never a forecast image.
  const bounded = date.getTime() > Date.now() ? new Date() : date;
  return NASA_GIBS_TEMPLATE.replace('{date}', utcDateKey(bounded));
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const weatherRadarTilesFor = (date: Date) => {
  // IEM serves the latest CONUS mosaic with the -0 suffix and archived mosaics
  // at exact five-minute UTC intervals. Future timeline positions therefore
  // clamp to the latest observed radar rather than inventing forecast radar.
  if (!WEATHER_RADAR_TEMPLATE.includes('{layer}')) return WEATHER_RADAR_TEMPLATE;

  const now = Date.now();
  const boundedMs = Math.min(date.getTime(), now);
  if (now - boundedMs < 7 * 60_000) {
    return WEATHER_RADAR_TEMPLATE.replace('{layer}', 'ridge::USCOMP-N0Q-0');
  }

  const rounded = new Date(boundedMs);
  rounded.setUTCSeconds(0, 0);
  rounded.setUTCMinutes(Math.floor(rounded.getUTCMinutes() / 5) * 5);
  const stamp =
    `${rounded.getUTCFullYear()}` +
    `${pad2(rounded.getUTCMonth() + 1)}` +
    `${pad2(rounded.getUTCDate())}` +
    `${pad2(rounded.getUTCHours())}` +
    `${pad2(rounded.getUTCMinutes())}`;

  return WEATHER_RADAR_TEMPLATE.replace(
    '{layer}',
    `ridge::USCOMP-N0Q-${stamp}`,
  );
};

const pointFeature = (frame: GeoFrame) => ({
  type: 'Feature' as const,
  geometry: {
    type: 'Point' as const,
    coordinates: [frame.position.longitude, frame.position.latitude],
  },
  properties: {
    id: frame.id,
    confidence: clamp(frame.confidence ?? 0, 0, 1),
    source: frame.source,
    observationKind: frame.observationKind || (frame.source === 'predicted' ? 'predicted' : 'observed'),
    timestamp: frame.timestamp.toISOString(),
    speed: frame.velocity?.speed,
    heading: frame.velocity?.heading,
    accuracy: frame.position.accuracy,
    provider: frame.provenance?.provider || '',
    correlationGroup: frame.correlationGroup || '',
  },
});

const lineFeature = (frames: GeoFrame[], splitOnGaps = false) => {
  const segments: number[][][] = [];
  let segment: number[][] = [];

  for (const frame of frames) {
    const gapBefore = Number(frame.metadata?.gapBeforeSeconds || 0);
    if (splitOnGaps && gapBefore > 0 && segment.length > 0) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    }
    segment.push([frame.position.longitude, frame.position.latitude]);
  }
  if (segment.length > 1) segments.push(segment);

  if (splitOnGaps) {
    if (segments.length === 0) return null;
    if (segments.length > 1) {
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiLineString' as const,
          coordinates: segments,
        },
        properties: {},
      };
    }

    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: segments[0],
      },
      properties: {},
    };
  }

  return {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: frames.map(frame => [frame.position.longitude, frame.position.latitude]),
    },
    properties: {},
  };
};

function circleFeature(lng: number, lat: number, radiusMeters: number, steps = 64) {
  const coordinates: [number, number][] = [];
  const earthRadius = 6_378_137;
  const angularDistance = radiusMeters / earthRadius;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;

  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const pointLng = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat)
    );
    const pointLngDegrees = pointLng * 180 / Math.PI;
    const normalizedLng = ((pointLngDegrees + 540) % 360) - 180;
    coordinates.push([normalizedLng, pointLat * 180 / Math.PI]);
  }

  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [coordinates] },
    properties: { radiusMeters },
  };
}

function candidateZoomForAccuracy(accuracyMeters?: number): number {
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(accuracy) || accuracy <= 0) return 8;
  if (accuracy >= 200_000) return 4.5;
  if (accuracy >= 100_000) return 5.5;
  if (accuracy >= 50_000) return 6.5;
  if (accuracy >= 20_000) return 7.5;
  if (accuracy >= 5_000) return 9;
  if (accuracy >= 1_000) return 11;
  return 13;
}

function observationZoomForAccuracy(accuracyMeters?: number): number {
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(accuracy) || accuracy <= 0) return 13;
  if (accuracy >= 100_000) return 5.5;
  if (accuracy >= 50_000) return 6.5;
  if (accuracy >= 20_000) return 7.5;
  if (accuracy >= 5_000) return 9;
  if (accuracy >= 1_000) return 11;
  if (accuracy >= 250) return 13;
  if (accuracy >= 50) return 14.5;
  return 16;
}

function popupTextNode(lines: Array<{ label?: string; value: string }>): HTMLDivElement {
  const root = document.createElement('div');
  root.style.font = '12px system-ui';
  root.style.minWidth = '170px';

  lines.forEach((line, index) => {
    if (index > 0) root.appendChild(document.createElement('br'));
    if (line.label) {
      const strong = document.createElement('strong');
      strong.textContent = line.label;
      root.appendChild(strong);
      root.appendChild(document.createTextNode(' '));
    }
    root.appendChild(document.createTextNode(line.value));
  });

  return root;
}

function safeSetData(map: MapLibreMap, sourceId: string, data: any) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) source.setData(data);
}

function firstVectorSourceId(map: MapLibreMap): string | null {
  const style = map.getStyle();
  const entries = Object.entries(style.sources || {});
  const vector = entries.find(([, source]) => (source as any)?.type === 'vector');
  return vector?.[0] || null;
}

function addRuntimeLayers(map: MapLibreMap) {
  if (!map.getSource('spectra-trail')) {
    map.addSource('spectra-trail', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('spectra-trail-line')) {
    map.addLayer({
      id: 'spectra-trail-line',
      type: 'line',
      source: 'spectra-trail',
      paint: {
        'line-color': '#22d3ee',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 16, 5],
        'line-opacity': 0.82,
      },
    });
  }

  if (!map.getSource('spectra-observations')) {
    map.addSource('spectra-observations', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('spectra-observation-heat')) {
    map.addLayer({
      id: 'spectra-observation-heat',
      type: 'heatmap',
      source: 'spectra-observations',
      maxzoom: 17,
      paint: {
        'heatmap-weight': ['coalesce', ['get', 'confidence'], 0.5],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 15, 1.8],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 10, 15, 32],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 18, 0.18],
      },
    });
  }
  if (!map.getLayer('spectra-observation-points')) {
    map.addLayer({
      id: 'spectra-observation-points',
      type: 'circle',
      source: 'spectra-observations',
      minzoom: 8,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 18, 7],
        'circle-color': [
          'match',
          ['get', 'observationKind'],
          'historical', '#60a5fa',
          'inferred', '#f59e0b',
          'interpolated', '#94a3b8',
          'predicted', '#c084fc',
          '#22d3ee',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'observationKind'], 'interpolated'],
          0.5,
          1,
        ],
        'circle-opacity': [
          'case',
          ['==', ['get', 'observationKind'], 'interpolated'],
          0.55,
          0.85,
        ],
      },
    });
  }

  if (!map.getSource('spectra-futurecast')) {
    map.addSource('spectra-futurecast', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('spectra-futurecast-line')) {
    map.addLayer({
      id: 'spectra-futurecast-line',
      type: 'line',
      source: 'spectra-futurecast',
      paint: {
        'line-color': '#c084fc',
        'line-width': 3,
        'line-dasharray': [2, 2],
        'line-opacity': 0.8,
      },
    });
  }
  if (!map.getLayer('spectra-futurecast-points')) {
    map.addLayer({
      id: 'spectra-futurecast-points',
      type: 'circle',
      source: 'spectra-futurecast',
      paint: {
        'circle-radius': 5,
        'circle-color': '#c084fc',
        'circle-opacity': ['coalesce', ['get', 'confidence'], 0.5],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#f5f3ff',
      },
    });
  }

  if (!map.getSource('spectra-candidates')) {
    map.addSource('spectra-candidates', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('spectra-candidate-area')) {
    map.addLayer({
      id: 'spectra-candidate-area',
      type: 'fill',
      source: 'spectra-candidates',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': '#fbbf24',
        'fill-opacity': 0.09,
      },
    });
  }
  if (!map.getLayer('spectra-candidate-area-outline')) {
    map.addLayer({
      id: 'spectra-candidate-area-outline',
      type: 'line',
      source: 'spectra-candidates',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'line-color': '#fbbf24',
        'line-width': 1.5,
        'line-opacity': 0.65,
        'line-dasharray': [2, 2],
      },
    });
  }

  if (!map.getLayer('spectra-candidate-points')) {
    map.addLayer({
      id: 'spectra-candidate-points',
      type: 'circle',
      source: 'spectra-candidates',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 16, 11],
        'circle-color': 'rgba(251,191,36,0.18)',
        'circle-stroke-color': '#fbbf24',
        'circle-stroke-width': 2,
        'circle-opacity': 0.9,
      },
    });
  }

  if (!map.getSource('spectra-current')) {
    map.addSource('spectra-current', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('spectra-current-ring')) {
    map.addLayer({
      id: 'spectra-current-ring',
      type: 'circle',
      source: 'spectra-current',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 18, 15],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3,
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'observationKind'], 'predicted'],
          '#c084fc',
          '#34d399',
        ],
        'circle-opacity': 0.95,
      },
    });
  }

  if (!map.getSource('spectra-uncertainty')) {
    map.addSource('spectra-uncertainty', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('spectra-uncertainty-fill')) {
    map.addLayer({
      id: 'spectra-uncertainty-fill',
      type: 'fill',
      source: 'spectra-uncertainty',
      paint: {
        'fill-color': '#22d3ee',
        'fill-opacity': 0.12,
      },
    });
  }
  if (!map.getLayer('spectra-uncertainty-outline')) {
    map.addLayer({
      id: 'spectra-uncertainty-outline',
      type: 'line',
      source: 'spectra-uncertainty',
      paint: {
        'line-color': '#67e8f9',
        'line-width': 2,
        'line-opacity': 0.65,
      },
    });
  }

  if (!map.getSource('spectra-satellite')) {
    map.addSource('spectra-satellite', {
      type: 'raster',
      tiles: [SATELLITE_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Satellite imagery © source contributors',
    });
  }
  if (!map.getLayer('spectra-satellite')) {
    map.addLayer({
      id: 'spectra-satellite',
      type: 'raster',
      source: 'spectra-satellite',
      paint: { 'raster-opacity': 1 },
    }, map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id);
  }

  if (!map.getSource('spectra-earth-observation')) {
    map.addSource('spectra-earth-observation', {
      type: 'raster',
      tiles: [nasaGibsTilesFor(new Date())],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 9,
      attribution: 'NASA GIBS / MODIS Terra',
    });
  }
  if (!map.getLayer('spectra-earth-observation')) {
    map.addLayer({
      id: 'spectra-earth-observation',
      type: 'raster',
      source: 'spectra-earth-observation',
      paint: {
        'raster-opacity': 0.72,
        'raster-fade-duration': 150,
      },
    }, map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id);
  }

  if (!map.getSource('spectra-terrain-dem')) {
    map.addSource('spectra-terrain-dem', {
      type: 'raster-dem',
      tiles: [TERRAIN_TILES],
      tileSize: 256,
      maxzoom: 15,
      encoding: 'terrarium',
      attribution: 'Terrain: public elevation tiles',
    } as any);
  }
  if (!map.getLayer('spectra-hillshade')) {
    map.addLayer({
      id: 'spectra-hillshade',
      type: 'hillshade',
      source: 'spectra-terrain-dem',
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': '#020617',
      },
    });
  }

  if (!map.getSource('spectra-weather-radar')) {
    map.addSource('spectra-weather-radar', {
      type: 'raster',
      tiles: [weatherRadarTilesFor(new Date())],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 12,
      attribution: 'NEXRAD mosaic via Iowa Environmental Mesonet',
    });
  }
  if (!map.getLayer('spectra-weather-radar')) {
    map.addLayer({
      id: 'spectra-weather-radar',
      type: 'raster',
      source: 'spectra-weather-radar',
      paint: {
        'raster-opacity': 0.68,
        'raster-fade-duration': 150,
      },
    });
  }

  const vectorSource = firstVectorSourceId(map);
  if (vectorSource && !map.getLayer('spectra-buildings-3d')) {
    try {
      map.addLayer({
        id: 'spectra-buildings-3d',
        type: 'fill-extrusion',
        source: vectorSource,
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['to-number', ['get', 'render_height']], ['to-number', ['get', 'height']], 8],
            0, '#64748b',
            25, '#94a3b8',
            100, '#cbd5e1',
          ],
          'fill-extrusion-height': [
            'coalesce',
            ['to-number', ['get', 'render_height']],
            ['to-number', ['get', 'height']],
            ['*', ['coalesce', ['to-number', ['get', 'levels']], 2], 3],
            8,
          ],
          'fill-extrusion-base': [
            'coalesce',
            ['to-number', ['get', 'render_min_height']],
            ['to-number', ['get', 'min_height']],
            0,
          ],
          'fill-extrusion-opacity': 0.72,
        },
      } as any);
    } catch {
      // The active style may not expose OpenMapTiles' building source-layer.
    }
  }
}

function setVisibility(map: MapLibreMap, id: string, visible: boolean) {
  if (map.getLayer(id)) {
    map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

export const MapLibreIntelligenceMap: React.FC<Props> = ({
  currentFrame,
  trail,
  futurecast,
  candidateLocations = [],
  displayTime,
  mapMode,
  layers,
  isLive,
  lockOnTarget,
  onUserInteraction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [streetPhoto, setStreetPhoto] = useState<KartaViewPhoto | null>(null);
  const [streetLoading, setStreetLoading] = useState(false);
  const [rendererRecovering, setRendererRecovering] = useState(false);
  const lastFollowRef = useRef<[number, number] | null>(null);
  const userInteractionUntilRef = useRef(0);
  const activeStyleRef = useRef(mapMode === 'dark' ? OPENFREEMAP_DARK : OPENFREEMAP_LIBERTY);
  const displayTimeMs = displayTime?.getTime() ?? null;

  const initialCenter = useMemo<[number, number]>(() => {
    if (currentFrame) return [currentFrame.position.longitude, currentFrame.position.latitude];
    if (trail.length) {
      const p = trail[trail.length - 1];
      return [p.position.longitude, p.position.latitude];
    }
    if (candidateLocations.length) {
      return [candidateLocations[0].longitude, candidateLocations[0].latitude];
    }
    return [0, 20];
  }, []);

  const initializeRuntimeLayers = useCallback((map: MapLibreMap) => {
    addRuntimeLayers(map);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapMode === 'dark' ? OPENFREEMAP_DARK : OPENFREEMAP_LIBERTY,
      center: initialCenter,
      zoom: currentFrame
        ? observationZoomForAccuracy(currentFrame.position.accuracy)
        : trail.length
          ? observationZoomForAccuracy(trail[trail.length - 1].position.accuracy)
          : candidateLocations.length
            ? candidateZoomForAccuracy(candidateLocations[0].accuracyMeters)
            : 2,
      pitch: layers.terrain || layers.buildings ? 52 : 0,
      bearing: 0,
      antialias: typeof navigator === 'undefined' || !navigator.hardwareConcurrency || navigator.hardwareConcurrency > 4,
      attributionControl: true,
      maxPitch: 85,
    });

    map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true,
    }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 140 }), 'bottom-left');

    const canvas = map.getCanvas();
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setRendererRecovering(true);
    };
    const handleContextRestored = () => {
      setRendererRecovering(false);
      map.resize();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    const suspendFollow = (event?: { originalEvent?: unknown }) => {
      // MapLibre also emits zoom/rotate/pitch events for programmatic camera
      // animation. Only a real pointer/touch/wheel event should release FIX.
      if (!event?.originalEvent) return;
      userInteractionUntilRef.current = Number.POSITIVE_INFINITY;
      onUserInteraction?.();
    };
    map.on('dragstart', suspendFollow);
    map.on('zoomstart', suspendFollow);
    map.on('rotatestart', suspendFollow);
    map.on('pitchstart', suspendFollow);

    map.on('load', () => initializeRuntimeLayers(map));
    map.on('style.load', () => {
      if (!map.isStyleLoaded()) return;
      initializeRuntimeLayers(map);
    });

    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });
    map.on('click', 'spectra-candidate-points', (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.geometry || feature.geometry.type !== 'Point') return;
      const coordinates = feature.geometry.coordinates.slice() as [number, number];
      const label = String(feature.properties?.label || 'Regional candidate');
      const confidence = Math.round(Number(feature.properties?.confidence || 0) * 100);
      const accuracyMeters = Number(feature.properties?.accuracyMeters);
      const areaText = Number.isFinite(accuracyMeters)
        ? accuracyMeters < 1000
          ? `±${Math.round(accuracyMeters)} m region`
          : `±${(accuracyMeters / 1000).toFixed(1)} km region`
        : 'Regional estimate';
      popup
        .setLngLat(coordinates)
        .setDOMContent(popupTextNode([
          { label: 'Regional candidate:', value: label },
          { label: 'Uncertainty:', value: areaText },
          { label: 'Evidence confidence:', value: `${confidence}%` },
        ]))
        .addTo(map);
    });

    map.on('click', 'spectra-observation-points', (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.geometry || feature.geometry.type !== 'Point') return;
      const coordinates = feature.geometry.coordinates.slice() as [number, number];
      const source = String(feature.properties?.source || 'observation');
      const confidence = Math.round(Number(feature.properties?.confidence || 0) * 100);
      const timestamp = String(feature.properties?.timestamp || '');
      const observationKind = String(feature.properties?.observationKind || 'observed');
      const accuracy = Number(feature.properties?.accuracy);
      const provider = String(feature.properties?.provider || '');
      popup
        .setLngLat(coordinates)
        .setDOMContent(popupTextNode([
          { label: 'Evidence:', value: source.replace(/_/g, ' ') },
          { label: 'Classification:', value: observationKind },
          ...(provider ? [{ label: 'Provider:', value: provider }] : []),
          ...(Number.isFinite(accuracy) ? [{
            label: 'Horizontal accuracy:',
            value: accuracy < 1000 ? `±${Math.round(accuracy)} m` : `±${(accuracy / 1000).toFixed(1)} km`,
          }] : []),
          { label: 'Confidence:', value: `${confidence}%` },
          ...(timestamp ? [{ label: 'Time:', value: new Date(timestamp).toLocaleString() }] : []),
        ]))
        .addTo(map);
    });

    mapRef.current = map;

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
      popup.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const desired = mapMode === 'dark' ? OPENFREEMAP_DARK : OPENFREEMAP_LIBERTY;
    if (activeStyleRef.current === desired) return;

    // Satellite/hybrid are instant raster overlays. Only the vector base style
    // changes when crossing into or out of dark mode.
    setReady(false);
    activeStyleRef.current = desired;
    map.setStyle(desired);
    map.once('style.load', () => initializeRuntimeLayers(map));
  }, [mapMode, initializeRuntimeLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    safeSetData(map, 'spectra-trail', {
      type: 'FeatureCollection',
      features: trail.length > 1
        ? [lineFeature(trail, true)].filter(Boolean)
        : [],
    });
    safeSetData(map, 'spectra-observations', {
      type: 'FeatureCollection',
      features: trail.map(pointFeature),
    });
    safeSetData(map, 'spectra-futurecast', {
      type: 'FeatureCollection',
      features: futurecast.length
        ? [lineFeature(futurecast), ...futurecast.map(pointFeature)]
        : [],
    });
    safeSetData(map, 'spectra-current', {
      type: 'FeatureCollection',
      features: currentFrame ? [pointFeature(currentFrame)] : [],
    });
    safeSetData(map, 'spectra-candidates', {
      type: 'FeatureCollection',
      features: candidateLocations.flatMap(candidate => {
        const properties = {
          label: candidate.label,
          confidence: clamp(candidate.confidence, 0, 1),
          basis: candidate.basis,
          accuracyMeters: candidate.accuracyMeters,
        };
        const point = {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [candidate.longitude, candidate.latitude],
          },
          properties,
        };
        const radius = Number(candidate.accuracyMeters);
        if (!Number.isFinite(radius) || radius <= 0) return [point];

        const area = circleFeature(
          candidate.longitude,
          candidate.latitude,
          clamp(radius, 1_000, 500_000),
        );
        return [
          {
            ...area,
            properties: {
              ...area.properties,
              ...properties,
            },
          },
          point,
        ];
      }),
    });

    const contextTime = displayTimeMs !== null
      ? new Date(displayTimeMs)
      : currentFrame?.timestamp || new Date();

    const earthSource = map.getSource('spectra-earth-observation') as any;
    const nextEarthTile = nasaGibsTilesFor(contextTime);
    const previousEarthTile = earthSource?.__spectraTile as string | undefined;
    if (earthSource?.setTiles && previousEarthTile !== nextEarthTile) {
      earthSource.setTiles([nextEarthTile]);
      earthSource.__spectraTile = nextEarthTile;
    }

    const weatherSource = map.getSource('spectra-weather-radar') as any;
    const nextWeatherTile = weatherRadarTilesFor(contextTime);
    const previousWeatherTile = weatherSource?.__spectraTile as string | undefined;
    if (weatherSource?.setTiles && previousWeatherTile !== nextWeatherTile) {
      weatherSource.setTiles([nextWeatherTile]);
      weatherSource.__spectraTile = nextWeatherTile;
    }

    const accuracy = currentFrame?.position.accuracy;
    safeSetData(map, 'spectra-uncertainty', {
      type: 'FeatureCollection',
      features: currentFrame && Number.isFinite(accuracy) && (accuracy as number) > 0
        ? [circleFeature(
            currentFrame.position.longitude,
            currentFrame.position.latitude,
            clamp(accuracy as number, 2, 100_000),
          )]
        : [],
    });
  }, [ready, trail, futurecast, currentFrame, candidateLocations, displayTimeMs]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    setVisibility(map, 'spectra-trail-line', layers.trail);
    setVisibility(map, 'spectra-earth-observation', layers.earthObservation);
    setVisibility(map, 'spectra-observation-heat', layers.heatmap);
    setVisibility(map, 'spectra-observation-points', layers.markers);
    setVisibility(map, 'spectra-futurecast-line', layers.futurecast);
    setVisibility(map, 'spectra-futurecast-points', layers.futurecast);
    setVisibility(map, 'spectra-current-ring', layers.reticle);
    setVisibility(map, 'spectra-candidate-points', candidateLocations.length > 0);
    setVisibility(map, 'spectra-candidate-area', candidateLocations.length > 0);
    setVisibility(map, 'spectra-candidate-area-outline', candidateLocations.length > 0);
    setVisibility(map, 'spectra-uncertainty-fill', layers.uncertainty);
    setVisibility(map, 'spectra-uncertainty-outline', layers.uncertainty);
    setVisibility(map, 'spectra-weather-radar', layers.weather);
    setVisibility(map, 'spectra-hillshade', layers.terrain);
    setVisibility(map, 'spectra-buildings-3d', layers.buildings);

    const showSatellite = layers.satellite && (mapMode === 'satellite' || mapMode === 'hybrid');
    setVisibility(map, 'spectra-satellite', showSatellite);
    if (map.getLayer('spectra-satellite')) {
      map.setPaintProperty('spectra-satellite', 'raster-opacity', mapMode === 'hybrid' ? 0.76 : 1);
    }

    map.setTerrain(layers.terrain
      ? { source: 'spectra-terrain-dem', exaggeration: 1.25 }
      : null);

    map.easeTo({
      pitch: layers.terrain || layers.buildings ? Math.max(map.getPitch(), 48) : 0,
      duration: 450,
    });
  }, [ready, layers, mapMode, candidateLocations.length]);

  useEffect(() => {
    if (lockOnTarget) userInteractionUntilRef.current = 0;
  }, [lockOnTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !lockOnTarget || currentFrame || candidateLocations.length === 0) return;
    if (Date.now() < userInteractionUntilRef.current) return;

    const candidate = candidateLocations[0];
    const next: [number, number] = [candidate.longitude, candidate.latitude];
    const last = lastFollowRef.current;
    const changed = !last ||
      Math.abs(last[0] - next[0]) > 0.00001 ||
      Math.abs(last[1] - next[1]) > 0.00001;
    if (!changed) return;

    lastFollowRef.current = next;
    map.easeTo({
      center: next,
      zoom: candidateZoomForAccuracy(candidate.accuracyMeters),
      duration: 500,
      essential: true,
    });
  }, [ready, lockOnTarget, currentFrame, candidateLocations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !lockOnTarget || !currentFrame) return;
    if (Date.now() < userInteractionUntilRef.current) return;

    const next: [number, number] = [
      currentFrame.position.longitude,
      currentFrame.position.latitude,
    ];
    const last = lastFollowRef.current;
    const changed = !last ||
      Math.abs(last[0] - next[0]) > 0.00001 ||
      Math.abs(last[1] - next[1]) > 0.00001;
    if (!changed) return;

    lastFollowRef.current = next;
    map.easeTo({
      center: next,
      zoom: observationZoomForAccuracy(currentFrame.position.accuracy),
      bearing: isLive && currentFrame.velocity?.heading !== undefined
        ? currentFrame.velocity.heading
        : map.getBearing(),
      duration: 500,
      essential: true,
    });
  }, [ready, lockOnTarget, currentFrame, isLive]);

  useEffect(() => {
    if (!layers.streetImagery || !currentFrame) {
      setStreetPhoto(null);
      return;
    }

    const controller = new AbortController();
    setStreetLoading(true);
    const params = new URLSearchParams({
      lat: String(currentFrame.position.latitude),
      lng: String(currentFrame.position.longitude),
    });

    fetch(`/api/geoconsole/street-imagery?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Street imagery unavailable')))
      .then(payload => {
        setStreetPhoto(payload?.data || null);
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setStreetPhoto(null);
      })
      .finally(() => setStreetLoading(false));

    return () => controller.abort();
  }, [
    layers.streetImagery,
    currentFrame?.id,
    currentFrame?.position.latitude,
    currentFrame?.position.longitude,
  ]);

  const streetImageUrl =
    streetPhoto?.fileurlProc || streetPhoto?.fileurl || streetPhoto?.fileurlTh || null;

  return (
    <div className="absolute inset-0" data-gesture-navigation="ignore">
      <div ref={containerRef} className="absolute inset-0" />

      {rendererRecovering && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-slate-200 shadow-xl">
            Restoring map…
          </div>
        </div>
      )}

      {layers.streetImagery && (
        <div className="absolute bottom-12 right-3 z-20 w-[min(360px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-slate-600/60 bg-slate-950/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-700/60 px-3 py-2">
            <span className="text-xs font-semibold text-slate-200">Street Imagery</span>
          </div>
          {streetLoading ? (
            <div className="p-5 text-center text-xs text-slate-400">Finding nearest public street image…</div>
          ) : streetImageUrl ? (
            <>
              <img
                src={streetImageUrl}
                alt="Nearest public street-level view"
                className="max-h-56 w-full object-cover"
                loading="lazy"
              />
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-[10px] text-slate-400">
                <span>{streetPhoto?.shotDate || 'Capture date unavailable'}</span>
                {streetPhoto?.heading !== undefined && <span>HDG {Number(streetPhoto.heading).toFixed(0)}°</span>}
              </div>
            </>
          ) : (
            <div className="p-5 text-center text-xs text-slate-400">
              No public street image found near this position.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MapLibreIntelligenceMap;
