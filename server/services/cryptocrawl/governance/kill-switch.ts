import type { ExecutionContext, KillSwitchResult } from './system-control.js';

/**
 * Kill Switch System
 * Emergency shutdown mechanism for the governance system
 */
class KillSwitch {
  private static instance: KillSwitch;
  private active: boolean = false;
  private reason: string | undefined;

  private constructor() {
    // Check environment variable on initialization
    this.active = process.env.SYSTEM_KILL_SWITCH === 'true';
    if (this.active) {
      this.reason = 'Kill switch engaged via environment variable';
    }
  }

  static getInstance(): KillSwitch {
    if (!KillSwitch.instance) {
      KillSwitch.instance = new KillSwitch();
    }
    return KillSwitch.instance;
  }

  async isActive(context: ExecutionContext): Promise<KillSwitchResult> {
    const forced =
      context.flags?.killSwitch === true ||
      process.env.SYSTEM_KILL_SWITCH === 'true';

    return {
      active: !!forced || this.active,
      reason: forced ? 'Kill switch engaged' : this.reason,
    };
  }

  /**
   * Engage the kill switch
   */
  engage(reason: string): void {
    this.active = true;
    this.reason = reason;
  }

  /**
   * Disengage the kill switch
   */
  disengage(): void {
    this.active = false;
    this.reason = undefined;
  }

  /**
   * Get current state
   */
  getState(): { active: boolean; reason?: string } {
    return {
      active: this.active,
      reason: this.reason,
    };
  }

  /**
   * Export state for persistence
   */
  exportState(): any {
    return {
      active: this.active,
      reason: this.reason,
      timestamp: Date.now(),
    };
  }

  /**
   * Import state from persistence
   */
  importState(data: any): void {
    if (typeof data.active === 'boolean') {
      this.active = data.active;
    }
    if (data.reason) {
      this.reason = data.reason;
    }
  }
}

// Singleton instance
export const killSwitch = KillSwitch.getInstance();

// Export the function for backward compatibility
export async function isActive(context: ExecutionContext): Promise<KillSwitchResult> {
  return killSwitch.isActive(context);
}
