/**
 * Correlation Integration Utilities
 * Helpers to integrate correlation engine with existing systems
 */

import { createLogger } from '../../logger';
import { correlationEngine } from './correlationEngine';
import { createEntityGraph } from './entityGraph';
import { createPatternDetectionEngine } from './patternDetection';
import { correlationDatabase } from './correlationDB';
import type { EntityNode, DetectedPattern } from './types';

const logger = createLogger('CorrelationIntegration');

/**
 * Enrich officer search results with correlation data
 */
export async function enrichOfficerSearch(params: {
  officerName: string;
  state?: string;
  badge?: string;
  department?: string;
}): Promise<{
  relatedLawsuits: EntityNode[];
  relatedComplaints: EntityNode[];
  relatedOfficers: EntityNode[];
  patterns: DetectedPattern[];
  correlationScore: number;
}> {
  try {
    // Initialize correlation engine if needed
    if (!correlationEngine['initialized']) {
      await correlationEngine.initialize();
    }

    // Find or create officer entity
    let officerId = `officer_${params.officerName.replace(/\s+/g, '_').toLowerCase()}`;
    
    let officer = correlationDatabase.getEntity(officerId);
    
    if (!officer) {
      // Create new officer entity
      officer = {
        id: officerId,
        type: 'officer',
        properties: {
          name: params.officerName,
          state: params.state,
          badge: params.badge,
          department: params.department,
        },
        confidence: 0.9,
        sources: ['officer_search'],
        discoveredAt: new Date(),
      };
      
      correlationDatabase.addEntity(officer);
      
      // Emit event for new officer discovery
      await correlationEngine.emit(
        'entity.officer.discovered',
        officer,
        'OfficerSearchIntegration',
        officerId
      );
    }

    // Build entity graph for this officer
    const graph = createEntityGraph();
    await graph.loadFromDatabase([officerId]);
    
    // Get related entities
    const neighbors = graph.getNeighbors(officerId);
    const relatedLawsuits = neighbors.filter(n => n.type === 'lawsuit');
    const relatedComplaints = neighbors.filter(n => n.type === 'complaint');
    const relatedOfficers = neighbors.filter(n => n.type === 'officer');

    // Run pattern detection
    const patternEngine = createPatternDetectionEngine(graph);
    const patterns = await patternEngine.findPatternsForEntity(officerId);

    // Calculate correlation score (based on relationships and patterns)
    const relationshipCount = graph.getNodeEdges(officerId).length;
    const highConfidencePatterns = patterns.filter(p => p.confidence > 0.85).length;
    const correlationScore = Math.min(1.0, (relationshipCount * 0.1) + (highConfidencePatterns * 0.2));

    logger.info(`Officer enrichment completed: ${relatedLawsuits.length} lawsuits, ${relatedComplaints.length} complaints, ${patterns.length} patterns`);

    return {
      relatedLawsuits,
      relatedComplaints,
      relatedOfficers,
      patterns,
      correlationScore,
    };
  } catch (error) {
    logger.error('Error enriching officer search:', error);
    return {
      relatedLawsuits: [],
      relatedComplaints: [],
      relatedOfficers: [],
      patterns: [],
      correlationScore: 0,
    };
  }
}

/**
 * Enrich people search with relationship mapping
 */
export async function enrichPeopleSearch(params: {
  personName: string;
  email?: string;
}): Promise<{
  relatedEntities: EntityNode[];
  relationshipMap: Array<{ from: string; to: string; relationship: string }>;
  credibilityScore: number;
}> {
  try {
    if (!correlationEngine['initialized']) {
      await correlationEngine.initialize();
    }

    const personId = `person_${params.personName.replace(/\s+/g, '_').toLowerCase()}`;
    
    // Find or create person entity
    let person = correlationDatabase.getEntity(personId);
    
    if (!person) {
      person = {
        id: personId,
        type: 'person',
        properties: {
          name: params.personName,
          email: params.email,
        },
        confidence: 0.85,
        sources: ['people_search'],
        discoveredAt: new Date(),
      };
      
      correlationDatabase.addEntity(person);
      
      await correlationEngine.emit(
        'entity.person.discovered',
        person,
        'PeopleSearchIntegration',
        personId
      );
    }

    // Build entity graph
    const graph = createEntityGraph();
    await graph.loadFromDatabase([personId]);
    
    // Get all related entities
    const relatedEntities = graph.getNeighbors(personId);

    // Build relationship map
    const edges = graph.getNodeEdges(personId);
    const relationshipMap = edges.map(edge => ({
      from: edge.sourceId,
      to: edge.targetId,
      relationship: edge.relationship,
    }));

    // Calculate credibility score based on centrality and confidence
    const degree = graph.getDegree(personId);
    const avgConfidence = edges.reduce((sum, e) => sum + e.confidence, 0) / (edges.length || 1);
    const credibilityScore = Math.min(1.0, (avgConfidence * 0.7) + (Math.min(degree / 10, 1) * 0.3));

    logger.info(`People search enrichment: ${relatedEntities.length} related entities, credibility: ${credibilityScore.toFixed(2)}`);

    return {
      relatedEntities,
      relationshipMap,
      credibilityScore,
    };
  } catch (error) {
    logger.error('Error enriching people search:', error);
    return {
      relatedEntities: [],
      relationshipMap: [],
      credibilityScore: 0,
    };
  }
}

/**
 * Enrich legal AI with entity-aware research
 */
export async function enrichLegalResearch(params: {
  query: string;
  entities?: string[];
}): Promise<{
  relevantEntities: EntityNode[];
  relatedCases: EntityNode[];
  patterns: DetectedPattern[];
  contextScore: number;
}> {
  try {
    if (!correlationEngine['initialized']) {
      await correlationEngine.initialize();
    }

    // Extract entity names from query if not provided
    const entityNames = params.entities || [];
    
    // Find relevant entities in database
    const relevantEntities: EntityNode[] = [];
    const relatedCases: EntityNode[] = [];
    
    for (const entityName of entityNames) {
      const entityId = `entity_${entityName.replace(/\s+/g, '_').toLowerCase()}`;
      const entity = correlationDatabase.getEntity(entityId);
      
      if (entity) {
        relevantEntities.push(entity);
        
        // Get related cases
        const graph = createEntityGraph();
        await graph.loadFromDatabase([entityId]);
        const neighbors = graph.getNeighbors(entityId);
        relatedCases.push(...neighbors.filter(n => n.type === 'case' || n.type === 'lawsuit'));
      }
    }

    // Find patterns related to the query entities
    let patterns: DetectedPattern[] = [];
    if (relevantEntities.length > 0) {
      const graph = createEntityGraph();
      await graph.loadFromDatabase(relevantEntities.map(e => e.id));
      
      const patternEngine = createPatternDetectionEngine(graph);
      patterns = await patternEngine.detectAllPatterns();
    }

    // Context score based on entity and case relevance
    const contextScore = Math.min(1.0, 
      (relevantEntities.length * 0.2) + 
      (relatedCases.length * 0.15) + 
      (patterns.length * 0.1)
    );

    logger.info(`Legal research enrichment: ${relevantEntities.length} entities, ${relatedCases.length} cases, ${patterns.length} patterns`);

    return {
      relevantEntities,
      relatedCases,
      patterns,
      contextScore,
    };
  } catch (error) {
    logger.error('Error enriching legal research:', error);
    return {
      relevantEntities: [],
      relatedCases: [],
      patterns: [],
      contextScore: 0,
    };
  }
}

/**
 * Enrich consultation with pattern-based insights
 */
export async function enrichConsultation(params: {
  parties: Array<{ name: string; role: string }>;
  description: string;
}): Promise<{
  identifiedEntities: EntityNode[];
  suggestedParties: EntityNode[];
  relevantPatterns: DetectedPattern[];
  caseStrengthIndicators: Array<{ indicator: string; score: number }>;
}> {
  try {
    if (!correlationEngine['initialized']) {
      await correlationEngine.initialize();
    }

    const identifiedEntities: EntityNode[] = [];
    const suggestedParties: EntityNode[] = [];
    
    // Find entities for each party
    for (const party of params.parties) {
      const entityId = `entity_${party.name.replace(/\s+/g, '_').toLowerCase()}`;
      const entity = correlationDatabase.getEntity(entityId);
      
      if (entity) {
        identifiedEntities.push(entity);
        
        // Find related entities that might be relevant parties
        const graph = createEntityGraph();
        await graph.loadFromDatabase([entityId]);
        const neighbors = graph.getNeighbors(entityId);
        
        // Suggest attorneys, witnesses, etc.
        const relevant = neighbors.filter(n => 
          n.type === 'attorney' || 
          n.type === 'witness' ||
          (n.type === 'officer' && party.role === 'defendant')
        );
        
        suggestedParties.push(...relevant);
      }
    }

    // Find patterns related to identified entities
    let relevantPatterns: DetectedPattern[] = [];
    if (identifiedEntities.length > 0) {
      const graph = createEntityGraph();
      await graph.loadFromDatabase(identifiedEntities.map(e => e.id));
      
      const patternEngine = createPatternDetectionEngine(graph);
      relevantPatterns = await patternEngine.detectAllPatterns();
    }

    // Generate case strength indicators based on patterns
    const caseStrengthIndicators = relevantPatterns.map(pattern => ({
      indicator: pattern.description,
      score: pattern.confidence,
    }));

    logger.info(`Consultation enrichment: ${identifiedEntities.length} entities, ${suggestedParties.length} suggested parties, ${relevantPatterns.length} patterns`);

    return {
      identifiedEntities,
      suggestedParties,
      relevantPatterns,
      caseStrengthIndicators,
    };
  } catch (error) {
    logger.error('Error enriching consultation:', error);
    return {
      identifiedEntities: [],
      suggestedParties: [],
      relevantPatterns: [],
      caseStrengthIndicators: [],
    };
  }
}

/**
 * Get correlation statistics
 */
export function getCorrelationStats() {
  try {
    return {
      engine: correlationEngine.getStats(),
      database: correlationDatabase.getStats(),
    };
  } catch (error) {
    logger.error('Error getting correlation stats:', error);
    return null;
  }
}
