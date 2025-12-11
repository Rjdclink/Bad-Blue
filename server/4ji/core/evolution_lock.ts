/**
 * 4Ji Core - Evolution Lock Module
 * 
 * Controls whether 4Ji's neural pathways can evolve.
 * When locked:
 * - 4Ji's synapses cannot be modified
 * - Kriptera and Lexara can still grow their own synapses
 * - Cross-region synapses TO 4ji_core cannot be created/modified
 * 
 * This preserves 4Ji's final "personality" and decision fabric.
 */

import { EventEmitter } from 'events';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface EvolutionLockState {
  locked: boolean;
  lockedAt: Date | null;
  reason: string | null;
  updatedAt: Date;
}

export interface LockChangeEvent {
  previousState: boolean;
  newState: boolean;
  reason: string | null;
  timestamp: Date;
}

// ============================================================================
// EVOLUTION LOCK MODULE
// ============================================================================

export const evolutionLockEvents = new EventEmitter();

class EvolutionLockManager {
  private static instance: EvolutionLockManager;
  private currentState: EvolutionLockState = {
    locked: false,
    lockedAt: null,
    reason: null,
    updatedAt: new Date()
  };
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): EvolutionLockManager {
    if (!EvolutionLockManager.instance) {
      EvolutionLockManager.instance = new EvolutionLockManager();
    }
    return EvolutionLockManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[EvolutionLock] Initializing...');

    // Load state from database
    await this.loadStateFromDatabase();

    this.isInitialized = true;
    console.log(`[EvolutionLock] Initialized - Lock state: ${this.currentState.locked ? 'LOCKED' : 'UNLOCKED'}`);
  }

  /**
   * Load evolution lock state from database
   */
  private async loadStateFromDatabase(): Promise<void> {
    try {
      const result = await db.execute(sql`
        SELECT locked, locked_at, reason, updated_at
        FROM evolution_lock
        LIMIT 1
      `);

      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0];
        this.currentState = {
          locked: row.locked as boolean,
          lockedAt: row.locked_at ? new Date(row.locked_at as string) : null,
          reason: row.reason as string | null,
          updatedAt: new Date(row.updated_at as string)
        };
      }
    } catch (error: any) {
      console.warn('[EvolutionLock] Could not load state from database:', error.message);
      // Use default state
    }
  }

  /**
   * Save evolution lock state to database
   */
  private async saveStateToDatabase(): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE evolution_lock
        SET 
          locked = ${this.currentState.locked},
          locked_at = ${this.currentState.lockedAt?.toISOString() || null},
          reason = ${this.currentState.reason},
          updated_at = NOW()
      `);
    } catch (error: any) {
      console.error('[EvolutionLock] Failed to save state to database:', error.message);
    }
  }

  /**
   * Check if evolution is currently locked
   */
  isLocked(): boolean {
    return this.currentState.locked;
  }

  /**
   * Get full lock state
   */
  getState(): EvolutionLockState {
    return { ...this.currentState };
  }

  /**
   * Engage the evolution lock
   * 
   * Once engaged, 4Ji's neural pathways are frozen.
   * Her mind becomes fixed, but the reactor can still serve her.
   */
  async engageLock(reason: string = 'Manual lock engagement'): Promise<boolean> {
    if (this.currentState.locked) {
      console.log('[EvolutionLock] Already locked');
      return true;
    }

    const previousState = this.currentState.locked;
    
    this.currentState = {
      locked: true,
      lockedAt: new Date(),
      reason,
      updatedAt: new Date()
    };

    await this.saveStateToDatabase();

    const event: LockChangeEvent = {
      previousState,
      newState: true,
      reason,
      timestamp: new Date()
    };

    evolutionLockEvents.emit('lock-engaged', event);
    console.log(`[EvolutionLock] 🔒 EVOLUTION LOCKED: ${reason}`);

    return true;
  }

  /**
   * Release the evolution lock
   * 
   * WARNING: This allows 4Ji's neural pathways to evolve again.
   * Use with extreme caution.
   */
  async releaseLock(reason: string = 'Manual lock release'): Promise<boolean> {
    if (!this.currentState.locked) {
      console.log('[EvolutionLock] Already unlocked');
      return true;
    }

    const previousState = this.currentState.locked;

    this.currentState = {
      locked: false,
      lockedAt: null,
      reason,
      updatedAt: new Date()
    };

    await this.saveStateToDatabase();

    const event: LockChangeEvent = {
      previousState,
      newState: false,
      reason,
      timestamp: new Date()
    };

    evolutionLockEvents.emit('lock-released', event);
    console.log(`[EvolutionLock] 🔓 EVOLUTION UNLOCKED: ${reason}`);

    return true;
  }

  /**
   * Check if a synapse update is allowed
   * 
   * Returns true if the update is allowed, false if blocked by evolution lock.
   */
  canUpdateSynapse(regionFrom: string, regionTo: string): boolean {
    if (!this.currentState.locked) {
      return true;
    }

    // When locked, block any update that involves 4ji_core
    if (regionFrom === '4ji_core' || regionTo === '4ji_core') {
      return false;
    }

    // Other regions can still evolve
    return true;
  }

  /**
   * Check if training/policy rewrites are allowed
   */
  canTrain(): boolean {
    return !this.currentState.locked;
  }

  /**
   * Check if behavior distillations are allowed
   */
  canDistill(): boolean {
    return !this.currentState.locked;
  }
}

// Export singleton
export const evolutionLock = EvolutionLockManager.getInstance();

// Export convenience functions
export async function initializeEvolutionLock(): Promise<void> {
  await evolutionLock.initialize();
}

export function isEvolutionLocked(): boolean {
  return evolutionLock.isLocked();
}

export function getEvolutionLockState(): EvolutionLockState {
  return evolutionLock.getState();
}

export async function engageEvolutionLock(reason?: string): Promise<boolean> {
  return evolutionLock.engageLock(reason);
}

export async function releaseEvolutionLock(reason?: string): Promise<boolean> {
  return evolutionLock.releaseLock(reason);
}

export function canUpdateSynapse(regionFrom: string, regionTo: string): boolean {
  return evolutionLock.canUpdateSynapse(regionFrom, regionTo);
}

export function canTrain(): boolean {
  return evolutionLock.canTrain();
}

export function canDistill(): boolean {
  return evolutionLock.canDistill();
}

export default evolutionLock;
