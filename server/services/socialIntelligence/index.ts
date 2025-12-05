/**
 * PANTHEON Social Intelligence - Main Integration Service
 * Integrates Sherlock engine with the rest of the system
 */

import { sherlockEngine } from './sherlockEngine';
import { profileExtractor } from './profileExtractor';
import { usernameValidator } from './usernameValidator';
import type { SherlockResult, SherlockSearchOptions } from './types';
import { logger } from '../../logger';

const log = logger.child({ component: 'socialIntelligence:service' });

interface EnrichedProfile {
  name: string;
  socialProfiles: SherlockResult[];
  confidence: number;
  summary: string;
}

export class SocialIntelligenceService {
  private sherlock = sherlockEngine;
  private extractor = profileExtractor;
  private validator = usernameValidator;

  /**
   * Find user across all platforms
   */
  async findUserAcrossPlatforms(
    username: string,
    options?: Partial<SherlockSearchOptions>
  ): Promise<SherlockResult[]> {
    log.info('Finding user across platforms', { username });

    const results = await this.sherlock.searchUsername(username, {
      stealth: true,
      includeProfileData: true,
      concurrency: 10,
      ...options,
    });

    // Filter to only existing profiles
    const existingProfiles = results.filter((r) => r.exists);

    log.info('User search completed', {
      username,
      totalSearched: results.length,
      found: existingProfiles.length,
    });

    return existingProfiles;
  }

  /**
   * Enrich a person profile with social media data
   */
  async enrichPersonProfile(person: {
    name: string;
    possibleUsernames: string[];
  }): Promise<EnrichedProfile> {
    log.info('Enriching person profile', {
      name: person.name,
      usernames: person.possibleUsernames.length,
    });

    const allProfiles: SherlockResult[] = [];

    // Search all possible usernames
    for (const username of person.possibleUsernames) {
      const profiles = await this.findUserAcrossPlatforms(username, {
        concurrency: 10,
        includeProfileData: true,
      });
      allProfiles.push(...profiles);
    }

    // Remove duplicates (same platform + username)
    const uniqueProfiles = this.deduplicateProfiles(allProfiles);

    // Calculate confidence based on number of platforms found
    const confidence = this.calculateProfileConfidence(
      uniqueProfiles,
      person.possibleUsernames.length
    );

    // Generate summary
    const summary = this.generateProfileSummary(person.name, uniqueProfiles);

    return {
      name: person.name,
      socialProfiles: uniqueProfiles,
      confidence,
      summary,
    };
  }

  /**
   * Discover related accounts based on known account
   * Uses profile data to find similar usernames or linked accounts
   */
  async discoverRelatedAccounts(
    knownAccount: SherlockResult
  ): Promise<SherlockResult[]> {
    log.info('Discovering related accounts', {
      platform: knownAccount.platform,
      username: knownAccount.username,
    });

    // Extract potential related usernames from profile data
    const relatedUsernames: string[] = [];

    // Use display name as potential username
    if (knownAccount.profileData?.displayName) {
      const sanitized = this.validator.sanitize(
        knownAccount.profileData.displayName.toLowerCase().replace(/\s+/g, '')
      );
      if (sanitized) relatedUsernames.push(sanitized);
    }

    // Search for related usernames
    const relatedProfiles: SherlockResult[] = [];
    for (const username of relatedUsernames) {
      if (username === knownAccount.username) continue;
      
      const profiles = await this.findUserAcrossPlatforms(username, {
        concurrency: 10,
      });
      relatedProfiles.push(...profiles);
    }

    return this.deduplicateProfiles(relatedProfiles);
  }

  /**
   * Validate username for a platform
   */
  validateUsername(username: string, platform?: string) {
    return this.validator.validate(username, platform);
  }

  /**
   * Get all supported platforms
   */
  getSupportedPlatforms(): string[] {
    return this.sherlock.getSupportedPlatforms();
  }

  /**
   * Get platform count
   */
  getPlatformCount(): number {
    return this.sherlock.getPlatformCount();
  }

  /**
   * Remove duplicate profiles
   */
  private deduplicateProfiles(profiles: SherlockResult[]): SherlockResult[] {
    const seen = new Set<string>();
    return profiles.filter((profile) => {
      const key = `${profile.platform}:${profile.username}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Calculate confidence score for enriched profile
   */
  private calculateProfileConfidence(
    profiles: SherlockResult[],
    usernameCount: number
  ): number {
    if (profiles.length === 0) return 0;

    // Base confidence on number of platforms found
    const platformScore = Math.min(profiles.length / 10, 1) * 0.5;

    // Bonus for high-confidence detections
    const highConfidence = profiles.filter((p) => p.confidence === 'high').length;
    const confidenceScore = Math.min(highConfidence / 5, 1) * 0.3;

    // Bonus for profile data
    const withProfileData = profiles.filter((p) => p.profileData).length;
    const dataScore = Math.min(withProfileData / 5, 1) * 0.2;

    return Math.round((platformScore + confidenceScore + dataScore) * 100);
  }

  /**
   * Generate human-readable summary
   */
  private generateProfileSummary(
    name: string,
    profiles: SherlockResult[]
  ): string {
    if (profiles.length === 0) {
      return `No social media profiles found for ${name}.`;
    }

    const platforms = profiles.map((p) => p.platform).join(', ');
    const count = profiles.length;

    return `Found ${count} social media profile${count > 1 ? 's' : ''} for ${name} on: ${platforms}.`;
  }
}

export const socialIntelligenceService = new SocialIntelligenceService();
