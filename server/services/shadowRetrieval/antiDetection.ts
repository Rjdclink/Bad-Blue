/**
 * PANTHEON Shadow Retrieval - Anti-Detection Service
 * Comprehensive invisibility layer for web data retrieval
 */

import { CookieJar as ToughCookieJar } from 'tough-cookie';
import type {
  AntiDetectionConfig,
  BrowserProfile,
  RequestHeaders,
  Cookie,
  CookieJar,
} from './types';
import {
  getRandomUserAgent,
  getRandomDesktopUserAgent,
  getBrowserProperties,
  type UserAgentData,
} from './utils/userAgents';
import { generateBrowserProfile } from './utils/fingerprints';
import { generateRequestHeaders } from './utils/headers';
import { generateDelay, sleep, DEFAULT_TIMING_CONFIGS } from './utils/timing';
import { logger } from '../../logger';

const log = logger.child({ component: 'shadowRetrieval:antiDetection' });

/**
 * Cookie Jar implementation using tough-cookie
 */
class ShadowCookieJar implements CookieJar {
  private jar: ToughCookieJar;

  constructor() {
    this.jar = new ToughCookieJar();
  }

  get cookies(): Map<string, Cookie> {
    const cookies = new Map<string, Cookie>();
    const allCookies = this.jar.getCookiesSync('http://localhost');
    
    allCookies.forEach(cookie => {
      cookies.set(cookie.key, {
        name: cookie.key,
        value: cookie.value,
        domain: cookie.domain || '',
        path: cookie.path || '/',
        expires: cookie.expires ? new Date(cookie.expires) : undefined,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite as any,
      });
    });
    
    return cookies;
  }

  setCookie(cookie: Cookie): void {
    try {
      const cookieStr = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path || '/'}`;
      this.jar.setCookieSync(cookieStr, `http://${cookie.domain}`);
    } catch (error) {
      log.error('Failed to set cookie', { error, cookie });
    }
  }

  getCookies(domain: string): Cookie[] {
    try {
      const cookies = this.jar.getCookiesSync(`http://${domain}`);
      return cookies.map(cookie => ({
        name: cookie.key,
        value: cookie.value,
        domain: cookie.domain || domain,
        path: cookie.path || '/',
        expires: cookie.expires ? new Date(cookie.expires) : undefined,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite as any,
      }));
    } catch (error) {
      log.error('Failed to get cookies', { error, domain });
      return [];
    }
  }

  clearCookies(domain?: string): void {
    if (domain) {
      try {
        const cookies = this.jar.getCookiesSync(`http://${domain}`);
        cookies.forEach(cookie => {
          this.jar.store.removeCookie(cookie.domain, cookie.path || '/', cookie.key, () => {});
        });
      } catch (error) {
        log.error('Failed to clear cookies for domain', { error, domain });
      }
    } else {
      this.jar = new ToughCookieJar();
    }
  }

  getCookieHeader(url: string): string {
    try {
      return this.jar.getCookieStringSync(url) || '';
    } catch (error) {
      log.error('Failed to get cookie header', { error, url });
      return '';
    }
  }

  setCookieFromResponse(setCookieHeader: string, url: string): void {
    try {
      this.jar.setCookieSync(setCookieHeader, url);
    } catch (error) {
      log.error('Failed to set cookie from response', { error, url });
    }
  }
}

/**
 * Anti-Detection Service
 * Provides invisibility through rotation and randomization
 */
export class AntiDetectionService {
  private config: AntiDetectionConfig;
  private currentProfile: BrowserProfile | null = null;
  private currentUserAgentData: UserAgentData | null = null;
  private cookieJar: ShadowCookieJar;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;

  constructor(config: Partial<AntiDetectionConfig> = {}) {
    this.config = {
      rotateUserAgent: true,
      randomizeFingerprint: true,
      humanTiming: true,
      persistCookies: true,
      proxyRotation: false,
      ...config,
    };
    
    this.cookieJar = new ShadowCookieJar();
    
    log.info('Anti-Detection Service initialized', { config: this.config });
  }

  /**
   * Get or generate a browser profile
   */
  getProfile(): BrowserProfile {
    if (!this.currentProfile || this.config.randomizeFingerprint) {
      this.rotateProfile();
    }
    
    return this.currentProfile!;
  }

  /**
   * Rotate to a new browser profile
   */
  rotateProfile(): void {
    // Get new user agent
    const userAgentData = this.config.rotateUserAgent
      ? getRandomDesktopUserAgent()
      : (this.currentUserAgentData || getRandomDesktopUserAgent());
    
    this.currentUserAgentData = userAgentData;
    
    // Generate complete browser profile
    this.currentProfile = generateBrowserProfile(
      userAgentData.userAgent,
      userAgentData.platform
    );
    
    log.debug('Browser profile rotated', {
      browser: userAgentData.browser,
      platform: userAgentData.platform,
    });
  }

  /**
   * Generate request headers with anti-detection features
   */
  generateHeaders(url: string, customHeaders: Record<string, string> = {}): RequestHeaders {
    const profile = this.getProfile();
    
    const headers = generateRequestHeaders(profile.userAgent, url, {
      includeReferer: true,
      includeSecFetch: true,
      acceptType: 'html',
      customHeaders,
    });
    
    // Add cookies if enabled
    if (this.config.persistCookies) {
      const cookieHeader = this.cookieJar.getCookieHeader(url);
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }
    }
    
    return headers;
  }

  /**
   * Apply human-like delay before request
   */
  async applyHumanTiming(): Promise<void> {
    if (!this.config.humanTiming) {
      return;
    }
    
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    
    // Generate delay
    const delay = generateDelay(DEFAULT_TIMING_CONFIGS.humanLike);
    
    // If enough time has passed, no need to wait
    if (timeSinceLastRequest >= delay) {
      this.lastRequestTime = Date.now();
      return;
    }
    
    // Wait for remaining time
    const remainingDelay = delay - timeSinceLastRequest;
    log.debug('Applying human timing delay', { delayMs: remainingDelay });
    
    await sleep(remainingDelay);
    this.lastRequestTime = Date.now();
  }

  /**
   * Store cookies from response
   */
  storeCookies(setCookieHeaders: string | string[], url: string): void {
    if (!this.config.persistCookies) {
      return;
    }
    
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    
    headers.forEach(header => {
      if (header) {
        this.cookieJar.setCookieFromResponse(header, url);
      }
    });
  }

  /**
   * Get cookies for a domain
   */
  getCookies(domain: string): Cookie[] {
    return this.cookieJar.getCookies(domain);
  }

  /**
   * Set a cookie
   */
  setCookie(cookie: Cookie): void {
    this.cookieJar.setCookie(cookie);
  }

  /**
   * Clear cookies
   */
  clearCookies(domain?: string): void {
    this.cookieJar.clearCookies(domain);
  }

  /**
   * Get current user agent
   */
  getCurrentUserAgent(): string {
    return this.getProfile().userAgent;
  }

  /**
   * Get request count (for rate limiting)
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Increment request count
   */
  incrementRequestCount(): void {
    this.requestCount++;
  }

  /**
   * Reset request count
   */
  resetRequestCount(): void {
    this.requestCount = 0;
  }

  /**
   * Generate a complete stealth configuration for puppeteer
   */
  getPuppeteerStealthConfig(): {
    userAgent: string;
    viewport: { width: number; height: number };
    extraHTTPHeaders: Record<string, string>;
  } {
    const profile = this.getProfile();
    
    return {
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      extraHTTPHeaders: {
        'Accept-Language': profile.languages.join(','),
        'Accept-Encoding': 'gzip, deflate, br',
      },
    };
  }

  /**
   * Get configuration
   */
  getConfig(): AntiDetectionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AntiDetectionConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('Anti-Detection config updated', { config: this.config });
  }

  /**
   * Check if profile should rotate based on request count
   */
  shouldRotateProfile(requestsBeforeRotation: number = 50): boolean {
    return this.requestCount >= requestsBeforeRotation && this.config.rotateUserAgent;
  }

  /**
   * Prepare for a new request
   */
  async prepareRequest(url: string, customHeaders: Record<string, string> = {}): Promise<{
    headers: RequestHeaders;
    profile: BrowserProfile;
  }> {
    // Rotate profile if needed
    if (this.shouldRotateProfile()) {
      this.rotateProfile();
      this.resetRequestCount();
    }
    
    // Apply human timing
    await this.applyHumanTiming();
    
    // Generate headers
    const headers = this.generateHeaders(url, customHeaders);
    
    // Increment counter
    this.incrementRequestCount();
    
    return {
      headers,
      profile: this.getProfile(),
    };
  }

  /**
   * Create a new isolated session
   */
  createSession(): AntiDetectionService {
    return new AntiDetectionService(this.config);
  }
}

/**
 * Default anti-detection service instance
 */
export const defaultAntiDetection = new AntiDetectionService();

/**
 * Create a new anti-detection service with custom config
 */
export function createAntiDetectionService(config: Partial<AntiDetectionConfig> = {}): AntiDetectionService {
  return new AntiDetectionService(config);
}
