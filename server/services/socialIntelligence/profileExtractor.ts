/**
 * PANTHEON Social Intelligence - Profile Data Extractor
 * Extracts profile information from platform pages
 */

import * as cheerio from 'cheerio';
import type { SherlockResult } from './types';
import { logger } from '../../logger';

const log = logger.child({ component: 'socialIntelligence:profileExtractor' });

/**
 * Profile extraction rules for top platforms
 */
const extractionRules: Record<string, any> = {
  GitHub: {
    selectors: {
      displayName: '.vcard-fullname',
      bio: '.user-profile-bio',
      followers: 'a[href$="/followers"] .text-bold',
      verified: '.Label--sponsor',
      image: '.avatar-user',
    },
  },
  Twitter: {
    selectors: {
      displayName: '[data-testid="UserName"]',
      bio: '[data-testid="UserDescription"]',
      verified: '[data-testid="icon-verified"]',
      image: 'img[alt*="profile"]',
    },
  },
  LinkedIn: {
    selectors: {
      displayName: '.top-card-layout__title',
      bio: '.top-card-layout__headline',
      image: '.top-card__profile-image',
    },
  },
  Reddit: {
    jsonPath: true,
    extract: (html: string) => {
      // Reddit embeds JSON in script tags
      const match = html.match(/<script id="data">window\.__r = (.*?)<\/script>/s);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          return {
            displayName: data?.user?.profile?.displayName,
            bio: data?.user?.profile?.publicDescription,
          };
        } catch (e) {
          log.debug('Failed to parse Reddit JSON', { error: e });
        }
      }
      return {};
    },
  },
  Instagram: {
    jsonPath: true,
    extract: (html: string) => {
      // Instagram embeds JSON-LD
      const $ = cheerio.load(html);
      const jsonLd = $('script[type="application/ld+json"]').html();
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          return {
            displayName: data.name,
            bio: data.description,
            imageUrl: data.image,
          };
        } catch (e) {
          log.debug('Failed to parse Instagram JSON-LD', { error: e });
        }
      }
      return {};
    },
  },
  Medium: {
    selectors: {
      displayName: 'h2[data-testid="authorName"]',
      bio: 'p[data-testid="authorBio"]',
      followers: '[data-testid="followerCount"]',
      image: 'img[data-testid="authorPhoto"]',
    },
  },
  'dev.to': {
    selectors: {
      displayName: '.profile-header h1',
      bio: '.profile-header__bio',
      image: '.profile-image',
    },
  },
  YouTube: {
    selectors: {
      displayName: '#channel-name',
      bio: '#description',
      followers: '#subscriber-count',
      verified: '.badge-style-type-verified',
      image: '#avatar img',
    },
  },
  TikTok: {
    jsonPath: true,
    extract: (html: string) => {
      // TikTok uses JSON-LD
      const $ = cheerio.load(html);
      const jsonLd = $('script[type="application/ld+json"]').html();
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          return {
            displayName: data.author?.name,
            bio: data.author?.description,
            imageUrl: data.author?.image,
          };
        } catch (e) {
          log.debug('Failed to parse TikTok JSON-LD', { error: e });
        }
      }
      return {};
    },
  },
  'Stack Overflow': {
    selectors: {
      displayName: '.fs-headline1',
      bio: '.bio',
      image: '.avatar img',
    },
  },
};

export class ProfileExtractor {
  /**
   * Extract profile data from HTML
   */
  async extract(html: string, platform: string): Promise<Partial<SherlockResult['profileData']>> {
    const rules = extractionRules[platform];
    if (!rules) {
      return {};
    }

    try {
      // Use custom extraction function if available
      if (rules.extract) {
        return rules.extract(html);
      }

      // Use CSS selectors
      if (rules.selectors) {
        const $ = cheerio.load(html);
        const data: Partial<SherlockResult['profileData']> = {};

        if (rules.selectors.displayName) {
          const name = $(rules.selectors.displayName).first().text().trim();
          if (name) data.displayName = name;
        }

        if (rules.selectors.bio) {
          const bio = $(rules.selectors.bio).first().text().trim();
          if (bio) data.bio = bio;
        }

        if (rules.selectors.followers) {
          const followers = $(rules.selectors.followers).first().text().trim();
          if (followers) {
            // Parse follower count (e.g., "1.2K" -> 1200)
            data.followers = this.parseFollowerCount(followers);
          }
        }

        if (rules.selectors.verified) {
          data.verified = $(rules.selectors.verified).length > 0;
        }

        if (rules.selectors.image) {
          const img = $(rules.selectors.image).first().attr('src');
          if (img) data.imageUrl = img;
        }

        return data;
      }
    } catch (error: any) {
      log.debug('Failed to extract profile data', {
        platform,
        error: error.message,
      });
    }

    return {};
  }

  /**
   * Extract from JSON data (API responses)
   */
  async extractFromJSON(json: any, platform: string): Promise<Partial<SherlockResult['profileData']>> {
    // Platform-specific JSON extraction
    const data: Partial<SherlockResult['profileData']> = {};

    try {
      if (platform === 'GitHub' && json.name) {
        data.displayName = json.name;
        data.bio = json.bio;
        data.followers = json.followers;
        data.imageUrl = json.avatar_url;
      }
      // Add more platform-specific JSON parsing as needed
    } catch (error: any) {
      log.debug('Failed to extract from JSON', {
        platform,
        error: error.message,
      });
    }

    return data;
  }

  /**
   * Parse follower count strings like "1.2K", "5M" to numbers
   */
  private parseFollowerCount(text: string): number {
    const cleaned = text.replace(/[^0-9.KMB]/gi, '');
    const multipliers: Record<string, number> = {
      K: 1000,
      M: 1000000,
      B: 1000000000,
    };

    let value = parseFloat(cleaned);
    const multiplier = cleaned.match(/[KMB]/i)?.[0];

    if (multiplier && multipliers[multiplier.toUpperCase()]) {
      value *= multipliers[multiplier.toUpperCase()];
    }

    return Math.round(value);
  }

  /**
   * Check if platform supports profile extraction
   */
  supportsExtraction(platform: string): boolean {
    return !!extractionRules[platform];
  }
}

export const profileExtractor = new ProfileExtractor();
