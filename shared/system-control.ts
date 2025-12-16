/**
 * OBVIOUS system control - single source of truth for whether the system is ON.
 * 
 * Design goals:
 * - One function: SystemControl.isOn()
 * - One reason: SystemControl.whyOff()
 * - No hidden state: all checks live in this file
 * - Safe default: starts OFF until a human enables it
 */

export type ControlCheck = {
  name: string;
  /** Return true when the check passes */
  passes: () => boolean;
  /** Reason to report when the check fails */
  reason: string | (() => string);
};

type ControlState = {
  operatorEnabled: boolean;
  operatorReason: string;
  injectedChecks: ControlCheck[];
};

const state: ControlState = {
  operatorEnabled: false,
  operatorReason: 'System has not been enabled by an operator',
  injectedChecks: [],
};

const baseChecks = (): ControlCheck[] => [
  {
    name: 'operator_switch',
    passes: () => state.operatorEnabled,
    reason: () => state.operatorReason,
  },
  {
    name: 'force_off_flag',
    passes: () => process.env.SYSTEM_FORCE_OFF !== 'true',
    reason: 'SYSTEM_FORCE_OFF flag is set',
  },
];

function evaluateChecks(): { isOn: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const check of [...baseChecks(), ...state.injectedChecks]) {
    const passed = check.passes();
    if (!passed) {
      const reason = typeof check.reason === 'function' ? check.reason() : check.reason;
      reasons.push(reason);
      break;
    }
  }

  return { isOn: reasons.length === 0, reasons };
}

export const SystemControl = {
  /**
   * Main gate: returns true only when every check passes.
   */
  isOn(): boolean {
    return evaluateChecks().isOn;
  },

  /**
   * Returns the first reason the system is OFF, or "System is ON".
   */
  whyOff(): string {
    const result = evaluateChecks();
    return result.isOn ? 'System is ON' : result.reasons[0];
  },

  /**
   * Operator switch: safe default is OFF.
   */
  turnOn(reason = 'Operator enabled system'): void {
    state.operatorEnabled = true;
    state.operatorReason = reason;
  },

  /**
   * Explicitly turn the system OFF and set the visible reason.
   */
  turnOff(reason = 'System has been turned OFF'): void {
    state.operatorEnabled = false;
    state.operatorReason = reason;
  },

  /**
   * Replace auxiliary checks (useful for tests).
   */
  setChecks(checks: ControlCheck[]): void {
    state.injectedChecks = [...checks];
  },

  /**
   * Reset auxiliary checks (does not flip the operator switch).
   */
  resetChecks(): void {
    state.injectedChecks = [];
  },

  /**
   * Expose full status for debugging/logging.
   */
  status(): { isOn: boolean; reasons: string[] } {
    return evaluateChecks();
  },
};
