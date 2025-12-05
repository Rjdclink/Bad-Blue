/**
 * ML Clustering Worker for Orchestration
 * 
 * Clusters and links entities (people, organizations, cases, documents, evidence)
 * across the orchestrated system using ML techniques.
 */

import { createLogger } from '../../logger';
import levenshtein from 'fast-levenshtein';

const log = createLogger('MLClusteringWorker');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Entity {
  id: string;
  type: 'person' | 'organization' | 'case' | 'document' | 'evidence' | 'location' | 'event';
  name: string;
  attributes: Record<string, any>;
  source: string;
  confidence?: number;
}

export interface EntityCluster {
  id: string;
  type: Entity['type'];
  primaryEntity: Entity;
  relatedEntities: Entity[];
  confidence: number; // 0-1
  linkType: 'exact-match' | 'fuzzy-match' | 'contextual' | 'network';
  reasoning: string;
}

export interface EntityRelationship {
  entity1Id: string;
  entity2Id: string;
  relationshipType: 'associated-with' | 'works-for' | 'related-to' | 'located-at' | 
                    'participant-in' | 'references' | 'contradicts';
  strength: number; // 0-1
  evidence: string[];
}

export interface ClusteringResult {
  clusters: EntityCluster[];
  relationships: EntityRelationship[];
  isolatedEntities: Entity[];
  statistics: {
    totalEntities: number;
    totalClusters: number;
    avgClusterSize: number;
    totalRelationships: number;
  };
}

// ============================================================================
// SIMILARITY CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  
  const distance = levenshtein.get(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  
  return maxLength > 0 ? 1 - (distance / maxLength) : 0;
}

/**
 * Calculate entity similarity based on multiple attributes
 */
function calculateEntitySimilarity(entity1: Entity, entity2: Entity): number {
  // Different types don't match (except person/organization connections)
  if (entity1.type !== entity2.type) {
    return 0;
  }

  let totalScore = 0;
  let weights = 0;

  // Name similarity (highest weight)
  const nameSimilarity = calculateStringSimilarity(entity1.name, entity2.name);
  totalScore += nameSimilarity * 0.4;
  weights += 0.4;

  // Attribute similarity
  const commonKeys = Object.keys(entity1.attributes).filter(k => 
    entity2.attributes.hasOwnProperty(k)
  );

  for (const key of commonKeys) {
    const val1 = String(entity1.attributes[key]);
    const val2 = String(entity2.attributes[key]);
    
    if (val1 && val2) {
      const attrSimilarity = calculateStringSimilarity(val1, val2);
      totalScore += attrSimilarity * 0.6 / commonKeys.length;
      weights += 0.6 / commonKeys.length;
    }
  }

  return weights > 0 ? totalScore / weights : nameSimilarity;
}

/**
 * Extract keywords from entity for contextual matching
 */
function extractEntityKeywords(entity: Entity): Set<string> {
  const keywords = new Set<string>();
  
  // Add name tokens
  entity.name.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 2) keywords.add(word);
  });
  
  // Add attribute values
  for (const value of Object.values(entity.attributes)) {
    if (typeof value === 'string') {
      value.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 2) keywords.add(word);
      });
    }
  }
  
  return keywords;
}

/**
 * Calculate contextual similarity based on shared keywords
 */
function calculateContextualSimilarity(entity1: Entity, entity2: Entity): number {
  const keywords1 = extractEntityKeywords(entity1);
  const keywords2 = extractEntityKeywords(entity2);
  
  const intersection = new Set([...keywords1].filter(k => keywords2.has(k)));
  const union = new Set([...keywords1, ...keywords2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

// ============================================================================
// CLUSTERING FUNCTIONS
// ============================================================================

/**
 * Cluster entities based on similarity
 */
export async function clusterEntities(
  entities: Entity[],
  similarityThreshold: number = 0.7
): Promise<EntityCluster[]> {
  log.info('Clustering entities', { count: entities.length, threshold: similarityThreshold });

  const clusters: EntityCluster[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    
    if (processed.has(entity.id)) continue;

    // Find similar entities
    const relatedEntities: Entity[] = [];
    let linkType: EntityCluster['linkType'] = 'exact-match';
    let totalSimilarity = 0;

    for (let j = i + 1; j < entities.length; j++) {
      const otherEntity = entities[j];
      
      if (processed.has(otherEntity.id)) continue;
      if (entity.type !== otherEntity.type) continue;

      const similarity = calculateEntitySimilarity(entity, otherEntity);
      
      if (similarity >= similarityThreshold) {
        relatedEntities.push(otherEntity);
        processed.add(otherEntity.id);
        totalSimilarity += similarity;
        
        if (similarity < 1.0 && similarity >= 0.9) {
          linkType = 'fuzzy-match';
        } else if (similarity < 0.9) {
          linkType = 'contextual';
        }
      }
    }

    // Create cluster if we found related entities
    if (relatedEntities.length > 0) {
      const avgConfidence = totalSimilarity / relatedEntities.length;
      
      clusters.push({
        id: `cluster-${entity.type}-${clusters.length}`,
        type: entity.type,
        primaryEntity: entity,
        relatedEntities,
        confidence: avgConfidence,
        linkType,
        reasoning: `Found ${relatedEntities.length} related ${entity.type} entities with avg similarity ${(avgConfidence * 100).toFixed(1)}%`
      });
      
      processed.add(entity.id);
    }
  }

  log.info('Clustering complete', { clusterCount: clusters.length });

  return clusters;
}

/**
 * Detect relationships between entities
 */
export async function detectRelationships(
  entities: Entity[]
): Promise<EntityRelationship[]> {
  log.info('Detecting entity relationships', { count: entities.length });

  const relationships: EntityRelationship[] = [];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const entity1 = entities[i];
      const entity2 = entities[j];

      // Check for various relationship types
      const relationship = inferRelationship(entity1, entity2);
      
      if (relationship) {
        relationships.push(relationship);
      }
    }
  }

  log.info('Relationship detection complete', { relationshipCount: relationships.length });

  return relationships;
}

/**
 * Infer relationship between two entities
 */
function inferRelationship(entity1: Entity, entity2: Entity): EntityRelationship | null {
  const evidence: string[] = [];
  let relationshipType: EntityRelationship['relationshipType'] | null = null;
  let strength = 0;

  // Person -> Organization relationships
  if (entity1.type === 'person' && entity2.type === 'organization') {
    if (entity1.attributes.employer && 
        calculateStringSimilarity(entity1.attributes.employer, entity2.name) > 0.8) {
      relationshipType = 'works-for';
      strength = 0.9;
      evidence.push(`${entity1.name} lists ${entity2.name} as employer`);
    }
  }

  // Case -> Document relationships
  if (entity1.type === 'case' && entity2.type === 'document') {
    if (entity2.attributes.caseId === entity1.id ||
        entity2.attributes.caseName && 
        calculateStringSimilarity(entity2.attributes.caseName, entity1.name) > 0.8) {
      relationshipType = 'references';
      strength = 0.95;
      evidence.push(`Document ${entity2.name} references case ${entity1.name}`);
    }
  }

  // Evidence -> Case relationships
  if (entity1.type === 'evidence' && entity2.type === 'case') {
    if (entity1.attributes.caseId === entity2.id) {
      relationshipType = 'participant-in';
      strength = 1.0;
      evidence.push(`Evidence ${entity1.name} part of case ${entity2.name}`);
    }
  }

  // Location relationships
  if (entity1.attributes.location && entity2.type === 'location') {
    if (calculateStringSimilarity(entity1.attributes.location, entity2.name) > 0.8) {
      relationshipType = 'located-at';
      strength = 0.85;
      evidence.push(`${entity1.name} located at ${entity2.name}`);
    }
  }

  // Contextual relationships (same keywords, mentions)
  const contextSimilarity = calculateContextualSimilarity(entity1, entity2);
  if (contextSimilarity > 0.3 && !relationshipType) {
    relationshipType = 'related-to';
    strength = contextSimilarity;
    evidence.push(`Entities share ${(contextSimilarity * 100).toFixed(0)}% contextual similarity`);
  }

  // Check for contradictions (evidence type)
  if (entity1.type === 'evidence' && entity2.type === 'evidence') {
    if (entity1.attributes.contradicts?.includes(entity2.id)) {
      relationshipType = 'contradicts';
      strength = 0.8;
      evidence.push(`Evidence pieces contradict each other`);
    }
  }

  if (relationshipType && strength > 0.3) {
    return {
      entity1Id: entity1.id,
      entity2Id: entity2.id,
      relationshipType,
      strength,
      evidence
    };
  }

  return null;
}

/**
 * Perform complete clustering analysis
 */
export async function performClusteringAnalysis(
  entities: Entity[],
  options: {
    similarityThreshold?: number;
    detectRelationships?: boolean;
    includeIsolated?: boolean;
  } = {}
): Promise<ClusteringResult> {
  log.info('Starting clustering analysis', { entityCount: entities.length });

  const {
    similarityThreshold = 0.7,
    detectRelationships: shouldDetectRelationships = true,
    includeIsolated = true
  } = options;

  // Cluster entities
  const clusters = await clusterEntities(entities, similarityThreshold);

  // Detect relationships
  const relationships = shouldDetectRelationships 
    ? await detectRelationships(entities)
    : [];

  // Find isolated entities (not in any cluster)
  const clusteredEntityIds = new Set<string>();
  clusters.forEach(cluster => {
    clusteredEntityIds.add(cluster.primaryEntity.id);
    cluster.relatedEntities.forEach(e => clusteredEntityIds.add(e.id));
  });

  const isolatedEntities = includeIsolated
    ? entities.filter(e => !clusteredEntityIds.has(e.id))
    : [];

  // Calculate statistics
  const totalClusterSize = clusters.reduce((sum, c) => sum + 1 + c.relatedEntities.length, 0);
  const avgClusterSize = clusters.length > 0 ? totalClusterSize / clusters.length : 0;

  const result: ClusteringResult = {
    clusters,
    relationships,
    isolatedEntities,
    statistics: {
      totalEntities: entities.length,
      totalClusters: clusters.length,
      avgClusterSize,
      totalRelationships: relationships.length
    }
  };

  log.info('Clustering analysis complete', {
    clusters: result.statistics.totalClusters,
    relationships: result.statistics.totalRelationships,
    isolated: isolatedEntities.length
  });

  return result;
}

/**
 * Link entities across different sources
 */
export async function linkEntitiesAcrossSources(
  entitiesBySource: Map<string, Entity[]>
): Promise<Map<string, EntityCluster[]>> {
  log.info('Linking entities across sources', { sourceCount: entitiesBySource.size });

  const linkedClusters = new Map<string, EntityCluster[]>();

  // Combine all entities
  const allEntities: Entity[] = [];
  entitiesBySource.forEach((entities, source) => {
    allEntities.push(...entities);
  });

  // Cluster all entities together
  const clusters = await clusterEntities(allEntities, 0.8);

  // Group clusters by source
  entitiesBySource.forEach((_, source) => {
    const sourceClusters = clusters.filter(cluster => 
      cluster.primaryEntity.source === source ||
      cluster.relatedEntities.some(e => e.source === source)
    );
    linkedClusters.set(source, sourceClusters);
  });

  log.info('Cross-source linking complete', { 
    totalClusters: clusters.length,
    sourcesLinked: linkedClusters.size
  });

  return linkedClusters;
}

/**
 * Find entity by attributes (fuzzy search)
 */
export async function findEntityByAttributes(
  query: Partial<Entity>,
  entities: Entity[],
  threshold: number = 0.6
): Promise<Entity[]> {
  const matches: Array<{ entity: Entity; score: number }> = [];

  for (const entity of entities) {
    let score = 0;
    let weights = 0;

    // Type match
    if (query.type && entity.type === query.type) {
      score += 0.3;
      weights += 0.3;
    }

    // Name match
    if (query.name) {
      const nameSimilarity = calculateStringSimilarity(query.name, entity.name);
      score += nameSimilarity * 0.4;
      weights += 0.4;
    }

    // Attribute matches
    if (query.attributes) {
      for (const [key, value] of Object.entries(query.attributes)) {
        if (entity.attributes[key]) {
          const attrSimilarity = calculateStringSimilarity(
            String(value),
            String(entity.attributes[key])
          );
          score += attrSimilarity * 0.3;
          weights += 0.3;
        }
      }
    }

    const finalScore = weights > 0 ? score / weights : 0;
    
    if (finalScore >= threshold) {
      matches.push({ entity, score: finalScore });
    }
  }

  // Sort by score
  matches.sort((a, b) => b.score - a.score);

  return matches.map(m => m.entity);
}

/**
 * Health check for clustering worker
 */
export async function healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
  try {
    // Test clustering with sample data
    const testEntities: Entity[] = [
      {
        id: 'e1',
        type: 'person',
        name: 'John Doe',
        attributes: { email: 'john@example.com' },
        source: 'test'
      },
      {
        id: 'e2',
        type: 'person',
        name: 'John Doe',
        attributes: { email: 'johndoe@example.com' },
        source: 'test'
      },
      {
        id: 'e3',
        type: 'organization',
        name: 'ACME Corp',
        attributes: {},
        source: 'test'
      }
    ];

    const result = await performClusteringAnalysis(testEntities);

    if (result.clusters.length > 0 && result.statistics.totalEntities === 3) {
      return { status: 'healthy', message: 'ML Clustering Worker is operational' };
    }

    return { status: 'unhealthy', message: 'Clustering produced unexpected results' };
  } catch (error) {
    log.error('Health check failed', error);
    return { status: 'unhealthy', message: `Health check failed: ${error}` };
  }
}
