/**
 * GLOBAL KILL-SWITCH & EMERGENCY HALT AUTHORITY
 *
 * Provides immediate halt capability with multiple trigger mechanisms.
 * Preserves the original governance kill-switch while remaining compatible
 * with the newer MithrilAdamant execution gate.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
import { stageManager } from './stage-management';
import { riskGovernor } from './risk-governor';
import { eden } from '../eden/service';
import { swarmOrchestrator } from '../agents/swarm-orchestrator';
import type {
  ExecutionContext,
  KillSwitchResult,
} from './system-control.js';

const log = createLogger('KillSwitch');

// ============================================================================
// TYPES
// ============================================================================

export enum KillSwitchType {
  SOFT_HALT = 'soft',
  HARD_HALT = 'hard',
  EMERGENCY_SHUTDOWN = 'emergency',
}

export interface KillSwitchActivation {
  id: string;
  type: KillSwitchType;
  trigger:
    | 'manual'
    | 'automatic'
    | 'composer'
    | 'circuit-breaker'
    | 'anomaly';
  authority: string;
  reason: string;
  timestamp: number;

  currentStage: number;
  totalProfit: number;
  activePositions: number;

  canRecover: boolean;
  recoveryProcedure?: string;
}

export interface KillSwitchState {
  armed: boolean;
  isActive: boolean;
  lastActivation?: KillSwitchActivation;
  activationCount: number;

  authorizedComposers: string[];
  requiresMultiFactor: boolean;

  automaticTriggers: {
    maxDrawdownPercent: number;
    maxLossUSD: number;
    consecutiveFailures: number;
    anomalyThreshold: number;
  };
}

// ============================================================================
// KILL SWITCH MANAGER
// ============================================================================

export class KillSwitchManager extends EventEmitter {
  private static instance: KillSwitchManager | null = null;

  private state: KillSwitchState;
  private activationHistory: KillSwitchActivation[] = [];
  private isShuttingDown: boolean = false;

  private constructor() {
    super();

    this.state = {
      armed: true,
      isActive: process.env.SYSTEM_KILL_SWITCH === 'true',
      activationCount: 0,

      authorizedComposers: [
        'system-admin',
        'human-operator',
      ],

      requiresMultiFactor: true,

      automaticTriggers: {
        maxDrawdownPercent: 25,
        maxLossUSD: 5000,
        consecutiveFailures: 10,
        anomalyThreshold: 5,
      },
    };

    this.setupAutomaticTriggers();

    log.info('Kill-Switch armed and monitoring', {
      automaticTriggers: this.state.automaticTriggers,
    });
  }

  static getInstance(): KillSwitchManager {
    if (!KillSwitchManager.instance) {
      KillSwitchManager.instance =
        new KillSwitchManager();
    }

    return KillSwitchManager.instance;
  }

  // ============================================================================
  // ACTIVATION
  // ============================================================================

  async activate(
    type: KillSwitchType,
    authority: string,
    reason: string,
    authToken?: string
  ): Promise<{ success: boolean; message: string }> {

    if (!this.verifyAuthority(authority, authToken)) {
      log.error(
        'UNAUTHORIZED KILL-SWITCH ATTEMPT',
        { authority, reason }
      );

      return {
        success: false,
        message:
          'Unauthorized - Invalid composer authority',
      };
    }

    if (this.isShuttingDown) {
      return {
        success: false,
        message: 'System already shutting down',
      };
    }

    log.warn('KILL-SWITCH ACTIVATED', {
      type,
      authority,
      reason,
    });

    const activation: KillSwitchActivation = {
      id: `kill-${Date.now()}`,
      type,

      trigger: authority.startsWith('composer')
        ? 'composer'
        : 'manual',

      authority,
      reason,
      timestamp: Date.now(),

      currentStage: stageManager.getCurrentStage(),
      totalProfit: stageManager.getTotalProfit(),

      activePositions: 0,

      canRecover:
        type !== KillSwitchType.EMERGENCY_SHUTDOWN,

      recoveryProcedure:
        type === KillSwitchType.SOFT_HALT
          ? 'Use requestUnpause() to resume operations'
          : 'Requires manual restart and state verification',
    };

    await this.executeShutdown(activation);

    return {
      success: true,
      message:
        `Kill-switch activated: ${type} halt by ${authority}`,
    };
  }

  async activateAutomatic(
    type: KillSwitchType,
    trigger: string,
    reason: string
  ): Promise<void> {

    log.warn(
      'AUTOMATIC KILL-SWITCH TRIGGERED',
      {
        type,
        trigger,
        reason,
      }
    );

    const activation: KillSwitchActivation = {
      id: `auto-kill-${Date.now()}`,
      type,
      trigger: 'automatic',
      authority: 'system',

      reason:
        `Automatic trigger: ${trigger} - ${reason}`,

      timestamp: Date.now(),

      currentStage: stageManager.getCurrentStage(),
      totalProfit: stageManager.getTotalProfit(),

      activePositions: 0,

      canRecover:
        type !== KillSwitchType.EMERGENCY_SHUTDOWN,

      recoveryProcedure:
        type === KillSwitchType.SOFT_HALT
          ? 'Review trigger conditions and manually resume'
          : 'Requires manual restart and state verification',
    };

    await this.executeShutdown(activation);
  }

  // ============================================================================
  // SHUTDOWN
  // ============================================================================

  private async executeShutdown(
    activation: KillSwitchActivation
  ): Promise<void> {

    this.isShuttingDown = true;

    this.state.isActive = true;
    this.state.lastActivation = activation;
    this.state.activationCount++;

    this.activationHistory.push(activation);

    this.emit(
      'kill-switch-activated',
      activation
    );

    const startTime = Date.now();

    try {

      // PHASE 1 — PAUSE
      stageManager.pause(
        `Kill-switch: ${activation.reason}`
      );

      // PHASE 2 — CAPTURE GOVERNANCE STATE
      stageManager.exportState();
      riskGovernor.exportState();

      // PHASE 3 — EDEN RETURN PULSE
      try {
        await eden.performReturnPulse();
      } catch (error) {
        log.error(
          'Eden return pulse failed during shutdown',
          { error }
        );
      }

      // PHASE 4 — EMERGENCY POSITION HANDLING
      if (
        activation.type ===
        KillSwitchType.EMERGENCY_SHUTDOWN
      ) {
        log.warn(
          '[SHUTDOWN] Emergency position closure requested'
        );

        /*
         * Actual exchange-position closure must be
         * connected to the production execution layer.
         */
      }

      // PHASE 5 — STOP SWARM
      try {
        await swarmOrchestrator.stop();
      } catch (error) {
        log.error(
          'Swarm shutdown reported an error',
          { error }
        );
      }

      const elapsed =
        Date.now() - startTime;

      log.info(
        'SHUTDOWN SEQUENCE COMPLETE',
        {
          type: activation.type,
          elapsed: `${elapsed}ms`,
          statePreserved: true,
          canRecover: activation.canRecover,
        }
      );

      this.emit(
        'shutdown-complete',
        {
          activation,
          elapsed,
          timestamp: Date.now(),
        }
      );

    } catch (error) {

      log.error(
        'ERROR DURING SHUTDOWN SEQUENCE',
        { error }
      );

      this.emit(
        'shutdown-error',
        {
          activation,
          error,
          timestamp: Date.now(),
        }
      );

    } finally {
      this.isShuttingDown = false;
    }
  }

  // ============================================================================
  // AUTOMATIC TRIGGERS
  // ============================================================================

  private setupAutomaticTriggers(): void {

    riskGovernor.on(
      'circuit-breaker-tripped',
      (data) => {

        if (
          data.id === 'max-drawdown' ||
          data.id === 'daily-loss'
        ) {
          void this.activateAutomatic(
            KillSwitchType.SOFT_HALT,
            'circuit-breaker',
            `Critical circuit breaker tripped: ${data.name}`
          );
        }
      }
    );

    stageManager.on(
      'anomaly-detected',
      (data) => {

        if (data.severity === 'critical') {
          void this.activateAutomatic(
            KillSwitchType.SOFT_HALT,
            'anomaly',
            `Critical anomaly: ${data.reason}`
          );
        }
      }
    );

    log.info(
      'Automatic kill-switch triggers configured'
    );
  }

  checkAutomaticTriggers(): void {

    const state =
      stageManager.getState();

    const triggers =
      this.state.automaticTriggers;

    if (
      state.currentDrawdownPercent >
      triggers.maxDrawdownPercent
    ) {
      void this.activateAutomatic(
        KillSwitchType.SOFT_HALT,
        'max-drawdown',

        `Drawdown exceeded: ` +
        `${state.currentDrawdownPercent.toFixed(2)}% > ` +
        `${triggers.maxDrawdownPercent}%`
      );
    }

    if (
      state.totalProfitUSD <
      -triggers.maxLossUSD
    ) {
      void this.activateAutomatic(
        KillSwitchType.HARD_HALT,
        'max-loss',

        `Total loss exceeded: ` +
        `$${state.totalProfitUSD.toFixed(2)} < ` +
        `-$${triggers.maxLossUSD}`
      );
    }
  }

  // ============================================================================
  // AUTHORIZATION
  // ============================================================================

  private verifyAuthority(
    authority: string,
    authToken?: string
  ): boolean {

    if (
      !this.state.authorizedComposers.includes(
        authority
      )
    ) {
      return false;
    }

    if (
      this.state.requiresMultiFactor &&
      !authToken
    ) {
      return false;
    }

    if (
      this.state.requiresMultiFactor &&
      authToken &&
      authToken.length < 10
    ) {
      return false;
    }

    return true;
  }

  addAuthorizedComposer(
    composerId: string
  ): void {

    if (
      !this.state.authorizedComposers.includes(
        composerId
      )
    ) {
      this.state.authorizedComposers.push(
        composerId
      );

      log.info(
        'Authorized composer added',
        { composerId }
      );
    }
  }

  removeAuthorizedComposer(
    composerId: string
  ): void {

    const index =
      this.state.authorizedComposers.indexOf(
        composerId
      );

    if (index > -1) {
      this.state.authorizedComposers.splice(
        index,
        1
      );

      log.info(
        'Authorized composer removed',
        { composerId }
      );
    }
  }

  // ============================================================================
  // RECOVERY
  // ============================================================================

  async attemptRecovery(
    authority: string,
    authToken?: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {

    if (!this.isActive()) {
      return {
        success: false,
        message:
          'Kill-switch not active - no recovery needed',
      };
    }

    if (
      !this.state.lastActivation?.canRecover
    ) {
      return {
        success: false,
        message:
          'System cannot recover from this shutdown type',
      };
    }

    if (
      !this.verifyAuthority(
        authority,
        authToken
      )
    ) {
      return {
        success: false,
        message:
          'Unauthorized recovery attempt',
      };
    }

    /*
     * Environment kill-switch cannot be cleared
     * from application code.
     */
    if (
      process.env.SYSTEM_KILL_SWITCH ===
      'true'
    ) {
      return {
        success: false,
        message:
          'Environment kill-switch remains active',
      };
    }

    this.state.isActive = false;

    log.info(
      'RECOVERY COMPLETE - System remains paused awaiting UNPAUSE',
      { authority }
    );

    this.emit(
      'recovery-complete',
      {
        authority,
        timestamp: Date.now(),
      }
    );

    return {
      success: true,
      message:
        'Recovery complete - System paused, use requestUnpause() to resume',
    };
  }

  // ============================================================================
  // STATE
  // ============================================================================

  isActive(): boolean {
    return (
      this.state.isActive ||
      process.env.SYSTEM_KILL_SWITCH ===
        'true'
    );
  }

  isArmed(): boolean {
    return this.state.armed;
  }

  getState(): KillSwitchState {
    return {
      ...this.state,

      isActive:
        this.state.isActive ||
        process.env.SYSTEM_KILL_SWITCH ===
          'true',

      authorizedComposers: [
        ...this.state.authorizedComposers,
      ],

      automaticTriggers: {
        ...this.state.automaticTriggers,
      },
    };
  }

  getLastActivation():
    KillSwitchActivation | undefined {

    return this.state.lastActivation;
  }

  getActivationHistory():
    KillSwitchActivation[] {

    return [
      ...this.activationHistory,
    ];
  }

  exportState(): any {
    return {
      state: this.getState(),

      activationHistory: [
        ...this.activationHistory,
      ],

      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const killSwitch =
  KillSwitchManager.getInstance();

// ============================================================================
// MITHRILADAMANT COMPATIBILITY
// ============================================================================

/**
 * Compatibility entry point used by handler.ts/system-control.ts.
 *
 * This preserves the newer execution gate without replacing the
 * full governance kill-switch.
 */
export async function isActive(
  context: ExecutionContext
): Promise<KillSwitchResult> {

  const contextForced =
    context.flags?.killSwitch === true;

  const environmentForced =
    process.env.SYSTEM_KILL_SWITCH ===
    'true';

  const state =
    killSwitch.getState();

  const active =
    contextForced ||
    environmentForced ||
    state.isActive;

  let reason: string | undefined;

  if (contextForced) {
    reason =
      'Kill switch engaged by execution context';
  } else if (environmentForced) {
    reason =
      'Kill switch engaged via environment variable';
  } else if (state.isActive) {
    reason =
      state.lastActivation?.reason ||
      'Kill switch active';
  }

  return {
    active,
    reason,
  };
}