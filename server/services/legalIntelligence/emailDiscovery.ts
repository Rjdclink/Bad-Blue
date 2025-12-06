/**
 * Email Discovery Service
 * TheHarvester-style email intelligence for legal contacts
 * Combines search engines, PGP, certificate transparency, and pattern generation
 */

import type {
  EmailResult,
  EmailDiscoveryResult,
  EmailDiscoveryOptions,
  FOIAContact,
} from './types';
import { certificateTransparencyService } from './certificateTransparency';
import { dnsIntelligenceService } from './dnsIntelligence';
import { cacheService } from '../redisCache';
import { emailFinder } from '../emailFinder';
import { unifiedSearch } from '../../webSearchService';

export class EmailDiscoveryService {
  private readonly emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
  private readonly timeout = 30000; // 30 seconds total
  private readonly hunterKey = process.env.HUNTER_API_KEY || '';

  /**
   * Extract emails from search engine results
   * TheHarvester pattern: Google/Bing scraping
   */
  private async searchEngineEmails(
    query: string,
    domain?: string
  ): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    const emailSet = new Set<string>();

    try {
      // Build search query
      const searchQuery = domain
        ? `${query} @${domain} email contact`
        : `${query} email contact`;

      // Use unified search (combines Bing and Gemini)
      const searchResults = await unifiedSearch(searchQuery, {
        maxResults: 10,
      });

      // Extract emails from snippets and URLs
      for (const result of searchResults) {
        const text = `${result.title} ${result.snippet || ''} ${result.url}`;
        const matches = text.match(this.emailRegex);

        if (matches) {
          for (const email of matches) {
            const cleanEmail = email.toLowerCase();
            
            // Filter by domain if specified
            if (domain && !cleanEmail.endsWith(`@${domain}`)) {
              continue;
            }

            if (!emailSet.has(cleanEmail)) {
              emailSet.add(cleanEmail);
              results.push({
                email: cleanEmail,
                source: 'google',
                confidence: 60,
                metadata: {
                  domain: cleanEmail.split('@')[1],
                },
              });
            }
          }
        }
      }

      console.log(`[EmailDiscovery] Found ${results.length} emails from search engines`);
      return results;
    } catch (error) {
      console.error('[EmailDiscovery] Search engine error:', error);
      return [];
    }
  }

  /**
   * Query PGP key servers for email addresses
   * TheHarvester pattern: keys.openpgp.org queries
   */
  private async searchPGPKeys(domain: string): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    const cacheKey = `pgp:${domain}`;
    const cached = await cacheService.get<EmailResult[]>(cacheKey);
    if (cached) return cached;

    try {
      // Search PGP key server by domain
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const url = `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(`%@${domain}`)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LegalWhat-Intelligence/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const text = await response.text();
        
        // Extract emails from PGP key data
        const matches = text.match(this.emailRegex);
        const emailSet = new Set<string>();

        if (matches) {
          for (const email of matches) {
            const cleanEmail = email.toLowerCase();
            if (cleanEmail.endsWith(`@${domain}`) && !emailSet.has(cleanEmail)) {
              emailSet.add(cleanEmail);
              results.push({
                email: cleanEmail,
                source: 'pgp',
                confidence: 80,
                metadata: {
                  domain,
                },
              });
            }
          }
        }
      }

      // Cache for 48 hours
      await cacheService.set(cacheKey, results, 'warm');

      console.log(`[EmailDiscovery] Found ${results.length} emails from PGP`);
      return results;
    } catch (error) {
      console.error('[EmailDiscovery] PGP search error:', error);
      return [];
    }
  }

  /**
   * Use Hunter.io API for email pattern detection
   * TheHarvester pattern: Hunter.io integration
   */
  private async searchHunter(
    name: string,
    domain: string
  ): Promise<EmailResult[]> {
    if (!this.hunterKey) return [];

    try {
      const result = await emailFinder.findEmail(name, domain);
      
      return result.emails.map(email => ({
        email: email.toLowerCase(),
        source: 'hunter' as const,
        confidence: result.confidence,
        metadata: {
          domain,
        },
      }));
    } catch (error) {
      console.error('[EmailDiscovery] Hunter.io error:', error);
      return [];
    }
  }

  /**
   * Generate email patterns based on common formats
   * TheHarvester pattern: Pattern generation
   */
  private generateEmailPatterns(
    firstName: string,
    lastName: string,
    domain: string
  ): EmailResult[] {
    const first = firstName.toLowerCase();
    const last = lastName.toLowerCase();
    const patterns: string[] = [];

    if (first && last) {
      patterns.push(`${first}.${last}@${domain}`);
      patterns.push(`${first}${last}@${domain}`);
      patterns.push(`${first}_${last}@${domain}`);
      patterns.push(`${first[0]}${last}@${domain}`);
      patterns.push(`${first}.${last[0]}@${domain}`);
    }
    if (first) {
      patterns.push(`${first}@${domain}`);
    }
    if (last) {
      patterns.push(`${last}@${domain}`);
    }

    return patterns.map(email => ({
      email,
      source: 'pattern' as const,
      confidence: 30,
      metadata: {
        firstName,
        lastName,
        domain,
      },
    }));
  }

  /**
   * Discover FOIA officer emails for government agencies
   */
  async discoverFOIAOfficerEmails(
    agencyName: string,
    agencyDomain?: string
  ): Promise<FOIAContact[]> {
    const startTime = Date.now();
    const cacheKey = `foia:${agencyName}:${agencyDomain || 'any'}`;
    const cached = await cacheService.get<FOIAContact[]>(cacheKey);
    if (cached) return cached;

    const contacts: FOIAContact[] = [];
    const emailMap = new Map<string, EmailResult>();

    try {
      // Search for FOIA officer specifically
      const queries = [
        `${agencyName} FOIA officer email`,
        `${agencyName} records request contact`,
        `${agencyName} public records officer`,
        `${agencyName} transparency office email`,
      ];

      const searchPromises = queries.map(query =>
        this.searchEngineEmails(query, agencyDomain)
      );

      const searchResults = await Promise.all(searchPromises);
      
      // Aggregate all email results
      for (const results of searchResults) {
        for (const result of results) {
          if (!emailMap.has(result.email)) {
            emailMap.set(result.email, result);
          }
        }
      }

      // Query certificate transparency if domain provided
      if (agencyDomain) {
        const certEmails = await certificateTransparencyService.findGovernmentEmails(agencyDomain);
        for (const email of certEmails) {
          if (!emailMap.has(email)) {
            emailMap.set(email, {
              email,
              source: 'cert',
              confidence: 50,
              metadata: { domain: agencyDomain },
            });
          }
        }
      }

      // Convert emails to FOIA contacts
      for (const [email, result] of emailMap) {
        // Infer department from email prefix
        const prefix = email.split('@')[0];
        let department = 'Unknown';
        
        if (prefix.includes('foia') || prefix.includes('records')) {
          department = 'FOIA Office';
        } else if (prefix.includes('clerk')) {
          department = 'Clerk\'s Office';
        } else if (prefix.includes('admin')) {
          department = 'Administration';
        }

        contacts.push({
          email: result.email,
          department,
          agency: agencyName,
          confidence: result.confidence,
          sources: [result.source],
          discoveredAt: new Date(),
        });
      }

      // Sort by confidence
      contacts.sort((a, b) => b.confidence - a.confidence);

      // Cache for 24 hours
      await cacheService.set(cacheKey, contacts, 'warm');

      console.log(
        `[EmailDiscovery] Found ${contacts.length} FOIA contacts for ${agencyName} in ${Date.now() - startTime}ms`
      );

      return contacts;
    } catch (error) {
      console.error(`[EmailDiscovery] Error finding FOIA officers for ${agencyName}:`, error);
      return [];
    }
  }

  /**
   * Discover attorney emails
   */
  async discoverAttorneyEmail(
    attorneyName: string,
    firm?: string
  ): Promise<EmailResult[]> {
    const cacheKey = `attorney:${attorneyName}:${firm || 'any'}`;
    const cached = await cacheService.get<EmailResult[]>(cacheKey);
    if (cached) return cached;

    const results: EmailResult[] = [];
    const emailMap = new Map<string, EmailResult>();

    try {
      // Build search queries
      const queries = [
        `${attorneyName} ${firm || ''} attorney email contact`.trim(),
        `${attorneyName} lawyer email`.trim(),
      ];

      // Search engines
      const searchPromises = queries.map(query => this.searchEngineEmails(query));
      const searchResults = await Promise.all(searchPromises);

      for (const emails of searchResults) {
        for (const email of emails) {
          if (!emailMap.has(email.email)) {
            emailMap.set(email.email, email);
          }
        }
      }

      // If firm domain is known, try Hunter.io
      if (firm) {
        // Extract potential domain from firm name
        const firmDomain = firm.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, '')
          .replace(/(law|firm|llc|pllc|attorneys|lawyers)$/i, '') + '.com';
        
        const hunterResults = await this.searchHunter(attorneyName, firmDomain);
        for (const email of hunterResults) {
          if (!emailMap.has(email.email)) {
            emailMap.set(email.email, email);
          }
        }
      }

      const finalResults = Array.from(emailMap.values());
      
      // Cache for 48 hours
      await cacheService.set(cacheKey, finalResults, 'warm');

      return finalResults;
    } catch (error) {
      console.error(`[EmailDiscovery] Error finding attorney email for ${attorneyName}:`, error);
      return [];
    }
  }

  /**
   * Comprehensive email discovery with all sources
   */
  async discoverEmails(
    query: string,
    options: EmailDiscoveryOptions = {}
  ): Promise<EmailDiscoveryResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const emailMap = new Map<string, EmailResult>();
    const sources = new Set<string>();

    try {
      const discoveryPromises: Promise<EmailResult[]>[] = [];

      // Search engines (default enabled)
      if (options.includeSearchEngines !== false) {
        discoveryPromises.push(
          this.searchEngineEmails(query).catch(error => {
            errors.push(`Search engine error: ${error.message}`);
            return [];
          })
        );
      }

      // Wait for all discoveries
      const allResults = await Promise.all(discoveryPromises);

      // Aggregate results
      for (const results of allResults) {
        for (const result of results) {
          if (!emailMap.has(result.email)) {
            emailMap.set(result.email, result);
            sources.add(result.source);
          }
        }
      }

      const emails = Array.from(emailMap.values())
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, options.maxResults || 50);

      return {
        emails,
        subdomains: [],
        totalFound: emails.length,
        sources: Array.from(sources),
        searchDuration: Date.now() - startTime,
        errors,
      };
    } catch (error) {
      console.error('[EmailDiscovery] Discovery error:', error);
      return {
        emails: [],
        subdomains: [],
        totalFound: 0,
        sources: [],
        searchDuration: Date.now() - startTime,
        errors: [...errors, `Fatal error: ${error}`],
      };
    }
  }
}

export const emailDiscoveryService = new EmailDiscoveryService();
