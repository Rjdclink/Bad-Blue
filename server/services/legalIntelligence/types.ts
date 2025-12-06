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

/**
 * Phase 2: SpiderFoot Legal Entity Correlation Types
 */

// Entity Node in the correlation graph
export interface EntityNode {
  id: string;
  type: 'officer' | 'department' | 'lawsuit' | 'complaint' | 'witness' | 'attorney' | 'agency' | 'case' | 'person' | 'organization';
  properties: Record<string, any>;
  confidence: number;
  sources: string[];
  discoveredAt: Date;
  updatedAt?: Date;
}

// Entity Edge representing relationships
export interface EntityEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  confidence: number;
  evidenceIds: string[];
  discoveredAt: Date;
}

// Intelligence Event for the event bus
export interface IntelligenceEvent {
  id: string;
  type: string;
  entityId?: string;
  data: any;
  sourceModule: string;
  timestamp: Date;
  processed: boolean;
}

// Event handler function type
export type EventHandler = (event: IntelligenceEvent) => Promise<void>;

// Module interface (SpiderFoot plugin pattern)
export interface LegalIntelligenceModule {
  name: string;
  description: string;
  inputTypes: string[]; // Event types this module listens for
  outputTypes: string[]; // Event types this module produces
  
  // SpiderFoot's handleEvent pattern
  handleEvent(event: IntelligenceEvent): Promise<IntelligenceEvent[]>;
  
  // Module lifecycle
  setup(): Promise<void>;
  enrichData(data: any): Promise<any>;
  shutdown(): Promise<void>;
}

// Correlation Rule definition
export interface CorrelationRule {
  name: string;
  entities: string[];
  condition: string;
  confidence: number;
  patternType: string;
  description?: string;
  enabled?: boolean;
}

// Pattern Detection Result
export interface DetectedPattern {
  id: string;
  type: string;
  entityIds: string[];
  confidence: number;
  description: string;
  evidence: any[];
  detectedAt: Date;
  temporal?: {
    startDate?: Date;
    endDate?: Date;
    frequency?: string;
  };
  geographic?: {
    locations: string[];
    clustering?: any;
  };
}

// Module Task for thread pool
export interface ModuleTask {
  module: LegalIntelligenceModule;
  event: IntelligenceEvent;
  priority: number;
}

// Graph visualization data for export
export interface GraphVisualization {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    group: string;
    confidence: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label: string;
    weight: number;
    confidence: number;
  }>;
}

// Database entity record
export interface DBEntity {
  id: string;
  type: string;
  properties: string; // JSON string
  confidence: number;
  created_at: string;
  updated_at: string;
}

// Database relationship record
export interface DBRelationship {
  id: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  weight: number;
  confidence: number;
  evidence: string; // JSON string
  created_at: string;
}

// Database correlation event record
export interface DBCorrelationEvent {
  id: string;
  entity_id: string;
  event_type: string;
  data: string; // JSON string
  module_name: string;
  created_at: string;
}

/**
 * Phase 3B: Adaptive Crawler + Browser Manager Types
 */

// Browser types for multi-browser support
export type BrowserType = 'chromium' | 'firefox' | 'webkit';

// Browser session information
export interface BrowserSession {
  id: string;
  type: BrowserType;
  browser: any; // Playwright Browser instance
  context: any; // Playwright BrowserContext instance
  pages: any[]; // Active pages
  createdAt: Date;
  lastUsedAt: Date;
  requestCount: number;
}

// Browser configuration options
export interface BrowserConfig {
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
  };
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
}

// Stop conditions for adaptive crawling
export interface StopCondition {
  minItems?: number;      // Found enough items
  maxDepth?: number;      // Depth limit
  maxPages?: number;      // Page limit
  maxTime?: number;       // Time limit in ms
  custom?: (data: any[]) => boolean;  // Custom logic
}

// Crawl configuration
export interface CrawlConfig {
  startUrl: string;
  schema?: any; // ExtractionSchema from schemas.ts
  stopCondition: StopCondition;
  browserType?: BrowserType;
  followLinks?: boolean;
  linkSelector?: string;
  maxConcurrent?: number;
  respectRobotsTxt?: boolean;
  userAgent?: string;
}

// Crawl result with metadata
export interface CrawlResult {
  success: boolean;
  data: any[];
  pagesVisited: number;
  depth: number;
  duration: number;
  errors?: string[];
  stopReason?: string;
}

// URL priority for link prioritization
export interface UrlPriority {
  url: string;
  priority: number;
  depth: number;
  parent?: string;
}

// Docket entry structure
export interface DocketEntry {
  date: Date | string;
  description: string;
  document?: string;
  filedBy?: string;
}

// Court docket schema (PACER + state courts)
export interface CourtDocket {
  caseNumber: string;
  parties: string[];
  filingDate: Date | string;
  status: string;
  judge?: string;
  court?: string;
  jurisdiction?: string;
  docketEntries: DocketEntry[];
}

// Statute with amendments
export interface StatuteData {
  citation: string;
  title: string;
  text: string;
  effectiveDate?: Date | string;
  amendments?: Array<{
    date: Date | string;
    description: string;
  }>;
  jurisdiction: string;
  source: string;
}

// Officer disciplinary record
export interface OfficerDisciplinaryRecord {
  date: Date | string;
  type: string;
  description: string;
  outcome?: string;
  status?: string;
}

// Officer record from transparency portals
export interface OfficerRecordData {
  name: string;
  badgeNumber?: string;
  department: string;
  rank?: string;
  status?: string;
  hireDate?: Date | string;
  complaints?: OfficerDisciplinaryRecord[];
  commendations?: Array<{
    date: Date | string;
    description: string;
  }>;
  source: string;
}

// Case precedent for legal research
export interface CasePrecedent {
  caseName: string;
  citation: string;
  court: string;
  jurisdiction: string;
  decisionDate: Date | string;
  holding: string;
  reasoning?: string;
  relevanceScore?: number;
  judges?: string[];
  source: string;
}
