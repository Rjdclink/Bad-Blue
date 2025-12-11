import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';

interface HeatmapProps {
  data: Array<[number, number, number]>;
  markers?: Array<{ pos: [number, number]; popup: string }>;
  center?: [number, number];
  zoom?: number;
  config?: { radius?: number; blur?: number; maxZoom?: number };
  satelliteView?: boolean;
}

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

  const { radius = 25, blur = 15, maxZoom = 18 } = config;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(center, zoom);
    
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

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

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
  }, [data, markers, radius, blur, maxZoom]);

  return <div ref={containerRef} style={{ width: '100%', height: '600px', borderRadius: 8 }} />;
};
