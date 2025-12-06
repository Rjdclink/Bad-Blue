/**
 * Pattern Detection Engine
 * Temporal, geographic, and behavioral pattern analysis
 * SpiderFoot pattern detection approach
 */

import { createLogger } from '../../logger';
import type { EntityNode, EntityEdge, DetectedPattern } from './types';
import { EntityGraph } from './entityGraph';

const logger = createLogger('PatternDetection');

export class PatternDetectionEngine {
  private graph: EntityGraph;

  constructor(graph: EntityGraph) {
    this.graph = graph;
  }

  /**
   * Detect all patterns in the graph
   */
  async detectAllPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const startTime = Date.now();

    try {
      // Run all pattern detection algorithms
      patterns.push(...await this.detectOfficerPatterns());
      patterns.push(...await this.detectDepartmentPatterns());
      patterns.push(...await this.detectTemporalPatterns());
      patterns.push(...await this.detectGeographicPatterns());
      patterns.push(...await this.detectAnomalies());

      const duration = Date.now() - startTime;
      logger.info(`Pattern detection completed in ${duration}ms, found ${patterns.length} patterns`);
    } catch (error) {
      logger.error('Pattern detection failed:', error);
    }

    return patterns;
  }

  /**
   * Detect officer misconduct patterns
   */
  async detectOfficerPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const officers = this.graph.getNodesByType('officer');

    for (const officer of officers) {
      const relatedEntities = this.graph.getNeighbors(officer.id);
      
      // Count lawsuits and complaints
      const lawsuits = relatedEntities.filter(e => e.type === 'lawsuit');
      const complaints = relatedEntities.filter(e => e.type === 'complaint');

      // Pattern: Multiple lawsuits
      if (lawsuits.length >= 3) {
        patterns.push({
          id: `pattern_officer_lawsuits_${officer.id}`,
          type: 'officer_multiple_lawsuits',
          entityIds: [officer.id, ...lawsuits.map(l => l.id)],
          confidence: Math.min(0.95, 0.7 + (lawsuits.length * 0.05)),
          description: `Officer ${officer.properties.name || officer.id} involved in ${lawsuits.length} lawsuits`,
          evidence: lawsuits.map(l => l.properties),
          detectedAt: new Date(),
          temporal: this.analyzeTemporalDistribution(lawsuits),
        });
      }

      // Pattern: Multiple complaints
      if (complaints.length >= 5) {
        patterns.push({
          id: `pattern_officer_complaints_${officer.id}`,
          type: 'officer_multiple_complaints',
          entityIds: [officer.id, ...complaints.map(c => c.id)],
          confidence: Math.min(0.92, 0.7 + (complaints.length * 0.03)),
          description: `Officer ${officer.properties.name || officer.id} has ${complaints.length} complaints`,
          evidence: complaints.map(c => c.properties),
          detectedAt: new Date(),
          temporal: this.analyzeTemporalDistribution(complaints),
        });
      }

      // Pattern: Escalation (complaints -> lawsuits)
      if (complaints.length >= 2 && lawsuits.length >= 1) {
        patterns.push({
          id: `pattern_officer_escalation_${officer.id}`,
          type: 'officer_escalation_pattern',
          entityIds: [officer.id, ...complaints.map(c => c.id), ...lawsuits.map(l => l.id)],
          confidence: 0.88,
          description: `Officer ${officer.properties.name || officer.id} shows escalation pattern`,
          evidence: [...complaints.map(c => c.properties), ...lawsuits.map(l => l.properties)],
          detectedAt: new Date(),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect department-wide patterns
   */
  async detectDepartmentPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const departments = this.graph.getNodesByType('department');

    for (const department of departments) {
      const relatedEntities = this.graph.getNeighbors(department.id);
      
      // Count by type
      const lawsuits = relatedEntities.filter(e => e.type === 'lawsuit');
      const complaints = relatedEntities.filter(e => e.type === 'complaint');
      const officers = relatedEntities.filter(e => e.type === 'officer');

      // Pattern: High lawsuit department
      if (lawsuits.length >= 5) {
        patterns.push({
          id: `pattern_dept_lawsuits_${department.id}`,
          type: 'department_lawsuit_trend',
          entityIds: [department.id, ...lawsuits.map(l => l.id)],
          confidence: 0.85,
          description: `Department ${department.properties.name || department.id} has ${lawsuits.length} lawsuits`,
          evidence: lawsuits.map(l => l.properties),
          detectedAt: new Date(),
        });
      }

      // Pattern: Excessive force complaints
      const excessiveForceComplaints = complaints.filter(
        c => c.properties.complaintType === 'excessive_force'
      );
      
      if (excessiveForceComplaints.length >= 3) {
        patterns.push({
          id: `pattern_dept_excessive_force_${department.id}`,
          type: 'department_excessive_force',
          entityIds: [department.id, ...excessiveForceComplaints.map(c => c.id)],
          confidence: 0.88,
          description: `Department ${department.properties.name || department.id} has ${excessiveForceComplaints.length} excessive force complaints`,
          evidence: excessiveForceComplaints.map(c => c.properties),
          detectedAt: new Date(),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect temporal patterns
   */
  async detectTemporalPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const officers = this.graph.getNodesByType('officer');

    for (const officer of officers) {
      const edges = this.graph.getNodeEdges(officer.id);
      const recentEdges = edges.filter(edge => {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        return edge.discoveredAt >= sixMonthsAgo;
      });

      // Pattern: Recent activity spike
      if (recentEdges.length >= 3) {
        patterns.push({
          id: `pattern_temporal_spike_${officer.id}`,
          type: 'recent_activity_spike',
          entityIds: [officer.id, ...recentEdges.map(e => e.targetId)],
          confidence: 0.90,
          description: `Officer ${officer.properties.name || officer.id} has spike in recent activity`,
          evidence: recentEdges.map(e => ({ edgeId: e.id, date: e.discoveredAt })),
          detectedAt: new Date(),
          temporal: {
            startDate: new Date(Math.min(...recentEdges.map(e => e.discoveredAt.getTime()))),
            endDate: new Date(),
            frequency: 'recent_6_months',
          },
        });
      }
    }

    return patterns;
  }

  /**
   * Detect geographic patterns
   */
  async detectGeographicPatterns(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    const complaints = this.graph.getNodesByType('complaint');

    // Group complaints by location
    const locationMap = new Map<string, EntityNode[]>();
    
    for (const complaint of complaints) {
      const location = complaint.properties.location;
      if (location) {
        if (!locationMap.has(location)) {
          locationMap.set(location, []);
        }
        locationMap.get(location)!.push(complaint);
      }
    }

    // Detect clustering
    for (const [location, locationComplaints] of locationMap.entries()) {
      if (locationComplaints.length >= 3) {
        patterns.push({
          id: `pattern_geo_cluster_${location}`,
          type: 'geographic_clustering',
          entityIds: locationComplaints.map(c => c.id),
          confidence: 0.83,
          description: `${locationComplaints.length} complaints clustered in ${location}`,
          evidence: locationComplaints.map(c => c.properties),
          detectedAt: new Date(),
          geographic: {
            locations: [location],
          },
        });
      }
    }

    return patterns;
  }

  /**
   * Detect anomalies
   */
  async detectAnomalies(): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];
    
    // Find nodes with unusually high centrality
    const centralNodes = this.graph.findCentralNodes(5);
    const avgDegree = this.graph.getStats().avgDegree;

    for (const { nodeId, degree } of centralNodes) {
      if (degree > avgDegree * 3) {
        const node = this.graph.getNode(nodeId);
        if (node) {
          patterns.push({
            id: `pattern_anomaly_high_connectivity_${nodeId}`,
            type: 'anomaly_high_connectivity',
            entityIds: [nodeId],
            confidence: 0.75,
            description: `Entity ${node.properties.name || nodeId} has unusually high connectivity (${degree} connections)`,
            evidence: [{ degree, avgDegree, nodeType: node.type }],
            detectedAt: new Date(),
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Analyze temporal distribution of entities
   */
  private analyzeTemporalDistribution(entities: EntityNode[]): {
    startDate?: Date;
    endDate?: Date;
    frequency?: string;
  } {
    if (entities.length === 0) return {};

    const dates = entities
      .map(e => e.discoveredAt)
      .sort((a, b) => a.getTime() - b.getTime());

    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    
    // Calculate frequency
    const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    let frequency = 'unknown';
    
    if (daysDiff <= 30) {
      frequency = 'high_frequency_monthly';
    } else if (daysDiff <= 180) {
      frequency = 'moderate_frequency_6months';
    } else {
      frequency = 'low_frequency_yearly';
    }

    return { startDate, endDate, frequency };
  }

  /**
   * Find patterns by entity
   */
  async findPatternsForEntity(entityId: string): Promise<DetectedPattern[]> {
    const allPatterns = await this.detectAllPatterns();
    return allPatterns.filter(pattern => pattern.entityIds.includes(entityId));
  }

  /**
   * Find patterns by type
   */
  async findPatternsByType(type: string): Promise<DetectedPattern[]> {
    const allPatterns = await this.detectAllPatterns();
    return allPatterns.filter(pattern => pattern.type === type);
  }
}

// Factory function
export function createPatternDetectionEngine(graph: EntityGraph): PatternDetectionEngine {
  return new PatternDetectionEngine(graph);
}
