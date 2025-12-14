/**
 * PILOT-NARROW MODE
 * 
 * Capability gating for Cryptara (Pilot):
 * - Can do: Stage 5 micro trade attempt (one), logging, auto-pause
 * - Cannot do: self-tuning, parameter search, alternate pathways, code edits, stage escalation
 * 
 * Enforced as capability gating, not instructions.
 */

import { createLogger } from '../../../logger';
import { getExecutionChokePoint, type ChokePointResult } from './execution-choke-point';

const log = createLogger('PilotNarrowMode');

// ============================================================================
// PILOT CAPABILITIES
// ============================================================================

export enum PilotCapability {
  STAGE_5_MICRO_TRADE = 'stage_5_micro_trade',
  LOGGING = 'logging',
  AUTO_PAUSE = 'auto_pause',
}

export enum ProhibitedPilotAction {
  SELF_TUNING = 'self_tuning',
  PARAMETER_SEARCH = 'parameter_search',
  ALTERNATE_PATHWAYS = 'alternate_pathways',
  CODE_EDITS = 'code_edits',
  STAGE_ESCALATION = 'stage_escalation',
}

// ============================================================================
// PILOT-NARROW MODE GATE
// ============================================================================

export interface PilotActionRequest {
  actorId: string;
  capability: PilotCapability;
  action: string;
  parameters?: Record<string, unknown>;
}

export interface PilotActionResult {
  allowed: boolean;
  reason: string;
  chokePointResult?: ChokePointResult;
}

/**
 * Check if pilot action is allowed in narrow mode
 */
export function checkPilotAction(request: PilotActionRequest): PilotActionResult {
  const { actorId, capability, action } = request;

  // Check if action is prohibited
  const prohibitedActions = Object.values(ProhibitedPilotAction);
  for (const prohibited of prohibitedActions) {
    if (action.toLowerCase().includes(prohibited.toLowerCase())) {
      log.error('Pilot action prohibited', {
        actorId,
        capability,
        action,
        prohibited,
      });
      return {
        allowed: false,
        reason: `Prohibited pilot action: ${prohibited}`,
      };
    }
  }

  // Check capability
  const allowedCapabilities = Object.values(PilotCapability);
  if (!allowedCapabilities.includes(capability)) {
    log.error('Pilot capability not allowed', {
      actorId,
      capability,
      allowedCapabilities,
    });
    return {
      allowed: false,
      reason: `Capability not allowed in Pilot-Narrow mode: ${capability}`,
    };
  }

  // For execution actions, check choke-point
  if (capability === PilotCapability.STAGE_5_MICRO_TRADE) {
    const chokePoint = getExecutionChokePoint();
    const chokeResult = chokePoint.checkExecution(
      actorId,
      'pilot',
      'execution',
      action
    );

    if (!chokeResult.allowed) {
      return {
        allowed: false,
        reason: `Choke-point blocked: ${chokeResult.reason}`,
        chokePointResult: chokeResult,
      };
    }
  }

  log.info('Pilot action allowed', {
    actorId,
    capability,
    action,
  });

  return {
    allowed: true,
    reason: 'Action allowed in Pilot-Narrow mode',
  };
}
