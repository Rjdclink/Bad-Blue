/**
 * DNS Intelligence Service
 * DNS enumeration and subdomain discovery
 * Pattern from TheHarvester's DNS aggregation module
 */

import type { SubdomainResult, DNSRecord, SubdomainDiscoveryOptions } from './types';
import { certificateTransparencyService } from './certificateTransparency';
import { cacheService } from '../redisCache';

export class DNSIntelligenceService {
  private readonly timeout = 10000; // 10 seconds

  /**
   * Query DNSDumpster API for subdomain enumeration
   * Note: This is a simplified implementation as DNSDumpster requires scraping
   */
  private async queryDNSDumpster(domain: string): Promise<SubdomainResult[]> {
    // DNSDumpster requires CSRF token and form submission
    // For production, consider using a proxy service or official API
    console.log(`[DNSIntelligence] DNSDumpster query for ${domain} - requires browser automation`);
    return [];
  }

  /**
   * Query public DNS resolvers for common subdomains
   */
  private async queryCommonSubdomains(domain: string): Promise<SubdomainResult[]> {
    const commonSubdomains = [
      'www', 'mail', 'ftp', 'webmail', 'smtp', 'pop', 'ns1', 'ns2',
      'cpanel', 'whm', 'webdisk', 'admin', 'portal', 'records',
      'foia', 'transparency', 'open', 'data', 'api', 'dev',
      'staging', 'test', 'demo', 'docs', 'help', 'support',
      'police', 'sheriff', 'court', 'clerk', 'county', 'city',
      'gov', 'government', 'public', 'citizen', 'service'
    ];

    const results: SubdomainResult[] = [];
    const cacheKey = `dns:common:${domain}`;
    const cached = await cacheService.get<SubdomainResult[]>(cacheKey);
    if (cached) return cached;

    // Test common subdomains in batches to avoid overwhelming DNS
    const batchSize = 5;
    for (let i = 0; i < commonSubdomains.length; i += batchSize) {
      const batch = commonSubdomains.slice(i, i + batchSize);
      const promises = batch.map(sub => this.resolveDomain(`${sub}.${domain}`));
      
      const resolved = await Promise.allSettled(promises);
      
      resolved.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const subdomain = `${batch[index]}.${domain}`;
          results.push({
            subdomain,
            ipAddresses: result.value,
            source: 'dns',
            status: 'active',
            discoveredAt: new Date(),
          });
        }
      });

      // Rate limiting: wait between batches
      if (i + batchSize < commonSubdomains.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Cache for 12 hours
    await cacheService.set(cacheKey, results, 'warm');

    return results;
  }

  /**
   * Resolve a domain to IP addresses
   * Uses Node.js DNS module or fetch-based DNS-over-HTTPS
   */
  private async resolveDomain(domain: string): Promise<string[] | null> {
    try {
      // Use Cloudflare DNS-over-HTTPS for cross-platform compatibility
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/dns-json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();
      
      if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
        const ips = data.Answer
          .filter((ans: any) => ans.type === 1) // A records only
          .map((ans: any) => ans.data);
        
        return ips.length > 0 ? ips : null;
      }

      return null;
    } catch (error) {
      // Domain doesn't resolve or timeout
      return null;
    }
  }

  /**
   * Query MX records for email servers
   */
  async queryMXRecords(domain: string): Promise<DNSRecord[]> {
    const cacheKey = `dns:mx:${domain}`;
    const cached = await cacheService.get<DNSRecord[]>(cacheKey);
    if (cached) return cached;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/dns-json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const data = await response.json();
      
      const records: DNSRecord[] = [];
      if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
        for (const ans of data.Answer) {
          if (ans.type === 15) { // MX record
            records.push({
              type: 'MX',
              name: domain,
              value: ans.data,
              ttl: ans.TTL,
            });
          }
        }
      }

      // Cache for 24 hours
      await cacheService.set(cacheKey, records, 'warm');

      return records;
    } catch (error) {
      console.error(`[DNSIntelligence] Error querying MX records for ${domain}:`, error);
      return [];
    }
  }

  /**
   * Aggregate subdomains from multiple DNS sources
   */
  async discoverSubdomains(
    domain: string,
    options: SubdomainDiscoveryOptions = {}
  ): Promise<SubdomainResult[]> {
    const startTime = Date.now();
    const allSubdomains = new Map<string, SubdomainResult>();

    try {
      // Run discovery methods in parallel
      const [commonSubs, certSubs] = await Promise.all([
        this.queryCommonSubdomains(domain),
        options.includeCertTransparency !== false
          ? certificateTransparencyService.discoverSubdomains(domain, options)
          : Promise.resolve([]),
      ]);

      // Merge results, preferring DNS-verified subdomains
      for (const sub of commonSubs) {
        allSubdomains.set(sub.subdomain, sub);
      }

      for (const sub of certSubs) {
        if (!allSubdomains.has(sub.subdomain)) {
          allSubdomains.set(sub.subdomain, sub);
        }
      }

      const results = Array.from(allSubdomains.values());

      console.log(
        `[DNSIntelligence] Found ${results.length} subdomains for ${domain} in ${Date.now() - startTime}ms`
      );

      return results;
    } catch (error) {
      console.error(`[DNSIntelligence] Error discovering subdomains for ${domain}:`, error);
      return [];
    }
  }

  /**
   * Map agency web presence by analyzing subdomains
   */
  async mapAgencyPresence(domain: string): Promise<{
    mainSite?: string;
    emailServers: string[];
    departments: SubdomainResult[];
    portalServices: SubdomainResult[];
  }> {
    const subdomains = await this.discoverSubdomains(domain);
    const mxRecords = await this.queryMXRecords(domain);

    const departments: SubdomainResult[] = [];
    const portalServices: SubdomainResult[] = [];

    // Categorize subdomains by purpose
    for (const sub of subdomains) {
      const name = sub.subdomain.toLowerCase();
      
      // Department keywords
      if (
        name.includes('police') || name.includes('sheriff') ||
        name.includes('court') || name.includes('clerk') ||
        name.includes('records') || name.includes('foia')
      ) {
        departments.push(sub);
      }
      
      // Portal/service keywords
      if (
        name.includes('portal') || name.includes('citizen') ||
        name.includes('service') || name.includes('transparency') ||
        name.includes('open') || name.includes('data')
      ) {
        portalServices.push(sub);
      }
    }

    return {
      mainSite: domain,
      emailServers: mxRecords.map(r => r.value),
      departments,
      portalServices,
    };
  }
}

export const dnsIntelligenceService = new DNSIntelligenceService();
