/**
 * Sole entry point. No work happens until handleExecutionRequest is called.
 */
import type {
  ControlInput,
  ExecutionContext,
  SystemControlResult,
} from './system-control.js';

export type RawRequest = {
  context: ExecutionContext;
  input: ControlInput;
};

export async function handleExecutionRequest(request: RawRequest): Promise<SystemControlResult> {
  const [{ createMithrilAdamant }, { isActive }, { exceeded }, { getCurrentLevel }, { recordStrike }] =
    await Promise.all([
      import('./system-control.js'),
      import('./kill-switch.js'),
      import('./hard-limits.js'),
      import('./autonomy.js'),
      import('./escalation.js'),
    ]);

  const gate = createMithrilAdamant({
    killSwitch: isActive,
    hardLimits: exceeded,
    getAutonomyLevel: getCurrentLevel,
    recordStrike,
  });

  return gate.status(request.context, request.input);
}
