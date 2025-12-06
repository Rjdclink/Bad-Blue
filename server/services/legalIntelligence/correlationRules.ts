/**
 * Correlation Rules Engine
 * YAML-based correlation rule evaluation
 * SpiderFoot pattern matching approach
 */

import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { join } from 'path';
import { createLogger } from '../../logger';
import type { CorrelationRule, EntityNode, EntityEdge } from './types';

const logger = createLogger('CorrelationRulesEngine');

export class CorrelationRulesEngine {
  private rules: CorrelationRule[] = [];
  private rulesPath: string;
  private initialized = false;

  constructor(rulesPath?: string) {
    this.rulesPath = rulesPath || join(process.cwd(), 'server', 'services', 'legalIntelligence', 'rules', 'correlationRules.yaml');
  }

  /**
   * Initialize engine and load rules
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadRules();
      this.initialized = true;
      logger.info(`Correlation rules engine initialized with ${this.rules.length} rules`);
    } catch (error) {
      logger.error('Failed to initialize correlation rules engine:', error);
      throw error;
    }
  }

  /**
   * Load rules from YAML file
   */
  async loadRules(): Promise<void> {
    try {
      const yamlContent = await fs.readFile(this.rulesPath, 'utf-8');
      const parsed = yaml.load(yamlContent) as CorrelationRule[];
      
      this.rules = parsed.filter(rule => rule.enabled !== false);
      logger.info(`Loaded ${this.rules.length} rules from ${this.rulesPath}`);
    } catch (error) {
      logger.error('Failed to load rules:', error);
      // If rules file doesn't exist, continue with empty rules
      this.rules = [];
    }
  }

  /**
   * Reload rules from file
   */
  async reload(): Promise<void> {
    await this.loadRules();
    logger.info('Rules reloaded');
  }

  /**
   * Apply rules to entities and find relationships
   */
  async applyRules(entities: EntityNode[]): Promise<EntityEdge[]> {
    const edges: EntityEdge[] = [];
    const startTime = Date.now();

    for (const rule of this.rules) {
      try {
        const ruleEdges = await this.applyRule(rule, entities);
        edges.push(...ruleEdges);
      } catch (error) {
        logger.error(`Error applying rule ${rule.name}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Applied ${this.rules.length} rules in ${duration}ms, found ${edges.length} relationships`);

    return edges;
  }

  /**
   * Apply single rule to entities
   */
  private async applyRule(rule: CorrelationRule, entities: EntityNode[]): Promise<EntityEdge[]> {
    const edges: EntityEdge[] = [];

    // Group entities by type
    const entitiesByType = new Map<string, EntityNode[]>();
    for (const entity of entities) {
      if (!entitiesByType.has(entity.type)) {
        entitiesByType.set(entity.type, []);
      }
      entitiesByType.get(entity.type)!.push(entity);
    }

    // Get entities matching rule types
    const matchingSets: EntityNode[][] = [];
    for (const entityType of rule.entities) {
      const matching = entitiesByType.get(entityType) || [];
      matchingSets.push(matching);
    }

    // Generate combinations and evaluate
    if (matchingSets.length === 2) {
      // Binary relationship
      for (const entity1 of matchingSets[0]) {
        for (const entity2 of matchingSets[1]) {
          if (this.evaluateCondition(rule.condition, entity1, entity2)) {
            edges.push(this.createEdge(entity1, entity2, rule));
          }
        }
      }
    } else if (matchingSets.length === 1) {
      // Self-relationship or grouping
      const entitySet = matchingSets[0];
      for (let i = 0; i < entitySet.length; i++) {
        for (let j = i + 1; j < entitySet.length; j++) {
          if (this.evaluateCondition(rule.condition, entitySet[i], entitySet[j])) {
            edges.push(this.createEdge(entitySet[i], entitySet[j], rule));
          }
        }
      }
    }

    return edges;
  }

  /**
   * Evaluate rule condition
   */
  private evaluateCondition(condition: string, entity1: EntityNode, entity2: EntityNode): boolean {
    try {
      // Parse condition into evaluatable logic
      // This is a simplified implementation
      
      // Check for "same_" conditions
      if (condition.includes('same_officer_name')) {
        const name1 = this.getPropertyValue(entity1, 'name');
        const name2 = this.getPropertyValue(entity2, 'name');
        if (!name1 || !name2 || name1 !== name2) return false;
      }

      if (condition.includes('same_department')) {
        const dept1 = this.getPropertyValue(entity1, 'department');
        const dept2 = this.getPropertyValue(entity2, 'department');
        if (!dept1 || !dept2 || dept1 !== dept2) return false;
      }

      if (condition.includes('same_attorney')) {
        const attorney1 = this.getPropertyValue(entity1, 'attorneyName');
        const attorney2 = this.getPropertyValue(entity2, 'attorneyName');
        if (!attorney1 || !attorney2 || attorney1 !== attorney2) return false;
      }

      if (condition.includes('same_witness')) {
        const witness1 = this.getPropertyValue(entity1, 'witnessName');
        const witness2 = this.getPropertyValue(entity2, 'witnessName');
        if (!witness1 || !witness2 || witness1 !== witness2) return false;
      }

      if (condition.includes('same_agency')) {
        const agency1 = this.getPropertyValue(entity1, 'agency');
        const agency2 = this.getPropertyValue(entity2, 'agency');
        if (!agency1 || !agency2 || agency1 !== agency2) return false;
      }

      // Check for count conditions
      if (condition.includes('lawsuit_count >=')) {
        const match = condition.match(/lawsuit_count >= (\d+)/);
        if (match) {
          const threshold = parseInt(match[1]);
          const count = this.getPropertyValue(entity1, 'lawsuitCount') || 
                       this.getPropertyValue(entity2, 'lawsuitCount') || 0;
          if (count < threshold) return false;
        }
      }

      if (condition.includes('complaint_count >=')) {
        const match = condition.match(/complaint_count >= (\d+)/);
        if (match) {
          const threshold = parseInt(match[1]);
          const count = this.getPropertyValue(entity1, 'complaintCount') || 
                       this.getPropertyValue(entity2, 'complaintCount') || 0;
          if (count < threshold) return false;
        }
      }

      // Check for type conditions
      if (condition.includes('complaint_type ==')) {
        const match = condition.match(/complaint_type == '([^']+)'/);
        if (match) {
          const expectedType = match[1];
          const type = this.getPropertyValue(entity1, 'complaintType') || 
                      this.getPropertyValue(entity2, 'complaintType');
          if (type !== expectedType) return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error evaluating condition:', error);
      return false;
    }
  }

  /**
   * Get property value from entity
   */
  private getPropertyValue(entity: EntityNode, property: string): any {
    return entity.properties[property];
  }

  /**
   * Create edge from rule match
   */
  private createEdge(entity1: EntityNode, entity2: EntityNode, rule: CorrelationRule): EntityEdge {
    return {
      id: `edge_${entity1.id}_${entity2.id}_${Date.now()}`,
      sourceId: entity1.id,
      targetId: entity2.id,
      relationship: rule.patternType,
      weight: 1.0,
      confidence: rule.confidence,
      evidenceIds: [rule.name],
      discoveredAt: new Date(),
    };
  }

  /**
   * Get all rules
   */
  getRules(): CorrelationRule[] {
    return [...this.rules];
  }

  /**
   * Get rules by pattern type
   */
  getRulesByPatternType(patternType: string): CorrelationRule[] {
    return this.rules.filter(rule => rule.patternType === patternType);
  }

  /**
   * Add rule dynamically
   */
  addRule(rule: CorrelationRule): void {
    this.rules.push(rule);
    logger.info(`Rule added: ${rule.name}`);
  }

  /**
   * Remove rule by name
   */
  removeRule(name: string): boolean {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter(rule => rule.name !== name);
    const removed = this.rules.length < initialLength;
    
    if (removed) {
      logger.info(`Rule removed: ${name}`);
    }
    
    return removed;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRules: number;
    enabledRules: number;
    rulesByPatternType: Record<string, number>;
  } {
    const rulesByPatternType: Record<string, number> = {};
    
    for (const rule of this.rules) {
      rulesByPatternType[rule.patternType] = (rulesByPatternType[rule.patternType] || 0) + 1;
    }

    return {
      totalRules: this.rules.length,
      enabledRules: this.rules.filter(r => r.enabled !== false).length,
      rulesByPatternType,
    };
  }
}

// Singleton instance
export const correlationRulesEngine = new CorrelationRulesEngine();
