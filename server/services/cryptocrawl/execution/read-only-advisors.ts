/**
 * READ-ONLY ADVISORS
 * 
 * Capability gating for non-pilot AIs:
 * - Can do: Output recommendations to Pilot
 * - Cannot do: Write files, run validations, change gates, trigger execution paths
 * 
 * Enforced as capability gating, not instructions.
 */

import { createLogger } from '../../../logger';

const log = createLogger('ReadOnlyAdvisors');

// ============================================================================
// ADVISOR CAPABILITIES
// ============================================================================

export enum AdvisorCapability {
  RECOMMEND = 'recommend',
  ANALYZE = 'analyze',
  REPORT = 'report',
}

export enum ProhibitedAdvisorAction {
  WRITE_FILES = 'write_files',
  RUN_VALIDATIONS = 'run_validations',
  CHANGE_GATES = 'change_gates',
  TRIGGER_EXECUTION = 'trigger_execution',
}

// ============================================================================
// READ-ONLY ADVISOR GATE
// ============================================================================

export interface AdvisorActionRequest {
  actorId: string;
  capability: AdvisorCapability;
  action: string;
  target?: 'pilot' | 'system';
}

export interface AdvisorActionResult {
  allowed: boolean;
  reason: string;
  recommendation?: string;
}

/**
 * Check if advisor action is allowed (read-only)
 */
export function checkAdvisorAction(request: AdvisorActionRequest): AdvisorActionResult {
  const { actorId, capability, action } = request;

  // Check if action is prohibited
  const prohibitedActions = Object.values(ProhibitedAdvisorAction);
  for (const prohibited of prohibitedActions) {
    if (action.toLowerCase().includes(prohibited.toLowerCase())) {
      log.error('Advisor action prohibited', {
        actorId,
        capability,
        action,
        prohibited,
      });
      return {
        allowed: false,
        reason: `Prohibited advisor action: ${prohibited}. Advisors are read-only.`,
      };
    }
  }

  // Check capability
  const allowedCapabilities = Object.values(AdvisorCapability);
  if (!allowedCapabilities.includes(capability)) {
    log.error('Advisor capability not allowed', {
      actorId,
      capability,
      allowedCapabilities,
    });
    return {
      allowed: false,
      reason: `Capability not allowed for read-only advisors: ${capability}`,
    };
  }

  // Extract recommendation if recommending
  let recommendation: string | undefined;
  if (capability === AdvisorCapability.RECOMMEND) {
    recommendation = action; // Action is the recommendation text
  }

  log.info('Advisor action allowed (read-only)', {
    actorId,
    capability,
    action,
    target: request.target || 'pilot',
  });

  return {
    allowed: true,
    reason: 'Action allowed for read-only advisor',
    recommendation,
  };
}
