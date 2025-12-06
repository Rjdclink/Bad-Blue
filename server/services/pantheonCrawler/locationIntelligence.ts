/**
 * PANTHEON Location Intelligence Service
 * 
 * Aggregates location data from public social media sources
 * for real-time target tracking and historical reconstruction.
 * 
 * PASS 0.1 Implementation: Instagram geotag scraping foundation
 */

import type { LocationPing, Target, LocationHistory, LocationSource } from './types';

/**
 * Rate limiting tracker for each source
 */
interface RateLimitTracker {
  lastRequest: number;
  requestCount: number;
}

export class LocationIntelligenceService {
  private rateLimitTrackers: Record<string, RateLimitTracker> = {};
  
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
      // Instagram usernames only allow alphanumeric characters and underscores
      const sanitizedUsername = username.trim().replace(/[^a-zA-Z0-9_]/g, '');
      if (sanitizedUsername !== username.trim()) {
        throw new Error('Username contains invalid characters');
      }
      
      // Implementation requirements:
      // 1. Fetch Instagram profile page (public web view)
      // 2. Parse JSON embedded in HTML (window._sharedData)
      // 3. Extract posts with location tags
      // 4. For each location:
      //    - Get coordinates from Instagram location database
      //    - Extract timestamp from post
      //    - Calculate confidence based on data quality
      // 5. Return sorted by timestamp (newest first)
      
      // TODO: Implement actual scraping logic
      // Use fetch with proper headers to avoid detection:
      // const headers = {
      //   'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      //   'Accept': 'text/html,application/xhtml+xml',
      //   'Accept-Language': 'en-US,en;q=0.9',
      // };
      
      // Rate limiting: Max 1 request per 5 seconds
      await this.rateLimit('instagram');
      
      // For now, return empty array as foundation
      
      console.log(`[LocationIntel] Instagram scrape initiated for ${sanitizedUsername}`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[LocationIntel] Instagram scrape failed for ${username}:`, errorMessage);
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
    
    // Instagram (implemented in this pass)
    if (target.socialProfiles.instagram) {
      const igLocations = await this.scrapeInstagramLocations(
        target.socialProfiles.instagram
      );
      allLocations.push(...igLocations);
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
    
    return {
      targetId: target.id,
      locations: allLocations,
      lastUpdate: new Date(),
      confidence: avgConfidence,
    };
  }
  
  /**
   * Rate limiting helper
   * 
   * Implements simple in-memory rate limiting to avoid detection.
   * Production should use Redis for multi-instance support.
   * 
   * @param source - The source being rate limited (e.g., 'instagram')
   */
  private async rateLimit(source: string): Promise<void> {
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
    const delay = 5000; // 5 seconds between requests
    
    if (timeSinceLastRequest < delay) {
      const waitTime = delay - timeSinceLastRequest;
      console.log(`[LocationIntel] Rate limiting ${source}: waiting ${waitTime}ms`);
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
