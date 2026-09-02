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
import { getVenueCapabilities } from '../discovery/venue-capability-registry.js';

function nowMs(): number {
  return Date.now();
}

function newId(prefix: string): string {
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

/**
 * Canonical execution-envelope facade. StageManager owns the mutable stage,
 * pause, anomaly, and kill-switch state. Stage progression controls bounded
 * scale/scope; it does not independently veto a fully evidenced positive trade.
 */
export class CryptocrawlGovernance {
  private activeEnvelope: ExecutionEnvelope | null = null;
  private executionsInEnvelope = 0;

  constructor() {
    stageManager.on('stage-advanced', () => this.clearEnvelope());
  }

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
    stageManager.pause(reason, { manualOverride: actor === 'human' });
    logger.info('[Governance] Paused through canonical StageManager', { component: 'CryptocrawlGovernance', actor, reason });
  }

  isAutomaticallyActivated(): boolean {
    return stageManager.isAutomaticallyActivated();
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
    if (this.getState().stage === 1 && !stageManager.isAutomaticallyActivated()) this.pause(actor, reason);
  }

  requireBootstrapSettlementAllowed(context: { chain: string; pair: string; venue: string }): void {
    const state = stageManager.getState();
    const config = stageManager.getStageConfig();
    if (state.currentStage !== 1) {
      throw new GovernanceError('STAGE_VIOLATION', 'Bootstrap settlement is restricted to pre-Stage-1 operation', { stage: state.currentStage });
    }
    if (state.isPaused) {
      throw new GovernanceError('PAUSED', 'Bootstrap settlement is paused', { reason: state.pauseReason });
    }
    if (state.killSwitchActive) {
      throw new GovernanceError('KILL_SWITCH_ENGAGED', 'Bootstrap settlement is blocked by the kill-switch');
    }
    if (!config.killSwitchArmed) {
      throw new GovernanceError('KILL_SWITCH_NOT_ARMED', 'Bootstrap settlement requires the canonical kill-switch to be armed');
    }
    if (state.initialGasReady) {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Bootstrap settlement is disabled after initial gas readiness', { stage: state.currentStage });
    }
    if (context.pair !== 'NATIVE_GAS_SETTLEMENT' || context.venue !== 'bridge_refuel' || !context.chain || context.chain === 'europa') {
      throw new GovernanceError('CONSTRAINT_VIOLATION', 'Bootstrap settlement context is outside the dedicated source-funded bridge/refuel boundary', { context });
    }
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
    if (state.paused) {
      throw new GovernanceError('PAUSED', 'System is paused', { stage: state.stage, pauseReason: state.pauseReason });
    }
    const envelope = this.activeEnvelope;
    if (!envelope) {
      if (stageManager.isAutomaticallyActivated()) {
        this.requireAutomaticActivationAllowed(action, context);
        return;
      }
      throw new GovernanceError('NO_ACTIVE_ENVELOPE', 'No active envelope (UNPAUSE required)', { stage: state.stage });
    }
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

  private requireAutomaticActivationAllowed(
    action: GovernanceAction,
    context?: { chain?: string; pair?: string; venue?: string },
  ): void {
    const state = stageManager.getState();
    const config = stageManager.getStageConfig();
    if ((action === 'EXECUTE_OPPORTUNITY' || action === 'SUBMIT_TX') && !stageManager.canExecuteTrades()) {
      throw new GovernanceError('STAGE_VIOLATION', 'Canonical stage execution authority is disabled', { stage: state.currentStage, action });
    }
    if ((action === 'EXECUTE_OPPORTUNITY' || action === 'SUBMIT_TX') && !config.killSwitchArmed) {
      throw new GovernanceError('KILL_SWITCH_NOT_ARMED', 'Kill-switch must be armed before any live action', { stage: state.currentStage, action });
    }
    if (action === 'PERSIST_LONG_TERM_MEMORY' && state.currentStage < 4) {
      throw new GovernanceError('STAGE_VIOLATION', 'Long-term memory remains unavailable before Stage 4', { stage: state.currentStage });
    }
    if (action === 'EVOLVE_STRATEGY' && !config.canSelfExpand) {
      throw new GovernanceError('ACTION_NOT_ALLOWED', 'Evolution lock remains active for this stage', { stage: state.currentStage });
    }
    if (action === 'EXECUTE_OPPORTUNITY' || action === 'SUBMIT_TX') {
      if (context?.venue) {
        const capability = getVenueCapabilities().find(candidate => candidate.venue === context.venue);
        if (!capability || !capability.enabled || !capability.liveExecution || !capability.settlementVerification) {
          throw new GovernanceError('CONSTRAINT_VIOLATION', 'Venue is outside settlement-safe automatic execution scope', {
            venue: context.venue,
            stage: state.currentStage,
          });
        }
        return;
      }
      if (!context?.chain) {
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Automatic execution requires an explicit supported chain or settlement-safe CEX venue context', {
          stage: state.currentStage,
          action,
        });
      }
      if (!config.allowedChains.includes(context.chain)) {
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Chain is outside automatic stage scope', {
          chain: context.chain,
          allowedChains: config.allowedChains,
          stage: state.currentStage,
        });
      }
    }
  }
}

let singleton: CryptocrawlGovernance | null = null;

export function getCryptocrawlGovernance(): CryptocrawlGovernance {
  if (!singleton) singleton = new CryptocrawlGovernance();
  return singleton;
}
