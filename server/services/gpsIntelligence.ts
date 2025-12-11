import * as ExifReader from 'exifreader';
import { createLogger } from '../logger';

const log = createLogger('GPSIntelligence');

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp?: Date;
  accuracy?: number;
  device?: string;
}

export interface LocationCluster {
  center: { lat: number; lng: number };
  radius: number;
  pointCount: number;
  points: GPSCoordinates[];
  frequencyScore: number;
}

export interface GeoHeatmap {
  clusters: LocationCluster[];
  boundingBox: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  totalPoints: number;
}

/**
 * Extract GPS coordinates from image/video EXIF data
 */
export async function extractGPSFromFile(filePath: string): Promise<GPSCoordinates | null> {
  try {
    const tags = await ExifReader.load(filePath);
    
    if (!tags.GPSLatitude || !tags.GPSLongitude) {
      return null;
    }
    
    const latitudeRef = tags.GPSLatitudeRef?.value;
    const longitudeRef = tags.GPSLongitudeRef?.value;
    
    const latitudeDesc = tags.GPSLatitude.description;
    const longitudeDesc = tags.GPSLongitude.description;
    
    if (typeof latitudeDesc !== 'string' || typeof longitudeDesc !== 'string') {
      return null;
    }
    
    const latRefStr = Array.isArray(latitudeRef) ? latitudeRef[0] : latitudeRef;
    const lonRefStr = Array.isArray(longitudeRef) ? longitudeRef[0] : longitudeRef;
    
    const latitude = parseGPSCoordinate(
      latitudeDesc, 
      typeof latRefStr === 'string' ? latRefStr : undefined
    );
    const longitude = parseGPSCoordinate(
      longitudeDesc, 
      typeof lonRefStr === 'string' ? lonRefStr : undefined
    );
    
    if (!latitude || !longitude) return null;
    
    return {
      latitude,
      longitude,
      altitude: tags.GPSAltitude?.description ? parseFloat(tags.GPSAltitude.description) : undefined,
      timestamp: tags.DateTimeOriginal?.description ? new Date(tags.DateTimeOriginal.description) : undefined,
      device: tags.Make?.description && tags.Model?.description 
        ? `${tags.Make.description} ${tags.Model.description}` 
        : undefined,
      accuracy: tags.GPSHPositioningError?.description ? parseFloat(tags.GPSHPositioningError.description) : undefined
    };
  } catch (error) {
    log.error('GPS extraction failed', error);
    return null;
  }
}

/**
 * Parse GPS coordinate from EXIF format (degrees, minutes, seconds)
 */
function parseGPSCoordinate(coordinate: string, ref: string | undefined): number | null {
  try {
    const parts = coordinate.split(',').map(p => parseFloat(p.trim()));
    if (parts.length !== 3) return null;
    
    let decimal = parts[0] + parts[1] / 60 + parts[2] / 3600;
    if (ref === 'S' || ref === 'W') decimal *= -1;
    
    return decimal;
  } catch {
    return null;
  }
}

/**
 * Haversine formula: Calculate distance between two GPS points (in meters)
 */
export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Cluster GPS points using DBSCAN algorithm
 * @param points Array of GPS coordinates
 * @param epsilon Maximum distance between points in cluster (meters)
 * @param minPoints Minimum points to form cluster
 */
export function clusterLocations(
  points: GPSCoordinates[],
  epsilon: number = 100,
  minPoints: number = 2
): LocationCluster[] {
  const clusters: LocationCluster[] = [];
  const visited = new Set<number>();
  const clustered = new Set<number>();

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const neighbors = findNeighbors(points, i, epsilon);
    
    if (neighbors.length >= minPoints) {
      const cluster = expandCluster(points, i, neighbors, epsilon, visited, clustered, minPoints);
      if (cluster.length > 0) {
        clusters.push(createCluster(cluster));
      }
    }
  }

  return clusters.sort((a, b) => b.frequencyScore - a.frequencyScore);
}

function findNeighbors(points: GPSCoordinates[], index: number, epsilon: number): number[] {
  const neighbors: number[] = [];
  const point = points[index];

  for (let i = 0; i < points.length; i++) {
    if (i === index) continue;
    const distance = calculateDistance(
      point.latitude, point.longitude,
      points[i].latitude, points[i].longitude
    );
    if (distance <= epsilon) {
      neighbors.push(i);
    }
  }

  return neighbors;
}

function expandCluster(
  points: GPSCoordinates[],
  index: number,
  neighbors: number[],
  epsilon: number,
  visited: Set<number>,
  clustered: Set<number>,
  minPoints: number
): GPSCoordinates[] {
  const cluster = [points[index]];
  clustered.add(index);

  for (const neighborIndex of neighbors) {
    if (!visited.has(neighborIndex)) {
      visited.add(neighborIndex);
      const newNeighbors = findNeighbors(points, neighborIndex, epsilon);
      if (newNeighbors.length >= minPoints) {
        neighbors.push(...newNeighbors);
      }
    }
    if (!clustered.has(neighborIndex)) {
      cluster.push(points[neighborIndex]);
      clustered.add(neighborIndex);
    }
  }

  return cluster;
}

function createCluster(points: GPSCoordinates[]): LocationCluster {
  const center = {
    lat: points.reduce((sum, p) => sum + p.latitude, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.longitude, 0) / points.length
  };

  const distances = points.map(p => 
    calculateDistance(center.lat, center.lng, p.latitude, p.longitude)
  );
  const radius = Math.max(...distances);

  return {
    center,
    radius,
    pointCount: points.length,
    points,
    frequencyScore: points.length * (1 / (radius + 1))
  };
}

/**
 * Generate heatmap from GPS points
 */
export function generateHeatmap(points: GPSCoordinates[]): GeoHeatmap {
  if (points.length === 0) {
    return {
      clusters: [],
      boundingBox: { north: 0, south: 0, east: 0, west: 0 },
      totalPoints: 0
    };
  }

  const clusters = clusterLocations(points);
  
  const lats = points.map(p => p.latitude);
  const lngs = points.map(p => p.longitude);

  return {
    clusters,
    boundingBox: {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs)
    },
    totalPoints: points.length
  };
}

/**
 * Search points within radius of location
 */
export function searchWithinRadius(
  points: GPSCoordinates[],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): GPSCoordinates[] {
  return points.filter(point =>
    calculateDistance(centerLat, centerLng, point.latitude, point.longitude) <= radiusMeters
  );
}
