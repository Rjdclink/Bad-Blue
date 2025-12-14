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
  const chokePoint = getExecutionChokePoint();
  const flags = chokePoint.getCurrentFlags();

  // If paused, block all edits
  if (flags.PAUSED) {
    log.error('Edit blocked: System is PAUSED', {
      actorId: request.actorId,
      filePath: request.filePath,
      operation: request.operation,
      description: request.description,
    });

    return {
      allowed: false,
      reason: 'System is PAUSED - edits prohibited. Allowed: state inspection + report generation only.',
      paused: true,
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
    reason: 'Edit allowed - system not paused',
    paused: false,
  };
}
