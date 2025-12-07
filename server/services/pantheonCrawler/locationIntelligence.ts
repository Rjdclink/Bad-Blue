/**
 * PANTHEON Location Intelligence Service
 * 
 * Aggregates location data from public social media sources
 * for real-time target tracking and historical reconstruction.
 * 
 * Features:
 * - GPS coordinate validation and parsing
 * - Haversine distance calculations
 * - Location clustering
 * - Reverse geocoding
 * - Multi-source aggregation
 */

import type { LocationPing, Target, LocationHistory, LocationSource } from './types';
import { logger } from '../../logger';

/**
 * Rate limiting tracker for each source
 */
interface RateLimitTracker {
  lastRequest: number;
  requestCount: number;
}

/**
 * GPS coordinates with validation
 */
export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  valid: boolean;
  error?: string;
}

/**
 * Location cluster for grouping nearby locations
 */
export interface LocationCluster {
  id: string;
  center: { latitude: number; longitude: number };
  locations: LocationPing[];
  radius: number; // in meters
  confidence: number;
  frequencyScore: number;
}

export class LocationIntelligenceService {
  private rateLimitTrackers: Record<string, RateLimitTracker> = {};
  
  /**
   * Validate GPS coordinates
   * 
   * @param lat - Latitude (-90 to 90)
   * @param lon - Longitude (-180 to 180)
   * @returns Validation result with error message if invalid
   */
  validateCoordinates(lat: number, lon: number): GPSCoordinates {
    const result: GPSCoordinates = {
      latitude: lat,
      longitude: lon,
      valid: true,
    };
    
    // Validate latitude
    if (typeof lat !== 'number' || isNaN(lat)) {
      result.valid = false;
      result.error = 'Latitude must be a valid number';
      return result;
    }
    
    if (lat < -90 || lat > 90) {
      result.valid = false;
      result.error = 'Latitude must be between -90 and 90 degrees';
      return result;
    }
    
    // Validate longitude
    if (typeof lon !== 'number' || isNaN(lon)) {
      result.valid = false;
      result.error = 'Longitude must be a valid number';
      return result;
    }
    
    if (lon < -180 || lon > 180) {
      result.valid = false;
      result.error = 'Longitude must be between -180 and 180 degrees';
      return result;
    }
    
    return result;
  }
  
  /**
   * Calculate distance between two GPS coordinates using Haversine formula
   * 
   * @param lat1 - Latitude of first point
   * @param lon1 - Longitude of first point
   * @param lat2 - Latitude of second point
   * @param lon2 - Longitude of second point
   * @returns Distance in meters
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    
    const φ1 = lat1 * Math.PI / 180; // Convert to radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    const distance = R * c; // Distance in meters
    return Math.round(distance);
  }
  
  /**
   * Parse GPS coordinates from various string formats
   * 
   * Supports formats:
   * - "40.7128, -74.0060" (decimal)
   * - "40.7128° N, 74.0060° W" (with degrees)
   * - "40°42'46\" N 74°00'22\" W" (DMS format)
   * 
   * @param coordString - String containing coordinates
   * @returns Parsed and validated coordinates
   */
  parseCoordinates(coordString: string): GPSCoordinates {
    try {
      // Remove extra whitespace
      const cleaned = coordString.trim();
      
      // Try decimal format first: "40.7128, -74.0060" or "40.7128,-74.0060"
      const decimalMatch = cleaned.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
      if (decimalMatch) {
        const lat = parseFloat(decimalMatch[1]);
        const lon = parseFloat(decimalMatch[2]);
        return this.validateCoordinates(lat, lon);
      }
      
      // Try with degree symbols: "40.7128° N, 74.0060° W"
      const degreeMatch = cleaned.match(/(-?\d+\.?\d*)°?\s*([NS])?,?\s*(-?\d+\.?\d*)°?\s*([EW])?/i);
      if (degreeMatch) {
        let lat = parseFloat(degreeMatch[1]);
        let lon = parseFloat(degreeMatch[3]);
        
        // Apply hemisphere
        if (degreeMatch[2] && degreeMatch[2].toUpperCase() === 'S') lat = -Math.abs(lat);
        if (degreeMatch[4] && degreeMatch[4].toUpperCase() === 'W') lon = -Math.abs(lon);
        
        return this.validateCoordinates(lat, lon);
      }
      
      // If no format matches
      return {
        latitude: 0,
        longitude: 0,
        valid: false,
        error: 'Unable to parse coordinate format',
      };
    } catch (error) {
      return {
        latitude: 0,
        longitude: 0,
        valid: false,
        error: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  
  /**
   * Cluster nearby locations together
   * 
   * Uses DBSCAN-like algorithm to group locations within a radius
   * 
   * @param locations - Array of location pings
   * @param radiusMeters - Maximum distance for clustering (default: 500m)
   * @returns Array of location clusters
   */
  clusterLocations(locations: LocationPing[], radiusMeters: number = 500): LocationCluster[] {
    if (locations.length === 0) return [];
    
    const clusters: LocationCluster[] = [];
    const visited = new Set<number>();
    
    for (let i = 0; i < locations.length; i++) {
      if (visited.has(i)) continue;
      
      const location = locations[i];
      const cluster: LocationPing[] = [location];
      visited.add(i);
      
      // Find all locations within radius
      for (let j = i + 1; j < locations.length; j++) {
        if (visited.has(j)) continue;
        
        const other = locations[j];
        const distance = this.calculateDistance(
          location.latitude,
          location.longitude,
          other.latitude,
          other.longitude
        );
        
        if (distance <= radiusMeters) {
          cluster.push(other);
          visited.add(j);
        }
      }
      
      // Calculate cluster center (mean of all points)
      const centerLat = cluster.reduce((sum, loc) => sum + loc.latitude, 0) / cluster.length;
      const centerLon = cluster.reduce((sum, loc) => sum + loc.longitude, 0) / cluster.length;
      
      // Calculate average confidence
      const avgConfidence = cluster.reduce((sum, loc) => sum + loc.confidence, 0) / cluster.length;
      
      // Frequency score: more visits = higher score
      const frequencyScore = Math.min(cluster.length / 10, 1) * 100;
      
      clusters.push({
        id: `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        center: { latitude: centerLat, longitude: centerLon },
        locations: cluster,
        radius: radiusMeters,
        confidence: avgConfidence,
        frequencyScore,
      });
    }
    
    // Sort by frequency (most visited first)
    clusters.sort((a, b) => b.locations.length - a.locations.length);
    
    return clusters;
  }
  
  /**
   * Perform reverse geocoding (coordinate to address)
   * 
   * Uses OpenStreetMap Nominatim API (free, no API key required)
   * Rate limited to 1 request per second per ToS
   * 
   * @param lat - Latitude
   * @param lon - Longitude
   * @returns Address information or error
   */
  async reverseGeocode(lat: number, lon: number): Promise<{
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    error?: string;
  }> {
    try {
      // Validate coordinates first
      const validation = this.validateCoordinates(lat, lon);
      if (!validation.valid) {
        return { error: validation.error };
      }
      
      // Rate limit to respect Nominatim ToS (1 req/sec)
      await this.rateLimit('nominatim', 1000);
      
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
      const headers = {
        'User-Agent': 'PANTHEON-LocationIntelligence/1.0',
        'Accept': 'application/json',
      };
      
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        logger.error(`[LocationIntel] Reverse geocoding failed: ${response.status} ${response.statusText}`);
        return { error: `Geocoding service returned ${response.status}: ${response.statusText}` };
      }
      
      const data = await response.json();
      
      if (data.error) {
        return { error: data.error };
      }
      
      const address = data.address || {};
      return {
        address: data.display_name || 'Unknown location',
        city: address.city || address.town || address.village || undefined,
        state: address.state || undefined,
        country: address.country || undefined,
      };
    } catch (error) {
      logger.error('[LocationIntel] Reverse geocoding error:', error);
      return { 
        error: error instanceof Error ? error.message : 'Reverse geocoding failed',
      };
    }
  }
  
  /**
   * Search for locations near a specific point
   * 
   * @param locations - All available locations
   * @param targetLat - Target latitude
   * @param targetLon - Target longitude
   * @param radiusMeters - Search radius in meters
   * @returns Locations within radius, sorted by distance
   */
  searchNearby(
    locations: LocationPing[],
    targetLat: number,
    targetLon: number,
    radiusMeters: number
  ): Array<LocationPing & { distance: number }> {
    const nearby: Array<LocationPing & { distance: number }> = [];
    
    for (const location of locations) {
      const distance = this.calculateDistance(
        targetLat,
        targetLon,
        location.latitude,
        location.longitude
      );
      
      if (distance <= radiusMeters) {
        nearby.push({
          ...location,
          distance,
        });
      }
    }
    
    // Sort by distance (closest first)
    nearby.sort((a, b) => a.distance - b.distance);
    
    return nearby;
  }
  
  /**
   * Scrape Instagram for geo-tagged content
   * 
   * IMPORTANT: This uses Instagram's public web interface.
   * Does NOT require authentication for public profiles.
   * Rate limited to avoid detection.
   * 
   * @param username - Instagram username to scrape
   * @returns Array of location pings from Instagram posts
   */
  async scrapeInstagramLocations(username: string): Promise<LocationPing[]> {
    const locations: LocationPing[] = [];
    
    try {
      // Validate username
      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        throw new Error('Invalid Instagram username');
      }
      
      // Sanitize username to prevent injection attacks
      // Instagram usernames only allow alphanumeric characters and underscores (no periods)
      const sanitizedUsername = username.trim().replace(/[^a-zA-Z0-9_]/g, '');
      if (sanitizedUsername !== username.trim()) {
        throw new Error('Username contains invalid characters');
      }
      
      // Rate limiting: Max 1 request per 5 seconds
      await this.rateLimit('instagram');
      
      logger.info(`[LocationIntel] Instagram scrape initiated for ${sanitizedUsername}`);
      
      // Note: This is a foundation for Instagram scraping
      // Full implementation would require:
      // 1. Fetch Instagram profile page (public web view)
      // 2. Parse JSON embedded in HTML (window._sharedData or __additionalDataLoaded)
      // 3. Extract posts with location tags
      // 4. For each location:
      //    - Get coordinates from Instagram location database or
      //    - Use reverse geocoding for location names
      //    - Extract timestamp from post
      //    - Calculate confidence based on data quality
      // 5. Return sorted by timestamp (newest first)
      
      // Placeholder warning
      logger.warn('[LocationIntel] Instagram scraping requires full implementation with Puppeteer/Playwright');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[LocationIntel] Instagram scrape failed for ${username}:`, errorMessage);
    }
    
    return locations;
  }
  
  /**
   * Aggregate all location sources for a target
   * 
   * Combines location data from all available social media sources
   * and calculates an overall confidence score.
   * 
   * @param target - Target profile with social media handles
   * @returns Aggregated location history with confidence score
   */
  async aggregateLocations(target: Target): Promise<LocationHistory> {
    const allLocations: LocationPing[] = [];
    
    try {
      // Instagram (implemented foundation)
      if (target.socialProfiles.instagram) {
        try {
          const igLocations = await this.scrapeInstagramLocations(
            target.socialProfiles.instagram
          );
          allLocations.push(...igLocations);
          logger.debug(`[LocationIntel] Added ${igLocations.length} Instagram locations for ${target.name}`);
        } catch (error) {
          logger.error(`[LocationIntel] Instagram aggregation failed for ${target.name}:`, error);
        }
      }
      
      // Future sources (placeholder for next passes):
      // - Facebook check-ins
      // - Twitter geotags
      // - TikTok locations
      // - Strava routes
      // - Photo EXIF data
      
      // Sort by timestamp (newest first)
      allLocations.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      // Calculate overall confidence
      const avgConfidence = allLocations.length > 0
        ? allLocations.reduce((sum, loc) => sum + loc.confidence, 0) / allLocations.length
        : 0;
      
      logger.info(`[LocationIntel] Aggregated ${allLocations.length} locations for ${target.name} (confidence: ${avgConfidence.toFixed(1)}%)`);
      
      return {
        targetId: target.id,
        locations: allLocations,
        lastUpdate: new Date(),
        confidence: avgConfidence,
      };
    } catch (error) {
      logger.error(`[LocationIntel] Location aggregation failed for ${target.name}:`, error);
      return {
        targetId: target.id,
        locations: [],
        lastUpdate: new Date(),
        confidence: 0,
      };
    }
  }
  
  /**
   * Rate limiting helper
   * 
   * Implements simple in-memory rate limiting to avoid detection.
   * Production should use Redis for multi-instance support.
   * 
   * @param source - The source being rate limited (e.g., 'instagram')
   * @param delayMs - Minimum delay between requests in milliseconds (default: 5000)
   */
  private async rateLimit(source: string, delayMs: number = 5000): Promise<void> {
    const now = Date.now();
    const tracker = this.rateLimitTrackers[source];
    
    if (!tracker) {
      // First request for this source
      this.rateLimitTrackers[source] = {
        lastRequest: now,
        requestCount: 1,
      };
      return;
    }
    
    // Calculate delay needed
    const timeSinceLastRequest = now - tracker.lastRequest;
    
    if (timeSinceLastRequest < delayMs) {
      const waitTime = delayMs - timeSinceLastRequest;
      logger.debug(`[LocationIntel] Rate limiting ${source}: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Update tracker
    tracker.lastRequest = Date.now();
    tracker.requestCount++;
  }
}

/**
 * Singleton instance for convenience
 */
export const locationIntelligence = new LocationIntelligenceService();
