/**
 * PANTHEON Social Intelligence - Username Validator
 * Validates usernames against platform-specific rules
 */

import type { ValidationResult, PlatformRules, SherlockDatabase } from './types';
import sherlockSites from './sherlockSites.json';

const database = sherlockSites as SherlockDatabase;

export class UsernameValidator {
  /**
   * Validate username for a specific platform or generally
   */
  validate(username: string, platform?: string): ValidationResult {
    if (!username || typeof username !== 'string') {
      return { valid: false, reason: 'Username is required' };
    }

    // Trim whitespace
    username = username.trim();

    if (username.length === 0) {
      return { valid: false, reason: 'Username cannot be empty' };
    }

    // If platform specified, use platform-specific rules
    if (platform) {
      const site = database.sites[platform];
      if (!site) {
        return { valid: false, reason: `Platform '${platform}' not found` };
      }

      if (site.regexCheck) {
        const regex = new RegExp(site.regexCheck);
        if (!regex.test(username)) {
          return {
            valid: false,
            reason: `Username does not match ${platform} pattern`,
            sanitized: this.sanitize(username),
          };
        }
      }
    }

    // General validation (most platforms)
    // Username should be 1-30 chars, alphanumeric with some special chars
    const generalRegex = /^[a-zA-Z0-9._-]{1,30}$/;
    if (!generalRegex.test(username)) {
      return {
        valid: false,
        reason: 'Username contains invalid characters or wrong length',
        sanitized: this.sanitize(username),
      };
    }

    return { valid: true, sanitized: username };
  }

  /**
   * Sanitize username by removing invalid characters
   */
  sanitize(username: string): string {
    if (!username) return '';
    
    // Remove all non-alphanumeric except ._-
    return username.replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 30);
  }

  /**
   * Get platform-specific validation rules
   */
  getPlatformRules(platform: string): PlatformRules | null {
    const site = database.sites[platform];
    if (!site) return null;

    // Parse regex to extract rules (simplified)
    const regex = site.regexCheck ? new RegExp(site.regexCheck) : /^[a-zA-Z0-9._-]{1,30}$/;

    return {
      minLength: 1,
      maxLength: 30,
      allowedChars: 'a-zA-Z0-9._-',
      regex,
    };
  }

  /**
   * Check if a platform exists in the database
   */
  platformExists(platform: string): boolean {
    return !!database.sites[platform];
  }

  /**
   * Get list of all supported platforms
   */
  getAllPlatforms(): string[] {
    return Object.keys(database.sites);
  }
}

export const usernameValidator = new UsernameValidator();
