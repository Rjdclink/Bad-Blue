/**
 * Provenance Manager
 * Phase 4A - Part 2: Data provenance tracking
 */

import { ProvenanceRecord } from '../types';
import { pool } from '../../../db';
import { createLogger } from '../../../logger';

const logger = createLogger('ProvenanceManager');

export class ProvenanceManager {
  /**
   * Create a new provenance record
   */
  static createProvenanceRecord(
    source: string,
    method: string,
    verificationStatus: 'verified' | 'probable' | 'unverified' = 'unverified'
  ): ProvenanceRecord {
    return {
      sourceId: source,
      acquisitionMethod: method,
      timestamp: new Date(),
      verificationStatus,
    };
  }

  /**
   * Verify provenance for a node
   */
  static async verifyProvenance(nodeId: string): Promise<boolean> {
    try {
      const result = await pool.query(
        'SELECT provenance FROM knowledge_graph_nodes WHERE id = $1',
        [nodeId]
      );

      if (result.rows.length === 0) {
        logger.warn(`Node ${nodeId} not found for provenance verification`);
        return false;
      }

      const provenance = result.rows[0].provenance as ProvenanceRecord[];
      return provenance.some(p => p.verificationStatus === 'verified');
    } catch (error) {
      logger.error('Error verifying provenance:', error);
      return false;
    }
  }

  /**
   * Get the full provenance chain for a node
   */
  static async getProvenanceChain(nodeId: string): Promise<ProvenanceRecord[]> {
    try {
      const result = await pool.query(
        'SELECT provenance FROM knowledge_graph_nodes WHERE id = $1',
        [nodeId]
      );

      if (result.rows.length === 0) {
        logger.warn(`Node ${nodeId} not found for provenance chain`);
        return [];
      }

      return result.rows[0].provenance as ProvenanceRecord[];
    } catch (error) {
      logger.error('Error getting provenance chain:', error);
      return [];
    }
  }

  /**
   * Add a provenance record to an existing node
   */
  static async addProvenanceToNode(
    nodeId: string,
    source: string,
    method: string,
    verificationStatus: 'verified' | 'probable' | 'unverified' = 'unverified'
  ): Promise<boolean> {
    try {
      const newRecord = this.createProvenanceRecord(source, method, verificationStatus);
      
      const result = await pool.query(
        `UPDATE knowledge_graph_nodes 
         SET provenance = provenance || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(newRecord), nodeId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error adding provenance to node:', error);
      return false;
    }
  }

  /**
   * Update the verification status of a provenance record
   */
  static async updateVerificationStatus(
    nodeId: string,
    sourceId: string,
    newStatus: 'verified' | 'probable' | 'unverified'
  ): Promise<boolean> {
    try {
      const provenance = await this.getProvenanceChain(nodeId);
      
      const updated = provenance.map(p => {
        if (p.sourceId === sourceId) {
          return { ...p, verificationStatus: newStatus };
        }
        return p;
      });

      const result = await pool.query(
        `UPDATE knowledge_graph_nodes 
         SET provenance = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updated), nodeId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error updating verification status:', error);
      return false;
    }
  }

  /**
   * Get all nodes with unverified provenance
   */
  static async getUnverifiedNodes(): Promise<string[]> {
    try {
      const result = await pool.query(`
        SELECT id FROM knowledge_graph_nodes
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(provenance) AS p
          WHERE p->>'verificationStatus' = 'verified'
        )
      `);

      return result.rows.map(r => r.id);
    } catch (error) {
      logger.error('Error getting unverified nodes:', error);
      return [];
    }
  }
}
