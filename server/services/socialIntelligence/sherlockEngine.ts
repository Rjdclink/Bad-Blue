/**
 * PANTHEON Social Intelligence - Sherlock Engine
 * Core username search engine across 120+ platforms
 */

import type {
  SherlockResult,
  SherlockSearchOptions,
  SherlockDatabase,
  SherlockSite,
} from './types';
import { usernameValidator } from './usernameValidator';
import { profileExtractor } from './profileExtractor';
import { shadowRetrieval } from '../../services/shadowRetrieval';
import { logger } from '../../logger';
import sherlockSites from './sherlockSites.json';

const log = logger.child({ component: 'socialIntelligence:sherlockEngine' });
const database = sherlockSites as SherlockDatabase;

interface SearchTask {
  platform: string;
  site: SherlockSite;
  username: string;
}

export class SherlockEngine {
  private defaultOptions: Required<SherlockSearchOptions> = {
    concurrency: 10,
    timeout: 10000,
    includeProfileData: false,
    platforms: [],
    stealth: true,
    retries: 2,
  };

  /**
   * Search for username across all or specified platforms
   */
  async searchUsername(
    username: string,
    options: Partial<SherlockSearchOptions> = {}
  ): Promise<SherlockResult[]> {
    const opts = { ...this.defaultOptions, ...options };

    // Validate username
    const validation = usernameValidator.validate(username);
    if (!validation.valid) {
      log.warn('Invalid username', { username, reason: validation.reason });
      return [];
    }

    // Get platforms to search
    const platformsToSearch = opts.platforms.length > 0
      ? opts.platforms.filter((p) => database.sites[p])
      : Object.keys(database.sites);

    log.info('Starting username search', {
      username,
      platformCount: platformsToSearch.length,
      concurrency: opts.concurrency,
    });

    // Create search tasks
    const tasks: SearchTask[] = platformsToSearch.map((platform) => ({
      platform,
      site: database.sites[platform],
      username,
    }));

    // Execute searches with concurrency control
    const results = await this.executeConcurrent(tasks, opts);

    log.info('Username search completed', {
      username,
      total: results.length,
      found: results.filter((r) => r.exists).length,
    });

    return results;
  }

  /**
   * Search multiple usernames in batch
   */
  async searchMultipleUsernames(
    usernames: string[],
    options: Partial<SherlockSearchOptions> = {}
  ): Promise<Map<string, SherlockResult[]>> {
    const results = new Map<string, SherlockResult[]>();

    for (const username of usernames) {
      const usernameResults = await this.searchUsername(username, options);
      results.set(username, usernameResults);
    }

    return results;
  }

  /**
   * Search for username on a specific platform
   */
  async searchPlatform(username: string, platform: string): Promise<SherlockResult> {
    const site = database.sites[platform];
    if (!site) {
      return {
        platform,
        username,
        url: '',
        exists: false,
        confidence: 'low',
        retrievedAt: new Date(),
        error: 'Platform not found',
      };
    }

    // Validate username for platform
    const validation = usernameValidator.validate(username, platform);
    if (!validation.valid) {
      return {
        platform,
        username,
        url: (site.url || '').replace('{}', username || ''),
        exists: false,
        confidence: 'low',
        retrievedAt: new Date(),
        error: validation.reason,
      };
    }

    const task: SearchTask = { platform, site, username };
    return this.executeSearch(task, this.defaultOptions);
  }

  /**
   * Execute searches with concurrency control
   */
  private async executeConcurrent(
    tasks: SearchTask[],
    options: Required<SherlockSearchOptions>
  ): Promise<SherlockResult[]> {
    const results: SherlockResult[] = [];
    const executing: Set<Promise<void>> = new Set();

    for (const task of tasks) {
      const promise = this.executeSearch(task, options).then((result) => {
        results.push(result);
        executing.delete(promise);
      });

      executing.add(promise);

      if (executing.size >= options.concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Execute single platform search
   */
  private async executeSearch(
    task: SearchTask,
    options: Required<SherlockSearchOptions>
  ): Promise<SherlockResult> {
    const { platform, site, username } = task;
    const url = (site.url || '').replace('{}', username || '');
    const probeUrl = site.urlProbe ? (site.urlProbe || '').replace('{}', username || '') : url;

    const result: SherlockResult = {
      platform,
      username,
      url,
      exists: false,
      confidence: 'low',
      retrievedAt: new Date(),
    };

    try {
      // Use Shadow Retrieval if stealth enabled
      let response: any;
      let html: string = '';

      if (options.stealth) {
        const retrievalResult = await shadowRetrieval.smartRetrieve(probeUrl, {
          timeout: options.timeout,
        });

        if (!retrievalResult.success) {
          result.error = 'Failed to retrieve page';
          return result;
        }

        html = retrievalResult.data?.html || '';
        response = {
          status: retrievalResult.metadata.statusCode || 200,
          body: html,
        };
      } else {
        // Fallback to simple fetch (not recommended)
        const fetchResponse = await fetch(probeUrl, {
          signal: AbortSignal.timeout(options.timeout),
        });
        response = {
          status: fetchResponse.status,
          body: await fetchResponse.text(),
        };
        html = response.body;
      }

      // Detect username existence based on error type
      const exists = this.detectExistence(response, html, site);
      result.exists = exists;
      result.confidence = this.calculateConfidence(site.errorType, exists);
      result.method = site.errorType;

      // Extract profile data if requested and user exists
      if (exists && options.includeProfileData && html) {
        try {
          const profileData = await profileExtractor.extract(html, platform);
          if (Object.keys(profileData).length > 0) {
            result.profileData = profileData as any;
          }
        } catch (error: any) {
          log.debug('Failed to extract profile data', {
            platform,
            error: error.message,
          });
        }
      }
    } catch (error: any) {
      log.debug('Search failed for platform', {
        platform,
        username,
        error: error.message,
      });
      result.error = error.message;
    }

    return result;
  }

  /**
   * Detect if username exists based on site configuration
   */
  private detectExistence(response: any, html: string, site: SherlockSite): boolean {
    switch (site.errorType) {
      case 'status_code':
        // 200 = exists, 404/403/410 = not found
        return response.status === 200;

      case 'message':
        // Check if error messages are present
        if (!site.errorMsg || !html) return false;
        const hasErrorMsg = site.errorMsg.some((msg) =>
          html.includes(msg)
        );
        return !hasErrorMsg; // Exists if NO error message found

      case 'response_url':
        // Some sites redirect to homepage if user not found
        // This would need the actual response URL from the request
        return response.status === 200;

      default:
        return false;
    }
  }

  /**
   * Calculate confidence score based on detection method
   */
  private calculateConfidence(
    errorType: string,
    exists: boolean
  ): 'high' | 'medium' | 'low' {
    if (!exists) return 'low';

    switch (errorType) {
      case 'status_code':
        return 'high'; // Most reliable
      case 'message':
        return 'medium'; // Can have false positives
      case 'response_url':
        return 'medium'; // Depends on redirect detection
      default:
        return 'low';
    }
  }

  /**
   * Get list of all supported platforms
   */
  getSupportedPlatforms(): string[] {
    return Object.keys(database.sites);
  }

  /**
   * Get platform count
   */
  getPlatformCount(): number {
    return Object.keys(database.sites).length;
  }
}

export const sherlockEngine = new SherlockEngine();
