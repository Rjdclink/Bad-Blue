/**
 * MithrilAdamant gate factory (decision point).
 * No side effects, no module-level state.
 */

export type ExecutionContext = {
  requestId: string;
  actor?: string;
  flags?: Record<string, unknown>;
  limits?: {
    overload?: boolean;
    reason?: string;
    maxConcurrencyExceeded?: boolean;
  };
  autonomy?: {
    level?: number;
    reason?: string;
  };
  metadata?: Record<string, unknown>;
  timestamp?: number;
};

export type ControlInput = {
  action: string;
  requestedCapability?: number;
  payload?: unknown;
  caller?: string;
};

export type KillSwitchResult = {
  active: boolean;
  reason?: string;
};

export type HardLimitResult = {
  exceeded: boolean;
  reason?: string;
};

export type AutonomyResult = {
  level: number;
  reason?: string;
};

export type SystemControlResult = {
  isOn: boolean;
  capability: number;
  reasons: string[];
};

export type SystemControlDeps = {
  killSwitch: (context: ExecutionContext) => Promise<KillSwitchResult>;
  hardLimits: (context: ExecutionContext) => Promise<HardLimitResult>;
  getAutonomyLevel: (context: ExecutionContext, input: ControlInput) => Promise<AutonomyResult>;
  recordStrike?: (context: ExecutionContext, input: ControlInput, reasons: string[]) => Promise<void>;
};

export function createMithrilAdamant(deps: SystemControlDeps) {
  async function evaluate(context: ExecutionContext, input: ControlInput): Promise<SystemControlResult> {
    const reasons: string[] = [];

    if (!input?.action) {
      return { isOn: false, capability: 0, reasons: ['No action specified'] };
    }

    const [killSwitch, hardLimit, autonomy] = await Promise.all([
      deps.killSwitch(context),
      deps.hardLimits(context),
      deps.getAutonomyLevel(context, input),
    ]);

    if (killSwitch.active) {
      reasons.push(killSwitch.reason ?? 'Kill switch active');
    }

    if (hardLimit.exceeded) {
      reasons.push(hardLimit.reason ?? 'Hard limits exceeded');
    }

    const requested = input.requestedCapability ?? 0;
    const capability = autonomy.level ?? 0;
    if (capability < requested) {
      reasons.push(autonomy.reason ?? `Autonomy level ${capability} below required ${requested}`);
    }

    const isOn = reasons.length === 0;
    if (!isOn && deps.recordStrike) {
      await deps.recordStrike(context, input, reasons);
    }

    return { isOn, capability, reasons };
  }

  return {
    evaluate,
    async isOn(context: ExecutionContext, input: ControlInput): Promise<boolean> {
      const result = await evaluate(context, input);
      return result.isOn;
    },
    async whyOff(context: ExecutionContext, input: ControlInput): Promise<string> {
      const result = await evaluate(context, input);
      return result.isOn ? 'System is ON' : result.reasons[0];
    },
    async status(context: ExecutionContext, input: ControlInput): Promise<SystemControlResult> {
      return evaluate(context, input);
    },
  };
}
