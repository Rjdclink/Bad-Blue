/**
 * Correlation Database
 * SQLite-based storage for entity correlation data
 * SpiderFoot storage pattern
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { createLogger } from '../../logger';
import type { EntityNode, EntityEdge, IntelligenceEvent, DBEntity, DBRelationship, DBCorrelationEvent } from './types';

const logger = createLogger('CorrelationDB');

export class CorrelationDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || join(process.cwd(), 'data', 'correlation.db');
  }

  /**
   * Initialize database and create schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.db = new Database(this.dbPath);
      
      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      
      this.createSchema();
      this.initialized = true;
      logger.info('Correlation database initialized:', this.dbPath);
    } catch (error) {
      logger.error('Failed to initialize correlation database:', error);
      throw error;
    }
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        properties TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_confidence ON entities(confidence);

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        weight REAL NOT NULL,
        confidence REAL NOT NULL,
        evidence TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_id) REFERENCES entities(id),
        FOREIGN KEY (target_id) REFERENCES entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relationship_type);

      CREATE TABLE IF NOT EXISTS correlation_events (
        id TEXT PRIMARY KEY,
        entity_id TEXT,
        event_type TEXT NOT NULL,
        data TEXT NOT NULL,
        module_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entity_id) REFERENCES entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_correlation_events_entity ON correlation_events(entity_id);
      CREATE INDEX IF NOT EXISTS idx_correlation_events_type ON correlation_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_correlation_events_module ON correlation_events(module_name);
    `);
  }

  /**
   * Add entity to database
   */
  addEntity(entity: EntityNode): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities (id, type, properties, confidence, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      entity.id,
      entity.type,
      JSON.stringify(entity.properties),
      entity.confidence
    );
  }

  /**
   * Get entity by ID
   */
  getEntity(id: string): EntityNode | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM entities WHERE id = ?');
    const row = stmt.get(id) as DBEntity | undefined;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type as any,
      properties: JSON.parse(row.properties),
      confidence: row.confidence,
      sources: [],
      discoveredAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find entities by type
   */
  findEntitiesByType(type: string): EntityNode[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM entities WHERE type = ? ORDER BY confidence DESC');
    const rows = stmt.all(type) as DBEntity[];

    return rows.map(row => ({
      id: row.id,
      type: row.type as any,
      properties: JSON.parse(row.properties),
      confidence: row.confidence,
      sources: [],
      discoveredAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Add relationship to database
   */
  addRelationship(edge: EntityEdge): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO relationships 
      (id, source_id, target_id, relationship_type, weight, confidence, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      edge.id,
      edge.sourceId,
      edge.targetId,
      edge.relationship,
      edge.weight,
      edge.confidence,
      JSON.stringify(edge.evidenceIds)
    );
  }

  /**
   * Get relationships for an entity
   */
  getRelationships(entityId: string): EntityEdge[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM relationships 
      WHERE source_id = ? OR target_id = ?
    `);
    
    const rows = stmt.all(entityId, entityId) as DBRelationship[];

    return rows.map(row => ({
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationship: row.relationship_type,
      weight: row.weight,
      confidence: row.confidence,
      evidenceIds: row.evidence ? JSON.parse(row.evidence) : [],
      discoveredAt: new Date(row.created_at),
    }));
  }

  /**
   * Find relationships between two entities
   */
  findRelationshipsBetween(sourceId: string, targetId: string): EntityEdge[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM relationships 
      WHERE (source_id = ? AND target_id = ?) 
         OR (source_id = ? AND target_id = ?)
    `);
    
    const rows = stmt.all(sourceId, targetId, targetId, sourceId) as DBRelationship[];

    return rows.map(row => ({
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationship: row.relationship_type,
      weight: row.weight,
      confidence: row.confidence,
      evidenceIds: row.evidence ? JSON.parse(row.evidence) : [],
      discoveredAt: new Date(row.created_at),
    }));
  }

  /**
   * Log correlation event
   */
  logEvent(event: IntelligenceEvent): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO correlation_events (id, entity_id, event_type, data, module_name)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.entityId || null,
      event.type,
      JSON.stringify(event.data),
      event.sourceModule
    );
  }

  /**
   * Get events for an entity
   */
  getEvents(entityId: string): IntelligenceEvent[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM correlation_events 
      WHERE entity_id = ?
      ORDER BY created_at DESC
    `);
    
    const rows = stmt.all(entityId) as DBCorrelationEvent[];

    return rows.map(row => ({
      id: row.id,
      type: row.event_type,
      entityId: row.entity_id,
      data: JSON.parse(row.data),
      sourceModule: row.module_name,
      timestamp: new Date(row.created_at),
      processed: true,
    }));
  }

  /**
   * Execute transaction
   */
  transaction<T>(fn: () => T): T {
    if (!this.db) throw new Error('Database not initialized');
    
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('Correlation database closed');
    }
  }

  /**
   * Get database statistics
   */
  getStats(): { entities: number; relationships: number; events: number } {
    if (!this.db) throw new Error('Database not initialized');

    const entities = this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number };
    const relationships = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };
    const events = this.db.prepare('SELECT COUNT(*) as count FROM correlation_events').get() as { count: number };

    return {
      entities: entities.count,
      relationships: relationships.count,
      events: events.count,
    };
  }
}

// Singleton instance
export const correlationDatabase = new CorrelationDatabase();
