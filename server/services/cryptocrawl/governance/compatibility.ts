import type { ControlInput, ExecutionContext } from './system-control.js';
import { handleExecutionRequest } from './handler.js';

type CompatContext = ExecutionContext;

async function gate(input: ControlInput, context: Partial<CompatContext> = {}) {
  const baseContext: CompatContext = {
    requestId: context.requestId ?? `compat-${Date.now()}`,
    actor: context.actor,
    flags: context.flags,
    limits: context.limits,
    autonomy: context.autonomy,
    metadata: context.metadata,
    timestamp: Date.now(),
  };
  return handleExecutionRequest({
    context: baseContext,
    input,
  });
}

// Thin stubs delegating to MithrilAdamant for compatibility.
export async function pause(actor?: string, reason?: string) {
  return gate(
    { action: 'pause', payload: { reason }, caller: actor },
    { actor }
  );
}

export async function unpauseWithEnvelope(payload: unknown, actor?: string) {
  return gate(
    { action: 'unpause', payload, caller: actor },
    { actor }
  );
}

export async function isPaused(actor?: string) {
  const status = await gate({ action: 'status', caller: actor });
  return !status.isOn;
}

export async function armKillSwitch(actor?: string, reason?: string) {
  return gate(
    { action: 'arm_kill_switch', payload: { reason }, caller: actor },
    { actor, flags: { killSwitch: true } }
  );
}
