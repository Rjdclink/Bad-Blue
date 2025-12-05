/**
 * Graph Algorithms
 * Graph traversal and analysis algorithms for the knowledge graph
 */

import { pool } from '../../../db';
import { GraphEdge, Community } from '../types';
import { createLogger } from '../../../logger';

const logger = createLogger('GraphAlgorithms');

export class GraphAlgorithms {
  /**
   * Breadth-First Search traversal
   * Returns node IDs reachable from startNodeId within maxDepth
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

        // Get all edges from current node
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
   * Returns node IDs reachable from startNodeId within maxDepth
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
   * Returns array of edge IDs forming the shortest path
   */
  static async dijkstraShortestPath(sourceId: string, targetId: string): Promise<string[]> {
    try {
      // Get all edges for the graph
      const edgesResult = await pool.query(`
        SELECT id, source_id, target_id, weight 
        FROM knowledge_graph_edges
      `);

      const edges = edgesResult.rows;
      
      // Build adjacency list
      const adjacency = new Map<string, Array<{ target: string; edgeId: string; weight: number }>>();
      
      for (const edge of edges) {
        if (!adjacency.has(edge.source_id)) {
          adjacency.set(edge.source_id, []);
        }
        adjacency.get(edge.source_id)!.push({
          target: edge.target_id,
          edgeId: edge.id,
          weight: 1 - edge.weight, // Invert weight so higher weights = shorter distance
        });
      }

      // Dijkstra's algorithm
      const distances = new Map<string, number>();
      const previous = new Map<string, { nodeId: string; edgeId: string } | null>();
      const unvisited = new Set<string>();

      // Initialize
      distances.set(sourceId, 0);
      previous.set(sourceId, null);
      unvisited.add(sourceId);

      // Add all reachable nodes
      for (const [node] of adjacency) {
        if (node !== sourceId) {
          distances.set(node, Infinity);
          previous.set(node, null);
          unvisited.add(node);
        }
      }

      while (unvisited.size > 0) {
        // Find node with minimum distance
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
          break; // No path exists
        }

        unvisited.delete(minNode);

        // Found target
        if (minNode === targetId) {
          break;
        }

        // Update neighbors
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

      // Reconstruct path
      const path: string[] = [];
      let current = targetId;

      while (previous.has(current) && previous.get(current) !== null) {
        const prev = previous.get(current)!;
        path.unshift(prev.edgeId);
        current = prev.nodeId;
      }

      // If we didn't reach the source, no path exists
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
   * Detect communities using simple connected components
   * Returns groups of strongly connected nodes
   */
  static async detectCommunities(nodeIds: string[]): Promise<Community[]> {
    try {
      if (nodeIds.length === 0) {
        return [];
      }

      // Get all edges between the specified nodes
      const edgesResult = await pool.query(`
        SELECT source_id, target_id, weight, confidence
        FROM knowledge_graph_edges
        WHERE source_id = ANY($1) AND target_id = ANY($1)
      `, [nodeIds]);

      // Build adjacency list
      const adjacency = new Map<string, Set<string>>();
      const edgeWeights = new Map<string, number>();

      for (const node of nodeIds) {
        adjacency.set(node, new Set());
      }

      for (const edge of edgesResult.rows) {
        adjacency.get(edge.source_id)?.add(edge.target_id);
        adjacency.get(edge.target_id)?.add(edge.source_id); // Treat as undirected
        
        const key = `${edge.source_id}-${edge.target_id}`;
        edgeWeights.set(key, edge.weight * edge.confidence);
      }

      // Find connected components using Union-Find
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

      // Union connected nodes
      for (const [node, neighbors] of adjacency) {
        for (const neighbor of neighbors) {
          union(node, neighbor);
        }
      }

      // Group nodes by their root
      const communities = new Map<string, string[]>();
      for (const node of nodeIds) {
        const root = find(node);
        if (!communities.has(root)) {
          communities.set(root, []);
        }
        communities.get(root)!.push(node);
      }

      // Calculate community strength (average edge weight within community)
      const result: Community[] = [];
      for (const [, nodes] of communities) {
        if (nodes.length < 2) {
          continue; // Skip single-node communities
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

      // Sort by strength (strongest communities first)
      result.sort((a, b) => b.strength - a.strength);

      return result;
    } catch (error) {
      logger.error('Community detection error:', error);
      return [];
    }
  }

  /**
   * Calculate centrality (importance) of a node
   * Uses degree centrality (number of connections)
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
