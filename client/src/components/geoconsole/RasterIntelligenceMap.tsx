import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { IntelligenceMapProps } from './MapLibreIntelligenceMap';

const STREET = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SATELLITE = (import.meta.env.VITE_SATELLITE_TILES_URL as string | undefined)
  || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DARK = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const TERRAIN = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';

/** A rendering fallback only: evidence, confidence and controls retain the same authority. */
export default function RasterIntelligenceMap(props: IntelligenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const evidenceRef = useRef<L.LayerGroup | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const latest = propsRef.current.currentFrame || propsRef.current.trail.at(-1);
    const candidate = propsRef.current.candidateLocations?.[0];
    const center: L.LatLngExpression = latest
      ? [latest.position.latitude, latest.position.longitude]
      : candidate ? [candidate.latitude, candidate.longitude] : [20, 0];
    const map = L.map(containerRef.current, {
      center, zoom: latest ? 15 : candidate ? 8 : 2,
      zoomControl: false, minZoom: 1, maxZoom: 20,
    });
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: true, metric: true }).addTo(map);
    evidenceRef.current = L.layerGroup().addTo(map);
    const releaseFollow = () => propsRef.current.onUserInteraction?.();
    map.on('dragstart', releaseFollow);
    const wheel = () => releaseFollow();
    const pointer = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest('.leaflet-control-zoom')) releaseFollow();
    };
    containerRef.current.addEventListener('wheel', wheel, { passive: true });
    containerRef.current.addEventListener('pointerdown', pointer);
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(containerRef.current);
    setReady(true);
    return () => {
      resize.disconnect();
      containerRef.current?.removeEventListener('wheel', wheel);
      containerRef.current?.removeEventListener('pointerdown', pointer);
      // Remove evidence paths before their renderer is destroyed on navigation.
      evidenceRef.current?.clearLayers();
      map.remove();
      mapRef.current = null;
      evidenceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setTileError(false);
    const satellite = props.layers.satellite || ['satellite', 'hybrid'].includes(props.mapMode);
    const url = props.layers.terrain ? TERRAIN : satellite ? SATELLITE : props.mapMode === 'dark' ? DARK : STREET;
    const attribution = url === STREET ? '&copy; OpenStreetMap contributors'
      : url === DARK ? '&copy; OpenStreetMap contributors &copy; CARTO'
        : (import.meta.env.VITE_SATELLITE_ATTRIBUTION as string | undefined) || 'Tiles &copy; Esri';
    const tileLayers: L.TileLayer[] = [];
    const base = L.tileLayer(url, { maxZoom: 20, maxNativeZoom: 19, attribution }).addTo(map);
    tileLayers.push(base);
    let failureCount = 0;
    let fallback: L.TileLayer | null = null;
    base.on('tileerror', () => {
      failureCount += 1;
      if (failureCount < 3 || fallback) return;
      map.removeLayer(base);
      fallback = L.tileLayer(STREET, {
        maxZoom: 20, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      tileLayers.push(fallback);
      fallback.on('tileerror', () => setTileError(true));
      fallback.on('tileload', () => setTileError(false));
    });
    if (props.mapMode === 'hybrid' && satellite && !props.layers.terrain) {
      const labels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20, maxNativeZoom: 19, attribution: 'Labels &copy; Esri',
      }).addTo(map);
      tileLayers.push(labels);
    }
    if (props.layers.weather) {
      const weather = L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-0/{z}/{x}/{y}.png', {
        opacity: 0.55, maxZoom: 20, maxNativeZoom: 12, attribution: 'NEXRAD via Iowa Environmental Mesonet',
      }).addTo(map);
      tileLayers.push(weather);
    }
    if (props.layers.earthObservation) {
      const date = new Date(Math.min(props.displayTime?.getTime() ?? Date.now(), Date.now())).toISOString().slice(0, 10);
      const earth = L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, {
        opacity: 0.72, maxZoom: 20, maxNativeZoom: 9, attribution: 'NASA GIBS / MODIS Terra',
      }).addTo(map);
      tileLayers.push(earth);
    }
    return () => { tileLayers.forEach(layer => map.removeLayer(layer)); };
  }, [ready, props.mapMode, props.layers.satellite, props.layers.terrain, props.layers.weather, props.layers.earthObservation, props.displayTime?.getTime()]);

  useEffect(() => {
    const group = evidenceRef.current;
    const map = mapRef.current;
    if (!ready || !group || !map) return;
    group.clearLayers();
    const popup = (lines: string[]) => {
      const node = document.createElement('div');
      lines.forEach(text => { const line = document.createElement('div'); line.textContent = text; node.append(line); });
      return node;
    };
    for (const candidate of props.candidateLocations || []) {
      const location: L.LatLngExpression = [candidate.latitude, candidate.longitude];
      const radius = candidate.accuracyMeters;
      if (props.layers.uncertainty && Number.isFinite(radius) && radius! > 0) {
        L.circle(location, { radius: radius!, color: '#fbbf24', weight: 1, fillOpacity: 0.08, dashArray: '4 4' }).addTo(group);
      }
      L.circleMarker(location, { radius: 7, color: '#fbbf24', fillOpacity: 0.3 }).bindPopup(popup([
        `Regional candidate: ${candidate.label}`, 'A regional estimate does not verify a current location.',
      ])).addTo(group);
    }
    const drawFrame = (frame: NonNullable<IntelligenceMapProps['currentFrame']>, current = false) => {
      const location: L.LatLngExpression = [frame.position.latitude, frame.position.longitude];
      const predicted = frame.observationKind === 'predicted' || frame.source === 'predicted';
      const color = predicted ? '#c084fc' : current ? '#34d399' : '#22d3ee';
      const radius = frame.position.accuracy;
      if (current && props.layers.reticle) {
        L.circleMarker(location, { radius: 16, color, weight: 1, fillOpacity: 0, interactive: false }).addTo(group);
      }
      if (props.layers.uncertainty && Number.isFinite(radius) && radius! > 0) {
        L.circle(location, { radius: radius!, color, weight: 1, fillOpacity: 0.1 }).addTo(group);
      }
      if (props.layers.markers || current) {
        L.circleMarker(location, { radius: current ? 8 : 4, color, fillOpacity: 0.7 }).bindPopup(popup([
          `${predicted ? 'Predicted' : frame.observationKind || 'Observed'}: ${frame.source.replace(/_/g, ' ')}`,
          `Time: ${frame.timestamp.toLocaleString()}`,
          ...(Number.isFinite(radius) ? [`Reported accuracy: ±${Math.ceil(radius! / 0.3048)} ft`] : []),
        ])).addTo(group);
      }
    };
    // Overlapping observed-point circles show evidence density in the 2D view.
    // Prediction and regional candidates never contribute to observed density.
    if (props.layers.heatmap) {
      for (const frame of props.trail) {
        if (frame.observationKind === 'predicted' || frame.source === 'predicted') continue;
        L.circleMarker([frame.position.latitude, frame.position.longitude], {
          radius: 24, stroke: false, fillColor: '#0ea5e9',
          fillOpacity: Math.max(0.03, Math.min(0.15, frame.confidence * 0.15)),
          interactive: false, className: 'spectra-observation-density',
        }).addTo(group);
      }
    }
    // Preserve recorded gaps; never draw a continuous track across missing evidence.
    if (props.layers.trail) {
      let segment: L.LatLngExpression[] = [];
      const flush = () => { if (segment.length > 1) L.polyline(segment, { color: '#22d3ee', weight: 3 }).addTo(group); segment = []; };
      for (const frame of props.trail) {
        if (Number(frame.metadata?.gapBeforeSeconds || 0) > 0) flush();
        segment.push([frame.position.latitude, frame.position.longitude]);
      }
      flush();
    }
    props.trail.forEach(frame => drawFrame(frame));
    if (props.layers.futurecast) props.futurecast.forEach(frame => drawFrame(frame));
    if (props.currentFrame) drawFrame(props.currentFrame, true);
    if (props.lockOnTarget) {
      const latest = props.currentFrame || props.trail.at(-1);
      const candidate = props.candidateLocations?.[0];
      if (latest) map.setView([latest.position.latitude, latest.position.longitude], Math.max(map.getZoom(), 15), { animate: false });
      else if (candidate) map.setView([candidate.latitude, candidate.longitude], Math.max(map.getZoom(), 8), { animate: false });
    }
  }, [ready, props.currentFrame, props.trail, props.futurecast, props.candidateLocations, props.layers, props.lockOnTarget]);

  return <div className="absolute inset-0 isolate" data-testid="spectra-raster-map" data-gesture-navigation="ignore">
    <div ref={containerRef} className="absolute inset-0 z-0" aria-label="Interactive location map" />
    <div role="status" className="pointer-events-none absolute bottom-10 left-3 z-10 rounded bg-slate-950/90 px-2 py-1 text-xs text-slate-200">
      {tileError ? 'Map images are temporarily unavailable. Location markers and controls remain available.' : props.layers.terrain ? 'Terrain map · 2D view' : props.layers.buildings ? '2D map · 3D buildings unavailable in this browser' : '2D map'}
    </div>
  </div>;
}
