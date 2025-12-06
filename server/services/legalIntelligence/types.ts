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
