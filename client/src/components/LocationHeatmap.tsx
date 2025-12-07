import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';

interface HeatmapProps {
  data: Array<[number, number, number]>;
  markers?: Array<{ pos: [number, number]; popup: string }>;
  center?: [number, number];
  zoom?: number;
  config?: { radius?: number; blur?: number; maxZoom?: number };
}

export const LocationHeatmap: React.FC<HeatmapProps> = ({
  data,
  markers = [],
  center = [40.7128, -74.0060],
  zoom = 12,
  config = {},
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { radius = 25, blur = 15, maxZoom = 18 } = config;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing layers
    mapRef.current.eachLayer(l => {
      if (l instanceof L.HeatLayer || l instanceof L.Marker) mapRef.current!.removeLayer(l);
    });

    // Add heatmap
    if (data.length) {
      (L as any).heatLayer(data, { radius, blur, maxZoom }).addTo(mapRef.current);
      const bounds = L.latLngBounds(data.map(d => [d[0], d[1]]));
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }

    // Add markers
    markers.forEach(m => L.marker(m.pos).bindPopup(m.popup).addTo(mapRef.current!));
  }, [data, markers, radius, blur, maxZoom]);

  return <div ref={containerRef} style={{ width: '100%', height: '600px', borderRadius: 8 }} />;
};
