import crypto from 'crypto';
import logger from '../../../logger.js';
import type {
  CryptocrawlStage,
  ExecutionEnvelope,
  ExecutionEnvelopeConstraints,
  GovernanceAction,
  GovernanceActor,
  GovernanceState,
} from './types.js';
import { GovernanceError } from './types.js';
import { Stage as ManagedStage, stageManager } from './stage-management.js';

const DEFAULT_STAGE: CryptocrawlStage = 1;

function nowMs(): number {
  return Date.now();
}

function newId(prefix: string): string {
  // Short, non-sensitive identifier suitable for logs.
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeList(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const cleaned = values.map(v => String(v).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function isExpired(envelope: ExecutionEnvelope, at: number): boolean {
  return at >= envelope.expiresAt;
}

class LegacyCryptocrawlGovernance {
  private state: GovernanceState = {
    stage: DEFAULT_STAGE,
    paused: true,
    pauseReason: 'default_startup_paused',
    pausedAt: nowMs(),
    killSwitch: { armed: false, engaged: false },
    activeEnvelope: null,
    executionsInEnvelope: 0,
  };

  getState(): Readonly<GovernanceState> {
    return { ...this.state, killSwitch: { ...this.state.killSwitch }, activeEnvelope: this.state.activeEnvelope ? { ...this.state.activeEnvelope } : null };
  }

  /**
   * Stage is administrative configuration; by default we keep the system paused on stage transitions.
   */
  setStage(stage: CryptocrawlStage, actor: GovernanceActor, reason = 'stage_change'): void {
    this.state.stage = stage;
    this.pause(actor, `stage=${stage}:${reason}`);
    logger.warn('[Governance] Stage set; system paused', {
      component: 'CryptocrawlGovernance',
      stage,
      actor,
      reason,
    });
  }

  pause(actor: GovernanceActor, reason = 'manual_pause'): void {
    this.state.paused = true;
    this.state.pauseReason = reason;
    this.state.pausedAt = nowMs();
    this.state.activeEnvelope = null;
    this.state.executionsInEnvelope = 0;
    logger.info('[Governance] Paused', {
      component: 'CryptocrawlGovernance',
      actor,
      reason,
    });
  }

  /**
   * Stage 2+ requires explicit UNPAUSE with a time-bounded envelope.
   * Stage 1 remains advisory-only (no execution allowed even when unpaused).
   */
  unpauseWithEnvelope(input: {
    stage: CryptocrawlStage;
    scope: string;
    authority: GovernanceActor;
    durationMs: number;
    allowedActions: GovernanceAction[];
    constraints?: ExecutionEnvelopeConstraints;
  }): ExecutionEnvelope {
    const at = nowMs();

    if (input.stage !== this.state.stage) {
      throw new GovernanceError('STAGE_VIOLATION', 'Envelope stage must match current governance stage', {
        currentStage: this.state.stage,
        envelopeStage: input.stage,
      });
    }

    // Stage 1: advisory-only envelopes are allowed, but execution is never allowed.
    if (this.state.stage === 1) {
      const unique = Array.from(new Set(input.allowedActions));
      const advisoryOnly = unique.length === 1 && unique[0] === 'ADVISE';
      if (!advisoryOnly) {
        throw new GovernanceError('STAGE_VIOLATION', 'Stage 1 allows ADVISE only', {
          stage: 1,
          allowedActions: unique,
        });
      }
    }

    if (this.state.killSwitch.engaged) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Kill-switch is engaged; cannot unpause', {
        engagedAt: this.state.killSwitch.engagedAt,
        engagedReason: this.state.killSwitch.engagedReason,
      });
    }

    const durationMs = Math.max(0, Math.floor(input.durationMs));
    if (durationMs < 1000) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'UNPAUSE durationMs must be at least 1000ms', { durationMs });
    }

    const allowedActions = Array.from(new Set(input.allowedActions));
    if (allowedActions.length === 0) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Envelope must allow at least one action', {});
    }

    const constraints: ExecutionEnvelopeConstraints = {
      ...input.constraints,
      chains: normalizeList(input.constraints?.chains),
      pairs: normalizeList(input.constraints?.pairs),
      venues: normalizeList(input.constraints?.venues),
    };

    // Deny-by-default: execution envelopes must include at least one concrete allow-list.
    const hasSomeAllowList = Boolean(constraints.chains?.length || constraints.pairs?.length || constraints.venues?.length);
    if (!hasSomeAllowList) {
      throw new GovernanceError(
        'CONSTRAINT_VIOLATION',
        'Envelope constraints must specify at least one allow-list (chains, pairs, or venues)',
        { constraints }
      );
    }

    const envelope: ExecutionEnvelope = {
      id: newId('env'),
      stage: input.stage,
      scope: input.scope,
      authority: input.authority,
      createdAt: at,
      expiresAt: at + durationMs,
      allowedActions,
      constraints,
    };

    this.state.paused = false;
    this.state.pauseReason = undefined;
    this.state.pausedAt = undefined;
    this.state.activeEnvelope = envelope;
    this.state.executionsInEnvelope = 0;

    logger.warn('[Governance] UNPAUSE granted with envelope', {
      component: 'CryptocrawlGovernance',
      envelopeId: envelope.id,
      stage: envelope.stage,
      scope: envelope.scope,
      authority: envelope.authority,
      expiresAt: new Date(envelope.expiresAt).toISOString(),
      allowedActions: envelope.allowedActions,
      constraints: envelope.constraints,
    });

    return envelope;
  }

  armKillSwitch(actor: GovernanceActor, reason = 'manual_arm'): void {
    if (this.state.killSwitch.engaged) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Kill-switch already engaged; cannot arm', {
        engagedAt: this.state.killSwitch.engagedAt,
        engagedReason: this.state.killSwitch.engagedReason,
      });
    }
    this.state.killSwitch.armed = true;
    logger.warn('[Governance] Kill-switch armed', { component: 'CryptocrawlGovernance', actor, reason });
  }

  engageKillSwitch(actor: GovernanceActor, reason = 'manual_engage'): void {
    this.state.killSwitch.engaged = true;
    this.state.killSwitch.engagedAt = nowMs();
    this.state.killSwitch.engagedReason = reason;
    this.pause(actor, `kill_switch_engaged:${reason}`);
    logger.error('[Governance] KILL-SWITCH ENGAGED', {
      component: 'CryptocrawlGovernance',
      actor,
      reason,
    });
  }

  /**
   * Stage 1: auto-pause after each advisory cycle.
   */
  completeAdvisoryCycle(actor: GovernanceActor, reason = 'advisory_cycle_complete'): void {
    if (this.state.stage !== 1) return;
    this.pause(actor, reason);
  }

  /**
   * Hard gate for any action that could mutate state or execute trades.
   * Deny-by-default: missing envelope, paused state, or kill-switch => block.
   */
  requireAllowed(
    action: GovernanceAction,
    context?: {
      chain?: string;
      pair?: string;
      venue?: string;
    }
  ): void {
    const at = nowMs();

    if (this.state.killSwitch.engaged) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Kill-switch is engaged', {
        engagedAt: this.state.killSwitch.engagedAt,
        engagedReason: this.state.killSwitch.engagedReason,
      });
    }

    // Stage 1: never allow execution-like actions.
    if (this.state.stage === 1) {
      if (action !== 'ADVISE') {
        throw new GovernanceError('STAGE_VIOLATION', 'Stage 1 prohibits execution and state mutation', {
          stage: 1,
          action,
        });
      }
      // Even advisory can be paused/unpaused via admin, but Stage 1 says pause semantics absolute.
      if (this.state.paused) {
        throw new GovernanceError('PAUSED', 'System is paused (Stage 1 advisory mode)', {
          stage: 1,
          pauseReason: this.state.pauseReason,
        });
      }
      if (!this.state.activeEnvelope) {
        throw new GovernanceError('NO_ACTIVE_ENVELOPE', 'No active advisory envelope (UNPAUSE required)', {
          stage: 1,
        });
      }

      const envelope = this.state.activeEnvelope;
      if (isExpired(envelope, at)) {
        this.completeAdvisoryCycle('system', 'advisory_envelope_expired');
        throw new GovernanceError('ENVELOPE_EXPIRED', 'Advisory envelope has expired', {
          envelopeId: envelope.id,
          expiresAt: envelope.expiresAt,
        });
      }

      if (!envelope.allowedActions.includes('ADVISE')) {
        throw new GovernanceError('ACTION_NOT_ALLOWED', 'Advisory action not allowed by envelope', {
          action,
          envelopeId: envelope.id,
          allowedActions: envelope.allowedActions,
        });
      }

      const { chains, pairs, venues, maxExecutions } = envelope.constraints;
      if (chains && context?.chain && !chains.includes(context.chain)) {
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Chain not allowed by advisory envelope', {
          chain: context.chain,
          allowedChains: chains,
          envelopeId: envelope.id,
        });
      }
      if (pairs && context?.pair && !pairs.includes(context.pair)) {
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Pair not allowed by advisory envelope', {
          pair: context.pair,
          allowedPairs: pairs,
          envelopeId: envelope.id,
        });
      }
      if (venues && context?.venue && !venues.includes(context.venue)) {
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Venue not allowed by advisory envelope', {
          venue: context.venue,
          allowedVenues: venues,
          envelopeId: envelope.id,
        });
      }

      if (typeof maxExecutions === 'number' && maxExecutions >= 0) {
        if (this.state.executionsInEnvelope >= maxExecutions) {
          this.completeAdvisoryCycle('system', 'advisory_max_cycles_reached');
          throw new GovernanceError('CONSTRAINT_VIOLATION', 'Advisory envelope maxExecutions reached; system paused', {
            envelopeId: envelope.id,
            maxExecutions,
          });
        }
      }

      return;
    }

    if (this.state.paused) {
      throw new GovernanceError('PAUSED', 'System is paused', {
        stage: this.state.stage,
        pauseReason: this.state.pauseReason,
      });
    }

    if (!this.state.activeEnvelope) {
      throw new GovernanceError('NO_ACTIVE_ENVELOPE', 'No active envelope (UNPAUSE required)', {
        stage: this.state.stage,
      });
    }

    const envelope = this.state.activeEnvelope;
    if (isExpired(envelope, at)) {
      this.pause('system', 'envelope_expired');
      throw new GovernanceError('ENVELOPE_EXPIRED', 'Active envelope has expired', {
        envelopeId: envelope.id,
        expiresAt: envelope.expiresAt,
      });
    }

    if (envelope.stage !== this.state.stage) {
      this.pause('system', 'envelope_stage_mismatch');
      throw new GovernanceError('STAGE_VIOLATION', 'Active envelope stage mismatch', {
        currentStage: this.state.stage,
        envelopeStage: envelope.stage,
      });
    }

    // Stage 2+: execution actions require kill-switch to be armed.
    if ((action === 'EXECUTE_OPPORTUNITY' || action === 'SUBMIT_TX') && !this.state.killSwitch.armed) {
      throw new GovernanceError('KILL_SWITCH_NOT_ARMED', 'Kill-switch must be armed before any live action', {
        stage: this.state.stage,
        action,
      });
    }

    if (!envelope.allowedActions.includes(action)) {
      throw new GovernanceError('ACTION_NOT_ALLOWED', 'Action not allowed by envelope', {
        action,
        envelopeId: envelope.id,
        allowedActions: envelope.allowedActions,
      });
    }

    const { chains, pairs, venues, maxExecutions } = envelope.constraints;
    if (chains && context?.chain && !chains.includes(context.chain)) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Chain not allowed by envelope', {
        chain: context.chain,
        allowedChains: chains,
        envelopeId: envelope.id,
      });
    }
    if (pairs && context?.pair && !pairs.includes(context.pair)) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Pair not allowed by envelope', {
        pair: context.pair,
        allowedPairs: pairs,
        envelopeId: envelope.id,
      });
    }
    if (venues && context?.venue && !venues.includes(context.venue)) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Venue not allowed by envelope', {
        venue: context.venue,
        allowedVenues: venues,
        envelopeId: envelope.id,
      });
    }

    if (typeof maxExecutions === 'number' && maxExecutions >= 0) {
      if (this.state.executionsInEnvelope >= maxExecutions) {
        this.pause('system', 'envelope_max_executions_reached');
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Envelope maxExecutions reached; system paused', {
          envelopeId: envelope.id,
          maxExecutions,
        });
      }
    }
  }

  /**
   * Call only after a successful attempt to execute a live action.
   */
  recordExecutionAttempt(): void {
    if (!this.state.activeEnvelope) return;
    this.state.executionsInEnvelope++;
  }

  /**
   * Memory policy:
   * - Stage 1–3: no long-term accumulation
   * - Stage 4–6: allowed, but still subject to envelope action gating
   */
  isLongTermMemoryAllowed(): boolean {
    return this.state.stage >= 4;
  }
}

/**
 * Execution-envelope facade. StageManager owns the mutable stage, pause,
 * anomaly, and kill-switch state; this class only scopes an authorized window.
 */
export class CryptocrawlGovernance {
  private activeEnvelope: ExecutionEnvelope | null = null;
  private executionsInEnvelope = 0;

  getState(): Readonly<GovernanceState> {
    const state = stageManager.getState();
    const config = stageManager.getStageConfig();
    return {
      stage: state.currentStage as CryptocrawlStage,
      paused: state.isPaused,
      pauseReason: state.pauseReason,
      pausedAt: state.lastPauseTimestamp,
      killSwitch: {
        armed: config.killSwitchArmed,
        engaged: state.killSwitchActive,
        engagedAt: state.killSwitchActive ? state.lastPauseTimestamp : undefined,
        engagedReason: state.killSwitchActive ? state.pauseReason : undefined,
      },
      activeEnvelope: this.activeEnvelope ? { ...this.activeEnvelope } : null,
      executionsInEnvelope: this.executionsInEnvelope,
    };
  }

  async setStage(stage: CryptocrawlStage, actor: GovernanceActor, reason = 'stage_change'): Promise<void> {
    const currentStage = stageManager.getCurrentStage() as CryptocrawlStage;
    if (stage === currentStage) {
      this.pause(actor, `stage=${stage}:${reason}`);
      return;
    }
    const result = await stageManager.requestStageAdvancement(actor, stage as ManagedStage);
    if (!result.success) {
      throw new GovernanceError('STAGE_VIOLATION', result.message, { currentStage, requestedStage: stage });
    }
    this.clearEnvelope();
  }

  pause(actor: GovernanceActor, reason = 'manual_pause'): void {
    this.clearEnvelope();
    stageManager.pause(reason);
    logger.info('[Governance] Paused through canonical StageManager', { component: 'CryptocrawlGovernance', actor, reason });
  }

  async unpauseWithEnvelope(input: {
    stage: CryptocrawlStage;
    scope: string;
    authority: GovernanceActor;
    durationMs: number;
    allowedActions: GovernanceAction[];
    constraints?: ExecutionEnvelopeConstraints;
  }): Promise<ExecutionEnvelope> {
    const state = this.getState();
    const at = nowMs();
    if (input.stage !== state.stage) {
      throw new GovernanceError('STAGE_VIOLATION', 'Envelope stage must match canonical StageManager stage', {
        currentStage: state.stage,
        envelopeStage: input.stage,
      });
    }
    if (state.killSwitch.engaged) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Kill-switch is engaged; cannot unpause', {
        engagedAt: state.killSwitch.engagedAt,
        engagedReason: state.killSwitch.engagedReason,
      });
    }

    const durationMs = Math.max(0, Math.floor(input.durationMs));
    if (durationMs < 1_000) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'UNPAUSE durationMs must be at least 1000ms', { durationMs });
    }
    const allowedActions = Array.from(new Set(input.allowedActions));
    if (allowedActions.length === 0) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Envelope must allow at least one action');
    }
    if (state.stage === 1 && !(allowedActions.length === 1 && allowedActions[0] === 'ADVISE')) {
      throw new GovernanceError('STAGE_VIOLATION', 'Stage 1 allows ADVISE only', { allowedActions });
    }

    const constraints: ExecutionEnvelopeConstraints = {
      ...input.constraints,
      chains: normalizeList(input.constraints?.chains),
      pairs: normalizeList(input.constraints?.pairs),
      venues: normalizeList(input.constraints?.venues),
    };
    if (!constraints.chains?.length && !constraints.pairs?.length && !constraints.venues?.length) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Envelope constraints must specify at least one allow-list', { constraints });
    }

    const unpause = await stageManager.requestUnpause(input.authority, input.scope, durationMs);
    if (!unpause.success) {
      throw new GovernanceError('PAUSED', unpause.message, { stage: state.stage });
    }

    const envelope: ExecutionEnvelope = {
      id: newId('env'),
      stage: state.stage,
      scope: input.scope,
      authority: input.authority,
      createdAt: at,
      expiresAt: at + durationMs,
      allowedActions,
      constraints,
    };
    this.activeEnvelope = envelope;
    this.executionsInEnvelope = 0;
    return envelope;
  }

  armKillSwitch(actor: GovernanceActor, reason = 'manual_arm'): void {
    const state = this.getState();
    if (state.killSwitch.engaged) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Kill-switch already engaged', { engagedAt: state.killSwitch.engagedAt });
    }
    if (!state.killSwitch.armed) {
      throw new GovernanceError('KILL_SWITCH_NOT_ARMED', 'Canonical StageManager has not armed the kill-switch');
    }
    logger.warn('[Governance] Canonical kill-switch is armed', { component: 'CryptocrawlGovernance', actor, reason });
  }

  engageKillSwitch(actor: GovernanceActor, reason = 'manual_engage'): void {
    this.clearEnvelope();
    stageManager.engageKillSwitch(reason);
    logger.error('[Governance] KILL-SWITCH engaged through canonical StageManager', { component: 'CryptocrawlGovernance', actor, reason });
  }

  completeAdvisoryCycle(actor: GovernanceActor, reason = 'advisory_cycle_complete'): void {
    if (this.getState().stage === 1) this.pause(actor, reason);
  }

  requireAllowed(action: GovernanceAction, context?: { chain?: string; pair?: string; venue?: string }): void {
    const at = nowMs();
    const state = this.getState();
    if (state.killSwitch.engaged) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Kill-switch is engaged', {
        engagedAt: state.killSwitch.engagedAt,
        engagedReason: state.killSwitch.engagedReason,
      });
    }
    if (state.stage === 1 && action !== 'ADVISE') {
      throw new GovernanceError('STAGE_VIOLATION', 'Stage 1 prohibits execution and state mutation', { stage: 1, action });
    }
    if (state.paused) {
      throw new GovernanceError('PAUSED', 'System is paused', { stage: state.stage, pauseReason: state.pauseReason });
    }
    const envelope = this.activeEnvelope;
    if (!envelope) throw new GovernanceError('NO_ACTIVE_ENVELOPE', 'No active envelope (UNPAUSE required)', { stage: state.stage });
    if (isExpired(envelope, at)) {
      this.pause('system', 'envelope_expired');
      throw new GovernanceError('ENVELOPE_EXPIRED', 'Active envelope has expired', { envelopeId: envelope.id, expiresAt: envelope.expiresAt });
    }
    if (envelope.stage !== state.stage) {
      this.pause('system', 'envelope_stage_mismatch');
      throw new GovernanceError('STAGE_VIOLATION', 'Active envelope stage mismatch', { currentStage: state.stage, envelopeStage: envelope.stage });
    }
    if ((action === 'EXECUTE_OPPORTUNITY' || action === 'SUBMIT_TX') && !state.killSwitch.armed) {
      throw new GovernanceError('KILL_SWITCH_NOT_ARMED', 'Kill-switch must be armed before any live action', { stage: state.stage, action });
    }
    if (!envelope.allowedActions.includes(action)) {
      throw new GovernanceError('ACTION_NOT_ALLOWED', 'Action not allowed by envelope', { action, envelopeId: envelope.id, allowedActions: envelope.allowedActions });
    }

    const { chains, pairs, venues, maxExecutions } = envelope.constraints;
    if (chains && context?.chain && !chains.includes(context.chain)) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Chain not allowed by envelope', { chain: context.chain, allowedChains: chains, envelopeId: envelope.id });
    }
    if (pairs && context?.pair && !pairs.includes(context.pair)) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Pair not allowed by envelope', { pair: context.pair, allowedPairs: pairs, envelopeId: envelope.id });
    }
    if (venues && context?.venue && !venues.includes(context.venue)) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Venue not allowed by envelope', { venue: context.venue, allowedVenues: venues, envelopeId: envelope.id });
    }
    if (typeof maxExecutions === 'number' && maxExecutions >= 0 && this.executionsInEnvelope >= maxExecutions) {
      this.pause('system', 'envelope_max_executions_reached');
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Envelope maxExecutions reached; system paused', { envelopeId: envelope.id, maxExecutions });
    }
  }

  recordExecutionAttempt(): void {
    if (this.activeEnvelope) this.executionsInEnvelope++;
  }

  isLongTermMemoryAllowed(): boolean {
    return this.getState().stage >= 4;
  }

  private clearEnvelope(): void {
    this.activeEnvelope = null;
    this.executionsInEnvelope = 0;
  }
}

let singleton: CryptocrawlGovernance | null = null;

export function getCryptocrawlGovernance(): CryptocrawlGovernance {
  if (!singleton) singleton = new CryptocrawlGovernance();
  return singleton;
}

