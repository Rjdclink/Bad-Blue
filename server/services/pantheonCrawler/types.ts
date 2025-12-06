/**
 * PANTHEON Location Intelligence - Type Definitions
 * 
 * Defines core interfaces for tracking and aggregating location data
 * from public social media sources for legitimate security research,
 * threat intelligence, and authorized investigations.
 */

/**
 * A single location ping from a social media source
 */
export interface LocationPing {
  latitude: number;
  longitude: number;
  accuracy: number;          // meters
  timestamp: Date;
  source: LocationSource;
  sourceUrl?: string;
  confidence: number;        // 0-100
  metadata?: Record<string, any>;
}

/**
 * Supported location data sources
 * 
 * - instagram: Instagram geotags and check-ins
 * - facebook: Facebook check-ins and places
 * - twitter: Twitter geotags
 * - tiktok: TikTok location tags
 * - strava: Strava activity routes and segments
 * - photo_exif: GPS coordinates from photo EXIF data
 * - check_in: Generic check-in services
 * - predicted: AI-predicted locations based on patterns
 */
export type LocationSource = 
  | 'instagram' 
  | 'facebook' 
  | 'twitter' 
  | 'tiktok'
  | 'strava'
  | 'photo_exif'
  | 'check_in'
  | 'predicted';

/**
 * Target profile for location tracking
 */
export interface Target {
  id: string;
  name: string;
  socialProfiles: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
    tiktok?: string;
  };
  knownLocations: {
    home?: { lat: number; lon: number };
    work?: { lat: number; lon: number };
  };
}

/**
 * Historical location data for a target
 */
export interface LocationHistory {
  targetId: string;
  locations: LocationPing[];
  lastUpdate: Date;
  confidence: number;
}
