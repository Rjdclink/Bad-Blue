/**
 * Entity Graph Builder
 * Graph data structure for entity relationships
 * SpiderFoot entity mapping pattern
 */

import { createLogger } from '../../logger';
import type { EntityNode, EntityEdge, GraphVisualization } from './types';
import { correlationDatabase } from './correlationDB';

const logger = createLogger('EntityGraph');

export class EntityGraph {
  private nodes: Map<string, EntityNode> = new Map();
  private edges: Map<string, EntityEdge> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();

  /**
   * Add node to graph
   */
  addNode(node: EntityNode): void {
    this.nodes.set(node.id, node);
    
    if (!this.adjacencyList.has(node.id)) {
      this.adjacencyList.set(node.id, new Set());
    }

    // Persist to database
    try {
      correlationDatabase.addEntity(node);
    } catch (error) {
      logger.error('Failed to persist node to database:', error);
    }

    logger.debug(`Node added: ${node.id} (${node.type})`);
  }

  /**
   * Add edge to graph
   */
  addEdge(edge: EntityEdge): void {
    this.edges.set(edge.id, edge);
    
    // Update adjacency list
    if (!this.adjacencyList.has(edge.sourceId)) {
      this.adjacencyList.set(edge.sourceId, new Set());
    }
    this.adjacencyList.get(edge.sourceId)!.add(edge.targetId);

    // Add reverse edge for undirected graph
    if (!this.adjacencyList.has(edge.targetId)) {
      this.adjacencyList.set(edge.targetId, new Set());
    }
    this.adjacencyList.get(edge.targetId)!.add(edge.sourceId);

    // Persist to database
    try {
      correlationDatabase.addRelationship(edge);
    } catch (error) {
      logger.error('Failed to persist edge to database:', error);
    }

    logger.debug(`Edge added: ${edge.sourceId} -> ${edge.targetId} (${edge.relationship})`);
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): EntityNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get edge by ID
   */
  getEdge(edgeId: string): EntityEdge | undefined {
    return this.edges.get(edgeId);
  }

  /**
   * Get all nodes
   */
  getNodes(): EntityNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges
   */
  getEdges(): EntityEdge[] {
    return Array.from(this.edges.values());
  }

  /**
   * Get nodes by type
   */
  getNodesByType(type: string): EntityNode[] {
    return Array.from(this.nodes.values()).filter(node => node.type === type);
  }

  /**
   * Get neighbors of a node
   */
  getNeighbors(nodeId: string): EntityNode[] {
    const neighborIds = this.adjacencyList.get(nodeId) || new Set();
    return Array.from(neighborIds)
      .map(id => this.nodes.get(id))
      .filter((node): node is EntityNode => node !== undefined);
  }

  /**
   * Get edges connected to a node
   */
  getNodeEdges(nodeId: string): EntityEdge[] {
    return Array.from(this.edges.values()).filter(
      edge => edge.sourceId === nodeId || edge.targetId === nodeId
    );
  }

  /**
   * Find shortest path between two nodes (BFS)
   */
  findShortestPath(sourceId: string, targetId: string): string[] | null {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return null;
    }

    const queue: Array<{ id: string; path: string[] }> = [{ id: sourceId, path: [sourceId] }];
    const visited = new Set<string>([sourceId]);

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (id === targetId) {
        return path;
      }

      const neighbors = this.adjacencyList.get(id) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, path: [...path, neighborId] });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Calculate degree centrality for a node
   */
  getDegree(nodeId: string): number {
    return (this.adjacencyList.get(nodeId) || new Set()).size;
  }

  /**
   * Calculate betweenness centrality (simplified)
   * Measures how often a node appears on shortest paths
   */
  calculateBetweennessCentrality(nodeId: string): number {
    let betweenness = 0;
    const allNodes = Array.from(this.nodes.keys());

    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const source = allNodes[i];
        const target = allNodes[j];

        if (source === nodeId || target === nodeId) continue;

        const path = this.findShortestPath(source, target);
        if (path && path.includes(nodeId)) {
          betweenness++;
        }
      }
    }

    return betweenness;
  }

  /**
   * Detect communities using simple connected components
   */
  detectCommunities(): Map<number, Set<string>> {
    const visited = new Set<string>();
    const communities = new Map<number, Set<string>>();
    let communityId = 0;

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        const community = new Set<string>();
        this.dfsComponent(nodeId, visited, community);
        communities.set(communityId++, community);
      }
    }

    return communities;
  }

  /**
   * DFS helper for community detection
   */
  private dfsComponent(nodeId: string, visited: Set<string>, community: Set<string>): void {
    visited.add(nodeId);
    community.add(nodeId);

    const neighbors = this.adjacencyList.get(nodeId) || new Set();
    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        this.dfsComponent(neighborId, visited, community);
      }
    }
  }

  /**
   * Find nodes with highest centrality
   */
  findCentralNodes(count: number = 10): Array<{ nodeId: string; degree: number }> {
    const centralities = Array.from(this.nodes.keys()).map(nodeId => ({
      nodeId,
      degree: this.getDegree(nodeId),
    }));

    return centralities.sort((a, b) => b.degree - a.degree).slice(0, count);
  }

  /**
   * Export graph for visualization (D3.js format)
   */
  exportForVisualization(): GraphVisualization {
    const nodes = Array.from(this.nodes.values()).map(node => ({
      id: node.id,
      label: node.properties.name || node.id,
      type: node.type,
      group: node.type,
      confidence: node.confidence,
    }));

    const edges = Array.from(this.edges.values()).map(edge => ({
      from: edge.sourceId,
      to: edge.targetId,
      label: edge.relationship,
      weight: edge.weight,
      confidence: edge.confidence,
    }));

    return { nodes, edges };
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    avgDegree: number;
    communities: number;
  } {
    const nodesByType: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    const totalDegree = Array.from(this.nodes.keys()).reduce(
      (sum, nodeId) => sum + this.getDegree(nodeId),
      0
    );
    const avgDegree = this.nodes.size > 0 ? totalDegree / this.nodes.size : 0;

    const communities = this.detectCommunities();

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      nodesByType,
      avgDegree,
      communities: communities.size,
    };
  }

  /**
   * Clear graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacencyList.clear();
    logger.info('Graph cleared');
  }

  /**
   * Load graph from database
   */
  async loadFromDatabase(entityIds?: string[]): Promise<void> {
    try {
      // Load all entities or specific ones
      if (entityIds) {
        for (const id of entityIds) {
          const entity = correlationDatabase.getEntity(id);
          if (entity) {
            this.addNode(entity);
            
            // Load relationships
            const relationships = correlationDatabase.getRelationships(id);
            for (const edge of relationships) {
              this.addEdge(edge);
            }
          }
        }
      }
      
      logger.info(`Graph loaded from database: ${this.nodes.size} nodes, ${this.edges.size} edges`);
    } catch (error) {
      logger.error('Failed to load graph from database:', error);
      throw error;
    }
  }
}

// Factory function for creating graphs
export function createEntityGraph(): EntityGraph {
  return new EntityGraph();
}
