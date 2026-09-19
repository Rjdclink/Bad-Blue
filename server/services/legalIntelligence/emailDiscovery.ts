/**
 * Email Discovery Service
 * TheHarvester-style email intelligence for legal contacts
 * Combines search engines, official-domain contacts, certificate transparency, and pattern generation
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
        limit: 10,
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
   * Retrieve public role-based contacts from an official domain.
   * This intentionally ignores person-specific mailbox names and only returns
   * organizational addresses such as FOIA/records/contact/legal/press.
   */
  private async searchOfficialRoleContacts(domain: string): Promise<EmailResult[]> {
    const normalizedDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!normalizedDomain || !/^[a-z0-9.-]+$/.test(normalizedDomain)) return [];

    const cacheKey = `official-role-contacts:${normalizedDomain}`;
    const cached = await cacheService.get<EmailResult[]>(cacheKey);
    if (cached) return cached;

    const allowedPrefixes = new Set([
      'foia', 'records', 'publicrecords', 'openrecords', 'clerk', 'info',
      'contact', 'legal', 'press', 'media', 'communications', 'admin',
      'privacy', 'compliance', 'support',
    ]);
    const paths = ['/', '/contact', '/contact-us', '/foia', '/records'];
    const found = new Map<string, EmailResult>();

    for (const path of paths) {
      try {
        const response = await fetch(`https://${normalizedDomain}${path}`, {
          headers: {
            'User-Agent': 'LegalWhat-PANTHEON/1.0 (public legal contact research)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(6_000),
        });
        if (!response.ok) continue;

        const finalUrl = new URL(response.url);
        if (
          finalUrl.hostname !== normalizedDomain &&
          !finalUrl.hostname.endsWith(`.${normalizedDomain}`)
        ) {
          continue;
        }

        const html = await response.text();
        const matches = html.match(this.emailRegex) || [];
        for (const rawEmail of matches) {
          const email = rawEmail.toLowerCase().replace(/[),.;:]+$/, '');
          const [local, emailDomain] = email.split('@');
          if (!local || emailDomain !== normalizedDomain || !allowedPrefixes.has(local)) continue;
          if (!found.has(email)) {
            found.set(email, {
              email,
              source: 'official-site',
              confidence: 90,
              metadata: {
                domain: normalizedDomain,
                department: local,
              },
              discoveredAt: new Date(),
            });
          }
        }
      } catch {
        // Individual public page failure is local.
      }
    }

    const results = Array.from(found.values());
    await cacheService.set(cacheKey, results, 'warm');
    return results;
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

      // Read role-based contacts directly from the agency's official domain.
      if (agencyDomain) {
        const officialContacts = await this.searchOfficialRoleContacts(agencyDomain);
        for (const result of officialContacts) {
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
        // Known legal domain patterns for common firms
        const knownDomains: Record<string, string> = {
          // Add known firm domains here as needed
        };
        
        // Try to match known domains first
        const firmKey = firm.toLowerCase().replace(/[^a-z0-9]/g, '');
        let firmDomain = knownDomains[firmKey];
        
        // If not known, generate a potential domain (but with low confidence)
        if (!firmDomain) {
          // Extract clean name and create potential domain
          const cleanFirm = firm.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '')
            .replace(/(law|firm|llc|pllc|attorneys|lawyers|legal|group|associates)$/i, '');
          
          // Only attempt if firm name is reasonable length
          if (cleanFirm.length >= 3 && cleanFirm.length <= 30) {
            firmDomain = `${cleanFirm}.com`;
            
            const hunterResults = await this.searchHunter(attorneyName, firmDomain);
            for (const email of hunterResults) {
              if (!emailMap.has(email.email)) {
                // Mark as lower confidence since domain was guessed
                emailMap.set(email.email, {
                  ...email,
                  confidence: Math.min(email.confidence, 40),
                });
              }
            }
          }
        } else {
          // Higher confidence for known domains
          const hunterResults = await this.searchHunter(attorneyName, firmDomain);
          for (const email of hunterResults) {
            if (!emailMap.has(email.email)) {
              emailMap.set(email.email, email);
            }
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
        errors: [...errors, `Fatal error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

export const emailDiscoveryService = new EmailDiscoveryService();
