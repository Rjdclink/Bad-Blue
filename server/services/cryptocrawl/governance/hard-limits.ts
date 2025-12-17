import type { ExecutionContext, HardLimitResult } from './system-control.js';

export async function exceeded(context: ExecutionContext): Promise<HardLimitResult> {
  const overload = context.limits?.overload === true || context.limits?.maxConcurrencyExceeded === true;
  return {
    exceeded: !!overload,
    reason: overload ? (context.limits?.reason ?? 'Hard limit exceeded') : undefined,
  };
}
