/**
 * ArtifactVault - Step 6: Artifact Storage and Retrieval
 * 
 * ARCHITECTURE: Stores artifacts from extraction runs for:
 * 
 * 1. DEBUGGING:
 *    - HTML snapshots from Playwright
 *    - Network request/response logs
 *    - Console logs
 * 
 * 2. REPLAY:
 *    - Enable deterministic replay without network
 *    - Hook into Monte Carlo for stable testing
 * 
 * 3. PROVENANCE:
 *    - Track what artifacts were used
 *    - Include retrieval handles in results
 * 
 * 4. PRIVACY:
 *    - Optional PII scrubbing
 *    - TTL-based expiration
 *    - Configurable retention
 */

import type { RequiredField } from '../router/CapabilityRouter';

// ============================================
// ARTIFACT TYPES
// ============================================

/**
 * Types of artifacts that can be stored
 */
export type ArtifactType = 
  | 'html_snapshot'
  | 'network_log'
  | 'console_log'
  | 'extracted_data'
  | 'screenshot'
  | 'element_text'
  | 'api_response';

/**
 * A stored artifact
 */
export interface StoredArtifact {
  /** Unique artifact ID */
  artifactId: string;
  
  /** Type of artifact */
  type: ArtifactType;
  
  /** The artifact data */
  data: string | object;
  
  /** Metadata */
  metadata: ArtifactMetadata;
  
  /** When artifact was stored */
  storedAt: Date;
  
  /** TTL for this artifact in milliseconds */
  ttlMs: number;
  
  /** Size in bytes */
  sizeBytes: number;
}

/**
 * Artifact metadata
 */
export interface ArtifactMetadata {
  /** URL where artifact was captured */
  url?: string;
  
  /** Domain */
  domain?: string;
  
  /** Tier that produced the artifact */
  tier: string;
  
  /** Fields this artifact helped resolve */
  gapsSolved: RequiredField[];
  
  /** Search query that produced this artifact */
  searchContext?: {
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
  };
  
  /** Additional context */
  extra?: Record<string, any>;
}

/**
 * Artifact retrieval handle (included in provenance)
 */
export interface ArtifactHandle {
  artifactId: string;
  type: ArtifactType;
  storedAt: Date;
  sizeBytes: number;
}

/**
 * Collection of artifacts from a single run
 */
export interface ArtifactCollection {
  /** Unique collection ID */
  collectionId: string;
  
  /** Individual artifact handles */
  artifacts: ArtifactHandle[];
  
  /** When collection was created */
  createdAt: Date;
  
  /** Search context */
  searchContext?: ArtifactMetadata['searchContext'];
  
  /** Total size of all artifacts */
  totalSizeBytes: number;
}

// ============================================
// VAULT CONFIGURATION
// ============================================

export interface ArtifactVaultConfig {
  /** Whether vault is enabled */
  enabled: boolean;
  
  /** Maximum total storage in bytes */
  maxStorageBytes: number;
  
  /** Maximum artifacts to store */
  maxArtifacts: number;
  
  /** Default TTL for artifacts in milliseconds */
  defaultTtlMs: number;
  
  /** Whether to scrub potential PII from artifacts */
  scrubPii: boolean;
  
  /** PII patterns to scrub (regex strings) */
  piiPatterns?: string[];
  
  /** Whether to persist to disk */
  persistToDisk: boolean;
  
  /** Path for disk persistence */
  persistPath?: string;
}

export const DEFAULT_ARTIFACT_VAULT_CONFIG: ArtifactVaultConfig = {
  enabled: true,
  maxStorageBytes: 100 * 1024 * 1024, // 100MB
  maxArtifacts: 1000,
  defaultTtlMs: 24 * 60 * 60 * 1000, // 24 hours
  scrubPii: true,
  piiPatterns: [
    // SSN pattern
    '\\b\\d{3}-\\d{2}-\\d{4}\\b',
    // Credit card pattern
    '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b',
    // Email pattern (partial scrub)
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    // Phone pattern
    '\\b\\d{3}[-.\\s]?\\d{3}[-.\\s]?\\d{4}\\b',
  ],
  persistToDisk: false,
};

// ============================================
// ARTIFACT VAULT CLASS
// ============================================

/**
 * ArtifactVault - Stores and retrieves extraction artifacts
 */
export class ArtifactVault {
  private config: ArtifactVaultConfig;
  private artifacts: Map<string, StoredArtifact> = new Map();
  private collections: Map<string, ArtifactCollection> = new Map();
  private totalSizeBytes = 0;
  private piiRegexes: RegExp[] = [];
  
  private metrics = {
    stores: 0,
    retrievals: 0,
    evictions: 0,
    collectionsCreated: 0,
  };
  
  constructor(config?: Partial<ArtifactVaultConfig>) {
    this.config = {
      ...DEFAULT_ARTIFACT_VAULT_CONFIG,
      ...config,
    };
    
    // Compile PII patterns
    if (this.config.scrubPii && this.config.piiPatterns) {
      this.piiRegexes = this.config.piiPatterns.map(p => new RegExp(p, 'g'));
    }
  }
  
  /**
   * Generate unique artifact ID
   */
  private generateArtifactId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `art_${timestamp}_${random}`;
  }
  
  /**
   * Generate unique collection ID
   */
  private generateCollectionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `col_${timestamp}_${random}`;
  }
  
  /**
   * Calculate size of data in bytes
   */
  private calculateSize(data: string | object): number {
    if (typeof data === 'string') {
      return new TextEncoder().encode(data).length;
    }
    return new TextEncoder().encode(JSON.stringify(data)).length;
  }
  
  /**
   * Scrub PII from string data
   */
  private scrubPii(data: string): string {
    if (!this.config.scrubPii) return data;
    
    let scrubbed = data;
    for (const regex of this.piiRegexes) {
      scrubbed = scrubbed.replace(regex, '[REDACTED]');
    }
    return scrubbed;
  }
  
  /**
   * Check if artifact is expired
   */
  private isExpired(artifact: StoredArtifact): boolean {
    const age = Date.now() - artifact.storedAt.getTime();
    return age > artifact.ttlMs;
  }
  
  /**
   * Evict expired artifacts
   */
  private evictExpired(): void {
    for (const [id, artifact] of this.artifacts.entries()) {
      if (this.isExpired(artifact)) {
        this.totalSizeBytes -= artifact.sizeBytes;
        this.artifacts.delete(id);
        this.metrics.evictions++;
      }
    }
  }
  
  /**
   * Evict oldest artifacts until under storage limit
   */
  private evictToFit(requiredBytes: number): void {
    const targetSize = this.config.maxStorageBytes - requiredBytes;
    
    // Sort by age (oldest first)
    const sorted = Array.from(this.artifacts.entries())
      .sort((a, b) => a[1].storedAt.getTime() - b[1].storedAt.getTime());
    
    for (const [id, artifact] of sorted) {
      if (this.totalSizeBytes <= targetSize) break;
      
      this.totalSizeBytes -= artifact.sizeBytes;
      this.artifacts.delete(id);
      this.metrics.evictions++;
    }
  }
  
  /**
   * Store an artifact
   */
  store(
    type: ArtifactType,
    data: string | object,
    metadata: ArtifactMetadata,
    ttlMs?: number
  ): StoredArtifact | null {
    if (!this.config.enabled) {
      return null;
    }
    
    // Evict expired artifacts first
    this.evictExpired();
    
    // Process data
    let processedData = data;
    if (typeof data === 'string' && this.config.scrubPii) {
      processedData = this.scrubPii(data);
    }
    
    const sizeBytes = this.calculateSize(processedData);
    
    // Check if we need to evict to fit
    if (this.totalSizeBytes + sizeBytes > this.config.maxStorageBytes) {
      this.evictToFit(sizeBytes);
    }
    
    // Check artifact count limit
    if (this.artifacts.size >= this.config.maxArtifacts) {
      this.evictToFit(sizeBytes);
    }
    
    const artifact: StoredArtifact = {
      artifactId: this.generateArtifactId(),
      type,
      data: processedData,
      metadata,
      storedAt: new Date(),
      ttlMs: ttlMs ?? this.config.defaultTtlMs,
      sizeBytes,
    };
    
    this.artifacts.set(artifact.artifactId, artifact);
    this.totalSizeBytes += sizeBytes;
    this.metrics.stores++;
    
    return artifact;
  }
  
  /**
   * Retrieve an artifact by ID
   */
  retrieve(artifactId: string): StoredArtifact | null {
    this.metrics.retrievals++;
    
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return null;
    }
    
    if (this.isExpired(artifact)) {
      this.artifacts.delete(artifactId);
      this.totalSizeBytes -= artifact.sizeBytes;
      this.metrics.evictions++;
      return null;
    }
    
    return artifact;
  }
  
  /**
   * Create artifact handle for provenance
   */
  createHandle(artifact: StoredArtifact): ArtifactHandle {
    return {
      artifactId: artifact.artifactId,
      type: artifact.type,
      storedAt: artifact.storedAt,
      sizeBytes: artifact.sizeBytes,
    };
  }
  
  /**
   * Create a collection of artifacts
   */
  createCollection(
    artifacts: StoredArtifact[],
    searchContext?: ArtifactMetadata['searchContext']
  ): ArtifactCollection {
    const collection: ArtifactCollection = {
      collectionId: this.generateCollectionId(),
      artifacts: artifacts.map(a => this.createHandle(a)),
      createdAt: new Date(),
      searchContext,
      totalSizeBytes: artifacts.reduce((sum, a) => sum + a.sizeBytes, 0),
    };
    
    this.collections.set(collection.collectionId, collection);
    this.metrics.collectionsCreated++;
    
    return collection;
  }
  
  /**
   * Get a collection by ID
   */
  getCollection(collectionId: string): ArtifactCollection | null {
    return this.collections.get(collectionId) ?? null;
  }
  
  /**
   * Retrieve all artifacts in a collection
   */
  retrieveCollection(collectionId: string): StoredArtifact[] {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      return [];
    }
    
    const artifacts: StoredArtifact[] = [];
    for (const handle of collection.artifacts) {
      const artifact = this.retrieve(handle.artifactId);
      if (artifact) {
        artifacts.push(artifact);
      }
    }
    
    return artifacts;
  }
  
  /**
   * Store multiple artifacts from a Playwright run
   */
  storePlaywrightArtifacts(
    htmlSnapshot: string | undefined,
    elementTexts: Record<string, string>,
    networkLogs: any[],
    consoleLogs: any[],
    metadata: Omit<ArtifactMetadata, 'extra'>
  ): ArtifactCollection {
    const artifacts: StoredArtifact[] = [];
    
    // Store HTML snapshot
    if (htmlSnapshot) {
      const artifact = this.store('html_snapshot', htmlSnapshot, metadata);
      if (artifact) artifacts.push(artifact);
    }
    
    // Store element texts
    if (Object.keys(elementTexts).length > 0) {
      const artifact = this.store('element_text', elementTexts, metadata);
      if (artifact) artifacts.push(artifact);
    }
    
    // Store network logs
    if (networkLogs.length > 0) {
      const artifact = this.store('network_log', networkLogs, metadata);
      if (artifact) artifacts.push(artifact);
    }
    
    // Store console logs
    if (consoleLogs.length > 0) {
      const artifact = this.store('console_log', consoleLogs, metadata);
      if (artifact) artifacts.push(artifact);
    }
    
    return this.createCollection(artifacts, metadata.searchContext);
  }
  
  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      artifactCount: this.artifacts.size,
      collectionCount: this.collections.size,
      totalSizeBytes: this.totalSizeBytes,
      storageUsagePercent: (this.totalSizeBytes / this.config.maxStorageBytes) * 100,
    };
  }
  
  /**
   * Clear all artifacts
   */
  clear(): void {
    this.artifacts.clear();
    this.collections.clear();
    this.totalSizeBytes = 0;
  }
  
  /**
   * Export artifacts for persistence
   */
  export(): { artifacts: StoredArtifact[]; collections: ArtifactCollection[] } {
    this.evictExpired();
    return {
      artifacts: Array.from(this.artifacts.values()),
      collections: Array.from(this.collections.values()),
    };
  }
  
  /**
   * Import artifacts from persistence
   */
  import(data: { artifacts: StoredArtifact[]; collections: ArtifactCollection[] }): void {
    for (const artifact of data.artifacts) {
      if (!this.isExpired(artifact)) {
        this.artifacts.set(artifact.artifactId, artifact);
        this.totalSizeBytes += artifact.sizeBytes;
      }
    }
    for (const collection of data.collections) {
      this.collections.set(collection.collectionId, collection);
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

/** Global artifact vault instance */
export const artifactVault = new ArtifactVault();

/** Factory function */
export function createArtifactVault(config?: Partial<ArtifactVaultConfig>): ArtifactVault {
  return new ArtifactVault(config);
}
