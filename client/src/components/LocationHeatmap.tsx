import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet.heat';

interface HeatmapProps {
  data: Array<[number, number, number]>;
  markers?: Array<{ pos: [number, number]; popup: string }>;
  center?: [number, number];
  zoom?: number;
  config?: { radius?: number; blur?: number; maxZoom?: number };
  satelliteView?: boolean;
}

type MapStatus = 'initializing' | 'waiting_coordinates' | 'loading_tiles' | 'ready' | 'error';

export const LocationHeatmap: React.FC<HeatmapProps> = ({
  data,
  markers = [],
  center = [40.7128, -74.0060],
  zoom = 12,
  config = {},
  satelliteView = true,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatLayerRef = useRef<L.Layer | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [mapMode, setMapMode] = useState<'satellite' | 'street'>(satelliteView ? 'satellite' : 'street');
  const [mapStatus, setMapStatus] = useState<MapStatus>('initializing');
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [coordinatesReady, setCoordinatesReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { radius = 25, blur = 15, maxZoom = 18 } = config;

  // Step 1: Validate coordinates are ready
  useEffect(() => {
    if (center && center.length === 2 && 
        typeof center[0] === 'number' && typeof center[1] === 'number' &&
        !isNaN(center[0]) && !isNaN(center[1])) {
      setCoordinatesReady(true);
      setMapStatus('loading_tiles');
    } else {
      setCoordinatesReady(false);
      setMapStatus('waiting_coordinates');
    }
  }, [center]);

  // Step 2: Initialize map engine only after coordinates are ready
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !coordinatesReady) return;

    setMapStatus('loading_tiles');
    setErrorMessage(null);
    
    try {
      const map = L.map(containerRef.current, {
        center: center,
        zoom: zoom,
        preferCanvas: true, // Better performance
      });
      
      // High-quality satellite imagery layer (Esri World Imagery - free, high resolution)
      const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19,
      });
      
      // Street map layer for reference
      const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      });
      
      // Labels overlay for satellite view (Esri labels)
      const labelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
      });

      // Step 3: Wait for tiles to load before marking ready
      const primaryLayer = satelliteView ? satelliteLayer : streetLayer;
      
      let tilesLoadedCount = 0;
      let tilesLoadingCount = 0;
      let tileErrorCount = 0;
      
      primaryLayer.on('tileloadstart', () => {
        tilesLoadingCount++;
      });
      
      primaryLayer.on('tileload', () => {
        tilesLoadedCount++;
        // Consider map ready when significant tiles have loaded
        if (tilesLoadedCount >= 4 && !tilesLoaded) {
          setTilesLoaded(true);
          setMapStatus('ready');
        }
      });
      
      primaryLayer.on('tileerror', () => {
        tileErrorCount++;
        console.warn('[LocationHeatmap] Tile load error');
        // If too many tile errors, show error state
        if (tileErrorCount > 5 && tilesLoadedCount === 0) {
          setMapStatus('error');
          setErrorMessage('Failed to load map tiles. Please check your internet connection.');
        }
      });

      // Add default layer based on satelliteView prop
      if (satelliteView) {
        satelliteLayer.addTo(map);
        labelsLayer.addTo(map);
      } else {
        streetLayer.addTo(map);
      }

      // Layer control for switching between satellite and street view
      const baseMaps = {
        "🛰️ Satellite": satelliteLayer,
        "🗺️ Street": streetLayer
      };
      L.control.layers(baseMaps, { "📍 Labels": labelsLayer }).addTo(map);

      // Set ready after a brief delay if tiles don't trigger events
      const fallbackTimer = setTimeout(() => {
        if (!tilesLoaded) {
          setTilesLoaded(true);
          setMapStatus('ready');
        }
      }, 3000);

      mapRef.current = map;
      
      return () => { 
        clearTimeout(fallbackTimer);
        map.remove(); 
        mapRef.current = null; 
      };
    } catch (error) {
      console.error('[LocationHeatmap] Map initialization failed:', error);
      setMapStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to initialize map. Please try refreshing the page.');
    }
  }, [coordinatesReady, center, zoom, satelliteView]);

  // Step 4: Add data layers only after map is ready
  useEffect(() => {
    if (!mapRef.current || mapStatus !== 'ready') return;

    try {
      // Clear existing heat layer
      if (heatLayerRef.current) {
        mapRef.current.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }

      // Clear existing markers
      markersRef.current.forEach(m => mapRef.current!.removeLayer(m));
      markersRef.current = [];

      // Add heatmap
      if (data.length) {
        heatLayerRef.current = (L as any).heatLayer(data, { radius, blur, maxZoom }).addTo(mapRef.current);
        const bounds = L.latLngBounds(data.map(d => [d[0], d[1]]));
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
      }

      // Add markers
      markers.forEach(m => {
        const marker = L.marker(m.pos).bindPopup(m.popup).addTo(mapRef.current!);
        markersRef.current.push(marker);
      });
    } catch (error) {
      console.error('[LocationHeatmap] Failed to add data layers:', error);
      setErrorMessage('Failed to render map data. Please try again.');
    }
  }, [data, markers, radius, blur, maxZoom, mapStatus]);

  return (
    <div className="relative">
      {/* Error banner */}
      {mapStatus === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/10 border-2 border-destructive/30 z-20 rounded-lg" style={{ minHeight: '400px' }}>
          <div className="text-center p-6 max-w-md">
            <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-destructive mb-2">Map Failed to Load</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {errorMessage || 'An unexpected error occurred while loading the map.'}
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      )}
      
      {/* Loading overlay */}
      {mapStatus !== 'ready' && mapStatus !== 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/80 z-10 rounded-lg">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {mapStatus === 'initializing' && 'Initializing map engine...'}
              {mapStatus === 'waiting_coordinates' && 'Waiting for coordinates...'}
              {mapStatus === 'loading_tiles' && 'Loading satellite imagery...'}
            </p>
          </div>
        </div>
      )}
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: '600px', minHeight: '400px', borderRadius: 8 }} 
        className={mapStatus !== 'ready' ? 'opacity-30' : 'opacity-100 transition-opacity duration-500'}
      />
    </div>
  );
};
