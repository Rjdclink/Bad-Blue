/**
 * GLOBAL KILL-SWITCH & EMERGENCY HALT AUTHORITY
 *
 * Provides immediate halt capability with multiple trigger mechanisms.
 * Preserves the original governance kill-switch while remaining compatible
 * with the newer MithrilAdamant execution gate.
 *
 * IMPORTANT STARTUP CONTRACT:
 * Importing this module must not initialize StageManager, RiskGovernor,
 * Eden, SwarmOrchestrator, or any other CryptoCrawler subsystem.
 * Heavy dependencies are loaded only when kill-switch behavior is invoked.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../logger';
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
  private isShuttingDown = false;
  private automaticTriggersConfigured = false;
  private automaticTriggersInitializing: Promise<void> | null = null;

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

    log.info('Kill-Switch initialized; monitoring remains lazy until invoked', {
      armed: this.state.armed,
      environmentActive: this.state.isActive,
    });
  }

  static getInstance(): KillSwitchManager {
    if (!KillSwitchManager.instance) {
      KillSwitchManager.instance = new KillSwitchManager();
    }

    return KillSwitchManager.instance;
  }

  // ============================================================================
  // LAZY DEPENDENCY INITIALIZATION
  // ============================================================================

  /**
   * Wire automatic risk/anomaly listeners only when governance monitoring is
   * explicitly invoked. Importing this module alone never loads those systems.
   */
  async initializeMonitoring(): Promise<void> {
    if (this.automaticTriggersConfigured) return;
    if (this.automaticTriggersInitializing) {
      return this.automaticTriggersInitializing;
    }

    this.automaticTriggersInitializing = (async () => {
      try {
        const [stageModule, riskModule] = await Promise.all([
          import('./stage-management.js'),
          import('./risk-governor.js'),
        ]);

        const { stageManager } = stageModule;
        const { riskGovernor } = riskModule;

        riskGovernor.on('circuit-breaker-tripped', (data: any) => {
          if (data.id === 'max-drawdown' || data.id === 'daily-loss') {
            void this.activateAutomatic(
              KillSwitchType.SOFT_HALT,
              'circuit-breaker',
              `Critical circuit breaker tripped: ${data.name}`
            );
          }
        });

        stageManager.on('anomaly-detected', (data: any) => {
          if (data.severity === 'critical') {
            void this.activateAutomatic(
              KillSwitchType.SOFT_HALT,
              'anomaly',
              `Critical anomaly: ${data.reason}`
            );
          }
        });

        this.automaticTriggersConfigured = true;
        log.info('Automatic kill-switch triggers configured');
      } catch (error) {
        log.error('Failed to initialize automatic kill-switch monitoring', { error });
        throw error;
      } finally {
        this.automaticTriggersInitializing = null;
      }
    })();

    return this.automaticTriggersInitializing;
  }

  private async getGovernanceSnapshot(): Promise<{
    currentStage: number;
    totalProfit: number;
  }> {
    try {
      const { stageManager } = await import('./stage-management.js');
      return {
        currentStage: stageManager.getCurrentStage(),
        totalProfit: stageManager.getTotalProfit(),
      };
    } catch (error) {
      log.error('Unable to capture governance snapshot for kill-switch activation', { error });
      return {
        currentStage: 0,
        totalProfit: 0,
      };
    }
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
      log.error('UNAUTHORIZED KILL-SWITCH ATTEMPT', { authority, reason });
      return {
        success: false,
        message: 'Unauthorized - Invalid composer authority',
      };
    }

    if (this.isShuttingDown) {
      return {
        success: false,
        message: 'System already shutting down',
      };
    }

    try {
      await this.initializeMonitoring();
    } catch {
      // Kill-switch activation must remain available even when monitoring
      // dependencies cannot be initialized. Shutdown execution has its own
      // guarded dependency loading below.
    }

    const snapshot = await this.getGovernanceSnapshot();

    log.warn('KILL-SWITCH ACTIVATED', {
      type,
      authority,
      reason,
    });

    const activation: KillSwitchActivation = {
      id: `kill-${Date.now()}`,
      type,
      trigger: authority.startsWith('composer') ? 'composer' : 'manual',
      authority,
      reason,
      timestamp: Date.now(),
      currentStage: snapshot.currentStage,
      totalProfit: snapshot.totalProfit,
      activePositions: 0,
      canRecover: type !== KillSwitchType.EMERGENCY_SHUTDOWN,
      recoveryProcedure:
        type === KillSwitchType.SOFT_HALT
          ? 'Use requestUnpause() to resume operations'
          : 'Requires manual restart and state verification',
    };

    await this.executeShutdown(activation);

    return {
      success: true,
      message: `Kill-switch activated: ${type} halt by ${authority}`,
    };
  }

  async activateAutomatic(
    type: KillSwitchType,
    trigger: string,
    reason: string
  ): Promise<void> {
    if (this.isShuttingDown) return;

    const snapshot = await this.getGovernanceSnapshot();

    log.warn('AUTOMATIC KILL-SWITCH TRIGGERED', {
      type,
      trigger,
      reason,
    });

    const activation: KillSwitchActivation = {
      id: `auto-kill-${Date.now()}`,
      type,
      trigger: 'automatic',
      authority: 'system',
      reason: `Automatic trigger: ${trigger} - ${reason}`,
      timestamp: Date.now(),
      currentStage: snapshot.currentStage,
      totalProfit: snapshot.totalProfit,
      activePositions: 0,
      canRecover: type !== KillSwitchType.EMERGENCY_SHUTDOWN,
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

  private async executeShutdown(activation: KillSwitchActivation): Promise<void> {
    this.isShuttingDown = true;
    this.state.isActive = true;
    this.state.lastActivation = activation;
    this.state.activationCount++;
    this.activationHistory.push(activation);

    this.emit('kill-switch-activated', activation);

    const startTime = Date.now();

    try {
      // PHASE 1 — PAUSE AND CAPTURE GOVERNANCE STATE
      try {
        const [stageModule, riskModule] = await Promise.all([
          import('./stage-management.js'),
          import('./risk-governor.js'),
        ]);

        stageModule.stageManager.pause(`Kill-switch: ${activation.reason}`);
        stageModule.stageManager.exportState();
        riskModule.riskGovernor.exportState();
      } catch (error) {
        log.error('Governance pause/state capture failed during shutdown', { error });
      }

      // PHASE 2 — EDEN RETURN PULSE
      try {
        const { eden } = await import('../eden/service.js');
        await eden.performReturnPulse();
      } catch (error) {
        log.error('Eden return pulse failed during shutdown', { error });
      }

      // PHASE 3 — EMERGENCY POSITION HANDLING
      if (activation.type === KillSwitchType.EMERGENCY_SHUTDOWN) {
        log.warn('[SHUTDOWN] Emergency position closure requested');

        /*
         * Actual exchange-position closure must be connected to the
         * production execution layer. This preserves the original behavior.
         */
      }

      // PHASE 4 — STOP SWARM
      try {
        const { swarmOrchestrator } = await import('../agents/swarm-orchestrator.js');
        await swarmOrchestrator.stop();
      } catch (error) {
        log.error('Swarm shutdown reported an error', { error });
      }

      const elapsed = Date.now() - startTime;

      log.info('SHUTDOWN SEQUENCE COMPLETE', {
        type: activation.type,
        elapsed: `${elapsed}ms`,
        statePreserved: true,
        canRecover: activation.canRecover,
      });

      this.emit('shutdown-complete', {
        activation,
        elapsed,
        timestamp: Date.now(),
      });
    } catch (error) {
      log.error('ERROR DURING SHUTDOWN SEQUENCE', { error });

      this.emit('shutdown-error', {
        activation,
        error,
        timestamp: Date.now(),
      });
    } finally {
      this.isShuttingDown = false;
    }
  }

  // ============================================================================
  // AUTOMATIC TRIGGERS
  // ============================================================================

  checkAutomaticTriggers(): void {
    void this.checkAutomaticTriggersAsync();
  }

  private async checkAutomaticTriggersAsync(): Promise<void> {
    try {
      await this.initializeMonitoring();

      const { stageManager } = await import('./stage-management.js');
      const state = stageManager.getState();
      const triggers = this.state.automaticTriggers;

      if (state.currentDrawdownPercent > triggers.maxDrawdownPercent) {
        await this.activateAutomatic(
          KillSwitchType.SOFT_HALT,
          'max-drawdown',
          `Drawdown exceeded: ${state.currentDrawdownPercent.toFixed(2)}% > ${triggers.maxDrawdownPercent}%`
        );
      }

      if (state.totalProfitUSD < -triggers.maxLossUSD) {
        await this.activateAutomatic(
          KillSwitchType.HARD_HALT,
          'max-loss',
          `Total loss exceeded: $${state.totalProfitUSD.toFixed(2)} < -$${triggers.maxLossUSD}`
        );
      }
    } catch (error) {
      log.error('Automatic kill-switch trigger check failed', { error });
    }
  }

  // ============================================================================
  // AUTHORIZATION
  // ============================================================================

  private verifyAuthority(authority: string, authToken?: string): boolean {
    if (!this.state.authorizedComposers.includes(authority)) {
      return false;
    }

    if (this.state.requiresMultiFactor && !authToken) {
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

  addAuthorizedComposer(composerId: string): void {
    if (!this.state.authorizedComposers.includes(composerId)) {
      this.state.authorizedComposers.push(composerId);
      log.info('Authorized composer added', { composerId });
    }
  }

  removeAuthorizedComposer(composerId: string): void {
    const index = this.state.authorizedComposers.indexOf(composerId);

    if (index > -1) {
      this.state.authorizedComposers.splice(index, 1);
      log.info('Authorized composer removed', { composerId });
    }
  }

  // ============================================================================
  // RECOVERY
  // ============================================================================

  async attemptRecovery(
    authority: string,
    authToken?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isActive()) {
      return {
        success: false,
        message: 'Kill-switch not active - no recovery needed',
      };
    }

    if (!this.state.lastActivation?.canRecover) {
      return {
        success: false,
        message: 'System cannot recover from this shutdown type',
      };
    }

    if (!this.verifyAuthority(authority, authToken)) {
      return {
        success: false,
        message: 'Unauthorized recovery attempt',
      };
    }

    if (process.env.SYSTEM_KILL_SWITCH === 'true') {
      return {
        success: false,
        message: 'Environment kill-switch remains active',
      };
    }

    this.state.isActive = false;

    log.info('RECOVERY COMPLETE - System remains paused awaiting UNPAUSE', {
      authority,
    });

    this.emit('recovery-complete', {
      authority,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: 'Recovery complete - System paused, use requestUnpause() to resume',
    };
  }

  // ============================================================================
  // STATE
  // ============================================================================

  isActive(): boolean {
    return (
      this.state.isActive ||
      process.env.SYSTEM_KILL_SWITCH === 'true'
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
        process.env.SYSTEM_KILL_SWITCH === 'true',
      authorizedComposers: [
        ...this.state.authorizedComposers,
      ],
      automaticTriggers: {
        ...this.state.automaticTriggers,
      },
    };
  }

  getLastActivation(): KillSwitchActivation | undefined {
    return this.state.lastActivation;
  }

  getActivationHistory(): KillSwitchActivation[] {
    return [...this.activationHistory];
  }

  exportState(): any {
    return {
      state: this.getState(),
      activationHistory: [...this.activationHistory],
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// LAZY SINGLETON ACCESS
// ============================================================================

export function getKillSwitch(): KillSwitchManager {
  return KillSwitchManager.getInstance();
}

/**
 * Backward-compatible lazy facade.
 *
 * Existing callers can continue using `killSwitch.method()` without causing
 * KillSwitchManager construction merely by importing this module.
 */
export const killSwitch: KillSwitchManager = new Proxy(
  {} as KillSwitchManager,
  {
    get(_target, property) {
      const instance = getKillSwitch();
      const value = Reflect.get(instance as any, property, instance);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_target, property, value) {
      const instance = getKillSwitch();
      return Reflect.set(instance as any, property, value, instance);
    },
  }
) as KillSwitchManager;

// ============================================================================
// MITHRILADAMANT COMPATIBILITY
// ============================================================================

/**
 * Compatibility entry point used by handler.ts/system-control.ts.
 */
export async function isActive(
  context: ExecutionContext
): Promise<KillSwitchResult> {
  const contextForced = context.flags?.killSwitch === true;
  const environmentForced = process.env.SYSTEM_KILL_SWITCH === 'true';
  const state = getKillSwitch().getState();

  const active =
    contextForced ||
    environmentForced ||
    state.isActive;

  let reason: string | undefined;

  if (contextForced) {
    reason = 'Kill switch engaged by execution context';
  } else if (environmentForced) {
    reason = 'Kill switch engaged via environment variable';
  } else if (state.isActive) {
    reason = state.lastActivation?.reason || 'Kill switch active';
  }

  return {
    active,
    reason,
  };
}
