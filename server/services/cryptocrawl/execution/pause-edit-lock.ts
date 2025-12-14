/**
 * PAUSE EDIT LOCK
 * 
 * When PAUSED = TRUE, enforce:
 * - No file writes
 * - No refactors
 * - No compliance module creation
 * - No gate rewrites
 * 
 * Allowed while paused: state inspection + report generation only
 */

import { createLogger } from '../../../logger';
import { getExecutionChokePoint } from './execution-choke-point';
import { getCanonicalControlManager } from './canonical-control';

const log = createLogger('PauseEditLock');

// ============================================================================
// EDIT LOCK CHECK
// ============================================================================

export interface EditRequest {
  actorId: string;
  filePath: string;
  operation: 'write' | 'delete' | 'refactor' | 'create' | 'modify';
  description: string;
}

export interface EditLockResult {
  allowed: boolean;
  reason: string;
  paused: boolean;
}

/**
 * Check if edit is allowed (blocked when paused)
 */
export function checkEditAllowed(request: EditRequest): EditLockResult {
  const canonicalControl = getCanonicalControlManager();
  
  // If GLOBAL_FULL_AGENT_PAUSE is active, block all edits
  if (canonicalControl.areAgentsPaused()) {
    log.error('Edit blocked: System is PAUSED', {
      actorId: request.actorId,
      filePath: request.filePath,
      operation: request.operation,
      description: request.description,
    });

    return {
      allowed: false,
      reason: 'GLOBAL_FULL_AGENT_PAUSE is active - edits prohibited. Allowed: state inspection + report generation only.',
      paused: true, // Legacy field name (maintained for compatibility)
    };
  }

  // Check for prohibited edit types even when not paused
  const prohibitedOperations = ['refactor', 'compliance_module_creation', 'gate_rewrite'];
  for (const prohibited of prohibitedOperations) {
    if (request.description.toLowerCase().includes(prohibited) ||
        request.filePath.toLowerCase().includes('compliance-enforcer') ||
        request.filePath.toLowerCase().includes('decision-engine')) {
      log.warn('Edit may require explicit authorization', {
        actorId: request.actorId,
        filePath: request.filePath,
        operation: request.operation,
        description: request.description,
      });
    }
  }

  log.info('Edit allowed', {
    actorId: request.actorId,
    filePath: request.filePath,
    operation: request.operation,
  });

  return {
    allowed: true,
    reason: 'Edit allowed - GLOBAL_FULL_AGENT_PAUSE not active',
    paused: false, // Legacy field name (maintained for compatibility)
  };
}
