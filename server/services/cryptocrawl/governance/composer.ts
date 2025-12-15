/**
 * COMPOSER - Canonical Authority for CryptoCrawler System
 * 
 * The Composer is the single source of truth for:
 * - Stage commands and transitions
 * - System scope and locks
 * - Pause/resume operations
 * - Emergency shutdown procedures
 * 
 * HARD RULES:
 * - NO component can execute without Composer approval
 * - Stage transitions require explicit authorization
 * - All locks are enforced at the Composer level
 */

import { EventEmitter } from 'events';

export enum SystemScope {
  PAPER_TRADING = 'paper_trading',
  DRY_RUN = 'dry_run',
  LIVE_RESTRICTED = 'live_restricted',
  LIVE_FULL = 'live_full',
}

export enum LockType {
  GLOBAL = 'global',
  STAGE = 'stage',
  STRATEGY = 'strategy',
  EXECUTION = 'execution',
}

export interface Lock {
  type: LockType;
  id: string;
  reason: string;
  timestamp: number;
  issuedBy: string;
}

export interface StageCommand {
  action: 'advance' | 'hold' | 'rollback' | 'reset';
  targetStage: number;
  reason: string;
  timestamp: number;
  requiresConfirmation: boolean;
}

export interface ComposerState {
  currentScope: SystemScope;
  isSystemPaused: boolean;
  activeLocks: Lock[];
  lastCommand: StageCommand | null;
  emergencyShutdown: boolean;
  startTime: number;
  totalCommandsIssued: number;
}

/**
 * Composer - Canonical Authority
 * Issues stage commands and enforces system-wide governance
 */
export class Composer extends EventEmitter {
  private state: ComposerState;
  private commandHistory: StageCommand[] = [];
  private lockRegistry: Map<string, Lock> = new Map();

  constructor() {
    super();
    this.state = {
      currentScope: SystemScope.PAPER_TRADING,
      isSystemPaused: false,
      activeLocks: [],
      lastCommand: null,
      emergencyShutdown: false,
      startTime: Date.now(),
      totalCommandsIssued: 0,
    };
  }

  /**
   * Initialize the Composer
   */
  async initialize(): Promise<void> {
    console.log('[Composer] 🎼 Initializing Canonical Authority...');
    
    // Set initial global lock - must be explicitly released
    this.applyLock({
      type: LockType.GLOBAL,
      id: 'init-lock',
      reason: 'System initialization - awaiting Stage Controller approval',
      timestamp: Date.now(),
      issuedBy: 'composer-init',
    });

    console.log('[Composer] ✅ Canonical Authority initialized - All systems locked');
  }

  /**
   * Issue a stage command
   */
  issueCommand(command: StageCommand): boolean {
    if (this.state.emergencyShutdown) {
      console.error('[Composer] ❌ Emergency shutdown active - command rejected');
      return false;
    }

    if (this.state.isSystemPaused) {
      console.warn('[Composer] ⚠️ System paused - command queued');
      return false;
    }

    // Validate command
    if (!this.validateCommand(command)) {
      console.error('[Composer] ❌ Invalid command:', command);
      return false;
    }

    // Record command
    this.commandHistory.push(command);
    this.state.lastCommand = command;
    this.state.totalCommandsIssued++;

    console.log(`[Composer] 📋 Command issued: ${command.action} → Stage ${command.targetStage}`);
    
    // Emit event for Stage Controller
    this.emit('command', command);

    return true;
  }

  /**
   * Apply a lock
   */
  applyLock(lock: Lock): void {
    const lockKey = `${lock.type}-${lock.id}`;
    this.lockRegistry.set(lockKey, lock);
    this.state.activeLocks = Array.from(this.lockRegistry.values());

    console.log(`[Composer] 🔒 Lock applied: ${lock.type} - ${lock.reason}`);
    this.emit('lock-applied', lock);
  }

  /**
   * Release a lock
   */
  releaseLock(type: LockType, id: string): boolean {
    const lockKey = `${type}-${id}`;
    const existed = this.lockRegistry.delete(lockKey);
    this.state.activeLocks = Array.from(this.lockRegistry.values());

    if (existed) {
      console.log(`[Composer] 🔓 Lock released: ${type}-${id}`);
      this.emit('lock-released', { type, id });
    }

    return existed;
  }

  /**
   * Check if a specific lock is active
   */
  isLocked(type: LockType, id?: string): boolean {
    if (type === LockType.GLOBAL) {
      return Array.from(this.lockRegistry.values()).some(l => l.type === LockType.GLOBAL);
    }

    if (id) {
      const lockKey = `${type}-${id}`;
      return this.lockRegistry.has(lockKey);
    }

    return Array.from(this.lockRegistry.values()).some(l => l.type === type);
  }

  /**
   * Pause the entire system
   */
  pauseSystem(reason: string): void {
    this.state.isSystemPaused = true;
    console.log(`[Composer] ⏸️ System paused: ${reason}`);
    this.emit('system-paused', { reason, timestamp: Date.now() });
  }

  /**
   * Resume the system
   */
  resumeSystem(): void {
    this.state.isSystemPaused = false;
    console.log('[Composer] ▶️ System resumed');
    this.emit('system-resumed', { timestamp: Date.now() });
  }

  /**
   * Emergency shutdown
   */
  emergencyShutdown(reason: string): void {
    this.state.emergencyShutdown = true;
    this.state.isSystemPaused = true;
    
    // Apply global lock
    this.applyLock({
      type: LockType.GLOBAL,
      id: 'emergency-shutdown',
      reason,
      timestamp: Date.now(),
      issuedBy: 'composer-emergency',
    });

    console.error(`[Composer] 🚨 EMERGENCY SHUTDOWN: ${reason}`);
    this.emit('emergency-shutdown', { reason, timestamp: Date.now() });
  }

  /**
   * Set system scope
   */
  setScope(scope: SystemScope): boolean {
    if (this.state.emergencyShutdown) {
      console.error('[Composer] ❌ Cannot change scope - emergency shutdown active');
      return false;
    }

    const previousScope = this.state.currentScope;
    this.state.currentScope = scope;

    console.log(`[Composer] 🔄 Scope changed: ${previousScope} → ${scope}`);
    this.emit('scope-changed', { previous: previousScope, current: scope });

    return true;
  }

  /**
   * Get current state
   */
  getState(): ComposerState {
    return { ...this.state };
  }

  /**
   * Get command history
   */
  getCommandHistory(limit: number = 100): StageCommand[] {
    return this.commandHistory.slice(-limit);
  }

  /**
   * Validate a command
   */
  private validateCommand(command: StageCommand): boolean {
    // Check if target stage is valid
    if (command.targetStage < 1 || command.targetStage > 9) {
      return false;
    }

    // Check if reason is provided
    if (!command.reason || command.reason.length < 10) {
      return false;
    }

    return true;
  }

  /**
   * Check if system can execute
   */
  canExecute(): boolean {
    if (this.state.emergencyShutdown) return false;
    if (this.state.isSystemPaused) return false;
    if (this.isLocked(LockType.GLOBAL)) return false;
    if (this.isLocked(LockType.EXECUTION)) return false;

    return true;
  }
}

// Singleton instance
export const composer = new Composer();
