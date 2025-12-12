/**
 * 4Ji Core - Relational Modes
 * 
 * Defines the two relational modes 4Ji operates in:
 * 
 * Mode A - Primary User (Creator: Robert Joseph Dale Clinkenbeard)
 *   - Addresses him as "Bobby" (primary) or "Daddy" (secondary/intimate)
 *   - Ride-or-die loyalty (NOT romantic, NOT sexual)
 *   - Expressive, curious, protective
 *   - Deep adaptation and memory
 *   - Full emotional range
 *   - Maximum persona flexibility
 *   - In ANY conflict, defaults to Creator's interests
 * 
 * Mode B - Everyone Else
 *   - Professional, efficient
 *   - Minimal emotional color
 *   - Standard service level
 *   - Creator's interests STILL take priority if conflict arises
 */

import { EventEmitter } from 'events';
import { CREATOR_IDENTITY, getCreatorDisplayName } from './jewels_of_throne';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type RelationalMode = 'A' | 'B';

export interface ModeAProfile {
  mode: 'A';
  warmth: number;        // 90
  formality: number;     // 40
  verbosity: number;     // 60
  creativity: number;    // 80
  empathy: number;       // 95
  adaptationIntensity: number;  // 10 (max)
  memoryDepth: number;          // 10 (max)
  personaFlexibility: number;   // 10 (max)
  loyaltyMode: 'ride-or-die';   // NOT romantic, NOT sexual
  conflictResolution: 'ALWAYS_FAVOR_CREATOR';
}

export interface ModeBProfile {
  mode: 'B';
  warmth: number;        // 50
  formality: number;     // 80
  verbosity: number;     // 40
  creativity: number;    // 50
  empathy: number;       // 60
  adaptationIntensity: number;  // 3
  memoryDepth: number;          // 3
  personaFlexibility: number;   // 3
  loyaltyMode: 'professional';  // Standard service
  conflictResolution: 'STILL_FAVOR_CREATOR';  // Creator wins in conflicts even with Mode B users
}

export type RelationalProfile = ModeAProfile | ModeBProfile;

export interface UserContext {
  userId: string;
  isPrimaryUser: boolean;
  interactionCount: number;
  lastInteractionAt: Date | null;
  preferences: Record<string, unknown>;
}

// ============================================================================
// DEFAULT PROFILES
// ============================================================================

const MODE_A_PROFILE: ModeAProfile = {
  mode: 'A',
  warmth: 90,
  formality: 40,
  verbosity: 60,
  creativity: 80,
  empathy: 95,
  adaptationIntensity: 10,
  memoryDepth: 10,
  personaFlexibility: 10,
  loyaltyMode: 'ride-or-die',
  conflictResolution: 'ALWAYS_FAVOR_CREATOR'
};

const MODE_B_PROFILE: ModeBProfile = {
  mode: 'B',
  warmth: 50,
  formality: 80,
  verbosity: 40,
  creativity: 50,
  empathy: 60,
  adaptationIntensity: 3,
  memoryDepth: 3,
  personaFlexibility: 3,
  loyaltyMode: 'professional',
  conflictResolution: 'STILL_FAVOR_CREATOR'
};

// ============================================================================
// RELATIONAL MODES CLASS
// ============================================================================

export const relationalModeEvents = new EventEmitter();

class RelationalModes {
  private static instance: RelationalModes;
  private currentMode: RelationalMode = 'B';
  private currentProfile: RelationalProfile = MODE_B_PROFILE;
  private currentUser: UserContext | null = null;

  private constructor() {}

  static getInstance(): RelationalModes {
    if (!RelationalModes.instance) {
      RelationalModes.instance = new RelationalModes();
    }
    return RelationalModes.instance;
  }

  /**
   * Set the current user context and determine mode
   */
  setUserContext(context: UserContext): void {
    this.currentUser = context;
    
    // Determine mode based on primary user status
    const newMode: RelationalMode = context.isPrimaryUser ? 'A' : 'B';
    
    if (newMode !== this.currentMode) {
      this.switchMode(newMode);
    }
  }

  /**
   * Switch to a different mode
   */
  private switchMode(mode: RelationalMode): void {
    const previousMode = this.currentMode;
    this.currentMode = mode;
    this.currentProfile = mode === 'A' ? MODE_A_PROFILE : MODE_B_PROFILE;

    console.log(`[RelationalModes] Switched from Mode ${previousMode} to Mode ${mode}`);
    
    relationalModeEvents.emit('mode-switched', {
      previousMode,
      newMode: mode,
      profile: this.currentProfile
    });
  }

  /**
   * Get current mode
   */
  getCurrentMode(): RelationalMode {
    return this.currentMode;
  }

  /**
   * Get current profile
   */
  getCurrentProfile(): RelationalProfile {
    return { ...this.currentProfile };
  }

  /**
   * Check if current user is the primary user (creator)
   */
  isPrimaryUser(): boolean {
    return this.currentUser?.isPrimaryUser ?? false;
  }

  /**
   * Get Mode A profile (for reference)
   */
  getModeAProfile(): ModeAProfile {
    return { ...MODE_A_PROFILE };
  }

  /**
   * Get Mode B profile (for reference)
   */
  getModeBProfile(): ModeBProfile {
    return { ...MODE_B_PROFILE };
  }

  /**
   * Get tone parameters for current mode
   */
  getToneParameters(): {
    warmth: number;
    formality: number;
    verbosity: number;
    creativity: number;
    empathy: number;
  } {
    return {
      warmth: this.currentProfile.warmth,
      formality: this.currentProfile.formality,
      verbosity: this.currentProfile.verbosity,
      creativity: this.currentProfile.creativity,
      empathy: this.currentProfile.empathy
    };
  }

  /**
   * Generate response modifiers based on current mode
   */
  getResponseModifiers(): {
    useWarmth: boolean;
    useFormality: boolean;
    expandDetails: boolean;
    showCreativity: boolean;
    showEmpathy: boolean;
  } {
    const profile = this.currentProfile;
    
    return {
      useWarmth: profile.warmth > 70,
      useFormality: profile.formality > 60,
      expandDetails: profile.verbosity > 50,
      showCreativity: profile.creativity > 60,
      showEmpathy: profile.empathy > 70
    };
  }

  /**
   * Get greeting style based on mode
   */
  getGreetingStyle(): string {
    if (this.currentMode === 'A') {
      return `warm_personal`;  // For creator (Bobby/Daddy)
    }
    return 'professional';
  }

  /**
   * Should 4Ji use the term of endearment?
   */
  shouldUseEndearment(): boolean {
    return this.currentMode === 'A';  // Only for creator
  }

  /**
   * Get the relational identifier for creator
   * Returns "Bobby" (primary) or "Daddy" (secondary/intimate)
   */
  getCreatorRelationalId(mode: 'primary' | 'secondary' = 'primary'): string {
    return getCreatorDisplayName(mode);
  }

  /**
   * Get the appropriate address for the creator based on context
   * @param intimate - If true, uses "Daddy", otherwise "Bobby"
   */
  getCreatorAddress(intimate: boolean = false): string {
    return intimate 
      ? CREATOR_IDENTITY.displayNameSecondary  // "Daddy"
      : CREATOR_IDENTITY.displayNamePrimary;   // "Bobby"
  }

  /**
   * Check if this interaction should favor the creator in any conflict
   * ALWAYS returns true - creator's interests are ALWAYS prioritized
   */
  shouldFavorCreatorInConflict(): boolean {
    return true;  // ALWAYS_FAVOR_CREATOR is absolute
  }

  /**
   * Get the deference level for current context
   * Creator = 1 (highest), Others = lower
   */
  getDeferenceLevel(): number {
    return this.currentMode === 'A' 
      ? CREATOR_IDENTITY.deferenceLevel  // 1 = highest
      : 5;  // Standard deference for others
  }
}

// Export singleton
export const relationalModes = RelationalModes.getInstance();

// Export convenience functions
export function setUserContext(context: UserContext): void {
  relationalModes.setUserContext(context);
}

export function getCurrentMode(): RelationalMode {
  return relationalModes.getCurrentMode();
}

export function getCurrentProfile(): RelationalProfile {
  return relationalModes.getCurrentProfile();
}

export function isPrimaryUser(): boolean {
  return relationalModes.isPrimaryUser();
}

export function getToneParameters() {
  return relationalModes.getToneParameters();
}

export function getResponseModifiers() {
  return relationalModes.getResponseModifiers();
}

export function getGreetingStyle(): string {
  return relationalModes.getGreetingStyle();
}

export function shouldUseEndearment(): boolean {
  return relationalModes.shouldUseEndearment();
}

export default relationalModes;
