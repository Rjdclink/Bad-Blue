/**
 * ML Entity Resolution Worker
 * 
 * Uses machine learning techniques to resolve entities across multiple sources
 * Determines when different records refer to the same person
 * 
 * Uses fast-levenshtein for fuzzy string matching
 * Implements a simple scoring model for entity resolution
 */

import * as levenshteinModule from 'fast-levenshtein';

// Work around TypeScript/CommonJS interop issue
// The module exports a default object with a 'get' method
const levenshtein = (levenshteinModule as any).default || levenshteinModule;
import { Worker, WorkerInput, WorkerOutput } from './workerOrchestrator';
import { logger } from '../../logger';

export interface EntityRecord {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  organization?: string;
  badge?: string;
  source: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface ResolvedEntity {
  primaryId: string;
  primaryName: string;
  names: string[];
  emails: string[];
  phones: string[];
  locations: string[];
  organizations: string[];
  badges: string[];
  sources: string[];
  records: EntityRecord[];
  confidence: number;
  matchScore: number;
}

export interface EntityCluster {
  clusterId: string;
  entities: ResolvedEntity[];
  clusterType: 'identity' | 'organization' | 'network';
  confidence: number;
}

/**
 * ML Entity Resolution Worker
 */
export class MLEntityResolutionWorker implements Worker {
  name = 'ml_entity_resolution_worker';

  // Thresholds for matching
  private readonly NAME_MATCH_THRESHOLD = 0.7;
  private readonly EMAIL_MATCH_THRESHOLD = 0.9;
  private readonly PHONE_MATCH_THRESHOLD = 0.85;

  async process(input: WorkerInput): Promise<WorkerOutput> {
    if (!input.entities || !Array.isArray(input.entities)) {
      return {
        success: false,
        error: 'No entities provided for resolution',
      };
    }

    try {
      const records = input.entities as EntityRecord[];
      const resolvedEntities = await this.resolveEntities(records);
      const clusters = await this.clusterEntities(resolvedEntities);

      return {
        success: true,
        data: {
          resolvedEntities,
          clusters,
          totalRecords: records.length,
          uniqueEntities: resolvedEntities.length,
          totalClusters: clusters.length,
        },
        confidence: this.calculateOverallConfidence(resolvedEntities),
      };
    } catch (error) {
      logger.error('[ML Entity Resolution Worker] Processing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Test basic entity resolution
      const testRecords: EntityRecord[] = [
        { name: 'John Doe', email: 'john@example.com', source: 'test1' },
        { name: 'John Doe', email: 'john@example.com', source: 'test2' },
      ];
      const resolved = await this.resolveEntities(testRecords);
      return resolved.length > 0;
    } catch (error) {
      logger.error('[ML Entity Resolution Worker] Health check failed:', error);
      return false;
    }
  }

  /**
   * Resolve entities - group records that refer to the same person
   */
  private async resolveEntities(records: EntityRecord[]): Promise<ResolvedEntity[]> {
    const resolved: ResolvedEntity[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < records.length; i++) {
      if (processed.has(i)) continue;

      const primaryRecord = records[i];
      const matches: EntityRecord[] = [primaryRecord];
      processed.add(i);

      // Find matching records
      for (let j = i + 1; j < records.length; j++) {
        if (processed.has(j)) continue;

        const candidate = records[j];
        const matchScore = this.calculateMatchScore(primaryRecord, candidate);

        if (matchScore >= 0.7) {
          matches.push(candidate);
          processed.add(j);
        }
      }

      // Create resolved entity
      const entity = this.mergeRecords(matches);
      resolved.push(entity);
    }

    return resolved;
  }

  /**
   * Calculate match score between two records
   */
  private calculateMatchScore(record1: EntityRecord, record2: EntityRecord): number {
    let score = 0;
    let weights = 0;

    // Name matching (highest weight)
    if (record1.name && record2.name) {
      const nameScore = this.fuzzyMatchNames(record1.name, record2.name);
      score += nameScore * 0.4;
      weights += 0.4;
    }

    // Email matching (exact match preferred)
    if (record1.email && record2.email) {
      const emailScore = record1.email.toLowerCase() === record2.email.toLowerCase() 
        ? 1.0 
        : this.fuzzyMatchString(record1.email, record2.email);
      score += emailScore * 0.3;
      weights += 0.3;
    }

    // Phone matching
    if (record1.phone && record2.phone) {
      const phone1 = this.normalizePhone(record1.phone);
      const phone2 = this.normalizePhone(record2.phone);
      const phoneScore = phone1 === phone2 ? 1.0 : 0;
      score += phoneScore * 0.2;
      weights += 0.2;
    }

    // Badge matching (law enforcement specific)
    if (record1.badge && record2.badge) {
      const badgeScore = record1.badge === record2.badge ? 1.0 : 0;
      score += badgeScore * 0.1;
      weights += 0.1;
    }

    return weights > 0 ? score / weights : 0;
  }

  /**
   * Fuzzy match two names
   */
  private fuzzyMatchNames(name1: string, name2: string): number {
    const norm1 = this.normalizeName(name1);
    const norm2 = this.normalizeName(name2);

    // Try exact match first
    if (norm1 === norm2) return 1.0;

    // Try first/last name matching
    const parts1 = norm1.split(' ');
    const parts2 = norm2.split(' ');

    // Check if last names match (common case)
    if (parts1.length >= 2 && parts2.length >= 2) {
      const lastName1 = parts1[parts1.length - 1];
      const lastName2 = parts2[parts2.length - 1];
      
      if (lastName1 === lastName2) {
        // Last names match, check first names
        const firstName1 = parts1[0];
        const firstName2 = parts2[0];
        
        if (firstName1[0] === firstName2[0]) {
          return 0.9; // Same last name, same first initial
        }
      }
    }

    // Fall back to Levenshtein distance
    return this.fuzzyMatchString(norm1, norm2);
  }

  /**
   * Fuzzy match two strings using Levenshtein distance
   */
  private fuzzyMatchString(str1: string, str2: string): number {
    const distance = levenshtein.get(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength > 0 ? 1 - (distance / maxLength) : 0;
  }

  /**
   * Normalize name for matching
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z\s]/g, '');
  }

  /**
   * Normalize phone number
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Merge multiple records into a single resolved entity
   */
  private mergeRecords(records: EntityRecord[]): ResolvedEntity {
    const entity: ResolvedEntity = {
      primaryId: records[0].id || this.generateId(),
      primaryName: records[0].name,
      names: [],
      emails: [],
      phones: [],
      locations: [],
      organizations: [],
      badges: [],
      sources: [],
      records,
      confidence: 0,
      matchScore: 0,
    };

    // Collect unique values from all records
    const uniqueNames = new Set<string>();
    const uniqueEmails = new Set<string>();
    const uniquePhones = new Set<string>();
    const uniqueLocations = new Set<string>();
    const uniqueOrgs = new Set<string>();
    const uniqueBadges = new Set<string>();
    const uniqueSources = new Set<string>();

    records.forEach(record => {
      if (record.name) uniqueNames.add(record.name);
      if (record.email) uniqueEmails.add(record.email.toLowerCase());
      if (record.phone) uniquePhones.add(this.normalizePhone(record.phone));
      if (record.location) uniqueLocations.add(record.location);
      if (record.organization) uniqueOrgs.add(record.organization);
      if (record.badge) uniqueBadges.add(record.badge);
      uniqueSources.add(record.source);
    });

    entity.names = Array.from(uniqueNames);
    entity.emails = Array.from(uniqueEmails);
    entity.phones = Array.from(uniquePhones);
    entity.locations = Array.from(uniqueLocations);
    entity.organizations = Array.from(uniqueOrgs);
    entity.badges = Array.from(uniqueBadges);
    entity.sources = Array.from(uniqueSources);

    // Calculate confidence based on number of sources and data completeness
    entity.confidence = this.calculateEntityConfidence(entity);
    entity.matchScore = records.length > 1 ? 0.85 : 1.0;

    return entity;
  }

  /**
   * Calculate confidence for a resolved entity
   */
  private calculateEntityConfidence(entity: ResolvedEntity): number {
    let score = 0;

    // More sources = higher confidence
    score += Math.min(entity.sources.length * 0.15, 0.3);

    // More data fields = higher confidence
    if (entity.emails.length > 0) score += 0.2;
    if (entity.phones.length > 0) score += 0.15;
    if (entity.locations.length > 0) score += 0.1;
    if (entity.organizations.length > 0) score += 0.1;
    if (entity.badges.length > 0) score += 0.15;

    return Math.min(score * 100, 100);
  }

  /**
   * Cluster entities into groups
   */
  private async clusterEntities(entities: ResolvedEntity[]): Promise<EntityCluster[]> {
    const clusters: EntityCluster[] = [];

    // Group by organization
    const orgMap = new Map<string, ResolvedEntity[]>();
    entities.forEach(entity => {
      entity.organizations.forEach(org => {
        if (!orgMap.has(org)) {
          orgMap.set(org, []);
        }
        orgMap.get(org)!.push(entity);
      });
    });

    // Create organization clusters
    orgMap.forEach((members, org) => {
      if (members.length >= 2) {
        clusters.push({
          clusterId: this.generateId(),
          entities: members,
          clusterType: 'organization',
          confidence: 75,
        });
      }
    });

    return clusters;
  }

  /**
   * Calculate overall confidence
   */
  private calculateOverallConfidence(entities: ResolvedEntity[]): number {
    if (entities.length === 0) return 0;

    const avgConfidence = entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length;
    return avgConfidence;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const mlEntityResolutionWorker = new MLEntityResolutionWorker();
