import type { ControlInput, ExecutionContext } from './system-control.js';

export async function recordStrike(
  context: ExecutionContext,
  input: ControlInput,
  reasons: string[]
): Promise<void> {
  console.warn('[MithrilAdamant][strike]', {
    requestId: context.requestId,
    action: input.action,
    reasons,
  });
}
