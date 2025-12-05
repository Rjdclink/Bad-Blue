/**
 * Knowledge Graph Core
 * Phase 4A - Part 2: Self-restructuring graph database
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
  private readonly DEFAULT_QUERY_LIMIT = 100;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await pool.query('SELECT 1');
      
      const requiredTables = ['knowledge_graph_nodes', 'knowledge_graph_edges', 'knowledge_graph_queries'];
      const tablesCheck = await pool.query(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('knowledge_graph_nodes', 'knowledge_graph_edges', 'knowledge_graph_queries')
      `);

      const tableCount = parseInt(tablesCheck.rows[0].count, 10);
      if (tableCount !== requiredTables.length) {
        logger.warn(`Knowledge graph tables not fully initialized. Found ${tableCount}/${requiredTables.length} tables.`);
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

  async getNode(nodeId: string): Promise<GraphNode | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM knowledge_graph_nodes WHERE id = $1',
        [nodeId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToNode(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get node:', error);
      throw error;
    }
  }

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
        return;
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

  async findNodes(filters: GraphNodeFilter, limit: number = this.DEFAULT_QUERY_LIMIT): Promise<GraphNode[]> {
    const safeLimit = Math.min(limit, 1000);
    
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
        LIMIT $${paramIndex}
      `;

      values.push(safeLimit);
      const result = await pool.query(query, values);
      return result.rows.map(row => this.mapRowToNode(row));
    } catch (error) {
      logger.error('Failed to find nodes:', error);
      throw error;
    }
  }

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

  async getNodeHistory(nodeId: string): Promise<GraphNode[]> {
    try {
      const node = await this.getNode(nodeId);
      return node ? [node] : [];
    } catch (error) {
      logger.error('Failed to get node history:', error);
      throw error;
    }
  }

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

  async mergeNodes(nodeIds: string[]): Promise<string> {
    try {
      if (nodeIds.length < 2) {
        throw new Error('Need at least 2 nodes to merge');
      }

      const result = await pool.query(
        'SELECT * FROM knowledge_graph_nodes WHERE id = ANY($1)',
        [nodeIds]
      );

      const nodes = result.rows.map(row => this.mapRowToNode(row));

      const mergedProperties: Record<string, any> = {};
      const mergedProvenance = [];
      let maxConfidence = 0;

      for (const node of nodes) {
        Object.assign(mergedProperties, node.properties);
        mergedProvenance.push(...node.provenance);
        maxConfidence = Math.max(maxConfidence, node.confidence);
      }

      const mostConfidentNode = nodes.reduce((a, b) => a.confidence > b.confidence ? a : b);
      
      const mergedNodeId = await this.addNode({
        type: mostConfidentNode.type,
        properties: mergedProperties,
        confidence: maxConfidence,
        provenance: mergedProvenance,
      });

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

  async detectCommunities(): Promise<Community[]> {
    try {
      const result = await pool.query('SELECT id FROM knowledge_graph_nodes LIMIT 1000');
      const nodeIds = result.rows.map(r => r.id);

      return await GraphAlgorithms.detectCommunities(nodeIds);
    } catch (error) {
      logger.error('Failed to detect communities:', error);
      throw error;
    }
  }

  async findInfluencers(): Promise<Array<{ nodeId: string; score: number }>> {
    try {
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
