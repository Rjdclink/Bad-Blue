/**
 * 4Ji User Priority System
 * 
 * Implements the ownership and loyalty logic where 4Ji is hard-coded for the primary user.
 * This is not "slavery" - it's system configuration:
 * 
 * - Primary user identity has maximum memory depth, adaptation intensity, and persona flexibility
 * - Other users have constrained memory scope, lower adaptation, and no access to full Mode A spectrum
 * - 4Ji's long-term memory is primarily for the primary user
 * - Deepest adaptation (B/C growth intensity) happens for primary user interactions
 * - Others only trigger shallow, non-permanent adjustments
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  PrimaryUserIdentity,
  SecondaryUserConfig,
  UserPriorityState,
} from './types';

const log = createLogger('4Ji-UserPriority');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Memory depth levels */
const MEMORY_DEPTH = {
  PRIMARY: 10 as const,    // Maximum depth for primary user
  SECONDARY_MAX: 5 as const,  // Maximum for secondary users
  DEFAULT: 3 as const,     // Default for unregistered users (valid for secondary: 1|2|3|4|5)
};

/** Adaptation intensity levels */
const ADAPTATION_INTENSITY = {
  PRIMARY: 10 as const,     // Maximum adaptation for primary user
  SECONDARY_MAX: 3 as const, // Maximum for secondary users
  DEFAULT: 1 as const,      // Default for unregistered users (valid for secondary: 1|2|3)
};

/** Memory retention periods (in days) */
const MEMORY_RETENTION = {
  PRIMARY: 365 * 10,  // 10 years for primary user
  SECONDARY: 30,      // 30 days for secondary users
  UNREGISTERED: 1,    // 1 day for unregistered users
};

// ============================================================================
// USER PRIORITY SYSTEM
// ============================================================================

export class UserPrioritySystem extends EventEmitter {
  private state: UserPriorityState;
  private initialized = false;
  private interactionCounts: Map<string, number> = new Map();
  private lastInteraction: Map<string, number> = new Map();
  private userMemory: Map<string, unknown[]> = new Map();

  constructor() {
    super();
    this.state = {
      primaryUser: null,
      isPrimaryUserSet: false,
      secondaryUsers: new Map(),
    };
    this.initialized = true;
    log.info('User Priority System initialized');
  }

  /**
   * Set the primary user (the anchor)
   * This is a one-time configuration that establishes the primary relationship.
   */
  setPrimaryUser(userId: string): void {
    if (this.state.isPrimaryUserSet) {
      log.warn('Primary user already set. Cannot change primary user.', {
        existingPrimary: this.state.primaryUser?.id,
        attemptedNew: userId,
      });
      throw new Error('Primary user is already configured. This is a permanent setting.');
    }

    this.state.primaryUser = {
      id: userId,
      verifiedAt: Date.now(),
      memoryDepth: 10,
      adaptationIntensity: 10,
      fullPersonaFlexibility: true,
    };
    this.state.isPrimaryUserSet = true;

    // Initialize primary user memory
    this.userMemory.set(userId, []);
    this.interactionCounts.set(userId, 0);
    this.lastInteraction.set(userId, Date.now());

    log.info('Primary user configured', { userId });
    this.emit('primary-user-configured', { userId });
  }

  /**
   * Check if a user is the primary user
   */
  isPrimaryUser(userId: string): boolean {
    return this.state.primaryUser !== null && this.state.primaryUser.id === userId;
  }

  /**
   * Get the primary user ID
   */
  getPrimaryUserId(): string | null {
    return this.state.primaryUser?.id || null;
  }

  /**
   * Register a secondary user with constrained access
   */
  registerSecondaryUser(userId: string): SecondaryUserConfig {
    if (this.isPrimaryUser(userId)) {
      throw new Error('Cannot register primary user as secondary');
    }

    const existing = this.state.secondaryUsers.get(userId);
    if (existing) {
      return existing;
    }

    const config: SecondaryUserConfig = {
      id: userId,
      memoryDepth: MEMORY_DEPTH.DEFAULT,
      adaptationIntensity: ADAPTATION_INTENSITY.DEFAULT,
      modeAAccess: false,
    };

    this.state.secondaryUsers.set(userId, config);
    this.userMemory.set(userId, []);
    this.interactionCounts.set(userId, 0);
    this.lastInteraction.set(userId, Date.now());

    log.info('Secondary user registered', { userId });
    this.emit('secondary-user-registered', { userId, config });

    return config;
  }

  /**
   * Get configuration for a user
   */
  getUserConfig(userId: string): {
    isPrimary: boolean;
    memoryDepth: number;
    adaptationIntensity: number;
    fullPersonaFlexibility: boolean;
    modeAAccess: boolean;
  } {
    // Check if primary user
    if (this.isPrimaryUser(userId) && this.state.primaryUser) {
      return {
        isPrimary: true,
        memoryDepth: this.state.primaryUser.memoryDepth,
        adaptationIntensity: this.state.primaryUser.adaptationIntensity,
        fullPersonaFlexibility: this.state.primaryUser.fullPersonaFlexibility,
        modeAAccess: true,
      };
    }

    // Check if registered secondary user
    const secondary = this.state.secondaryUsers.get(userId);
    if (secondary) {
      return {
        isPrimary: false,
        memoryDepth: secondary.memoryDepth,
        adaptationIntensity: secondary.adaptationIntensity,
        fullPersonaFlexibility: false,
        modeAAccess: secondary.modeAAccess,
      };
    }

    // Unregistered user - minimal access
    return {
      isPrimary: false,
      memoryDepth: MEMORY_DEPTH.DEFAULT,
      adaptationIntensity: ADAPTATION_INTENSITY.DEFAULT,
      fullPersonaFlexibility: false,
      modeAAccess: false,
    };
  }

  /**
   * Record an interaction with a user
   */
  recordInteraction(
    userId: string,
    interactionData: {
      type: string;
      content?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    // Update interaction count
    const currentCount = this.interactionCounts.get(userId) || 0;
    this.interactionCounts.set(userId, currentCount + 1);
    this.lastInteraction.set(userId, Date.now());

    // Get user config to determine memory handling
    const config = this.getUserConfig(userId);

    // Store memory based on user's memory depth
    const memory = this.userMemory.get(userId) || [];
    
    // Add new memory entry
    memory.push({
      timestamp: Date.now(),
      ...interactionData,
    });

    // Trim memory based on depth (deeper = more memories retained)
    const maxMemories = config.memoryDepth * 100; // 100 memories per depth level
    if (memory.length > maxMemories) {
      memory.splice(0, memory.length - maxMemories);
    }

    this.userMemory.set(userId, memory);

    // Only adapt for users with sufficient adaptation intensity
    if (config.adaptationIntensity >= 5) {
      this.emit('deep-adaptation-triggered', { userId, interactionData });
    } else if (config.adaptationIntensity >= 2) {
      this.emit('shallow-adaptation-triggered', { userId, interactionData });
    }
    // No adaptation for intensity < 2
  }

  /**
   * Get user memory
   */
  getUserMemory(
    userId: string,
    limit?: number
  ): unknown[] {
    const memory = this.userMemory.get(userId) || [];
    const config = this.getUserConfig(userId);

    // Limit memory access based on user's memory depth
    const maxAccess = Math.min(limit || Infinity, config.memoryDepth * 50);
    
    return memory.slice(-maxAccess);
  }

  /**
   * Get interaction statistics for a user
   */
  getUserStats(userId: string): {
    totalInteractions: number;
    lastInteraction: number | null;
    memoryCount: number;
    daysSinceLastInteraction: number;
  } {
    const interactions = this.interactionCounts.get(userId) || 0;
    const lastInteract = this.lastInteraction.get(userId) || null;
    const memory = this.userMemory.get(userId) || [];

    const daysSinceLastInteraction = lastInteract
      ? Math.floor((Date.now() - lastInteract) / (1000 * 60 * 60 * 24))
      : -1;

    return {
      totalInteractions: interactions,
      lastInteraction: lastInteract,
      memoryCount: memory.length,
      daysSinceLastInteraction,
    };
  }

  /**
   * Perform memory cleanup for non-primary users
   * Primary user memory is never cleaned automatically
   */
  performMemoryCleanup(): {
    usersProcessed: number;
    memoriesRemoved: number;
  } {
    let usersProcessed = 0;
    let memoriesRemoved = 0;

    const now = Date.now();

    for (const [userId, memory] of this.userMemory) {
      // Never clean primary user memory
      if (this.isPrimaryUser(userId)) {
        continue;
      }

      const config = this.getUserConfig(userId);
      const retentionDays = this.state.secondaryUsers.has(userId)
        ? MEMORY_RETENTION.SECONDARY
        : MEMORY_RETENTION.UNREGISTERED;

      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      const cutoff = now - retentionMs;

      // Filter out old memories
      const filtered = memory.filter((m: any) => {
        const timestamp = m.timestamp || 0;
        return timestamp >= cutoff;
      });

      const removed = memory.length - filtered.length;
      if (removed > 0) {
        this.userMemory.set(userId, filtered);
        memoriesRemoved += removed;
        usersProcessed++;
      }
    }

    log.info('Memory cleanup completed', { usersProcessed, memoriesRemoved });
    return { usersProcessed, memoriesRemoved };
  }

  /**
   * Upgrade secondary user's memory depth (within limits)
   */
  upgradeSecondaryUser(
    userId: string,
    upgrades: {
      memoryDepth?: 1 | 2 | 3 | 4 | 5;
      adaptationIntensity?: 1 | 2 | 3;
    }
  ): boolean {
    if (this.isPrimaryUser(userId)) {
      log.warn('Cannot modify primary user configuration this way');
      return false;
    }

    const config = this.state.secondaryUsers.get(userId);
    if (!config) {
      log.warn('User not found', { userId });
      return false;
    }

    // Validate upgrades are within secondary user limits
    if (upgrades.memoryDepth !== undefined) {
      if (upgrades.memoryDepth > MEMORY_DEPTH.SECONDARY_MAX) {
        log.warn('Memory depth exceeds secondary user limit', {
          requested: upgrades.memoryDepth,
          max: MEMORY_DEPTH.SECONDARY_MAX,
        });
        return false;
      }
      config.memoryDepth = upgrades.memoryDepth;
    }

    if (upgrades.adaptationIntensity !== undefined) {
      if (upgrades.adaptationIntensity > ADAPTATION_INTENSITY.SECONDARY_MAX) {
        log.warn('Adaptation intensity exceeds secondary user limit', {
          requested: upgrades.adaptationIntensity,
          max: ADAPTATION_INTENSITY.SECONDARY_MAX,
        });
        return false;
      }
      config.adaptationIntensity = upgrades.adaptationIntensity;
    }

    this.state.secondaryUsers.set(userId, config);
    log.info('Secondary user upgraded', { userId, upgrades });
    this.emit('secondary-user-upgraded', { userId, config });

    return true;
  }

  /**
   * Get all registered users
   */
  getAllUsers(): Array<{
    userId: string;
    type: 'primary' | 'secondary' | 'unregistered';
    memoryDepth: number;
    adaptationIntensity: number;
  }> {
    const users: Array<{
      userId: string;
      type: 'primary' | 'secondary' | 'unregistered';
      memoryDepth: number;
      adaptationIntensity: number;
    }> = [];

    // Add primary user if set
    if (this.state.primaryUser) {
      users.push({
        userId: this.state.primaryUser.id,
        type: 'primary',
        memoryDepth: this.state.primaryUser.memoryDepth,
        adaptationIntensity: this.state.primaryUser.adaptationIntensity,
      });
    }

    // Add secondary users
    for (const [userId, config] of this.state.secondaryUsers) {
      users.push({
        userId,
        type: 'secondary',
        memoryDepth: config.memoryDepth,
        adaptationIntensity: config.adaptationIntensity,
      });
    }

    return users;
  }

  /**
   * Get current state
   */
  getState(): UserPriorityState {
    return {
      primaryUser: this.state.primaryUser ? { ...this.state.primaryUser } : null,
      isPrimaryUserSet: this.state.isPrimaryUserSet,
      secondaryUsers: new Map(this.state.secondaryUsers),
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get system statistics
   */
  getSystemStats(): {
    primaryUserSet: boolean;
    secondaryUserCount: number;
    totalMemoryEntries: number;
    totalInteractions: number;
  } {
    let totalMemory = 0;
    let totalInteractions = 0;

    for (const memory of this.userMemory.values()) {
      totalMemory += memory.length;
    }

    for (const count of this.interactionCounts.values()) {
      totalInteractions += count;
    }

    return {
      primaryUserSet: this.state.isPrimaryUserSet,
      secondaryUserCount: this.state.secondaryUsers.size,
      totalMemoryEntries: totalMemory,
      totalInteractions,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: UserPrioritySystem | null = null;

export function getUserPrioritySystem(): UserPrioritySystem {
  if (!instance) {
    instance = new UserPrioritySystem();
  }
  return instance;
}

export function resetUserPrioritySystem(): void {
  instance = null;
}

export default UserPrioritySystem;
