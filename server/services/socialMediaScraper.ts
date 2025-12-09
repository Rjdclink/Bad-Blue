/**
 * Social Media Scraper Service
 * 
 * Provides privacy-respecting Twitter/X scraping via Nitter instances
 * with automatic failover and circuit breaker pattern.
 * 
 * Nitter is a privacy-focused Twitter frontend that doesn't require authentication.
 */

import { logger } from '../logger';

const log = logger.child({ component: 'socialMediaScraper' });

/**
 * Nitter instance configuration
 */
interface NitterInstance {
  url: string;
  available: boolean;
  lastCheck: number;
  failureCount: number;
  circuitBreakerOpen: boolean;
}

/**
 * Twitter/X profile data from Nitter
 */
export interface TwitterProfile {
  username: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  joined?: Date;
  followers?: number;
  following?: number;
  tweets?: number;
  verified?: boolean;
  profileImageUrl?: string;
  bannerImageUrl?: string;
  success: boolean;
  source: string;
  error?: string;
}

/**
 * Social Media Scraper Service
 */
export class SocialMediaScraperService {
  // List of working Nitter instances (as of implementation)
  // These are public instances - check https://github.com/zedeus/nitter/wiki/Instances
  private nitterInstances: NitterInstance[] = [
    { url: 'https://nitter.net', available: true, lastCheck: 0, failureCount: 0, circuitBreakerOpen: false },
    { url: 'https://nitter.poast.org', available: true, lastCheck: 0, failureCount: 0, circuitBreakerOpen: false },
    { url: 'https://nitter.cz', available: true, lastCheck: 0, failureCount: 0, circuitBreakerOpen: false },
    { url: 'https://nitter.privacydev.net', available: true, lastCheck: 0, failureCount: 0, circuitBreakerOpen: false },
    { url: 'https://nitter.1d4.us', available: true, lastCheck: 0, failureCount: 0, circuitBreakerOpen: false },
  ];

  // Circuit breaker configuration
  private readonly MAX_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 300000; // 5 minutes
  private readonly REQUEST_TIMEOUT = 10000; // 10 seconds

  /**
   * Get Twitter profile via Nitter with automatic failover
   * 
   * @param username - Twitter username (without @)
   * @returns Profile data or error
   */
  async getTwitterProfile(username: string): Promise<TwitterProfile> {
    // Sanitize username
    const sanitizedUsername = username.trim().replace(/^@/, '');
    if (!sanitizedUsername || !/^[a-zA-Z0-9_]{1,15}$/.test(sanitizedUsername)) {
      return {
        username: sanitizedUsername,
        success: false,
        source: 'none',
        error: 'Invalid Twitter username format',
      };
    }

    // Try each instance until one succeeds
    for (const instance of this.getAvailableInstances()) {
      try {
        log.debug(`Attempting to fetch Twitter profile for @${sanitizedUsername} from ${instance.url}`);
        
        const profile = await this.fetchFromNitter(instance, sanitizedUsername);
        
        // Success - reset failure count
        this.recordSuccess(instance);
        
        log.info(`Successfully fetched Twitter profile for @${sanitizedUsername} from ${instance.url}`);
        return profile;
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.warn(`Nitter instance ${instance.url} failed for @${sanitizedUsername}: ${errorMessage}`);
        
        // Record failure and potentially open circuit breaker
        this.recordFailure(instance);
        
        // Continue to next instance
        continue;
      }
    }

    // All instances failed
    log.error(`All Nitter instances failed for @${sanitizedUsername}`);
    return {
      username: sanitizedUsername,
      success: false,
      source: 'none',
      error: 'All Nitter instances unavailable',
    };
  }

  /**
   * Fetch profile from specific Nitter instance
   */
  private async fetchFromNitter(instance: NitterInstance, username: string): Promise<TwitterProfile> {
    const url = `${instance.url}/${username}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        return {
          username,
          success: false,
          source: instance.url,
          error: 'Profile not found',
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      
      // Parse profile from HTML
      // Note: This is a simplified parser - production would use cheerio or similar
      const profile = this.parseNitterHTML(html, username, instance.url);
      
      return profile;

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }

  /**
   * Parse Nitter HTML to extract profile data
   */
  private parseNitterHTML(html: string, username: string, source: string): TwitterProfile {
    const profile: TwitterProfile = {
      username,
      success: true,
      source,
    };

    try {
      // Extract display name
      const displayNameMatch = html.match(/<title>([^(]+)\s*\(/);
      if (displayNameMatch) {
        profile.displayName = displayNameMatch[1].trim();
      }

      // Extract bio
      const bioMatch = html.match(/<div class="profile-bio[^"]*">([^<]*)<\/div>/);
      if (bioMatch) {
        profile.bio = bioMatch[1].trim();
      }

      // Extract location
      const locationMatch = html.match(/<div class="profile-location[^"]*">([^<]*)<\/div>/);
      if (locationMatch) {
        profile.location = locationMatch[1].trim();
      }

      // Extract follower/following counts
      const followersMatch = html.match(/<span class="profile-stat-num">([0-9,KM]+)<\/span>\s*<span class="profile-stat-header">Followers/i);
      if (followersMatch) {
        profile.followers = this.parseStatNumber(followersMatch[1]);
      }

      const followingMatch = html.match(/<span class="profile-stat-num">([0-9,KM]+)<\/span>\s*<span class="profile-stat-header">Following/i);
      if (followingMatch) {
        profile.following = this.parseStatNumber(followingMatch[1]);
      }

      const tweetsMatch = html.match(/<span class="profile-stat-num">([0-9,KM]+)<\/span>\s*<span class="profile-stat-header">Tweets/i);
      if (tweetsMatch) {
        profile.tweets = this.parseStatNumber(tweetsMatch[1]);
      }

    } catch (error) {
      log.warn(`Error parsing Nitter HTML: ${error}`);
    }

    return profile;
  }

  /**
   * Parse stat numbers (e.g., "1.2K" -> 1200)
   */
  private parseStatNumber(stat: string): number {
    const cleaned = stat.replace(/,/g, '');
    
    if (cleaned.endsWith('K')) {
      return parseFloat(cleaned) * 1000;
    }
    if (cleaned.endsWith('M')) {
      return parseFloat(cleaned) * 1000000;
    }
    
    return parseInt(cleaned, 10);
  }

  /**
   * Get available Nitter instances (circuit breaker not open)
   */
  private getAvailableInstances(): NitterInstance[] {
    const now = Date.now();
    
    return this.nitterInstances
      .filter(instance => {
        // Check if circuit breaker should be reset
        if (instance.circuitBreakerOpen) {
          if (now - instance.lastCheck > this.CIRCUIT_BREAKER_TIMEOUT) {
            // Reset circuit breaker after timeout
            instance.circuitBreakerOpen = false;
            instance.failureCount = 0;
            log.info(`Circuit breaker reset for ${instance.url}`);
          } else {
            log.debug(`Circuit breaker still open for ${instance.url}`);
            return false;
          }
        }
        
        return instance.available;
      })
      .sort((a, b) => a.failureCount - b.failureCount); // Prioritize instances with fewer failures
  }

  /**
   * Record successful request
   */
  private recordSuccess(instance: NitterInstance): void {
    instance.failureCount = 0;
    instance.available = true;
    instance.lastCheck = Date.now();
    
    if (instance.circuitBreakerOpen) {
      instance.circuitBreakerOpen = false;
      log.info(`Circuit breaker closed for ${instance.url} after successful request`);
    }
  }

  /**
   * Record failed request and potentially open circuit breaker
   */
  private recordFailure(instance: NitterInstance): void {
    instance.failureCount++;
    instance.lastCheck = Date.now();

    if (instance.failureCount >= this.MAX_FAILURES && !instance.circuitBreakerOpen) {
      instance.circuitBreakerOpen = true;
      log.error(`Circuit breaker opened for ${instance.url} after ${instance.failureCount} failures`);
    }
  }

  /**
   * Get status of all Nitter instances
   */
  getInstancesStatus(): Array<{
    url: string;
    available: boolean;
    failureCount: number;
    circuitBreakerOpen: boolean;
  }> {
    return this.nitterInstances.map(instance => ({
      url: instance.url,
      available: instance.available,
      failureCount: instance.failureCount,
      circuitBreakerOpen: instance.circuitBreakerOpen,
    }));
  }

  /**
   * Manually mark an instance as unavailable
   */
  markInstanceUnavailable(url: string): void {
    const instance = this.nitterInstances.find(i => i.url === url);
    if (instance) {
      instance.available = false;
      log.warn(`Manually marked ${url} as unavailable`);
    }
  }

  /**
   * Manually mark an instance as available
   */
  markInstanceAvailable(url: string): void {
    const instance = this.nitterInstances.find(i => i.url === url);
    if (instance) {
      instance.available = true;
      instance.failureCount = 0;
      instance.circuitBreakerOpen = false;
      log.info(`Manually marked ${url} as available`);
    }
  }
}

/**
 * Singleton instance
 */
export const socialMediaScraper = new SocialMediaScraperService();
