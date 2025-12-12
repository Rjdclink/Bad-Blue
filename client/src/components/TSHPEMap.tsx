/**
 * TSHPEMap Component
 * 
 * Cinematic full-screen map with:
 * - Glowing star geolocation reticle
 * - Dynamic heat trail for movement history
 * - Predictive cone visualization
 * - Multiple satellite/map tile sources
 * - Ethereal glow aesthetic
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

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

export interface PredictedCone {
  center: Position;
  radiusNow: number;
  radiusFuture: number;
  angle: number;
  confidence: number;
}

interface TSHPEMapProps {
  position: Position;
  heatTrail?: Position[];
  predictedCone?: PredictedCone | null;
  mapMode: 'satellite' | 'hybrid' | 'street';
  forecastMinutes?: number;
  accuracy?: number;
}

type MapStatus = 'initializing' | 'loading' | 'ready' | 'error';

// ============================================================================
// COMPONENT
// ============================================================================

export const TSHPEMap: React.FC<TSHPEMapProps> = ({
  position,
  heatTrail = [],
  predictedCone = null,
  mapMode = 'satellite',
  forecastMinutes = 30,
  accuracy = 10,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const positionMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const heatLayerRef = useRef<L.Layer | null>(null);
  const trailLineRef = useRef<L.Polyline | null>(null);
  const coneLayerRef = useRef<L.Polygon | null>(null);
  const reticleOverlayRef = useRef<HTMLDivElement | null>(null);
  
  const [mapStatus, setMapStatus] = useState<MapStatus>('initializing');
  const [currentTileLayer, setCurrentTileLayer] = useState<L.TileLayer | null>(null);
  const [labelsLayer, setLabelsLayer] = useState<L.TileLayer | null>(null);

  // Tile layer configurations
  const tileLayers = {
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    },
    hybrid: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
      labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    },
    street: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    },
  };

  // Custom glowing reticle icon
  const createReticleIcon = useCallback(() => {
    return L.divIcon({
      className: 'tshpe-reticle',
      html: `
        <div class="reticle-container">
          <div class="reticle-pulse"></div>
          <div class="reticle-ring"></div>
          <div class="reticle-ring-inner"></div>
          <div class="reticle-crosshair"></div>
          <div class="reticle-dot"></div>
        </div>
      `,
      iconSize: [60, 60],
      iconAnchor: [30, 30],
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    
    setMapStatus('loading');
    
    try {
      const map = L.map(containerRef.current, {
        center: [position.lat, position.lon],
        zoom: 16,
        zoomControl: false,
        preferCanvas: true,
      });
      
      // Add zoom control to bottom-left
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
      
      // Initial tile layer
      const config = tileLayers[mapMode];
      const tileLayer = L.tileLayer(config.url, {
        attribution: config.attribution,
        maxZoom: config.maxZoom,
      }).addTo(map);
      
      setCurrentTileLayer(tileLayer);
      
      // Add labels for hybrid mode
      if (mapMode === 'hybrid' && tileLayers.hybrid.labels) {
        const labels = L.tileLayer(tileLayers.hybrid.labels, { maxZoom: 19 }).addTo(map);
        setLabelsLayer(labels);
      }
      
      tileLayer.on('load', () => setMapStatus('ready'));
      
      // Fallback ready state
      setTimeout(() => setMapStatus('ready'), 2000);
      
      mapRef.current = map;
      
      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      console.error('[TSHPEMap] Initialization failed:', error);
      setMapStatus('error');
    }
  }, []);

  // Update tile layer when map mode changes
  useEffect(() => {
    if (!mapRef.current) return;
    
    // Remove old layers
    if (currentTileLayer) {
      mapRef.current.removeLayer(currentTileLayer);
    }
    if (labelsLayer) {
      mapRef.current.removeLayer(labelsLayer);
      setLabelsLayer(null);
    }
    
    // Add new layer
    const config = tileLayers[mapMode];
    const newTileLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(mapRef.current);
    
    setCurrentTileLayer(newTileLayer);
    
    // Add labels for hybrid mode
    if (mapMode === 'hybrid' && tileLayers.hybrid.labels) {
      const labels = L.tileLayer(tileLayers.hybrid.labels, { maxZoom: 19 }).addTo(mapRef.current);
      setLabelsLayer(labels);
    }
  }, [mapMode]);

  // Update position marker and accuracy circle
  useEffect(() => {
    if (!mapRef.current || mapStatus !== 'ready') return;
    
    const latLng: [number, number] = [position.lat, position.lon];
    
    // Update or create position marker
    if (positionMarkerRef.current) {
      positionMarkerRef.current.setLatLng(latLng);
    } else {
      positionMarkerRef.current = L.marker(latLng, {
        icon: createReticleIcon(),
        zIndexOffset: 1000,
      }).addTo(mapRef.current);
    }
    
    // Update or create accuracy circle
    if (accuracyCircleRef.current) {
      accuracyCircleRef.current.setLatLng(latLng);
      accuracyCircleRef.current.setRadius(accuracy);
    } else {
      accuracyCircleRef.current = L.circle(latLng, {
        radius: accuracy,
        color: '#06b6d4',
        fillColor: '#06b6d4',
        fillOpacity: 0.1,
        weight: 1,
        className: 'accuracy-circle',
      }).addTo(mapRef.current);
    }
    
    // Pan to position
    mapRef.current.panTo(latLng, { animate: true, duration: 0.5 });
  }, [position, accuracy, mapStatus, createReticleIcon]);

  // Update heat trail
  useEffect(() => {
    if (!mapRef.current || mapStatus !== 'ready' || heatTrail.length === 0) return;
    
    // Remove old layers
    if (heatLayerRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current);
    }
    if (trailLineRef.current) {
      mapRef.current.removeLayer(trailLineRef.current);
    }
    
    // Create heat trail data
    const heatData: [number, number, number][] = heatTrail.map((p, i) => [
      p.lat,
      p.lon,
      0.3 + (i / heatTrail.length) * 0.7, // Intensity increases towards current
    ]);
    
    // Add heat layer (leaflet.heat extends L with heatLayer)
    // Type assertion needed as leaflet.heat augments the L namespace
    const LeafletWithHeat = L as typeof L & {
      heatLayer: (data: [number, number, number][], options: Record<string, unknown>) => L.Layer;
    };
    
    heatLayerRef.current = LeafletWithHeat.heatLayer(heatData, {
      radius: 15,
      blur: 20,
      maxZoom: 18,
      gradient: {
        0.0: '#0ea5e9',
        0.5: '#06b6d4',
        0.7: '#22d3ee',
        1.0: '#67e8f9',
      },
    }).addTo(mapRef.current);
    
    // Add trail line
    const trailCoords: [number, number][] = heatTrail.map(p => [p.lat, p.lon]);
    trailLineRef.current = L.polyline(trailCoords, {
      color: '#06b6d4',
      weight: 2,
      opacity: 0.6,
      dashArray: '5, 5',
      className: 'trail-line',
    }).addTo(mapRef.current);
  }, [heatTrail, mapStatus]);

  // Update predicted cone
  useEffect(() => {
    if (!mapRef.current || mapStatus !== 'ready') return;
    
    // Remove old cone
    if (coneLayerRef.current) {
      mapRef.current.removeLayer(coneLayerRef.current);
      coneLayerRef.current = null;
    }
    
    if (!predictedCone) return;
    
    // Create cone polygon
    const { center, radiusNow, radiusFuture, angle, confidence } = predictedCone;
    const heading = position.heading || 0;
    const coneAngle = 30 + (1 - confidence) * 30; // Wider cone = less confidence
    
    // Calculate cone points
    const points: [number, number][] = [];
    const steps = 20;
    const earthRadius = 6371000; // meters
    
    // Start point (current position)
    points.push([center.lat, center.lon]);
    
    // Arc at future radius
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const arcAngle = heading - coneAngle / 2 + t * coneAngle;
      const radAngle = (arcAngle * Math.PI) / 180;
      const radHeading = (heading * Math.PI) / 180;
      
      const lat = center.lat + (radiusFuture / earthRadius) * (180 / Math.PI) * Math.cos(radAngle);
      const lon = center.lon + (radiusFuture / earthRadius) * (180 / Math.PI) * Math.sin(radAngle) / Math.cos(center.lat * Math.PI / 180);
      
      points.push([lat, lon]);
    }
    
    // Close the cone
    points.push([center.lat, center.lon]);
    
    coneLayerRef.current = L.polygon(points, {
      color: '#eab308',
      fillColor: '#eab308',
      fillOpacity: 0.15,
      weight: 1,
      className: 'prediction-cone',
    }).addTo(mapRef.current);
  }, [predictedCone, position.heading, mapStatus]);

  return (
    <div className="relative w-full h-full">
      {/* Loading Overlay */}
      {mapStatus !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-30">
          <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 border-4 border-cyan-500/30 rounded-full" />
              <div className="absolute inset-0 border-4 border-transparent border-t-cyan-500 rounded-full animate-spin" />
              <div className="absolute inset-2 border-2 border-cyan-500/20 rounded-full" />
            </div>
            <p className="text-sm text-slate-400 font-mono">
              {mapStatus === 'initializing' && 'INITIALIZING ENGINE...'}
              {mapStatus === 'loading' && 'LOADING SATELLITE TILES...'}
              {mapStatus === 'error' && 'SYSTEM ERROR'}
            </p>
          </div>
        </div>
      )}
      
      {/* Map Container */}
      <div 
        ref={containerRef} 
        className={cn(
          "w-full h-full",
          mapStatus !== 'ready' && "opacity-30"
        )}
      />
      
      {/* Glowing Reticle CSS */}
      <style>{`
        .tshpe-reticle {
          background: transparent !important;
          border: none !important;
        }
        
        .reticle-container {
          position: relative;
          width: 60px;
          height: 60px;
        }
        
        .reticle-pulse {
          position: absolute;
          inset: 0;
          border: 2px solid rgba(6, 182, 212, 0.5);
          border-radius: 50%;
          animation: pulse-expand 2s ease-out infinite;
        }
        
        .reticle-ring {
          position: absolute;
          inset: 5px;
          border: 2px solid rgba(6, 182, 212, 0.8);
          border-radius: 50%;
          box-shadow: 0 0 15px rgba(6, 182, 212, 0.5), inset 0 0 10px rgba(6, 182, 212, 0.2);
        }
        
        .reticle-ring-inner {
          position: absolute;
          inset: 15px;
          border: 1px solid rgba(6, 182, 212, 0.6);
          border-radius: 50%;
        }
        
        .reticle-crosshair {
          position: absolute;
          inset: 0;
        }
        
        .reticle-crosshair::before,
        .reticle-crosshair::after {
          content: '';
          position: absolute;
          background: rgba(6, 182, 212, 0.8);
        }
        
        .reticle-crosshair::before {
          width: 1px;
          height: 100%;
          left: 50%;
          transform: translateX(-50%);
        }
        
        .reticle-crosshair::after {
          height: 1px;
          width: 100%;
          top: 50%;
          transform: translateY(-50%);
        }
        
        .reticle-dot {
          position: absolute;
          width: 8px;
          height: 8px;
          background: #06b6d4;
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 10px #06b6d4, 0 0 20px #06b6d4, 0 0 30px rgba(6, 182, 212, 0.5);
        }
        
        @keyframes pulse-expand {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        
        .accuracy-circle {
          animation: pulse-opacity 2s ease-in-out infinite;
        }
        
        @keyframes pulse-opacity {
          0%, 100% { opacity: 0.1; }
          50% { opacity: 0.2; }
        }
        
        .trail-line {
          filter: drop-shadow(0 0 4px rgba(6, 182, 212, 0.5));
        }
        
        .prediction-cone {
          filter: drop-shadow(0 0 8px rgba(234, 179, 8, 0.3));
        }
      `}</style>
    </div>
  );
};
