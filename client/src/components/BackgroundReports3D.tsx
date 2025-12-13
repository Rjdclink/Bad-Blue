/**
 * BackgroundReports3D - MapLibre GL JS Map Component
 * 
 * 3D-style satellite/terrain map for PANTHEON background reports.
 * Features:
 * - Satellite/terrain style map
 * - Plot OSINT/legal incident points
 * - Animated camera (flyTo) for report summaries
 * - Markers, paths, and regions visualization
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface ReportMarker {
  id: string;
  coordinates: [number, number]; // [lng, lat]
  type: 'incident' | 'evidence' | 'witness' | 'legal' | 'osint';
  label: string;
  description?: string;
  timestamp?: Date;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ReportPath {
  id: string;
  coordinates: [number, number][];
  type: 'movement' | 'connection' | 'timeline';
  label?: string;
  color?: string;
}

export interface ReportRegion {
  id: string;
  coordinates: [number, number][][]; // Polygon coordinates
  type: 'jurisdiction' | 'area_of_interest' | 'hotspot';
  label?: string;
  fillColor?: string;
  fillOpacity?: number;
}

export interface BackgroundReports3DProps {
  /** Map center coordinates [lng, lat] */
  center?: [number, number];
  /** Initial zoom level */
  zoom?: number;
  /** Map style: 'satellite' | 'terrain' | 'streets' */
  style?: 'satellite' | 'terrain' | 'streets';
  /** Markers to display */
  markers?: ReportMarker[];
  /** Paths to display */
  paths?: ReportPath[];
  /** Regions to display */
  regions?: ReportRegion[];
  /** Current report being viewed (triggers flyTo) */
  activeReportId?: string;
  /** Callback when marker is clicked */
  onMarkerClick?: (marker: ReportMarker) => void;
  /** Additional CSS classes */
  className?: string;
  /** Enable 3D terrain */
  enable3D?: boolean;
  /** Enable globe projection (future upgrade path to CesiumJS) */
  enableGlobe?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Map styles - using environment variables or fallback to OSM
// In production, set VITE_MAPTILER_KEY environment variable
const MAPTILER_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPTILER_KEY) || '';

const MAP_STYLES = {
  satellite: MAPTILER_KEY ? `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}` : null,
  terrain: MAPTILER_KEY ? `https://api.maptiler.com/maps/outdoor/style.json?key=${MAPTILER_KEY}` : null,
  streets: MAPTILER_KEY ? `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}` : null,
};

// Fallback to OpenStreetMap style
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'PANTHEON Map',
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

// Marker colors by type
const MARKER_COLORS: Record<ReportMarker['type'], string> = {
  incident: '#ef4444',    // Red
  evidence: '#3b82f6',    // Blue
  witness: '#22c55e',     // Green
  legal: '#8b5cf6',       // Purple
  osint: '#f59e0b',       // Amber
};

// Severity colors
const SEVERITY_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#dc2626',
};

// ============================================================================
// COMPONENT
// ============================================================================

const BackgroundReports3D = memo(function BackgroundReports3D({
  center = [-98.5795, 39.8283], // Center of US
  zoom = 4,
  style = 'streets',
  markers = [],
  paths = [],
  regions = [],
  activeReportId,
  onMarkerClick,
  className,
  enable3D = false,
  enableGlobe = false,
}: BackgroundReports3DProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: OSM_STYLE, // Use OSM fallback for reliability
        center,
        zoom,
        pitch: enable3D ? 45 : 0,
        bearing: 0,
        antialias: true,
      });

      // Add navigation controls
      map.current.addControl(
        new maplibregl.NavigationControl({
          visualizePitch: true,
        }),
        'top-right'
      );

      // Add scale control
      map.current.addControl(
        new maplibregl.ScaleControl({
          maxWidth: 200,
          unit: 'imperial',
        }),
        'bottom-left'
      );

      // Handle load event
      map.current.on('load', () => {
        setIsLoaded(true);
        console.log('[BackgroundReports3D] Map loaded');
      });

      // Handle errors
      map.current.on('error', (e) => {
        console.error('[BackgroundReports3D] Map error:', e);
        setError('Failed to load map tiles');
      });

    } catch (err) {
      console.error('[BackgroundReports3D] Initialization error:', err);
      setError('Failed to initialize map');
    }

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [center, zoom, enable3D]);

  // Add/update markers
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Add new markers
    markers.forEach((markerData) => {
      const el = document.createElement('div');
      el.className = 'pantheon-marker';
      el.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: ${MARKER_COLORS[markerData.type]};
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        cursor: pointer;
        transition: transform 0.2s ease;
      `;
      
      // Add severity indicator
      if (markerData.severity) {
        const ring = document.createElement('div');
        ring.style.cssText = `
          position: absolute;
          top: -4px;
          left: -4px;
          right: -4px;
          bottom: -4px;
          border-radius: 50%;
          border: 2px solid ${SEVERITY_COLORS[markerData.severity]};
          animation: pulse 2s ease-in-out infinite;
        `;
        el.appendChild(ring);
      }

      // Hover effect
      el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.2)';
      });
      el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1)';
      });

      // Click handler
      el.addEventListener('click', () => {
        if (onMarkerClick) {
          onMarkerClick(markerData);
        }
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(markerData.coordinates)
        .setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 8px; min-width: 150px;">
              <h3 style="margin: 0 0 4px 0; font-weight: bold; color: ${MARKER_COLORS[markerData.type]};">
                ${markerData.label}
              </h3>
              <p style="margin: 0; font-size: 12px; color: #666;">
                ${markerData.type.toUpperCase()}
                ${markerData.severity ? ` • ${markerData.severity.toUpperCase()}` : ''}
              </p>
              ${markerData.description ? `<p style="margin: 8px 0 0 0; font-size: 13px;">${markerData.description}</p>` : ''}
              ${markerData.timestamp ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: #888;">${new Date(markerData.timestamp).toLocaleString()}</p>` : ''}
            </div>
          `)
        )
        .addTo(map.current!);

      markersRef.current.push(marker);
    });
  }, [markers, isLoaded, onMarkerClick]);

  // Add paths
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    // Remove existing path layers
    paths.forEach((path) => {
      if (map.current?.getLayer(`path-${path.id}`)) {
        map.current.removeLayer(`path-${path.id}`);
      }
      if (map.current?.getSource(`path-source-${path.id}`)) {
        map.current.removeSource(`path-source-${path.id}`);
      }
    });

    // Add new paths
    paths.forEach((path) => {
      if (!map.current) return;

      map.current.addSource(`path-source-${path.id}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: path.coordinates,
          },
        },
      });

      map.current.addLayer({
        id: `path-${path.id}`,
        type: 'line',
        source: `path-source-${path.id}`,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': path.color || '#3b82f6',
          'line-width': 3,
          'line-opacity': 0.8,
          'line-dasharray': path.type === 'timeline' ? [2, 2] : [1],
        },
      });
    });
  }, [paths, isLoaded]);

  // Add regions
  useEffect(() => {
    if (!map.current || !isLoaded) return;

    // Remove existing region layers
    regions.forEach((region) => {
      if (map.current?.getLayer(`region-fill-${region.id}`)) {
        map.current.removeLayer(`region-fill-${region.id}`);
      }
      if (map.current?.getLayer(`region-outline-${region.id}`)) {
        map.current.removeLayer(`region-outline-${region.id}`);
      }
      if (map.current?.getSource(`region-source-${region.id}`)) {
        map.current.removeSource(`region-source-${region.id}`);
      }
    });

    // Add new regions
    regions.forEach((region) => {
      if (!map.current) return;

      map.current.addSource(`region-source-${region.id}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: region.coordinates,
          },
        },
      });

      // Fill layer
      map.current.addLayer({
        id: `region-fill-${region.id}`,
        type: 'fill',
        source: `region-source-${region.id}`,
        paint: {
          'fill-color': region.fillColor || '#3b82f6',
          'fill-opacity': region.fillOpacity ?? 0.2,
        },
      });

      // Outline layer
      map.current.addLayer({
        id: `region-outline-${region.id}`,
        type: 'line',
        source: `region-source-${region.id}`,
        paint: {
          'line-color': region.fillColor || '#3b82f6',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      });
    });
  }, [regions, isLoaded]);

  // Handle active report (flyTo animation)
  useEffect(() => {
    if (!map.current || !isLoaded || !activeReportId) return;

    // Find the marker for the active report
    const activeMarker = markers.find((m) => m.id === activeReportId);
    if (activeMarker) {
      map.current.flyTo({
        center: activeMarker.coordinates,
        zoom: 12,
        pitch: enable3D ? 60 : 0,
        bearing: enable3D ? 30 : 0,
        duration: 2000,
        essential: true,
      });

      // Open the marker's popup
      const markerInstance = markersRef.current.find((_, idx) => markers[idx]?.id === activeReportId);
      if (markerInstance) {
        markerInstance.togglePopup();
      }
    }
  }, [activeReportId, markers, isLoaded, enable3D]);

  // Fly to specific location
  const flyTo = useCallback((
    coordinates: [number, number],
    options?: { zoom?: number; pitch?: number; bearing?: number; duration?: number }
  ) => {
    if (!map.current) return;

    map.current.flyTo({
      center: coordinates,
      zoom: options?.zoom ?? 14,
      pitch: options?.pitch ?? (enable3D ? 45 : 0),
      bearing: options?.bearing ?? 0,
      duration: options?.duration ?? 2000,
      essential: true,
    });
  }, [enable3D]);

  // Fit bounds to show all markers
  const fitToMarkers = useCallback(() => {
    if (!map.current || markers.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    markers.forEach((marker) => {
      bounds.extend(marker.coordinates);
    });

    map.current.fitBounds(bounds, {
      padding: 50,
      maxZoom: 15,
      duration: 1500,
    });
  }, [markers]);

  return (
    <div className={cn('relative w-full h-full min-h-[400px] rounded-lg overflow-hidden', className)}>
      {/* Map container */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Loading overlay */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-cyan-400 text-sm font-medium">Loading PANTHEON Map...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90">
          <div className="text-center p-6">
            <div className="text-red-400 text-lg font-medium mb-2">Map Error</div>
            <p className="text-slate-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Map legend */}
      {isLoaded && markers.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-slate-900/90 backdrop-blur-sm rounded-lg p-3 text-xs">
          <div className="font-medium text-slate-200 mb-2">Legend</div>
          <div className="space-y-1">
            {Object.entries(MARKER_COLORS).map(([type, color]) => {
              const count = markers.filter((m) => m.type === type).length;
              if (count === 0) return null;
              return (
                <div key={type} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-slate-300 capitalize">
                    {type} ({count})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {isLoaded && (
        <div className="absolute top-4 left-4 flex flex-col gap-2">
          {markers.length > 1 && (
            <button
              onClick={fitToMarkers}
              className="px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-medium rounded-lg backdrop-blur-sm transition-colors"
            >
              Fit All
            </button>
          )}
        </div>
      )}

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.5; }
        }
      `}</style>
    </div>
  );
});

export default BackgroundReports3D;
