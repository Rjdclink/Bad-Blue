/**
 * Certificate Transparency Service
 * Queries certificate transparency logs (crt.sh) for subdomain discovery
 * Pattern from TheHarvester's certificate transparency module
 */

import type { CertificateInfo, SubdomainResult, SubdomainDiscoveryOptions } from './types';
import { cacheService } from '../redisCache';

interface CrtShEntry {
  issuer_ca_id: number;
  issuer_name: string;
  common_name: string;
  name_value: string;
  id: number;
  entry_timestamp: string;
  not_before: string;
  not_after: string;
  serial_number: string;
}

export class CertificateTransparencyService {
  private readonly baseUrl = 'https://crt.sh/';
  private readonly timeout = 15000; // 15 seconds

  /**
   * Query crt.sh for certificates associated with a domain
   */
  async queryCertificates(domain: string): Promise<CertificateInfo[]> {
    const cacheKey = `cert:${domain}`;
    const cached = await cacheService.get<CertificateInfo[]>(cacheKey);
    if (cached) return cached;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const url = `${this.baseUrl}?q=%.${domain}&output=json`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LegalWhat-Intelligence/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`crt.sh returned status ${response.status}`);
      }

      const data: CrtShEntry[] = await response.json();
      const certificates = this.parseCertificates(data);

      // Cache for 24 hours
      await cacheService.set(cacheKey, certificates, 'warm');

      return certificates;
    } catch (error) {
      console.error(`[CertTransparency] Error querying crt.sh for ${domain}:`, error);
      return [];
    }
  }

  /**
   * Parse crt.sh entries into CertificateInfo objects
   */
  private parseCertificates(entries: CrtShEntry[]): CertificateInfo[] {
    const certificatesMap = new Map<string, CertificateInfo>();

    for (const entry of entries) {
      const serialNumber = entry.serial_number;
      
      // Skip duplicates by serial number
      if (certificatesMap.has(serialNumber)) continue;

      // Parse Subject Alternative Names (SANs)
      const sans = entry.name_value
        .split('\n')
        .map(name => name.trim())
        .filter(name => name.length > 0);

      const cert: CertificateInfo = {
        commonName: entry.common_name,
        subjectAlternativeNames: sans,
        issuer: entry.issuer_name,
        validFrom: new Date(entry.not_before),
        validTo: new Date(entry.not_after),
        serialNumber: serialNumber,
      };

      certificatesMap.set(serialNumber, cert);
    }

    return Array.from(certificatesMap.values());
  }

  /**
   * Extract unique subdomains from certificates
   */
  extractSubdomains(
    certificates: CertificateInfo[],
    baseDomain: string
  ): SubdomainResult[] {
    const subdomainMap = new Map<string, SubdomainResult>();

    for (const cert of certificates) {
      const allNames = [cert.commonName, ...cert.subjectAlternativeNames];

      for (const name of allNames) {
        // Clean and validate subdomain
        const cleanName = name.toLowerCase().replace(/^\*\./, '');
        
        if (!cleanName.endsWith(baseDomain) || cleanName === baseDomain) {
          continue;
        }

        // Skip wildcards and invalid entries
        if (cleanName.includes('*')) continue;

        if (!subdomainMap.has(cleanName)) {
          const isActive = cert.validTo > new Date();
          
          subdomainMap.set(cleanName, {
            subdomain: cleanName,
            ipAddresses: [],
            source: 'cert',
            status: isActive ? 'active' : 'inactive',
            discoveredAt: new Date(),
          });
        }
      }
    }

    return Array.from(subdomainMap.values());
  }

  /**
   * Discover subdomains for a domain using certificate transparency
   */
  async discoverSubdomains(
    domain: string,
    options: SubdomainDiscoveryOptions = {}
  ): Promise<SubdomainResult[]> {
    const startTime = Date.now();

    try {
      const certificates = await this.queryCertificates(domain);
      const subdomains = this.extractSubdomains(certificates, domain);

      console.log(
        `[CertTransparency] Found ${subdomains.length} subdomains for ${domain} in ${Date.now() - startTime}ms`
      );

      return subdomains;
    } catch (error) {
      console.error(`[CertTransparency] Error discovering subdomains for ${domain}:`, error);
      return [];
    }
  }

  /**
   * Search for government email patterns in certificate data
   */
  async findGovernmentEmails(domain: string): Promise<string[]> {
    const cacheKey = `cert:emails:${domain}`;
    const cached = await cacheService.get<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const certificates = await this.queryCertificates(domain);
      const emails = new Set<string>();

      // Email regex pattern
      const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;

      for (const cert of certificates) {
        // Check common name
        const cnEmails = cert.commonName.match(emailRegex);
        if (cnEmails) {
          cnEmails.forEach(email => emails.add(email.toLowerCase()));
        }

        // Check SANs
        for (const san of cert.subjectAlternativeNames) {
          const sanEmails = san.match(emailRegex);
          if (sanEmails) {
            sanEmails.forEach(email => emails.add(email.toLowerCase()));
          }
        }
      }

      const emailArray = Array.from(emails);

      // Cache for 24 hours
      await cacheService.set(cacheKey, emailArray, 'warm');

      return emailArray;
    } catch (error) {
      console.error(`[CertTransparency] Error finding emails for ${domain}:`, error);
      return [];
    }
  }
}

export const certificateTransparencyService = new CertificateTransparencyService();
