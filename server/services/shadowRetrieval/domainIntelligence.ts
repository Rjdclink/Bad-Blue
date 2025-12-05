/**
 * PANTHEON Shadow Retrieval - Domain Intelligence System
 * Learning system that remembers how to handle each domain
 */

import type {
  DomainProfile,
  RetrievalStrategy,
  RetrievalMethod,
  DefenseType,
  CircuitBreakerState,
  DomainMetrics,
} from './types';
import { logger } from '../../logger';

const log = logger.child({ component: 'shadowRetrieval:domainIntelligence' });

/**
 * Domain Intelligence Service
 * Tracks and learns optimal strategies for each domain
 */
export class DomainIntelligence {
  private profiles: Map<string, DomainProfile> = new Map();
  private readonly maxProfileAge: number = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor() {
    log.info('Domain Intelligence initialized');
  }

  /**
   * Get or create profile for a domain
   */
  getProfile(domain: string): DomainProfile {
    const normalized = this.normalizeDomain(domain);
    
    if (!this.profiles.has(normalized)) {
      this.profiles.set(normalized, this.createDefaultProfile(normalized));
    }
    
    return this.profiles.get(normalized)!;
  }

  /**
   * Update profile after a retrieval attempt
   */
  updateProfile(
    domain: string,
    method: RetrievalMethod,
    success: boolean,
    responseTime: number,
    error?: string
  ): void {
    const normalized = this.normalizeDomain(domain);
    const profile = this.getProfile(normalized);

    // Update attempt counts
    profile.totalAttempts++;
    profile.lastAttempt = new Date();

    if (success) {
      profile.successfulAttempts++;
      profile.lastSuccessful = new Date();
      
      // Update average response time (exponential moving average)
      if (profile.averageResponseTime === 0) {
        profile.averageResponseTime = responseTime;
      } else {
        profile.averageResponseTime = profile.averageResponseTime * 0.8 + responseTime * 0.2;
      }

      // Add or update successful strategy
      const existingStrategy = profile.successfulStrategies.find(s => s.method === method);
      if (existingStrategy) {
        existingStrategy.successRate = existingStrategy.successRate * 0.9 + 1.0 * 0.1;
        existingStrategy.lastUsed = new Date();
        existingStrategy.avgResponseTime = existingStrategy.avgResponseTime * 0.8 + responseTime * 0.2;
      } else {
        profile.successfulStrategies.push({
          method,
          priority: this.calculatePriority(method),
          successRate: 1.0,
          lastUsed: new Date(),
          avgResponseTime: responseTime,
        });
      }

      // Remove from failed strategies if present
      profile.failedStrategies = profile.failedStrategies.filter(s => s.method !== method);
    } else {
      // Update failed strategy
      const existingStrategy = profile.failedStrategies.find(s => s.method === method);
      if (existingStrategy) {
        existingStrategy.successRate = existingStrategy.successRate * 0.9 + 0.0 * 0.1;
        existingStrategy.lastUsed = new Date();
      } else {
        profile.failedStrategies.push({
          method,
          priority: this.calculatePriority(method),
          successRate: 0.0,
          lastUsed: new Date(),
          avgResponseTime: responseTime,
        });
      }

      // Detect defense type from error
      if (error) {
        this.detectDefense(profile, error);
      }
    }

    // Update block rate
    profile.blockRate = 1 - (profile.successfulAttempts / profile.totalAttempts);

    log.debug('Profile updated', {
      domain: normalized,
      method,
      success,
      totalAttempts: profile.totalAttempts,
      successRate: (profile.successfulAttempts / profile.totalAttempts * 100).toFixed(1) + '%',
    });
  }

  /**
   * Detect defense mechanisms from error messages
   */
  private detectDefense(profile: DomainProfile, error: string): void {
    const errorLower = error.toLowerCase();

    // Cloudflare detection
    if (errorLower.includes('cloudflare') || 
        errorLower.includes('cf-ray') ||
        errorLower.includes('attention required')) {
      profile.defenseType = 'cloudflare';
      if (!profile.defenseSignatures.includes('cloudflare')) {
        profile.defenseSignatures.push('cloudflare');
        log.info('Cloudflare defense detected', { domain: profile.domain });
      }
    }

    // Akamai detection
    if (errorLower.includes('akamai') || 
        errorLower.includes('reference #')) {
      profile.defenseType = 'akamai';
      if (!profile.defenseSignatures.includes('akamai')) {
        profile.defenseSignatures.push('akamai');
        log.info('Akamai defense detected', { domain: profile.domain });
      }
    }

    // reCAPTCHA detection
    if (errorLower.includes('recaptcha') || 
        errorLower.includes('captcha')) {
      profile.defenseType = 'recaptcha';
      if (!profile.defenseSignatures.includes('recaptcha')) {
        profile.defenseSignatures.push('recaptcha');
        log.info('reCAPTCHA detected', { domain: profile.domain });
      }
    }

    // Rate limiting detection
    if (errorLower.includes('rate limit') || 
        errorLower.includes('too many requests') ||
        error.includes('429')) {
      profile.defenseType = 'rate-limit';
      if (!profile.defenseSignatures.includes('rate-limit')) {
        profile.defenseSignatures.push('rate-limit');
        log.info('Rate limiting detected', { domain: profile.domain });
      }
    }

    // Imperva detection
    if (errorLower.includes('imperva') || 
        errorLower.includes('incapsula')) {
      profile.defenseType = 'imperva';
      if (!profile.defenseSignatures.includes('imperva')) {
        profile.defenseSignatures.push('imperva');
        log.info('Imperva defense detected', { domain: profile.domain });
      }
    }

    // DataDome detection
    if (errorLower.includes('datadome')) {
      profile.defenseType = 'datadome';
      if (!profile.defenseSignatures.includes('datadome')) {
        profile.defenseSignatures.push('datadome');
        log.info('DataDome defense detected', { domain: profile.domain });
      }
    }
  }

  /**
   * Get best strategy for a domain
   */
  getBestStrategy(domain: string): RetrievalStrategy | null {
    const normalized = this.normalizeDomain(domain);
    const profile = this.getProfile(normalized);

    if (profile.successfulStrategies.length === 0) {
      return null;
    }

    // Sort by success rate and recency
    const sorted = [...profile.successfulStrategies].sort((a, b) => {
      // Higher success rate is better
      if (Math.abs(a.successRate - b.successRate) > 0.1) {
        return b.successRate - a.successRate;
      }
      
      // More recent is better
      return b.lastUsed.getTime() - a.lastUsed.getTime();
    });

    return sorted[0];
  }

  /**
   * Get recommended strategies in priority order
   */
  getRecommendedStrategies(domain: string): RetrievalStrategy[] {
    const normalized = this.normalizeDomain(domain);
    const profile = this.getProfile(normalized);

    // If we have successful strategies, use those
    if (profile.successfulStrategies.length > 0) {
      return [...profile.successfulStrategies].sort((a, b) => {
        // Sort by success rate and priority
        if (Math.abs(a.successRate - b.successRate) > 0.1) {
          return b.successRate - a.successRate;
        }
        return b.priority - a.priority;
      });
    }

    // Otherwise, return default strategies
    return this.getDefaultStrategies(profile.defenseType);
  }

  /**
   * Get default strategies based on defense type
   */
  private getDefaultStrategies(defenseType?: DefenseType): RetrievalStrategy[] {
    const now = new Date();

    switch (defenseType) {
      case 'cloudflare':
      case 'akamai':
      case 'imperva':
        // For bot protection, prioritize puppeteer and firecrawl
        return [
          { method: 'firecrawl', priority: 3, successRate: 0.9, lastUsed: now, avgResponseTime: 5000 },
          { method: 'puppeteer', priority: 2, successRate: 0.8, lastUsed: now, avgResponseTime: 3000 },
          { method: 'fetch', priority: 1, successRate: 0.5, lastUsed: now, avgResponseTime: 1000 },
        ];

      case 'recaptcha':
        // For CAPTCHA, only advanced methods work
        return [
          { method: 'firecrawl', priority: 3, successRate: 0.7, lastUsed: now, avgResponseTime: 5000 },
          { method: 'puppeteer', priority: 2, successRate: 0.5, lastUsed: now, avgResponseTime: 3000 },
        ];

      case 'rate-limit':
        // For rate limiting, use slower methods with backoff
        return [
          { method: 'fetch', priority: 3, successRate: 0.8, lastUsed: now, avgResponseTime: 1000 },
          { method: 'puppeteer', priority: 2, successRate: 0.7, lastUsed: now, avgResponseTime: 3000 },
          { method: 'firecrawl', priority: 1, successRate: 0.6, lastUsed: now, avgResponseTime: 5000 },
        ];

      default:
        // For no known defense, try fast methods first
        return [
          { method: 'fetch', priority: 3, successRate: 0.9, lastUsed: now, avgResponseTime: 1000 },
          { method: 'puppeteer', priority: 2, successRate: 0.8, lastUsed: now, avgResponseTime: 3000 },
          { method: 'firecrawl', priority: 1, successRate: 0.7, lastUsed: now, avgResponseTime: 5000 },
        ];
    }
  }

  /**
   * Calculate priority for a method
   */
  private calculatePriority(method: RetrievalMethod): number {
    switch (method) {
      case 'fetch':
        return 3; // Fast, use first
      case 'puppeteer':
        return 2; // Slower, but handles JS
      case 'firecrawl':
        return 1; // Premium, use as fallback
      case 'external':
        return 0; // Last resort
      default:
        return 1;
    }
  }

  /**
   * Create default profile for a domain
   */
  private createDefaultProfile(domain: string): DomainProfile {
    return {
      domain,
      defenseSignatures: [],
      successfulStrategies: [],
      failedStrategies: [],
      averageResponseTime: 0,
      lastSuccessful: null,
      lastAttempt: null,
      blockRate: 0,
      totalAttempts: 0,
      successfulAttempts: 0,
      circuitBreaker: {
        failures: 0,
        successes: 0,
        lastFailure: null,
        lastSuccess: null,
        state: 'closed',
      },
      notes: '',
    };
  }

  /**
   * Normalize domain (remove www, subdomain variations, etc.)
   */
  private normalizeDomain(domain: string): string {
    try {
      const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
      let hostname = url.hostname.toLowerCase();
      
      // Remove www prefix
      if (hostname.startsWith('www.')) {
        hostname = hostname.substring(4);
      }
      
      return hostname;
    } catch {
      return domain.toLowerCase();
    }
  }

  /**
   * Get metrics for a domain
   */
  getMetrics(domain: string): DomainMetrics | null {
    const normalized = this.normalizeDomain(domain);
    const profile = this.profiles.get(normalized);

    if (!profile || profile.totalAttempts === 0) {
      return null;
    }

    return {
      domain: normalized,
      requestCount: profile.totalAttempts,
      successRate: profile.successfulAttempts / profile.totalAttempts,
      avgResponseTime: profile.averageResponseTime,
      errorRate: 1 - (profile.successfulAttempts / profile.totalAttempts),
      lastUpdated: profile.lastAttempt || new Date(),
    };
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): DomainProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Clear old profiles
   */
  clearOldProfiles(): number {
    const now = Date.now();
    let cleared = 0;

    for (const [domain, profile] of this.profiles.entries()) {
      const lastActivity = profile.lastAttempt || profile.lastSuccessful;
      if (lastActivity && (now - lastActivity.getTime()) > this.maxProfileAge) {
        this.profiles.delete(domain);
        cleared++;
      }
    }

    if (cleared > 0) {
      log.info('Cleared old domain profiles', { count: cleared });
    }

    return cleared;
  }

  /**
   * Export profiles for persistence
   */
  exportProfiles(): string {
    const data = Array.from(this.profiles.entries());
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import profiles from persistence
   */
  importProfiles(data: string): number {
    try {
      const parsed = JSON.parse(data);
      let imported = 0;

      for (const [domain, profile] of parsed) {
        // Convert date strings back to Date objects
        if (profile.lastSuccessful) profile.lastSuccessful = new Date(profile.lastSuccessful);
        if (profile.lastAttempt) profile.lastAttempt = new Date(profile.lastAttempt);
        if (profile.circuitBreaker.lastSuccess) profile.circuitBreaker.lastSuccess = new Date(profile.circuitBreaker.lastSuccess);
        if (profile.circuitBreaker.lastFailure) profile.circuitBreaker.lastFailure = new Date(profile.circuitBreaker.lastFailure);
        
        profile.successfulStrategies.forEach((s: RetrievalStrategy) => {
          s.lastUsed = new Date(s.lastUsed);
        });
        
        profile.failedStrategies.forEach((s: RetrievalStrategy) => {
          s.lastUsed = new Date(s.lastUsed);
        });

        this.profiles.set(domain, profile);
        imported++;
      }

      log.info('Imported domain profiles', { count: imported });
      return imported;
    } catch (error: any) {
      log.error('Failed to import profiles', { error: error.message });
      return 0;
    }
  }
}

/**
 * Default domain intelligence instance
 */
export const defaultDomainIntelligence = new DomainIntelligence();
