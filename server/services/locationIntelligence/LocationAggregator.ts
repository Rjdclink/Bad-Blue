import { ExifLocation } from './ExifToolExtractor';

// Confidence scores for different location sources
const EXIF_DEFAULT_CONFIDENCE = 0.85;
const PUBLIC_RECORD_DEFAULT_CONFIDENCE = 0.95;

// Haversine formula constant
const EARTH_RADIUS_METERS = 6371e3;

// Heatmap intensity normalizer: dividing by 10 produces a 0-1 scale for typical cluster sizes
const HEATMAP_INTENSITY_NORMALIZER = 10;

interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp?: Date;
  source: 'exif' | 'social_media' | 'court_record' | 'property' | 'voter' | 'business';
  confidence: number;
  metadata?: Record<string, unknown>;
}

interface ClusteredLocation {
  latitude: number;
  longitude: number;
  occurrences: number;
  confidence: number;
  sources: string[];
  firstSeen?: Date;
  lastSeen?: Date;
  radiusMeters: number;
}

export class LocationAggregator {
  private points: LocationPoint[] = [];

  addExifLocation(location: ExifLocation) {
    this.points.push({
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: location.timestamp,
      source: 'exif',
      confidence: EXIF_DEFAULT_CONFIDENCE,
      metadata: { altitude: location.altitude, file: location.source },
    });
  }

  addPublicRecord(point: Omit<LocationPoint, 'confidence'> & { confidence?: number }) {
    this.points.push({
      ...point,
      confidence: point.confidence || PUBLIC_RECORD_DEFAULT_CONFIDENCE,
    });
  }

  cluster(radiusMeters: number = 100): ClusteredLocation[] {
    if (this.points.length === 0) return [];

    const clusters: ClusteredLocation[] = [];

    for (const point of this.points) {
      let cluster = clusters.find(c =>
        this.distance(c.latitude, c.longitude, point.latitude, point.longitude) <= radiusMeters
      );

      if (cluster) {
        const total = cluster.occurrences + 1;
        cluster.latitude = (cluster.latitude * cluster.occurrences + point.latitude) / total;
        cluster.longitude = (cluster.longitude * cluster.occurrences + point.longitude) / total;
        cluster.occurrences = total;
        cluster.confidence = Math.max(cluster.confidence, point.confidence);
        if (!cluster.sources.includes(point.source)) {
          cluster.sources.push(point.source);
        }

        if (point.timestamp) {
          if (!cluster.firstSeen || point.timestamp < cluster.firstSeen) {
            cluster.firstSeen = point.timestamp;
          }
          if (!cluster.lastSeen || point.timestamp > cluster.lastSeen) {
            cluster.lastSeen = point.timestamp;
          }
        }
      } else {
        clusters.push({
          latitude: point.latitude,
          longitude: point.longitude,
          occurrences: 1,
          confidence: point.confidence,
          sources: [point.source],
          firstSeen: point.timestamp,
          lastSeen: point.timestamp,
          radiusMeters,
        });
      }
    }

    return clusters.sort((a, b) => b.occurrences - a.occurrences);
  }

  getTimeline(): Array<{ timestamp: Date; latitude: number; longitude: number }> {
    return this.points
      .filter((p): p is LocationPoint & { timestamp: Date } => p.timestamp !== undefined)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(p => ({
        timestamp: p.timestamp,
        latitude: p.latitude,
        longitude: p.longitude,
      }));
  }

  getHeatmapData(): Array<[number, number, number]> {
    const clustered = this.cluster(50);
    return clustered.map(c => [
      c.latitude,
      c.longitude,
      Math.min(c.occurrences / HEATMAP_INTENSITY_NORMALIZER, 1.0),
    ]);
  }

  private toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
  }

  private distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = this.toRadians(lat1);
    const φ2 = this.toRadians(lat2);
    const Δφ = this.toRadians(lat2 - lat1);
    const Δλ = this.toRadians(lon2 - lon1);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  clear() {
    this.points = [];
  }

  getStats() {
    const timestamps = this.points.filter(p => p.timestamp).map(p => p.timestamp!);
    return {
      totalPoints: this.points.length,
      sources: [...new Set(this.points.map(p => p.source))],
      dateRange: timestamps.length > 0 ? {
        earliest: new Date(Math.min(...timestamps.map(d => d.getTime()))),
        latest: new Date(Math.max(...timestamps.map(d => d.getTime()))),
      } : null,
    };
  }
}

export const locationAggregator = new LocationAggregator();
