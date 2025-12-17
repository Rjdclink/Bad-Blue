import type { ExecutionContext, KillSwitchResult } from './system-control.js';

export async function isActive(context: ExecutionContext): Promise<KillSwitchResult> {
  const forced =
    context.flags?.killSwitch === true ||
    process.env.SYSTEM_KILL_SWITCH === 'true';

  return {
    active: !!forced,
    reason: forced ? 'Kill switch engaged' : undefined,
  };
}
