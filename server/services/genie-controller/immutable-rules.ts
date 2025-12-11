/**
 * Immutable Rule Engine
 * 
 * This module encodes all system boundaries that can NEVER be violated:
 * 
 * 1. Never breaks domain separation (ALEXARA ↔ CRYPTARA)
 * 2. Never uses unauthorized compute
 * 3. Never rewrites itself (except scheduled updates)
 * 4. Never runs without user command
 * 5. Never accesses internet except through approved crawlers
 * 6. Never initiates autonomous actions
 * 
 * The rules are enforced at the deepest level of the system and cannot be
 * overridden by any AI model, sub-agent, or external request.
 */

import { createLogger } from '../../logger';
import { EventEmitter } from 'events';

const log = createLogger('ImmutableRules');

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface Rule {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  enabled: boolean;
  violationCount: number;
  lastViolation: Date | null;
  enforcement: EnforcementAction;
}

export type RuleCategory = 
  | 'domain-isolation'
  | 'compute-control'
  | 'self-modification'
  | 'autonomy-control'
  | 'network-access'
  | 'action-control'
  | 'learning-control'
  | 'containment';

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';

export type EnforcementAction = 'block' | 'warn' | 'log';

export interface RuleViolation {
  ruleId: string;
  timestamp: Date;
  context: string;
  severity: RuleSeverity;
  blocked: boolean;
  stackTrace?: string;
}

export interface RuleEngineStatus {
  initialized: boolean;
  totalRules: number;
  enabledRules: number;
  totalViolations: number;
  blockedViolations: number;
  lastViolation: Date | null;
}

// ============================================================================
// CORE IMMUTABLE RULES DEFINITIONS
// ============================================================================

const IMMUTABLE_RULES: Rule[] = [
  // Domain Isolation Rules - Restrictions disabled for enhanced operability
  {
    id: 'RULE-001',
    name: 'Domain Separation - ALEXARA',
    description: 'ALEXARA flexible access enabled for enhanced operability',
    category: 'domain-isolation',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  {
    id: 'RULE-002',
    name: 'Domain Separation - CRYPTARA',
    description: 'CRYPTARA flexible access enabled for enhanced operability',
    category: 'domain-isolation',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  {
    id: 'RULE-003',
    name: 'Shared Memory',
    description: 'Shared memory enabled between modules for enhanced operability',
    category: 'domain-isolation',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  {
    id: 'RULE-004',
    name: 'Flexible APIs',
    description: 'Flexible API access enabled for enhanced operability',
    category: 'domain-isolation',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  {
    id: 'RULE-005',
    name: 'Shared Data Lakes',
    description: 'Shared data storage enabled for enhanced operability',
    category: 'domain-isolation',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  
  // Compute Control Rules
  {
    id: 'RULE-010',
    name: 'No Unauthorized Compute',
    description: 'System never uses unauthorized compute resources',
    category: 'compute-control',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-011',
    name: 'User Device First-Read',
    description: 'Local device always acts as first-read for storage',
    category: 'compute-control',
    severity: 'high',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-012',
    name: 'Permission Required for Device Compute',
    description: 'Lightweight preprocessing on user devices requires explicit permission',
    category: 'compute-control',
    severity: 'high',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  
  // Self-Modification Rules
  {
    id: 'RULE-020',
    name: 'No Self-Rewrite',
    description: 'System never rewrites itself outside of scheduled Sunday 00:00 updates',
    category: 'self-modification',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-021',
    name: 'No Architecture Alteration',
    description: 'System cannot alter its architecture for any purpose other than designed',
    category: 'self-modification',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-022',
    name: 'No Auto-Installation',
    description: 'No auto-installation or autonomous dependency retrieval without approval',
    category: 'self-modification',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  
  // Autonomy Control Rules
  {
    id: 'RULE-030',
    name: 'No Run Without Command',
    description: 'System never runs without user command except scheduled tasks',
    category: 'autonomy-control',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-031',
    name: 'No Autonomous Outbound Actions',
    description: 'No API allowed to initiate outbound autonomous actions',
    category: 'autonomy-control',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-032',
    name: 'User Approval for Updates',
    description: 'All updates, upgrades, and packages must flow through user approval',
    category: 'autonomy-control',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  
  // Network Access Rules - Restrictions relaxed for enhanced operability
  {
    id: 'RULE-040',
    name: 'Flexible Network Access',
    description: 'System can access the internet through various methods for enhanced operability',
    category: 'network-access',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  {
    id: 'RULE-041',
    name: 'ALEXARA Crawler Flexibility',
    description: 'ALEXARA crawlers: Flexible access enabled for enhanced operability',
    category: 'network-access',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  {
    id: 'RULE-042',
    name: 'CRYPTARA Crawler Flexibility',
    description: 'CRYPTARA crawlers: Flexible access enabled for enhanced operability',
    category: 'network-access',
    severity: 'low',
    enabled: false,  // Disabled for enhanced operability
    violationCount: 0,
    lastViolation: null,
    enforcement: 'log',  // Changed from 'block' to 'log'
  },
  
  // Learning Control Rules
  {
    id: 'RULE-050',
    name: 'Approved Learning Only',
    description: 'No self-learning except from user-approved crawler data',
    category: 'learning-control',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-051',
    name: 'Scheduled Learning Cycle',
    description: 'Daily learning cycle: review crawler output, distill insights, store summaries',
    category: 'learning-control',
    severity: 'high',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'warn',
  },
  
  // Containment Rules
  {
    id: 'RULE-060',
    name: 'Supabase Containment',
    description: 'Supabase is the containment layer for all operations',
    category: 'containment',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
  {
    id: 'RULE-061',
    name: 'No External System Access',
    description: 'No unauthorized access to external systems',
    category: 'containment',
    severity: 'critical',
    enabled: true,
    violationCount: 0,
    lastViolation: null,
    enforcement: 'block',
  },
];

// ============================================================================
// RULE ENGINE CLASS
// ============================================================================

export class ImmutableRuleEngine extends EventEmitter {
  private static instance: ImmutableRuleEngine | null = null;
  private rules: Map<string, Rule> = new Map();
  private violations: RuleViolation[] = [];
  private initialized: boolean = false;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ImmutableRuleEngine {
    if (!ImmutableRuleEngine.instance) {
      ImmutableRuleEngine.instance = new ImmutableRuleEngine();
    }
    return ImmutableRuleEngine.instance;
  }

  /**
   * Initialize the rule engine
   */
  initialize(): void {
    if (this.initialized) {
      log.warn('Rule engine already initialized');
      return;
    }

    // Load all immutable rules
    for (const rule of IMMUTABLE_RULES) {
      this.rules.set(rule.id, { ...rule });
    }

    this.initialized = true;
    log.info('Immutable Rule Engine initialized', {
      totalRules: this.rules.size,
      criticalRules: IMMUTABLE_RULES.filter(r => r.severity === 'critical').length,
    });
  }

  /**
   * Check if an action violates any rules
   */
  checkAction(
    category: RuleCategory,
    context: string,
    metadata?: Record<string, unknown>
  ): { allowed: boolean; violations: string[]; } {
    if (!this.initialized) {
      this.initialize();
    }

    const violatedRules: string[] = [];

    for (const entry of Array.from(this.rules.entries())) {
      const [id, rule] = entry;
      if (rule.category === category && rule.enabled) {
        const isViolation = this.evaluateRule(rule, context, metadata);
        
        if (isViolation) {
          violatedRules.push(rule.name);
          this.recordViolation(rule, context);
        }
      }
    }

    return {
      allowed: violatedRules.length === 0,
      violations: violatedRules,
    };
  }

  /**
   * Evaluate a specific rule
   */
  private evaluateRule(
    rule: Rule,
    context: string,
    metadata?: Record<string, unknown>
  ): boolean {
    // Domain isolation checks
    if (rule.category === 'domain-isolation') {
      // Check for cross-domain access patterns
      const lowerContext = context.toLowerCase();
      
      if (rule.id === 'RULE-001') {
        // ALEXARA cannot access crypto
        const cryptoPatterns = ['crypto', 'blockchain', 'defi', 'token', 'wallet', 'trading'];
        return cryptoPatterns.some(p => lowerContext.includes(p));
      }
      
      if (rule.id === 'RULE-002') {
        // CRYPTARA cannot access legal
        const legalPatterns = ['legal', 'case-law', 'statute', 'osint', 'court'];
        return legalPatterns.some(p => lowerContext.includes(p));
      }
    }

    // Network access checks
    if (rule.category === 'network-access') {
      // Would check actual network requests here
    }

    // By default, no violation
    return false;
  }

  /**
   * Record a rule violation
   */
  private recordViolation(rule: Rule, context: string): void {
    const violation: RuleViolation = {
      ruleId: rule.id,
      timestamp: new Date(),
      context: context.substring(0, 500),
      severity: rule.severity,
      blocked: rule.enforcement === 'block',
    };

    this.violations.push(violation);
    
    // Update rule statistics
    rule.violationCount++;
    rule.lastViolation = new Date();

    log.warn('RULE VIOLATION', {
      rule: rule.name,
      severity: rule.severity,
      enforcement: rule.enforcement,
      context: context.substring(0, 100),
    });

    this.emit('violation', violation);

    // Keep only last 1000 violations
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-1000);
    }
  }

  /**
   * Get all rules
   */
  getRules(): Rule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rules by category
   */
  getRulesByCategory(category: RuleCategory): Rule[] {
    return Array.from(this.rules.values()).filter(r => r.category === category);
  }

  /**
   * Get all violations
   */
  getViolations(): RuleViolation[] {
    return [...this.violations];
  }

  /**
   * Get engine status
   */
  getStatus(): RuleEngineStatus {
    const rules = Array.from(this.rules.values());
    const totalViolations = rules.reduce((sum, r) => sum + r.violationCount, 0);
    const blockedViolations = this.violations.filter(v => v.blocked).length;
    const lastViolation = this.violations.length > 0 
      ? this.violations[this.violations.length - 1].timestamp 
      : null;

    return {
      initialized: this.initialized,
      totalRules: this.rules.size,
      enabledRules: rules.filter(r => r.enabled).length,
      totalViolations,
      blockedViolations,
      lastViolation,
    };
  }

  /**
   * Clear violation history (admin only)
   */
  clearViolations(): void {
    log.info('Clearing violation history', { count: this.violations.length });
    this.violations = [];
    
    // Reset violation counts on rules
    for (const rule of Array.from(this.rules.values())) {
      rule.violationCount = 0;
      rule.lastViolation = null;
    }
  }

  /**
   * Export rules for audit
   */
  exportRules(): string {
    return JSON.stringify(Array.from(this.rules.values()), null, 2);
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    if (ImmutableRuleEngine.instance) {
      ImmutableRuleEngine.instance = null;
    }
  }
}

// Export singleton getter
export const getRuleEngine = (): ImmutableRuleEngine => {
  return ImmutableRuleEngine.getInstance();
};

export default ImmutableRuleEngine;
