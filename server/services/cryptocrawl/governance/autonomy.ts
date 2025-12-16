import type { AutonomyResult, ControlInput, ExecutionContext } from './system-control.js';

export async function getCurrentLevel(
  context: ExecutionContext,
  input: ControlInput
): Promise<AutonomyResult> {
  const level = context.autonomy?.level ?? 0;
  const reason = context.autonomy?.reason ?? `Autonomy level set to ${level} for ${input.action}`;
  return { level, reason };
}
