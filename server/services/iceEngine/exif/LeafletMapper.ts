import { promises as fs } from 'fs';
import path from 'path';
import type { LocationData } from './ExifExtractor';

interface MapConfig {
  locations: LocationData[];
  caseId: string;
  outputPath: string;
}

export class LeafletMapper {
  async generateMapHTML(config: MapConfig): Promise<string> {
    const { locations, caseId } = config;

    if (locations.length === 0) {
      throw new Error('No locations to map');
    }

    const lats = locations.map(l => l.latitude);
    const lons = locations.map(l => l.longitude);
    const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2;
    const centerLon = (Math.max(...lons) + Math.min(...lons)) / 2;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Evidence Map - Case ${caseId}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
  <style>
    body { margin: 0; padding: 0; }
    #map { height: 100vh; width: 100vw; }
    .date-overlay {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(255,255,255,0.9);
      padding: 10px;
      border-radius: 5px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      z-index: 1000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }

  </style>
</head>
<body>
  <div class="date-overlay">
    <strong>Case ${caseId}</strong><br/>
    ${locations.length} Evidence Location(s)<br/>
    ${locations.map(l => `📍 ${l.timestamp.toLocaleDateString()}`).join('<br/>')}
  </div>
  <div id="map"></div>
  
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script>
    const map = L.map('map').setView([${centerLat}, ${centerLon}], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    const markers = L.markerClusterGroup();
    
    ${locations.map((loc, idx) => {
      const altitudeStr = loc.altitude ? `🏔️ ${loc.altitude}m<br/>` : '';
      const directionStr = loc.direction ? `🧭 ${loc.direction}°<br/>` : '';
      return `
      const marker${idx} = L.marker([${loc.latitude}, ${loc.longitude}])
        .bindPopup('<b>Evidence ${idx + 1}</b><br/>📅 ${loc.timestamp.toLocaleString()}<br/>📸 ${loc.device?.make || 'Unknown'} ${loc.device?.model || ''}<br/>📍 ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}<br/>${altitudeStr}${directionStr}<small>Uploaded by: ${loc.source.uploadedBy}</small>');
      markers.addLayer(marker${idx});
    `;
    }).join('\n')}

    map.addLayer(markers);
    
    const bounds = markers.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    window.mapReady = true;
  </script>
</body>
</html>`;

    const htmlPath = path.join(config.outputPath, `map-${caseId}.html`);
    await fs.mkdir(config.outputPath, { recursive: true });
    await fs.writeFile(htmlPath, html);

    return htmlPath;
  }
}

export const leafletMapper = new LeafletMapper();
