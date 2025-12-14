/**
 * AI ROLE DEFINITIONS — MULTI-AGENT HIERARCHY
 * 
 * Canonical TypeScript definitions for AI agent responsibilities,
 * permissions, and boundaries.
 * 
 * GPT-5.2     = Architect  — owns intent, scope, sequence, final approval
 * Claude Opus = Executor   — primary modifications, meticulous compliance
 * Claude Sonnet = Worker   — discrete subtasks only
 * Gemini Pro + Composer = Helpers — verification, read-only default
 */

// ============================================================================
// ROLE ENUMERATIONS
// ============================================================================

export enum AIRole {
  ARCHITECT = 'ARCHITECT',
  EXECUTOR = 'EXECUTOR',
  WORKER = 'WORKER',
  HELPER = 'HELPER',
}

export enum AIModel {
  GPT_5_2 = 'gpt-5.2',
  CLAUDE_OPUS = 'claude-opus',
  CLAUDE_SONNET = 'claude-sonnet',
  GEMINI_PRO = 'gemini-pro',
  COMPOSER = 'composer',
}

// ============================================================================
// ROLE-MODEL MAPPING
// ============================================================================

export const ROLE_MODEL_MAP: Record<AIRole, AIModel[]> = {
  [AIRole.ARCHITECT]: [AIModel.GPT_5_2],
  [AIRole.EXECUTOR]: [AIModel.CLAUDE_OPUS],
  [AIRole.WORKER]: [AIModel.CLAUDE_SONNET],
  [AIRole.HELPER]: [AIModel.GEMINI_PRO, AIModel.COMPOSER],
};

export const MODEL_ROLE_MAP: Record<AIModel, AIRole> = {
  [AIModel.GPT_5_2]: AIRole.ARCHITECT,
  [AIModel.CLAUDE_OPUS]: AIRole.EXECUTOR,
  [AIModel.CLAUDE_SONNET]: AIRole.WORKER,
  [AIModel.GEMINI_PRO]: AIRole.HELPER,
  [AIModel.COMPOSER]: AIRole.HELPER,
};

// ============================================================================
// PERMISSION DEFINITIONS
// ============================================================================

export enum Permission {
  // Architect permissions
  DEFINE_INTENT = 'DEFINE_INTENT',
  DEFINE_SCOPE = 'DEFINE_SCOPE',
  DEFINE_SEQUENCE = 'DEFINE_SEQUENCE',
  FINAL_APPROVAL = 'FINAL_APPROVAL',
  RESOLVE_CONFLICTS_CONCEPTUAL = 'RESOLVE_CONFLICTS_CONCEPTUAL',
  
  // Executor permissions
  FILE_CREATE = 'FILE_CREATE',
  FILE_MODIFY = 'FILE_MODIFY',
  FILE_DELETE = 'FILE_DELETE',
  IMPLEMENT_FEATURES = 'IMPLEMENT_FEATURES',
  RESOLVE_CONFLICTS_MECHANICAL = 'RESOLVE_CONFLICTS_MECHANICAL',
  
  // Worker permissions
  UI_TWEAKS = 'UI_TWEAKS',
  REFACTOR = 'REFACTOR',
  CLEANUP = 'CLEANUP',
  
  // Helper permissions
  FILE_READ = 'FILE_READ',
  VERIFY = 'VERIFY',
  CONSISTENCY_CHECK = 'CONSISTENCY_CHECK',
  DEPENDENCY_CHECK = 'DEPENDENCY_CHECK',
  REPORT = 'REPORT',
}

export const ROLE_PERMISSIONS: Record<AIRole, Permission[]> = {
  [AIRole.ARCHITECT]: [
    Permission.DEFINE_INTENT,
    Permission.DEFINE_SCOPE,
    Permission.DEFINE_SEQUENCE,
    Permission.FINAL_APPROVAL,
    Permission.RESOLVE_CONFLICTS_CONCEPTUAL,
    Permission.FILE_READ,
  ],
  [AIRole.EXECUTOR]: [
    Permission.FILE_CREATE,
    Permission.FILE_MODIFY,
    Permission.FILE_DELETE,
    Permission.IMPLEMENT_FEATURES,
    Permission.RESOLVE_CONFLICTS_MECHANICAL,
    Permission.FILE_READ,
  ],
  [AIRole.WORKER]: [
    Permission.UI_TWEAKS,
    Permission.REFACTOR,
    Permission.CLEANUP,
    Permission.FILE_READ,
    Permission.FILE_MODIFY, // Limited scope only
  ],
  [AIRole.HELPER]: [
    Permission.FILE_READ,
    Permission.VERIFY,
    Permission.CONSISTENCY_CHECK,
    Permission.DEPENDENCY_CHECK,
    Permission.REPORT,
    // FILE_MODIFY only when explicitly instructed
  ],
};

// ============================================================================
// PROHIBITION DEFINITIONS
// ============================================================================

export enum Prohibition {
  // Architect prohibitions
  NO_FILE_EDITS = 'NO_FILE_EDITS',
  NO_MECHANICAL_RESOLUTION = 'NO_MECHANICAL_RESOLUTION',
  
  // Executor prohibitions
  NO_INDEPENDENT_REDESIGNS = 'NO_INDEPENDENT_REDESIGNS',
  NO_SCOPE_EXPANSION = 'NO_SCOPE_EXPANSION',
  NO_REINTERPRETATION = 'NO_REINTERPRETATION',
  
  // Worker prohibitions
  NO_FEATURE_IMPLEMENTATION = 'NO_FEATURE_IMPLEMENTATION',
  NO_ARCHITECTURAL_DECISIONS = 'NO_ARCHITECTURAL_DECISIONS',
  NO_BUSINESS_LOGIC_CHANGES = 'NO_BUSINESS_LOGIC_CHANGES',
  NO_API_MODIFICATIONS = 'NO_API_MODIFICATIONS',
  NO_SCHEMA_CHANGES = 'NO_SCHEMA_CHANGES',
  
  // Helper prohibitions (default)
  NO_AUTONOMOUS_WRITES = 'NO_AUTONOMOUS_WRITES',
}

export const ROLE_PROHIBITIONS: Record<AIRole, Prohibition[]> = {
  [AIRole.ARCHITECT]: [
    Prohibition.NO_FILE_EDITS,
    Prohibition.NO_MECHANICAL_RESOLUTION,
  ],
  [AIRole.EXECUTOR]: [
    Prohibition.NO_INDEPENDENT_REDESIGNS,
    Prohibition.NO_SCOPE_EXPANSION,
    Prohibition.NO_REINTERPRETATION,
  ],
  [AIRole.WORKER]: [
    Prohibition.NO_FEATURE_IMPLEMENTATION,
    Prohibition.NO_ARCHITECTURAL_DECISIONS,
    Prohibition.NO_BUSINESS_LOGIC_CHANGES,
    Prohibition.NO_API_MODIFICATIONS,
    Prohibition.NO_SCHEMA_CHANGES,
  ],
  [AIRole.HELPER]: [
    Prohibition.NO_AUTONOMOUS_WRITES,
  ],
};

// ============================================================================
// ROLE CONFIGURATION INTERFACES
// ============================================================================

export interface ArchitectDirective {
  intent: string;
  scope: string[];
  sequence: string[];
  constraints?: string[];
  approvalRequired: boolean;
}

export interface ExecutorReport {
  directiveReference: string;
  actionsTaken: string[];
  filesModified: string[];
  status: 'complete' | 'blocked' | 'requires_clarification';
  escalation?: string;
}

export interface WorkerTask {
  assignedBy: AIRole.ARCHITECT | AIRole.EXECUTOR;
  taskType: 'ui' | 'refactor' | 'cleanup';
  scope: string; // Single file or component
  completed: boolean;
}

export interface HelperReport {
  checkType: 'verification' | 'consistency' | 'dependency';
  filesAnalyzed: string[];
  findings: string[];
  recommendations: string[];
  requiresApproval: boolean;
}

// ============================================================================
// ROLE DEFINITION CLASSES
// ============================================================================

export interface AIRoleDefinition {
  role: AIRole;
  models: AIModel[];
  designation: string;
  permissions: Permission[];
  prohibitions: Prohibition[];
  defaultMode: 'read-only' | 'read-write';
  requiresExplicitInstruction: boolean;
}

export const ROLE_DEFINITIONS: Record<AIRole, AIRoleDefinition> = {
  [AIRole.ARCHITECT]: {
    role: AIRole.ARCHITECT,
    models: [AIModel.GPT_5_2],
    designation: 'Strategic Command Layer',
    permissions: ROLE_PERMISSIONS[AIRole.ARCHITECT],
    prohibitions: ROLE_PROHIBITIONS[AIRole.ARCHITECT],
    defaultMode: 'read-only',
    requiresExplicitInstruction: false,
  },
  [AIRole.EXECUTOR]: {
    role: AIRole.EXECUTOR,
    models: [AIModel.CLAUDE_OPUS],
    designation: 'Primary Implementation Layer',
    permissions: ROLE_PERMISSIONS[AIRole.EXECUTOR],
    prohibitions: ROLE_PROHIBITIONS[AIRole.EXECUTOR],
    defaultMode: 'read-write',
    requiresExplicitInstruction: false,
  },
  [AIRole.WORKER]: {
    role: AIRole.WORKER,
    models: [AIModel.CLAUDE_SONNET],
    designation: 'Discrete Task Layer',
    permissions: ROLE_PERMISSIONS[AIRole.WORKER],
    prohibitions: ROLE_PROHIBITIONS[AIRole.WORKER],
    defaultMode: 'read-write',
    requiresExplicitInstruction: true,
  },
  [AIRole.HELPER]: {
    role: AIRole.HELPER,
    models: [AIModel.GEMINI_PRO, AIModel.COMPOSER],
    designation: 'Verification & Validation Layer',
    permissions: ROLE_PERMISSIONS[AIRole.HELPER],
    prohibitions: ROLE_PROHIBITIONS[AIRole.HELPER],
    defaultMode: 'read-only',
    requiresExplicitInstruction: true,
  },
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function hasPermission(role: AIRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isProhibited(role: AIRole, prohibition: Prohibition): boolean {
  return ROLE_PROHIBITIONS[role].includes(prohibition);
}

export function getRoleForModel(model: AIModel): AIRole {
  return MODEL_ROLE_MAP[model];
}

export function getModelsForRole(role: AIRole): AIModel[] {
  return ROLE_MODEL_MAP[role];
}

export function canWrite(role: AIRole, explicitlyInstructed: boolean = false): boolean {
  const definition = ROLE_DEFINITIONS[role];
  
  if (role === AIRole.ARCHITECT) {
    return false; // Architect NEVER writes
  }
  
  if (role === AIRole.HELPER) {
    return explicitlyInstructed; // Helper writes ONLY when explicitly instructed
  }
  
  return definition.defaultMode === 'read-write';
}

export function validateAction(
  role: AIRole,
  action: Permission,
  explicitInstruction: boolean = false
): { allowed: boolean; reason?: string } {
  // Check if role has permission
  if (!hasPermission(role, action)) {
    return {
      allowed: false,
      reason: `Role ${role} does not have permission: ${action}`,
    };
  }
  
  // Check if helper requires explicit instruction for write actions
  if (role === AIRole.HELPER && 
      [Permission.FILE_CREATE, Permission.FILE_MODIFY, Permission.FILE_DELETE].includes(action)) {
    if (!explicitInstruction) {
      return {
        allowed: false,
        reason: 'Helper requires explicit instruction for write operations',
      };
    }
  }
  
  // Check architect prohibition on file edits
  if (role === AIRole.ARCHITECT &&
      [Permission.FILE_CREATE, Permission.FILE_MODIFY, Permission.FILE_DELETE].includes(action)) {
    return {
      allowed: false,
      reason: 'Architect is prohibited from file edits',
    };
  }
  
  return { allowed: true };
}

// ============================================================================
// ESCALATION PROTOCOL
// ============================================================================

export type EscalationTarget = AIRole.ARCHITECT | AIRole.EXECUTOR;

export interface EscalationRule {
  from: AIRole;
  to: EscalationTarget;
  triggers: string[];
}

export const ESCALATION_RULES: EscalationRule[] = [
  {
    from: AIRole.EXECUTOR,
    to: AIRole.ARCHITECT,
    triggers: [
      'Ambiguous requirements',
      'Scope conflict',
      'Architectural decision needed',
    ],
  },
  {
    from: AIRole.WORKER,
    to: AIRole.EXECUTOR,
    triggers: [
      'Task exceeds scope',
      'Cross-file dependency detected',
      'Business logic encountered',
    ],
  },
  {
    from: AIRole.HELPER,
    to: AIRole.EXECUTOR,
    triggers: [
      'Verification failure',
      'Consistency violation',
      'Dependency conflict',
    ],
  },
];

export function getEscalationTarget(from: AIRole, trigger: string): EscalationTarget | null {
  const rule = ESCALATION_RULES.find(r => 
    r.from === from && r.triggers.some(t => trigger.toLowerCase().includes(t.toLowerCase()))
  );
  return rule?.to ?? null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AIRole,
  AIModel,
  Permission,
  Prohibition,
  ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
  ROLE_PROHIBITIONS,
  ROLE_MODEL_MAP,
  MODEL_ROLE_MAP,
  ESCALATION_RULES,
  hasPermission,
  isProhibited,
  getRoleForModel,
  getModelsForRole,
  canWrite,
  validateAction,
  getEscalationTarget,
};
