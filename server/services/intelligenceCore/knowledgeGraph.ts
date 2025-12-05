/**
 * Knowledge Graph Core
 * Self-restructuring graph database for PANTHEON Intelligence Core
 * Phase 4A: Foundation Layer
 */

import { pool } from '../../db';
import { 
  GraphNode, 
  GraphEdge, 
  Timeline, 
  Community,
  GraphNodeFilter 
} from './types';
import { GraphAlgorithms } from './utils/graphAlgorithms';
import { ProvenanceManager } from './utils/provenanceManager';
import { createLogger } from '../../logger';

const logger = createLogger('KnowledgeGraphCore');

export class KnowledgeGraphCore {
  private initialized = false;

  /**
   * Initialize the knowledge graph core
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Test database connection
      await pool.query('SELECT 1');
      
      // Verify tables exist
      const tablesCheck = await pool.query(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('knowledge_graph_nodes', 'knowledge_graph_edges', 'knowledge_graph_queries')
      `);

      const tableCount = parseInt(tablesCheck.rows[0].count, 10);
      if (tableCount !== 3) {
        logger.warn(`Knowledge graph tables not fully initialized. Found ${tableCount}/3 tables.`);
        logger.warn('Run migrations to create knowledge graph tables.');
      } else {
        logger.info('Knowledge Graph Core initialized successfully');
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Knowledge Graph Core:', error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Health check failed:', error);
      return false;
    }
  }

  // ==================== NODE OPERATIONS ====================

  /**
   * Add a new node to the knowledge graph
   */
  async addNode(node: Omit<GraphNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const result = await pool.query(
        `INSERT INTO knowledge_graph_nodes 
         (type, properties, confidence, provenance, temporal) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id`,
        [
          node.type,
          JSON.stringify(node.properties),
          node.confidence,
          JSON.stringify(node.provenance),
          node.temporal ? JSON.stringify(node.temporal) : null,
        ]
      );

      const nodeId = result.rows[0].id;
      logger.info(`Node created: ${nodeId} (${node.type})`);
      return nodeId;
    } catch (error) {
      logger.error('Failed to add node:', error);
      throw error;
    }
  }

  /**
   * Get a node by ID
   */
  async getNode(nodeId: string): Promise<GraphNode | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM knowledge_graph_nodes WHERE id = $1',
        [nodeId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToNode(row);
    } catch (error) {
      logger.error('Failed to get node:', error);
      throw error;
    }
  }

  /**
   * Update a node
   */
  async updateNode(nodeId: string, updates: Partial<GraphNode>): Promise<void> {
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.properties !== undefined) {
        setClauses.push(`properties = $${paramIndex++}`);
        values.push(JSON.stringify(updates.properties));
      }

      if (updates.confidence !== undefined) {
        setClauses.push(`confidence = $${paramIndex++}`);
        values.push(updates.confidence);
      }

      if (updates.provenance !== undefined) {
        setClauses.push(`provenance = $${paramIndex++}`);
        values.push(JSON.stringify(updates.provenance));
      }

      if (updates.temporal !== undefined) {
        setClauses.push(`temporal = $${paramIndex++}`);
        values.push(JSON.stringify(updates.temporal));
      }

      if (setClauses.length === 0) {
        return; // Nothing to update
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(nodeId);

      const query = `
        UPDATE knowledge_graph_nodes 
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
      `;

      await pool.query(query, values);
      logger.info(`Node updated: ${nodeId}`);
    } catch (error) {
      logger.error('Failed to update node:', error);
      throw error;
    }
  }

  /**
   * Delete a node (CASCADE deletes associated edges)
   */
  async deleteNode(nodeId: string): Promise<void> {
    try {
      await pool.query('DELETE FROM knowledge_graph_nodes WHERE id = $1', [nodeId]);
      logger.info(`Node deleted: ${nodeId}`);
    } catch (error) {
      logger.error('Failed to delete node:', error);
      throw error;
    }
  }

  // ==================== EDGE OPERATIONS ====================

  /**
   * Add an edge to the knowledge graph
   */
  async addEdge(edge: Omit<GraphEdge, 'id'>): Promise<string> {
    try {
      const result = await pool.query(
        `INSERT INTO knowledge_graph_edges 
         (source_id, target_id, relationship, weight, confidence, evidence_ids, temporal) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id`,
        [
          edge.sourceId,
          edge.targetId,
          edge.relationship,
          edge.weight,
          edge.confidence,
          edge.evidenceIds,
          edge.temporal ? JSON.stringify(edge.temporal) : null,
        ]
      );

      const edgeId = result.rows[0].id;
      logger.info(`Edge created: ${edgeId} (${edge.sourceId} -> ${edge.targetId})`);
      return edgeId;
    } catch (error) {
      logger.error('Failed to add edge:', error);
      throw error;
    }
  }

  /**
   * Get an edge by ID
   */
  async getEdge(edgeId: string): Promise<GraphEdge | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM knowledge_graph_edges WHERE id = $1',
        [edgeId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToEdge(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get edge:', error);
      throw error;
    }
  }

  /**
   * Get all edges for a node (both incoming and outgoing)
   */
  async getNodeEdges(nodeId: string): Promise<GraphEdge[]> {
    try {
      const result = await pool.query(
        `SELECT * FROM knowledge_graph_edges 
         WHERE source_id = $1 OR target_id = $1
         ORDER BY confidence DESC, weight DESC`,
        [nodeId]
      );

      return result.rows.map(row => this.mapRowToEdge(row));
    } catch (error) {
      logger.error('Failed to get node edges:', error);
      throw error;
    }
  }

  /**
   * Delete an edge
   */
  async deleteEdge(edgeId: string): Promise<void> {
    try {
      await pool.query('DELETE FROM knowledge_graph_edges WHERE id = $1', [edgeId]);
      logger.info(`Edge deleted: ${edgeId}`);
    } catch (error) {
      logger.error('Failed to delete edge:', error);
      throw error;
    }
  }

  // ==================== QUERY OPERATIONS ====================

  /**
   * Find nodes matching filters
   */
  async findNodes(filters: GraphNodeFilter): Promise<GraphNode[]> {
    try {
      const whereClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (filters.type) {
        whereClauses.push(`type = $${paramIndex++}`);
        values.push(filters.type);
      }

      if (filters.minConfidence !== undefined) {
        whereClauses.push(`confidence >= $${paramIndex++}`);
        values.push(filters.minConfidence);
      }

      if (filters.createdAfter) {
        whereClauses.push(`created_at >= $${paramIndex++}`);
        values.push(filters.createdAfter);
      }

      if (filters.createdBefore) {
        whereClauses.push(`created_at <= $${paramIndex++}`);
        values.push(filters.createdBefore);
      }

      if (filters.properties) {
        // Use JSONB containment operator
        whereClauses.push(`properties @> $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(filters.properties));
      }

      const whereClause = whereClauses.length > 0 
        ? `WHERE ${whereClauses.join(' AND ')}` 
        : '';

      const query = `
        SELECT * FROM knowledge_graph_nodes 
        ${whereClause}
        ORDER BY confidence DESC, created_at DESC
        LIMIT 100
      `;

      const result = await pool.query(query, values);
      return result.rows.map(row => this.mapRowToNode(row));
    } catch (error) {
      logger.error('Failed to find nodes:', error);
      throw error;
    }
  }

  /**
   * Get related nodes up to maxDepth hops away
   */
  async getRelatedNodes(nodeId: string, maxDepth: number): Promise<GraphNode[]> {
    try {
      const nodeIds = await GraphAlgorithms.breadthFirstSearch(nodeId, maxDepth);
      
      if (nodeIds.length === 0) {
        return [];
      }

      const result = await pool.query(
        'SELECT * FROM knowledge_graph_nodes WHERE id = ANY($1)',
        [nodeIds]
      );

      return result.rows.map(row => this.mapRowToNode(row));
    } catch (error) {
      logger.error('Failed to get related nodes:', error);
      throw error;
    }
  }

  /**
   * Get shortest path between two nodes
   */
  async getShortestPath(sourceId: string, targetId: string): Promise<GraphEdge[]> {
    try {
      const edgeIds = await GraphAlgorithms.dijkstraShortestPath(sourceId, targetId);
      
      if (edgeIds.length === 0) {
        return [];
      }

      const result = await pool.query(
        'SELECT * FROM knowledge_graph_edges WHERE id = ANY($1)',
        [edgeIds]
      );

      return result.rows.map(row => this.mapRowToEdge(row));
    } catch (error) {
      logger.error('Failed to get shortest path:', error);
      throw error;
    }
  }

  // ==================== TEMPORAL OPERATIONS ====================

  /**
   * Get node history (for future version tracking)
   */
  async getNodeHistory(nodeId: string): Promise<GraphNode[]> {
    // For Phase 4A, we only return current version
    // Future phases can implement full version history
    try {
      const node = await this.getNode(nodeId);
      return node ? [node] : [];
    } catch (error) {
      logger.error('Failed to get node history:', error);
      throw error;
    }
  }

  /**
   * Build timeline from multiple nodes
   */
  async buildTimeline(nodeIds: string[]): Promise<Timeline> {
    try {
      if (nodeIds.length === 0) {
        return {
          events: [],
          startDate: new Date(),
          endDate: new Date(),
        };
      }

      const result = await pool.query(
        'SELECT id, temporal FROM knowledge_graph_nodes WHERE id = ANY($1) AND temporal IS NOT NULL',
        [nodeIds]
      );

      const events: Timeline['events'] = [];
      let startDate = new Date();
      let endDate = new Date(0);

      for (const row of result.rows) {
        const temporal = row.temporal;
        if (temporal && temporal.timeline) {
          for (const timelineEvent of temporal.timeline) {
            const eventDate = new Date(timelineEvent.date);
            events.push({
              date: eventDate,
              event: timelineEvent.event,
              nodeId: row.id,
              source: timelineEvent.source,
            });

            if (eventDate < startDate) startDate = eventDate;
            if (eventDate > endDate) endDate = eventDate;
          }
        }
      }

      // Sort events by date
      events.sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        events,
        startDate,
        endDate,
      };
    } catch (error) {
      logger.error('Failed to build timeline:', error);
      throw error;
    }
  }

  // ==================== INTELLIGENCE OPERATIONS ====================

  /**
   * Merge multiple nodes into one
   * Combines properties and provenance
   */
  async mergeNodes(nodeIds: string[]): Promise<string> {
    try {
      if (nodeIds.length < 2) {
        throw new Error('Need at least 2 nodes to merge');
      }

      // Get all nodes
      const result = await pool.query(
        'SELECT * FROM knowledge_graph_nodes WHERE id = ANY($1)',
        [nodeIds]
      );

      const nodes = result.rows.map(row => this.mapRowToNode(row));

      // Merge properties
      const mergedProperties: Record<string, any> = {};
      const mergedProvenance = [];
      let maxConfidence = 0;

      for (const node of nodes) {
        Object.assign(mergedProperties, node.properties);
        mergedProvenance.push(...node.provenance);
        maxConfidence = Math.max(maxConfidence, node.confidence);
      }

      // Create merged node (use type of most confident node)
      const mostConfidentNode = nodes.reduce((a, b) => a.confidence > b.confidence ? a : b);
      
      const mergedNodeId = await this.addNode({
        type: mostConfidentNode.type,
        properties: mergedProperties,
        confidence: maxConfidence,
        provenance: mergedProvenance,
      });

      // Redirect all edges to merged node
      await pool.query(`
        UPDATE knowledge_graph_edges 
        SET source_id = $1 
        WHERE source_id = ANY($2)
      `, [mergedNodeId, nodeIds]);

      await pool.query(`
        UPDATE knowledge_graph_edges 
        SET target_id = $1 
        WHERE target_id = ANY($2)
      `, [mergedNodeId, nodeIds]);

      // Delete original nodes
      for (const nodeId of nodeIds) {
        await this.deleteNode(nodeId);
      }

      logger.info(`Merged ${nodeIds.length} nodes into ${mergedNodeId}`);
      return mergedNodeId;
    } catch (error) {
      logger.error('Failed to merge nodes:', error);
      throw error;
    }
  }

  /**
   * Detect communities in the graph
   */
  async detectCommunities(): Promise<Community[]> {
    try {
      // Get all node IDs
      const result = await pool.query('SELECT id FROM knowledge_graph_nodes LIMIT 1000');
      const nodeIds = result.rows.map(r => r.id);

      return await GraphAlgorithms.detectCommunities(nodeIds);
    } catch (error) {
      logger.error('Failed to detect communities:', error);
      throw error;
    }
  }

  /**
   * Find influential nodes (high centrality)
   */
  async findInfluencers(): Promise<Array<{ nodeId: string; score: number }>> {
    try {
      // Get nodes with most connections
      const result = await pool.query(`
        SELECT n.id, COUNT(DISTINCT e.id) as connection_count
        FROM knowledge_graph_nodes n
        LEFT JOIN knowledge_graph_edges e 
          ON e.source_id = n.id OR e.target_id = n.id
        GROUP BY n.id
        ORDER BY connection_count DESC
        LIMIT 20
      `);

      return result.rows.map(row => ({
        nodeId: row.id,
        score: parseInt(row.connection_count, 10),
      }));
    } catch (error) {
      logger.error('Failed to find influencers:', error);
      throw error;
    }
  }

  // ==================== HELPER METHODS ====================

  private mapRowToNode(row: any): GraphNode {
    return {
      id: row.id,
      type: row.type,
      properties: row.properties,
      confidence: row.confidence,
      provenance: row.provenance,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      temporal: row.temporal,
    };
  }

  private mapRowToEdge(row: any): GraphEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationship: row.relationship,
      weight: row.weight,
      confidence: row.confidence,
      evidenceIds: row.evidence_ids || [],
      temporal: row.temporal,
    };
  }
}
