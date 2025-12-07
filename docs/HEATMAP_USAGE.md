# Interactive Heatmap Dashboard

Real-time location intelligence visualization.

## Features

- **Interactive Leaflet Map** - Pan, zoom, click markers
- **Heat Layer** - Density-based visualization
- **Timeline Scrubber** - Temporal analysis
- **Cluster Markers** - Frequency-based grouping

## Usage

```typescript
import { LocationHeatmap } from './components/LocationHeatmap';

<LocationHeatmap
  data={[[40.7128, -74.0060, 0.8], [40.7580, -73.9855, 0.5]]}
  markers={[{ pos: [40.7128, -74.0060], popup: 'NYC' }]}
  center={[40.7128, -74.0060]}
  zoom={12}
  config={{ radius: 25, blur: 15 }}
/>
```

## Legal Notice

This tool visualizes **public data only** for legal OSINT research, skip tracing, and investigative journalism.
