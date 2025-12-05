/**
 * Graph Algorithms
 * Phase 4A - Part 2: Graph traversal and analysis algorithms
 */

import { pool } from '../../../db';
import { Community } from '../types';
import { createLogger } from '../../../logger';

const logger = createLogger('GraphAlgorithms');

export class GraphAlgorithms {
  /**
   * Breadth-First Search traversal
   */
  static async breadthFirstSearch(startNodeId: string, maxDepth: number): Promise<string[]> {
    try {
      const visited = new Set<string>([startNodeId]);
      const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];
      const result: string[] = [startNodeId];

      while (queue.length > 0) {
        const current = queue.shift()!;

        if (current.depth >= maxDepth) {
          continue;
        }

        const edgesResult = await pool.query(
          'SELECT target_id FROM knowledge_graph_edges WHERE source_id = $1',
          [current.id]
        );

        for (const row of edgesResult.rows) {
          const targetId = row.target_id;
          
          if (!visited.has(targetId)) {
            visited.add(targetId);
            result.push(targetId);
            queue.push({ id: targetId, depth: current.depth + 1 });
          }
        }
      }

      return result;
    } catch (error) {
      logger.error('BFS error:', error);
      return [startNodeId];
    }
  }

  /**
   * Depth-First Search traversal
   */
  static async depthFirstSearch(startNodeId: string, maxDepth: number): Promise<string[]> {
    const visited = new Set<string>();
    const result: string[] = [];

    const dfs = async (nodeId: string, depth: number) => {
      if (depth > maxDepth || visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      result.push(nodeId);

      try {
        const edgesResult = await pool.query(
          'SELECT target_id FROM knowledge_graph_edges WHERE source_id = $1',
          [nodeId]
        );

        for (const row of edgesResult.rows) {
          await dfs(row.target_id, depth + 1);
        }
      } catch (error) {
        logger.error('DFS error at node:', nodeId, error);
      }
    };

    await dfs(startNodeId, 0);
    return result;
  }

  /**
   * Dijkstra's shortest path algorithm
   */
  static async dijkstraShortestPath(sourceId: string, targetId: string): Promise<string[]> {
    try {
      const edgesResult = await pool.query(`
        SELECT id, source_id, target_id, weight 
        FROM knowledge_graph_edges
      `);

      const edges = edgesResult.rows;
      const adjacency = new Map<string, Array<{ target: string; edgeId: string; weight: number }>>();
      
      for (const edge of edges) {
        if (!adjacency.has(edge.source_id)) {
          adjacency.set(edge.source_id, []);
        }
        adjacency.get(edge.source_id)!.push({
          target: edge.target_id,
          edgeId: edge.id,
          // Edge weight (0-1) represents relationship strength
          // Convert to distance: higher strength = lower cost for shortest path
          weight: 1 - edge.weight,
        });
      }

      const distances = new Map<string, number>();
      const previous = new Map<string, { nodeId: string; edgeId: string } | null>();
      const unvisited = new Set<string>();

      distances.set(sourceId, 0);
      previous.set(sourceId, null);
      unvisited.add(sourceId);

      for (const [node] of adjacency) {
        if (node !== sourceId) {
          distances.set(node, Infinity);
          previous.set(node, null);
          unvisited.add(node);
        }
      }

      while (unvisited.size > 0) {
        let minNode: string | null = null;
        let minDist = Infinity;

        for (const node of unvisited) {
          const dist = distances.get(node) || Infinity;
          if (dist < minDist) {
            minDist = dist;
            minNode = node;
          }
        }

        if (minNode === null || minDist === Infinity) {
          break;
        }

        unvisited.delete(minNode);

        if (minNode === targetId) {
          break;
        }

        const neighbors = adjacency.get(minNode) || [];
        for (const { target, edgeId, weight } of neighbors) {
          const altDistance = minDist + weight;
          const currentDistance = distances.get(target) || Infinity;

          if (altDistance < currentDistance) {
            distances.set(target, altDistance);
            previous.set(target, { nodeId: minNode, edgeId });
            unvisited.add(target);
          }
        }
      }

      const path: string[] = [];
      let current = targetId;

      while (previous.has(current) && previous.get(current) !== null) {
        const prev = previous.get(current)!;
        path.unshift(prev.edgeId);
        current = prev.nodeId;
      }

      if (current !== sourceId) {
        return [];
      }

      return path;
    } catch (error) {
      logger.error('Dijkstra shortest path error:', error);
      return [];
    }
  }

  /**
   * Detect communities using connected components
   */
  static async detectCommunities(nodeIds: string[]): Promise<Community[]> {
    try {
      if (nodeIds.length === 0) {
        return [];
      }

      const edgesResult = await pool.query(`
        SELECT source_id, target_id, weight, confidence
        FROM knowledge_graph_edges
        WHERE source_id = ANY($1) AND target_id = ANY($1)
      `, [nodeIds]);

      const adjacency = new Map<string, Set<string>>();
      const edgeWeights = new Map<string, number>();

      for (const node of nodeIds) {
        adjacency.set(node, new Set());
      }

      for (const edge of edgesResult.rows) {
        adjacency.get(edge.source_id)?.add(edge.target_id);
        adjacency.get(edge.target_id)?.add(edge.source_id);
        
        const key = `${edge.source_id}-${edge.target_id}`;
        edgeWeights.set(key, edge.weight * edge.confidence);
      }

      const parent = new Map<string, string>();
      const rank = new Map<string, number>();

      for (const node of nodeIds) {
        parent.set(node, node);
        rank.set(node, 0);
      }

      const find = (node: string): string => {
        if (parent.get(node) !== node) {
          parent.set(node, find(parent.get(node)!));
        }
        return parent.get(node)!;
      };

      const union = (node1: string, node2: string) => {
        const root1 = find(node1);
        const root2 = find(node2);

        if (root1 !== root2) {
          const rank1 = rank.get(root1) || 0;
          const rank2 = rank.get(root2) || 0;

          if (rank1 < rank2) {
            parent.set(root1, root2);
          } else if (rank1 > rank2) {
            parent.set(root2, root1);
          } else {
            parent.set(root2, root1);
            rank.set(root1, rank1 + 1);
          }
        }
      };

      for (const [node, neighbors] of adjacency) {
        for (const neighbor of neighbors) {
          union(node, neighbor);
        }
      }

      const communities = new Map<string, string[]>();
      for (const node of nodeIds) {
        const root = find(node);
        if (!communities.has(root)) {
          communities.set(root, []);
        }
        communities.get(root)!.push(node);
      }

      const result: Community[] = [];
      for (const [, nodes] of communities) {
        if (nodes.length < 2) {
          continue;
        }

        let totalWeight = 0;
        let edgeCount = 0;

        for (const node1 of nodes) {
          for (const node2 of nodes) {
            if (node1 !== node2) {
              const key = `${node1}-${node2}`;
              if (edgeWeights.has(key)) {
                totalWeight += edgeWeights.get(key)!;
                edgeCount++;
              }
            }
          }
        }

        const strength = edgeCount > 0 ? totalWeight / edgeCount : 0;

        result.push({
          nodes,
          strength,
        });
      }

      result.sort((a, b) => b.strength - a.strength);

      return result;
    } catch (error) {
      logger.error('Community detection error:', error);
      return [];
    }
  }

  /**
   * Calculate centrality (importance) of a node
   */
  static async calculateCentrality(nodeId: string): Promise<number> {
    try {
      const result = await pool.query(`
        SELECT COUNT(*) as degree FROM (
          SELECT source_id FROM knowledge_graph_edges WHERE target_id = $1
          UNION
          SELECT target_id FROM knowledge_graph_edges WHERE source_id = $1
        ) as connections
      `, [nodeId]);

      return parseInt(result.rows[0]?.degree || '0', 10);
    } catch (error) {
      logger.error('Centrality calculation error:', error);
      return 0;
    }
  }
}
