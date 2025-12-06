/**
 * Legal Intelligence Type Definitions
 * Core types for TheHarvester-style email and DNS intelligence
 */

export interface EmailResult {
  email: string;
  source: 'google' | 'bing' | 'pgp' | 'cert' | 'dns' | 'hunter' | 'pattern';
  confidence: number;
  metadata: {
    firstName?: string;
    lastName?: string;
    title?: string;
    department?: string;
    domain: string;
  };
  discoveredAt?: Date;
}

export interface SubdomainResult {
  subdomain: string;
  ipAddresses: string[];
  source: 'dns' | 'cert' | 'search';
  status: 'active' | 'inactive' | 'unknown';
  purpose?: string;
  discoveredAt?: Date;
}

export interface FOIAContact {
  name?: string;
  email: string;
  phone?: string;
  department: string;
  agency: string;
  confidence: number;
  sources: string[];
  discoveredAt?: Date;
}

export interface CertificateInfo {
  commonName: string;
  subjectAlternativeNames: string[];
  issuer: string;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
}

export interface DNSRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS';
  name: string;
  value: string;
  ttl?: number;
}

export interface EmailDiscoveryOptions {
  includeSearchEngines?: boolean;
  includePGP?: boolean;
  includeCertTransparency?: boolean;
  includeDNS?: boolean;
  includeHunter?: boolean;
  maxResults?: number;
  timeout?: number;
}

export interface SubdomainDiscoveryOptions {
  includeCertTransparency?: boolean;
  includeDNS?: boolean;
  includeSearchEngines?: boolean;
  maxResults?: number;
  timeout?: number;
}

export interface EmailDiscoveryResult {
  emails: EmailResult[];
  subdomains: SubdomainResult[];
  totalFound: number;
  sources: string[];
  searchDuration: number;
  errors: string[];
}

export interface SubdomainDiscoveryResult {
  subdomains: SubdomainResult[];
  certificates: CertificateInfo[];
  dnsRecords: DNSRecord[];
  totalFound: number;
  sources: string[];
  searchDuration: number;
  errors: string[];
}
